import { NextResponse } from "next/server";
import {
  getConnectedGoogleAccessToken,
  getPickerConfiguration,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function POST() {
  try {
    const accessToken = await getConnectedGoogleAccessToken();
    return NextResponse.json({
      accessToken,
      picker: getPickerConfiguration(),
    });
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Google Picker could not be opened.",
      },
      { status: 401 },
    );
  }
}
