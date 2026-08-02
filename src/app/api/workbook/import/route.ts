import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Excel/Supabase import is disabled. The connected Google Sheet is the only business data source." },
    { status: 410 },
  );
}
