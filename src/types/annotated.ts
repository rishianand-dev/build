export const FIELD_SOURCES = ["ai", "manual", "capture"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const FIELD_STATUSES = ["ok", "needs_review"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/**
 * Wrapper required on every LLM-derived field so the builder UI can
 * distinguish AI-filled vs human-edited vs needs-review without extra lookups.
 */
export interface AnnotatedField<T> {
  value: T;
  source: FieldSource;
  confidence?: number;
  status: FieldStatus;
  reason?: string;
}

export function okField<T>(
  value: T,
  source: FieldSource,
  confidence?: number,
): AnnotatedField<T> {
  return { value, source, confidence, status: "ok" };
}

export function reviewField<T>(
  value: T,
  source: FieldSource,
  reason: string,
  confidence?: number,
): AnnotatedField<T> {
  return { value, source, confidence, status: "needs_review", reason };
}
