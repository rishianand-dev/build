import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistBuildFromFigma } from "../src/build/persist.js";
import type { ThemeDoc } from "../src/schema/theme.js";
import type { PageCapture } from "../src/types/page-capture.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFigmaFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/files/abc123/nodes")) {
        return jsonResponse({
          name: "Landing",
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                name: "Frame",
                type: "FRAME",
                layoutMode: "VERTICAL",
                children: [
                  { id: "1:2", name: "Heading", type: "TEXT", characters: "Welcome to the shop", style: { fontSize: 32 } },
                ],
              },
            },
          },
        });
      }
      if (url.includes("/files/abc123/images")) {
        return jsonResponse({ meta: { images: {} } });
      }
      if (url.includes("/images/abc123?ids=")) {
        return jsonResponse({ err: null, images: { "1:1": "https://figma-s3.example/render.png" } });
      }
      if (url === "https://figma-s3.example/render.png") {
        return new Response(Buffer.from("fake-png-bytes"), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("persistBuildFromFigma", () => {
  it("builds a theme, capture.json, and site.html from a mocked Figma file", async () => {
    stubFigmaFetch();
    const outDir = await mkdtemp(join(tmpdir(), "figma-persist-"));
    try {
      const { theme, capture } = await persistBuildFromFigma(outDir, {
        fileKey: "abc123",
        nodeId: "1:1",
        token: "test-token",
      });

      expect(theme.pages[0]!.root).toBeTruthy();
      const onDiskTheme = JSON.parse(await readFile(join(outDir, "theme.json"), "utf8")) as ThemeDoc;
      expect(onDiskTheme).toEqual(theme);

      const onDiskCapture = JSON.parse(await readFile(join(outDir, "capture.json"), "utf8")) as PageCapture;
      expect(onDiskCapture.dom).toBeNull();
      expect(onDiskCapture.screenshots.viewport_top).toBe("screenshots/viewport-top.png");
      // Falls back to the fetched frame node's own name ("Frame") since no
      // `title` override was passed — the file's top-level name ("Landing")
      // is a different thing (`fetchFigmaImportInput` only fetches the one
      // node subtree, not the whole file).
      expect(capture.title).toBe("Frame");
      expect(capture.url).toContain("figma.com/design/abc123");

      const shot = await readFile(join(outDir, "screenshots/viewport-top.png"));
      expect(shot.toString()).toBe("fake-png-bytes");

      const html = await readFile(join(outDir, "site.html"), "utf8");
      expect(html).toContain("Welcome to the shop");

      // Vision fallback shouldn't run for a Figma import — it always has
      // real structure to map, so nothing gets registered for it.
      expect(theme.review.some((r) => r.reason.startsWith("vision:"))).toBe(false);
      expect(theme.review).toContainEqual(
        expect.objectContaining({ reason: expect.stringMatching(/scroll\/hover behavior/) }),
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
