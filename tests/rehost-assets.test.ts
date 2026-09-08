import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSETS_ROOT, rehostOne, rehostThemeAssets } from "../src/build/rehost-assets.js";
import { emptyTheme } from "../src/schema/theme.js";

const written: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(written.splice(0).map((f) => rm(f, { force: true })));
});

function trackHash(buf: Buffer, ext: string): string {
  const hash = createHash("sha256").update(buf).digest("hex");
  const path = join(ASSETS_ROOT, `${hash}.${ext}`);
  written.push(path);
  return hash;
}

describe("rehostOne", () => {
  it("downloads, hashes, and rewrites a remote image URL", async () => {
    const bytes = Buffer.from("fake-jpeg-bytes");
    const hash = trackHash(bytes, "jpg");
    const fetchMock = vi.fn(async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await rehostOne("https://cdn.example.com/logo.jpg");
    expect(url).toBe(`/api/assets/${hash}.jpg`);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/logo.jpg");
  });

  it("falls back to the URL's extension when content-type is missing", async () => {
    const bytes = Buffer.from("fake-png-bytes");
    const hash = trackHash(bytes, "png");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );

    const url = await rehostOne("https://cdn.example.com/pics/hero.png?x=1");
    expect(url).toBe(`/api/assets/${hash}.png`);
  });

  it("leaves non-http(s) URLs untouched and never calls fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await rehostOne("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(await rehostOne("/already/local.png")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-ok response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await rehostOne("https://cdn.example.com/missing.jpg")).toBeNull();
  });

  it("returns null when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await rehostOne("https://cdn.example.com/flaky.jpg")).toBeNull();
  });
});

describe("rehostThemeAssets", () => {
  it("rewrites every asset URL it can, leaving failures hotlinked", async () => {
    const okBytes = Buffer.from("ok-bytes");
    const okHash = trackHash(okBytes, "jpg");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("ok.jpg")) {
          return new Response(okBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
        }
        return new Response(null, { status: 500 });
      }),
    );

    const theme = emptyTheme({
      assets: {
        a1: { url: "https://cdn.example.com/ok.jpg", kind: "image" },
        a2: { url: "https://cdn.example.com/broken.jpg", kind: "image" },
      },
    });

    const result = await rehostThemeAssets(theme);
    expect(result.assets.a1!.url).toBe(`/api/assets/${okHash}.jpg`);
    expect(result.assets.a2!.url).toBe("https://cdn.example.com/broken.jpg");
  });

  it("is a no-op when theme.assets is missing (as compactTheme's prune() can leave it)", async () => {
    const theme = emptyTheme();
    // @ts-expect-error simulating prune() stripping an empty assets object
    delete theme.assets;
    await expect(rehostThemeAssets(theme)).resolves.toBe(theme);
  });
});
