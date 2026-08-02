import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Excel upload is disabled. The application now uses the connected Google Sheet only." },
    { status: 410 },
  );
}
