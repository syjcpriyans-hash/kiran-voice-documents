import { NextResponse } from "next/server";
import { z } from "zod";
import { interpretedDraftSchema, parseDemoTranscript } from "@/lib/voice-parser";

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
      return NextResponse.json({ mode: "demo", draft: parseDemoTranscript(transcript) });
    }

    const prompt = [
      "You convert a spoken business instruction into structured approval-note data.",
      "The speech may mix Gujarati, Hindi and Indian English.",
      "Extract the recipient name from the speech itself. Do not require a saved customer record.",
      "Never invent names, sizes, descriptions, carats, prices or remarks.",
      "Return no more than eight product rows.",
      "Return JSON only using exactly this shape:",
      '{"recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}]}',
      `Speech: ${JSON.stringify(transcript)}`,
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
      throw new Error(`AI provider returned ${response.status}: ${providerText.slice(0, 300)}`);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("The AI provider returned no structured content.");

    const parsed = interpretedDraftSchema.parse(JSON.parse(text));
    return NextResponse.json({ mode: "ai", draft: parsed });
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
