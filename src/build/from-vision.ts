/**
 * Vision classification: a fallback for spots where the DOM-heuristic
 * chain in from-capture.ts's `buildBlock` couldn't confidently type a
 * region (or, for a page with no DOM snapshot at all, the whole page).
 *
 * Scope note: this classifies a region into a `Role` + confidence +
 * reason — it does not synthesize a full Node subtree from pixels. The
 * heuristic path still produces the structural node (today, a screenshot-
 * crop "hero" stack via `screenshotHero`); vision only upgrades that
 * node's `role` and leaves a `ReviewItem` explaining why, so a human (or
 * later, the eval harness) can judge whether the guess was right. Full
 * pixel-to-layout synthesis is real future work, not this phase's job —
 * see the plan's golden-set/baseline-measurement step before attempting
 * it, since there's no way to know if it's worth building without one.
 *
 * Runs as an async post-pass over an already-built ThemeDoc (same
 * reasoning as rehost-assets.ts): from-capture.ts's `buildBlock` chain is
 * a deep synchronous recursion, so threading async vision calls through
 * it directly would force `async` onto ~30 functions for no benefit —
 * candidates are tagged with a WeakMap side-channel during the sync
 * build, resolved to JSON pointers before the tree is pruned, then
 * classified here after the fact.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveNodeAtPath } from "../schema/compact.js";
import { CANONICAL_ROLES, canonicalRole, type CanonicalRole } from "../schema/roles.js";
import type { Node, ThemeDoc } from "../schema/theme.js";
import type { Box, PageCapture } from "../types/page-capture.js";
import { ollamaVisionJson } from "./ollama.js";

export interface VisionClassifyInput {
  screenshotAbsPath: string;
  /** Region of interest within the screenshot, in CSS px. Omit to classify the whole image. */
  box?: Box;
  /** Optional simplified HTML for the region, when a DOM exists but heuristics still declined. */
  simplifiedHtml?: string;
  model?: string;
  host?: string;
}

export interface VisionClassifyResult {
  role: CanonicalRole;
  confidence: number;
  reason: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string", enum: [...CANONICAL_ROLES] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["role", "confidence", "reason"],
};

function buildPrompt(input: VisionClassifyInput): string {
  const regionHint = input.box
    ? `Focus only on the region at approximately x=${Math.round(input.box.x)}, y=${Math.round(input.box.y)}, ` +
      `width=${Math.round(input.box.width)}, height=${Math.round(input.box.height)} (CSS pixels from the top-left ` +
      `of the screenshot). Ignore everything else in the image.`
    : "Classify the overall page shown in this full-page screenshot.";
  const htmlHint = input.simplifiedHtml
    ? `\n\nSimplified HTML for extra context (may be incomplete or unreliable):\n${input.simplifiedHtml.slice(0, 2000)}`
    : "";
  return (
    `You are classifying one section of a captured e-commerce/marketing web page screenshot ` +
    `into a single role from this closed set: ${CANONICAL_ROLES.join(", ")}.\n${regionHint}\n` +
    `Return strict JSON matching the schema. If nothing in the role list fits well, pick the ` +
    `closest reasonable role and lower "confidence" instead of inventing a new label.${htmlHint}`
  );
}

/** Runs one vision classification call. Returns null on any failure (unreachable model, bad response, unparseable role). */
export async function classifyRegion(input: VisionClassifyInput): Promise<VisionClassifyResult | null> {
  let imageBase64: string;
  try {
    imageBase64 = (await readFile(input.screenshotAbsPath)).toString("base64");
  } catch {
    return null;
  }
  const raw = await ollamaVisionJson<{ role: string; confidence: number; reason: string }>({
    model: input.model,
    host: input.host,
    prompt: buildPrompt(input),
    imageBase64,
    schema: RESPONSE_SCHEMA,
  });
  if (!raw) return null;
  const role = canonicalRole(raw.role);
  if (!role) return null;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return { role, confidence, reason: String(raw.reason ?? "").slice(0, 500) };
}

/**
 * Side channel from from-capture.ts: a spot in the (pre-prune) tree that
 * a heuristic detector fell back on without real confidence, tagged with
 * enough context (a JSON pointer, resolved before pruning invalidates
 * node identity, plus the originating box) for a later vision pass to
 * revisit. Keyed by the theme object `themeFromCapture` returns, so its
 * signature and every existing caller/test are unaffected.
 */
export interface VisionCandidate {
  path: string;
  box?: Box;
  reason: string;
}

const candidatesByTheme = new WeakMap<ThemeDoc, VisionCandidate[]>();

export function setVisionCandidates(theme: ThemeDoc, candidates: VisionCandidate[]): void {
  candidatesByTheme.set(theme, candidates);
}

export function getVisionCandidates(theme: ThemeDoc): VisionCandidate[] {
  return candidatesByTheme.get(theme) ?? [];
}

/**
 * Runs vision classification for every candidate `themeFromCapture` left,
 * upgrading each resolved node's `role` and recording a `ReviewItem` with
 * the model's confidence/reason. `outDir` is the capture's directory —
 * `capture.screenshots.*` paths are stored relative to it. A candidate is
 * silently skipped (heuristic output left as-is) if the model is
 * unreachable, the screenshot is missing, or the response doesn't parse —
 * this is a best-effort upgrade, never a build failure.
 */
export async function applyVisionFallback(
  theme: ThemeDoc,
  capture: PageCapture,
  outDir: string,
  options?: { model?: string; host?: string },
): Promise<ThemeDoc> {
  const candidates = getVisionCandidates(theme);
  if (!candidates.length) return theme;

  for (const candidate of candidates) {
    const screenshotRel = candidate.box ? capture.screenshots.viewport_top : capture.screenshots.full_page;
    if (!screenshotRel) continue;
    const result = await classifyRegion({
      screenshotAbsPath: join(outDir, screenshotRel),
      box: candidate.box,
      model: options?.model,
      host: options?.host,
    });
    if (!result) continue;

    const node = resolveNodeAtPath(theme, candidate.path);
    if (node) setRole(node, result.role);
    theme.review.push({
      path: candidate.path,
      reason: `vision: ${result.reason}`,
      confidence: result.confidence,
    });
  }
  return theme;
}

function setRole(node: Node, role: CanonicalRole): void {
  node.role = role;
}
