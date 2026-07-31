import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const maxFileSize = 20 * 1024 * 1024;
const allowedExtensions = [".xlsx", ".xls"];

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an Excel file." }, { status: 400 });
    }

    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      return NextResponse.json({ error: "Only .xlsx and .xls files are supported." }, { status: 400 });
    }

    if (file.size > maxFileSize) {
      return NextResponse.json({ error: "The workbook must be smaller than 20 MB for this MVP." }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheets = workbook.SheetNames.map((name) => {
      const worksheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        raw: false,
      });

      return {
        name,
        headers: rows.length ? Object.keys(rows[0]) : [],
        sampleRows: rows.slice(0, 5),
        rowCount: rows.length,
      };
    });

    return NextResponse.json({
      fileName: file.name,
      fileSize: file.size,
      sheets,
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The workbook could not be read." },
      { status: 400 },
    );
  }
}
