import { describe, expect, it } from "vitest";
import { themeFromCapture } from "../src/build/from-capture.js";
import { getVisionCandidates } from "../src/build/from-vision.js";
import type { DomNode, PageCapture } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 400, height: 80 },
    style: {
      display: "block",
      position: "static",
      top: "auto",
      left: "auto",
      right: "auto",
      bottom: "auto",
      zIndex: "auto",
      overflow: "visible",
      opacity: "1",
      visibility: "visible",
      transform: "none",
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      color: "rgb(0,0,0)",
      fontFamily: "Georgia",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "1.4",
      textAlign: "left",
      padding: "0",
      margin: "0",
      borderRadius: "0",
      boxShadow: "none",
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: "0",
      gridTemplateColumns: "none",
    },
    children: [],
    ...partial,
  };
}

function baseCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 2000 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: {
      full_page: "screenshots/full-page.png",
      viewport_top: "screenshots/viewport-top.png",
      scroll_600: "",
      scroll_back: "",
      hovers: [],
    },
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
    ...overrides,
  };
}

describe("themeFromCapture vision candidates", () => {
  it("registers a whole-page candidate when there is no DOM snapshot", () => {
    const theme = themeFromCapture(baseCapture({ dom: null }));
    const candidates = getVisionCandidates(theme);
    expect(candidates).toEqual([
      {
        path: "/pages/0/root",
        reason: "Capture has no DOM snapshot — nothing for heuristics to work from",
      },
    ]);
  });

  it("registers a per-block candidate when a large, content-empty section falls back to screenshotHero", () => {
    const capture = baseCapture({
      dom: el({
        tag: "body",
        children: [
          el({ tag: "section", box: { x: 0, y: 0, width: 800, height: 400 }, children: [] }),
        ],
      }),
    });
    const theme = themeFromCapture(capture);
    const candidates = getVisionCandidates(theme);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      box: { x: 0, y: 0, width: 800, height: 400 },
      reason: "Heuristics fell back to a whole-screenshot crop for this region",
    });
    expect(candidates[0]!.path).toMatch(/^\/pages\/0\/root/);
  });

  it("registers no candidates when the page builds cleanly from real content", () => {
    const capture = baseCapture({
      dom: el({
        tag: "body",
        children: [
          el({
            tag: "section",
            box: { x: 0, y: 0, width: 800, height: 200 },
            children: [
              el({ tag: "h2", text: "Welcome" }),
              el({ tag: "p", text: "A perfectly ordinary paragraph of body copy here." }),
            ],
          }),
        ],
      }),
    });
    const theme = themeFromCapture(capture);
    expect(getVisionCandidates(theme)).toEqual([]);
  });
});
