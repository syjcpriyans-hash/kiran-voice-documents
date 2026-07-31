import { Buffer } from "node:buffer";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const itemSchema = z.object({
  sourceRowId: z.string().uuid().nullable().optional(),
  sourceSerialNumber: z.string().nullable().optional(),
  size: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  carats: z.number().positive().max(1_000_000),
  askingPrice: z.number().nonnegative().max(1_000_000_000),
  remarks: z.string().max(500).default(""),
});

const requestSchema = z.object({
  requestId: z.string().uuid(),
  recipientName: z.string().min(1).max(250),
  recipientType: z.enum(["Broker", "Customer", "Other"]),
  through: z.string().max(250).default(""),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(itemSchema).min(1).max(8),
});

type RpcDocument = {
  id: string;
  serial_number: string;
  total_carats: number;
  excel_sync_status: "pending" | "completed" | "failed";
  is_new: boolean;
};

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase is not connected yet. Complete the Supabase setup first." }, { status: 503 });
  }

  try {
    const input = requestSchema.parse(await request.json());

    const workbookSettings = await admin
      .from("workbook_settings")
      .select("current_file_path")
      .eq("singleton", true)
      .maybeSingle();

    if (workbookSettings.error) throw workbookSettings.error;
    if (!workbookSettings.data?.current_file_path) {
      return NextResponse.json({ error: "Upload and import the master Excel workbook before generating a document." }, { status: 409 });
    }

    const rpc = await admin.rpc("create_approval_note", { p_payload: input });
    if (rpc.error) throw rpc.error;
    const document = rpc.data as RpcDocument;

    if (!document.is_new && document.excel_sync_status === "completed") {
      return NextResponse.json({ document });
    }

    let excelSyncStatus: RpcDocument["excel_sync_status"] = "completed";
    let syncError = "";

    try {
      const workbookPath = workbookSettings.data.current_file_path;
      const downloaded = await admin.storage.from("workbooks").download(workbookPath);
      if (downloaded.error) throw downloaded.error;

      const workbook = new ExcelJS.Workbook();
      const workbookBuffer = Buffer.from(await downloaded.data.arrayBuffer());
      await workbook.xlsx.load(
  workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
);

      const sheet = workbook.getWorksheet("Generated Documents") || workbook.addWorksheet("Generated Documents");
      if (sheet.rowCount === 0 || !sheet.getCell("A1").value) {
        sheet.addRow([
          "Serial No.",
          "Date",
          "Recipient",
          "Type",
          "Through",
          "Total Carats",
          "Product Source Serials",
          "Status",
          "Recorded At",
        ]);
        sheet.getRow(1).font = { bold: true };
        sheet.columns = [
          { width: 22 },
          { width: 14 },
          { width: 28 },
          { width: 14 },
          { width: 24 },
          { width: 14 },
          { width: 35 },
          { width: 14 },
          { width: 24 },
        ];
      }

      const serialAlreadyPresent = sheet
        .getColumn(1)
        .values.some((value) => String(value || "").trim() === document.serial_number);

      if (!serialAlreadyPresent) {
        const sourceSerials = input.items
          .map((item) => item.sourceSerialNumber?.trim())
          .filter((value): value is string => Boolean(value))
          .join(", ");
        const totalCarats = Number(input.items.reduce((sum, item) => sum + item.carats, 0).toFixed(2));

        sheet.addRow([
          document.serial_number,
          input.documentDate,
          input.recipientName,
          input.recipientType,
          input.through,
          totalCarats,
          sourceSerials,
          "Generated",
          new Date().toISOString(),
        ]);
      }

      const updatedBuffer = await workbook.xlsx.writeBuffer();
      const upload = await admin.storage.from("workbooks").upload(workbookPath, updatedBuffer, {
        upsert: true,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        cacheControl: "0",
      });
      if (upload.error) throw upload.error;
    } catch (cause) {
      excelSyncStatus = "failed";
      syncError = cause instanceof Error ? cause.message : "Excel write-back failed.";
    }

    const update = await admin
      .from("documents")
      .update({
        excel_sync_status: excelSyncStatus,
        excel_sync_error: syncError || null,
        excel_synced_at: excelSyncStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", document.id);
    if (update.error) throw update.error;

    return NextResponse.json({
      document: {
        ...document,
        excel_sync_status: excelSyncStatus,
        ...(syncError ? { sync_error: syncError } : {}),
      },
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json({ error: cause.issues[0]?.message || "Invalid document data." }, { status: 400 });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Document recording failed." },
      { status: 500 },
    );
  }
}
