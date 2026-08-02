import { getSheetValues, quoteSheetName } from "@/lib/google-sheets";
import type { InterpretedDraft, MasterData, MasterMatch } from "@/lib/types";

type CacheEntry = {
  expiresAt: number;
  data: MasterData;
};

let cache: CacheEntry | null = null;
const CACHE_MS = 5 * 60 * 1000;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function normalizeBusinessText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\(\s*BROKER\s*\)/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeBusinessText(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarity(input: string, candidate: string): number {
  const a = normalizeBusinessText(input);
  const b = normalizeBusinessText(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const compactA = a.replaceAll(" ", "");
  const compactB = b.replaceAll(" ", "");
  if (compactA === compactB) return 0.99;

  const maxLength = Math.max(compactA.length, compactB.length);
  const editScore = maxLength ? 1 - levenshtein(compactA, compactB) / maxLength : 0;

  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const tokenScore = union ? intersection / union : 0;

  const prefixScore = compactA.startsWith(compactB) || compactB.startsWith(compactA) ? 0.92 : 0;
  return Math.max(editScore, tokenScore * 0.94, prefixScore);
}

export function findBestMasterMatch(
  input: string,
  candidates: string[],
  kind: MasterMatch["kind"],
): MasterMatch | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  const ranked = candidates
    .map((candidate) => ({ candidate, score: similarity(cleaned, candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best || best.score < 0.72) return null;

  const second = ranked[1];
  const ambiguous = Boolean(second && best.score - second.score < 0.045 && second.score > 0.75);

  return {
    kind,
    input: cleaned,
    canonical: best.candidate,
    confidence: Number(best.score.toFixed(3)),
    ambiguous,
    alternatives: ranked.slice(1, 4).filter((item) => item.score >= 0.7).map((item) => item.candidate),
  };
}

function formatDescription(shape: string, quality: string): string {
  return `[ ${shape.trim().toUpperCase()} ] [ ${quality.trim().toUpperCase()} ]`;
}

function parseDescription(description: string): { shape: string; quality: string } {
  const value = description.trim().toUpperCase();
  const bracket = value.match(/^\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]$/);
  if (bracket) return { shape: bracket[1].trim(), quality: bracket[2].trim() };

  const compact = value.replace(/[^A-Z0-9]/g, "");
  const qualityMatch = compact.match(/FL|IF|VVS[12]|VS[12]|SI[123]|I[123]/);
  if (!qualityMatch || qualityMatch.index === undefined) {
    return { shape: value, quality: "" };
  }

  const shape = compact.slice(0, qualityMatch.index);
  const qualityToken = qualityMatch[0].replace(/(VVS|VS|SI|I)([1-3])$/, "$1-$2");
  const suffix = compact.slice(qualityMatch.index + qualityMatch[0].length);
  const quality = suffix ? `${qualityToken} (${suffix})` : qualityToken;
  return { shape, quality };
}

export async function loadMasterData(force = false): Promise<MasterData> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.data;

  const [masterRows, memoRows] = await Promise.all([
    getSheetValues(`${quoteSheetName("CUT. MASTER")}!A1:J4000`, {
      valueRenderOption: "FORMATTED_VALUE",
    }),
    getSheetValues(`${quoteSheetName("MEMO")}!F1:H15000`, {
      valueRenderOption: "FORMATTED_VALUE",
    }),
  ]);

  const brokers: string[] = [];
  const parties: string[] = [];
  const operators: string[] = [];
  const shapes: string[] = [];
  const sizes: string[] = [];
  const qualities: string[] = [];
  const descriptions: string[] = [];

  for (let index = 1; index < masterRows.length; index += 1) {
    const row = masterRows[index] || [];
    const broker = text(row[2]);
    const party = text(row[5]);
    const operator = text(row[8]);

    if (broker && broker !== "*") brokers.push(broker);
    if (party && party !== "*") parties.push(party);
    if (operator && operator !== "*" && normalizeBusinessText(operator) !== "NAME") operators.push(operator);
  }

  for (let index = 1; index < memoRows.length; index += 1) {
    const row = memoRows[index] || [];
    const shape = text(row[0]);
    const size = text(row[1]);
    const quality = text(row[2]);

    if (shape && shape !== "*") shapes.push(shape.toUpperCase());
    if (size && size !== "*") sizes.push(size);
    if (quality && quality !== "*") qualities.push(quality.toUpperCase());
    if (shape && shape !== "*" && quality && quality !== "*") {
      descriptions.push(formatDescription(shape, quality));
    }
  }

  const data: MasterData = {
    brokers: unique(brokers),
    parties: unique(parties),
    operators: unique(operators),
    shapes: unique(shapes),
    sizes: unique(sizes),
    qualities: unique(qualities),
    descriptions: unique(descriptions),
    loadedAt: new Date().toISOString(),
  };

  cache = { data, expiresAt: Date.now() + CACHE_MS };
  return data;
}

export async function resolveInterpretedDraft(
  draft: InterpretedDraft,
): Promise<{ draft: InterpretedDraft; warnings: string[]; matches: MasterMatch[] }> {
  const master = await loadMasterData();
  const warnings: string[] = [];
  const matches: MasterMatch[] = [];

  const recipientCandidates = draft.recipientType === "Broker"
    ? master.brokers
    : [...master.parties, ...master.brokers];
  const recipientMatch = findBestMasterMatch(draft.recipientName, recipientCandidates, "recipient");
  let recipientName = draft.recipientName.trim();

  if (recipientMatch) {
    matches.push(recipientMatch);
    if (recipientMatch.confidence >= 0.9 && !recipientMatch.ambiguous) {
      recipientName = recipientMatch.canonical;
    } else {
      warnings.push(
        `Recipient name “${draft.recipientName}” may match “${recipientMatch.canonical}”. Please confirm the spelling.`,
      );
    }
  } else {
    warnings.push(`Recipient name “${draft.recipientName}” was not found in CUT. MASTER. It may be a new name.`);
  }

  let through = draft.through.trim();
  if (through) {
    const throughMatch = findBestMasterMatch(through, master.brokers, "through");
    if (throughMatch) {
      matches.push(throughMatch);
      if (throughMatch.confidence >= 0.9 && !throughMatch.ambiguous) {
        through = throughMatch.canonical;
      } else {
        warnings.push(`Through/broker “${through}” may match “${throughMatch.canonical}”. Please confirm.`);
      }
    } else {
      warnings.push(`Through/broker “${through}” was not found in CUT. MASTER.`);
    }
  }

  const items = draft.items.map((item, index) => {
    const parsed = parseDescription(item.descriptionQuery);
    const shapeMatch = findBestMasterMatch(parsed.shape, master.shapes, "shape");
    const sizeMatch = findBestMasterMatch(item.size, master.sizes, "size");
    const qualityMatch = parsed.quality
      ? findBestMasterMatch(parsed.quality, master.qualities, "quality")
      : null;

    if (shapeMatch) matches.push(shapeMatch);
    if (sizeMatch) matches.push(sizeMatch);
    if (qualityMatch) matches.push(qualityMatch);

    const shape = shapeMatch && shapeMatch.confidence >= 0.88 && !shapeMatch.ambiguous
      ? shapeMatch.canonical
      : parsed.shape;
    const size = sizeMatch && sizeMatch.confidence >= 0.88 && !sizeMatch.ambiguous
      ? sizeMatch.canonical
      : item.size;
    const quality = qualityMatch && qualityMatch.confidence >= 0.86 && !qualityMatch.ambiguous
      ? qualityMatch.canonical
      : parsed.quality;

    if (!shapeMatch) warnings.push(`Row ${index + 1}: shape “${parsed.shape}” was not found in MEMO terminology.`);
    if (!sizeMatch) warnings.push(`Row ${index + 1}: size “${item.size}” was not found in MEMO terminology.`);
    if (parsed.quality && !qualityMatch) warnings.push(`Row ${index + 1}: quality “${parsed.quality}” was not found in MEMO terminology.`);
    if (!item.askingPrice) warnings.push(`Row ${index + 1}: asking price is missing or unclear.`);

    return {
      ...item,
      size,
      descriptionQuery: quality ? formatDescription(shape, quality) : item.descriptionQuery.toUpperCase(),
    };
  });

  return {
    draft: { ...draft, recipientName, through, items },
    warnings: [...new Set(warnings)],
    matches,
  };
}
