import { describe, expect, it } from "vitest";
import { themeFromCapture } from "../src/build/from-capture.js";
import { renderThemeHtml } from "../src/build/render-html.js";
import type { DomNode, PageCapture } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 1440, height: 80 },
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

function baseCapture(dom: DomNode): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 5000 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
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
    dom,
  };
}

describe("themeFromCapture: SPA root-wrapper unwrapping", () => {
  it("builds real body content instead of dropping the whole page when header+main+footer are nested under one pass-through div (real bug: nike.in)", () => {
    // Mirrors the real nike.in DOM shape found while debugging a live "blank
    // page" report: <body><div id="app"><div class="css-hash">
    // <div class="css-hash">(promo bar + nav + real content)</div>
    // <footer>...</footer></div></div></body> — no element anywhere is
    // literally tagged <header>, and findFooterNode only finds the real
    // <footer> tag. Before unwrapBodyRoot, the top-level loop saw ONE child
    // (div#app) that *contains* the footer and skipped it wholesale —
    // discarding the promo bar, nav, and every content section along with
    // it, producing a page with nothing but the footer.
    const capture = baseCapture(
      el({
        tag: "body",
        box: { x: 0, y: 0, width: 1440, height: 2000 },
        children: [
          el({
            tag: "div",
            id: "app",
            box: { x: 0, y: 0, width: 1440, height: 2000 },
            children: [
              el({
                tag: "div",
                className: "css-hash1",
                box: { x: 0, y: 0, width: 1440, height: 2000 },
                children: [
                  el({
                    tag: "div",
                    className: "css-hash2",
                    box: { x: 0, y: 0, width: 1440, height: 1858 },
                    children: [
                      el({
                        tag: "section",
                        box: { x: 0, y: 0, width: 1440, height: 300 },
                        children: [
                          el({ tag: "h1", text: "Welcome to the store" }),
                          el({
                            tag: "p",
                            text: "A perfectly ordinary paragraph of real body copy right here.",
                          }),
                        ],
                      }),
                    ],
                  }),
                  el({
                    tag: "footer",
                    box: { x: 0, y: 1858, width: 1440, height: 142 },
                    children: [
                      el({ tag: "a", href: "https://example.test/terms", text: "Terms of Use" }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const theme = themeFromCapture(capture);
    const root = theme.pages[0]!.root;
    if (!("children" in root)) throw new Error("expected root to have children");

    // The real fix under test: body content must survive, not just the footer.
    expect(root.children.length).toBeGreaterThan(1);
    const html = renderThemeHtml(theme);
    expect(html).toContain("Welcome to the store");
    expect(html).toContain("Terms of Use");
  });

  it("does not unwrap a body whose single child is already the real flat content (no structure to reveal)", () => {
    const capture = baseCapture(
      el({
        tag: "body",
        children: [
          el({
            tag: "section",
            box: { x: 0, y: 0, width: 1440, height: 300 },
            children: [
              // A heading with no children of its own only ever surfaces via
              // buildBlock's own-text "copy" fallback (a bare h1-h6 tag never
              // matches sectionTitle()'s "descendant heading" search on
              // itself) — needs >12 chars to clear that filter's threshold.
              el({ tag: "h2", text: "Only section on this page" }),
              el({ tag: "p", text: "Just one section directly under body, nothing to unwrap here." }),
            ],
          }),
        ],
      }),
    );

    const theme = themeFromCapture(capture);
    const html = renderThemeHtml(theme);
    expect(html).toContain("Only section on this page");
    expect(html).toContain("Just one section directly under body");
  });
});
