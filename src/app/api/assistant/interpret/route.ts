import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJsonWithGeminiFallback } from "@/lib/gemini-fallback";
import { loadGoogleSheetVocabulary } from "@/lib/google-sheet-vocabulary";
import {
  findBestMasterMatch,
  loadMasterData,
  resolveInterpretedDraft,
} from "@/lib/master-data";

export const runtime = "nodejs";

const requestSchema = z.object({
  instruction: z.string().min(1).max(12000),
});

const createActionSchema = z.object({
  action: z.literal("create_memorandum"),
  recipientName: z.string().min(1),
  recipientType: z.enum(["Broker", "Customer", "Other"]).default("Other"),
  through: z.string().default(""),
  date: z.string().optional(),
  items: z
    .array(
      z.object({
        size: z.string().min(1),
        descriptionQuery: z.string().min(1),
        carats: z.number().nonnegative(),
        askingPrice: z.number().positive().optional(),
        remarks: z.string().optional(),
      }),
    )
    .min(1)
    .max(8),
  warnings: z.array(z.string()).default([]),
});

const returnActionSchema = z.object({
  action: z.literal("mark_returned"),
  reference: z.string().min(1),
  returnDate: z.string().optional(),
  confirmPerson: z.string().min(1),
  warnings: z.array(z.string()).default([]),
});

const actionSchema = z.discriminatedUnion("action", [
  createActionSchema,
  returnActionSchema,
]);

function indiaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function resolveConfirmationPerson(
  input: string,
  operators: string[],
): { value: string; warnings: string[] } {
  const match = findBestMasterMatch(input, operators, "operator");
  const warnings: string[] = [];

  if (!match) {
    warnings.push(
      `Confirmation person “${input}” was not found in the master-data worksheet.`,
    );
    return { value: input, warnings };
  }

  if (match.ambiguous || match.confidence < 0.86) {
    warnings.push(
      `Please confirm whether “${input}” means “${match.canonical}”.`,
    );
    return { value: input, warnings };
  }

  return { value: match.canonical, warnings };
}

export async function POST(request: Request) {
  try {
    const { instruction } = requestSchema.parse(await request.json());
    const [vocabulary, master] = await Promise.all([
      loadGoogleSheetVocabulary(),
      loadMasterData(),
    ]);
    const today = indiaDate();

    const prompt = [
      "You are the intent and data extraction engine for a diamond memorandum assistant.",
      "The instruction may be Gujarati, Hindi, Indian English, or a mixture of these languages.",
      "Decide whether the user wants to create a new memorandum or mark an existing memorandum as returned.",
      "",
      "WHEN THE USER WANTS TO CREATE A MEMORANDUM:",
      "- Use action create_memorandum.",
      "- Extract the recipient, recipient type, through or broker, date, and every diamond item in spoken order.",
      "- Preserve every decimal, fraction, product code, price, and remark.",
      "- Return descriptions as [ SHAPE ] [ QUALITY (COLOR) ]. Example: [ PE ] [ VVS-1 (FG) ].",
      "- Never infer an asking price from historical data. It must be present in the current instruction.",
      "- Return no more than eight items.",
      "",
      "WHEN THE USER WANTS TO MARK GOODS RETURNED:",
      "- Use action mark_returned.",
      "- Extract the complete memorandum reference, return date, and confirmation-person name.",
      `- Today in India is ${today}. When the user says today, use this date.`,
      "- Preserve slashes, letters, and digits in official memorandum references.",
      "",
      "Do not invent missing names, numbers, products, dates, prices, or references.",
      "When any information is uncertain, include a clear warning.",
      "Return one JSON object only.",
      "",
      "For creation use:",
      '{"action":"create_memorandum","recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}],"warnings":["string"]}',
      "",
      "For returned goods use:",
      '{"action":"mark_returned","reference":"string","returnDate":"YYYY-MM-DD optional","confirmPerson":"string","warnings":["string"]}',
      "",
      `CURRENT GOOGLE SHEETS VOCABULARY: ${vocabulary}`,
      `KNOWN CONFIRMATION-PERSON NAMES: ${JSON.stringify(master.operators)}`,
      `USER INSTRUCTION: ${JSON.stringify(instruction)}`,
    ].join("\n");

    const parsed = await generateJsonWithGeminiFallback({
      parts: [{ text: prompt }],
      parse: (content) => actionSchema.parse(JSON.parse(content)),
      temperature: 0,
    });

    if (parsed.action === "create_memorandum") {
      const resolved = await resolveInterpretedDraft({
        recipientName: parsed.recipientName,
        recipientType: parsed.recipientType,
        through: parsed.through,
        date: parsed.date,
        items: parsed.items,
      });

      return NextResponse.json({
        action: parsed.action,
        draft: resolved.draft,
        warnings: [...new Set([...parsed.warnings, ...resolved.warnings])],
        matches: resolved.matches,
      });
    }

    const person = resolveConfirmationPerson(
      parsed.confirmPerson,
      master.operators,
    );

    return NextResponse.json({
      action: parsed.action,
      details: {
        reference: parsed.reference,
        returnDate: parsed.returnDate || today,
        confirmPerson: person.value,
      },
      warnings: [...new Set([...parsed.warnings, ...person.warnings])],
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        { error: cause.issues[0]?.message || "The instruction is incomplete." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The instruction could not be processed.",
      },
      { status: 500 },
    );
  }
}
