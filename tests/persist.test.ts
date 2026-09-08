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

function featureSection(title: string, copy: string): DomNode {
  return el({
    tag: "section",
    children: [
      el({ tag: "h3", text: title }),
      el({ tag: "p", text: copy }),
    ],
  });
}

describe("persistBuild", () => {
  it("promotes repeated non-card sections into a shared component via compactTheme", async () => {
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
        children: [
          featureSection("Free shipping", "Every order ships free within three business days."),
          featureSection("Easy returns", "Return any item within thirty days for a full refund."),
          featureSection("Secure checkout", "Your payment details are encrypted end to end always."),
        ],
      }),
    };

    const outDir = await mkdtemp(join(tmpdir(), "persist-test-"));
    const theme = await persistBuild(outDir, capture);

    const onDisk = JSON.parse(await readFile(join(outDir, "theme.json"), "utf8")) as ThemeDoc;
    expect(onDisk).toEqual(theme);

    // All three top-level children are identically-shaped (structure-only
    // fingerprint ignores actual text), so compactTheme's promoteRepeats
    // lifts them into one component and collapseInstanceLists then
    // collapses the resulting 3 same-component instances into a single
    // `list` node in place of the page root's `stack`.
    const root = theme.pages[0]!.root;
    if (root.type !== "list") throw new Error(`expected root to collapse into a list node, got ${root.type}`);
    expect(root.items.length).toBe(3);
    expect(theme.components[root.of]).toBeTruthy();
    expect(theme.pages[0]!.root.type).not.toBe("stack");
  });
});
