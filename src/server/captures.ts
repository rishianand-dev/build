import { createReadStream } from "node:fs";
import { access, readFile, rm, stat } from "node:fs/promises";
import { join, normalize, relative, resolve, sep } from "node:path";
import type { PageCapture } from "../types/page-capture.js";
import { renderThemeHtml } from "../build/render-html.js";
import type { ThemeDoc } from "../schema/theme.js";
import { captureIdInUse, deleteUserTheme, getUserTheme, listUserThemes } from "./themes.js";

export const CAPTURES_ROOT = resolve(process.cwd(), "data/captures");

const ID_RE = /^[a-zA-Z0-9._-]+$/;

export function assertCaptureId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid capture id");
  return id;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CaptureSummary {
  id: string;
  title: string;
  url: string;
  final_url: string;
  captured_at: string;
  blocks: number;
  assets: number;
  warnings: number;
  thumb: string | null;
  has_site: boolean;
}

export function captureDir(id: string): string {
  return join(CAPTURES_ROOT, assertCaptureId(id));
}

async function requireOwned(userId: string, captureId: string) {
  const id = assertCaptureId(captureId);
  const row = await getUserTheme(userId, id);
  if (!row) throw new HttpError(404, "Capture not found");
  return row;
}

export async function listCaptures(userId: string): Promise<CaptureSummary[]> {
  const rows = await listUserThemes(userId);
  const summaries: CaptureSummary[] = [];
  for (const row of rows) {
    let thumb: string | null = null;
    try {
      const raw = await readFile(join(CAPTURES_ROOT, row.capture_id, "capture.json"), "utf8");
      const capture = JSON.parse(raw) as PageCapture;
      const thumbRel = capture.screenshots.viewport_top || capture.screenshots.full_page;
      thumb = thumbRel ? `/api/captures/${row.capture_id}/file/${thumbRel}` : null;
    } catch {
      thumb = null;
    }
    summaries.push({
      id: row.capture_id,
      title: row.title || row.capture_id,
      url: row.url,
      final_url: row.final_url,
      captured_at: row.captured_at,
      blocks: row.blocks,
      assets: row.assets,
      warnings: row.warnings,
      thumb,
      has_site: true,
    });
  }
  return summaries;
}

export async function readCapture(id: string, includeDom: boolean, userId: string): Promise<PageCapture> {
  await requireOwned(userId, id);
  const path = join(captureDir(id), "capture.json");
  const raw = await readFile(path, "utf8");
  const capture = JSON.parse(raw) as PageCapture;
  if (!includeDom) capture.dom = null;
  return capture;
}

export async function resolveCaptureFile(id: string, relPath: string, userId: string): Promise<string> {
  await requireOwned(userId, id);
  const root = captureDir(id);
  const cleaned = relPath.replace(/^\/+/, "");
  const abs = resolve(root, cleaned);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || normalize(rel).startsWith("..")) {
    throw new HttpError(400, "Invalid file path");
  }
  await access(abs);
  const info = await stat(abs);
  if (!info.isFile()) throw new HttpError(404, "Not a file");
  return abs;
}

export { createReadStream };

export async function ensureSite(id: string, userId: string): Promise<{ theme: ThemeDoc; html: string }> {
  const owned = await requireOwned(userId, id);
  return {
    theme: owned.theme,
    html: renderThemeHtml(owned.theme, "home", {
      assetBase: `/api/captures/${id}/file/`,
      pages: "all",
    }),
  };
}

export async function deleteCapture(id: string, userId: string): Promise<void> {
  const captureId = assertCaptureId(id);
  const removed = await deleteUserTheme(userId, captureId);
  if (!removed) throw new HttpError(404, "Capture not found");
  if (!(await captureIdInUse(captureId))) {
    await rm(captureDir(captureId), { recursive: true, force: true });
  }
}
