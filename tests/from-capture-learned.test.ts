import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { themeFromCapture } from "../src/build/from-capture.js";
import {
  LEARNED_PATTERNS_PATH,
  invalidateLearnedPatternsCache,
  saveLearnedPattern,
} from "../src/build/learned-patterns.js";
import type { DomNode, PageCapture } from "../src/types/page-capture.js";
import type { Node } from "../src/schema/theme.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 1440, height: 200 },
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

// A real-shaped gap in the existing regex heuristic: a "join the club" CTA
// banner with no literal <input type=email> (it links out to a signup page
// instead of embedding a form) and no "subscribe/newsletter/sign up" text —
// isNewsletter() requires BOTH an email input AND that keyword regex, so
// this always falls through to generic content today, no matter what class
// name the real site uses.
function joinClubSection(className: string): DomNode {
  return el({
    tag: "section",
    className,
    box: { x: 0, y: 0, width: 1440, height: 220 },
    children: [
      el({ tag: "h2", text: "Join The Club" }),
      el({ tag: "p", text: "Members get early access to new drops and exclusive pricing." }),
      el({ tag: "a", href: "https://example.test/join", text: "Get 10% Off" }),
    ],
  });
}

function baseCapture(dom: DomNode): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: "2026-01-01T00:00:00.000Z",
    title: "Fixture",
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 900 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
    assets: [],
    theme_hints: { background_color: "", text_color: "", fonts: [], color_palette: [], css_variables: {} },
    header_behavior: {
      sticky_or_fixed: false, lock_height_enable: false, always_fixed_on_scroll: false,
      reappear_on_scroll_up: false, document_flow: true, confidence: 0, evidence: [], probe: null,
    },
    hover_reveals: [], candidate_blocks: [], warnings: [],
    dom,
  };
}

function topLevelRoles(theme: ReturnType<typeof themeFromCapture>): Array<string | undefined> {
  const root = theme.pages[0]!.root;
  if (!("children" in root)) return [];
  return root.children.map((n: Node) => n.role);
}

async function reset() {
  invalidateLearnedPatternsCache();
  await rm(LEARNED_PATTERNS_PATH, { force: true });
}

describe("learned patterns actually change themeFromCapture's classification", () => {
  beforeEach(reset);
  afterEach(reset);

  it("without a learned pattern, a 'join the club' CTA (no email input) is not classified as newsletter", () => {
    const capture = baseCapture(el({ tag: "body", children: [joinClubSection("join-club-banner")] }));
    const theme = themeFromCapture(capture);
    expect(topLevelRoles(theme)).not.toContain("newsletter");
  });

  it("after learning a class-based identifier for this exact pattern, the SAME shape is classified as newsletter and built via the real newsletter builder", async () => {
    await saveLearnedPattern({
      role: "newsletter",
      matchers: [{ kind: "class", pattern: "join-club-banner" }],
      confidence: 0.8,
      source: "test",
      example: "class=join-club-banner",
    });

    const capture = baseCapture(el({ tag: "body", children: [joinClubSection("join-club-banner")] }));
    const theme = themeFromCapture(capture);
    expect(topLevelRoles(theme)).toContain("newsletter");

    // Went through the real buildNewsletter path (not just a role stamp) —
    // it synthesizes an email input + submit button that weren't in the
    // source DOM at all (the fixture links out instead of embedding a form).
    const json = JSON.stringify(theme);
    expect(json).toContain('"input":"email"');
    expect(json).toContain("Join The Club");
  });

  it("does not misfire on an unrelated section with a different class name", async () => {
    await saveLearnedPattern({
      role: "newsletter",
      matchers: [{ kind: "class", pattern: "join-club-banner" }],
      confidence: 0.8,
      source: "test",
      example: "class=join-club-banner",
    });

    const unrelated = joinClubSection("totally-different-class");
    const capture = baseCapture(el({ tag: "body", children: [unrelated] }));
    const theme = themeFromCapture(capture);
    expect(topLevelRoles(theme)).not.toContain("newsletter");
  });
});
