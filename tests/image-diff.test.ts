import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { diffScreenshots, worstBand } from "../src/build/image-diff.js";

function writePng(path: string, width: number, height: number, paint: (x: number, y: number) => [number, number, number]): void {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const [r, g, b] = paint(x, y);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

describe("diffScreenshots + worstBand", () => {
  it("reports ~0 diff for identical images", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diff-test-"));
    const a = join(dir, "a.png");
    const b = join(dir, "b.png");
    writePng(a, 40, 40, () => [255, 255, 255]);
    writePng(b, 40, 40, () => [255, 255, 255]);
    const result = await diffScreenshots(a, b);
    expect(result.diffRatio).toBeLessThan(0.01);
  });

  it("locates the mismatched band when only one region of the image differs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diff-test-"));
    const a = join(dir, "a.png");
    const b = join(dir, "b.png");
    const width = 40;
    const height = 100;
    // Real image: solid white. Generated: a red block from y=30..50 (the "wrong" region).
    writePng(a, width, height, () => [255, 255, 255]);
    writePng(b, width, height, (_x, y) => (y >= 30 && y < 50 ? [255, 0, 0] : [255, 255, 255]));
    const diffPath = join(dir, "diff.png");
    const result = await diffScreenshots(a, b, diffPath);
    expect(result.diffRatio).toBeGreaterThan(0.15);
    expect(result.diffRatio).toBeLessThan(0.25);

    const band = worstBand(result, 0.5);
    expect(band).not.toBeNull();
    expect(band!.yStart).toBeGreaterThanOrEqual(28);
    expect(band!.yStart).toBeLessThanOrEqual(32);
    expect(band!.yEnd).toBeGreaterThanOrEqual(48);
    expect(band!.yEnd).toBeLessThanOrEqual(52);
  });

  it("returns null from worstBand when nothing crosses the density threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diff-test-"));
    const a = join(dir, "a.png");
    const b = join(dir, "b.png");
    writePng(a, 40, 40, () => [255, 255, 255]);
    // One lone differing pixel per row is far below any reasonable density threshold.
    writePng(b, 40, 40, (x, y) => (x === 0 && y % 5 === 0 ? [0, 0, 0] : [255, 255, 255]));
    const result = await diffScreenshots(a, b);
    expect(worstBand(result, 0.5)).toBeNull();
  });
});
