import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSETS_ROOT, resolveAssetFile } from "../src/server/assets.js";
import { HttpError } from "../src/server/captures.js";

const HASH = "a".repeat(64);
const written: string[] = [];

afterEach(async () => {
  await Promise.all(written.splice(0).map((f) => rm(f, { force: true })));
});

describe("resolveAssetFile", () => {
  it("resolves a real content-addressed file", async () => {
    await mkdir(ASSETS_ROOT, { recursive: true });
    const path = join(ASSETS_ROOT, `${HASH}.jpg`);
    await writeFile(path, "content");
    written.push(path);

    expect(await resolveAssetFile(`${HASH}.jpg`)).toBe(path);
  });

  it("rejects filenames that don't look like a sha256 hash + extension", async () => {
    await expect(resolveAssetFile("../../etc/passwd")).rejects.toBeInstanceOf(HttpError);
    await expect(resolveAssetFile("not-a-hash.jpg")).rejects.toBeInstanceOf(HttpError);
    await expect(resolveAssetFile(`${HASH}`)).rejects.toBeInstanceOf(HttpError);
    await expect(resolveAssetFile(`${HASH}.exe.jpg`)).rejects.toBeInstanceOf(HttpError);
  });

  it("throws for a well-formed filename that doesn't exist on disk", async () => {
    await expect(resolveAssetFile(`${"b".repeat(64)}.png`)).rejects.toThrow();
  });
});
