import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageCapture } from "../types/page-capture.js";
import { stringifyTheme } from "../schema/compact.js";
import { themeFromCapture } from "./from-capture.js";
import { renderThemeHtml } from "./render-html.js";
import type { ThemeDoc } from "../schema/theme.js";

export async function persistBuild(outDir: string, capture: PageCapture): Promise<ThemeDoc> {
  const theme = themeFromCapture(capture);
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
