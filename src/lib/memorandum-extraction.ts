import { z } from "zod";
import type { InterpretedDraft, InterpretedItem, RecipientType } from "@/lib/types";

const flexibleNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return value;

  const cleaned = value.replace(/[₹,$\s]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().nonnegative().nullable());

const optionalText = z.preprocess(
  (value) => (value === null || value === undefined ? "" : value),
  z.string(),
);

const itemFieldSchema = z.enum([
  "shape",
  "size",
  "quality",
  "colour",
  "carats",
  "askingPrice",
  "remarks",
]);

const uncertainFieldSchema = itemFieldSchema;

const inheritedFieldSchema = z.enum([
  "shape",
  "size",
  "quality",
  "colour",
  "carats",
  "askingPrice",
  "remarks",
  "description",
  "all",
]);

const extractedItemSchema = z.object({
  itemNumber: z.number().int().positive().optional(),
  shape: optionalText,
  size: optionalText,
  quality: optionalText,
  colour: optionalText,
  color: optionalText.optional(),
  descriptionQuery: optionalText.optional(),
  carats: flexibleNumber,
  askingPrice: flexibleNumber,
  remarks: optionalText,
  uncertainFields: z.array(uncertainFieldSchema).default([]),
  sameAsPrevious: z.array(inheritedFieldSchema).default([]),
});

const createActionSchema = z.object({
  action: z.literal("create_memorandum"),
  transcript: z.string().optional(),
  recipientName: optionalText,
  recipientType: z.enum(["Broker", "Customer", "Other"]).default("Other"),
  through: optionalText,
  date: optionalText.optional(),
  items: z.array(extractedItemSchema).min(1).max(20),
  warnings: z.array(z.string()).default([]),
});

const returnActionSchema = z.object({
  action: z.literal("mark_returned"),
  transcript: z.string().optional(),
  reference: optionalText,
  returnDate: optionalText.optional(),
  confirmPerson: optionalText,
  warnings: z.array(z.string()).default([]),
});

export const assistantExtractionSchema = z.discriminatedUnion("action", [
  createActionSchema,
  returnActionSchema,
]);

export type AssistantExtraction = z.infer<typeof assistantExtractionSchema>;
export type CreateMemorandumExtraction = z.infer<typeof createActionSchema>;

const NUMBER_WORDS: Record<string, string> = {
  ZERO: "0",
  ONE: "1",
  EK: "1",
  EAK: "1",
  TWO: "2",
  DO: "2",
  THREE: "3",
  TEEN: "3",
  FOUR: "4",
  CHAR: "4",
  CHAAR: "4",
  FIVE: "5",
  PACH: "5",
  PAANCH: "5",
  SIX: "6",
  CHHE: "6",
  CHE: "6",
  SEVEN: "7",
  SAAT: "7",
  EIGHT: "8",
  AATH: "8",
  NINE: "9",
  NAU: "9",
  TEN: "10",
  DAS: "10",
};

function cleanText(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeRecipientName(
  value: string | null | undefined,
  recipientType: RecipientType,
): string {
  let name = cleanText(value);
  if (!name || recipientType === "Other") return name;

  const escapedType = recipientType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  name = name
    .replace(new RegExp(`\\s*\\(${escapedType}\\)\\s*$`, "i"), "")
    .replace(new RegExp(`\\s*[-–—,:]\\s*${escapedType}\\s*$`, "i"), "")
    .trim();

  return name;
}

function compactCode(value: string): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/\bONE\b/g, "1")
    .replace(/\bTWO\b/g, "2")
    .replace(/\bTHREE\b/g, "3")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeShape(value: string): string {
  const compact = compactCode(value);
  return compact || cleanText(value).toUpperCase();
}

function normalizeQuality(value: string): string {
  const compact = compactCode(value);
  const match = compact.match(/^(FL|IF|VVS[12]|VS[12]|SI[123]|I[123])$/);
  if (!match) return cleanText(value).toUpperCase();
  return match[1].replace(/(VVS|VS|SI|I)([1-3])$/, "$1-$2");
}

function normalizeColour(value: string): string {
  return compactCode(value);
}

function normalizeSize(value: string): string {
  const input = cleanText(value).toUpperCase();
  if (!input) return "";

  const unicodeFractions: Record<string, string> = {
    "¼": "1/4",
    "⅕": "1/5",
    "⅙": "1/6",
    "⅒": "1/10",
    "½": "1/2",
    "⅓": "1/3",
    "⅜": "3/8",
    "¾": "3/4",
  };
  if (unicodeFractions[input]) return unicodeFractions[input];

  const slash = input.match(/^(\d+)\s*[/\\]\s*(\d+)$/);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}`;

  const words = input
    .replace(/\b(BY|BATA|BATTA|OVER)\b/g, "/")
    .replace(/[^A-Z0-9/]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => NUMBER_WORDS[token] || token)
    .join(" ");

  const wordFraction = words.match(/^(\d+)\s*\/?\s*(\d+)$/);
  if (wordFraction) return `${Number(wordFraction[1])}/${Number(wordFraction[2])}`;

  const embeddedFraction = words.match(/(\d+)\s*\/\s*(\d+)/);
  if (embeddedFraction) return `${Number(embeddedFraction[1])}/${Number(embeddedFraction[2])}`;

  return input.replace(/\s+/g, "");
}

function parseCombinedDescription(value: string): { shape: string; quality: string; colour: string } {
  const input = cleanText(value).toUpperCase();
  if (!input) return { shape: "", quality: "", colour: "" };

  const bracket = input.match(/^\[\s*([^\]]*)\s*\]\s*\[\s*([^\]]*)\s*\]$/);
  if (bracket) {
    const second = bracket[2].trim();
    const qualityColour = second.match(/^(.+?)\s*\(([^)]+)\)$/);
    return {
      shape: bracket[1].trim(),
      quality: qualityColour ? qualityColour[1].trim() : second,
      colour: qualityColour ? qualityColour[2].trim() : "",
    };
  }

  const compact = input.replace(/[^A-Z0-9]/g, "");
  const qualityMatch = compact.match(/FL|IF|VVS[12]|VS[12]|SI[123]|I[123]/);
  if (!qualityMatch || qualityMatch.index === undefined) {
    return { shape: input, quality: "", colour: "" };
  }

  return {
    shape: compact.slice(0, qualityMatch.index),
    quality: qualityMatch[0],
    colour: compact.slice(qualityMatch.index + qualityMatch[0].length),
  };
}

function formatDescription(shape: string, quality: string, colour: string): string {
  const left = normalizeShape(shape);
  const clarity = normalizeQuality(quality);
  const colourCode = normalizeColour(colour);

  if (!left && !clarity && !colourCode) return "";
  if (!left) return colourCode ? `[ ] [ ${clarity} (${colourCode}) ]` : `[ ] [ ${clarity} ]`;
  if (!clarity) return colourCode ? `[ ${left} ] [ (${colourCode}) ]` : `[ ${left} ] [ ]`;
  return colourCode
    ? `[ ${left} ] [ ${clarity} (${colourCode}) ]`
    : `[ ${left} ] [ ${clarity} ]`;
}

function fieldLabel(field: string): string {
  if (field === "askingPrice") return "asking price";
  return field;
}

export function normalizeCreateMemorandumExtraction(
  extraction: CreateMemorandumExtraction,
): { draft: InterpretedDraft; warnings: string[] } {
  const warnings = [...extraction.warnings];
  const sourceItems = extraction.items.slice(0, 8);

  if (extraction.items.length > 8) {
    warnings.push(
      `The instruction contained ${extraction.items.length} product items, but the memorandum supports a maximum of eight. Only the first eight were prepared.`,
    );
  }

  type NormalizedFields = {
    shape: string;
    size: string;
    quality: string;
    colour: string;
    carats: number | null;
    askingPrice: number | null;
    remarks: string;
  };

  const normalizedRows: NormalizedFields[] = [];
  const items: InterpretedItem[] = [];

  sourceItems.forEach((item, index) => {
    const row = index + 1;
    const previous = normalizedRows[index - 1];
    const combined = parseCombinedDescription(item.descriptionQuery || "");

    const raw: NormalizedFields = {
      shape: cleanText(item.shape) || combined.shape,
      size: cleanText(item.size),
      quality: cleanText(item.quality) || combined.quality,
      colour: cleanText(item.colour || item.color) || combined.colour,
      carats: item.carats,
      askingPrice: item.askingPrice,
      remarks: cleanText(item.remarks),
    };

    for (const inheritedField of item.sameAsPrevious) {
      if (!previous) {
        warnings.push(
          `Row ${row}: “same ${fieldLabel(inheritedField)}” was stated, but there is no previous item to copy.`,
        );
        continue;
      }

      if ((inheritedField === "shape" || inheritedField === "description" || inheritedField === "all") && !raw.shape) raw.shape = previous.shape;
      if ((inheritedField === "size" || inheritedField === "all") && !raw.size) raw.size = previous.size;
      if ((inheritedField === "quality" || inheritedField === "description" || inheritedField === "all") && !raw.quality) raw.quality = previous.quality;
      if ((inheritedField === "colour" || inheritedField === "description" || inheritedField === "all") && !raw.colour) raw.colour = previous.colour;
      if ((inheritedField === "carats" || inheritedField === "all") && raw.carats === null) raw.carats = previous.carats;
      if ((inheritedField === "askingPrice" || inheritedField === "all") && raw.askingPrice === null) raw.askingPrice = previous.askingPrice;
      if ((inheritedField === "remarks" || inheritedField === "all") && !raw.remarks) raw.remarks = previous.remarks;
    }

    const normalized: NormalizedFields = {
      shape: normalizeShape(raw.shape),
      size: normalizeSize(raw.size),
      quality: normalizeQuality(raw.quality),
      colour: normalizeColour(raw.colour),
      carats: raw.carats,
      askingPrice: raw.askingPrice,
      remarks: raw.remarks,
    };
    normalizedRows.push(normalized);

    if (!normalized.shape) warnings.push(`Row ${row}: shape is missing or unclear.`);
    if (!normalized.size) warnings.push(`Row ${row}: size is missing or unclear.`);
    if (!normalized.quality) warnings.push(`Row ${row}: quality is missing or unclear.`);
    if (!normalized.colour) warnings.push(`Row ${row}: colour is missing or unclear.`);
    if (!normalized.carats || normalized.carats <= 0) warnings.push(`Row ${row}: carats are missing or unclear.`);
    if (!normalized.askingPrice || normalized.askingPrice <= 0) warnings.push(`Row ${row}: asking price is missing or unclear.`);

    for (const uncertainField of item.uncertainFields) {
      warnings.push(`Row ${row}: ${fieldLabel(uncertainField)} should be confirmed.`);
    }

    items.push({
      size: normalized.size,
      descriptionQuery: formatDescription(
        normalized.shape,
        normalized.quality,
        normalized.colour,
      ),
      carats: normalized.carats ?? 0,
      askingPrice: normalized.askingPrice ?? undefined,
      remarks: normalized.remarks,
    });
  });

  const recipientType = extraction.recipientType as RecipientType;
  const recipientName = normalizeRecipientName(extraction.recipientName, recipientType);

  if (!recipientName) {
    warnings.push("Recipient name is missing or unclear.");
  }

  return {
    draft: {
      recipientName,
      recipientType,
      through: cleanText(extraction.through),
      date: cleanText(extraction.date),
      items,
    },
    warnings: [...new Set(warnings)],
  };
}

export function buildAssistantExtractionPrompt(options: {
  today: string;
  vocabulary: string;
  operators: string[];
  languageHint?: string;
  includeTranscript: boolean;
  instruction?: string;
}): string {
  const transcriptRequirement = options.includeTranscript
    ? '- Include a complete transcript in the "transcript" field.'
    : "";

  return [
    "You are a high-accuracy multilingual intent-classification and structured-data extraction engine for diamond memorandums.",
    "The input may be Gujarati, Hindi, Indian English, or mixed language.",
    options.languageHint
      ? `The selected language is ${options.languageHint}. Treat this only as a hint.`
      : "",
    transcriptRequirement,
    "Decide whether the user wants to create a new memorandum or mark an existing memorandum as returned.",
    "",
    "CRITICAL RULE FOR MEMORANDUM CREATION:",
    "- The speaker may say fields in ANY order. Never assign values by sentence position.",
    "- Independently identify shape, size, quality, colour, carats, asking price, and remarks for every product item.",
    "- Group each value with the correct product item, even when price is spoken first, carats are spoken last, or fields are interleaved.",
    "- Preserve the order of product items, not the order of fields inside an item.",
    "- Item separators may include: first item, second item, next item, add another, then add, after that, pehli item, dusri item, pahelu, biju, or a clear pause followed by a new product bundle.",
    "- A repeated shape, size, or quality bundle may begin a new item even when the speaker does not say item numbers.",
    "- Never move a number from one product item to another.",
    "- Use context labels, units, and realistic number form to classify values: a fraction is size, a decimal followed by carats is carats, and a currency or large amount after price or asking is asking price.",
    "- Do not use magnitude alone when the wording identifies the field.",
    "- Apply a previous value only when the speaker explicitly says same price, same quality, same description, same as above, baki same, or an equivalent phrase.",
    "- Put each explicitly inherited field in sameAsPrevious. Example: same price means askingPrice; same description means description; the whole item is the same means all.",
    "- The word same applies only to the field explicitly named. Never copy all fields unless the speaker clearly says the whole item is the same.",
    "- Never infer missing values from Google Sheets, historical memorandums, or neighbouring items.",
    "- If a field is ambiguous, leave it empty or null, add it to uncertainFields, and add a warning. Do not guess.",
    "- Normalize size to a fraction such as 1/4 or 1/10.",
    "- Return shape, quality, and colour as separate fields. Do not combine them in description text.",
    "- recipientName must contain only the recipient's name. Never append Broker, Customer, Other, or any recipient-type label to recipientName; put that classification only in recipientType.",
    "- Examples: P E becomes PE; V V S one becomes VVS-1; one by four becomes 1/4; thirty-seven point three seven becomes 37.37.",
    "- Return no more than eight usable items. Still identify extra items so the application can warn the user.",
    "",
    "FOR RETURNED GOODS:",
    "- Use action mark_returned.",
    "- Extract the complete memorandum reference, return date, and confirmation-person name.",
    `- Today in India is ${options.today}. When the user says today, use this date.`,
    "- Preserve slashes, letters, and digits in official memorandum references.",
    "",
    "Return one JSON object only.",
    "For creation use:",
    '{"action":"create_memorandum","transcript":"optional complete transcript","recipientName":"string or empty","recipientType":"Broker|Customer|Other","through":"string or empty","date":"YYYY-MM-DD optional","items":[{"itemNumber":1,"shape":"string or empty","size":"string or empty","quality":"string or empty","colour":"string or empty","carats":number or null,"askingPrice":number or null,"remarks":"string or empty","uncertainFields":["shape|size|quality|colour|carats|askingPrice|remarks"],"sameAsPrevious":["shape|size|quality|colour|carats|askingPrice|remarks|description|all"]}],"warnings":["string"]}',
    "For returned goods use:",
    '{"action":"mark_returned","transcript":"optional complete transcript","reference":"string or empty","returnDate":"YYYY-MM-DD optional","confirmPerson":"string or empty","warnings":["string"]}',
    "",
    `CURRENT GOOGLE SHEETS VOCABULARY: ${options.vocabulary}`,
    `KNOWN CONFIRMATION-PERSON NAMES: ${JSON.stringify(options.operators)}`,
    options.instruction
      ? `USER INSTRUCTION: ${JSON.stringify(options.instruction)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
