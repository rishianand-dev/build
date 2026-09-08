import { getPool, migrate } from "./db.js";

/**
 * One row per accept/edit/reject a human makes in the review UI on a
 * heuristic/vision/Figma-derived node — the training-data source for
 * workstream 6's classifier (predicted vs. corrected role/content).
 */
export interface CorrectionInput {
  userId: string;
  captureId: string;
  nodePath: string;
  detector?: string;
  predictedRole?: string;
  predictedConfidence?: number;
  predictedSnapshot: unknown;
  action: "accept" | "edit" | "reject";
  correctedSnapshot?: unknown;
  reason?: string;
}

/** Best-effort classification of which pipeline produced a ReviewItem, from its `reason` text —
 * not a stored/typed field on ReviewItem itself (see the review-endpoint's doc comment for why). */
export function inferDetector(reason: string | undefined): string {
  if (!reason) return "dom-heuristic";
  if (reason.startsWith("vision:")) return "vision";
  if (/figma import/i.test(reason)) return "figma";
  return "dom-heuristic";
}

export async function recordCorrection(input: CorrectionInput): Promise<void> {
  await migrate();
  await getPool().query(
    `INSERT INTO corrections (
       user_id, capture_id, node_path, detector, predicted_role,
       predicted_confidence, predicted_snapshot, action, corrected_snapshot, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
    [
      input.userId,
      input.captureId,
      input.nodePath,
      input.detector ?? null,
      input.predictedRole ?? null,
      input.predictedConfidence ?? null,
      JSON.stringify(input.predictedSnapshot),
      input.action,
      input.correctedSnapshot !== undefined ? JSON.stringify(input.correctedSnapshot) : null,
      input.reason ?? null,
    ],
  );
}
