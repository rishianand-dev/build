import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVisionFallback,
  classifyRegion,
  getVisionCandidates,
  setVisionCandidates,
} from "../src/build/from-vision.js";
import { emptyTheme, type ThemeDoc } from "../src/schema/theme.js";
import type { PageCapture } from "../src/types/page-capture.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpScreenshotDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vision-test-"));
  cleanupDirs.push(dir);
  return dir;
}

function ollamaResponse(payload: unknown): Response {
  return new Response(JSON.stringify({ response: JSON.stringify(payload) }), { status: 200 });
}

function minimalCapture(overrides: Partial<PageCapture["screenshots"]> = {}): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 2000 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [], ...overrides },
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

describe("classifyRegion", () => {
  it("returns a typed result when Ollama returns a valid role", async () => {
    const dir = await tmpScreenshotDir();
    const shot = join(dir, "shot.png");
    await writeFile(shot, "fake-png-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ollamaResponse({ role: "newsletter", confidence: 0.8, reason: "email signup form" })),
    );

    expect(await classifyRegion({ screenshotAbsPath: shot })).toEqual({
      role: "newsletter",
      confidence: 0.8,
      reason: "email signup form",
    });
  });

  it("returns null when the model returns a role outside the canonical set", async () => {
    const dir = await tmpScreenshotDir();
    const shot = join(dir, "shot.png");
    await writeFile(shot, "fake");
    vi.stubGlobal("fetch", vi.fn(async () => ollamaResponse({ role: "not-a-role", confidence: 0.9, reason: "x" })));
    expect(await classifyRegion({ screenshotAbsPath: shot })).toBeNull();
  });

  it("returns null when the screenshot file doesn't exist", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(await classifyRegion({ screenshotAbsPath: "/nonexistent/dir/shot.png" })).toBeNull();
  });

  it("returns null when Ollama is unreachable", async () => {
    const dir = await tmpScreenshotDir();
    const shot = join(dir, "shot.png");
    await writeFile(shot, "fake");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await classifyRegion({ screenshotAbsPath: shot })).toBeNull();
  });

  it("clamps an out-of-range confidence into [0,1]", async () => {
    const dir = await tmpScreenshotDir();
    const shot = join(dir, "shot.png");
    await writeFile(shot, "fake");
    vi.stubGlobal("fetch", vi.fn(async () => ollamaResponse({ role: "hero", confidence: 5, reason: "x" })));
    expect((await classifyRegion({ screenshotAbsPath: shot }))?.confidence).toBe(1);
  });
});

describe("vision candidate side channel", () => {
  it("returns an empty list for a theme nothing was registered against", () => {
    expect(getVisionCandidates(emptyTheme())).toEqual([]);
  });

  it("round-trips candidates set on a theme object", () => {
    const theme = emptyTheme();
    setVisionCandidates(theme, [{ path: "/pages/0/root", reason: "test" }]);
    expect(getVisionCandidates(theme)).toEqual([{ path: "/pages/0/root", reason: "test" }]);
  });
});

describe("applyVisionFallback", () => {
  function themeWithHeroRoot(): ThemeDoc {
    return emptyTheme({
      pages: [{ id: "home", path: "/", root: { type: "stack", role: "hero", children: [] } }],
    });
  }

  it("upgrades a candidate node's role and records a ReviewItem when classification succeeds", async () => {
    const dir = await tmpScreenshotDir();
    await mkdir(join(dir, "screenshots"), { recursive: true });
    await writeFile(join(dir, "screenshots", "viewport-top.png"), "fake-bytes");

    const theme = themeWithHeroRoot();
    setVisionCandidates(theme, [
      { path: "/pages/0/root", box: { x: 0, y: 0, width: 100, height: 100 }, reason: "screenshot fallback" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ollamaResponse({ role: "newsletter", confidence: 0.7, reason: "looks like a signup form" })),
    );

    const capture = minimalCapture({ viewport_top: "screenshots/viewport-top.png" });
    const result = await applyVisionFallback(theme, capture, dir);

    expect(result.pages[0]!.root.role).toBe("newsletter");
    expect(result.review).toContainEqual({
      path: "/pages/0/root",
      reason: "vision: looks like a signup form",
      confidence: 0.7,
    });
  });

  it("leaves the node's role untouched when the model is unreachable", async () => {
    const dir = await tmpScreenshotDir();
    await mkdir(join(dir, "screenshots"), { recursive: true });
    await writeFile(join(dir, "screenshots", "viewport-top.png"), "fake-bytes");

    const theme = themeWithHeroRoot();
    setVisionCandidates(theme, [
      { path: "/pages/0/root", box: { x: 0, y: 0, width: 100, height: 100 }, reason: "screenshot fallback" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const capture = minimalCapture({ viewport_top: "screenshots/viewport-top.png" });
    const result = await applyVisionFallback(theme, capture, dir);

    expect(result.pages[0]!.root.role).toBe("hero");
    expect(result.review).toEqual([]);
  });

  it("is a no-op (no fetch call) when there are no registered candidates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const theme = themeWithHeroRoot();
    await applyVisionFallback(theme, minimalCapture(), "/tmp");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
