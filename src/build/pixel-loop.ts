/**
 * The pixel-match loop: build -> render -> screenshot -> diff against the
 * real capture -> for the worst-mismatched region, ask a local vision
 * model what's actually different (missing section? wrong component type?
 * layout? style?) -> turn that answer into a real, persisted identifier
 * rule (tag/class/id/text pattern -> role, in learned-patterns.ts) so the
 * *next* build — this run and every run after — can detect the same shape
 * without re-discovering it -> re-derive the region from its real HTML/CSS
 * (now pattern-aware) -> splice (or insert, if the section had no
 * counterpart in the render at all) -> repeat.
 *
 * The learning is real and persistent: it's a JSON file of explicit,
 * inspectable matchers (data/learned-patterns.json) consulted by
 * from-capture.ts's buildBlock on every future build, not a value that
 * lives only inside this one run.
 *
 * Deliberately separate from persist.ts's normal build path: this mutates
 * a *working copy* of a theme for one experimental run and never touches
 * the theme a capture's normal Studio/Review view reads.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { themeFromCapture } from "./from-capture.js";
import { renderThemeHtml } from "./render-html.js";
import { diffScreenshots, worstBands, type Band } from "./image-diff.js";
import { findSectionAtBand, listSections, topLevelSectionIndex } from "./find-section-at.js";
import { findKeywordEvidence, type KeywordEvidence } from "./section-keywords.js";
import { deriveMatchers, saveLearnedPattern, type Matcher } from "./learned-patterns.js";
import { describeDiff, type DiffDescription } from "./vision-diff.js";
import { ollamaReachable } from "./ollama.js";
import { insertChildAtPath, mergeSubtreeIntoTheme, replaceNodeAtPath } from "./merge-subtree.js";
import { ASSETS_ROOT } from "./rehost-assets.js";
import { resolveNodeAtPath, stringifyTheme } from "../schema/compact.js";
import type { Node, ThemeDoc } from "../schema/theme.js";
import type { DomNode, PageCapture } from "../types/page-capture.js";

export interface IterationRecord {
  iteration: number;
  diffRatio: number;
  band: Band | null;
  patchedPath: string | null;
  keywordEvidence: KeywordEvidence[];
  screenshotPath: string;
  diffPngPath: string;
  /** The local vision model's read on this band, when reachable — "what's
   * actually different," not just "pixels differ." */
  visionDescription?: DiffDescription;
  /** Set when this iteration turned that vision read into a new (or
   * reinforced) persisted identifier rule. */
  learnedPattern?: { role: string; matchers: Matcher[]; hits: number };
  note?: string;
}

export interface RunOptions {
  /** Safety ceiling — the loop stops here even if it hasn't converged.
   * "Again and again till perfect" still needs a bound so a page that can
   * never fully converge (e.g. real content the heuristics can't produce)
   * doesn't run forever. Default 20. */
  maxIterations?: number;
  /** Stop early once overall diffRatio drops to/below this. Default 0.03. */
  goodEnoughDiffRatio?: number;
  /** Row mismatch density (fraction of a row's pixels) to count as "part of
   * the worst band." Default 0.08. */
  minBandDensity?: number;
  /** Local Ollama vision model for diff description + pattern learning.
   * When unreachable, the loop still runs — it just falls back to
   * heuristic-only re-derivation with no new learning, same as before this
   * capability existed. */
  model?: string;
  host?: string;
  onIteration?: (record: IterationRecord) => void;
}

export interface RunResult {
  theme: ThemeDoc;
  history: IterationRecord[];
  converged: boolean;
}

const BASE_STYLE = {
  display: "block",
  position: "static",
  top: "auto",
  left: "auto",
  right: "auto",
  bottom: "auto",
  zIndex: "auto",
  overflow: "visible",
  opacity: "1",
  visibility: "visible",
  transform: "none",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  color: "rgb(0,0,0)",
  fontFamily: "Georgia",
  fontSize: "16px",
  fontWeight: "400",
  lineHeight: "1.4",
  textAlign: "left",
  padding: "0",
  margin: "0",
  borderRadius: "0",
  boxShadow: "none",
  flexDirection: "row",
  justifyContent: "flex-start",
  alignItems: "stretch",
  gap: "0",
  gridTemplateColumns: "none",
} as const;

/** Wraps one real DOM section in a synthetic single-section capture, so
 * themeFromCapture's real heuristics get an unambiguous, isolated shot at
 * it — no header-probe/hover/candidate-block signals from the original
 * full-page capture carried over, since those all reference positions and
 * selectors that are meaningless (or actively misleading) once isolated. */
function isolateSectionCapture(capture: PageCapture, section: DomNode): PageCapture {
  const body: DomNode = {
    tag: "body",
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: capture.viewport.width, height: section.box.height },
    style: { ...BASE_STYLE },
    children: [section],
  };
  return {
    ...capture,
    dom: body,
    hover_reveals: [],
    candidate_blocks: [],
    header_behavior: {
      sticky_or_fixed: false,
      lock_height_enable: false,
      always_fixed_on_scroll: false,
      reappear_on_scroll_up: false,
      document_flow: true,
      confidence: 0,
      evidence: [],
      probe: null,
    },
  };
}

interface TaggedBox {
  path: string;
  y: number;
  height: number;
}

/** A synthetic origin for `renderIntoPage`'s document route — any URL works,
 * as long as it's the same one this loop's own routes are registered
 * against and the one it navigates to each iteration. */
const PIXEL_MATCH_ORIGIN = "http://pixel-match.local/";

/**
 * `page.setContent(html)` leaves the document at `about:blank`, which has
 * no valid origin to resolve a root-relative URL against — a rehosted
 * asset reference like `src="/api/assets/<hash>.webm"` (what
 * `renderThemeHtml` emits; there's no running app server in this loop to
 * point an `assetBase` at instead) never even reaches the network layer,
 * confirmed by instrumenting Playwright's own request events: zero
 * requests fire for it. Every image/video across the whole rendered page
 * is therefore invisible in every iteration's screenshot regardless of how
 * correctly it was classified — routing the page through a real (synthetic)
 * origin and serving `/api/assets/*` from the local content-addressed
 * store fixes that.
 */
async function installAssetRouting(page: Page): Promise<void> {
  await page.route("**/api/assets/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const filename = pathname.replace(/^\/api\/assets\//, "");
    if (!filename || filename.includes("/") || filename.includes("..")) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    try {
      await route.fulfill({ path: join(ASSETS_ROOT, filename) });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
}

/** Serves `html` as the document at PIXEL_MATCH_ORIGIN, so relative asset
 * URLs resolve against a real origin instead of `about:blank`. */
async function renderIntoPage(page: Page, html: string): Promise<void> {
  await page.unroute(PIXEL_MATCH_ORIGIN).catch(() => undefined);
  await page.route(PIXEL_MATCH_ORIGIN, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  await page.goto(PIXEL_MATCH_ORIGIN, { waitUntil: "load", timeout: 30_000 });
}

/**
 * An autoplaying <video> (e.g. a hero background) hasn't painted a frame
 * the instant `page.setContent` resolves — a screenshot taken immediately
 * after shows only the page background behind it. Wait for each video to
 * reach a paintable frame (readyState >= HAVE_CURRENT_DATA), capped so a
 * video that never loads (offline capture, broken asset) can't hang the
 * loop indefinitely.
 */
async function waitForVideoFrames(page: Page, timeoutMs = 4000): Promise<void> {
  await page
    .$$eval(
      "video",
      (vids, timeout) =>
        Promise.all(
          vids.map((v) =>
            v.readyState >= 2
              ? undefined
              : new Promise<void>((resolve) => {
                  const done = () => resolve();
                  v.addEventListener("loadeddata", done, { once: true });
                  setTimeout(done, timeout);
                }),
          ),
        ),
      timeoutMs,
    )
    .catch(() => undefined);
}

async function collectTaggedBoxes(page: Page): Promise<TaggedBox[]> {
  return page.$$eval("[data-tp]", (els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { path: el.getAttribute("data-tp") ?? "", y: rect.top, height: rect.height };
    }),
  );
}

/** Picks the most specific (smallest, non-root-preferred) tagged element
 * whose box overlaps the band at all. */
function pickTarget(boxes: TaggedBox[], band: Band): TaggedBox | null {
  let best: TaggedBox | null = null;
  for (const box of boxes) {
    const top = Math.max(box.y, band.yStart);
    const bottom = Math.min(box.y + box.height, band.yEnd);
    if (bottom <= top) continue;
    if (!best || box.height < best.height) best = box;
  }
  return best;
}

function canonicalNode(node: Node): string {
  return JSON.stringify(node);
}

export async function runPixelMatchLoop(
  captureDir: string,
  capture: PageCapture,
  initialTheme: ThemeDoc,
  opts: RunOptions = {},
): Promise<RunResult> {
  const maxIterations = opts.maxIterations ?? 20;
  const goodEnough = opts.goodEnoughDiffRatio ?? 0.03;
  const minBandDensity = opts.minBandDensity ?? 0.08;
  const visionEnabled = await ollamaReachable(opts.host);

  const outDir = resolve(captureDir, "pixel-match");
  await mkdir(outDir, { recursive: true });
  const actualScreenshotPath = resolve(captureDir, capture.screenshots.full_page);

  const theme: ThemeDoc = structuredClone(initialTheme);
  const history: IterationRecord[] = [];
  let converged = false;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: capture.viewport });
    await installAssetRouting(page);

    // Snapshot of `theme` from immediately before the most recent patch was
    // applied, so a patch that turns out to have made things worse (real,
    // observed behavior — a reclassification isn't guaranteed to be an
    // improvement just because it ran) can be undone rather than kept.
    let prePatchSnapshot: ThemeDoc | null = null;
    let previousDiffRatio: number | null = null;
    let lastPatchedPath: string | null = null;
    // Paths that already turned out to be a dead end (made things worse, or
    // re-derivation matched what was already there) — skipped in future band
    // selection so the loop moves on to the next-worst region instead of
    // retrying (or fully giving up on) the same one.
    const deadEndPaths = new Set<string>();

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const iterDir = join(outDir, `iteration-${iteration}`);
      await mkdir(iterDir, { recursive: true });

      const html = renderThemeHtml(theme, "home", { pages: "all", tagPaths: true });
      await writeFile(join(iterDir, "page.html"), html, "utf8");

      await renderIntoPage(page, html);
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForVideoFrames(page);
      const boxes = await collectTaggedBoxes(page);

      const screenshotAbsPath = join(iterDir, "screenshot.png");
      await page.screenshot({ path: screenshotAbsPath, fullPage: true, animations: "disabled" });

      const diffPngAbsPath = join(iterDir, "diff.png");
      const diff = await diffScreenshots(actualScreenshotPath, screenshotAbsPath, diffPngAbsPath);

      const record: IterationRecord = {
        iteration,
        diffRatio: diff.diffRatio,
        band: null,
        patchedPath: null,
        keywordEvidence: [],
        screenshotPath: relTo(captureDir, screenshotAbsPath),
        diffPngPath: relTo(captureDir, diffPngAbsPath),
      };

      if (previousDiffRatio !== null && diff.diffRatio > previousDiffRatio && prePatchSnapshot) {
        Object.assign(theme, prePatchSnapshot);
        if (lastPatchedPath) deadEndPaths.add(lastPatchedPath);
        record.note = `last patch made the match worse (${(previousDiffRatio * 100).toFixed(1)}% -> ${(diff.diffRatio * 100).toFixed(1)}%) — reverted it, marked ${lastPatchedPath} as a dead end, trying the next-worst region`;
        record.diffRatio = previousDiffRatio;
        previousDiffRatio = null;
        prePatchSnapshot = null;
        lastPatchedPath = null;
        history.push(record);
        opts.onIteration?.(record);
        continue;
      }

      if (diff.diffRatio <= goodEnough) {
        record.note = "converged: overall pixel diff at/under threshold";
        history.push(record);
        opts.onIteration?.(record);
        converged = true;
        break;
      }

      const candidates = worstBands(diff, minBandDensity, 24, 5);
      if (!candidates.length) {
        record.note = "no localizable mismatched band left — stopping";
        history.push(record);
        opts.onIteration?.(record);
        break;
      }

      let applied = false;
      let visionCallsThisIteration = 0;
      for (const band of candidates) {
        const target = pickTarget(boxes, band);
        const realSection = capture.dom ? findSectionAtBand(capture.dom, band.yStart, band.yEnd) : null;
        if (!realSection) continue;

        // The top-level *ancestor* position (not realSection's own index —
        // it may be a drilled-down descendant of a disproportionately
        // large top-level section, see find-section-at.ts) is what "insert
        // at the right position among the page's top-level children"
        // actually needs.
        const topLevelIndex = capture.dom ? topLevelSectionIndex(capture.dom, realSection) : -1;
        const targetKey = target ? target.path : `insert:${topLevelIndex}`;
        if (deadEndPaths.has(targetKey)) continue;

        // Ask the local vision model what's actually different in this
        // band — at most once per iteration, since it's the slow step.
        // Missing entirely, so nothing rendered here yet, is itself real
        // signal: treat it as "missing_section" without spending a model
        // call confirming the obvious.
        let visionResult: DiffDescription | undefined;
        if (!target) {
          visionResult = { issue: "missing_section", suspectedRole: null, description: "No rendered element covers this region at all." };
        } else if (visionEnabled && visionCallsThisIteration === 0) {
          visionCallsThisIteration++;
          const result = await describeDiff({
            actualPngPath: actualScreenshotPath,
            generatedPngPath: screenshotAbsPath,
            yStart: band.yStart,
            yEnd: band.yEnd,
            model: opts.model,
            host: opts.host,
          });
          if (result) visionResult = result;
        }
        if (visionResult) record.visionDescription = visionResult;

        // Turn a semantic finding into a real, persisted identifier rule —
        // this is the actual learning step: real tag/class/id/text signals
        // from this real section, stored so the *next* build (this one and
        // every future one) can recognize the same shape on its own.
        if (visionResult && visionResult.issue !== "none" && visionResult.suspectedRole) {
          const matchers = deriveMatchers(realSection);
          if (matchers.length) {
            const classAttr = realSection.className ? `.${realSection.className.split(/\s+/)[0]}` : "";
            const saved = await saveLearnedPattern({
              role: visionResult.suspectedRole,
              matchers,
              confidence: 0.55,
              source: "pixel-loop+vision",
              example: `${realSection.tag}${classAttr} — "${visionResult.description}"`,
            });
            if (saved) record.learnedPattern = { role: saved.role, matchers: saved.matchers, hits: saved.hits };
          }
        }

        let miniTheme: ThemeDoc;
        try {
          miniTheme = themeFromCapture(isolateSectionCapture(capture, realSection));
        } catch {
          deadEndPaths.add(targetKey);
          continue;
        }
        const miniRoot = miniTheme.pages[0]?.root;
        if (!miniRoot) {
          deadEndPaths.add(targetKey);
          continue;
        }
        // A stack with exactly one child is just isolation-wrapper noise —
        // splice the real content directly rather than double-nesting stacks.
        const replacementSource =
          miniRoot.type === "stack" && miniRoot.children.length === 1 ? miniRoot.children[0]! : miniRoot;
        const merged = mergeSubtreeIntoTheme(theme, miniTheme, replacementSource);

        if (target) {
          const currentNode = resolveNodeAtPath(theme, target.path);
          if (currentNode && canonicalNode(currentNode) === canonicalNode(merged)) {
            deadEndPaths.add(targetKey);
            continue;
          }
          prePatchSnapshot = structuredClone(theme);
          previousDiffRatio = diff.diffRatio;
          lastPatchedPath = targetKey;
          if (!replaceNodeAtPath(theme, target.path, merged)) {
            prePatchSnapshot = null;
            previousDiffRatio = null;
            lastPatchedPath = null;
            deadEndPaths.add(targetKey);
            continue;
          }
          record.patchedPath = target.path;
        } else {
          // Nothing in the render corresponds to this real section at
          // all — insert it at the position its real document order
          // implies, instead of trying (and failing) to replace nothing.
          const root = theme.pages[0]?.root;
          const rootLen = root && "children" in root ? root.children.length : 0;
          const totalSections = capture.dom ? listSections(capture.dom).length : 0;
          const proportion = topLevelIndex >= 0 && totalSections > 1 ? topLevelIndex / (totalSections - 1) : 0;
          const insertIndex = Math.round(proportion * rootLen);

          prePatchSnapshot = structuredClone(theme);
          previousDiffRatio = diff.diffRatio;
          lastPatchedPath = targetKey;
          if (!insertChildAtPath(theme, "/pages/0/root", insertIndex, merged)) {
            prePatchSnapshot = null;
            previousDiffRatio = null;
            lastPatchedPath = null;
            deadEndPaths.add(targetKey);
            continue;
          }
          record.patchedPath = `insert@/pages/0/root/children/${insertIndex}`;
        }

        record.band = band;
        record.keywordEvidence = findKeywordEvidence(realSection);
        applied = true;
        break;
      }

      if (!applied) {
        record.note = "every candidate region this iteration was a dead end — stopping";
        history.push(record);
        opts.onIteration?.(record);
        break;
      }

      history.push(record);
      opts.onIteration?.(record);
    }
  } finally {
    await browser?.close();
  }

  await writeFile(join(outDir, "theme.json"), stringifyTheme(theme, true), "utf8");
  await writeFile(
    join(outDir, "site.html"),
    renderThemeHtml(theme, "home", { pages: "all" }),
    "utf8",
  );
  await writeFile(join(outDir, "history.json"), JSON.stringify(history, null, 2), "utf8");

  return { theme, history, converged };
}

function relTo(base: string, absPath: string): string {
  const baseAbs = resolve(base);
  return absPath.startsWith(baseAbs) ? absPath.slice(baseAbs.length + 1) : absPath;
}
