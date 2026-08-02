import { NextResponse } from "next/server";
import { z } from "zod";
import { loadGoogleSheetVocabulary } from "@/lib/google-sheet-vocabulary";
import { resolveInterpretedDraft } from "@/lib/master-data";
import { interpretedDraftSchema } from "@/lib/voice-parser";

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
      return NextResponse.json({ error: "Gemini is not configured in Vercel." }, { status: 503 });
    }

    const vocabulary = await loadGoogleSheetVocabulary();
    const prompt = [
      "You convert a multilingual business instruction into structured approval-note data.",
      "The instruction may mix Gujarati, Hindi and Indian English.",
      "Extract every item in the spoken order. Preserve decimals, fractions and prices exactly.",
      "Extract the recipient name from the current instruction. Do not require a saved customer record.",
      "Use the supplied master vocabulary only to correct spelling and terminology when the match is strong.",
      "Return descriptions exactly as [ SHAPE ] [ QUALITY ]. Example: [ PE ] [ VVS-1 (FG) ].",
      "Never infer an asking price from historical data. The current instruction must explicitly provide the price.",
      "Never invent names, sizes, descriptions, carats, prices or remarks.",
      "Return no more than eight product rows.",
      "Return JSON only using exactly this shape:",
      '{"recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}]}',
      `CURRENT MASTER VOCABULARY: ${vocabulary}`,
      `INSTRUCTION: ${JSON.stringify(transcript)}`,
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
      throw new Error(`AI provider returned ${response.status}: ${providerText.slice(0, 400)}`);
    }

    const payload = await response.json();
    const content = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("The AI provider returned no structured content.");

    const parsed = interpretedDraftSchema.parse(JSON.parse(content));
    const resolved = await resolveInterpretedDraft(parsed);

    return NextResponse.json({
      mode: "ai",
      draft: resolved.draft,
      warnings: resolved.warnings,
      matches: resolved.matches,
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json({ error: cause.issues[0]?.message || "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Interpretation failed." },
      { status: 500 },
    );
  }
}
