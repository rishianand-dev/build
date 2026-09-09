import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persistBuild } from "../src/build/persist.js";
import type { ThemeDoc } from "../src/schema/theme.js";
import type { DomNode, PageCapture } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 1200, height: 200 },
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

// A titled thumbnail strip (extractTiles' "collections" path, matched well
// before buildBlock's kids-recursion fallback, so it isn't sensitive to
// that heuristic's title-vs-recurse ordering). nodeWeight doesn't count a
// `list` node's items (ListNode has no `children`), so the title text node
// is what pushes weight to promoteRepeats' minWeight of 3 (stack + title +
// list); without it, three visually-identical-but-title-less strips are
// each one node too light to qualify for promotion.
function thumbStrip(prefix: string): DomNode {
  return el({
    tag: "section",
    box: { x: 0, y: 0, width: 1200, height: 140 },
    children: [
      el({ tag: "h2", text: "SHOP BY CATEGORY", box: { x: 0, y: 0, width: 1200, height: 32 } }),
      el({ tag: "img", src: `https://example.test/${prefix}-1.jpg`, box: { x: 0, y: 32, width: 100, height: 100 } }),
      el({ tag: "img", src: `https://example.test/${prefix}-2.jpg`, box: { x: 120, y: 32, width: 100, height: 100 } }),
      el({ tag: "img", src: `https://example.test/${prefix}-3.jpg`, box: { x: 240, y: 32, width: 100, height: 100 } }),
    ],
  });
}

describe("persistBuild", () => {
  it("never merges list-bearing sections into a shared component, even when identically shaped", async () => {
    const capture: PageCapture = {
      schema_version: "1.0",
      url: "https://example.test/",
      final_url: "https://example.test/",
      captured_at: "2026-01-01T00:00:00.000Z",
      title: "Fixture",
      viewport: { width: 1440, height: 900 },
      page_metrics: { scroll_width: 1440, scroll_height: 2000 },
      seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
      screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
      assets: [],
      theme_hints: {
        background_color: "rgb(255, 255, 255)",
        text_color: "rgb(20, 20, 20)",
        fonts: ["Georgia"],
        color_palette: [],
        css_variables: {},
      },
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
      dom: el({
        tag: "body",
        children: [thumbStrip("a"), thumbStrip("b"), thumbStrip("c")],
      }),
    };

    const outDir = await mkdtemp(join(tmpdir(), "persist-test-"));
    const theme = await persistBuild(outDir, capture);

    const onDisk = JSON.parse(await readFile(join(outDir, "theme.json"), "utf8")) as ThemeDoc;
    expect(onDisk).toEqual(theme);

    // All three top-level sections are identically *shaped* (structure-only
    // fingerprint ignores actual asset identity) but hold genuinely
    // different images. compactTheme's promoteRepeats must not lift a
    // list-bearing section into a shared component: collectBinds() has no
    // case for `type: "list"`, so a promoted list's `items` would freeze
    // onto whichever section got promoted first, and every other section
    // sharing that shape would silently render the same (wrong) images —
    // real, observed data loss. Each section must stay distinct.
    const root = theme.pages[0]!.root;
    if (!("children" in root)) throw new Error(`expected root to have children, got ${root.type}`);
    expect(root.children).toHaveLength(3);
    expect(root.children.every((c) => c.type === "stack")).toBe(true);

    const imageUrlsFor = (section: (typeof root.children)[number]): string[] => {
      if (!("children" in section)) return [];
      const list = section.children.find((c) => c.type === "list");
      if (!list || list.type !== "list") return [];
      return list.items.map((item) => theme.assets[item.img as string]?.url ?? "");
    };
    const [a, b, c] = root.children.map(imageUrlsFor);
    expect(a).toEqual(["https://example.test/a-1.jpg", "https://example.test/a-2.jpg", "https://example.test/a-3.jpg"]);
    expect(b).toEqual(["https://example.test/b-1.jpg", "https://example.test/b-2.jpg", "https://example.test/b-3.jpg"]);
    expect(c).toEqual(["https://example.test/c-1.jpg", "https://example.test/c-2.jpg", "https://example.test/c-3.jpg"]);
  });
});
