import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nameSectionsWithVlm } from "../src/eval/vlm-baseline.js";
import type { GoldenCase } from "../src/eval/golden-set.js";
import type { PageCapture } from "../src/types/page-capture.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ollamaResponse(payload: unknown): Response {
  return new Response(JSON.stringify({ response: JSON.stringify(payload) }), { status: 200 });
}

function minimalCapture(): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 2000 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "screenshots/full-page.png", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
    assets: [],
    theme_hints: { background_color: "", text_color: "", fonts: [], color_palette: [], css_variables: {} },
    header_behavior: {
      sticky_or_fixed: false,
      lock_height_enable: false,
      always_fixed_on_scroll: false,
      reappear_on_scroll_up: false,
      document_flow: true,
      confidence: 0,
      evidence: [],
      probe: null,
    },
    hover_reveals: [],
    candidate_blocks: [],
    warnings: [],
    dom: null,
  };
}

describe("nameSectionsWithVlm", () => {
  it("returns the model's role sequence, filtered to the canonical section set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vlm-baseline-"));
    try {
      const shotDir = join(dir, "screenshots");
      await mkdir(shotDir, { recursive: true });
      await writeFile(join(shotDir, "full-page.png"), "fake-bytes");

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ollamaResponse({ sections: ["header", "hero", "not-a-real-role", "footer"] })),
      );

      const goldenCase: GoldenCase = { site: "example.test", capture: minimalCapture(), expected: [], dir };
      const result = await nameSectionsWithVlm(goldenCase, [goldenCase]);
      expect(result).toEqual(["header", "hero", "footer"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty array when there's no capture dir or screenshot", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const goldenCase: GoldenCase = { site: "example.test", capture: minimalCapture(), expected: [] };
    expect(await nameSectionsWithVlm(goldenCase, [goldenCase])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array when the model is unreachable, rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vlm-baseline-"));
    try {
      const shotDir = join(dir, "screenshots");
      await mkdir(shotDir, { recursive: true });
      await writeFile(join(shotDir, "full-page.png"), "fake-bytes");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      );
      const goldenCase: GoldenCase = { site: "example.test", capture: minimalCapture(), expected: [], dir };
      expect(await nameSectionsWithVlm(goldenCase, [goldenCase])).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
