import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const maxFileSize = 20 * 1024 * 1024;
const batchSize = 500;

function searchableText(row: Record<string, unknown>): string {
  return Object.values(row)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 12000);
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase is not connected yet. Complete the Supabase setup first." }, { status: 503 });
  }

  let importId: string | null = null;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const sheetName = form.get("sheetName");

    if (!(file instanceof File) || typeof sheetName !== "string" || !sheetName.trim()) {
      return NextResponse.json({ error: "The Excel file and source sheet are required." }, { status: 400 });
    }
    if (file.size > maxFileSize) {
      return NextResponse.json({ error: "The workbook must be smaller than 20 MB for this MVP." }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return NextResponse.json({ error: "The selected sheet was not found." }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    });

    const importInsert = await admin
      .from("workbook_imports")
      .insert({
        file_name: file.name,
        source_sheet: sheetName,
        row_count: rows.length,
        status: "processing",
        is_current: false,
      })
      .select("id")
      .single();

    if (importInsert.error) throw importInsert.error;
    importId = importInsert.data.id;

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize).map((row, offset) => ({
        import_id: importId,
        source_sheet: sheetName,
        source_row_number: start + offset + 2,
        row_data: row,
        search_text: searchableText(row),
      }));
      if (!batch.length) continue;
      const insert = await admin.from("imported_rows").insert(batch);
      if (insert.error) throw insert.error;
    }

    const upload = await admin.storage.from("workbooks").upload("current/master.xlsx", bytes, {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
      cacheControl: "0",
    });
    if (upload.error) throw upload.error;

    const unsetPrevious = await admin
      .from("workbook_imports")
      .update({ is_current: false })
      .neq("id", importId);
    if (unsetPrevious.error) throw unsetPrevious.error;

    const markCurrent = await admin
      .from("workbook_imports")
      .update({ status: "ready", is_current: true, completed_at: new Date().toISOString() })
      .eq("id", importId);
    if (markCurrent.error) throw markCurrent.error;

    const settings = await admin.from("workbook_settings").upsert({
      singleton: true,
      current_import_id: importId,
      current_file_path: "current/master.xlsx",
      source_sheet: sheetName,
      updated_at: new Date().toISOString(),
    });
    if (settings.error) throw settings.error;

    return NextResponse.json({
      importId,
      rowCount: rows.length,
      workbookPath: "current/master.xlsx",
      sheetName,
    });
  } catch (cause) {
    if (importId) {
      await admin
        .from("workbook_imports")
        .update({ status: "failed", error_message: cause instanceof Error ? cause.message : "Import failed" })
        .eq("id", importId);
    }

    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Workbook import failed." },
      { status: 500 },
    );
  }
}
