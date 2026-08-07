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
export const maxDuration = 60;

function indiaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanResolvedRecipientName(
  name: string,
  recipientType: "Broker" | "Customer" | "Other",
): string {
  const cleaned = name.trim();
  if (recipientType === "Other") return cleaned;

  const type = recipientType === "Broker" ? "BROKER" : "CUSTOMER";

  return cleaned
    .replace(new RegExp(`\\s*\\(${type}\\)\\s*$`, "i"), "")
    .trim();
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
    const form = await request.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "Automatic mixed language");

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

    const prompt = buildAssistantExtractionPrompt({
      today,
      vocabulary,
      operators: master.operators,
      languageHint: language,
      includeTranscript: true,
    });

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
      parse: (content) => assistantExtractionSchema.parse(JSON.parse(content)),
      temperature: 0,
    });

    const transcript = parsed.transcript?.trim();
    if (!transcript) {
      return NextResponse.json(
        { error: "The complete recording could not be transcribed. Please try again." },
        { status: 400 },
      );
    }

    if (parsed.action === "create_memorandum") {
      const normalized = normalizeCreateMemorandumExtraction(parsed);
      const resolved = await resolveInterpretedDraft(normalized.draft);

      const draft = {
        ...resolved.draft,
        recipientName: cleanResolvedRecipientName(
          resolved.draft.recipientName,
          resolved.draft.recipientType,
        ),
      };

      return NextResponse.json({
        action: parsed.action,
        transcript,
        draft,
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
      transcript,
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
