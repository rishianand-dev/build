import {
  isTokenRef,
  parseTokenRef,
  type BindMap,
  type Node,
  type Style,
  type ThemeDoc,
  type Tokens,
} from "../schema/theme.js";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assetUrl(url: string, base?: string): string {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("/")) return url;
  if (!base) return url;
  return `${base.replace(/\/?$/, "/")}${url.replace(/^\.\//, "")}`;
}

function tokenValue(tokens: Tokens, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!isTokenRef(raw)) return raw;
  const parsed = parseTokenRef(raw);
  if (!parsed) return raw;
  return tokens[parsed.group]?.[parsed.key] ?? raw;
}

function box(value: Style["pad"], tokens: Tokens): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return tokenValue(tokens, value);
  return value.map((v) => tokenValue(tokens, v) ?? v).join(" ");
}

function cssForStyle(id: string, style: Style, tokens: Tokens): string {
  const lines: string[] = [];
  const put = (prop: string, val: string | undefined) => {
    if (val) lines.push(`${prop}: ${val};`);
  };
  put("color", tokenValue(tokens, style.color));
  put("background", tokenValue(tokens, style.bg));
  put("font-family", tokenValue(tokens, style.font));
  put("font-size", tokenValue(tokens, style.size));
  put("font-weight", tokenValue(tokens, style.weight));
  put("line-height", tokenValue(tokens, style.leading));
  put("padding", box(style.pad, tokens));
  put("margin", box(style.m, tokens));
  put("gap", tokenValue(tokens, style.gap));
  put("border-radius", tokenValue(tokens, style.radius));
  put("box-shadow", tokenValue(tokens, style.shadow));
  put("width", style.width);
  put("max-width", style.maxW);
  put("height", style.height);
  put("top", style.top);
  put("text-align", style.textAlign);
  put("border", tokenValue(tokens, style.border) ?? style.border);
  put("text-decoration", style.decoration);
  if (style.z !== undefined) put("z-index", String(style.z));
  if (style.opacity !== undefined) put("opacity", String(style.opacity));
  if (style.pos) put("position", style.pos);
  const align = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;
  const justify = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    between: "space-between",
  } as const;
  if (style.align) put("align-items", align[style.align]);
  if (style.justify) put("justify-content", justify[style.justify]);
  if (style.wrap) put("flex-wrap", "wrap");
  if (style.cols) put("grid-template-columns", `repeat(${style.cols}, minmax(0, 1fr))`);
  if (!lines.length) return "";
  return `.s-${id}{\n  ${lines.join("\n  ")}\n}`;
}

function googleFontHref(family: string): string | null {
  const cleaned = family.split(",")[0]?.replace(/['"]/g, "").trim() ?? "";
  if (!cleaned) return null;
  if (/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|cursive|fantasy|emoji|inherit|Georgia|Arial|Helvetica|Times|Times New Roman|Verdana|Tahoma|Trebuchet MS|Courier|Courier New|Segoe UI|Apple Color Emoji)$/i.test(cleaned)) {
    return null;
  }
  const spec = encodeURIComponent(cleaned).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${spec}:wght@400;600;700&display=swap`;
}

function nodeTag(node: Node): string {
  if (node.role === "header") return "header";
  if (node.role === "footer") return "footer";
  if (node.role === "nav") return "nav";
  if (node.role === "hero") return "section";
  if (node.role === "carousel" || node.role === "newsletter") return "section";
  if (node.type === "list") return "section";
  return "div";
}

function iconSvg(name: string): string {
  const common = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  switch (name) {
    case "search":
      return `<svg ${common}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>`;
    case "account":
      return `<svg ${common}><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`;
    case "cart":
      return `<svg ${common}><path d="M6 7h15l-1.5 9h-12z"/><path d="M6 7L5 4H2"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>`;
    default:
      return esc(name);
  }
}

function classNames(node: Node): string {
  const bits = [`n-${node.type}`];
  if (node.style) bits.push(`s-${node.style}`);
  if (node.role) bits.push(`r-${node.role}`);
  return bits.join(" ");
}

function resolveBind(bind: BindMap, key: string | undefined): string {
  if (!key) return "";
  const v = bind[key];
  return v === null || v === undefined ? "" : String(v);
}

function renderNode(node: Node, theme: ThemeDoc, bind: BindMap = {}, assetBase?: string): string {
  switch (node.type) {
    case "text": {
      const text = node.bind ? resolveBind(bind, node.bind) : (node.text ?? "");
      if (!text) return "";
      const tag = node.tag ?? "p";
      return `<${tag} class="${classNames(node)}">${esc(text)}</${tag}>`;
    }
    case "image": {
      const assetId = node.bind ? resolveBind(bind, node.bind) : (node.asset ?? "");
      const asset = theme.assets[assetId];
      if (!asset) return "";
      const alt = esc(node.alt || asset.alt || "");
      const src = esc(assetUrl(asset.url, assetBase));
      if (asset.kind === "video") {
        return `<video class="${classNames(node)}" src="${src}" autoplay muted loop playsinline></video>`;
      }
      return `<img class="${classNames(node)}" src="${src}" alt="${alt}" />`;
    }
    case "icon":
      return `<span class="${classNames(node)}" aria-hidden="true">${iconSvg(node.name)}</span>`;
    case "spacer":
      return `<div class="${classNames(node)}" style="height:${esc(node.size ?? "24px")}"></div>`;
    case "input":
      return `<input class="${classNames(node)}" type="${esc(node.input)}" placeholder="${esc(node.placeholder ?? "")}" />`;
    case "button": {
      const text = node.bind ? resolveBind(bind, node.bind) : (node.text ?? "");
      if (!text) return "";
      const href = node.href ?? "#";
      return `<a class="${classNames(node)} btn" href="${esc(href)}">${esc(text)}</a>`;
    }
    case "link": {
      const href = node.bind ? resolveBind(bind, node.bind) : (node.href ?? "#");
      const inner = node.children.map((c) => renderNode(c, theme, bind, assetBase)).join("");
      if (!inner) return "";
      return `<a class="${classNames(node)}" href="${esc(href || "#")}">${inner}</a>`;
    }
    case "instance": {
      const comp = theme.components[node.of];
      if (!comp) return "";
      return renderNode(comp.root, theme, { ...bind, ...node.bind }, assetBase);
    }
    case "list": {
      if (node.role === "carousel") {
        const st = node.style ? theme.styles[node.style] : undefined;
        const per = st?.cols || 5;
        const slides = node.items.map((item) => {
          const inst: Node = { type: "instance", of: node.of, bind: item };
          return renderNode(inst, theme, bind, assetBase);
        });
        return carouselHtml(slides, per, classNames(node), slideVars(st));
      }
      const items = node.items
        .map((item) => {
          const inst: Node = { type: "instance", of: node.of, bind: item };
          return `<li>${renderNode(inst, theme, bind, assetBase)}</li>`;
        })
        .join("");
      return `<${nodeTag(node)} class="${classNames(node)}"><ul class="list-track ${node.style ? `s-${node.style}` : ""}">${items}</ul></${nodeTag(node)}>`;
    }
    case "stack":
    case "row":
    case "grid":
    case "layer": {
      if (node.role === "carousel") {
        const st = node.style ? theme.styles[node.style] : undefined;
        const per = st?.cols || 1;
        const slides = node.children.map((c) => renderNode(c, theme, bind, assetBase)).filter(Boolean);
        return carouselHtml(slides, per, classNames(node), slideVars(st));
      }
      const inner = node.children.map((c) => renderNode(c, theme, bind, assetBase)).join("");
      const tag = nodeTag(node);
      return `<${tag} class="${classNames(node)}">${inner}</${tag}>`;
    }
  }
}

function padLeft(style: Style | undefined): string | undefined {
  if (!style?.pad) return undefined;
  if (typeof style.pad === "string") return undefined;
  if (style.pad.length === 4) return style.pad[3];
  return undefined;
}

function slideVars(style: Style | undefined): { cardW?: string; padLeft?: string } {
  return {
    cardW: style?.width,
    padLeft: padLeft(style),
  };
}

function carouselHtml(
  slides: string[],
  per: number,
  className: string,
  vars: { cardW?: string; padLeft?: string } = {},
): string {
  const usable = slides.filter(Boolean);
  if (!usable.length) return "";
  const size = Math.max(1, per);
  const inline = [
    vars.cardW ? `--card-w:${esc(vars.cardW)}` : "",
    vars.padLeft ? `--strip-pad:${esc(vars.padLeft)}` : "",
  ]
    .filter(Boolean)
    .join(";");
  const styleAttr = inline ? ` style="${inline}"` : "";
  if (size > 1) {
    const steps = Math.max(1, usable.length - size + 1);
    const multi = usable.length > size;
    const track = usable.map((slide) => `<div class="carousel-slide">${slide}</div>`).join("");
    const controls = multi
      ? `<div class="carousel-controls"><button type="button" class="carousel-prev" aria-label="Previous">‹</button><span class="carousel-counter"><span class="carousel-num">1</span> / ${steps}</span><button type="button" class="carousel-next" aria-label="Next">›</button></div>`
      : "";
    return `<section class="${className} r-carousel r-strip" data-per="${size}" data-mode="strip"${styleAttr}><div class="carousel-viewport"><div class="carousel-track">${track}</div></div>${controls}</section>`;
  }
  const pages: string[][] = [];
  for (let i = 0; i < usable.length; i += size) pages.push(usable.slice(i, i + size));
  const pageHtml = pages
    .map(
      (page) =>
        `<div class="carousel-page">${page.map((slide) => `<div class="carousel-slide">${slide}</div>`).join("")}</div>`,
    )
    .join("");
  const multi = pages.length > 1;
  const nav = multi
    ? `<button type="button" class="carousel-prev" aria-label="Previous">‹</button><button type="button" class="carousel-next" aria-label="Next">›</button>`
    : "";
  const dots = multi
    ? `<div class="carousel-dots">${pages
        .map((_, i) => `<button type="button" class="carousel-dot${i === 0 ? " on" : ""}" data-i="${i}" aria-label="Slide ${i + 1}"></button>`)
        .join("")}</div>`
    : "";
  return `<section class="${className} r-carousel" data-per="${size}"${styleAttr}>${nav}<div class="carousel-viewport"><div class="carousel-track">${pageHtml}</div></div>${dots}</section>`;
}

function routeCss(pages: Array<{ path: string }>): string {
  const rules = pages.map((page) => {
    const path = esc(page.path);
    return `html[data-route="${path}"] article.route[data-route="${path}"] { display: block !important; }`;
  });
  return `article.route { display: none !important; }\n  ${rules.join("\n  ")}`;
}

function routeScript(): string {
  return `<script>
(function () {
  var initial = document.documentElement.getAttribute("data-initial") || "/";
  function path() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return initial;
    return raw.charAt(0) === "/" ? raw : "/" + raw;
  }
  function show() {
    var current = path();
    var match = document.querySelector('article.route[data-route="' + current + '"]');
    if (document.body && !match) {
      current = initial;
      match = document.querySelector('article.route[data-route="' + current + '"]');
    }
    document.documentElement.setAttribute("data-route", current);
    if (match) {
      var title = match.getAttribute("data-title");
      if (title) document.title = title;
    }
  }
  show();
  window.addEventListener("hashchange", show);
  document.addEventListener("DOMContentLoaded", show);
})();
</script>`;
}

function menuScript(): string {
  return `<script>
(function () {
  document.querySelectorAll(".r-nav > .n-link").forEach(function (link) {
    var menu = link.querySelector(".r-menu");
    if (!menu) return;
    link.addEventListener("click", function (e) {
      if (e.target.closest(".r-menu")) return;
      e.preventDefault();
      document.querySelectorAll(".r-nav > .n-link.open").forEach(function (other) {
        if (other !== link) other.classList.remove("open");
      });
      link.classList.toggle("open");
    });
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest(".r-nav > .n-link")) return;
    document.querySelectorAll(".r-nav > .n-link.open").forEach(function (link) {
      link.classList.remove("open");
    });
  });
})();
</script>`;
}

function carouselScript(): string {
  return `<script>
(function () {
  document.querySelectorAll(".r-carousel").forEach(function (root) {
    var track = root.querySelector(".carousel-track");
    if (!track) return;
    var i = 0;
    if (root.getAttribute("data-mode") === "strip") {
      var slides = root.querySelectorAll(".carousel-slide");
      var per = Number(root.getAttribute("data-per")) || 5;
      if (slides.length <= per) return;
      var max = Math.max(0, slides.length - per);
      var num = root.querySelector(".carousel-num");
      function goStrip(n) {
        i = Math.max(0, Math.min(max, n));
        var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
        var w = slides[0].getBoundingClientRect().width + gap;
        track.style.transform = "translateX(" + (-i * w) + "px)";
        if (num) num.textContent = String(i + 1);
      }
      var prev = root.querySelector(".carousel-prev");
      var next = root.querySelector(".carousel-next");
      if (prev) prev.addEventListener("click", function () { goStrip(i - 1); });
      if (next) next.addEventListener("click", function () { goStrip(i + 1); });
      window.addEventListener("resize", function () { goStrip(i); });
      return;
    }
    var pages = root.querySelectorAll(".carousel-page");
    if (pages.length < 2) return;
    var dots = root.querySelectorAll(".carousel-dot");
    var viewport = root.querySelector(".carousel-viewport");
    function go(n) {
      i = (n + pages.length) % pages.length;
      var w = viewport ? viewport.clientWidth : root.clientWidth;
      track.style.transform = "translateX(" + (-i * w) + "px)";
      dots.forEach(function (d, di) { d.classList.toggle("on", di === i); });
    }
    var prev = root.querySelector(".carousel-prev");
    var next = root.querySelector(".carousel-next");
    if (prev) prev.addEventListener("click", function () { go(i - 1); });
    if (next) next.addEventListener("click", function () { go(i + 1); });
    dots.forEach(function (d) {
      d.addEventListener("click", function () { go(Number(d.getAttribute("data-i"))); });
    });
    if (root.getAttribute("data-per") === "1") {
      setInterval(function () { go(i + 1); }, 5000);
    }
    window.addEventListener("resize", function () { go(i); });
  });
})();
</script>`;
}

export function renderThemeHtml(
  theme: ThemeDoc,
  pageId = "home",
  opts?: { assetBase?: string; pages?: "all" | "one" },
): string {
  const selected = theme.pages.find((p) => p.id === pageId) ?? theme.pages[0];
  if (!selected) return "<!doctype html><title>Empty</title>";
  const pages = opts?.pages === "one" ? [selected] : theme.pages.length ? theme.pages : [selected];
  const css = Object.entries(theme.styles)
    .map(([id, style]) => cssForStyle(id, style, theme.tokens))
    .filter(Boolean)
    .join("\n");
  const fonts = Object.values(theme.tokens.font)
    .map(googleFontHref)
    .filter((x): x is string => Boolean(x));
  const fontLinks = [...new Set(fonts)]
    .map((href) => `<link rel="stylesheet" href="${esc(href)}" />`)
    .join("\n");
  const body = pages
    .map((page) => {
      const inner = renderNode(page.root, theme, {}, opts?.assetBase);
      return `<article class="route" data-route="${esc(page.path)}" data-title="${esc(page.title || page.name || theme.site.name || "Site")}">${inner}</article>`;
    })
    .join("\n");
  const title = esc(selected.title || theme.site.name || "Site");
  const bg = theme.tokens.color.bg ?? "#faf6ee";
  const fg = theme.tokens.color.fg ?? "#1b1610";
  const font = theme.tokens.font.body ?? "Georgia, serif";
  const initial = esc(selected.path || "/");
  const router = pages.length > 1 ? routeScript() : "";
  const routes = pages.length > 1 ? routeCss(pages) : "";

  return `<!doctype html>
<html lang="en" data-initial="${initial}" data-route="${initial}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${router}
${fontLinks}
<style>
  :root {
    --bg: ${bg};
    --fg: ${fg};
    --font: ${font}, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font); }
  img { max-width: 100%; display: block; height: auto; }
  video { max-width: 100%; display: block; }
  a { color: inherit; text-decoration: none; }
  ${routes}
  article.route, article.route > .n-stack { width: 100%; }
  header.r-header, .r-header {
    width: 100% !important;
    max-width: none !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    left: 0;
    right: 0;
  }
  .n-row { display: flex; flex-direction: row; align-items: center; gap: 16px; flex-wrap: wrap; }
  .n-stack { display: flex; flex-direction: column; }
  .r-header {
    background: #fff;
    border-bottom: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .r-header > .n-row {
    width: 100%;
    margin: 0 auto;
  }
  .r-header img { max-height: 40px; width: auto; height: 40px; object-fit: contain; }
  .r-header .r-nav { flex: 1; justify-content: center; gap: 22px; }
  .r-header .r-nav a { font-size: 14px; letter-spacing: 0.01em; color: var(--fg); }
  .r-header .r-nav a:hover { text-decoration: underline; }
  .r-header .r-tools { gap: 4px; margin-left: auto; }
  .r-header .r-tools span { display: inline-flex; width: 36px; height: 36px; align-items: center; justify-content: center; color: var(--fg); }
  .r-hero { width: 100%; }
  .r-hero img, .r-hero video { width: 100%; max-height: 520px; object-fit: cover; }
  .r-banner { width: 100%; justify-content: center; text-align: center; font-size: 14px; }
  .r-carousel { position: relative; width: 100% !important; max-width: none !important; overflow: hidden; }
  .carousel-viewport { overflow: hidden; width: 100%; }
  .carousel-track { display: flex; width: 100%; transition: transform 0.45s ease; }
  .carousel-page { flex: 0 0 100%; width: 100%; min-width: 100%; max-width: 100%; display: flex; justify-content: center; gap: 16px; }
  .r-carousel[data-per="1"] .carousel-slide { width: 100%; }
  .r-carousel[data-per="1"] img, .r-carousel[data-per="1"] video { width: 100%; max-height: 520px; object-fit: cover; }
  .r-carousel:not([data-per="1"]) .carousel-page { padding: 0 48px; }
  .r-carousel:not([data-per="1"]) .carousel-slide { flex: 0 0 var(--card-w, 220px); width: var(--card-w, 220px); }
  .r-strip { overflow: hidden; }
  .r-strip .carousel-viewport { overflow: hidden; width: 100%; }
  .r-strip .carousel-track { display: flex; gap: 16px; padding-left: var(--strip-pad, 24px); padding-right: 40px; width: max-content; }
  .r-strip .carousel-slide { flex: 0 0 var(--card-w, 220px); width: var(--card-w, 220px); }
  .r-strip .carousel-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 18px;
    padding: 16px 0 4px;
    font-size: 14px;
  }
  .r-strip .carousel-prev, .r-strip .carousel-next {
    position: static;
    transform: none;
    width: auto;
    height: auto;
    background: transparent;
    font-size: 22px;
  }
  .r-strip .carousel-counter { letter-spacing: 0.06em; min-width: 3.5em; text-align: center; }
  .r-collections ul.list-track {
    display: grid;
    list-style: none;
    margin: 0 auto;
    width: 100%;
    max-width: 1100px;
    padding: 0 20px;
    gap: 16px;
  }
  .r-collections li { width: auto; min-width: 0; }
  .r-tile {
    display: flex;
    flex-direction: column;
    width: 100%;
    color: inherit;
    background: #fff;
  }
  .r-tile img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }
  .r-tile h3 {
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    padding: 14px 8px 8px;
    min-height: 0;
  }
  .r-more {
    display: flex;
    justify-content: center;
    padding: 8px 0 16px;
    text-decoration: underline;
    text-underline-offset: 3px;
    font-size: 14px;
  }
  .carousel-prev, .carousel-next {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, #fff 85%, transparent);
    color: inherit;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
  }
  .carousel-prev { left: 12px; }
  .carousel-next { right: 12px; }
  .carousel-dots { display: flex; justify-content: center; gap: 8px; padding: 12px 0 4px; }
  .carousel-dot {
    width: 8px;
    height: 8px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 25%, transparent);
    cursor: pointer;
  }
  .carousel-dot.on { background: currentColor; }
  .r-newsletter { align-items: center; text-align: center; gap: 12px; padding: 48px 24px; }
  .r-newsletter .n-row { justify-content: center; }
  .r-newsletter input, .r-footer input {
    min-width: 260px;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .n-grid, .n-list:not(.r-collections) ul.list-track {
    display: grid;
    list-style: none;
    margin: 0 auto;
    padding: 0 40px;
    width: 100%;
    max-width: 1320px;
    gap: 16px;
  }
  .n-list { width: 100%; }
  .n-list:not(.r-collections) li { min-width: 0; }
  .n-layer { position: relative; display: block; }
  .r-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: #fff;
    border: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
    border-radius: 6px;
    overflow: hidden;
    color: inherit;
    gap: 0;
  }
  .r-media { position: relative; width: 100%; background: #f3f3f3; }
  .r-media img, .r-card > img {
    width: 100%;
    aspect-ratio: 1 / 1;
    height: auto;
    object-fit: contain;
    object-position: center top;
    background: #f3f3f3;
    transition: opacity 0.25s ease;
  }
  .r-hover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    z-index: 1;
  }
  .r-card:hover .r-hover-img { opacity: 1; }
  .r-card:hover .r-media > img:not(.r-hover-img) { opacity: 0; }
  .r-hover {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    display: flex;
    justify-content: center;
    padding: 10px 8px;
    background: color-mix(in srgb, #000 45%, transparent);
    color: #fff;
    font-size: 13px;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .r-card:hover .r-hover { opacity: 1; }
  .r-nav { position: relative; }
  .r-nav > .n-link { position: relative; }
  .r-menu {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 40;
    min-width: 188px;
    flex-direction: column;
    gap: 0;
    padding: 10px 0;
    background: #fff;
    color: var(--fg);
    box-shadow: 0 10px 28px color-mix(in srgb, #000 14%, transparent);
  }
  .r-nav > .n-link:hover > .r-menu,
  .r-nav > .n-link:focus-within > .r-menu,
  .r-nav > .n-link.open > .r-menu { display: flex; }
  .r-menu a { display: block; padding: 8px 16px; white-space: nowrap; }
  .r-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1;
    font-size: 12px;
    line-height: 1.2;
  }
  .r-info { width: 100%; }
  .r-card h3 {
    font-size: 13px;
    font-weight: 400;
    line-height: 1.3;
    padding: 0;
    min-height: 34px;
  }
  .r-prices { display: flex; flex-direction: row; align-items: baseline; gap: 8px; flex-wrap: nowrap; }
  .r-cart {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 45px;
    margin-top: 6px;
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .r-main { max-width: 1080px; margin: 0 auto; width: 100%; }
  .r-main > .n-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
    gap: 32px;
  }
  .r-main img { width: 100%; aspect-ratio: 1; object-fit: cover; }
  .btn {
    display: inline-flex;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 13px;
    width: fit-content;
  }
  .r-footer { width: 100%; }
  .r-footer > .n-row { margin: 0 auto; width: 100%; align-items: flex-start; justify-content: space-between; }
  .r-footer a { color: inherit; text-decoration: none; }
  .r-footer a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .r-footer h2, .r-footer h3 { text-align: left; font-size: 16px; }
  .r-footer img { max-width: 230px; height: auto; object-fit: contain; }
  .r-footer .r-legal { margin: 0 auto; width: 100%; gap: 16px; font-size: 13px; }
  h1,h2,h3,p { margin: 0; }
  h2 { text-align: center; }
  @media (max-width: 800px) {
    .r-main > .n-row { grid-template-columns: 1fr; }
  }
</style>
<style>${css}</style>
</head>
<body>
${body}
${router}
${carouselScript()}
${menuScript()}
</body>
</html>
`;
}
