import { z } from "zod";
import type { InterpretedDraft } from "@/lib/types";

export const interpretedDraftSchema = z.object({
  recipientName: z.string().min(1),
  recipientType: z.enum(["Broker", "Customer", "Other"]).default("Other"),
  through: z.string().default(""),
  date: z.string().optional(),
  items: z
    .array(
      z.object({
        size: z.string().min(1),
        descriptionQuery: z.string().min(1),
        carats: z.number().nonnegative(),
        askingPrice: z.number().nonnegative().optional(),
        remarks: z.string().optional(),
      }),
    )
    .max(8)
    .default([]),
});

export function parseDemoTranscript(transcript: string): InterpretedDraft {
  const clean = transcript.trim();
  const nameMatch = clean.match(
    /(?:for|mate|માટે|के लिए)\s+([\p{L}][\p{L}\p{M} .'-]{2,}?)(?=\s+(?:broker|customer|બ્રોકર|ગ્રાહક|ब्रोकर|ग्राहक)|[,.]|$)/iu,
  );
  const recipientType = /broker|બ્રોકર|ब्रोकर/iu.test(clean)
    ? "Broker"
    : /customer|ગ્રાહક|ग्राहक/iu.test(clean)
      ? "Customer"
      : "Other";

  return {
    recipientName: nameMatch?.[1]?.trim() || "Name pending confirmation",
    recipientType,
    through: "",
    items: [],
  };
}
