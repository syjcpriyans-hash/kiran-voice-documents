import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJsonWithGeminiFallback } from "@/lib/gemini-fallback";
import { loadGoogleSheetVocabulary } from "@/lib/google-sheet-vocabulary";
import {
  assistantExtractionSchema,
  buildAssistantExtractionPrompt,
  normalizeCreateMemorandumExtraction,
} from "@/lib/memorandum-extraction";
import {
  findBestMasterMatch,
  loadMasterData,
  resolveInterpretedDraft,
} from "@/lib/master-data";

export const runtime = "nodejs";

const requestSchema = z.object({
  instruction: z.string().min(1).max(12000),
});

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
  const cleaned = input.trim();
  if (!cleaned) {
    return {
      value: "",
      warnings: ["Confirmation person is missing or unclear."],
    };
  }

  const match = findBestMasterMatch(cleaned, operators, "operator");
  const warnings: string[] = [];

  if (!match) {
    warnings.push(
      `Confirmation person “${cleaned}” was not found in the master-data worksheet.`,
    );
    return { value: cleaned, warnings };
  }

  if (match.ambiguous || match.confidence < 0.86) {
    warnings.push(
      `Please confirm whether “${cleaned}” means “${match.canonical}”.`,
    );
    return { value: cleaned, warnings };
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

    const prompt = buildAssistantExtractionPrompt({
      today,
      vocabulary,
      operators: master.operators,
      includeTranscript: false,
      instruction,
    });

    const parsed = await generateJsonWithGeminiFallback({
      parts: [{ text: prompt }],
      parse: (content) => assistantExtractionSchema.parse(JSON.parse(content)),
      temperature: 0,
    });

    if (parsed.action === "create_memorandum") {
      const normalized = normalizeCreateMemorandumExtraction(parsed);
      const resolved = await resolveInterpretedDraft(normalized.draft);

      return NextResponse.json({
        action: parsed.action,
        draft: resolved.draft,
        warnings: [
          ...new Set([
            ...normalized.warnings,
            ...resolved.warnings.filter((warning) => !warning.includes("“”")),
          ]),
        ],
        matches: resolved.matches,
      });
    }

    const person = resolveConfirmationPerson(
      parsed.confirmPerson,
      master.operators,
    );
    const returnWarnings = [...parsed.warnings];
    if (!parsed.reference.trim()) {
      returnWarnings.push("Memorandum reference is missing or unclear.");
    }

    return NextResponse.json({
      action: parsed.action,
      details: {
        reference: parsed.reference.trim(),
        returnDate: parsed.returnDate?.trim() || today,
        confirmPerson: person.value,
      },
      warnings: [...new Set([...returnWarnings, ...person.warnings])],
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
