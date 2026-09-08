import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { capturePage } from "../src/capture/capture.js";

describe("capturePage fixture", () => {
  it(
    "captures DOM, sticky header, candidate blocks, and hover reveal from a local page",
    { timeout: 60_000 },
    async () => {
      const url = pathToFileURL(
        join(process.cwd(), "tests/fixtures/sample.html"),
      ).href;
      const outDir = await mkdtemp(join(tmpdir(), "honebi-capture-"));
      const capture = await capturePage({ url, outDir, hoverCount: 3 });

      expect(capture.title).toBe("Fixture Store");
      expect(capture.dom?.tag).toBe("body");
      expect(capture.candidate_blocks.some((b) => b.tag === "header")).toBe(true);
      expect(capture.candidate_blocks.some((b) => b.tag === "footer")).toBe(true);
      expect(capture.header_behavior.sticky_or_fixed).toBe(true);
      expect(capture.header_behavior.always_fixed_on_scroll).toBe(true);
      expect(capture.hover_reveals.length).toBeGreaterThan(0);
      expect(capture.hover_reveals.some((h) => h.revealed)).toBe(true);
      expect(capture.hover_reveals.some((h) => /quick view/i.test(h.added_text))).toBe(true);
      expect(capture.hover_reveals.some((h) => h.kind === "nav" && h.added_links.length >= 2)).toBe(true);

      const raw = await readFile(join(outDir, "capture.json"), "utf8");
      const parsed = JSON.parse(raw) as { schema_version: string };
      expect(parsed.schema_version).toBe("1.0");
    },
  );
});
