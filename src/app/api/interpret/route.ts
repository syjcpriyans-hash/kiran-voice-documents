import { NextResponse } from "next/server";
import { z } from "zod";
import { loadGoogleSheetVocabulary } from "@/lib/google-sheet-vocabulary";
import {
  interpretedDraftSchema,
  parseDemoTranscript,
} from "@/lib/voice-parser";

export const runtime = "nodejs";

const requestSchema = z.object({
  transcript: z.string().min(1).max(12000),
});

export async function POST(request: Request) {
  try {
    const { transcript } = requestSchema.parse(await request.json());
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;

    if (!apiKey || !model) {
      return NextResponse.json({
        mode: "demo",
        draft: parseDemoTranscript(transcript),
      });
    }

    const catalogue = await loadGoogleSheetVocabulary();

    const prompt = [
      "You convert a multilingual business instruction into structured approval-note data.",
      "The instruction may mix Gujarati, Hindi and Indian English.",
      "Extract the recipient name from the instruction itself.",
      "Return descriptions in exactly this format: [ SHAPE ] [ QUALITY (COLOR) ].",
      "Use the supplied Google Sheet vocabulary only for spelling and terminology.",
      "Never infer asking prices from historical Sheet data. A price must be present in the current instruction.",
      "Never invent names, sizes, descriptions, carats, prices or remarks.",
      "Return no more than eight product rows.",
      "If one explicitly stated price applies to all rows, repeat that numeric price on every row.",
      "Return JSON only using exactly this shape:",
      '{"recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}]}',
      `Instruction: ${JSON.stringify(transcript)}`,
      "GOOGLE SHEET VOCABULARY:",
      catalogue,
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
          },
        }),
      },
    );

    if (!response.ok) {
      const providerText = await response.text();
      throw new Error(
        `AI provider returned ${response.status}: ${providerText.slice(0, 300)}`,
      );
    }

    const payload = await response.json();
    const content = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("The AI provider returned no structured content.");
    }

    const parsed = interpretedDraftSchema.parse(JSON.parse(content));
    return NextResponse.json({ mode: "ai", draft: parsed });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message || "Invalid instruction.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Interpretation failed.",
      },
      { status: 500 },
    );
  }
}
