/**
 * Closes the asset-hotlinking gap: downloads bytes for every asset a built
 * `ThemeDoc` actually references and stores them in a shared, content-
 * addressed store (`data/assets/<sha256>.<ext>`), rewriting `Asset.url` to
 * point at our own `/api/assets/:filename` route instead of the source
 * site's CDN.
 *
 * Runs as a single post-pass over `theme.assets` after `compactTheme`,
 * rather than threading async downloads through every heuristic in
 * from-capture.ts's `buildBlock` chain: by the time `themeFromCapture`
 * returns, `theme.assets` already holds exactly the deduped set of URLs
 * that survived into the built tree, so a post-pass downloads the same
 * set a fully-async intern-time approach would, with far less invasive
 * change to a ~1400-line heuristic file. Any asset a URL fails to
 * download for is left hotlinked (graceful degradation, not a build
 * failure) — a later garbage-collection pass (using the impact index)
 * is the place to notice and retry/report these, not this pass.
 */

import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { ThemeDoc } from "../schema/theme.js";

export const ASSETS_ROOT = resolve(process.cwd(), "data/assets");

const CONCURRENCY = 6;

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "font/woff2": "woff2",
  "font/woff": "woff",
};

function extFromContentType(contentType: string | null): string | undefined {
  if (!contentType) return undefined;
  return EXT_BY_CONTENT_TYPE[contentType.split(";")[0]!.trim().toLowerCase()];
}

function extFromUrl(url: string): string | undefined {
  try {
    const ext = extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : undefined;
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A URL captured from a live page is not guaranteed absolute — e.g. an
 * `<img srcset>` candidate reflects its attribute text verbatim, unresolved,
 * unlike `.src`/`.currentSrc` — so a root-relative asset URL can still slip
 * through to here. Resolve it against the theme's source page instead of
 * silently declining to rehost it.
 */
function resolveAssetUrl(url: string, base: string | undefined): string {
  if (/^https?:\/\//i.test(url) || !base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Downloads one URL, writes it into the content-addressed store, and returns its served path. Returns null on any failure or when the URL isn't remote. */
export async function rehostOne(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const hash = createHash("sha256").update(buf).digest("hex");
    const ext = extFromContentType(res.headers.get("content-type")) ?? extFromUrl(url) ?? "bin";
    const filename = `${hash}.${ext}`;
    const dest = join(ASSETS_ROOT, filename);
    if (!(await fileExists(dest))) {
      await mkdir(ASSETS_ROOT, { recursive: true });
      await writeFile(dest, buf);
    }
    return `/api/assets/${filename}`;
  } catch {
    return null;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Rehosts every asset a theme references, in place. Failures leave the
 * original (hotlinked) URL untouched. `theme.assets` may be missing at
 * runtime (compactTheme's `prune()` drops empty-object fields), so this
 * guards rather than assuming the type's non-optional `assets` holds.
 */
export async function rehostThemeAssets(theme: ThemeDoc): Promise<ThemeDoc> {
  const assets = theme.assets ?? {};
  const entries = Object.entries(assets);
  if (!entries.length) return theme;
  const base = theme.site.source;
  await mapLimit(entries, CONCURRENCY, async ([id, asset]) => {
    const hosted = await rehostOne(resolveAssetUrl(asset.url, base));
    if (hosted) assets[id] = { ...asset, url: hosted };
  });
  theme.assets = assets;
  return theme;
}
