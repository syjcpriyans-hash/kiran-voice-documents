type GeminiTextPart = {
  text: string;
};

type GeminiInlineDataPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

export type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

type GenerateJsonOptions<T> = {
  parts: GeminiPart[];
  parse: (content: string) => T;
  temperature?: number;
};

const DEFAULT_MODEL_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

const FALLBACK_HTTP_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);
const OVERALL_TIMEOUT_MS = 52_000;
const MAX_ATTEMPT_TIMEOUT_MS = 18_000;
const MIN_ATTEMPT_TIME_MS = 2_000;

class GeminiConfigurationError extends Error {}
class GeminiRequestError extends Error {}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const clean = value?.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }

  return result;
}

function getModelChain(): string[] {
  const customChain = process.env.GEMINI_MODEL_CHAIN
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueNonEmpty([
    process.env.GEMINI_MODEL,
    ...(customChain || []),
    ...DEFAULT_MODEL_CHAIN,
  ]);
}

function cleanJsonContent(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const candidates = (payload as { candidates?: unknown[] }).candidates;
  const firstCandidate = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!firstCandidate || typeof firstCandidate !== "object") return "";

  const content = (firstCandidate as { content?: unknown }).content;
  if (!content || typeof content !== "object") return "";

  const parts = (content as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function userFacingError(status: number): string {
  if (status === 400) {
    return "The AI could not process this instruction. Please check the input and try again.";
  }

  if (status === 401 || status === 403) {
    return "The AI connection is not authorized. Check the Gemini API key in Vercel.";
  }

  return "The AI request could not be completed.";
}

/**
 * Sends the same request through a private fallback chain.
 *
 * The successful model name is intentionally never returned to the client.
 * A quota, temporary service, timeout, unavailable-model, empty-output, or
 * invalid-JSON response automatically advances to the next model.
 */
export async function generateJsonWithGeminiFallback<T>({
  parts,
  parse,
  temperature = 0,
}: GenerateJsonOptions<T>): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigurationError(
      "Gemini is not configured in Vercel. Add GEMINI_API_KEY.",
    );
  }

  const modelChain = getModelChain();
  if (!modelChain.length) {
    throw new GeminiConfigurationError(
      "No Gemini models are configured for the application.",
    );
  }

  const deadline = Date.now() + OVERALL_TIMEOUT_MS;

  for (const model of modelChain) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_TIME_MS) break;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(MAX_ATTEMPT_TIMEOUT_MS, remaining),
    );

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature,
            },
          }),
        },
      );

      if (!response.ok) {
        await response.text();

        if (FALLBACK_HTTP_STATUSES.has(response.status)) {
          continue;
        }

        throw new GeminiRequestError(userFacingError(response.status));
      }

      const payload: unknown = await response.json();
      const content = extractText(payload);
      if (!content) continue;

      try {
        return parse(cleanJsonContent(content));
      } catch {
        // A model occasionally returns incomplete or malformed structured data.
        // Try the next model rather than exposing that failure to the user.
        continue;
      }
    } catch (cause) {
      if (cause instanceof GeminiRequestError || cause instanceof GeminiConfigurationError) {
        throw cause;
      }

      // Network failures and timeouts are treated as temporary model failures.
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    "The AI service is temporarily busy. Please try the same request again later.",
  );
}
