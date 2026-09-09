/**
 * Persistent, growing identifier rules learned from real pages: when the
 * pixel-match loop finds a region that's missing or misclassified, and a
 * vision pass identifies what it actually is, this is where that gets
 * turned into a real, reusable rule ("a node with this class/tag/text
 * pattern is a newsletter block") and written to disk — so the *next*
 * build (this site or any other) can detect it too, not just this one
 * patched instance. That's the actual "training" loop: identifiers
 * accumulate across runs instead of resetting every time.
 *
 * Deliberately not a model/embedding store — a small, inspectable JSON
 * file of explicit matchers, consistent with the rest of this codebase's
 * "read the real code/DOM, use real signals" approach rather than a black
 * box. A human can open data/learned-patterns.json and see exactly why a
 * rule fired.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CanonicalRole } from "../schema/roles.js";
import { canonicalRole } from "../schema/roles.js";
import type { DomNode } from "../types/page-capture.js";

export interface Matcher {
  kind: "class" | "tag" | "id" | "text";
  pattern: string;
}

export interface LearnedPattern {
  id: string;
  role: CanonicalRole;
  /** ALL matchers must hit for this pattern to fire (AND, not OR) — a
   * single generic token (e.g. one common class) is too weak to trust
   * alone; requiring the combination is what keeps false positives down. */
  matchers: Matcher[];
  confidence: number;
  /** How many times this exact rule has been (re)confirmed since creation. */
  hits: number;
  source: string;
  learnedAt: string;
  /** Short human-readable snippets (class list / matched text) from the
   * example(s) that produced this rule — for a person skimming the file. */
  examples: string[];
}

export const LEARNED_PATTERNS_PATH = resolve(process.cwd(), "data/learned-patterns.json");

// Auto-generated-looking class/id tokens carry no cross-site (or even
// cross-deploy) meaning — a CSS-in-JS hash like "css-1sqetoh" or a
// Tailwind/utility primitive like "flex" would either never recur or
// recur on every single element, so neither is a useful identifier.
const GENERATED_TOKEN_RE = /^(css|sc|emotion|jsx|styled|makeStyles)-[a-z0-9]{4,}$/i;
const HASHY_TOKEN_RE = /^[a-f0-9]{6,}$/i;
const UTILITY_TOKEN_RE =
  /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|w-|h-|p-|m-|mt-|mb-|ml-|mr-|px-|py-|pt-|pb-|pl-|pr-|gap-|text-|font-|bg-|border|rounded|shadow|justify-|items-|col-|row-|container|wrapper|content|inner|outer)/i;

function isMeaningfulToken(token: string): boolean {
  if (token.length < 3 || token.length > 40) return false;
  if (GENERATED_TOKEN_RE.test(token)) return false;
  if (HASHY_TOKEN_RE.test(token)) return false;
  if (UTILITY_TOKEN_RE.test(token)) return false;
  return true;
}

const TEXT_KEYWORD_RULES: Array<{ label: string; pattern: RegExp; canonicalPattern: string }> = [
  { label: "newsletter/subscribe", pattern: /subscribe|mailing list|newsletter|sign\s*up for/i, canonicalPattern: "subscribe|mailing list|newsletter|sign\\s*up for" },
  { label: "sale/discount", pattern: /\bsale\b|\d+%\s*off|discount|clearance/i, canonicalPattern: "\\bsale\\b|\\d+%\\s*off|discount|clearance" },
  { label: "add to cart", pattern: /add to (cart|bag)|buy now|shop now|choose options/i, canonicalPattern: "add to (cart|bag)|buy now|shop now|choose options" },
  { label: "account/login", pattern: /\b(sign in|log in|login|my account|register)\b/i, canonicalPattern: "\\b(sign in|log in|login|my account|register)\\b" },
  { label: "footer/copyright", pattern: /©|copyright|all rights reserved|powered by/i, canonicalPattern: "©|copyright|all rights reserved|powered by" },
];

function aggregateText(node: DomNode, depth = 0): string {
  const own = [node.text, node.ariaLabel, node.alt, node.placeholder].filter((v): v is string => Boolean(v)).join(" ");
  if (depth >= 6) return own;
  return [own, ...node.children.map((c) => aggregateText(c, depth + 1))].join(" ");
}

/** Extracts candidate identifier matchers from a real DOM node — the "how
 * do you turn a real element into a reusable rule" step. */
export function deriveMatchers(node: DomNode): Matcher[] {
  const matchers: Matcher[] = [];

  const classTokens = node.className.split(/\s+/).filter(isMeaningfulToken);
  // Cap to the 2 most specific (longest) tokens — more than that risks a
  // rule so narrow it only ever matches this one exact element again.
  for (const token of classTokens.sort((a, b) => b.length - a.length).slice(0, 2)) {
    matchers.push({ kind: "class", pattern: token });
  }

  if (node.id && !HASHY_TOKEN_RE.test(node.id) && node.id.length >= 3 && node.id.length <= 40) {
    matchers.push({ kind: "id", pattern: node.id });
  }

  const distinctiveTags = new Set(["form", "video", "nav", "aside", "figure"]);
  if (distinctiveTags.has(node.tag.toLowerCase())) {
    matchers.push({ kind: "tag", pattern: node.tag.toLowerCase() });
  }

  const text = aggregateText(node).slice(0, 4000);
  for (const rule of TEXT_KEYWORD_RULES) {
    if (rule.pattern.test(text)) matchers.push({ kind: "text", pattern: rule.canonicalPattern });
  }

  return matchers;
}

function testMatcher(node: DomNode, matcher: Matcher): boolean {
  switch (matcher.kind) {
    case "class":
      return node.className.split(/\s+/).includes(matcher.pattern);
    case "tag":
      return node.tag.toLowerCase() === matcher.pattern.toLowerCase();
    case "id":
      return node.id === matcher.pattern;
    case "text":
      try {
        return new RegExp(matcher.pattern, "i").test(aggregateText(node));
      } catch {
        return false;
      }
  }
}

function matcherSetKey(matchers: Matcher[]): string {
  return matchers
    .map((m) => `${m.kind}:${m.pattern}`)
    .sort()
    .join("|");
}

let cache: LearnedPattern[] | null = null;

/** Synchronous load — buildBlock's recursion is deep and synchronous
 * (same constraint documented on the vision-fallback side channel), so
 * pattern lookup during a build has to be sync too. Cached in-process;
 * `saveLearnedPattern` updates the cache directly so a rule learned mid-run
 * is visible to the very next build call without a re-read. */
export function loadLearnedPatterns(): LearnedPattern[] {
  if (cache) return cache;
  try {
    if (!existsSync(LEARNED_PATTERNS_PATH)) {
      cache = [];
      return cache;
    }
    const raw = JSON.parse(readFileSync(LEARNED_PATTERNS_PATH, "utf8")) as unknown;
    cache = Array.isArray(raw) ? (raw as LearnedPattern[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Test-only: forces the next loadLearnedPatterns() to re-read from disk. */
export function invalidateLearnedPatternsCache(): void {
  cache = null;
}

export function matchLearnedPatterns(
  node: DomNode,
  patterns: LearnedPattern[] = loadLearnedPatterns(),
): { pattern: LearnedPattern; role: CanonicalRole } | null {
  let best: LearnedPattern | null = null;
  for (const pattern of patterns) {
    if (!pattern.matchers.length) continue;
    if (pattern.matchers.every((m) => testMatcher(node, m))) {
      if (!best || pattern.confidence > best.confidence) best = pattern;
    }
  }
  return best ? { pattern: best, role: best.role } : null;
}

/**
 * Records (or reinforces) a learned rule. If a rule with the exact same
 * matcher set already exists, this bumps its hit count and confidence
 * instead of duplicating it — repeated confirmation across runs is what
 * makes a rule trustworthy, not a fresh row every time.
 */
export async function saveLearnedPattern(input: {
  role: string;
  matchers: Matcher[];
  confidence: number;
  source: string;
  example: string;
}): Promise<LearnedPattern | null> {
  const role = canonicalRole(input.role);
  if (!role || !input.matchers.length) return null;

  const patterns = loadLearnedPatterns();
  const key = matcherSetKey(input.matchers);
  const existing = patterns.find((p) => p.role === role && matcherSetKey(p.matchers) === key);

  let result: LearnedPattern;
  if (existing) {
    existing.hits += 1;
    existing.confidence = Math.min(1, existing.confidence + (1 - existing.confidence) * 0.25);
    if (existing.examples.length < 5 && !existing.examples.includes(input.example)) {
      existing.examples.push(input.example);
    }
    result = existing;
  } else {
    result = {
      id: `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      matchers: input.matchers,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      hits: 1,
      source: input.source,
      learnedAt: new Date().toISOString(),
      examples: [input.example],
    };
    patterns.push(result);
  }

  await mkdir(dirname(LEARNED_PATTERNS_PATH), { recursive: true });
  await writeFile(LEARNED_PATTERNS_PATH, JSON.stringify(patterns, null, 2), "utf8");
  return result;
}
