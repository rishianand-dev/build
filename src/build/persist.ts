import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageCapture } from "../types/page-capture.js";
import { compactTheme, stringifyTheme } from "../schema/compact.js";
import { applyVisionFallback } from "./from-vision.js";
import { fetchFigmaImportInput, themeFromFigma, type FetchFigmaImportOptions } from "./from-figma.js";
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

/**
 * Figma counterpart to `persistBuild`. No vision fallback — `themeFromFigma`
 * never registers vision candidates (it always has real structure to map,
 * unlike a DOM-less capture), so there's nothing for that pass to do.
 * Synthesizes a `capture.json` shaped like a real DOM capture's (with
 * `dom: null` and Figma's frame render standing in for `viewport_top`) so
 * the rest of the server (capture listing/thumbnails, the `/file/` route)
 * needs no Figma-specific branching — see the module doc in from-figma.ts.
 */
export async function persistBuildFromFigma(
  outDir: string,
  options: FetchFigmaImportOptions,
): Promise<{ theme: ThemeDoc; capture: PageCapture }> {
  const { input, screenshotPng } = await fetchFigmaImportInput(options);

  await mkdir(join(outDir, "screenshots"), { recursive: true });
  const viewportTopRel = "screenshots/viewport-top.png";
  if (screenshotPng) await writeFile(join(outDir, viewportTopRel), screenshotPng);

  const theme = await rehostThemeAssets(compactTheme(themeFromFigma(input)));

  const capture: PageCapture = {
    schema_version: "1.0",
    url: input.sourceUrl,
    final_url: input.sourceUrl,
    captured_at: new Date().toISOString(),
    title: input.title,
    viewport: { width: 1440, height: 900 },
    page_metrics: { scroll_width: 1440, scroll_height: 900 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: {
      full_page: screenshotPng ? viewportTopRel : "",
      viewport_top: screenshotPng ? viewportTopRel : "",
      scroll_600: "",
      scroll_back: "",
      hovers: [],
    },
    assets: [],
    theme_hints: { background_color: "", text_color: "", fonts: [], color_palette: [], css_variables: {} },
    header_behavior: {
      sticky_or_fixed: false,
      lock_height_enable: false,
      always_fixed_on_scroll: false,
      reappear_on_scroll_up: false,
      document_flow: true,
      confidence: 0,
      evidence: ["Figma import — no live page to probe scroll behavior"],
      probe: null,
    },
    hover_reveals: [],
    candidate_blocks: [],
    warnings: screenshotPng ? [] : ["Figma frame render failed or was unavailable — no screenshot substitute"],
    dom: null,
  };
  await writeFile(join(outDir, "capture.json"), JSON.stringify(capture, null, 2), "utf8");
  await writeFile(join(outDir, "theme.json"), stringifyTheme(theme, true), "utf8");
  await writeFile(join(outDir, "site.html"), renderThemeHtml(theme, "home", { pages: "all" }), "utf8");
  return { theme, capture };
}
