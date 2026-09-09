/**
 * Everything in this file is passed through page.evaluate.
 * Helpers MUST live inside runInPage so Playwright serializes a single closure.
 */
import type {
  Box,
  CandidateBlock,
  ComputedStyleSnapshot,
  DomNode,
  ThemeHints,
} from "../types/page-capture.js";

export type InPageCommand =
  | { op: "dom"; maxNodes: number }
  | { op: "seo" }
  | { op: "theme" }
  | { op: "metrics" }
  | { op: "headerCandidate" }
  | { op: "probeHeader"; selector: string }
  | { op: "cards"; limit: number }
  | { op: "hoverTargets"; cardLimit: number; navLimit: number }
  | { op: "hoverSnap"; selector: string }
  | { op: "blocks"; maxBlocks: number }
  | { op: "hash"; selector: string }
  | { op: "dismiss" };

export type HoverSnap = {
  text: string;
  images: string[];
  links: Array<{ href: string; label: string }>;
  box: Box;
  hash: string;
};

export type HeaderProbeLive = {
  selector: string;
  tag: string;
  className: string;
  computed_position: string;
  computed_transform: string;
  box: Box;
  visible: boolean;
};

export type InPageResult = {
  dom: DomNode | null;
  seo: {
    description: string | null;
    canonical: string | null;
    og_title: string | null;
    og_description: string | null;
    og_image: string | null;
  } | null;
  theme: ThemeHints | null;
  metrics: { scroll_width: number; scroll_height: number } | null;
  headerCandidate: { selector: string; tag: string; className: string } | null;
  headerProbe: HeaderProbeLive | null;
  cards: string[];
  hoverTargets: Array<{ selector: string; kind: "card" | "nav" }>;
  hoverSnap: HoverSnap | null;
  blocks: CandidateBlock[];
  hash: { hash: string; text: string; box: Box } | null;
  dismissed: string[];
};

export const runInPage = (cmd: InPageCommand): InPageResult => {
  const empty: InPageResult = {
    dom: null,
    seo: null,
    theme: null,
    metrics: null,
    headerCandidate: null,
    headerProbe: null,
    cards: [],
    hoverTargets: [],
    hoverSnap: null,
    blocks: [],
    hash: null,
    dismissed: [],
  };

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "LINK",
    "META",
    "TEMPLATE",
    "HEAD",
  ]);

  const STYLE_KEYS = [
    "display",
    "position",
    "top",
    "left",
    "right",
    "bottom",
    "zIndex",
    "overflow",
    "opacity",
    "visibility",
    "transform",
    "backgroundColor",
    "backgroundImage",
    "color",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textAlign",
    "padding",
    "margin",
    "borderRadius",
    "boxShadow",
    "flexDirection",
    "justifyContent",
    "alignItems",
    "gap",
    "gridTemplateColumns",
  ] as const;

  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  const readStyle = (el: Element): ComputedStyleSnapshot => {
    const cs = getComputedStyle(el);
    const out = {} as ComputedStyleSnapshot;
    for (const key of STYLE_KEYS) {
      out[key] = cs[key] as string;
    }
    if (out.backgroundImage && out.backgroundImage.length > 300) {
      out.backgroundImage = out.backgroundImage.slice(0, 300) + "…";
    }
    if (out.fontFamily && out.fontFamily.length > 160) {
      out.fontFamily = out.fontFamily.slice(0, 160);
    }
    return out;
  }

  const ownText = (el: Element, max = 240): string => {
    let t = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) t += node.textContent ?? "";
    }
    return t.replace(/\s+/g, " ").trim().slice(0, max);
  }

  const cssPath = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 6) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      const idx = siblings.indexOf(cur) + 1;
      const cls = Array.from(cur.classList)
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
      parts.unshift(siblings.length > 1 ? `${tag}${cls}:nth-of-type(${idx})` : `${tag}${cls}`);
      cur = parent;
    }
    return parts.join(" > ");
  }

  const isSkippable = (el: Element): boolean => {
    if (SKIP_TAGS.has(el.tagName)) return true;
    return getComputedStyle(el).display === "none";
  }

  const visibleEnough = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width >= 40 && r.height >= 24;
  }

  const DATA_ATTR_ALLOWLIST = [
    "testid",
    "test",
    "cy",
    "component",
    "component-name",
    "section",
    "section-type",
    "section-id",
    "block",
    "block-type",
    "role",
    "name",
    "type",
    "widget",
    "widget-type",
    "module",
    "id",
  ];

  const readDataAttrs = (el: Element): Record<string, string> | undefined => {
    let out: Record<string, string> | undefined;
    for (const key of DATA_ATTR_ALLOWLIST) {
      const value = el.getAttribute(`data-${key}`);
      if (value) {
        out ??= {};
        out[key] = value;
      }
    }
    return out;
  }

  // Unlike `.src`/`.currentSrc` (browser-resolved, always absolute), the
  // `.srcset` IDL getter reflects the raw attribute text verbatim — a
  // root-relative candidate (e.g. "/media/x.jpg 1024w") stays root-relative.
  // pickImageUrl() downstream prefers the highest-width srcset candidate
  // over `.src`, so a relative URL here silently defeats asset rehosting.
  const resolveSrcset = (raw: string): string =>
    raw
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return trimmed;
        const spaceIdx = trimmed.search(/\s/);
        const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const descriptor = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx);
        try {
          return `${new URL(url, location.href).href}${descriptor}`;
        } catch {
          return trimmed;
        }
      })
      .filter(Boolean)
      .join(", ");

  const collectDom = (maxNodes: number): DomNode | null => {
    let count = 0;
    const walk = (el: Element): DomNode | null => {
      if (count >= maxNodes) return null;
      if (isSkippable(el)) return null;
      const box = boxOf(el);
      if (box.width === 0 && box.height === 0 && getComputedStyle(el).position === "static") {
        return null;
      }
      count += 1;
      const node: DomNode = {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : "",
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        dataAttrs: readDataAttrs(el),
        text: ownText(el),
        box,
        style: readStyle(el),
        children: [],
      };
      if (el instanceof HTMLAnchorElement && el.href) node.href = el.href;
      if (el instanceof HTMLImageElement) {
        node.src = el.currentSrc || el.src;
        node.srcset = el.srcset ? resolveSrcset(el.srcset) : undefined;
        node.alt = el.alt;
      }
      if (el instanceof HTMLVideoElement) {
        const source = el.querySelector("source");
        node.src = el.currentSrc || el.src || source?.getAttribute("src") || undefined;
        node.poster = el.poster || undefined;
        node.alt = el.getAttribute("aria-label") || undefined;
      }
      if (el instanceof HTMLInputElement) {
        node.type = el.type;
        node.placeholder = el.placeholder;
      }
      if (el instanceof HTMLButtonElement) node.type = el.type;
      const kids: DomNode[] = [];
      for (const child of Array.from(el.children)) {
        const n = walk(child);
        if (n) kids.push(n);
      }
      node.children = kids;
      return node;
    }
    return document.body ? walk(document.body) : null;
  }

  const collectSeo = () => {
    const meta = (name: string) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ??
      document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ??
      null;
    return {
      description: meta("description"),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      og_title: meta("og:title"),
      og_description: meta("og:description"),
      og_image: meta("og:image"),
    };
  }

  const collectTheme = (): ThemeHints => {
    const body = getComputedStyle(document.body);
    const fonts = new Set<string>();
    const colors = new Set<string>();
    const vars: Record<string, string> = {};
    const root = getComputedStyle(document.documentElement);
    for (let i = 0; i < root.length; i++) {
      const prop = root[i];
      if (prop.startsWith("--")) {
        const val = root.getPropertyValue(prop).trim();
        if (val) vars[prop] = val.slice(0, 120);
      }
    }
    const samples = Array.from(
      document.querySelectorAll("h1, h2, h3, p, a, button, header, nav, footer"),
    ).slice(0, 80);
    for (const el of samples) {
      const cs = getComputedStyle(el);
      const family = cs.fontFamily.split(",")[0]?.replace(/['"]/g, "").trim();
      if (family) fonts.add(family);
      if (cs.color && cs.color !== "rgba(0, 0, 0, 0)") colors.add(cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") {
        colors.add(cs.backgroundColor);
      }
    }
    return {
      background_color: body.backgroundColor,
      text_color: body.color,
      fonts: Array.from(fonts).slice(0, 12),
      color_palette: Array.from(colors).slice(0, 24),
      css_variables: vars,
    };
  }

  const probe = (selector: string): HeaderProbeLive | null => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const box = boxOf(el);
    const visible =
      cs.visibility !== "hidden" &&
      cs.display !== "none" &&
      Number(cs.opacity) > 0.05 &&
      box.height > 0 &&
      box.y + box.height > 0;
    return {
      selector,
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === "string" ? el.className : "",
      computed_position: cs.position,
      computed_transform: cs.transform,
      box,
      visible,
    };
  }

  const findHeader = (): { selector: string; tag: string; className: string } | null => {
    const ranked: Element[] = [];
    const banner = document.querySelector("header, [role='banner']");
    if (banner) ranked.push(banner);
    const sticky = Array.from(document.querySelectorAll("body *")).filter((el) => {
      if (!visibleEnough(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") return false;
      const r = el.getBoundingClientRect();
      return r.y <= 20 && r.width >= window.innerWidth * 0.5 && r.height >= 32 && r.height <= 220;
    });
    ranked.push(...sticky);
    const first = document.body
      ? Array.from(document.body.children).find((el) => {
          if (SKIP_TAGS.has(el.tagName)) return false;
          const r = el.getBoundingClientRect();
          return r.y <= 10 && r.height >= 32 && r.height <= 240 && r.width >= window.innerWidth * 0.5;
        })
      : undefined;
    if (first) ranked.push(first);

    if (ranked.length === 0) {
      const topNav = document.querySelector("nav");
      if (topNav) {
        const r = topNav.getBoundingClientRect();
        if (r.y <= 80 && r.height >= 28 && r.height <= 400) ranked.push(topNav);
      }
    }

    if (ranked.length === 0) {
      const topBand = Array.from(document.querySelectorAll("body *"))
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return r.y >= -5 && r.y <= 80 && r.width >= 160 && r.height >= 28 && r.height <= 400;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.y - rb.y || rb.width - ra.width;
        })[0];
      if (topBand) ranked.push(topBand);
    }

    const el = ranked[0];
    if (!el) return null;
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === "string" ? el.className : "",
    };
  }

  const findCards = (limit: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const parent of Array.from(document.querySelectorAll("body *"))) {
      const kids = Array.from(parent.children).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width >= 120 && r.height >= 80 && r.height <= 900;
      });
      if (kids.length < 3) continue;
      const sig = (el: Element) =>
        `${el.tagName}:${Array.from(el.classList).slice(0, 3).join(".")}`;
      const counts = new Map<string, Element[]>();
      for (const kid of kids) {
        const s = sig(kid);
        const arr = counts.get(s) ?? [];
        arr.push(kid);
        counts.set(s, arr);
      }
      for (const els of counts.values()) {
        if (els.length < 3) continue;
        for (const el of els.slice(0, limit - out.length)) {
          const sel = cssPath(el);
          if (seen.has(sel)) continue;
          seen.add(sel);
          out.push(sel);
          if (out.length >= limit) return out;
        }
      }
    }
    if (out.length < limit) {
      const extras = Array.from(
        document.querySelectorAll(
          "article, [class*='card' i], [class*='product' i], li[class*='item' i]",
        ),
      ).filter(visibleEnough);
      for (const el of extras) {
        const sel = cssPath(el);
        if (seen.has(sel)) continue;
        seen.add(sel);
        out.push(sel);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  const isShown = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  const bitsFrom = (root: Element): { text: string; images: string[]; links: Array<{ href: string; label: string }> } => {
    const images: string[] = [];
    const links: Array<{ href: string; label: string }> = [];
    const seenImg = new Set<string>();
    const seenLink = new Set<string>();
    const walk = (el: Element) => {
      if (!isShown(el)) return;
      if (el instanceof HTMLImageElement) {
        const src = el.currentSrc || el.src;
        if (src && !src.startsWith("data:image/svg") && !seenImg.has(src)) {
          seenImg.add(src);
          images.push(src);
        }
      }
      if (el instanceof HTMLAnchorElement && el.href) {
        const label = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const key = `${el.href}|${label}`;
        if (label && label.length <= 48 && !seenLink.has(key)) {
          seenLink.add(key);
          links.push({ href: el.href, label });
        }
      }
      for (const child of Array.from(el.children)) walk(child);
    }
    walk(root);
    return { text: visibleText(root).slice(0, 600), images, links };
  }

  const mergeBits = (
    a: { text: string; images: string[]; links: Array<{ href: string; label: string }> },
    b: { text: string; images: string[]; links: Array<{ href: string; label: string }> },
  ) => {
    const images = [...a.images];
    for (const img of b.images) if (!images.includes(img)) images.push(img);
    const links = [...a.links];
    const seen = new Set(a.links.map((l) => `${l.href}|${l.label}`));
    for (const l of b.links) {
      const key = `${l.href}|${l.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(l);
    }
    const text = `${a.text} ${b.text}`.replace(/\s+/g, " ").trim().slice(0, 800);
    return { text, images, links };
  }

  const popoutBits = (anchor: Element) => {
    const a = anchor.getBoundingClientRect();
    const empty = { text: "", images: [] as string[], links: [] as Array<{ href: string; label: string }> };
    let extra = empty;
    const nodes = document.querySelectorAll(
      "header *, [role='menu'], [role='listbox'], [class*='menu' i], [class*='dropdown' i], [class*='mega' i], [class*='popover' i], [class*='flyout' i]",
    );
    for (const el of Array.from(nodes)) {
      if (anchor.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "absolute" && cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (!isShown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      const under =
        r.top >= a.top - 16 && r.top <= a.bottom + 48 && r.left < a.right + 160 && r.right > a.left - 160;
      const drop = r.top >= a.bottom - 12 && r.top <= a.bottom + 480 && r.width >= 80;
      if (!under && !drop) continue;
      extra = mergeBits(extra, bitsFrom(el));
    }
    return extra;
  }

  const hoverSnap = (selector: string): HoverSnap | null => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const bits = mergeBits(bitsFrom(el), popoutBits(el));
    const payload = `${bits.text}|${bits.images.join(",")}|${bits.links.map((l) => l.label).join(",")}`;
    let h = 0;
    for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
    return { ...bits, box: boxOf(el), hash: String(h) };
  }

  const findNavs = (limit: number): string[] => {
    const header = document.querySelector("header, [role='banner']") ?? document.body;
    if (!header) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const nodes = Array.from(header.querySelectorAll("a, button, [aria-haspopup='true']"));
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.y > 160 || r.height < 10 || r.height > 64 || r.width < 12) continue;
      const label = (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (/^(cart|search|login|log in|account|wishlist)$/i.test(label)) continue;
      const sel = cssPath(el);
      if (seen.has(sel)) continue;
      seen.add(sel);
      out.push(sel);
      if (out.length >= limit) break;
    }
    return out;
  }

  const findHoverTargets = (cardLimit: number, navLimit: number): Array<{ selector: string; kind: "card" | "nav" }> => {
    const seen = new Set<string>();
    const out: Array<{ selector: string; kind: "card" | "nav" }> = [];
    for (const selector of findCards(cardLimit)) {
      if (seen.has(selector)) continue;
      seen.add(selector);
      out.push({ selector, kind: "card" });
    }
    for (const selector of findNavs(navLimit)) {
      if (seen.has(selector)) continue;
      seen.add(selector);
      out.push({ selector, kind: "nav" });
    }
    return out;
  }

  const cleanSnippet = (el: Element, max = 6000): string => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll("script, style, noscript, iframe, svg").forEach((n) => n.remove());
    const html = clone.outerHTML.replace(/\s+/g, " ").trim();
    return html.length > max ? html.slice(0, max) + "…" : html;
  }

  const collectBlocks = (maxBlocks: number): CandidateBlock[] => {
    const blocks: CandidateBlock[] = [];
    const seen = new Set<Element>();
    const landmarks = Array.from(
      document.querySelectorAll(
        "header, footer, nav, main, aside, [role='banner'], [role='navigation'], [role='main'], [role='contentinfo']",
      ),
    );

    const consider = (el: Element, landmark: boolean, gapBefore: number) => {
      if (seen.has(el) || SKIP_TAGS.has(el.tagName)) return;
      const box = boxOf(el);
      if (box.width < 80 || box.height < 40) return;
      seen.add(el);
      const parent = el.parentElement;
      let repeated = 0;
      if (parent) {
        const sig = `${el.tagName}:${Array.from(el.classList).slice(0, 2).join(".")}`;
        repeated = Array.from(parent.children).filter(
          (c) => `${c.tagName}:${Array.from(c.classList).slice(0, 2).join(".")}` === sig,
        ).length;
      }
      blocks.push({
        index: blocks.length,
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        className: typeof el.className === "string" ? el.className : "",
        id: el.id || "",
        box,
        gap_before_px: Math.round(gapBefore),
        text_preview: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
        html_snippet: cleanSnippet(el),
        image_count: el.querySelectorAll("img").length,
        link_count: el.querySelectorAll("a").length,
        repeated_sibling_count: repeated,
        landmark,
      });
    }

    for (const el of landmarks) consider(el, true, 0);
    const roots = [document.querySelector("main"), document.body].filter(
      (n): n is HTMLElement => n instanceof HTMLElement,
    );
    for (const root of roots) {
      const kids = Array.from(root.children).filter((el) => !SKIP_TAGS.has(el.tagName));
      let prevBottom: number | null = null;
      for (const kid of kids) {
        const box = boxOf(kid);
        const sections = Array.from(kid.children).filter((el) => {
          if (SKIP_TAGS.has(el.tagName)) return false;
          const b = boxOf(el);
          return b.width >= box.width * 0.65 && b.height >= 80;
        });
        const expand = box.height > 1600 && sections.length >= 4 ? sections : [kid];
        for (const el of expand) {
          const b = boxOf(el);
          const gap = prevBottom === null ? 0 : b.y - prevBottom;
          consider(el, false, Math.max(0, gap));
          prevBottom = b.y + b.height;
        }
      }
    }
    return blocks.slice(0, maxBlocks);
  }

  const visibleText = (el: Element): string => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) {
      return "";
    }
    let t = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) t += node.textContent ?? "";
      else if (node instanceof Element) t += visibleText(node);
    }
    return t.replace(/\s+/g, " ").trim();
  }

  const hashHtml = (selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const text = visibleText(el).slice(0, 400);
    const html = el.innerHTML.replace(/\s+/g, " ").trim().slice(0, 4000);
    let h = 0;
    const payload = `${text}|${html}`;
    for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
    return {
      hash: String(h),
      text,
      box: boxOf(el),
    };
  }

  const dismiss = (): string[] => {
    const clicked: string[] = [];
    const labels = /^(accept|agree|ok|got it|allow|i agree|accept all|accept cookies)$/i;
    const buttons = Array.from(document.querySelectorAll("button, [role='button'], a"));
    for (const el of buttons) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!labels.test(t)) continue;
      if (el instanceof HTMLElement) {
        el.click();
        clicked.push(t);
        if (clicked.length >= 2) break;
      }
    }
    return clicked;
  }

  switch (cmd.op) {
    case "dom":
      return { ...empty, dom: collectDom(cmd.maxNodes) };
    case "seo":
      return { ...empty, seo: collectSeo() };
    case "theme":
      return { ...empty, theme: collectTheme() };
    case "metrics":
      return {
        ...empty,
        metrics: {
          scroll_width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
          scroll_height: Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
          ),
        },
      };
    case "headerCandidate":
      return { ...empty, headerCandidate: findHeader() };
    case "probeHeader":
      return { ...empty, headerProbe: probe(cmd.selector) };
    case "cards":
      return { ...empty, cards: findCards(cmd.limit) };
    case "hoverTargets":
      return { ...empty, hoverTargets: findHoverTargets(cmd.cardLimit, cmd.navLimit) };
    case "hoverSnap":
      return { ...empty, hoverSnap: hoverSnap(cmd.selector) };
    case "blocks":
      return { ...empty, blocks: collectBlocks(cmd.maxBlocks) };
    case "hash":
      return { ...empty, hash: hashHtml(cmd.selector) };
    case "dismiss":
      return { ...empty, dismissed: dismiss() };
  }
};

