import { describe, expect, it } from "vitest";
import { renderThemeHtml } from "../src/build/render-html.js";
import { internStyle, internToken } from "../src/schema/compact.js";
import { emptyTheme, type Node, type ThemeDoc } from "../src/schema/theme.js";

function themeWithSections(): ThemeDoc {
  const t = emptyTheme();
  const sections: Node[] = [
    { type: "text", text: "Section A", tag: "h1" },
    { type: "text", text: "Section B", tag: "h2" },
  ];
  t.pages = [{ id: "home", path: "/", root: { type: "stack", children: sections } }];
  return t;
}

describe("renderThemeHtml tagPaths option", () => {
  it("emits no data-tp attributes by default (byte-for-byte unaffected)", () => {
    const html = renderThemeHtml(themeWithSections());
    expect(html).not.toContain("data-tp");
  });

  it("tags each top-level section with its JSON pointer path when opted in", () => {
    const html = renderThemeHtml(themeWithSections(), "home", { tagPaths: true });
    expect(html).toContain('data-tp="/pages/0/root/children/0"');
    expect(html).toContain('data-tp="/pages/0/root/children/1"');
    expect(html).toContain('data-tp="/pages/0/root"');
  });
});

describe("renderThemeHtml token resolution", () => {
  it("resolves a token ref embedded inside a compound value (e.g. a border shorthand), not just a whole-string ref", () => {
    const t = emptyTheme();
    internToken(t.tokens, "color", "#111111", "fg");
    const styleId = internStyle(t.styles, { border: "1px solid $color.fg" });
    t.pages = [
      { id: "home", path: "/", root: { type: "stack", style: styleId, children: [] } },
    ];
    const html = renderThemeHtml(t, "home");
    expect(html).toContain("border: 1px solid #111111;");
    expect(html).not.toContain("$color.fg");
  });
});
