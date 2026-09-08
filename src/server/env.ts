import { config } from "dotenv";
import { resolve } from "node:path";

for (const path of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  config({ path, quiet: true });
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() || undefined;
}

export function databaseUrl(): string {
  const url = readEnv("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export function sessionSecret(): string {
  const secret = readEnv("SESSION_SECRET");
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters");
  }
  return secret;
}

/** Figma personal access token, for the Figma import path. Optional — that
 * path is opt-in, so this returns undefined rather than throwing; callers
 * that need it (the Figma job route) surface a clear error themselves. */
export function figmaToken(): string | undefined {
  return readEnv("FIGMA_TOKEN");
}
