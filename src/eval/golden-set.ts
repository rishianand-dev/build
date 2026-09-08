/**
 * Golden-set precision/recall/F1 harness for the block-role classifier
 * (today: from-capture.ts's DOM heuristics; the same interface later
 * scores a prompted or trained model — see EvalReport reuse in workstream
 * 6). Confirmed missing before this: `tests/from-capture.test.ts` and
 * `tests/capture-fixture.test.ts` are exact-assertion tests against one
 * synthetic fixture each, not a corpus-based statistical measurement.
 *
 * Scope: SECTION-level roles only (the roles from-capture.ts's top-level
 * `buildBlock` detectors assign to a whole block) — header, hero,
 * carousel, collections, newsletter, footer, banner. Per-item part-roles
 * nested inside a card/footer/header template (card, tile, media, info,
 * prices, badge, tools, legal, more, cart, nav) are a finer grain than
 * what a human labeling "what sections does this page have" would
 * naturally produce, and aren't what this harness scores — `nav` in
 * particular is always a child row inside `header` (buildHeader nests it
 * there unconditionally), never an independent top-level section, so
 * scoring it separately would just double-count every header as a
 * "header, nav" pair with no extra signal.
 */

import { walkPaths } from "../schema/compact.js";
import type { ThemeDoc } from "../schema/theme.js";
import type { PageCapture } from "../types/page-capture.js";

export const SECTION_ROLES = [
  "header",
  "hero",
  "carousel",
  "collections",
  "newsletter",
  "footer",
  "banner",
] as const;

export type SectionRole = (typeof SECTION_ROLES)[number];

export interface ExpectedBlock {
  role: SectionRole;
  /** Free-text note for a human re-reading the golden set later — not scored. */
  note?: string;
}

export interface GoldenCase {
  site: string;
  capture: PageCapture;
  expected: ExpectedBlock[];
  /** Absolute path to this case's capture directory (holds `screenshots/...`) — only
   * needed by screenshot-consuming evaluators (see eval/vlm-baseline.ts), not `evaluate()`. */
  dir?: string;
}

export interface RoleScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalReport {
  perRole: Record<string, RoleScore>;
  /** confusion[expectedRole][predictedRole] = count. "<none>" stands in for "nothing expected/found at that position". */
  confusion: Record<string, Record<string, number>>;
  /** Macro-average F1 across every role that appeared in the corpus, expected or predicted. */
  overallF1: number;
  sites: number;
}

/**
 * Document-order sequence of section-level roles the builder produced for
 * one case's HOME page only (`theme.pages[0]`). `themeFromCapture` can
 * append synthetic shop/category/product sub-pages after it
 * (`attachConnectedPages`, inferred from nav links and product cards) —
 * expected labels here describe what a human sees on the captured
 * homepage, so scoring those synthetic extra pages too would silently
 * double-count shared header/footer nodes against a corpus that never
 * described them.
 */
function foundSectionRoles(theme: ThemeDoc): string[] {
  const found: string[] = [];
  const sectionSet = new Set<string>(SECTION_ROLES);
  const home = theme.pages[0];
  if (home) {
    walkPaths(home.root, "/pages/0/root", (node) => {
      if (node.role && sectionSet.has(node.role)) found.push(node.role);
    });
  }
  return found;
}

const NONE = "<none>";

/**
 * Minimum-edit-distance alignment between the expected and found role
 * sequences (classic DP, match cost 0 / substitute cost 1 / gap cost 1).
 * Aligning by position (not just by matching counts per role) is what
 * lets a genuine misclassification — e.g. a hero heuristically built as a
 * carousel — show up as a confusion[hero][carousel] entry instead of an
 * unrelated FN(hero) + FP(carousel) pair with no connection between them.
 */
function alignSequences(expected: string[], found: string[]): Array<[string, string]> {
  const n = expected.length;
  const m = found.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const subCost = expected[i - 1] === found[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j - 1]! + subCost, dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1);
    }
  }
  const pairs: Array<[string, string]> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const subCost = i > 0 && j > 0 ? (expected[i - 1] === found[j - 1] ? 0 : 1) : Infinity;
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + subCost) {
      pairs.unshift([expected[i - 1]!, found[j - 1]!]);
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      pairs.unshift([expected[i - 1]!, NONE]);
      i--;
    } else {
      pairs.unshift([NONE, found[j - 1]!]);
      j--;
    }
  }
  return pairs;
}

function emptyScore(): RoleScore {
  return { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 };
}

/**
 * Turns a set of per-case (expected sequence, found sequence) pairs into a
 * full report. This is the shared scoring core — `evaluate()` below feeds
 * it a `ThemeDoc`-producing (synchronous) builder for the DOM-heuristic
 * classifier; `evaluateRoleSequences()` feeds it anything that can name an
 * ordered list of section roles for a page (e.g. an async VLM-prompted
 * baseline that never produces a `ThemeDoc` at all).
 */
function scoreAlignments(perCase: Array<{ expectedSeq: string[]; foundSeq: string[] }>): EvalReport {
  const perRole: Record<string, RoleScore> = {};
  const confusion: Record<string, Record<string, number>> = {};
  const touch = (role: string) => (perRole[role] ??= emptyScore());
  const confuse = (expectedRole: string, foundRole: string) => {
    const row = (confusion[expectedRole] ??= {});
    row[foundRole] = (row[foundRole] ?? 0) + 1;
  };

  for (const { expectedSeq, foundSeq } of perCase) {
    for (const [expectedRole, foundRole] of alignSequences(expectedSeq, foundSeq)) {
      confuse(expectedRole, foundRole);
      if (expectedRole === foundRole) {
        touch(expectedRole).tp++;
      } else {
        if (expectedRole !== NONE) touch(expectedRole).fn++;
        if (foundRole !== NONE) touch(foundRole).fp++;
      }
    }
  }
  delete perRole[NONE];

  for (const score of Object.values(perRole)) {
    score.precision = score.tp + score.fp ? score.tp / (score.tp + score.fp) : 0;
    score.recall = score.tp + score.fn ? score.tp / (score.tp + score.fn) : 0;
    score.f1 = score.precision + score.recall ? (2 * score.precision * score.recall) / (score.precision + score.recall) : 0;
  }

  const roleF1s = Object.values(perRole).map((s) => s.f1);
  const overallF1 = roleF1s.length ? roleF1s.reduce((a, b) => a + b, 0) / roleF1s.length : 0;

  return { perRole, confusion, overallF1, sites: perCase.length };
}

export function evaluate(builder: (capture: PageCapture) => ThemeDoc, cases: GoldenCase[]): EvalReport {
  return scoreAlignments(
    cases.map((goldenCase) => ({
      expectedSeq: goldenCase.expected.map((e) => e.role),
      foundSeq: foundSectionRoles(builder(goldenCase.capture)),
    })),
  );
}

/**
 * Same scoring, for a classifier that names section roles directly
 * instead of building a `ThemeDoc` — e.g. a VLM prompted with a full-page
 * screenshot and asked to enumerate the sections it sees, in order.
 */
export async function evaluateRoleSequences(
  namer: (goldenCase: GoldenCase) => Promise<string[]>,
  cases: GoldenCase[],
): Promise<EvalReport> {
  const perCase = await Promise.all(
    cases.map(async (goldenCase) => ({
      expectedSeq: goldenCase.expected.map((e) => e.role),
      foundSeq: await namer(goldenCase),
    })),
  );
  return scoreAlignments(perCase);
}
