import { NextResponse } from "next/server";
import { z } from "zod";
import { loadGoogleSheetVocabulary } from "@/lib/google-sheet-vocabulary";
import { resolveInterpretedDraft } from "@/lib/master-data";

export const runtime = "nodejs";
export const maxDuration = 60;

const responseSchema = z.object({
  transcript: z.string().min(1),
  detectedLanguage: z.string().default("unknown"),
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
    .max(8)
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "auto-mixed");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "No recorded audio was received." },
        { status: 400 },
      );
    }

    if (audio.type !== "audio/wav") {
      return NextResponse.json(
        { error: "The recording must be a WAV audio file." },
        { status: 400 },
      );
    }

    if (audio.size <= 1000 || audio.size > 3_500_000) {
      return NextResponse.json(
        {
          error:
            "The recording must be between one second and sixty seconds.",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;

    if (!apiKey || !model) {
      return NextResponse.json(
        { error: "Gemini is not configured in Vercel." },
        { status: 503 },
      );
    }

    const catalogue = await loadGoogleSheetVocabulary();
    const audioBase64 = Buffer.from(
      await audio.arrayBuffer(),
    ).toString("base64");

    const prompt = [
      "You are a high-accuracy multilingual transcription and business-data extraction engine.",
      "The audio may contain Gujarati, Hindi, Indian English, or code-switching between them.",
      `Language hint selected by the user: ${language}. Treat it only as a hint, not a restriction.`,
      "",
      "CRITICAL TRANSCRIPTION RULES:",
      "1. Transcribe the entire recording. Do not summarize and do not omit repeated product rows.",
      "2. Preserve every proper name, decimal number, fraction, product abbreviation, price and remark.",
      "3. Convert spoken number words into digits while preserving decimal precision.",
      "4. Normalize spoken fractions: quarter/one-fourth/ek bata chaar = 1/4, one-fifth/ek bata paanch = 1/5, one-sixth/ek bata chhe = 1/6, one-tenth/ek bata das = 1/10.",
      "5. Understand Gujarati and Hindi number words, Indian pronunciation and mixed-language phrases.",
      "6. If any word or number is uncertain, make the safest conservative transcription and add a warning. Never silently guess.",
      "",
      "DOCUMENT EXTRACTION RULES:",
      "1. Extract the recipient name directly from the audio.",
      "2. Extract no more than eight line items, in the exact spoken order.",
      "3. Use the Google Sheet vocabulary below only to correct spelling, capitalization, size and product terminology when there is a strong match.",
      "4. Return descriptions in exactly this format: [ SHAPE ] [ QUALITY (COLOR) ]. Example: [ PE ] [ VVS-1 (FG) ].",
      "5. Never infer or copy an asking price from historical Google Sheet data. Asking price must be explicitly spoken in the current recording.",
      "6. Never invent a product, carat value, asking price, recipient or remark.",
      "7. If one asking price applies to several rows only because the speaker explicitly says same price or applies to all, repeat the numeric price on every extracted row.",
      "8. Keep recipientType as Broker, Customer or Other.",
      "",
      "Return JSON only using exactly this shape:",
      '{"transcript":"complete transcript","detectedLanguage":"string","recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}],"warnings":["string"]}',
      "",
      "CURRENT GOOGLE SHEET VOCABULARY:",
      catalogue,
    ].join("\n");

    const provider = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: audioBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
          },
        }),
      },
    );

    if (!provider.ok) {
      const providerText = await provider.text();
      throw new Error(
        `AI audio provider returned ${provider.status}: ${providerText.slice(0, 500)}`,
      );
    }

    const payload = await provider.json();
    const content = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error("The AI provider returned no audio transcription.");
    }

    const parsed = responseSchema.parse(JSON.parse(content));
    const resolved = await resolveInterpretedDraft({
      recipientName: parsed.recipientName,
      recipientType: parsed.recipientType,
      through: parsed.through,
      date: parsed.date,
      items: parsed.items,
    });

    const warnings = [...parsed.warnings, ...resolved.warnings];

    return NextResponse.json({
      transcript: parsed.transcript,
      detectedLanguage: parsed.detectedLanguage,
      warnings: [...new Set(warnings)],
      matches: resolved.matches,
      draft: resolved.draft,
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message ||
            "The audio result was incomplete.",
        },
        { status: 422 },
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
