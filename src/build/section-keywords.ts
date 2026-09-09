/**
 * Real keyword/pattern evidence extraction from a section's actual text and
 * class names — the "find exact keywords or patterns to identify that"
 * step. Not a classifier on its own (from-capture.ts's buildBlock already
 * does real keyword-aware classification, e.g. its newsletter detector
 * checks for "subscribe|mailing list|newsletter|sign up" in the node's own
 * text) — this exists so the pixel-match loop can show *why* it decided a
 * region needed reclassification, in the same vocabulary a human reviewer
 * would use, rather than just "diff went down."
 */
import type { DomNode } from "../types/page-capture.js";

interface KeywordRule {
  label: string;
  pattern: RegExp;
}

const RULES: KeywordRule[] = [
  { label: "newsletter/subscribe", pattern: /subscribe|mailing list|newsletter|sign\s*up for/i },
  { label: "sale/discount", pattern: /\bsale\b|\d+%\s*off|discount|clearance/i },
  { label: "price", pattern: /(?:rs\.?|inr|usd|gbp|eur|₹|\$|€|£)\s*[\d,]+(?:\.\d+)?/i },
  { label: "add to cart", pattern: /add to (cart|bag)|buy now|shop now|choose options/i },
  { label: "account/login", pattern: /\b(sign in|log in|login|my account|register)\b/i },
  { label: "footer/copyright", pattern: /©|copyright|all rights reserved|powered by/i },
  { label: "social", pattern: /facebook|instagram|twitter|pinterest|youtube|tiktok/i },
  { label: "hero/banner", pattern: /shop the (collection|drop)|new arrivals|explore now/i },
  { label: "video", pattern: /\bwatch\b|\bplay\b/i },
]; // deliberately not sourced from from-capture.ts's own regex constants —
   // those are private to that module's build functions; this is a smaller,
   // display-only vocabulary, safe to diverge from without touching the
   // real classifier.

function aggregateText(node: DomNode, depth = 0): string {
  const own = [
    node.text,
    node.className,
    node.ariaLabel,
    node.alt,
    node.placeholder,
    node.dataAttrs ? Object.values(node.dataAttrs).join(" ") : undefined,
  ]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  if (depth >= 6) return own;
  return [own, ...node.children.map((c) => aggregateText(c, depth + 1))].join(" ");
}

export interface KeywordEvidence {
  label: string;
  matchedText: string;
}

/** Scans a DOM subtree's real text/classNames for role-indicating keywords. */
export function findKeywordEvidence(node: DomNode): KeywordEvidence[] {
  const text = aggregateText(node).slice(0, 4000);
  const evidence: KeywordEvidence[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) evidence.push({ label: rule.label, matchedText: match[0].slice(0, 60) });
  }
  return evidence;
}
