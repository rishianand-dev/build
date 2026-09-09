/**
 * Finds the real DOM section covering a given vertical band of the real
 * page — the counterpart to a mismatched region the pixel-match loop
 * found in the rendered output. Handles the same SPA
 * one-child-pass-through-wrapper shape from-capture.ts's unwrapBodyRoot
 * deals with (a real nike.in shape: body > div#app > div.css-hash >
 * div.css-hash > (actual sections)), since without unwrapping, "top-level
 * children" would just be one wrapper div covering the whole page.
 */
import type { Box, DomNode } from "../types/page-capture.js";

function overlap(box: Box, yStart: number, yEnd: number): number {
  const top = Math.max(box.y, yStart);
  const bottom = Math.min(box.y + box.height, yEnd);
  return Math.max(0, bottom - top);
}

function visibleKids(node: DomNode): DomNode[] {
  return node.children.filter((c) => c.style.display !== "none" && c.style.visibility !== "hidden");
}

/** Descends through single-child wrapper divs whose box roughly equals the
 * parent's, to reach the real flow of sibling sections. */
function unwrapToSections(root: DomNode): DomNode[] {
  let cursor = root;
  for (let i = 0; i < 12; i++) {
    const kids = visibleKids(cursor);
    if (kids.length !== 1) return kids;
    const only = kids[0]!;
    const sameSize =
      Math.abs(only.box.width - cursor.box.width) < 40 && Math.abs(only.box.height - cursor.box.height) < 200;
    if (!sameSize) return kids;
    cursor = only;
  }
  return visibleKids(cursor);
}

/** The real top-level section flow, in document order — exported so a
 * caller that needs to know *where among the real sections* one lives
 * (e.g. to insert a rebuilt section at the right position when nothing in
 * the render corresponds to it yet at all) doesn't have to re-derive the
 * same unwrapping logic. */
export function listSections(dom: DomNode): DomNode[] {
  return unwrapToSections(dom);
}

function bestOverlapping(candidates: DomNode[], yStart: number, yEnd: number): DomNode | null {
  let best: DomNode | null = null;
  let bestOverlap = 0;
  for (const c of candidates) {
    const o = overlap(c.box, yStart, yEnd);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = c;
    }
  }
  return best;
}

// A matched section dramatically taller than the band it's standing in
// for is a real, observed shape (a site that wraps its *entire* homepage
// body in one container div with no further top-level breakdown) — using
// it as-is produces an identifier fingerprint keyed to that giant
// wrapper's own id/class instead of the actual component inside it.
// Drilling into its children when it's this disproportionate finds the
// specific piece that actually corresponds to the band.
const OVERSIZE_RATIO = 2.5;
const MAX_DRILL_DEPTH = 6;

function drillToProportionate(section: DomNode, yStart: number, yEnd: number): DomNode {
  let current = section;
  const bandHeight = Math.max(1, yEnd - yStart);
  for (let depth = 0; depth < MAX_DRILL_DEPTH; depth++) {
    if (current.box.height <= bandHeight * OVERSIZE_RATIO) return current;
    const kids = visibleKids(current);
    if (kids.length < 2) return current;
    const next = bestOverlapping(kids, yStart, yEnd);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Returns the real section covering [yStart, yEnd] — starting from the
 * unwrapped top-level flow, then drilling into a disproportionately large
 * match's children so the result is reasonably scoped to the band rather
 * than "the entire page body," which would otherwise get real-DOM
 * identifiers (class/id) too broad to mean anything about this
 * component's specific type. Falls back to the closest section by
 * center-distance if nothing overlaps at all.
 */
export function findSectionAtBand(dom: DomNode, yStart: number, yEnd: number): DomNode | null {
  const sections = unwrapToSections(dom);
  if (!sections.length) return null;

  const best = bestOverlapping(sections, yStart, yEnd);
  if (best) return drillToProportionate(best, yStart, yEnd);

  const targetCenter = (yStart + yEnd) / 2;
  return sections.reduce((closest, s) => {
    const sCenter = s.box.y + s.box.height / 2;
    const closestCenter = closest.box.y + closest.box.height / 2;
    return Math.abs(sCenter - targetCenter) < Math.abs(closestCenter - targetCenter) ? s : closest;
  });
}

function contains(ancestor: DomNode, node: DomNode): boolean {
  if (ancestor === node) return true;
  return ancestor.children.some((c) => contains(c, node));
}

/**
 * Finds which top-level entry in `listSections(dom)` contains `node`
 * (node itself, if it already is a top-level section) — used to place a
 * rebuilt section at the right position among the page's top-level
 * children, even when `node` is itself a drilled-down descendant rather
 * than the top-level section verbatim. Returns -1 if not found under any
 * top-level section.
 */
export function topLevelSectionIndex(dom: DomNode, node: DomNode): number {
  const sections = unwrapToSections(dom);
  return sections.findIndex((s) => contains(s, node));
}
