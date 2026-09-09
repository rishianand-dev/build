/**
 * Pixel-level comparison between the real capture screenshot and the
 * current render, so the pixel-match loop has a real number to converge on
 * and a real place to look — not "looks about right." Pure-JS (pixelmatch +
 * pngjs), no native deps.
 */
import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffResult {
  /** 0 = identical, 1 = completely different. */
  diffRatio: number;
  width: number;
  height: number;
  /** Per-row mismatch counts, for locating which vertical band is worst. */
  rowMismatch: number[];
  diffPngPath?: string;
}

export interface Band {
  yStart: number;
  yEnd: number;
  diffRatio: number;
}

function resizeCanvas(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(255); // pad with white, not black, so padding doesn't read as "different"
  PNG.bitblt(png, out, 0, 0, Math.min(png.width, width), Math.min(png.height, height), 0, 0);
  return out;
}

/**
 * Compares two PNG files, top-aligned, padded/cropped to a shared canvas
 * (real pages and re-renders rarely match height exactly — that's not
 * itself a failure worth counting pixel-by-pixel).
 */
export async function diffScreenshots(
  actualPngPath: string,
  generatedPngPath: string,
  diffOutPath?: string,
): Promise<DiffResult> {
  const [actualBuf, generatedBuf] = await Promise.all([
    readFile(actualPngPath),
    readFile(generatedPngPath),
  ]);
  const actual = PNG.sync.read(actualBuf);
  const generated = PNG.sync.read(generatedBuf);

  const width = Math.max(actual.width, generated.width);
  const height = Math.min(Math.max(actual.height, generated.height), 20_000);

  const a = resizeCanvas(actual, width, height);
  const b = resizeCanvas(generated, width, height);
  const diff = new PNG({ width, height });

  // diffMask: true => pixelmatch leaves every matching pixel fully
  // transparent and only paints differing pixels, so "alpha !== 0" is
  // exactly "this pixel differs" — no color-guessing needed.
  pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.15,
    includeAA: false,
    diffMask: true,
  });

  const rowMismatch: number[] = new Array(height).fill(0);
  let totalMismatch = 0;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (diff.data[idx + 3] !== 0) row++;
    }
    rowMismatch[y] = row;
    totalMismatch += row;
  }

  let diffPngPath: string | undefined;
  if (diffOutPath) {
    await writeFile(diffOutPath, PNG.sync.write(diff));
    diffPngPath = diffOutPath;
  }

  const totalPx = width * height;
  return {
    diffRatio: totalPx > 0 ? totalMismatch / totalPx : 1,
    width,
    height,
    rowMismatch,
    diffPngPath,
  };
}

/**
 * Finds contiguous runs of rows whose mismatch density stays above
 * `minDensity` (fraction of that row's pixels that differ), merging small
 * gaps so one section with a few clean rows in the middle doesn't split
 * into fragments. Returns the `limit` worst runs, worst first, so a caller
 * can fall through to the next-worst band when the worst one turns out to
 * be a dead end (already tried, didn't help).
 */
export function worstBands(diff: DiffResult, minDensity = 0.08, mergeGapPx = 24, limit = 5): Band[] {
  const threshold = diff.width * minDensity;
  const runs: Array<{ yStart: number; yEnd: number; mismatch: number }> = [];
  let current: { yStart: number; yEnd: number; mismatch: number } | null = null;
  let gap = 0;

  for (let y = 0; y < diff.rowMismatch.length; y++) {
    const hot = diff.rowMismatch[y]! >= threshold;
    if (hot) {
      if (current && gap <= mergeGapPx) {
        current.yEnd = y;
        current.mismatch += diff.rowMismatch[y]!;
      } else {
        if (current) runs.push(current);
        current = { yStart: y, yEnd: y, mismatch: diff.rowMismatch[y]! };
      }
      gap = 0;
    } else if (current) {
      gap++;
    }
  }
  if (current) runs.push(current);

  return runs
    .sort((a, b) => b.mismatch - a.mismatch)
    .slice(0, limit)
    .map((run) => {
      const bandHeight = run.yEnd - run.yStart + 1;
      const bandPx = bandHeight * diff.width;
      return { yStart: run.yStart, yEnd: run.yEnd, diffRatio: bandPx > 0 ? run.mismatch / bandPx : 0 };
    });
}

/** Convenience: just the single worst band, or null if nothing crosses the threshold. */
export function worstBand(diff: DiffResult, minDensity = 0.08, mergeGapPx = 24): Band | null {
  return worstBands(diff, minDensity, mergeGapPx, 1)[0] ?? null;
}

/**
 * Crops a PNG file to a vertical band (full width) and returns it as a
 * base64-encoded PNG, for handing a focused region — not the whole page —
 * to a vision model. Clamps to the source image's actual bounds so a band
 * computed against a taller image (e.g. the real page) doesn't error out
 * when applied to a shorter one (e.g. a still-thin generated render).
 */
export async function cropPngToBase64(pngPath: string, yStart: number, yEnd: number): Promise<string> {
  const src = PNG.sync.read(await readFile(pngPath));
  const top = Math.max(0, Math.min(yStart, src.height));
  const bottom = Math.max(top + 1, Math.min(yEnd, src.height));
  const height = bottom - top;
  const out = new PNG({ width: src.width, height });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, top, src.width, height, 0, 0);
  return PNG.sync.write(out).toString("base64");
}
