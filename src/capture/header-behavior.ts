import type { Box, HeaderBehavior, HeaderProbe } from "../types/page-capture.js";

const VIEWPORT_Y_TOLERANCE = 8;
const FLOW_Y_TOLERANCE = 40;

function nearZero(y: number): boolean {
  return Math.abs(y) <= VIEWPORT_Y_TOLERANCE;
}

function visiblyInViewport(box: Box | null, visible: boolean): boolean {
  if (!box || !visible) return false;
  return box.y + box.height > 0 && box.y < 200;
}

/**
 * Infer sticky/fixed/hide-on-scroll from three probes: top, scrolled 600px, back to top.
 * Distinguishes a document-flow header (y tracks -scrollY) from a JS hide-on-scroll header
 * (position fixed but translated off-screen).
 */
export function inferHeaderBehavior(
  probe: HeaderProbe | null,
  scrollDelta: number,
): HeaderBehavior {
  if (!probe || !probe.box_top) {
    return {
      sticky_or_fixed: false,
      lock_height_enable: false,
      always_fixed_on_scroll: false,
      reappear_on_scroll_up: false,
      document_flow: false,
      confidence: 0,
      evidence: ["No header candidate found"],
      probe,
    };
  }

  const evidence: string[] = [];
  const pos = probe.computed_position;
  const top = probe.box_top;
  const scrolled = probe.box_scrolled;
  const back = probe.box_back;
  const expectedFlowY = top.y - scrollDelta;

  const isCssSticky = pos === "fixed" || pos === "sticky";
  if (isCssSticky) evidence.push(`computed position=${pos}`);

  const stayedPinned =
    Boolean(scrolled) &&
    probe.visible_scrolled &&
    nearZero(scrolled!.y) &&
    visiblyInViewport(scrolled, probe.visible_scrolled);

  const looksLikeDocumentFlow =
    Boolean(scrolled) &&
    Math.abs(scrolled!.y - expectedFlowY) < FLOW_Y_TOLERANCE &&
    !isCssSticky;

  const hiddenWhileFixed =
    isCssSticky &&
    Boolean(scrolled) &&
    (!probe.visible_scrolled || scrolled!.y + scrolled!.height <= 0);

  const returned = visiblyInViewport(back ?? top, probe.visible_back);

  if (stayedPinned) evidence.push("header y≈0 after 600px scroll");
  if (looksLikeDocumentFlow) {
    evidence.push(
      `header y moved with document flow (scrolled y=${Math.round(scrolled!.y)}, expected ≈${Math.round(expectedFlowY)})`,
    );
  }
  if (hiddenWhileFixed) evidence.push("fixed/sticky header left the viewport after scroll down");
  if (returned) evidence.push("header visible after scrolling back to top");

  const always_fixed_on_scroll = stayedPinned;
  const lock_height_enable = stayedPinned;
  const sticky_or_fixed = isCssSticky || stayedPinned;
  const reappear_on_scroll_up = hiddenWhileFixed && returned;
  const document_flow = looksLikeDocumentFlow && !stayedPinned;

  let confidence = 0.5;
  if (stayedPinned || looksLikeDocumentFlow || hiddenWhileFixed) confidence = 0.85;
  if (isCssSticky && stayedPinned) confidence = 0.95;

  return {
    sticky_or_fixed,
    lock_height_enable,
    always_fixed_on_scroll,
    reappear_on_scroll_up,
    document_flow,
    confidence,
    evidence,
    probe,
  };
}
