import type { ThemeDoc } from "../schema/theme.js";
import { getPool, migrate } from "./db.js";

export interface ThemeRecord {
  id: string;
  user_id: string;
  capture_id: string;
  url: string;
  final_url: string;
  title: string;
  theme: ThemeDoc;
  blocks: number;
  assets: number;
  warnings: number;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: {
  id: string;
  user_id: string;
  capture_id: string;
  url: string;
  final_url: string;
  title: string;
  theme: ThemeDoc | string;
  blocks: number;
  assets: number;
  warnings: number;
  captured_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}): ThemeRecord {
  return {
    ...row,
    theme: typeof row.theme === "string" ? (JSON.parse(row.theme) as ThemeDoc) : row.theme,
    captured_at: iso(row.captured_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function saveUserTheme(input: {
  userId: string;
  captureId: string;
  url: string;
  finalUrl: string;
  title: string;
  theme: ThemeDoc;
  blocks: number;
  assets: number;
  warnings: number;
  capturedAt: string;
}): Promise<ThemeRecord> {
  await migrate();
  const result = await getPool().query<{
    id: string;
    user_id: string;
    capture_id: string;
    url: string;
    final_url: string;
    title: string;
    theme: ThemeDoc;
    blocks: number;
    assets: number;
    warnings: number;
    captured_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `INSERT INTO themes (
       user_id, capture_id, url, final_url, title, theme,
       blocks, assets, warnings, captured_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (user_id, capture_id)
     DO UPDATE SET
       url = EXCLUDED.url,
       final_url = EXCLUDED.final_url,
       title = EXCLUDED.title,
       theme = EXCLUDED.theme,
       blocks = EXCLUDED.blocks,
       assets = EXCLUDED.assets,
       warnings = EXCLUDED.warnings,
       captured_at = EXCLUDED.captured_at,
       updated_at = now()
     RETURNING *`,
    [
      input.userId,
      input.captureId,
      input.url,
      input.finalUrl,
      input.title,
      JSON.stringify(input.theme),
      input.blocks,
      input.assets,
      input.warnings,
      input.capturedAt,
    ],
  );
  return mapRow(result.rows[0]!);
}

export async function listUserThemes(userId: string): Promise<ThemeRecord[]> {
  await migrate();
  const result = await getPool().query<{
    id: string;
    user_id: string;
    capture_id: string;
    url: string;
    final_url: string;
    title: string;
    theme: ThemeDoc;
    blocks: number;
    assets: number;
    warnings: number;
    captured_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT * FROM themes WHERE user_id = $1 ORDER BY captured_at DESC`,
    [userId],
  );
  return result.rows.map(mapRow);
}

export async function getUserTheme(userId: string, captureId: string): Promise<ThemeRecord | null> {
  await migrate();
  const result = await getPool().query<{
    id: string;
    user_id: string;
    capture_id: string;
    url: string;
    final_url: string;
    title: string;
    theme: ThemeDoc;
    blocks: number;
    assets: number;
    warnings: number;
    captured_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT * FROM themes WHERE user_id = $1 AND capture_id = $2`,
    [userId, captureId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function deleteUserTheme(userId: string, captureId: string): Promise<boolean> {
  await migrate();
  const result = await getPool().query(`DELETE FROM themes WHERE user_id = $1 AND capture_id = $2`, [
    userId,
    captureId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function captureIdInUse(captureId: string): Promise<boolean> {
  await migrate();
  const result = await getPool().query(`SELECT 1 FROM themes WHERE capture_id = $1 LIMIT 1`, [captureId]);
  return result.rows.length > 0;
}

export async function updateThemeByCaptureId(captureId: string, theme: ThemeDoc): Promise<number> {
  await migrate();
  const result = await getPool().query(`UPDATE themes SET theme = $1::jsonb, updated_at = now() WHERE capture_id = $2`, [
    JSON.stringify(theme),
    captureId,
  ]);
  return result.rowCount ?? 0;
}
