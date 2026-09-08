import type { DomNode, PageCapture } from "../types/page-capture.js";
import { internAsset, internStyle, internToken, prune } from "../schema/compact.js";
import { emptyTheme, type BindMap, type Node, type ThemeDoc } from "../schema/theme.js";
import { cssColorToHex, luminance, saturations } from "./color.js";
import { attachConnectedPages, internalNavHref, slugify } from "./connected-pages.js";

function walk(node: DomNode, visit: (n: DomNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function findAll(node: DomNode, pred: (n: DomNode) => boolean, skip?: (n: DomNode) => boolean): DomNode[] {
  const out: DomNode[] = [];
  const go = (n: DomNode) => {
    if (skip?.(n)) return;
    if (pred(n)) out.push(n);
    for (const child of n.children) go(child);
  };
  go(node);
  return out;
}

function findOne(node: DomNode, pred: (n: DomNode) => boolean): DomNode | undefined {
  return findAll(node, pred)[0];
}

function isCssJunk(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith(".") ||
    t.startsWith("@media") ||
    (t.startsWith("#") && t.includes("{")) ||
    t.includes("padding-top") ||
    t.includes("header-drawer") ||
    t.length > 220
  );
}

function texts(node: DomNode): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    const t = n.text.replace(/\s+/g, " ").trim();
    if (!t || isCssJunk(t)) return;
    out.push(t);
  });
  return out;
}

function deepText(node: DomNode): string {
  return [...new Set(texts(node))].join(" ").replace(/\s+/g, " ").trim();
}

function linkLabel(node: DomNode): string {
  const own = texts(node).join(" ").trim();
  return own || node.ariaLabel || "";
}

function looksHidden(node: DomNode): boolean {
  const s = node.style;
  if (s.display === "none" || s.visibility === "hidden") return true;
  if (node.box.width < 2 && node.box.height < 2) return true;
  if (node.box.height === 0) return true;
  return false;
}

const SKIP_TAGS = new Set(["script", "style", "noscript", "iframe", "quick-add-modal"]);

function isJunkRoot(node: DomNode): boolean {
  if (SKIP_TAGS.has(node.tag)) return true;
  if (looksHidden(node) && node.tag !== "img" && node.tag !== "video") return true;
  if (isModalOverlay(node)) return true;
  if (node.className.includes("skip-to-content")) return true;
  if (node.className.includes("quick-add")) return true;
  if (node.className.includes("omega-chat")) return true;
  return false;
}

function priceFrom(node: DomNode): { sale?: string; regular?: string } {
  const all = texts(node);
  const prices = all.filter(
    (t) =>
      (/(?:rs\.?|inr|usd|gbp|eur|₹|\$|€|£|¥)\s*[\d,]+(?:\.\d+)?/i.test(t) || /^\s*[\d,]+\.\d{2}\s*$/.test(t)) &&
      !/regular price|sale price/i.test(t),
  );
  if (prices.length >= 2) return { regular: prices[0], sale: prices[1] };
  if (prices.length === 1) return { sale: prices[0] };
  return {};
}

function contains(parent: DomNode, target: DomNode): boolean {
  let found = false;
  walk(parent, (n) => {
    if (n === target) found = true;
  });
  return found;
}

function nameOf(node: DomNode): string {
  return `${node.id} ${node.className} ${node.tag} ${node.role ?? ""}`.toLowerCase();
}

function cssUrls(bg: string | undefined): string[] {
  if (!bg || bg === "none") return [];
  const out: string[] = [];
  const re = /url\((['"]?)(.*?)\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bg))) {
    const url = m[2];
    if (url && !url.startsWith("data:")) out.push(url);
  }
  return out;
}

function visibleKids(node: DomNode): DomNode[] {
  return node.children.filter((c) => !isJunkRoot(c) && c.box.height > 8 && c.box.width > 8);
}

function isCloned(node: DomNode): boolean {
  return /slick-cloned|swiper-slide-duplicate/.test(node.className);
}

export function themeFromCapture(capture: PageCapture): ThemeDoc {
  const theme = emptyTheme({
    site: { name: capture.title, source: capture.final_url || capture.url },
    version: { id: "v1", status: "draft", at: capture.captured_at },
  });
  const review = theme.review;

  const hexes = [
    cssColorToHex(capture.theme_hints.background_color),
    cssColorToHex(capture.theme_hints.text_color),
    ...capture.theme_hints.color_palette.map(cssColorToHex),
  ].filter((x): x is string => Boolean(x));

  const unique = [...new Set(hexes)];
  const headingInk = capture.dom
    ? cssColorToHex(findOne(capture.dom, (n) => /^h[1-3]$/.test(n.tag))?.style.color ?? "")
    : null;
  const bg = cssColorToHex(capture.theme_hints.background_color) ?? unique.find((h) => luminance(h) > 0.97) ?? "#ffffff";
  const fg =
    headingInk ??
    cssColorToHex(capture.theme_hints.text_color) ??
    unique.find((h) => luminance(h) < 0.45) ??
    "#1b1610";
  const brand = fg;
  const accent =
    unique.filter((h) => saturations(h) > 0.45 && h !== brand && luminance(h) > 0.4).sort((a, b) => saturations(b) - saturations(a))[0] ??
    brand;
  const muted = unique.find((h) => luminance(h) > 0.3 && luminance(h) < 0.55) ?? "#6d6254";

  internToken(theme.tokens, "color", bg, "bg");
  internToken(theme.tokens, "color", fg, "fg");
  internToken(theme.tokens, "color", brand, "brand");
  internToken(theme.tokens, "color", accent, "accent");
  internToken(theme.tokens, "color", muted, "muted");
  internToken(theme.tokens, "color", "#ffffff", "card");

  const hinted = capture.theme_hints.fonts.filter((f) => !/icon|awesome|emoji|apple-system|system-ui/i.test(f));
  const bodyFont = hinted.find((f) => /sans|serif|inter|nunito|poppins|arial|helvetica|roboto|georgia|open sans/i.test(f)) ?? hinted[0] ?? "Georgia";
  const headingFont = hinted.find((f) => f !== bodyFont) ?? bodyFont;
  internToken(theme.tokens, "font", bodyFont, "body");
  internToken(theme.tokens, "font", headingFont, "heading");
  internToken(theme.tokens, "size", "12px", "xs");
  internToken(theme.tokens, "size", "13px", "sm");
  internToken(theme.tokens, "size", "16px", "md");
  internToken(theme.tokens, "size", "24px", "lg");
  internToken(theme.tokens, "size", "40px", "xl");
  internToken(theme.tokens, "weight", "400", "regular");
  internToken(theme.tokens, "weight", "600", "semibold");
  internToken(theme.tokens, "weight", "700", "bold");
  internToken(theme.tokens, "space", "10px", "2");
  internToken(theme.tokens, "space", "16px", "3");
  internToken(theme.tokens, "space", "24px", "4");
  internToken(theme.tokens, "space", "36px", "5");
  internToken(theme.tokens, "space", "48px", "6");
  internToken(theme.tokens, "radius", "6px", "md");

  const sticky = capture.header_behavior.sticky_or_fixed || capture.header_behavior.always_fixed_on_scroll;
  const pageStyle = internStyle(theme.styles, {
    bg: "$color.bg",
    color: "$color.fg",
    font: "$font.body",
    size: "$size.md",
  });
  const headerStyle = internStyle(theme.styles, {
    bg: "$color.card",
    color: "$color.fg",
    pos: sticky ? "sticky" : "relative",
    top: sticky ? "0" : undefined,
    z: 20,
    width: "100%",
  });
  const logoStyle = internStyle(theme.styles, { height: "40px" });
  const heroH = capture.dom
    ? findAll(capture.dom, (n) => n.tag === "img" && n.box.width >= 900 && n.box.height >= 220)[0]?.box.height
    : undefined;
  const heroStyle = internStyle(theme.styles, {
    width: "100%",
    height: heroH ? `${Math.round(heroH)}px` : undefined,
  });
  const sectionStyle = internStyle(theme.styles, { pad: ["$space.5", "0"], gap: "$space.3" });
  const h2Style = internStyle(theme.styles, {
    font: "$font.heading",
    size: "$size.lg",
    weight: "$weight.bold",
    color: "$color.fg",
    textAlign: "center",
  });
  const cardStyle = internStyle(theme.styles, {
    bg: "$color.card",
    radius: "$radius.md",
  });
  const infoStyle = internStyle(theme.styles, {
    pad: ["16px", "12px", "16px", "12px"],
    gap: "10px",
  });
  const titleStyle = internStyle(theme.styles, {
    font: "$font.heading",
    size: "$size.sm",
    weight: "$weight.regular",
    color: "$color.fg",
    leading: "1.3",
  });
  const priceStyle = internStyle(theme.styles, { color: "$color.fg", weight: "$weight.semibold", size: "$size.sm" });
  const wasStyle = internStyle(theme.styles, {
    color: "$color.muted",
    size: "$size.xs",
    decoration: "line-through",
  });
  const badgeStyle = internStyle(theme.styles, {
    bg: unique.find((h) => luminance(h) > 0.82 && luminance(h) < 0.96) ?? "#f3f3f3",
    color: "$color.fg",
    size: "$size.xs",
    radius: "$radius.md",
    pad: ["4px", "12px"],
  });
  const cartStyle = internStyle(theme.styles, {
    border: "1px solid $color.fg",
    color: "$color.fg",
    bg: "$color.card",
    pad: ["12px", "$space.2"],
    textAlign: "center",
    size: "$size.md",
    radius: "$radius.md",
  });
  const footerStyle = internStyle(theme.styles, {
    bg: "$color.fg",
    color: "$color.card",
    pad: ["$space.6", "$space.4"],
    gap: "$space.3",
  });
  const promoStyle = internStyle(theme.styles, {
    bg: "$color.fg",
    color: "$color.card",
    pad: "$space.2",
    justify: "center",
    textAlign: "center",
    width: "100%",
  });
  const gridStyle = internStyle(theme.styles, { gap: "$space.3", cols: 5 });
  const mosaicStyle = internStyle(theme.styles, { gap: "$space.2", cols: 3 });
  const catStyle = internStyle(theme.styles, { gap: "$space.3", cols: 6, align: "center" });

  theme.components.card = {
    binds: ["img", "title", "price", "was", "badge", "href", "slug", "cta", "hoverImg", "hoverLabel"],
    root: {
      type: "link",
      bind: "href",
      style: cardStyle,
      role: "card",
      children: [
        {
          type: "layer",
          role: "media",
          children: [
            { type: "image", bind: "img" },
            { type: "image", bind: "hoverImg", role: "hover-img" },
            { type: "text", bind: "badge", tag: "span", style: badgeStyle, role: "badge" },
            { type: "text", bind: "hoverLabel", tag: "span", role: "hover" },
          ],
        },
        {
          type: "stack",
          role: "info",
          style: infoStyle,
          children: [
            { type: "text", bind: "title", tag: "h3", style: titleStyle },
            {
              type: "row",
              role: "prices",
              children: [
                { type: "text", bind: "was", style: wasStyle },
                { type: "text", bind: "price", style: priceStyle },
              ],
            },
            { type: "text", bind: "cta", tag: "span", style: cartStyle, role: "cart" },
          ],
        },
      ],
    },
  };
  theme.components.collection = {
    binds: ["img", "title", "href"],
    root: {
      type: "link",
      bind: "href",
      role: "tile",
      children: [
        { type: "image", bind: "img" },
        { type: "text", bind: "title", tag: "h3" },
      ],
    },
  };

  const root = capture.dom;
  if (!root) {
    review.push({ path: "/pages/0", reason: "Capture has no DOM snapshot", confidence: 0 });
    theme.pages = [{ id: "home", path: "/", name: "Home", title: capture.title, root: { type: "stack", children: [] } }];
    return prune(theme) as ThemeDoc;
  }

  const headerEl = findHeaderNode(root);
  const footerEl = findFooterNode(root);
  const headerInnerStyle = internStyle(theme.styles, {
    pad: ["12px", "28px"],
    justify: "between",
    align: "center",
    width: "100%",
    maxW: headerEl ? headerInnerMax(headerEl, capture.viewport.width) : `${capture.viewport.width || 1200}px`,
    m: "0 auto",
  });
  const seenMedia = new Set<string>();
  const catalog: BindMap[] = [];
  const slugs = new Set<string>();
  const ctx: BuildCtx = {
    theme,
    capture,
    heroStyle,
    sectionStyle,
    h2Style,
    gridStyle,
    mosaicStyle,
    catStyle,
    promoStyle,
    seenMedia,
    catalog,
    slugs,
    headerEl,
    footerEl,
  };

  const body: Node[] = [];
  const topChrome: Node[] = [];
  let headerPlaced = false;
  for (const child of root.children) {
    if (isJunkRoot(child)) continue;
    if (isModalOverlay(child)) continue;
    if (footerEl && child === footerEl) continue;
    if (headerEl && child === headerEl) {
      headerPlaced = true;
      continue;
    }
    if (!headerPlaced && child.box.height <= 72 && child.box.width > 600) {
      topChrome.push(...buildBlock(child, ctx));
      continue;
    }
    body.push(...buildBlock(child, ctx));
  }
  const headerBits = headerEl
    ? buildHeader(
        headerEl,
        theme,
        headerStyle,
        headerInnerStyle,
        logoStyle,
        promoStyle,
        catalog.length > 0,
        capture.hover_reveals,
      )
    : [];
  if (!headerEl) review.push({ path: "/pages/0/header", reason: "No header element", confidence: 0.2 });
  const chrome = [...topChrome, ...headerBits];
  const footerNode = footerEl ? buildFooter(footerEl, theme, footerStyle) : null;

  theme.pages = [
    {
      id: "home",
      path: "/",
      name: "Home",
      title: capture.title,
      root: {
        type: "stack",
        style: pageStyle,
        children: [...chrome, ...body, ...(footerNode ? [footerNode] : [])],
      },
    },
  ];
  if (catalog.length) {
    attachConnectedPages(theme, {
      header: chrome,
      footer: footerNode,
      catalog,
      pageStyle,
      sectionStyle,
      h2Style,
      gridStyle,
      priceStyle,
      wasStyle,
    });
  }
  theme.review = review;
  return prune(theme) as ThemeDoc;
}

interface BuildCtx {
  theme: ThemeDoc;
  capture: PageCapture;
  heroStyle: string;
  sectionStyle: string;
  h2Style: string;
  gridStyle: string;
  mosaicStyle: string;
  catStyle: string;
  promoStyle: string;
  seenMedia: Set<string>;
  catalog: BindMap[];
  slugs: Set<string>;
  headerEl?: DomNode;
  footerEl?: DomNode;
}

function findHeaderNode(root: DomNode): DomNode | undefined {
  const tagged = findOne(root, (n) => n.tag === "header" || n.role === "banner");
  if (tagged) return tagged;
  const named = findAll(
    root,
    (n) =>
      /header/.test(nameOf(n)) &&
      n.box.y <= 80 &&
      n.box.height >= 32 &&
      n.box.height <= 280 &&
      n.box.width >= 400,
  );
  return named.sort((a, b) => a.box.y - b.box.y || b.box.width - a.box.width)[0];
}

function findFooterNode(root: DomNode): DomNode | undefined {
  return (
    findOne(root, (n) => n.tag === "footer" || n.role === "contentinfo") ??
    findAll(root, (n) => /footer/.test(nameOf(n)) && n.box.height >= 80 && n.box.width >= 400).sort(
      (a, b) => b.box.y - a.box.y,
    )[0]
  );
}

function headerInnerMax(header: DomNode, viewportW: number): string {
  const inner = visibleKids(header)
    .filter((k) => k.box.width >= 640 && k.box.width < header.box.width * 0.98)
    .sort((a, b) => b.box.width - a.box.width)[0];
  if (inner) return `${Math.round(inner.box.width)}px`;
  const nodes = findAll(header, (n) => n.box.width > 24 && n.box.height > 8);
  if (nodes.length) {
    const left = Math.min(...nodes.map((n) => n.box.x));
    const right = Math.max(...nodes.map((n) => n.box.x + n.box.width));
    const span = right - left;
    if (span >= 640 && span <= viewportW) return `${Math.round(span)}px`;
  }
  return `${Math.min(1200, viewportW || 1200)}px`;
}

function internMedia(
  theme: ThemeDoc,
  node: DomNode,
  extra?: { kind?: "image" | "video" },
): string | null {
  const fromCss = cssUrls(node.style.backgroundImage)[0];
  const raw = extra?.kind === "video" ? node.src : pickImageUrl(node) || node.poster || fromCss;
  const url = raw?.startsWith("//") ? `https:${raw}` : raw;
  if (!url || url.startsWith("data:image/svg")) return null;
  if (node.box.height > 0 && node.box.height < 8) return null;
  if (node.box.width > 0 && node.box.width < 8) return null;
  const kind = extra?.kind ?? (node.tag === "video" && node.src ? "video" : "image");
  return internAsset(theme.assets, url, {
    kind,
    alt: node.alt,
    w: node.box.width,
    h: node.box.height,
  });
}

function pickImageUrl(node: DomNode): string | undefined {
  const ranked: Array<{ url: string; w: number }> = [];
  if (node.srcset) {
    for (const part of node.srcset.split(",")) {
      const bits = part.trim().split(/\s+/);
      const raw = bits[0];
      if (!raw) continue;
      const url = raw.startsWith("//") ? `https:${raw}` : raw;
      const w = Number((bits[1] || "").replace(/w$/i, "")) || 0;
      ranked.push({ url, w });
    }
  }
  ranked.sort((a, b) => b.w - a.w);
  const src = node.src?.startsWith("//") ? `https:${node.src}` : node.src;
  return ranked[0]?.url || src;
}

function internImg(theme: ThemeDoc, node: DomNode): string | null {
  return internMedia(theme, node);
}

function barLabel(node: DomNode): string {
  const labels = texts(node).filter((t) => t.length >= 6 && t.length <= 80 && !/^https?:/i.test(t));
  return (labels[0] ?? "").slice(0, 90);
}

function internBarStyle(theme: ThemeDoc, node: DomNode, fallback: string): string {
  const painted = paintedPair(node);
  if (!painted) return fallback;
  const bgRef = internToken(theme.tokens, "color", painted.bg);
  const colorRef = internToken(theme.tokens, "color", painted.color);
  return internStyle(theme.styles, {
    bg: bgRef,
    color: colorRef,
    pad: ["10px", "$space.4"],
    justify: "center",
    align: "center",
    width: "100%",
    textAlign: "center",
  });
}

function paintedPair(node: DomNode): { bg: string; color: string } | null {
  const bg = cssColorToHex(node.style.backgroundColor);
  if (bg) {
    return { bg, color: cssColorToHex(node.style.color) ?? "#ffffff" };
  }
  for (const child of node.children) {
    const inner = paintedPair(child);
    if (inner) return inner;
  }
  return null;
}

function isSlider(node: DomNode): boolean {
  return /slider|slideshow|carousel|swiper|slick/.test(nameOf(node));
}

function similarBox(a: DomNode, b: DomNode): boolean {
  const dw = Math.abs(a.box.width - b.box.width) / Math.max(a.box.width, b.box.width, 1);
  const dh = Math.abs(a.box.height - b.box.height) / Math.max(a.box.height, b.box.height, 1);
  return dw < 0.35 && dh < 0.45;
}

function hasMedia(node: DomNode): boolean {
  return Boolean(
    findOne(
      node,
      (n) =>
        (n.tag === "img" && Boolean(n.src) && n.box.width >= 72) ||
        (n.tag === "video" && n.box.width >= 72),
    ),
  );
}

function unitsFromKids(node: DomNode): DomNode[] {
  const kids = visibleKids(node).filter(
    (k) => k.box.width >= 90 && k.box.height >= 70 && k.box.width < node.box.width * 0.92,
  );
  const withMedia = kids.filter(hasMedia);
  if (withMedia.length >= 2 && withMedia.every((k) => similarBox(k, withMedia[0]!))) {
    return dedupeUnits(withMedia);
  }
  return [];
}

function repeatingUnits(node: DomNode): DomNode[] {
  let cur = node;
  for (let depth = 0; depth < 8; depth++) {
    const units = unitsFromKids(cur);
    if (units.length >= 2) return units;
    const shells = visibleKids(cur).filter((k) => k.box.width >= cur.box.width * 0.75 && k.box.height >= 70);
    if (shells.length !== 1) return [];
    const shell = shells[0]!;
    if (cur.box.height >= 640 && shell.box.height >= Math.min(cur.box.height * 0.85, cur.box.height - 40)) {
      return [];
    }
    cur = shell;
  }
  return [];
}

function dedupeUnits(units: DomNode[]): DomNode[] {
  const out: DomNode[] = [];
  for (const u of units) {
    if (out.some((p) => contains(p, u) && p !== u)) continue;
    out.push(u);
  }
  return out;
}

function hasOverflowUnits(node: DomNode, units: DomNode[]): boolean {
  if (node.box.height < 80 || units.length < 2) return false;
  const right = node.box.x + node.box.width;
  return units.some((s) => s.box.x >= right - 24 || s.box.x + s.box.width > right + 80);
}

function fullyVisibleUnits(node: DomNode, units: DomNode[]): number {
  if (units.length < 2) return 0;
  const right = node.box.x + node.box.width;
  return units.filter((s) => s.box.x >= node.box.x - 8 && s.box.x + s.box.width <= right + 8).length;
}

function colsFromComputed(node: DomNode): number | undefined {
  let found: number | undefined;
  walk(node, (n) => {
    if (found) return;
    const g = n.style.gridTemplateColumns;
    if (!g || g === "none") return;
    const repeat = g.match(/repeat\(\s*(\d+)/);
    if (repeat) {
      found = Number(repeat[1]);
      return;
    }
    const parts = g.split(/\s+/).filter((p) => p && p !== "/" && !p.startsWith("["));
    if (parts.length >= 2 && parts.length <= 8) found = parts.length;
  });
  return found;
}

function colsFromLayout(node: DomNode, units: DomNode[]): number | undefined {
  const grid = colsFromComputed(node);
  if (grid) return grid;
  if (units.length >= 2) {
    const w = units[0]!.box.width;
    const guessed = Math.round(node.box.width / Math.max(w, 1));
    if (guessed >= 2 && guessed <= 8) return guessed;
  }
  return undefined;
}

function isNewsletter(node: DomNode): boolean {
  if (node.box.height < 80 || node.box.height > 480) return false;
  const email = findOne(
    node,
    (n) => n.tag === "input" && (n.type === "email" || /email/i.test(`${n.placeholder ?? ""} ${n.ariaLabel ?? ""}`)),
  );
  if (!email) return false;
  const copy = deepText(node);
  return /newsletter/.test(nameOf(node)) || /subscribe|mailing list|newsletter|sign\s*up/i.test(copy);
}

function socialLabel(node: DomNode): string {
  const own = linkLabel(node);
  if (own) return own;
  const href = (node.href || "").toLowerCase();
  if (href.includes("facebook")) return "Facebook";
  if (href.includes("instagram")) return "Instagram";
  if (href.includes("twitter") || href.includes("x.com")) return "Twitter";
  if (href.includes("youtube")) return "YouTube";
  if (href.includes("pinterest")) return "Pinterest";
  if (href.includes("linkedin")) return "LinkedIn";
  return node.ariaLabel || "";
}

function isModalOverlay(node: DomNode): boolean {
  const pos = node.style.position;
  if (pos !== "fixed" && pos !== "absolute") return false;
  if (node.box.width < 640 || node.box.height < 320) return false;
  const t = deepText(node).toLowerCase();
  return /log in|sign in|enter your phone|cookie|accept all|above 18|verify (your )?age/.test(t);
}

function isWrapper(node: DomNode, kids: DomNode[]): boolean {
  if (isSlider(node)) return false;
  if (node.tag === "main" || node.tag === "body") return true;
  if (/page-wrapper|main-content|layout|page-container|site-wrapper|content-for-layout/.test(nameOf(node))) return true;
  if (node.tag === "section") return false;
  if (kids.length === 1 && kids[0]!.box.height >= node.box.height * 0.55) return true;
  const fullWidth = kids.filter((k) => k.box.width >= node.box.width * 0.7 && k.box.height >= 80);
  return fullWidth.length >= 3 && node.box.height > 800;
}

function buildBlock(node: DomNode, ctx: BuildCtx): Node[] {
  if (node === ctx.headerEl || node === ctx.footerEl) return [];
  if (isModalOverlay(node)) return [];
  if (node.box.height < 24 && node.tag !== "video") return [];
  const kids = visibleKids(node);

  if (isWrapper(node, kids)) {
    const nested: Node[] = [];
    for (const kid of kids) nested.push(...buildBlock(kid, ctx));
    if (nested.length) return nested;
  }

  if (node.box.height <= 72 && node.box.width > 600) {
    const label = barLabel(node);
    if (label) {
      const a = findOne(node, (n) => n.tag === "a" && Boolean(n.href));
      return [
        {
          type: "link",
          href: a?.href || "#",
          style: internBarStyle(ctx.theme, node, ctx.promoStyle),
          role: "banner",
          children: [{ type: "text", text: label, tag: "span" }],
        },
      ];
    }
  }

  if (isNewsletter(node)) return buildNewsletter(node, ctx);

  const tiles = extractTiles(node, ctx);
  if (tiles.length >= 2) {
    const title = sectionTitle(node);
    const units = repeatingUnits(node);
    const cols = colsFromLayout(node, units) ?? Math.min(tiles.length, 4);
    const listStyle = internStyle(ctx.theme.styles, { gap: "$space.3", cols });
    const section: Node[] = [];
    if (title) section.push({ type: "text", text: title, tag: "h2", style: ctx.h2Style });
    section.push({ type: "list", of: "collection", items: tiles, style: listStyle, role: "collections" });
    const more = viewAllLink(node);
    if (more) section.push(more);
    return [{ type: "stack", style: ctx.sectionStyle, children: section }];
  }

  const cards = extractCards(node, ctx);
  if (cards.length >= 2) {
    const title = sectionTitle(node);
    const units = repeatingUnits(node);
    const guessed = Math.min(6, Math.max(3, Math.round(node.box.width / Math.max(units[0]?.box.width ?? 240, 1)) || 5));
    const cols = colsFromLayout(node, units) ?? guessed;
    const visible = fullyVisibleUnits(node, units);
    const per = visible >= 2 ? visible : cols;
    const carousel = hasOverflowUnits(node, units) && cards.length > per;
    const cardW = Math.round(units[0]?.box.width || 220);
    const leftPad = Math.max(0, Math.round((units[0]?.box.x ?? node.box.x) - node.box.x));
    const listStyle = internStyle(ctx.theme.styles, {
      gap: "$space.3",
      cols: carousel ? per : Math.min(6, cols),
      ...(carousel
        ? { width: `${cardW}px`, pad: [`0px`, `0px`, `0px`, `${leftPad}px`] as [string, string, string, string] }
        : {}),
    });
    const section: Node[] = [];
    if (title) section.push({ type: "text", text: title, tag: "h2", style: ctx.h2Style });
    section.push({
      type: "list",
      of: "card",
      items: cards,
      style: listStyle,
      role: carousel ? "carousel" : "list",
    });
    const more = viewAllLink(node);
    if (more) section.push(more);
    return [{ type: "stack", style: ctx.sectionStyle, children: section }];
  }

  const mediaTiles = visualTiles(node).filter((n) => {
    const key = n.src || n.poster || "";
    return key && !ctx.seenMedia.has(key);
  });
  const fullBleed = mediaTiles.filter((n) => n.box.width >= Math.max(640, node.box.width * 0.8));
  const band = fullBleed.filter((n) => Math.abs(n.box.y - (fullBleed[0]?.box.y ?? n.box.y)) < 80);
  if (band.length >= 2) {
    const slides = band.flatMap((img) => {
      const n = mediaNode(ctx, img, ctx.heroStyle, undefined, { keep: true });
      return n ? [n] : [];
    });
    if (slides.length >= 2) return [{ type: "stack", role: "carousel", children: slides }];
  }
  if (fullBleed.length >= 1 && mediaTiles.length <= 2) {
    const hero = mediaNode(ctx, fullBleed[0]!, ctx.heroStyle, "hero");
    if (hero) return [hero];
  }

  if (kids.length >= 2 && node.box.height > 420) {
    const nested: Node[] = [];
    for (const kid of kids) nested.push(...buildBlock(kid, ctx));
    if (nested.length) return nested;
  }

  const mediaRows = emitMediaRows(node, ctx, mediaTiles);
  if (mediaRows.length) return mediaRows;

  const video = findOne(node, (n) => n.tag === "video" && n.box.width >= 400 && n.box.height >= 180);
  if (video) {
    const hero = mediaNode(ctx, video, ctx.heroStyle, "hero") ?? screenshotHero(ctx, node);
    if (hero) return [hero];
  }

  const title = sectionTitle(node);
  const copy = texts(node)
    .filter((t) => t !== title && t.length > 12 && t.length < 160)
    .slice(0, 4);
  const thumbs = findAll(
    node,
    (n) => n.tag === "img" && Boolean(n.src) && n.box.width >= 72 && n.box.width <= 220 && n.box.height >= 72,
    isCloned,
  ).filter((n) => n.src && !ctx.seenMedia.has(n.src));
  if (thumbs.length >= 3) {
    const children: Node[] = [];
    if (title) children.push({ type: "text", text: title, tag: "h2", style: ctx.h2Style });
    children.push({
      type: "grid",
      style: ctx.catStyle,
      children: thumbs.slice(0, 8).flatMap((img) => {
        const id = internImg(ctx.theme, img);
        if (!id || !img.src) return [];
        ctx.seenMedia.add(img.src);
        const label = img.alt || "";
        return [
          {
            type: "stack" as const,
            children: [
              { type: "image" as const, asset: id, alt: img.alt },
              ...(label ? [{ type: "text" as const, text: label, tag: "span" as const }] : []),
            ],
          },
        ];
      }),
    });
    return [{ type: "stack", style: ctx.sectionStyle, children }];
  }

  if (kids.length) {
    const nested: Node[] = [];
    for (const kid of kids) nested.push(...buildBlock(kid, ctx));
    if (nested.length) return nested;
  }

  if (title || copy.length) {
    const children: Node[] = [];
    if (title) children.push({ type: "text", text: title, tag: "h2", style: ctx.h2Style });
    for (const t of copy) children.push({ type: "text", text: t, tag: "p" });
    const leftover = visualTiles(node).flatMap((img) => {
      const n = mediaNode(ctx, img);
      return n ? [n] : [];
    });
    children.push(...leftover);
    if (children.length) return [{ type: "stack", style: ctx.sectionStyle, children }];
  }

  if (node.box.height >= 360 && node.box.width >= 700) {
    const shot = screenshotHero(ctx, node);
    if (shot) return [shot];
  }
  return [];
}

function emitMediaRows(node: DomNode, ctx: BuildCtx, tiles: DomNode[]): Node[] {
  if (!tiles.length) return [];
  const rows: DomNode[][] = [];
  for (const img of [...tiles].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.box.y - img.box.y) < 90);
    if (row) row.push(img);
    else rows.push([img]);
  }
  const title = sectionTitle(node);
  const children: Node[] = [];
  if (title) children.push({ type: "text", text: title, tag: "h2", style: ctx.h2Style });
  for (const row of rows) {
    const overflow = row.some((s) => s.box.x + s.box.width > node.box.x + node.box.width + 40);
    if (row.length >= 2 && overflow) {
      const slides = row.flatMap((img) => {
        const n = mediaNode(ctx, img, undefined, undefined, { keep: true });
        return n ? [n] : [];
      });
      if (slides.length >= 2) children.push({ type: "stack", role: "carousel", children: slides });
      continue;
    }
    if (row.length === 1) {
      const hero = row[0]!.box.width >= Math.max(640, node.box.width * 0.75);
      const n = mediaNode(ctx, row[0]!, hero ? ctx.heroStyle : undefined, hero ? "hero" : undefined);
      if (n) children.push(n);
      continue;
    }
    const cols = Math.min(row.length, 6);
    const style = internStyle(ctx.theme.styles, { gap: "$space.2", cols });
    const cells = row.flatMap((img) => {
      const n = mediaNode(ctx, img);
      return n ? [n] : [];
    });
    if (cells.length) children.push({ type: "grid", style, children: cells });
  }
  if (!children.length || (title && children.length === 1)) return [];
  return [{ type: "stack", style: ctx.sectionStyle, children }];
}

function visualTiles(node: DomNode): DomNode[] {
  const imgs = findAll(
    node,
    (n) =>
      ((n.tag === "img" && Boolean(n.src)) || (n.tag === "video" && Boolean(n.src || n.poster))) &&
      n.box.width >= 96 &&
      n.box.height >= 64,
    isCloned,
  );
  const unique: DomNode[] = [];
  const seen = new Set<string>();
  for (const img of imgs) {
    const key = img.src || img.poster || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(img);
  }
  unique.sort((a, b) => Math.abs(a.box.x) - Math.abs(b.box.x) || a.box.y - b.box.y);
  return unique;
}

function mediaNode(
  ctx: BuildCtx,
  node: DomNode,
  style?: string,
  role?: Node["role"],
  opts?: { keep?: boolean },
): Node | null {
  const key = node.src || node.poster || cssUrls(node.style.backgroundImage)[0];
  if (!key || (!opts?.keep && ctx.seenMedia.has(key))) return null;
  const id = internMedia(ctx.theme, node);
  if (!id) return null;
  ctx.seenMedia.add(key);
  const image: Node = {
    type: "image",
    asset: id,
    style,
    alt: node.alt,
  };
  if (role === "hero") return { type: "stack", role: "hero", children: [image] };
  return image;
}

function screenshotHero(ctx: BuildCtx, node: DomNode): Node | null {
  const rel = ctx.capture.screenshots.viewport_top;
  if (!rel || ctx.seenMedia.has(rel)) return null;
  if (node.box.y > 900) return null;
  ctx.seenMedia.add(rel);
  const id = internAsset(ctx.theme.assets, rel, { kind: "image", w: node.box.width, h: node.box.height });
  return {
    type: "stack",
    role: "hero",
    children: [{ type: "image", asset: id, style: ctx.heroStyle, alt: ctx.capture.title }],
  };
}

function viewAllLink(node: DomNode): Node | null {
  const a = findOne(
    node,
    (n) => n.tag === "a" && Boolean(n.href) && /view\s*all/i.test(`${linkLabel(n)} ${n.className}`),
  );
  if (!a) return null;
  const label = linkLabel(a) || "View all";
  return {
    type: "link",
    href: internalNavHref(a.href!, label),
    role: "more",
    children: [{ type: "text", text: label, tag: "span" }],
  };
}

function unitImage(unit: DomNode): DomNode | undefined {
  return findAll(unit, (n) => n.tag === "img" && Boolean(n.src))
    .filter((n) => n.box.width >= 80)
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
}

function unitTitle(unit: DomNode, img?: DomNode): string {
  const heading = findOne(unit, (n) => /^h[1-6]$/.test(n.tag));
  if (heading) return headingText(heading) || deepText(heading);
  const labeled = findOne(unit, (n) => n.tag === "a" && Boolean(linkLabel(n)));
  if (labeled) return headingText(labeled) || linkLabel(labeled);
  return img?.alt || "";
}

function extractTiles(node: DomNode, ctx: BuildCtx): BindMap[] {
  const units = repeatingUnits(node).filter((u) => u.box.width < node.box.width * 0.8);
  if (units.length < 2) return [];
  const priced = units.filter((u) => priceFrom(u).sale || priceFrom(u).regular);
  if (priced.length >= 2) return [];
  const items: BindMap[] = [];
  const used = new Set<string>();
  for (const tile of units) {
    const img = unitImage(tile);
    if (!img?.src || used.has(img.src)) continue;
    const title = unitTitle(tile, img);
    if (title.length > 64) continue;
    used.add(img.src);
    const asset = internImg(ctx.theme, img);
    if (!asset) continue;
    const href = findOne(tile, (n) => n.tag === "a" && Boolean(n.href))?.href;
    items.push({
      img: asset,
      title,
      href: internalNavHref(href || "#", title),
    });
  }
  return items;
}

function extractCards(node: DomNode, ctx: BuildCtx): BindMap[] {
  const units = repeatingUnits(node);
  if (units.length < 2) return [];
  const items: BindMap[] = [];
  const used = new Set<string>();
  for (const card of units) {
    const prices = priceFrom(card);
    if (!prices.sale && !prices.regular) continue;
    const img = unitImage(card);
    if (!img?.src || used.has(img.src) || (pickImageUrl(img) && used.has(pickImageUrl(img)!))) continue;
    const title = unitTitle(card, img);
    if (!title) continue;
    const imageKey = pickImageUrl(img) || img.src;
    used.add(img.src);
    used.add(imageKey);
    const asset = internImg(ctx.theme, img);
    if (!asset) continue;
    const existing = ctx.catalog.find((item) => item.img === asset);
    if (existing) {
      items.push(existing);
      continue;
    }
    const badge = texts(card).find((t) => /^save\s+\d+\s*%/i.test(t)) ?? "";
    const cta =
      texts(card).find((t) => /add to (cart|bag)|buy now|choose options|sold out|shop now/i.test(t)) ?? "";
    const slug = slugify(title, ctx.slugs);
    const item: BindMap = {
      img: asset,
      title,
      price: prices.sale ?? "",
      was: prices.regular ?? "",
      badge,
      href: `#/product/${slug}`,
      slug,
      cta,
    };
    ctx.catalog.push(item);
    applyHoverReveal(item, ctx);
    items.push(item);
  }
  return items;
}

function applyHoverReveal(item: BindMap, ctx: BuildCtx): void {
  const title = String(item.title ?? "");
  if (!title) return;
  const needle = title.toLowerCase().slice(0, 18);
  const hit = ctx.capture.hover_reveals.find((h) => {
    if (h.kind === "nav") return false;
    if (!h.revealed && !(h.added_text || h.added_images?.length || h.added_links?.length)) return false;
    return `${h.text_preview} ${h.added_text}`.toLowerCase().includes(needle);
  });
  if (!hit) return;
  const hoverSrc = (hit.added_images ?? []).find((u) => Boolean(u) && !u.startsWith("data:image/svg"));
  if (hoverSrc) {
    const abs = hoverSrc.startsWith("//") ? `https:${hoverSrc}` : hoverSrc;
    const id = internAsset(ctx.theme.assets, abs, { kind: "image" });
    if (id && id !== item.img) item.hoverImg = id;
  }
  const fromLink = (hit.added_links ?? []).find((l) => /quick view|add to|view|shop|options/i.test(l.label))?.label;
  const label = (hit.added_text || fromLink || "").replace(/\s+/g, " ").trim().slice(0, 48);
  if (label && label.toLowerCase() !== title.toLowerCase()) item.hoverLabel = label;
}

function navMenusFromHover(
  reveals: Array<{ kind?: string; revealed: boolean; text_preview: string; added_links?: Array<{ href: string; label: string }> }>,
): Map<string, Array<{ href: string; label: string }>> {
  const menus = new Map<string, Array<{ href: string; label: string }>>();
  for (const h of reveals) {
    if (h.kind !== "nav" || !h.revealed) continue;
    const links = (h.added_links ?? []).filter((l) => l.label && l.label.length <= 42);
    if (links.length < 2) continue;
    const key = h.text_preview.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 28);
    if (key) menus.set(key, links);
  }
  return menus;
}

function sectionTitle(node: DomNode): string {
  const h = findOne(node, (n) => /^h[1-6]$/.test(n.tag) && n !== node);
  if (h) return headingText(h);
  const label = texts(node).find((t) => t.length >= 4 && t.length <= 48 && t === t.toUpperCase());
  return label ?? "";
}

function headingText(node: DomNode): string {
  const parts: string[] = [];
  walk(node, (n) => {
    const t = n.text.replace(/\s+/g, " ").trim();
    if (t && !isCssJunk(t)) parts.push(t);
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function buildHeader(
  header: DomNode,
  theme: ThemeDoc,
  shellStyle: string,
  innerStyle: string,
  logoStyle: string,
  promoStyle: string,
  includeShop: boolean,
  reveals: PageCapture["hover_reveals"] = [],
): Node[] {
  const rows = visibleKids(header);
  const out: Node[] = [];
  const top = rows.find((r) => r.box.height <= 64 && r.box.width > 600);
  if (top && top.box.y <= header.box.y + 8) {
    const label = deepText(top).slice(0, 90);
    if (label) {
      out.push({
        type: "row",
        style: promoStyle,
        children: [{ type: "text", text: label }],
      });
    }
  }

  const logoImg =
    findOne(header, (n) => /logo/.test(nameOf(n)) && n.tag === "img" && Boolean(n.src)) ??
    findAll(header, (n) => n.tag === "img" && Boolean(n.src) && n.box.width >= 40 && n.box.height >= 16).sort(
      (a, b) => b.box.width * b.box.height - a.box.width * a.box.height,
    )[0];
  const logoAsset = logoImg ? internImg(theme, logoImg) : null;
  const brand: Node = logoAsset
    ? {
        type: "link",
        href: "#/",
        children: [{ type: "image", asset: logoAsset, alt: logoImg?.alt || "Logo", style: logoStyle }],
      }
    : {
        type: "link",
        href: "#/",
        children: [{ type: "text", text: shortSiteName(theme.site.name), tag: "h1" }],
      };

  const menus = navMenusFromHover(reveals);
  const links = connectedNavLinks(header, includeShop);
  const tools = headerTools(header);
  const innerKids: Node[] = [
    brand,
    {
      type: "row",
      role: "nav",
      children: links.map((l) => {
        const menu =
          menus.get(l.label.toLowerCase()) ??
          [...menus.entries()].find(([k]) => k.startsWith(l.label.toLowerCase()) || l.label.toLowerCase().startsWith(k.split(/\s+/)[0] ?? k))?.[1] ??
          [];
        return {
          type: "link" as const,
          href: l.href,
          children: [
            { type: "text" as const, text: l.label, tag: "span" as const },
            ...(menu.length
              ? [
                  {
                    type: "stack" as const,
                    role: "menu",
                    children: menu.map((m) => ({
                      type: "link" as const,
                      href: internalNavHref(m.href, m.label),
                      children: [{ type: "text" as const, text: m.label, tag: "span" as const }],
                    })),
                  },
                ]
              : []),
          ],
        };
      }),
    },
  ];
  if (tools.length) innerKids.push({ type: "row", role: "tools", children: tools });
  out.push({
    type: "stack",
    style: shellStyle,
    role: "header",
    children: [
      {
        type: "row",
        style: innerStyle,
        children: innerKids,
      },
    ],
  });
  return out;
}

function headerTools(header: DomNode): Node[] {
  const tools: Node[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    tools.push({ type: "icon", name });
  };
  walk(header, (n) => {
    const hay = `${nameOf(n)} ${n.ariaLabel ?? ""} ${n.placeholder ?? ""} ${n.text}`.toLowerCase();
    if (n.tag === "input" && (n.type === "search" || /search/.test(hay))) add("search");
    if (/search/.test(hay) && (n.tag === "button" || n.tag === "a" || n.tag === "summary")) add("search");
    if (/account|log ?in|sign ?in|profile/.test(hay)) add("account");
    if (/\bcart\b|\bbag\b|basket/.test(hay)) add("cart");
  });
  return tools;
}

function connectedNavLinks(header: DomNode, includeShop: boolean): Array<{ href: string; label: string }> {
  const mapped = headerLinks(header).map((l) => ({
    label: l.label,
    href: internalNavHref(l.href, l.label),
  }));
  if (includeShop && !mapped.some((l) => l.href === "#/shop" || /^(shop|store|catalog)$/i.test(l.label))) {
    mapped.unshift({ href: "#/shop", label: "Shop" });
  }
  return mapped;
}

function shortSiteName(name: string | undefined): string {
  if (!name) return "Home";
  const cut = name.split(/[|–—-]/)[0]?.trim();
  return cut && cut.length <= 32 ? cut : name.slice(0, 28);
}

function headerLinks(header: DomNode): Array<{ href: string; label: string }> {
  const seen = new Set<string>();
  const fromAnchors = findAll(
    header,
    (n) =>
      n.tag === "a" &&
      Boolean(n.href) &&
      n.box.height <= 48 &&
      n.box.y < header.box.y + header.box.height,
  )
    .map((a) => ({ href: a.href!, label: linkLabel(a).replace(/\s+/g, " ").trim() }))
    .filter((l) => {
      if (!l.label || l.label.length > 28) return false;
      if (/^(cart|search|login|log in|account|wishlist|menu)$/i.test(l.label)) return false;
      const key = l.label.toLowerCase();
      if (seen.has(key) || seen.has(l.href)) return false;
      seen.add(key);
      seen.add(l.href);
      return true;
    });
  if (fromAnchors.length) return fromAnchors.slice(0, 8);

  const labels = findAll(header, (n) => n.tag === "span" || n.tag === "a")
    .map((n) => ({
      label: n.text.replace(/\s+/g, " ").trim(),
      href: n.href || findOne(n, (c) => c.tag === "a" && Boolean(c.href))?.href,
      x: n.box.x,
    }))
    .filter((l) => l.label.length >= 2 && l.label.length <= 22 && !/^[0-9]+$/.test(l.label));
  const uniq: Array<{ href: string; label: string }> = [];
  for (const item of labels.sort((a, b) => a.x - b.x)) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    if (/cart|search|login|account|wishlist|menu/.test(key)) continue;
    seen.add(key);
    uniq.push({ href: item.href || "#", label: item.label });
  }
  return uniq.slice(0, 8);
}

function newsletterSubmit(node: DomNode): string {
  const btn = findOne(
    node,
    (n) =>
      n.tag === "button" ||
      n.type === "submit" ||
      (n.tag === "input" && /submit|button/i.test(n.type ?? "")),
  );
  const fromBtn = btn ? linkLabel(btn) || btn.text.trim() || btn.ariaLabel || "" : "";
  if (fromBtn && fromBtn.length <= 24) return fromBtn;
  return texts(node).find((t) => /^(subscribe|sign up|join|send)$/i.test(t)) || "Subscribe";
}

function buildNewsletter(node: DomNode, ctx: BuildCtx): Node[] {
  const heading = sectionTitle(node) || texts(node).find((t) => t.length >= 8 && t.length <= 60) || "";
  const copy = texts(node).find(
    (t) => t !== heading && t.length > 18 && t.length < 160 && !/^email$/i.test(t),
  );
  const email = findOne(node, (n) => n.tag === "input" && (n.type === "email" || /email/i.test(n.placeholder ?? "")));
  const inputStyle = internStyle(ctx.theme.styles, {
    border: "1px solid currentColor",
    pad: ["12px", "16px"],
    width: "320px",
    radius: "$radius.md",
  });
  const submitStyle = internStyle(ctx.theme.styles, {
    border: "1px solid currentColor",
    pad: ["12px", "20px"],
    radius: "$radius.md",
  });
  const children: Node[] = [];
  if (heading) children.push({ type: "text", text: heading, tag: "h2", style: ctx.h2Style });
  if (copy) children.push({ type: "text", text: copy, tag: "p" });
  children.push({
    type: "row",
    children: [
      {
        type: "input",
        input: "email",
        placeholder: email?.placeholder || "Email",
        style: inputStyle,
      },
      { type: "button", text: newsletterSubmit(node), href: "#", style: submitStyle },
    ],
  });
  return [{ type: "stack", style: ctx.sectionStyle, role: "newsletter", children }];
}

function substantialKids(node: DomNode): DomNode[] {
  return visibleKids(node).filter((k) => k.box.height >= 16 && k.box.width >= 40);
}

function unwrapOnce(node: DomNode): DomNode {
  let n = node;
  for (let i = 0; i < 5; i++) {
    const kids = substantialKids(n);
    if (
      kids.length === 1 &&
      kids[0]!.box.width >= n.box.width * 0.7 &&
      kids[0]!.box.height >= n.box.height * 0.85
    ) {
      n = kids[0]!;
    } else break;
  }
  return n;
}

function rowBands(nodes: DomNode[]): DomNode[][] {
  const sorted = [...nodes].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const bands: DomNode[][] = [];
  for (const n of sorted) {
    const band = bands.find((b) => Math.abs(b[0]!.box.y - n.box.y) < 56);
    if (band) band.push(n);
    else bands.push([n]);
  }
  return bands;
}

function sideBySide(nodes: DomNode[], parentW: number): boolean {
  if (nodes.length < 2) return false;
  return nodes.filter((n) => n.box.width < parentW * 0.55).length >= 2;
}

function looksLikeLegal(node: DomNode): boolean {
  if (node.box.height > 90) return false;
  return /©|copyright/.test(deepText(node));
}

function hasEmailInput(node: DomNode): boolean {
  return Boolean(
    findOne(
      node,
      (n) => n.tag === "input" && (n.type === "email" || /email/i.test(`${n.placeholder ?? ""} ${n.ariaLabel ?? ""}`)),
    ),
  );
}

function footerInnerStyle(theme: ThemeDoc, maxW: string): string {
  return internStyle(theme.styles, {
    justify: "between",
    align: "start",
    wrap: true,
    gap: "$space.5",
    width: "100%",
    maxW,
  });
}

function buildFooterBlock(block: DomNode, theme: ThemeDoc, footerW: number): Node | null {
  if (hasEmailInput(block)) {
    const heading =
      sectionTitle(block) || texts(block).find((t) => t.length >= 8 && t.length <= 60) || "";
    const copy = texts(block).find((t) => t !== heading && t.length > 18 && t.length < 160 && !/^email$/i.test(t));
    const email = findOne(block, (n) => n.tag === "input" && (n.type === "email" || /email/i.test(n.placeholder ?? "")));
    const kids: Node[] = [];
    if (heading) kids.push({ type: "text", text: heading, tag: "h3" });
    if (copy) kids.push({ type: "text", text: copy, tag: "p" });
    kids.push({
      type: "input",
      input: "email",
      placeholder: email?.placeholder || "Email",
      style: internStyle(theme.styles, {
        border: "1px solid currentColor",
        pad: ["12px", "16px"],
        width: "100%",
        radius: "$radius.md",
      }),
    });
    const submit = newsletterSubmit(block);
    if (submit) kids.push({ type: "button", text: submit, href: "#", style: internStyle(theme.styles, { border: "1px solid currentColor", pad: ["12px", "20px"] }) });
    return {
      type: "stack",
      style: internStyle(theme.styles, { gap: "$space.3", maxW: `${Math.round(block.box.width)}px`, width: "100%" }),
      children: kids,
    };
  }

  const children: Node[] = [];
  const seenImg = new Set<string>();
  const seenLink = new Set<string>();
  const seenText = new Set<string>();
  for (const img of findAll(block, (n) => n.tag === "img" && Boolean(n.src) && n.box.width >= 40 && n.box.height >= 24)) {
    const id = internImg(theme, img);
    if (!id || seenImg.has(id)) continue;
    seenImg.add(id);
    children.push({ type: "image", asset: id, alt: img.alt || "" });
  }
  const heading =
    findOne(block, (n) => /^h[1-4]$/.test(n.tag)) ??
    findOne(block, (n) => n.tag === "span" && n.text.trim().length >= 2 && n.text.trim().length <= 24 && n.box.height <= 28);
  if (heading) {
    const t = headingText(heading) || heading.text.trim();
    if (t && !seenText.has(t.toLowerCase())) {
      seenText.add(t.toLowerCase());
      children.push({ type: "text", text: t, tag: "h3" });
    }
  }
  const linkLabels = new Set(
    findAll(block, (n) => n.tag === "a" && Boolean(n.href)).map((a) => socialLabel(a).toLowerCase()),
  );
  for (const t of texts(block)) {
    if (t.length < 16 || t.length > 240) continue;
    const key = t.toLowerCase();
    if (seenText.has(key) || linkLabels.has(key) || /^email$/i.test(t) || /©|copyright/.test(t)) continue;
    seenText.add(key);
    children.push({ type: "text", text: t, tag: "p" });
  }
  const links: Node[] = [];
  for (const a of findAll(block, (n) => n.tag === "a" && Boolean(n.href))) {
    const label = socialLabel(a);
    if (!label || label.length > 42 || /powered by/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seenLink.has(key) || seenText.has(key)) continue;
    seenLink.add(key);
    links.push({
      type: "link",
      href: a.href!,
      children: [{ type: "text", text: label, tag: "span" }],
    });
  }
  const wrap = links.length >= 6 && block.box.width >= footerW * 0.55;
  if (wrap) {
    children.push({
      type: "row",
      style: internStyle(theme.styles, { wrap: true, gap: "$space.2", align: "center" }),
      children: links,
    });
  } else {
    children.push(...links);
  }
  if (!children.length) return null;
  const imageHeavy =
    children.filter((c) => c.type === "image").length >= 1 &&
    children.filter((c) => c.type === "link" || c.type === "text").length <= 1;
  const colStyle = internStyle(theme.styles, {
    gap: "$space.3",
    align: imageHeavy ? "center" : "start",
    maxW: wrap ? "100%" : `${Math.round(block.box.width)}px`,
    width: wrap ? "100%" : "100%",
  });
  return { type: "stack", style: colStyle, children };
}

function legalRow(node: DomNode): Node | null {
  const legal: Node[] = [];
  const copyBits = texts(node).filter((t) => /©|copyright|powered by|all rights reserved/i.test(t));
  const copyText = [...new Set(copyBits.length ? copyBits : texts(node))].join(" ").replace(/\s+/g, " ").trim();
  const skip = new Set((copyBits.length ? copyBits : []).map((t) => t.toLowerCase()));
  if (copyText) legal.push({ type: "text", text: copyText, tag: "p" });
  const seen = new Set<string>(skip);
  for (const a of findAll(node, (n) => n.tag === "a" && Boolean(n.href))) {
    const label = socialLabel(a);
    if (!label || /powered by/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    legal.push({
      type: "link",
      href: a.href!,
      children: [{ type: "text", text: label, tag: "span" }],
    });
  }
  if (!legal.length) return null;
  return { type: "row", role: "legal", children: legal };
}

function emitFooterNode(node: DomNode, theme: ThemeDoc, footerW: number): Node | null {
  return looksLikeLegal(node) ? legalRow(node) : buildFooterBlock(node, theme, footerW);
}

function shouldDescend(block: DomNode, footerW: number): boolean {
  const inner = substantialKids(block);
  const regions = inner.filter((k) => k.box.height >= 64 && k.box.width >= 80);
  if (sideBySide(regions, footerW) && regions.every((k) => k.box.height >= 80)) return true;
  if (regions.length >= 2 && regions.every((k) => k.box.width >= footerW * 0.5)) return true;
  if (regions.length === 1) {
    const next = unwrapOnce(regions[0]!);
    if (next !== block) return shouldDescend(next, footerW);
  }
  return false;
}

function buildFooterRegion(node: DomNode, theme: ThemeDoc, footerW: number, innerStyle: string): Node[] {
  const root = unwrapOnce(node);
  const kids = substantialKids(root);
  if (!kids.length) {
    const one = emitFooterNode(root, theme, footerW);
    return one ? [one] : [];
  }
  const bands = rowBands(kids);
  const out: Node[] = [];
  for (const band of bands) {
    if (sideBySide(band, footerW)) {
      const cols = band
        .map((b) => emitFooterNode(unwrapOnce(b), theme, footerW))
        .filter((n): n is Node => Boolean(n));
      if (cols.length) out.push({ type: "row", style: innerStyle, children: cols });
      continue;
    }
    for (const item of band) {
      const block = unwrapOnce(item);
      if (looksLikeLegal(block)) {
        const row = legalRow(block);
        if (row) out.push(row);
        continue;
      }
      if (shouldDescend(block, footerW)) {
        out.push(...buildFooterRegion(block, theme, footerW, innerStyle));
        continue;
      }
      const built = buildFooterBlock(block, theme, footerW);
      if (built) out.push(built);
    }
  }
  return out;
}

function buildFooter(footer: DomNode, theme: ThemeDoc, styleId: string): Node {
  const painted = paintedPair(footer);
  const style = painted
    ? internStyle(theme.styles, {
        bg: internToken(theme.tokens, "color", painted.bg),
        color: internToken(theme.tokens, "color", painted.color),
        pad: ["$space.6", "$space.4"],
        gap: "$space.5",
      })
    : styleId;
  const maxW = headerInnerMax(footer, Math.round(footer.box.width) || 1200);
  const innerStyle = footerInnerStyle(theme, maxW);
  const children = buildFooterRegion(footer, theme, footer.box.width || 1200, innerStyle);
  return {
    type: "stack",
    style,
    role: "footer",
    children,
  };
}
