import { describe, expect, it } from "vitest";
import { findKeywordEvidence } from "../src/build/section-keywords.js";
import type { DomNode } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 100, height: 100 },
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

describe("findKeywordEvidence", () => {
  it("finds a newsletter signal in descendant text, not just the node's own text", () => {
    const node = el({
      tag: "section",
      children: [
        el({ tag: "h2", text: "Stay in the loop" }),
        el({ tag: "p", text: "Subscribe to our newsletter for early access." }),
      ],
    });
    const evidence = findKeywordEvidence(node);
    expect(evidence.some((e) => e.label === "newsletter/subscribe")).toBe(true);
  });

  it("finds price and add-to-cart signals in a product card", () => {
    const node = el({
      tag: "div",
      className: "product-card",
      children: [
        el({ tag: "span", text: "$49.99" }),
        el({ tag: "button", text: "Add to Cart" }),
      ],
    });
    const evidence = findKeywordEvidence(node);
    expect(evidence.some((e) => e.label === "price")).toBe(true);
    expect(evidence.some((e) => e.label === "add to cart")).toBe(true);
  });

  it("returns no evidence for plain, keyword-free content", () => {
    const node = el({ tag: "p", text: "A perfectly ordinary sentence about nothing in particular." });
    expect(findKeywordEvidence(node)).toEqual([]);
  });

  it("finds a signal carried only in a data-* attribute, with no matching text", () => {
    const node = el({
      tag: "div",
      dataAttrs: { testid: "newsletter-signup" },
      children: [el({ tag: "span", text: "Join us" })],
    });
    const evidence = findKeywordEvidence(node);
    expect(evidence.some((e) => e.label === "newsletter/subscribe")).toBe(true);
  });
});
