import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const secret = process.env.GOOGLE_CONNECTION_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 24) {
    throw new Error(
      "Self-service Google connection is not configured. Add GOOGLE_CONNECTION_ENCRYPTION_KEY in Vercel.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealJson<T>(value: string | undefined | null): T | null {
  if (!value) return null;

  try {
    const payload = Buffer.from(value, "base64url");
    if (payload.length < 29) return null;

    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");

    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

export const secureCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
