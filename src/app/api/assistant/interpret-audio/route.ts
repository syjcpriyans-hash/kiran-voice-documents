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
export const maxDuration = 60;

const createActionSchema = z.object({
  action: z.literal("create_memorandum"),
  transcript: z.string().min(1),
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
  transcript: z.string().min(1),
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
    const form = await request.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "auto-mixed");

    if (!(audio instanceof File) || audio.type !== "audio/wav") {
      return NextResponse.json(
        { error: "A microphone recording in Waveform Audio File Format is required." },
        { status: 400 },
      );
    }

    if (audio.size <= 1000 || audio.size > 3_500_000) {
      return NextResponse.json(
        { error: "The recording must be between one and sixty seconds." },
        { status: 400 },
      );
    }

    const [vocabulary, master] = await Promise.all([
      loadGoogleSheetVocabulary(),
      loadMasterData(),
    ]);
    const today = indiaDate();
    const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

    const prompt = [
      "You are a high-accuracy multilingual transcription, intent classification, and business-data extraction engine.",
      "The audio may contain Gujarati, Hindi, Indian English, or code-switching between them.",
      `The user selected this language hint: ${language}. Treat it only as a hint, not a restriction.`,
      "Transcribe the complete recording without omitting repeated product rows.",
      "Decide whether the user wants to create a new memorandum or mark an existing memorandum as returned.",
      "",
      "FOR A NEW MEMORANDUM:",
      "- Use action create_memorandum.",
      "- Preserve every proper name, decimal, fraction, product code, price, and remark.",
      "- Normalize spoken fractions such as one by four to 1/4 and one by ten to 1/10.",
      "- Return descriptions as [ SHAPE ] [ QUALITY (COLOR) ]. Example: [ PE ] [ VVS-1 (FG) ].",
      "- Never infer an asking price from historical data.",
      "- Return no more than eight items.",
      "",
      "FOR RETURNED GOODS:",
      "- Use action mark_returned.",
      "- Extract the complete memorandum reference, return date, and confirmation-person name.",
      `- Today in India is ${today}. When the speaker says today, use this date.`,
      "- Preserve slashes, letters, and digits in official memorandum references.",
      "",
      "Never invent missing information. Add a warning whenever a name or number is uncertain.",
      "Return one JSON object only.",
      "",
      "For creation use:",
      '{"action":"create_memorandum","transcript":"complete transcript","recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}],"warnings":["string"]}',
      "",
      "For returned goods use:",
      '{"action":"mark_returned","transcript":"complete transcript","reference":"string","returnDate":"YYYY-MM-DD optional","confirmPerson":"string","warnings":["string"]}',
      "",
      `CURRENT GOOGLE SHEETS VOCABULARY: ${vocabulary}`,
      `KNOWN CONFIRMATION-PERSON NAMES: ${JSON.stringify(master.operators)}`,
    ].join("\n");

    const parsed = await generateJsonWithGeminiFallback({
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "audio/wav",
            data: audioBase64,
          },
        },
      ],
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
        transcript: parsed.transcript,
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
      transcript: parsed.transcript,
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
        { error: cause.issues[0]?.message || "The audio instruction is incomplete." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The recorded instruction could not be processed.",
      },
      { status: 500 },
    );
  }
}
