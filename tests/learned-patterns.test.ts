import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNED_PATTERNS_PATH,
  deriveMatchers,
  invalidateLearnedPatternsCache,
  loadLearnedPatterns,
  matchLearnedPatterns,
  saveLearnedPattern,
} from "../src/build/learned-patterns.js";
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
      display: "block", position: "static", top: "auto", left: "auto", right: "auto", bottom: "auto",
      zIndex: "auto", overflow: "visible", opacity: "1", visibility: "visible", transform: "none",
      backgroundColor: "rgba(0,0,0,0)", backgroundImage: "none", color: "rgb(0,0,0)",
      fontFamily: "Georgia", fontSize: "16px", fontWeight: "400", lineHeight: "1.4", textAlign: "left",
      padding: "0", margin: "0", borderRadius: "0", boxShadow: "none", flexDirection: "row",
      justifyContent: "flex-start", alignItems: "stretch", gap: "0", gridTemplateColumns: "none",
    },
    children: [],
    ...partial,
  };
}

async function reset() {
  invalidateLearnedPatternsCache();
  await rm(LEARNED_PATTERNS_PATH, { force: true });
}

describe("learned-patterns", () => {
  // LEARNED_PATTERNS_PATH is the real, git-tracked data/learned-patterns.json
  // (not a per-test temp path) — back it up and restore it around the suite
  // so exercising these tests doesn't leave the real file deleted/clobbered.
  let backup: string | null = null;
  beforeAll(async () => {
    backup = await readFile(LEARNED_PATTERNS_PATH, "utf8").catch(() => null);
  });
  afterAll(async () => {
    if (backup !== null) {
      await mkdir(dirname(LEARNED_PATTERNS_PATH), { recursive: true });
      await writeFile(LEARNED_PATTERNS_PATH, backup, "utf8");
    } else {
      await rm(LEARNED_PATTERNS_PATH, { force: true });
    }
    invalidateLearnedPatternsCache();
  });

  beforeEach(reset);
  afterEach(reset);

  describe("deriveMatchers", () => {
    it("keeps a meaningful, hand-authored className token", () => {
      const node = el({ tag: "div", className: "newsletter-signup" });
      const matchers = deriveMatchers(node);
      expect(matchers).toContainEqual({ kind: "class", pattern: "newsletter-signup" });
    });

    it("discards CSS-in-JS hash tokens and layout-utility tokens", () => {
      const node = el({ tag: "div", className: "css-1sqetoh flex w-full mt-4" });
      const matchers = deriveMatchers(node);
      expect(matchers.filter((m) => m.kind === "class")).toEqual([]);
    });

    it("discards a hashy/auto-generated id but keeps a real one", () => {
      const hashy = el({ tag: "div", id: "a1b2c3d4e5" });
      expect(deriveMatchers(hashy).some((m) => m.kind === "id")).toBe(false);

      const real = el({ tag: "div", id: "newsletter-block" });
      expect(deriveMatchers(real)).toContainEqual({ kind: "id", pattern: "newsletter-block" });
    });

    it("adds a text matcher when real descendant text hits a known keyword pattern", () => {
      const node = el({
        tag: "section",
        children: [el({ tag: "p", text: "Subscribe to our newsletter for early access." })],
      });
      const matchers = deriveMatchers(node);
      expect(matchers.some((m) => m.kind === "text")).toBe(true);
    });

    it("keeps distinctive tags like form/video but not generic div/section", () => {
      expect(deriveMatchers(el({ tag: "form" }))).toContainEqual({ kind: "tag", pattern: "form" });
      expect(deriveMatchers(el({ tag: "div" })).some((m) => m.kind === "tag")).toBe(false);
    });
  });

  describe("saveLearnedPattern + matchLearnedPatterns + persistence", () => {
    it("persists a new rule to disk and matches it against a fresh node with the same identifiers", async () => {
      const saved = await saveLearnedPattern({
        role: "newsletter",
        matchers: [{ kind: "class", pattern: "newsletter-signup" }],
        confidence: 0.7,
        source: "test",
        example: "class=newsletter-signup",
      });
      expect(saved?.role).toBe("newsletter");

      const onDisk = JSON.parse(await readFile(LEARNED_PATTERNS_PATH, "utf8"));
      expect(onDisk).toHaveLength(1);

      invalidateLearnedPatternsCache();
      const node = el({ tag: "div", className: "newsletter-signup extra-class" });
      const match = matchLearnedPatterns(node, loadLearnedPatterns());
      expect(match?.role).toBe("newsletter");
    });

    it("does not match when only some of a multi-matcher rule's conditions are met (AND, not OR)", async () => {
      await saveLearnedPattern({
        role: "hero",
        matchers: [
          { kind: "class", pattern: "promo-banner" },
          { kind: "tag", pattern: "video" },
        ],
        confidence: 0.6,
        source: "test",
        example: "class=promo-banner tag=video",
      });
      invalidateLearnedPatternsCache();

      const partial = el({ tag: "div", className: "promo-banner" }); // has class but not tag=video
      expect(matchLearnedPatterns(partial, loadLearnedPatterns())).toBeNull();

      const full = el({ tag: "video", className: "promo-banner" });
      expect(matchLearnedPatterns(full, loadLearnedPatterns())?.role).toBe("hero");
    });

    it("reinforces (bumps hits/confidence) an existing rule instead of duplicating it on the same matcher set", async () => {
      const first = await saveLearnedPattern({
        role: "newsletter",
        matchers: [{ kind: "class", pattern: "newsletter-signup" }],
        confidence: 0.5,
        source: "test",
        example: "first",
      });
      const second = await saveLearnedPattern({
        role: "newsletter",
        matchers: [{ kind: "class", pattern: "newsletter-signup" }],
        confidence: 0.5,
        source: "test",
        example: "second",
      });
      expect(second?.id).toBe(first?.id);
      expect(second?.hits).toBe(2);
      expect(second?.confidence).toBeGreaterThan(0.5);

      const onDisk = JSON.parse(await readFile(LEARNED_PATTERNS_PATH, "utf8"));
      expect(onDisk).toHaveLength(1);
    });

    it("rejects an invalid role rather than persisting a garbage rule", async () => {
      const result = await saveLearnedPattern({
        role: "not-a-real-role",
        matchers: [{ kind: "class", pattern: "whatever" }],
        confidence: 0.5,
        source: "test",
        example: "x",
      });
      expect(result).toBeNull();
    });
  });
});
