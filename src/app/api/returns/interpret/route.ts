import { NextResponse } from "next/server";
import { z } from "zod";
import { findBestMasterMatch, loadMasterData } from "@/lib/master-data";

export const runtime = "nodejs";

const requestSchema = z.object({ instruction: z.string().min(1).max(2000) });
const responseSchema = z.object({
  reference: z.string().min(1),
  returnDate: z.string().optional(),
  confirmPerson: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { instruction } = requestSchema.parse(await request.json());
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !model) throw new Error("Gemini is not configured in Vercel.");

    const master = await loadMasterData();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const prompt = [
      "Extract a diamond memorandum return instruction.",
      "The instruction may be Gujarati, Hindi, English or mixed language.",
      `Today's date in India is ${today}.`,
      "The reference can be an internal numeric memo such as 31 or an official value such as HO/PFI/2627/0046.",
      "Return JSON only: {\"reference\":\"string\",\"returnDate\":\"YYYY-MM-DD optional\",\"confirmPerson\":\"string\"}.",
      `Known confirmation-person names: ${JSON.stringify(master.operators)}`,
      `Instruction: ${JSON.stringify(instruction)}`,
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );
    if (!response.ok) throw new Error(`AI returned ${response.status}: ${(await response.text()).slice(0, 300)}`);

    const payload = await response.json();
    const content = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("The AI returned no return details.");

    const parsed = responseSchema.parse(JSON.parse(content));
    const personMatch = findBestMasterMatch(parsed.confirmPerson, master.operators, "operator");
    const confirmPerson = personMatch && personMatch.confidence >= 0.86 && !personMatch.ambiguous
      ? personMatch.canonical
      : parsed.confirmPerson;
    const warnings: string[] = [];
    if (!personMatch) warnings.push(`Confirmation person “${parsed.confirmPerson}” was not found in CUT. MASTER.`);
    else if (personMatch.ambiguous || personMatch.confidence < 0.86) warnings.push(`Confirm whether “${parsed.confirmPerson}” means “${personMatch.canonical}”.`);

    return NextResponse.json({
      details: {
        reference: parsed.reference,
        returnDate: parsed.returnDate || today,
        confirmPerson,
      },
      warnings,
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json({ error: cause.issues[0]?.message || "Return instruction is incomplete." }, { status: 400 });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Return instruction could not be interpreted." },
      { status: 500 },
    );
  }
}
