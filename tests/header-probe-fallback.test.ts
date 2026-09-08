import { describe, expect, it } from "vitest";
import { themeFromCapture } from "../src/build/from-capture.js";
import { renderThemeHtml } from "../src/build/render-html.js";
import type { DomNode, HeaderProbe, PageCapture } from "../src/types/page-capture.js";

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

function probe(boxTop: DomNode["box"]): HeaderProbe {
  return {
    selector: "div.css-hash",
    tag: "div",
    className: "css-hash",
    computed_position: "sticky",
    computed_transform: "none",
    box_top: boxTop,
    box_scrolled: boxTop,
    box_back: boxTop,
    visible_top: true,
    visible_scrolled: true,
    visible_back: true,
  };
}

function baseCapture(dom: DomNode, headerProbe: HeaderProbe | null): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 3000 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
    assets: [],
    theme_hints: { background_color: "", text_color: "", fonts: [], color_palette: [], css_variables: {} },
    header_behavior: {
      sticky_or_fixed: Boolean(headerProbe),
      lock_height_enable: false,
      always_fixed_on_scroll: Boolean(headerProbe),
      reappear_on_scroll_up: false,
      document_flow: !headerProbe,
      confidence: headerProbe ? 1 : 0,
      evidence: [],
      probe: headerProbe,
    },
    hover_reveals: [],
    candidate_blocks: [],
    warnings: [],
    dom,
  };
}

describe("header detection: capture-time sticky-probe fallback (real bug: nike.in)", () => {
  it("finds a header with no semantic tag/role/classname hint via the sticky-position probe, and merges an adjacent nav-region sibling's links", () => {
    // Mirrors the real nike.in shape: a sticky logo+icons bar with a
    // CSS-in-JS hashed classname (no literal "header" substring anywhere),
    // a hidden mega-menu panel sitting between it and the real nav in
    // document order, then the actual nav row as a role="region" sibling.
    const logoBar = el({
      tag: "div",
      className: "css-1sqetoh",
      box: { x: 0, y: 0, width: 1440, height: 96 },
      style: { ...el({ tag: "div" }).style, position: "sticky" },
      children: [
        el({ tag: "img", src: "https://example.test/logo.png", alt: "Brand", box: { x: 0, y: 20, width: 60, height: 40 } }),
        el({ tag: "button", ariaLabel: "Account", box: { x: 1300, y: 20, width: 24, height: 24 } }),
        el({ tag: "button", ariaLabel: "Cart", box: { x: 1340, y: 20, width: 24, height: 24 } }),
      ],
    });
    const hiddenMegaMenu = el({
      tag: "div",
      className: "css-p6khse",
      box: { x: 0, y: 90, width: 1440, height: 810 },
      style: { ...el({ tag: "div" }).style, display: "none" },
    });
    const navRegion = el({
      tag: "div",
      className: "css-jrotcs",
      role: "region",
      box: { x: 0, y: 96, width: 1440, height: 61 },
      children: [
        el({ tag: "a", href: "https://example.test/new", text: "New Arrivals", box: { x: 20, y: 110, width: 100, height: 30 } }),
        el({ tag: "a", href: "https://example.test/best", text: "Bestsellers", box: { x: 140, y: 110, width: 100, height: 30 } }),
        el({ tag: "a", href: "https://example.test/running", text: "Running", box: { x: 260, y: 110, width: 100, height: 30 } }),
      ],
    });
    const main = el({
      tag: "main",
      box: { x: 0, y: 157, width: 1440, height: 1000 },
      children: [
        el({
          tag: "section",
          box: { x: 0, y: 157, width: 1440, height: 300 },
          children: [
            el({ tag: "h1", text: "Welcome to the store" }),
            el({ tag: "p", text: "Some real body copy right here for the page." }),
          ],
        }),
      ],
    });
    const wrapper = el({
      tag: "div",
      className: "css-9w0r0v",
      box: { x: 0, y: 0, width: 1440, height: 1157 },
      children: [
        el({
          tag: "div",
          className: "css-1c8qrwx",
          box: { x: 0, y: 0, width: 1440, height: 1157 },
          children: [logoBar, hiddenMegaMenu, navRegion, main],
        }),
      ],
    });
    const dom = el({
      tag: "body",
      box: { x: 0, y: 0, width: 1440, height: 1157 },
      children: [el({ tag: "div", id: "app", box: { x: 0, y: 0, width: 1440, height: 1157 }, children: [wrapper] })],
    });

    const capture = baseCapture(dom, probe(logoBar.box));
    const theme = themeFromCapture(capture);

    expect(theme.review.some((r) => r.reason === "No header element")).toBe(false);

    const html = renderThemeHtml(theme);
    expect(html).toContain("New Arrivals");
    expect(html).toContain("Bestsellers");
    expect(html).toContain("Running");
    expect(html).toContain("Welcome to the store");
  });

  it("does not use the probe when a real header is already found by tag/role", () => {
    const realHeader = el({
      tag: "header",
      box: { x: 0, y: 0, width: 1440, height: 80 },
      children: [el({ tag: "a", href: "https://example.test/shop", text: "Shop" })],
    });
    const decoyProbeBox = { x: 0, y: 500, width: 1440, height: 40 };
    const dom = el({
      tag: "body",
      children: [
        realHeader,
        el({
          tag: "section",
          box: { x: 0, y: 80, width: 1440, height: 300 },
          children: [
            el({ tag: "h2", text: "Body content section" }),
            el({ tag: "p", text: "Just a plain paragraph of copy text here." }),
          ],
        }),
      ],
    });
    const capture = baseCapture(dom, probe(decoyProbeBox));
    const theme = themeFromCapture(capture);
    const html = renderThemeHtml(theme);
    expect(html).toContain("Shop");
    expect(html).toContain("Body content section");
  });
});
