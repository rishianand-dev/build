import {
  emptyTheme,
  isTokenRef,
  parseTokenRef,
  type BindMap,
  type Component,
  type Node,
  type Style,
  type ThemeDoc,
  type TokenGroup,
  type Tokens,
} from "./theme.js";

const TOKEN_GROUPS: TokenGroup[] = [
  "color",
  "font",
  "size",
  "weight",
  "space",
  "radius",
  "shadow",
];

/**
 * Keys whose value must stay a `{}` rather than being dropped when empty,
 * even though prune()'s general job is stripping empty objects to save
 * bytes. These are ThemeDoc's non-optional top-level dictionaries (plus
 * `tokens`' own subgroups) — code throughout the codebase (render-html.ts,
 * rehost-assets.ts, impact.ts, ...) reads `theme.assets[id]` /
 * `theme.tokens.color.bg` / etc. assuming the type's guarantee that these
 * are always present objects, never `undefined`. A builder that happens
 * to intern zero of something (e.g. a Figma import with no explicit font)
 * must not silently break that guarantee for everyone downstream.
 */
const ALWAYS_KEEP_EMPTY = new Set<string>(["site", "tokens", "styles", "assets", "components", ...TOKEN_GROUPS]);

/** Same reasoning as ALWAYS_KEEP_EMPTY above, for ThemeDoc's non-optional array fields
 * (`pages`/`children` were already exempted; `review` is equally non-optional — code
 * like `theme.review.push(...)` must not find it missing just because it's empty). */
const ALWAYS_KEEP_EMPTY_ARRAY = new Set<string>(["pages", "children", "review"]);

export function prune(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(prune).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = prune(item);
      if (next === undefined) continue;
      if (
        typeof next === "object" &&
        !Array.isArray(next) &&
        next !== null &&
        Object.keys(next).length === 0 &&
        !ALWAYS_KEEP_EMPTY.has(key)
      ) {
        continue;
      }
      if (Array.isArray(next) && next.length === 0 && !ALWAYS_KEEP_EMPTY_ARRAY.has(key)) {
        continue;
      }
      out[key] = next;
    }
    return out;
  }
  return value;
}

export function stringifyTheme(theme: ThemeDoc, pretty = false): string {
  const body = pretty ? JSON.stringify(prune(theme), null, 2) : JSON.stringify(prune(theme));
  return pretty ? `${body}\n` : (body ?? "");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

class Ids {
  constructor(
    private prefix: string,
    private n = 1,
  ) {}
  next(): string {
    return `${this.prefix}${this.n++}`;
  }
}

export function internToken(
  tokens: Tokens,
  group: TokenGroup,
  value: string,
  hint?: string,
): string {
  const bag = tokens[group];
  // A caller naming a hint wants that exact semantic slot (e.g. "card",
  // "heading") to exist under that key — even when its value happens to
  // match an already-interned, differently-named token (e.g. "card" ===
  // "bg" on a monochrome site). Callers elsewhere hardcode "$group.hint"
  // string literals expecting the key to be there; silently aliasing it
  // to a different key left those literals dangling and unresolved.
  if (hint !== undefined) {
    if (bag[hint] === value) return `$${group}.${hint}`;
    if (bag[hint] === undefined) {
      bag[hint] = value;
      return `$${group}.${hint}`;
    }
    // hint already holds a different value — fall through to reuse-by-value/auto-generate.
  }
  for (const [key, existing] of Object.entries(bag)) {
    if (existing === value) return `$${group}.${key}`;
  }
  let i = Object.keys(bag).length + 1;
  let key = `${group[0]}${i++}`;
  while (bag[key]) key = `${group[0]}${i++}`;
  bag[key] = value;
  return `$${group}.${key}`;
}

export function internStyle(styles: Record<string, Style>, style: Style): string {
  const compact = prune(style) as Style;
  const needle = canonical(compact);
  for (const [id, existing] of Object.entries(styles)) {
    if (canonical(existing) === needle) return id;
  }
  const ids = new Ids("s", Object.keys(styles).length + 1);
  let id = ids.next();
  while (styles[id]) id = ids.next();
  styles[id] = compact;
  return id;
}

export function internAsset(
  assets: ThemeDoc["assets"],
  url: string,
  extra: Omit<ThemeDoc["assets"][string], "url"> = {},
): string {
  for (const [id, asset] of Object.entries(assets)) {
    if (asset.url === url) return id;
  }
  const id = `a${Object.keys(assets).length + 1}`;
  assets[id] = prune({ url, ...extra }) as ThemeDoc["assets"][string];
  return id;
}

function walkNodes(node: Node, visit: (n: Node) => void): void {
  visit(node);
  if ("children" in node && node.children) {
    for (const child of node.children) walkNodes(child, visit);
  }
}

/**
 * Walk a node tree, visiting each node with its JSON pointer from the
 * document root. `base` is the pointer to `root` itself, e.g.
 * `/pages/0/root` or `/components/c1/root`.
 */
export function walkPaths(root: Node, base: string, visit: (n: Node, path: string) => void): void {
  const go = (node: Node, path: string) => {
    visit(node, path);
    if ("children" in node && node.children) {
      node.children.forEach((child, i) => go(child, `${path}/children/${i}`));
    }
  };
  go(root, base);
}

/**
 * Inverse of `walkPaths`: resolves a JSON pointer produced by it (or
 * `ReviewItem.path`) back to the live node it names, so a caller can read
 * or mutate it in place. Only understands pointers of the shape
 * `/pages/<i>/root(/children/<i>)*` or `/components/<id>/root(/children/<i>)*`
 * — anything else (including the coarser page-level pointers some
 * ReviewItems still use, e.g. `/pages/0`) returns undefined.
 */
export function resolveNodeAtPath(theme: ThemeDoc, path: string): Node | undefined {
  const segs = path.split("/").filter(Boolean);
  let cursor: Node | undefined;
  if (segs[0] === "pages" && segs[2] === "root") {
    cursor = theme.pages[Number(segs[1])]?.root;
    segs.splice(0, 3);
  } else if (segs[0] === "components" && segs[2] === "root") {
    cursor = theme.components[segs[1]!]?.root;
    segs.splice(0, 3);
  } else {
    return undefined;
  }
  for (let i = 0; i < segs.length; i += 2) {
    if (segs[i] !== "children" || !cursor || !("children" in cursor)) return undefined;
    cursor = cursor.children[Number(segs[i + 1])];
  }
  return cursor;
}

/**
 * Removes the node at `path` from its parent's `children` array. Only
 * works on a path that ends in `/children/<i>` (i.e. the node has a
 * parent to remove it from) — a page or component root itself can't be
 * deleted this way. Returns false without mutating anything if the path
 * doesn't resolve.
 */
export function deleteNodeAtPath(theme: ThemeDoc, path: string): boolean {
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2 || segs[segs.length - 2] !== "children") return false;
  const index = Number(segs[segs.length - 1]);
  const parentPath = `/${segs.slice(0, -2).join("/")}`;
  const parent = resolveNodeAtPath(theme, parentPath);
  if (!parent || !("children" in parent) || index < 0 || index >= parent.children.length) return false;
  parent.children.splice(index, 1);
  return true;
}

function nodeWeight(node: Node): number {
  let n = 1;
  if ("children" in node) n += node.children.reduce((sum, c) => sum + nodeWeight(c), 0);
  return n;
}

/** Fingerprint ignores instance-specific content so repeated cards hash equal. */
export function fingerprint(node: Node): string {
  const style = node.style ?? "";
  switch (node.type) {
    case "stack":
    case "row":
    case "grid":
    case "layer":
      return `${node.type}|${style}|${node.children.map(fingerprint).join(",")}`;
    case "text":
      return `text|${style}|${node.tag ?? ""}|${node.bind ? "b" : "t"}`;
    case "image":
      return `img|${style}`;
    case "link":
      return `link|${style}|${node.children.map(fingerprint).join(",")}`;
    case "button":
      return `btn|${style}`;
    case "icon":
      return `icon|${style}|${node.name}`;
    case "input":
      return `input|${style}|${node.input}`;
    case "spacer":
      return `sp|${style}|${node.size ?? ""}`;
    case "instance":
      return `inst|${node.of}`;
    case "list":
      return `list|${style}|${node.of}`;
  }
}

function collectBinds(node: Node, bind: BindMap, counters: Record<string, number>): Node {
  const key = (kind: string) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${kind}${counters[kind]}`;
  };

  if (node.type === "text" && node.text !== undefined && !node.bind) {
    const k = key("t");
    bind[k] = node.text;
    const { text: _omit, ...rest } = node;
    return { ...rest, bind: k };
  }
  if (node.type === "image" && node.asset && !node.bind) {
    const k = key("img");
    bind[k] = node.asset;
    const { asset: _omit, ...rest } = node;
    return { ...rest, bind: k };
  }
  if (node.type === "link" && node.href && !node.bind) {
    const k = key("href");
    bind[k] = node.href;
    return {
      ...node,
      href: undefined,
      bind: k,
      children: node.children.map((c) => collectBinds(c, bind, counters)),
    };
  }
  if (node.type === "button" && node.text && !node.bind) {
    const k = key("t");
    bind[k] = node.text;
    const { text: _omit, ...rest } = node;
    return { ...rest, bind: k };
  }
  if ("children" in node) {
    return {
      ...node,
      children: node.children.map((c) => collectBinds(c, bind, counters)),
    };
  }
  return node;
}

export interface PromoteOptions {
  minCount?: number;
  minWeight?: number;
}

/**
 * Lift repeated subtrees into `components` and replace copies with instances.
 * This is the main size win for galleries, nav links, and cards.
 */
export function promoteRepeats(theme: ThemeDoc, options: PromoteOptions = {}): ThemeDoc {
  const minCount = options.minCount ?? 2;
  const minWeight = options.minWeight ?? 3;
  const counts = new Map<string, number>();

  for (const page of theme.pages) {
    walkNodes(page.root, (node) => {
      if (node.type === "instance" || node.type === "list") return;
      if (nodeWeight(node) < minWeight) return;
      const fp = fingerprint(node);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    });
  }
  for (const comp of Object.values(theme.components)) {
    walkNodes(comp.root, (node) => {
      if (node.type === "instance" || node.type === "list") return;
      if (nodeWeight(node) < minWeight) return;
      const fp = fingerprint(node);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    });
  }

  const promoted = new Map<string, string>();
  let compN = Object.keys(theme.components).length + 1;

  const replace = (node: Node): Node => {
    const fp = fingerprint(node);
    const eligible =
      node.type !== "instance" &&
      node.type !== "list" &&
      nodeWeight(node) >= minWeight &&
      (counts.get(fp) ?? 0) >= minCount;

    if (eligible) {
      let id = promoted.get(fp);
      if (!id) {
        id = `c${compN++}`;
        while (theme.components[id]) id = `c${compN++}`;
        const bind: BindMap = {};
        const root = collectBinds(structuredClone(node), bind, {});
        theme.components[id] = {
          binds: Object.keys(bind),
          root,
        };
        promoted.set(fp, id);
      }
      const bind: BindMap = {};
      collectBinds(structuredClone(node), bind, {});
      return prune({ type: "instance", of: id, bind, style: node.style, role: node.role }) as Node;
    }

    if ("children" in node) {
      return { ...node, children: node.children.map(replace) };
    }
    return node;
  };

  return {
    ...theme,
    pages: theme.pages.map((page) => ({ ...page, root: replace(page.root) })),
    components: theme.components,
  };
}

/** Turn a list of instance-shaped children into one `list` node when they share a component. */
export function collapseInstanceLists(theme: ThemeDoc): ThemeDoc {
  const collapse = (node: Node): Node => {
    if ("children" in node) {
      const children = node.children.map(collapse);
      const first = children[0];
      if (
        children.length >= 3 &&
        first?.type === "instance" &&
        children.every((c) => c.type === "instance" && c.of === first.of)
      ) {
        return prune({
          type: "list",
          of: first.of,
          style: node.style,
          role: node.role ?? "list",
          items: children.map((c) => (c.type === "instance" ? (c.bind ?? {}) : {})),
        }) as Node;
      }
      return { ...node, children };
    }
    return node;
  };

  return {
    ...theme,
    pages: theme.pages.map((page) => ({ ...page, root: collapse(page.root) })),
    components: Object.fromEntries(
      Object.entries(theme.components).map(([id, c]) => [id, { ...c, root: collapse(c.root) }]),
    ),
  };
}

export function compactTheme(theme: ThemeDoc): ThemeDoc {
  const next = collapseInstanceLists(promoteRepeats(theme));
  return prune(next) as ThemeDoc;
}

export function resolveToken(tokens: Tokens, ref: string): string | undefined {
  const parsed = parseTokenRef(ref);
  if (!parsed) return ref;
  return tokens[parsed.group]?.[parsed.key];
}

export function validateTheme(theme: ThemeDoc): string[] {
  const errors: string[] = [];
  if (theme.schema !== "honebi.theme/1") {
    errors.push(`unknown schema ${theme.schema}`);
  }
  for (const [id, style] of Object.entries(theme.styles)) {
    for (const value of Object.values(style)) {
      if (typeof value === "string" && isTokenRef(value)) {
        const parsed = parseTokenRef(value);
        if (!parsed || !(parsed.group in theme.tokens) || !TOKEN_GROUPS.includes(parsed.group)) {
          errors.push(`style ${id} bad token ${value}`);
        } else if (theme.tokens[parsed.group][parsed.key] === undefined) {
          errors.push(`style ${id} missing token ${value}`);
        }
      }
    }
  }

  const checkNode = (node: Node, where: string) => {
    if (node.style && !theme.styles[node.style]) {
      errors.push(`${where} missing style ${node.style}`);
    }
    if (node.type === "image" && node.asset && !theme.assets[node.asset]) {
      errors.push(`${where} missing asset ${node.asset}`);
    }
    if (node.type === "instance" && !theme.components[node.of]) {
      errors.push(`${where} missing component ${node.of}`);
    }
    if (node.type === "list" && !theme.components[node.of]) {
      errors.push(`${where} missing list component ${node.of}`);
    }
    if ("children" in node) {
      node.children.forEach((c, i) => checkNode(c, `${where}/children/${i}`));
    }
  };

  for (const [id, comp] of Object.entries(theme.components)) {
    checkNode(comp.root, `/components/${id}`);
  }
  theme.pages.forEach((page, i) => checkNode(page.root, `/pages/${i}`));
  return errors;
}

export function createDraftTheme(input: {
  name?: string;
  source?: string;
  tokens?: Tokens;
  styles?: Record<string, Style>;
  assets?: ThemeDoc["assets"];
  components?: Record<string, Component>;
  pages?: ThemeDoc["pages"];
}): ThemeDoc {
  return compactTheme(
    emptyTheme({
      site: { name: input.name, source: input.source },
      tokens: input.tokens ?? emptyTheme().tokens,
      styles: input.styles ?? {},
      assets: input.assets ?? {},
      components: input.components ?? {},
      pages: input.pages ?? [],
    }),
  );
}
