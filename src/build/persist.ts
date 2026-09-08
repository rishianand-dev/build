import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageCapture } from "../types/page-capture.js";
import { compactTheme, stringifyTheme } from "../schema/compact.js";
import { applyVisionFallback } from "./from-vision.js";
import { themeFromCapture } from "./from-capture.js";
import { rehostThemeAssets } from "./rehost-assets.js";
import { renderThemeHtml } from "./render-html.js";
import type { ThemeDoc } from "../schema/theme.js";

export async function persistBuild(outDir: string, capture: PageCapture): Promise<ThemeDoc> {
  // Vision fallback runs on the raw (pre-compaction) tree: candidate JSON
  // pointers are only valid against the tree themeFromCapture produced,
  // since compactTheme's promoteRepeats/collapseInstanceLists restructure
  // it (lifting repeats into components, collapsing sibling instances).
  let theme = await applyVisionFallback(themeFromCapture(capture), capture, outDir);
  theme = await rehostThemeAssets(compactTheme(theme));
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "theme.json"), stringifyTheme(theme, true), "utf8");
  await writeFile(join(outDir, "site.html"), renderThemeHtml(theme, "home", { pages: "all" }), "utf8");
  return theme;
}

export async function persistBuildFromDir(outDir: string): Promise<ThemeDoc> {
  const raw = await readFile(join(outDir, "capture.json"), "utf8");
  const capture = JSON.parse(raw) as PageCapture;
  return persistBuild(outDir, capture);
}
