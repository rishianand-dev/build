/**
 * Figma → ThemeDoc. The Figma-source counterpart to from-capture.ts,
 * terminating in the same Node/Style/Token/Asset shape — no parallel
 * schema.
 *
 * Deliberate simplification vs. treating Figma component instances
 * specially: rather than resolving every INSTANCE node's main component
 * (which may live outside the fetched frame subtree, needing N more API
 * calls and partial-override bind inference), every container type
 * (FRAME/GROUP/COMPONENT/INSTANCE) is mapped structurally the same way,
 * by its own `layoutMode`. `compactTheme`'s existing structural-
 * fingerprint promotion (already wired into the pipeline) then extracts
 * repeated instances into components exactly the way it already does for
 * DOM-heuristic cards — same end result, far less code, no risk of
 * malformed partial-instance data. Revisit only if that proves
 * insufficient against real files.
 *
 * What a live DOM capture gives from-capture.ts that Figma cannot:
 * scroll/hover interaction (`HeaderBehavior`, `HoverReveal`) — there is no
 * live page to probe. This is omitted, not guessed, with a `ReviewItem`
 * explaining why.
 */

import { internAsset, internStyle, internToken, prune } from "../schema/compact.js";
import { emptyTheme, type BoxEdges, type Node, type Style, type TextNode, type ThemeDoc } from "../schema/theme.js";
import { getFigmaImageFills, getFigmaNode, renderFigmaNodes } from "./figma-client.js";
import type { FigmaColor, FigmaNode, FigmaPaint, FigmaTextStyle } from "./figma-client.js";

export interface FigmaImportInput {
  fileKey: string;
  nodeId: string;
  title: string;
  /** The `figma.com/design/...` URL this was imported from, for `theme.site.source`. */
  sourceUrl: string;
  root: FigmaNode;
  /** Fill-image download URLs, keyed by the `imageRef` used in `fills[].imageRef`. */
  imageFillUrls: Record<string, string>;
}

interface FigmaBuildCtx {
  theme: ThemeDoc;
  imageFillUrls: Record<string, string>;
}

export function themeFromFigma(input: FigmaImportInput): ThemeDoc {
  const theme = emptyTheme({ site: { name: input.title, source: input.sourceUrl } });
  const ctx: FigmaBuildCtx = { theme, imageFillUrls: input.imageFillUrls };

  const built = buildFigmaNode(input.root, ctx);
  const root: Node = built ?? { type: "stack", children: [] };

  theme.pages = [{ id: "home", path: "/", name: "Home", title: input.title, root }];
  theme.review = [
    {
      path: "/pages/0/root",
      reason:
        "Figma import cannot detect scroll/hover behavior (no live page to probe) — header/hover behavior left at defaults",
      confidence: 0,
    },
  ];
  return prune(theme) as ThemeDoc;
}

function buildFigmaNode(node: FigmaNode, ctx: FigmaBuildCtx): Node | null {
  if (node.visible === false) return null;

  if (node.type === "TEXT") {
    const text = (node.characters ?? "").trim();
    if (!text) return null;
    const textNode: TextNode = { type: "text", text, tag: tagFromTextStyle(node.style) };
    const style = styleFromFigmaNode(ctx, node);
    if (style) textNode.style = style;
    return textNode;
  }

  const imageFill = (node.fills ?? []).find((f) => f.type === "IMAGE" && f.visible !== false);
  const kids = (node.children ?? [])
    .map((c) => buildFigmaNode(c, ctx))
    .filter((n): n is Node => n !== null);

  const image = imageFill ? imageNodeFromFill(ctx, imageFill, node) : null;

  if (image && !kids.length) return image;
  if (!image && !kids.length) return null;

  const style = styleFromFigmaNode(ctx, node);
  const container: Node = { type: containerTypeOf(node), children: kids, ...(style ? { style } : {}) };
  if (!image) return container;

  // Both a background image and real content (e.g. a hero band with
  // overlaid text) — matches the DOM-heuristic path's own layered-card
  // pattern (see `card` component's media layer in from-capture.ts).
  return { type: "layer", children: [image, container] };
}

function imageNodeFromFill(ctx: FigmaBuildCtx, fill: FigmaPaint, node: FigmaNode): Node | null {
  if (!fill.imageRef) return null;
  const url = ctx.imageFillUrls[fill.imageRef];
  if (!url) return null;
  const asset = internAsset(ctx.theme.assets, url, {
    kind: "image",
    w: node.absoluteBoundingBox?.width,
    h: node.absoluteBoundingBox?.height,
  });
  return { type: "image", asset, alt: node.name };
}

function containerTypeOf(node: FigmaNode): "stack" | "row" | "grid" {
  if (node.layoutMode === "HORIZONTAL") return "row";
  if (node.layoutMode === "GRID") return "grid";
  return "stack";
}

function tagFromTextStyle(style?: FigmaTextStyle): TextNode["tag"] {
  const size = style?.fontSize ?? 16;
  if (size >= 32) return "h1";
  if (size >= 24) return "h2";
  if (size >= 20) return "h3";
  if (size >= 18) return "h4";
  if (size < 13) return "span";
  return "p";
}

function figmaColorToHex(c: FigmaColor): string {
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

function paddingOf(node: FigmaNode): BoxEdges | undefined {
  const t = Math.round(node.paddingTop ?? 0);
  const r = Math.round(node.paddingRight ?? 0);
  const b = Math.round(node.paddingBottom ?? 0);
  const l = Math.round(node.paddingLeft ?? 0);
  if (!t && !r && !b && !l) return undefined;
  if (t === b && r === l) return t === r ? `${t}px` : ([`${t}px`, `${r}px`] as [string, string]);
  return [`${t}px`, `${r}px`, `${b}px`, `${l}px`];
}

function styleFromFigmaNode(ctx: FigmaBuildCtx, node: FigmaNode): string | undefined {
  const style: Style = {};
  const isText = node.type === "TEXT";
  const solidFill = (node.fills ?? []).find((f) => f.type === "SOLID" && f.visible !== false);
  if (solidFill?.color) {
    const ref = internToken(ctx.theme.tokens, "color", figmaColorToHex(solidFill.color));
    if (isText) style.color = ref;
    else style.bg = ref;
  }
  if (isText && node.style) {
    const s = node.style;
    if (s.fontFamily) style.font = internToken(ctx.theme.tokens, "font", s.fontFamily);
    if (s.fontSize) style.size = internToken(ctx.theme.tokens, "size", `${Math.round(s.fontSize)}px`);
    if (s.fontWeight) style.weight = internToken(ctx.theme.tokens, "weight", String(s.fontWeight));
    const align = s.textAlignHorizontal?.toLowerCase();
    if (align === "left" || align === "center" || align === "right") style.textAlign = align;
  }
  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (node.itemSpacing) style.gap = `${Math.round(node.itemSpacing)}px`;
    const pad = paddingOf(node);
    if (pad) style.pad = pad;
  }
  if (node.cornerRadius) style.radius = `${Math.round(node.cornerRadius)}px`;
  if (typeof node.opacity === "number" && node.opacity < 1) style.opacity = node.opacity;

  if (Object.keys(style).length === 0) return undefined;
  return internStyle(ctx.theme.styles, style);
}

export interface FetchFigmaImportOptions {
  fileKey: string;
  nodeId: string;
  token: string;
  /** Defaults to the Figma node's own name. */
  title?: string;
}

export interface FigmaFetchResult {
  input: FigmaImportInput;
  /** Figma's own frame render, used as the screenshot substitute (see
   * module doc). Null if the render or its download failed — best-effort,
   * not fatal to the import. */
  screenshotPng: Buffer | null;
}

/**
 * Fetches everything `themeFromFigma` needs — the target frame's node
 * tree, fill-image URLs, and a rendered PNG of the frame to stand in for
 * a live-page screenshot — and downloads the render. Network orchestration
 * only; `themeFromFigma` itself stays a pure, synchronous mapper.
 */
export async function fetchFigmaImportInput(options: FetchFigmaImportOptions): Promise<FigmaFetchResult> {
  const root = await getFigmaNode(options.fileKey, options.nodeId, options.token);
  const imageFillUrls = await getFigmaImageFills(options.fileKey, options.token).catch(
    (): Record<string, string> => ({}),
  );
  const renders = await renderFigmaNodes(options.fileKey, [options.nodeId], options.token).catch(
    (): Record<string, string | null> => ({}),
  );

  let screenshotPng: Buffer | null = null;
  const renderUrl = renders[options.nodeId];
  if (renderUrl) {
    try {
      const res = await fetch(renderUrl);
      if (res.ok) screenshotPng = Buffer.from(await res.arrayBuffer());
    } catch {
      // best-effort — a missing screenshot substitute isn't fatal
    }
  }

  return {
    input: {
      fileKey: options.fileKey,
      nodeId: options.nodeId,
      title: options.title ?? root.name,
      sourceUrl: `https://www.figma.com/design/${options.fileKey}?node-id=${options.nodeId.replace(":", "-")}`,
      root,
      imageFillUrls,
    },
    screenshotPng,
  };
}
