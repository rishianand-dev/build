import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { ASSETS_ROOT } from "../build/rehost-assets.js";
import { HttpError } from "./captures.js";

export { ASSETS_ROOT };

const FILENAME_RE = /^[0-9a-f]{64}\.[a-z0-9]{2,5}$/;

/** Resolves a content-addressed asset filename to its absolute path, rejecting anything that doesn't look like a hash we wrote ourselves. */
export async function resolveAssetFile(filename: string): Promise<string> {
  if (!FILENAME_RE.test(filename)) throw new HttpError(400, "Invalid asset filename");
  const abs = join(ASSETS_ROOT, filename);
  await access(abs);
  const info = await stat(abs);
  if (!info.isFile()) throw new HttpError(404, "Not a file");
  return abs;
}
