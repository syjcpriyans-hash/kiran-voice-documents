import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJsonWithGeminiFallback } from "@/lib/gemini-fallback";
import { findBestMasterMatch, loadMasterData } from "@/lib/master-data";

export const runtime = "nodejs";
export const maxDuration = 60;

const responseSchema = z.object({
  transcript: z.string().min(1),
  detectedLanguage: z.string().default("unknown"),
  reference: z.string().min(1),
  returnDate: z.string().optional(),
  confirmPerson: z.string().min(1),
  warnings: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "auto-mixed");

    if (!(audio instanceof File) || audio.type !== "audio/wav") {
      return NextResponse.json(
        { error: "A WAV microphone recording is required." },
        { status: 400 },
      );
    }

    if (audio.size <= 1000 || audio.size > 3_500_000) {
      return NextResponse.json(
        { error: "The recording must be between one and sixty seconds." },
        { status: 400 },
      );
    }

    const master = await loadMasterData();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const audioBase64 = Buffer.from(
      await audio.arrayBuffer(),
    ).toString("base64");

    const prompt = [
      "Transcribe and extract a diamond memorandum return/received instruction.",
      "The audio may contain Gujarati, Hindi, Indian English or mixed language.",
      `Language hint: ${language}. Today in India is ${today}.`,
      "Preserve the full memo reference exactly, including slashes and digits.",
      "The reference can be an internal number such as 31 or an official value such as HO/PFI/2627/0046.",
      "Extract the return date. When the speaker says today, use today's India date.",
      "Extract the confirmation-person name. Use the known operator names only to correct a strong spelling match.",
      "If a memo digit, date or name is uncertain, include a warning and do not silently omit it.",
      "Return JSON only:",
      '{"transcript":"complete transcript","detectedLanguage":"string","reference":"string","returnDate":"YYYY-MM-DD optional","confirmPerson":"string","warnings":["string"]}',
      `Known operator names: ${JSON.stringify(master.operators)}`,
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
      parse: (content) => responseSchema.parse(JSON.parse(content)),
    });

    const personMatch = findBestMasterMatch(
      parsed.confirmPerson,
      master.operators,
      "operator",
    );
    const confirmPerson =
      personMatch &&
      personMatch.confidence >= 0.86 &&
      !personMatch.ambiguous
        ? personMatch.canonical
        : parsed.confirmPerson;
    const warnings = [...parsed.warnings];

    if (!personMatch) {
      warnings.push(
        `Confirmation person “${parsed.confirmPerson}” was not found in CUT. MASTER.`,
      );
    } else if (personMatch.ambiguous || personMatch.confidence < 0.86) {
      warnings.push(
        `Confirm whether “${parsed.confirmPerson}” means “${personMatch.canonical}”.`,
      );
    }

    return NextResponse.json({
      transcript: parsed.transcript,
      detectedLanguage: parsed.detectedLanguage,
      details: {
        reference: parsed.reference,
        returnDate: parsed.returnDate || today,
        confirmPerson,
      },
      warnings: [...new Set(warnings)],
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message || "Return audio is incomplete.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Return audio could not be interpreted.",
      },
      { status: 500 },
    );
  }
}
