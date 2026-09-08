import { deleteNodeAtPath, resolveNodeAtPath, validateTheme } from "../schema/compact.js";
import type { Node, ThemeDoc } from "../schema/theme.js";
import { HttpError } from "./captures.js";
import { inferDetector, recordCorrection } from "./corrections.js";
import { getUserTheme, updateThemeByCaptureId } from "./themes.js";

/**
 * The review UI never sends a full `ThemeDoc` — only a JSON-pointer path
 * (from a `ReviewItem`, or any node the impact index says is safe to
 * touch) plus what to do with it. Edits are scoped to the handful of
 * fields the UI actually exposes (role, text), not an arbitrary Node
 * replacement — matches the "type-scoped form, not a raw JSON editor"
 * shape of the review UI itself.
 */
export type ReviewAction =
  | { path: string; action: "accept" }
  | { path: string; action: "reject" }
  | { path: string; action: "edit"; role?: string; text?: string };

const EDITABLE_TEXT_TYPES = new Set(["text", "button"]);

export async function applyReviewAction(
  captureId: string,
  userId: string,
  body: ReviewAction,
): Promise<ThemeDoc> {
  const record = await getUserTheme(userId, captureId);
  if (!record) throw new HttpError(404, "Capture not found");
  const theme = record.theme;

  // Not every ReviewItem points at a real node — from-capture.ts's own
  // pipeline-level notes ("Capture has no DOM snapshot" at `/pages/0`, "No
  // header element" at `/pages/0/header`) use coarser paths that don't
  // resolve. Those are still legitimately dismissable (accept), just not
  // editable or removable as a node.
  const node = resolveNodeAtPath(theme, body.path);
  if (!node && body.action !== "accept") {
    throw new HttpError(404, "No node at that path to edit or remove");
  }
  const predictedSnapshot: Node | { path: string; unresolved: true } = node
    ? (structuredClone(node) as Node)
    : { path: body.path, unresolved: true };

  const reviewIndex = theme.review.findIndex((r) => r.path === body.path);
  const reviewItem = reviewIndex >= 0 ? theme.review[reviewIndex] : undefined;

  let correctedSnapshot: Node | undefined;
  if (body.action === "edit" && node) {
    if (body.role !== undefined) node.role = body.role;
    if (body.text !== undefined) {
      if (!EDITABLE_TEXT_TYPES.has(node.type)) {
        throw new HttpError(400, `Cannot edit text on a "${node.type}" node`);
      }
      (node as { text?: string }).text = body.text;
    }
    correctedSnapshot = structuredClone(node) as Node;
  } else if (body.action === "reject") {
    if (!deleteNodeAtPath(theme, body.path)) {
      throw new HttpError(400, "That node can't be removed (no parent to remove it from)");
    }
  }

  if (body.action !== "accept") {
    const errors = validateTheme(theme);
    if (errors.length) throw new HttpError(400, `That change produces an invalid theme: ${errors.join("; ")}`);
  }

  if (reviewIndex >= 0) theme.review.splice(reviewIndex, 1);

  await updateThemeByCaptureId(captureId, theme);
  await recordCorrection({
    userId,
    captureId,
    nodePath: body.path,
    detector: inferDetector(reviewItem?.reason),
    predictedRole: "role" in predictedSnapshot ? predictedSnapshot.role : undefined,
    predictedConfidence: reviewItem?.confidence,
    predictedSnapshot,
    action: body.action,
    correctedSnapshot,
    reason: reviewItem?.reason,
  });

  return theme;
}
