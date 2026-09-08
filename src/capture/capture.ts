import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { inferHeaderBehavior } from "./header-behavior.js";
import { runInPage } from "./in-page.js";
import type {
  AssetRef,
  HeaderProbe,
  HoverReveal,
  PageCapture,
  ScreenshotPaths,
} from "../types/page-capture.js";

export interface CaptureProgress {
  step: string;
  detail?: string;
}

export interface CaptureOptions {
  url: string;
  outDir: string;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  maxDomNodes?: number;
  maxBlocks?: number;
  scrollPx?: number;
  hoverCount?: number;
  onProgress?: (event: CaptureProgress) => void;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function slugHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.replace(/[^a-z0-9.-]/gi, "-");
  } catch {
    return "site";
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function classifyAsset(url: string, contentType: string | null): AssetRef["resource_type"] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("image") || /\.(png|jpe?g|gif|webp|svg|avif|ico)(\?|$)/i.test(url)) {
    return "image";
  }
  if (ct.includes("font") || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)) return "font";
  if (ct.includes("css") || /\.css(\?|$)/i.test(url)) return "stylesheet";
  if (ct.includes("javascript") || /\.js(\?|$)/i.test(url)) return "script";
  return "other";
}

async function waitSettled(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    // Single-page apps often never reach networkidle; continue after a short pause.
  }
  await page.waitForTimeout(500);
}

async function triggerLazyLoad(page: Page): Promise<void> {
  const height = await page.evaluate(() =>
    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  );
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function screenshot(
  page: Page,
  dest: string,
  fullPage = false,
): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  await page.screenshot({ path: dest, fullPage, animations: "disabled" });
  return dest;
}

export async function capturePage(options: CaptureOptions): Promise<PageCapture> {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const scrollPx = options.scrollPx ?? 600;
  const hoverCount = options.hoverCount ?? 3;
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];
  const assets = new Map<string, AssetRef>();

  const runDir = resolve(options.outDir);
  const shotDir = join(runDir, "screenshots");
  await mkdir(shotDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    progress({ step: "launch", detail: "Starting Chromium" });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport,
      userAgent: USER_AGENT,
      locale: "en-US",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.addInitScript(() => {
      // tsx/esbuild keepNames helper is not present in the page; treat as identity.
      (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
    });

    page.on("response", (res) => {
      const url = res.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      const ct = res.headers()["content-type"] ?? null;
      const resource_type = classifyAsset(url, ct);
      if (resource_type === "other" || resource_type === "script") return;
      if (!assets.has(url)) {
        assets.set(url, { url, content_type: ct, resource_type });
      }
    });

    progress({ step: "navigate", detail: options.url });
    const response = await page.goto(options.url, { waitUntil: "domcontentloaded" });
    if (!response) warnings.push("Navigation returned no response");
    else if (!response.ok()) warnings.push(`HTTP ${response.status()} for ${options.url}`);

    await waitSettled(page);

    const dismissed = (await page.evaluate(runInPage, { op: "dismiss" as const })).dismissed;
    if (dismissed.length) {
      warnings.push(`Dismissed overlays: ${dismissed.join(", ")}`);
      await page.waitForTimeout(400);
    }

    progress({ step: "lazy-load", detail: "Scrolling to load images" });
    await triggerLazyLoad(page);
    await waitSettled(page);

    const rel = (abs: string) => relative(runDir, abs).replaceAll("\\", "/");

    const viewportTopPath = join(shotDir, "viewport-top.png");
    await screenshot(page, viewportTopPath);

    progress({ step: "header", detail: "Probing sticky / fixed header" });
    const headerInfo = (await page.evaluate(runInPage, { op: "headerCandidate" as const }))
      .headerCandidate;
    let headerProbe: HeaderProbe | null = null;

    if (headerInfo) {
      const top = (await page.evaluate(runInPage, { op: "probeHeader" as const, selector: headerInfo.selector }))
        .headerProbe;
      await screenshot(page, join(shotDir, "scroll-before.png"));

      await page.evaluate((y) => window.scrollTo(0, y), scrollPx);
      await page.waitForTimeout(500);
      const scrolled = (
        await page.evaluate(runInPage, { op: "probeHeader" as const, selector: headerInfo.selector })
      ).headerProbe;
      await screenshot(page, join(shotDir, "scroll-600.png"));

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      const back = (
        await page.evaluate(runInPage, { op: "probeHeader" as const, selector: headerInfo.selector })
      ).headerProbe;
      await screenshot(page, join(shotDir, "scroll-back.png"));

      headerProbe = {
        selector: headerInfo.selector,
        tag: headerInfo.tag,
        className: headerInfo.className,
        computed_position: top?.computed_position ?? "static",
        computed_transform: top?.computed_transform ?? "none",
        box_top: top?.box ?? null,
        box_scrolled: scrolled?.box ?? null,
        box_back: back?.box ?? null,
        visible_top: top?.visible ?? false,
        visible_scrolled: scrolled?.visible ?? false,
        visible_back: back?.visible ?? false,
      };
    } else {
      warnings.push("No header candidate found");
      await screenshot(page, join(shotDir, "scroll-before.png"));
      await page.evaluate((y) => window.scrollTo(0, y), scrollPx);
      await page.waitForTimeout(400);
      await screenshot(page, join(shotDir, "scroll-600.png"));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await screenshot(page, join(shotDir, "scroll-back.png"));
    }

    const header_behavior = inferHeaderBehavior(headerProbe, scrollPx);

    progress({ step: "hover", detail: "Hovering cards and nav menus" });
    const hoverTargets = (
      await page.evaluate(runInPage, {
        op: "hoverTargets" as const,
        cardLimit: hoverCount,
        navLimit: 5,
      })
    ).hoverTargets;
    const hover_reveals: HoverReveal[] = [];
    const hoverShots: ScreenshotPaths["hovers"] = [];

    const snap = async (selector: string) =>
      (await page.evaluate(runInPage, { op: "hoverSnap" as const, selector })).hoverSnap;

    const clickIfSafe = async (selector: string): Promise<boolean> => {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!(el instanceof HTMLElement)) return false;
        const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") || "" : "";
        const popup = el.getAttribute("aria-haspopup");
        if (el.tagName === "BUTTON" || popup === "true" || popup === "menu" || href === "#" || href.startsWith("javascript")) {
          el.click();
          return true;
        }
        return false;
      }, selector);
    };

    for (let i = 0; i < hoverTargets.length; i++) {
      const target = hoverTargets[i]!;
      const selector = target.selector;
      await page.evaluate(() => window.scrollTo(0, 0));
      const loc = page.locator(selector).first();
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 5_000 });
        await page.waitForTimeout(200);
        const beforeState = await snap(selector);
        const beforePath = join(shotDir, `hover-${i}-before.png`);
        await screenshot(page, beforePath);
        await loc.hover({ timeout: 5_000 });
        await page.waitForTimeout(450);
        let afterState = await snap(selector);
        let via = "hover";
        const changed = Boolean(beforeState && afterState && beforeState.hash !== afterState.hash);
        if (!changed) {
          const clicked = await clickIfSafe(selector);
          if (clicked) {
            await page.waitForTimeout(400);
            afterState = await snap(selector);
            via = "click";
          }
        }

        const beforeImgs = new Set(beforeState?.images ?? []);
        const beforeLinks = new Set((beforeState?.links ?? []).map((l) => `${l.href}|${l.label}`));
        const added_images = (afterState?.images ?? []).filter((u) => !beforeImgs.has(u));
        const added_links = (afterState?.links ?? []).filter((l) => !beforeLinks.has(`${l.href}|${l.label}`));
        const added_text =
          beforeState && afterState && afterState.text !== beforeState.text
            ? afterState.text.replace(beforeState.text, "").trim()
            : "";
        const revealed = Boolean(
          (beforeState && afterState && beforeState.hash !== afterState.hash) ||
            added_images.length ||
            added_links.length ||
            added_text,
        );

        const afterPath = join(shotDir, `hover-${i}-after.png`);
        await screenshot(page, afterPath);

        hover_reveals.push({
          index: i,
          selector,
          kind: target.kind,
          box: afterState?.box ?? beforeState?.box ?? { x: 0, y: 0, width: 0, height: 0 },
          text_preview: (beforeState?.text ?? "").slice(0, 200),
          before_html_hash: beforeState?.hash ?? "",
          after_html_hash: afterState?.hash ?? "",
          revealed,
          added_text: added_text.slice(0, 300),
          added_images: added_images.slice(0, 6),
          added_links: added_links.slice(0, 12),
          evidence: revealed
            ? [`visible content changed on ${via}`]
            : ["no visible content change on hover"],
        });
        hoverShots.push({
          index: i,
          selector,
          before: rel(beforePath),
          after: rel(afterPath),
        });

        await page.mouse.move(0, 0);
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(150);
      } catch (err) {
        warnings.push(
          `Hover ${i} (${selector}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    progress({ step: "screenshot", detail: "Full-page screenshot" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const fullPagePath = join(shotDir, "full-page.png");
    try {
      await screenshot(page, fullPagePath, true);
    } catch (err) {
      warnings.push(
        `Full-page screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await screenshot(page, fullPagePath, false);
    }

    progress({ step: "snapshot", detail: "DOM, styles, and theme hints" });
    const [seoRes, themeRes, metricsRes, blocksRes, domRes] = await Promise.all([
      page.evaluate(runInPage, { op: "seo" as const }),
      page.evaluate(runInPage, { op: "theme" as const }),
      page.evaluate(runInPage, { op: "metrics" as const }),
      page.evaluate(runInPage, { op: "blocks" as const, maxBlocks: options.maxBlocks ?? 40 }),
      page.evaluate(runInPage, { op: "dom" as const, maxNodes: options.maxDomNodes ?? 8_000 }),
    ]);
    const seo = seoRes.seo ?? {
      description: null,
      canonical: null,
      og_title: null,
      og_description: null,
      og_image: null,
    };
    const theme_hints = themeRes.theme ?? {
      background_color: "",
      text_color: "",
      fonts: [],
      color_palette: [],
      css_variables: {},
    };
    const page_metrics = metricsRes.metrics ?? { scroll_width: 0, scroll_height: 0 };
    const candidate_blocks = blocksRes.blocks;
    const dom = domRes.dom;

    const capture: PageCapture = {
      schema_version: "1.0",
      url: options.url,
      final_url: page.url(),
      captured_at: new Date().toISOString(),
      title: await page.title(),
      viewport,
      page_metrics,
      seo,
      screenshots: {
        full_page: rel(fullPagePath),
        viewport_top: rel(viewportTopPath),
        scroll_600: rel(join(shotDir, "scroll-600.png")),
        scroll_back: rel(join(shotDir, "scroll-back.png")),
        hovers: hoverShots,
      },
      assets: Array.from(assets.values()),
      theme_hints,
      header_behavior,
      hover_reveals,
      candidate_blocks,
      dom,
      warnings,
    };

    const jsonPath = join(runDir, "capture.json");
    progress({ step: "write", detail: jsonPath });
    await writeFile(jsonPath, JSON.stringify(capture, null, 2), "utf8");
    return capture;
  } finally {
    await browser?.close();
  }
}

export function defaultCaptureDir(url: string, root = "data/captures"): string {
  return join(root, `${slugHost(url)}-${stamp()}`);
}
