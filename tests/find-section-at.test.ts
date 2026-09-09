import { describe, expect, it } from "vitest";
import { findSectionAtBand, topLevelSectionIndex } from "../src/build/find-section-at.js";
import type { DomNode } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 1440, height: 100 },
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

describe("findSectionAtBand", () => {
  it("unwraps SPA pass-through wrapper divs to reach the real section flow (real bug shape: nike.in)", () => {
    const hero = el({ tag: "section", className: "hero", box: { x: 0, y: 0, width: 1440, height: 400 } });
    const promo = el({ tag: "section", className: "promo", box: { x: 0, y: 400, width: 1440, height: 200 } });
    const dom = el({
      tag: "body",
      box: { x: 0, y: 0, width: 1440, height: 600 },
      children: [
        el({
          tag: "div",
          id: "app",
          box: { x: 0, y: 0, width: 1440, height: 600 },
          children: [
            el({
              tag: "div",
              className: "css-hash",
              box: { x: 0, y: 0, width: 1440, height: 600 },
              children: [hero, promo],
            }),
          ],
        }),
      ],
    });
    expect(findSectionAtBand(dom, 0, 400)).toBe(hero);
    expect(findSectionAtBand(dom, 400, 600)).toBe(promo);
  });

  it("picks the section with the most vertical overlap against the target band", () => {
    const a = el({ tag: "section", box: { x: 0, y: 0, width: 1440, height: 100 } });
    const b = el({ tag: "section", box: { x: 0, y: 100, width: 1440, height: 500 } });
    const c = el({ tag: "section", box: { x: 0, y: 600, width: 1440, height: 100 } });
    const dom = el({ tag: "body", children: [a, b, c] });
    expect(findSectionAtBand(dom, 150, 550)).toBe(b);
  });

  it("falls back to the nearest section by center distance when nothing overlaps", () => {
    const a = el({ tag: "section", box: { x: 0, y: 0, width: 1440, height: 100 } });
    const b = el({ tag: "section", box: { x: 0, y: 100, width: 1440, height: 100 } });
    const dom = el({ tag: "body", children: [a, b] });
    expect(findSectionAtBand(dom, 5000, 5100)).toBe(b);
  });

  it("returns null for an empty page", () => {
    const dom = el({ tag: "body", children: [] });
    expect(findSectionAtBand(dom, 0, 100)).toBeNull();
  });

  it("drills into a disproportionately large top-level section instead of returning its whole-page wrapper (real bug: turtle.in's id='home-page')", () => {
    // A real observed shape: the entire homepage body is one top-level
    // container (id="home-page") with no further top-level breakdown —
    // using it as-is for identifier learning would fingerprint "the whole
    // page" as if it were one specific component.
    const tile = el({ tag: "div", className: "product-tile", box: { x: 0, y: 500, width: 300, height: 300 } });
    const otherTile = el({ tag: "div", className: "product-tile", box: { x: 300, y: 500, width: 300, height: 300 } });
    const wrapper = el({
      tag: "div",
      id: "home-page",
      className: "jnWHKy",
      box: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [tile, otherTile],
    });
    const dom = el({ tag: "body", box: { x: 0, y: 0, width: 1440, height: 5000 }, children: [wrapper] });

    const found = findSectionAtBand(dom, 500, 800);
    expect(found).toBe(tile);
    expect(found).not.toBe(wrapper);
  });

  it("does not drill into a section that's only modestly larger than the band (avoids over-fragmenting a normal section)", () => {
    const child = el({ tag: "div", box: { x: 0, y: 0, width: 1440, height: 100 } });
    const section = el({ tag: "section", box: { x: 0, y: 0, width: 1440, height: 200 }, children: [child, child] });
    // Body's own box is intentionally much bigger than section's, so the
    // unwrap step's "single pass-through child" heuristic doesn't fire and
    // treat `section` itself as a wrapper to skip past.
    const dom = el({ tag: "body", box: { x: 0, y: 0, width: 1440, height: 5000 }, children: [section] });
    expect(findSectionAtBand(dom, 0, 150)).toBe(section);
  });

  it("stops drilling once no child further narrows the match (a leaf-like oversized section)", () => {
    const wrapper = el({ tag: "div", box: { x: 0, y: 0, width: 1440, height: 5000 }, children: [] });
    const dom = el({ tag: "body", children: [wrapper] });
    expect(findSectionAtBand(dom, 500, 800)).toBe(wrapper);
  });
});

describe("topLevelSectionIndex", () => {
  it("finds the index of the top-level section that contains a drilled-down descendant", () => {
    const tile = el({ tag: "div", className: "product-tile", box: { x: 0, y: 500, width: 300, height: 300 } });
    const wrapper = el({
      tag: "div",
      box: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [tile],
    });
    const before = el({ tag: "section", box: { x: 0, y: -600, width: 1440, height: 600 } });
    const dom = el({ tag: "body", children: [before, wrapper] });
    expect(topLevelSectionIndex(dom, tile)).toBe(1);
    expect(topLevelSectionIndex(dom, wrapper)).toBe(1);
    expect(topLevelSectionIndex(dom, before)).toBe(0);
  });

  it("returns -1 for a node that isn't under any top-level section", () => {
    const stray = el({ tag: "div" });
    const dom = el({ tag: "body", children: [el({ tag: "section" })] });
    expect(topLevelSectionIndex(dom, stray)).toBe(-1);
  });
});
