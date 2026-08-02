import { loadMasterData } from "@/lib/master-data";

export async function loadGoogleSheetVocabulary(): Promise<string> {
  try {
    const master = await loadMasterData();
    return JSON.stringify({
      brokers: master.brokers.slice(0, 350),
      parties: master.parties.slice(0, 900),
      shapes: master.shapes,
      sizes: master.sizes,
      qualities: master.qualities.slice(0, 500),
      operators: master.operators,
      instruction:
        "Use these lists only to correct spelling and terminology. Never infer an asking price from historical data. New names are allowed but must be flagged for confirmation.",
    }).slice(0, 60_000);
  } catch {
    return JSON.stringify({
      brokers: [],
      parties: [],
      shapes: [],
      sizes: [],
      qualities: [],
      operators: [],
      instruction: "Master data could not be loaded. Never invent missing details.",
    });
  }
}
