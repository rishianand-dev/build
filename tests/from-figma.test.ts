import { describe, expect, it } from "vitest";
import { themeFromFigma, type FigmaImportInput } from "../src/build/from-figma.js";
import { renderThemeHtml } from "../src/build/render-html.js";
import type { FigmaNode } from "../src/build/figma-client.js";

function node(partial: Partial<FigmaNode> & { id: string; type: string }): FigmaNode {
  return { name: partial.id, ...partial };
}

function input(root: FigmaNode, overrides: Partial<FigmaImportInput> = {}): FigmaImportInput {
  return {
    fileKey: "abc123",
    nodeId: root.id,
    title: "Figma Fixture",
    sourceUrl: "https://www.figma.com/design/abc123/Fixture?node-id=1-1",
    root,
    imageFillUrls: {},
    ...overrides,
  };
}

describe("themeFromFigma", () => {
  it("maps auto-layout direction to row/stack and text to a text node", () => {
    const root = node({
      id: "1:1",
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 16,
      children: [
        node({ id: "1:2", type: "TEXT", characters: "Welcome", style: { fontSize: 32 } }),
        node({
          id: "1:3",
          type: "FRAME",
          layoutMode: "HORIZONTAL",
          children: [
            node({ id: "1:4", type: "TEXT", characters: "Shop", style: { fontSize: 16 } }),
            node({ id: "1:5", type: "TEXT", characters: "About", style: { fontSize: 16 } }),
          ],
        }),
      ],
    });

    const theme = themeFromFigma(input(root));
    const page = theme.pages[0]!.root;
    expect(page.type).toBe("stack");
    if (page.type !== "stack") throw new Error("expected stack");
    expect(page.children[0]).toMatchObject({ type: "text", text: "Welcome", tag: "h1" });
    const row = page.children[1]!;
    expect(row.type).toBe("row");
    if (row.type !== "row") throw new Error("expected row");
    expect(row.children.map((c) => (c.type === "text" ? c.text : null))).toEqual(["Shop", "About"]);

    const html = renderThemeHtml(theme);
    expect(html).toContain("Welcome");
    expect(html).toContain("Shop");
  });

  it("maps an image fill with no children to an image node, interning the URL as an asset", () => {
    const root = node({
      id: "1:1",
      type: "FRAME",
      fills: [{ type: "IMAGE", imageRef: "ref-1" }],
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 400 },
    });
    const theme = themeFromFigma(input(root, { imageFillUrls: { "ref-1": "https://figma-s3.example/hero.png" } }));
    const page = theme.pages[0]!.root;
    expect(page.type).toBe("image");
    if (page.type !== "image") throw new Error("expected image");
    expect(theme.assets[page.asset!]?.url).toBe("https://figma-s3.example/hero.png");
  });

  it("wraps a background image plus real content into a layer", () => {
    const root = node({
      id: "1:1",
      type: "FRAME",
      fills: [{ type: "IMAGE", imageRef: "ref-1" }],
      children: [node({ id: "1:2", type: "TEXT", characters: "Sale", style: { fontSize: 40 } })],
    });
    const theme = themeFromFigma(input(root, { imageFillUrls: { "ref-1": "https://figma-s3.example/bg.png" } }));
    const page = theme.pages[0]!.root;
    expect(page.type).toBe("layer");
    if (page.type !== "layer") throw new Error("expected layer");
    expect(page.children[0]!.type).toBe("image");
    expect(page.children[1]!.type).toBe("stack");
  });

  it("skips invisible nodes and drops empty containers", () => {
    const root = node({
      id: "1:1",
      type: "FRAME",
      children: [
        node({ id: "1:2", type: "TEXT", characters: "Visible", visible: true, style: { fontSize: 16 } }),
        node({ id: "1:3", type: "TEXT", characters: "Hidden", visible: false, style: { fontSize: 16 } }),
        node({ id: "1:4", type: "RECTANGLE", visible: true }),
      ],
    });
    const theme = themeFromFigma(input(root));
    const page = theme.pages[0]!.root;
    if (page.type !== "stack") throw new Error("expected stack");
    expect(page.children).toHaveLength(1);
    expect(page.children[0]).toMatchObject({ text: "Visible" });
  });

  it("interns solid fill colors and text style as tokens, reusing the same token for repeats", () => {
    const root = node({
      id: "1:1",
      type: "FRAME",
      children: [
        node({
          id: "1:2",
          type: "TEXT",
          characters: "One",
          style: { fontSize: 16, fontFamily: "Inter" },
          fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
        }),
        node({
          id: "1:3",
          type: "TEXT",
          characters: "Two",
          style: { fontSize: 16, fontFamily: "Inter" },
          fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
        }),
      ],
    });
    const theme = themeFromFigma(input(root));
    expect(Object.keys(theme.tokens.color)).toHaveLength(1);
    expect(Object.keys(theme.tokens.font)).toHaveLength(1);
    expect(theme.tokens.color[Object.keys(theme.tokens.color)[0]!]).toBe("#1a1a1a");
  });

  it("degrades explicitly for header/hover behavior instead of guessing", () => {
    const theme = themeFromFigma(input(node({ id: "1:1", type: "FRAME", children: [] })));
    expect(theme.review).toContainEqual(
      expect.objectContaining({ path: "/pages/0/root", confidence: 0 }),
    );
    expect(theme.review[0]!.reason).toMatch(/scroll\/hover behavior/);
  });

  it("falls back to an empty stack when the root node maps to nothing", () => {
    const theme = themeFromFigma(input(node({ id: "1:1", type: "RECTANGLE", visible: true })));
    expect(theme.pages[0]!.root).toMatchObject({ type: "stack", children: [] });
  });
});
