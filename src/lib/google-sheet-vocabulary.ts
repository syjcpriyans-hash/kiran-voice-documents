import { getSheetValues, quoteSheetName } from "@/lib/google-sheets";

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function loadGoogleSheetVocabulary(): Promise<string> {
  try {
    const [memoRows, masterRows] = await Promise.all([
      getSheetValues(`${quoteSheetName("MEMO")}!F1:H5000`, {
        valueRenderOption: "FORMATTED_VALUE",
      }),
      getSheetValues(`${quoteSheetName("CUT. MASTER")}!A1:Z600`, {
        valueRenderOption: "FORMATTED_VALUE",
      }),
    ]);

    const productTerms = new Set<string>();

    for (const row of memoRows) {
      const shape = cleanCell(row[0]).toUpperCase();
      const size = cleanCell(row[1]);
      const quality = cleanCell(row[2]).toUpperCase();

      if (shape && size && quality) {
        productTerms.add(`${shape} | ${size} | ${quality}`);
      }

      if (productTerms.size >= 300) break;
    }

    const referenceRows: string[][] = [];
    for (const row of masterRows) {
      const values = row
        .map(cleanCell)
        .filter(Boolean)
        .slice(0, 12);

      if (values.length) referenceRows.push(values);
      if (referenceRows.length >= 250) break;
    }

    return JSON.stringify({
      productVocabulary: [...productTerms],
      masterReferenceRows: referenceRows,
      instruction:
        "Historical vocabulary only. Never infer an asking price from these rows. A price must come from the current spoken or typed instruction.",
    }).slice(0, 60_000);
  } catch {
    return JSON.stringify({
      productVocabulary: [],
      masterReferenceRows: [],
      instruction:
        "Google Sheet vocabulary could not be loaded. Never invent an asking price or missing product detail.",
    });
  }
}
