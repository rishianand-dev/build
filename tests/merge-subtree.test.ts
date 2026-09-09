import { describe, expect, it } from "vitest";
import { validateTheme } from "../src/schema/compact.js";
import { mergeSubtreeIntoTheme, replaceNodeAtPath } from "../src/build/merge-subtree.js";
import { emptyTheme, type Node, type ThemeDoc } from "../src/schema/theme.js";

function baseTheme(): ThemeDoc {
  const t = emptyTheme();
  t.pages = [{ id: "home", path: "/", root: { type: "stack", children: [{ type: "spacer" }] } }];
  return t;
}

describe("mergeSubtreeIntoTheme + replaceNodeAtPath", () => {
  it("remaps a style's token ref and interns it fresh into the main theme, without corrupting an existing same-name token", () => {
    const main = baseTheme();
    main.tokens.color.c1 = "#111111"; // main theme already has a "c1" — different color than mini's
    main.styles.s1 = { color: "$color.c1" };

    const mini = emptyTheme();
    mini.tokens.color.c1 = "#ff0000"; // mini's own "c1" happens to collide by name, not value
    mini.styles.s1 = { color: "$color.c1" };
    const miniNode: Node = { type: "text", text: "Hello", style: "s1" };

    const merged = mergeSubtreeIntoTheme(main, mini, miniNode);
    expect(replaceNodeAtPath(main, "/pages/0/root/children/0", merged)).toBe(true);

    expect(validateTheme(main)).toEqual([]);
    const placed = main.pages[0]!.root as Extract<Node, { type: "stack" }>;
    const node = placed.children[0]!;
    if (node.type !== "text") throw new Error("expected text node");
    const styleId = node.style!;
    const style = main.styles[styleId]!;
    const tokenRef = style.color!;
    const colorValue = main.tokens.color[tokenRef.replace("$color.", "")];
    // The remapped style must resolve to mini's real color (#ff0000), not
    // main's pre-existing "c1" (#111111) just because the key name collided.
    expect(colorValue).toBe("#ff0000");
    expect(main.tokens.color.c1).toBe("#111111"); // untouched
  });

  it("remaps an image node's asset reference to a freshly-interned entry in the main theme", () => {
    const main = baseTheme();
    const mini = emptyTheme();
    mini.assets.a1 = { url: "https://example.test/hero.jpg", alt: "Hero" };
    const miniNode: Node = { type: "image", asset: "a1" };

    const merged = mergeSubtreeIntoTheme(main, mini, miniNode);
    replaceNodeAtPath(main, "/pages/0/root/children/0", merged);

    expect(validateTheme(main)).toEqual([]);
    const placed = main.pages[0]!.root as Extract<Node, { type: "stack" }>;
    const node = placed.children[0]!;
    if (node.type !== "image") throw new Error("expected image node");
    expect(main.assets[node.asset!]?.url).toBe("https://example.test/hero.jpg");
  });

  it("reuses an existing structurally-identical asset instead of duplicating it (same url already interned)", () => {
    const main = baseTheme();
    main.assets.a1 = { url: "https://example.test/shared.jpg" };
    const mini = emptyTheme();
    mini.assets.a1 = { url: "https://example.test/shared.jpg" };
    const miniNode: Node = { type: "image", asset: "a1" };

    const merged = mergeSubtreeIntoTheme(main, mini, miniNode);
    if (merged.type !== "image") throw new Error("expected image node");
    expect(merged.asset).toBe("a1");
    expect(Object.keys(main.assets)).toEqual(["a1"]);
  });

  it("remaps an instance node's component (including the component's own nested style) into the main theme, renaming on id collision with different content", () => {
    const main = baseTheme();
    main.components.card = { root: { type: "text", text: "Existing card" } };

    const mini = emptyTheme();
    mini.tokens.color.c1 = "#00ff00";
    mini.styles.s1 = { color: "$color.c1" };
    mini.components.card = { root: { type: "text", text: "New card", style: "s1" } };
    const miniNode: Node = { type: "instance", of: "card" };

    const merged = mergeSubtreeIntoTheme(main, mini, miniNode);
    replaceNodeAtPath(main, "/pages/0/root/children/0", merged);

    expect(validateTheme(main)).toEqual([]);
    if (merged.type !== "instance") throw new Error("expected instance node");
    // Renamed, since main already had a different "card" component.
    expect(merged.of).not.toBe("card");
    expect(main.components.card?.root).toEqual({ type: "text", text: "Existing card" });
    const newComp = main.components[merged.of]!;
    if (newComp.root.type !== "text") throw new Error("expected text root");
    expect(newComp.root.text).toBe("New card");
  });

  it("replaces a whole page root directly (path with no /children suffix)", () => {
    const main = baseTheme();
    const mini = emptyTheme();
    const replacement: Node = { type: "text", text: "New root" };
    const merged = mergeSubtreeIntoTheme(main, mini, replacement);
    expect(replaceNodeAtPath(main, "/pages/0/root", merged)).toBe(true);
    expect(main.pages[0]!.root).toEqual({ type: "text", text: "New root" });
  });
});
