import { NextResponse } from "next/server";
import { loadMasterData } from "@/lib/master-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await loadMasterData();
    return NextResponse.json({ data });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Master data could not be loaded." },
      { status: 500 },
    );
  }
}
