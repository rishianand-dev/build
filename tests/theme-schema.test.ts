import { describe, expect, it } from "vitest";
import {
  collapseInstanceLists,
  compactTheme,
  internAsset,
  internStyle,
  internToken,
  promoteRepeats,
  stringifyTheme,
  validateTheme,
} from "../src/schema/compact.js";
import { emptyTheme, type Node, type ThemeDoc } from "../src/schema/theme.js";

function card(title: string, price: string, image: string): Node {
  return {
    type: "stack",
    style: "card",
    role: "card",
    children: [
      { type: "image", asset: image, style: "thumb" },
      { type: "text", tag: "h3", text: title, style: "h3" },
      { type: "text", text: price, style: "price" },
    ],
  };
}

function bloatedStore(): ThemeDoc {
  const products = [
    ["Wool coat", "$89", "a1"],
    ["Linen shirt", "$42", "a2"],
    ["Cotton tee", "$18", "a3"],
    ["Silk scarf", "$24", "a4"],
    ["Denim jacket", "$70", "a5"],
    ["Knit hat", "$16", "a6"],
  ] as const;

  const theme = emptyTheme({
    site: { name: "Fixture Store", source: "https://example.com" },
    tokens: {
      color: { bg: "#fafafa", fg: "#111111", muted: "#666666", line: "#eeeeee" },
      font: { body: "Georgia, serif" },
      size: { sm: "14px", md: "16px", lg: "24px" },
      weight: { regular: "400", bold: "700" },
      space: { "2": "8px", "3": "16px", "4": "24px" },
      radius: { sm: "4px" },
      shadow: {},
    },
    styles: {
      page: { bg: "$color.bg", color: "$color.fg", font: "$font.body", size: "$size.md" },
      header: { pad: "$space.3", bg: "$color.bg", pos: "sticky", top: "0", z: 10 },
      h3: { size: "$size.md", weight: "$weight.bold" },
      price: { color: "$color.muted", size: "$size.sm" },
      card: { bg: "#ffffff", pad: "$space.3", radius: "$radius.sm", gap: "$space.2" },
      thumb: { width: "100%", height: "160px" },
      row: { gap: "$space.3" },
    },
    assets: {
      a1: { url: "/img/1.jpg", kind: "image" },
      a2: { url: "/img/2.jpg", kind: "image" },
      a3: { url: "/img/3.jpg", kind: "image" },
      a4: { url: "/img/4.jpg", kind: "image" },
      a5: { url: "/img/5.jpg", kind: "image" },
      a6: { url: "/img/6.jpg", kind: "image" },
    },
    pages: [
      {
        id: "home",
        path: "/",
        name: "Home",
        root: {
          type: "stack",
          style: "page",
          children: [
            {
              type: "row",
              style: "header",
              role: "header",
              children: [
                { type: "text", text: "Fixture Store", tag: "h1" },
                { type: "link", href: "/search", children: [{ type: "text", text: "Search" }] },
                { type: "link", href: "/cart", children: [{ type: "text", text: "Cart" }] },
              ],
            },
            {
              type: "row",
              style: "row",
              role: "list",
              children: products.map(([title, price, image]) => card(title, price, image)),
            },
          ],
        },
      },
    ],
  });
  return theme;
}

describe("theme intern", () => {
  it("reuses the same token id for a repeated color", () => {
    const theme = emptyTheme();
    const a = internToken(theme.tokens, "color", "#111111", "fg");
    const b = internToken(theme.tokens, "color", "#111111");
    expect(a).toBe("$color.fg");
    expect(b).toBe("$color.fg");
    expect(Object.keys(theme.tokens.color)).toEqual(["fg"]);
  });

  it("still creates a distinct hinted token even when its value matches an existing different key (e.g. card === bg on a monochrome site)", () => {
    const theme = emptyTheme();
    internToken(theme.tokens, "color", "#ffffff", "bg");
    const ref = internToken(theme.tokens, "color", "#ffffff", "card");
    expect(ref).toBe("$color.card");
    expect(theme.tokens.color.card).toBe("#ffffff");
    expect(theme.tokens.color.bg).toBe("#ffffff");
  });

  it("reuses the same style id for an identical style object", () => {
    const styles = {};
    const a = internStyle(styles, { pad: "$space.3", bg: "$color.bg" });
    const b = internStyle(styles, { bg: "$color.bg", pad: "$space.3" });
    expect(a).toBe("s1");
    expect(b).toBe("s1");
    expect(Object.keys(styles)).toHaveLength(1);
  });

  it("reuses the same asset id for the same url", () => {
    const assets = {};
    const a = internAsset(assets, "https://cdn.example/hero.jpg", { kind: "image" });
    const b = internAsset(assets, "https://cdn.example/hero.jpg");
    expect(a).toBe(b);
    expect(Object.keys(assets)).toHaveLength(1);
  });
});

describe("promoteRepeats + list collapse", () => {
  it("turns six duplicated cards into one component and one list", () => {
    const compact = compactTheme(bloatedStore());
    const json = stringifyTheme(compact);
    const parsed = JSON.parse(json) as ThemeDoc;

    expect(validateTheme(parsed)).toEqual([]);
    expect(Object.keys(parsed.components).length).toBeGreaterThanOrEqual(1);

    const home = parsed.pages[0]!;
    const list = findList(home.root);
    expect(list).toBeTruthy();
    expect(list?.items).toHaveLength(6);
    expect(list?.items[0]).toMatchObject({ t1: "Wool coat", t2: "$89", img1: "a1" });

    const cardCopies = countType(home.root, "stack", "card");
    expect(cardCopies).toBe(0);

    const bloatedSize = JSON.stringify(bloatedStore()).length;
    expect(json.length).toBeLessThan(bloatedSize * 0.85);
  });

  it("keeps unique header structure inline instead of forcing a component", () => {
    const after = promoteRepeats(bloatedStore(), { minCount: 2, minWeight: 3 });
    const header = after.pages[0]!.root;
    expect(header.type).toBe("stack");
    const promotedCards = Object.values(after.components);
    expect(promotedCards.length).toBe(1);
  });

  it("collapseInstanceLists requires at least three sibling instances", () => {
    const theme = emptyTheme({
      components: {
        c1: { root: { type: "text", bind: "t1" } },
      },
      pages: [
        {
          id: "p",
          path: "/",
          root: {
            type: "row",
            children: [
              { type: "instance", of: "c1", bind: { t1: "a" } },
              { type: "instance", of: "c1", bind: { t1: "b" } },
            ],
          },
        },
      ],
    });
    const next = collapseInstanceLists(theme);
    expect(next.pages[0]!.root.type).toBe("row");
  });
});

function findList(node: Node): Extract<Node, { type: "list" }> | null {
  if (node.type === "list") return node;
  if ("children" in node) {
    for (const child of node.children) {
      const found = findList(child);
      if (found) return found;
    }
  }
  return null;
}

function countType(node: Node, type: string, style?: string): number {
  let n = node.type === type && (!style || node.style === style) ? 1 : 0;
  if ("children" in node) {
    n += node.children.reduce((sum, c) => sum + countType(c, type, style), 0);
  }
  return n;
}
