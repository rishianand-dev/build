import { describe, expect, it } from "vitest";
import { buildImpactIndex, whatUsesAsset, whatUsesComponent, whatUsesStyle, whatUsesToken } from "../src/schema/impact.js";
import { emptyTheme, type ThemeDoc } from "../src/schema/theme.js";

function fixture(): ThemeDoc {
  return emptyTheme({
    tokens: {
      color: { brand: "#1b1610", unused: "#ffffff" },
      font: {},
      size: {},
      weight: {},
      space: {},
      radius: {},
      shadow: {},
    },
    styles: {
      title: { color: "$color.brand" },
      card: { bg: "#fff" },
    },
    assets: {
      a1: { url: "https://cdn.example/logo.png", kind: "image" },
    },
    components: {
      c1: {
        binds: ["title"],
        root: { type: "text", bind: "title", style: "title" },
      },
    },
    pages: [
      {
        id: "home",
        path: "/",
        root: {
          type: "stack",
          style: "card",
          children: [
            { type: "image", asset: "a1", style: "title" },
            { type: "instance", of: "c1", bind: { title: "Hello" } },
            { type: "instance", of: "c1", bind: { title: "World" } },
          ],
        },
      },
    ],
  });
}

describe("buildImpactIndex", () => {
  it("reverse-maps token usage through styles", () => {
    const index = buildImpactIndex(fixture());
    const usage = whatUsesToken(index, "$color.brand");
    expect(usage.count).toBe(1);
    expect(usage.paths).toEqual(["title"]);

    expect(whatUsesToken(index, "$color.unused").count).toBe(0);
  });

  it("reverse-maps style usage to node paths across pages and components", () => {
    const index = buildImpactIndex(fixture());
    const titleUsage = whatUsesStyle(index, "title");
    // used by the component root AND the page-level image node
    expect(titleUsage.count).toBe(2);
    expect(titleUsage.paths).toEqual(
      expect.arrayContaining(["/components/c1/root", "/pages/0/root/children/0"]),
    );

    const cardUsage = whatUsesStyle(index, "card");
    expect(cardUsage.paths).toEqual(["/pages/0/root"]);
  });

  it("reverse-maps asset usage to image node paths", () => {
    const index = buildImpactIndex(fixture());
    const usage = whatUsesAsset(index, "a1");
    expect(usage.paths).toEqual(["/pages/0/root/children/0"]);
  });

  it("reverse-maps component usage to every instance path", () => {
    const index = buildImpactIndex(fixture());
    const usage = whatUsesComponent(index, "c1");
    expect(usage.count).toBe(2);
    expect(usage.paths).toEqual(
      expect.arrayContaining(["/pages/0/root/children/1", "/pages/0/root/children/2"]),
    );
  });

  it("reports zero usage for an id nothing references", () => {
    const index = buildImpactIndex(fixture());
    expect(whatUsesComponent(index, "c-missing").count).toBe(0);
    expect(whatUsesAsset(index, "a-missing").count).toBe(0);
  });
});
