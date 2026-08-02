import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

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
        askingPrice: z.number().nonnegative().optional(),
        remarks: z.string().optional(),
      }),
    )
    .max(8)
    .default([]),
  warnings: z.array(z.string()).default([]),
});

function compactCatalogRow(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;

  const record = row as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== "" &&
      Object.keys(compact).length < 12
    ) {
      compact[key] = value;
    }
  }

  return compact;
}

async function loadWorkbookVocabulary(): Promise<string> {
  const admin = createAdminClient();
  if (!admin) return "No workbook catalogue was available.";

  const settings = await admin
    .from("workbook_settings")
    .select("current_import_id")
    .eq("singleton", true)
    .maybeSingle();

  if (settings.error || !settings.data?.current_import_id) {
    return "No workbook catalogue was available.";
  }

  const rows = await admin
    .from("imported_rows")
    .select("id, source_row_number, row_data")
    .eq("import_id", settings.data.current_import_id)
    .order("source_row_number", { ascending: true })
    .limit(300);

  if (rows.error || !rows.data?.length) {
    return "No workbook catalogue was available.";
  }

  const compactRows = rows.data.map((row) => ({
    sourceRowId: row.id,
    sourceRowNumber: row.source_row_number,
    data: compactCatalogRow(row.row_data),
  }));

  return JSON.stringify(compactRows).slice(0, 60_000);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "auto-mixed");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "No recorded audio was received." }, { status: 400 });
    }

    if (audio.type !== "audio/wav") {
      return NextResponse.json({ error: "The recording must be a WAV audio file." }, { status: 400 });
    }

    if (audio.size <= 1000 || audio.size > 3_500_000) {
      return NextResponse.json(
        { error: "The recording must be between one second and sixty seconds." },
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

    const catalogue = await loadWorkbookVocabulary();
    const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

    const prompt = [
      "You are a high-accuracy multilingual transcription and business-data extraction engine.",
      "The audio may contain Gujarati, Hindi, Indian English, or code-switching between them.",
      `Language hint selected by the user: ${language}. Treat it only as a hint, not a restriction.`,
      "",
      "CRITICAL TRANSCRIPTION RULES:",
      "1. Transcribe the entire recording. Do not summarize and do not omit repeated product rows.",
      "2. Preserve every proper name, decimal number, fraction, product abbreviation, price and remark.",
      "3. Convert spoken number words into digits while preserving decimal precision.",
      "4. Normalize spoken fractions: quarter/one-fourth = 1/4, one-fifth = 1/5, one-sixth = 1/6, one-tenth = 1/10.",
      "5. Understand Gujarati/Hindi number words and mixed-language phrases.",
      "6. If any word or number is uncertain, make the best conservative transcription and add a clear warning. Never silently guess.",
      "",
      "DOCUMENT EXTRACTION RULES:",
      "1. Extract the recipient name directly from the audio.",
      "2. Extract no more than eight line items, in the exact spoken order.",
      "3. Use the workbook catalogue below to correct product descriptions, sizes and prices when there is a strong match.",
      "4. When matched, copy the workbook spelling and punctuation exactly, including capitals, spaces and brackets.",
      "5. Never invent a workbook product, price or carat value.",
      "6. A price spoken once may apply to subsequent rows only when the speaker explicitly says it applies to all or the context is unambiguous.",
      "7. Keep recipientType as Broker, Customer or Other.",
      "",
      "Return JSON only using exactly this shape:",
      '{"transcript":"complete transcript","detectedLanguage":"string","recipientName":"string","recipientType":"Broker|Customer|Other","through":"string","date":"YYYY-MM-DD optional","items":[{"size":"string","descriptionQuery":"string","carats":number,"askingPrice":number optional,"remarks":"string optional"}],"warnings":["string"]}',
      "",
      "CURRENT WORKBOOK CATALOGUE:",
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
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("The AI provider returned no audio transcription.");
    }

    const parsed = responseSchema.parse(JSON.parse(text));

    return NextResponse.json({
      transcript: parsed.transcript,
      detectedLanguage: parsed.detectedLanguage,
      warnings: parsed.warnings,
      draft: {
        recipientName: parsed.recipientName,
        recipientType: parsed.recipientType,
        through: parsed.through,
        date: parsed.date,
        items: parsed.items,
      },
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        { error: cause.issues[0]?.message || "The audio result was incomplete." },
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
