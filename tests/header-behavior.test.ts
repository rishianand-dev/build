import { describe, expect, it } from "vitest";
import { inferHeaderBehavior } from "../src/capture/header-behavior.js";
import type { Box, HeaderProbe } from "../src/types/page-capture.js";

function box(y: number, height = 80): Box {
  return { x: 0, y, width: 1440, height };
}

function probe(partial: Partial<HeaderProbe> & { box_top: Box }): HeaderProbe {
  return {
    selector: "header",
    tag: "header",
    className: "site-header",
    computed_position: "static",
    computed_transform: "none",
    box_scrolled: null,
    box_back: null,
    visible_top: true,
    visible_scrolled: false,
    visible_back: true,
    ...partial,
  };
}

describe("inferHeaderBehavior", () => {
  it("returns low confidence when no header is found", () => {
    const result = inferHeaderBehavior(null, 600);
    expect(result.sticky_or_fixed).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.evidence[0]).toMatch(/no header/i);
  });

  it("detects a fixed header that stays at y≈0 after scroll", () => {
    const result = inferHeaderBehavior(
      probe({
        computed_position: "fixed",
        box_top: box(0),
        box_scrolled: box(0),
        box_back: box(0),
        visible_scrolled: true,
        visible_back: true,
      }),
      600,
    );
    expect(result.always_fixed_on_scroll).toBe(true);
    expect(result.lock_height_enable).toBe(true);
    expect(result.sticky_or_fixed).toBe(true);
    expect(result.document_flow).toBe(false);
    expect(result.reappear_on_scroll_up).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects a document-flow header that scrolls away", () => {
    const result = inferHeaderBehavior(
      probe({
        computed_position: "relative",
        box_top: box(0),
        box_scrolled: box(-600),
        box_back: box(0),
        visible_scrolled: false,
        visible_back: true,
      }),
      600,
    );
    expect(result.document_flow).toBe(true);
    expect(result.always_fixed_on_scroll).toBe(false);
    expect(result.lock_height_enable).toBe(false);
    expect(result.reappear_on_scroll_up).toBe(false);
  });

  it("detects hide-on-scroll-down / reappear-on-scroll-up for a fixed header", () => {
    const result = inferHeaderBehavior(
      probe({
        computed_position: "fixed",
        computed_transform: "matrix(1, 0, 0, 1, 0, -80)",
        box_top: box(0),
        box_scrolled: box(-80),
        box_back: box(0),
        visible_scrolled: false,
        visible_back: true,
      }),
      600,
    );
    expect(result.reappear_on_scroll_up).toBe(true);
    expect(result.always_fixed_on_scroll).toBe(false);
    expect(result.sticky_or_fixed).toBe(true);
  });
});
