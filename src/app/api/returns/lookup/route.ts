import { NextResponse } from "next/server";
import { lookupReturnTarget } from "@/lib/return-workflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reference = url.searchParams.get("reference") || "";
    const result = await lookupReturnTarget(reference);
    return NextResponse.json({ result });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The memorandum could not be found." },
      { status: 404 },
    );
  }
}
