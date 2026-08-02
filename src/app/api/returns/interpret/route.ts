import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJsonWithGeminiFallback } from "@/lib/gemini-fallback";
import { findBestMasterMatch, loadMasterData } from "@/lib/master-data";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  instruction: z.string().min(1).max(2000),
});

const responseSchema = z.object({
  reference: z.string().min(1),
  returnDate: z.string().optional(),
  confirmPerson: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { instruction } = requestSchema.parse(await request.json());
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
      'Return JSON only: {"reference":"string","returnDate":"YYYY-MM-DD optional","confirmPerson":"string"}.',
      `Known confirmation-person names: ${JSON.stringify(master.operators)}`,
      `Instruction: ${JSON.stringify(instruction)}`,
    ].join("\n");

    const parsed = await generateJsonWithGeminiFallback({
      parts: [{ text: prompt }],
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
    const warnings: string[] = [];

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
      details: {
        reference: parsed.reference,
        returnDate: parsed.returnDate || today,
        confirmPerson,
      },
      warnings,
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message ||
            "Return instruction is incomplete.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Return instruction could not be interpreted.",
      },
      { status: 500 },
    );
  }
}
