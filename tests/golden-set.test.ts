import { describe, expect, it } from "vitest";
import { evaluate, type ExpectedBlock, type GoldenCase } from "../src/eval/golden-set.js";
import { emptyTheme, type Node, type ThemeDoc } from "../src/schema/theme.js";
import type { PageCapture } from "../src/types/page-capture.js";

function themeWithRoles(...roles: string[]): ThemeDoc {
  return emptyTheme({
    pages: [
      {
        id: "home",
        path: "/",
        root: { type: "stack", children: roles.map((role): Node => ({ type: "stack", role, children: [] })) },
      },
    ],
  });
}

function fakeCapture(): PageCapture {
  return {} as PageCapture; // builder below ignores it and returns a pre-baked theme
}

function caseFor(site: string, expected: ExpectedBlock[]): GoldenCase {
  return { site, capture: fakeCapture(), expected };
}

describe("evaluate", () => {
  it("scores a perfect match as precision=recall=f1=1 for every role", () => {
    const builder = () => themeWithRoles("header", "hero", "collections", "footer");
    const report = evaluate(builder, [
      caseFor("site-a", [{ role: "header" }, { role: "hero" }, { role: "collections" }, { role: "footer" }]),
    ]);
    for (const role of ["header", "hero", "collections", "footer"]) {
      expect(report.perRole[role]).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 });
    }
    expect(report.overallF1).toBe(1);
  });

  it("counts a missed section as a false negative with zero recall for that role", () => {
    const builder = () => themeWithRoles("header", "footer");
    const report = evaluate(builder, [caseFor("site-a", [{ role: "header" }, { role: "newsletter" }, { role: "footer" }])]);
    expect(report.perRole.newsletter).toMatchObject({ tp: 0, fp: 0, fn: 1, recall: 0 });
    expect(report.perRole.header).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("counts an extra unexpected section as a false positive with zero precision for that role", () => {
    const builder = () => themeWithRoles("header", "banner", "footer");
    const report = evaluate(builder, [caseFor("site-a", [{ role: "header" }, { role: "footer" }])]);
    expect(report.perRole.banner).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0 });
  });

  it("records a misclassification (position-aligned substitution) as a confusion entry, not an unrelated FN+FP pair", () => {
    // A hero heuristically built as a carousel: same slot in the page, wrong role.
    const builder = () => themeWithRoles("header", "carousel", "footer");
    const report = evaluate(builder, [caseFor("site-a", [{ role: "header" }, { role: "hero" }, { role: "footer" }])]);
    expect(report.confusion.hero).toMatchObject({ carousel: 1 });
    expect(report.perRole.hero).toMatchObject({ fn: 1, tp: 0 });
    expect(report.perRole.carousel).toMatchObject({ fp: 1, tp: 0 });
  });

  it("aggregates across multiple sites", () => {
    const builder = (c: PageCapture) => (c as unknown as { theme: ThemeDoc }).theme;
    const cases: GoldenCase[] = [
      { site: "a", capture: { theme: themeWithRoles("header", "footer") } as unknown as PageCapture, expected: [{ role: "header" }, { role: "footer" }] },
      { site: "b", capture: { theme: themeWithRoles("header") } as unknown as PageCapture, expected: [{ role: "header" }, { role: "footer" }] },
    ];
    const report = evaluate(builder, cases);
    expect(report.sites).toBe(2);
    expect(report.perRole.header).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(report.perRole.footer).toMatchObject({ tp: 1, fp: 0, fn: 1 });
  });

  it("ignores non-section roles when building the found sequence", () => {
    const theme = emptyTheme({
      pages: [
        {
          id: "home",
          path: "/",
          root: {
            type: "stack",
            role: "header" as never,
            children: [{ type: "stack", role: "tile" as never, children: [] }],
          },
        },
      ],
    });
    const report = evaluate(() => theme, [caseFor("site-a", [{ role: "header" }])]);
    expect(report.perRole.tile).toBeUndefined();
    expect(report.perRole.header).toMatchObject({ tp: 1 });
  });
});
