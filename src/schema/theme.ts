/**
 * Compact, design-agnostic theme document.
 *
 * Not the honebi-ecommerce page JSON. That schema repeats CSS bags,
 * section_areas, and product-card trees on every page.
 *
 * Size rules:
 * - Tokens are the only place raw colors/fonts/spacing live.
 * - Styles are interned; nodes reference them by id (`s1`).
 * - Repeated subtrees become components; pages use `{ type: "instance", of, bind }`.
 * - Review notes are a sparse list, not a wrapper on every field.
 */

export const THEME_SCHEMA = "honebi.theme/1" as const;

export type TokenRef = `$${string}`;

export interface Tokens {
  color: Record<string, string>;
  font: Record<string, string>;
  size: Record<string, string>;
  weight: Record<string, string>;
  space: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
}

export type TokenGroup = keyof Tokens;

/** Shorthand padding/margin: one token, [y, x], or [t, r, b, l]. */
export type BoxEdges = string | [string, string] | [string, string, string, string];

export interface Style {
  color?: string;
  bg?: string;
  font?: string;
  size?: string;
  weight?: string;
  leading?: string;
  pad?: BoxEdges;
  m?: BoxEdges;
  gap?: string;
  radius?: string;
  shadow?: string;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  width?: string;
  maxW?: string;
  height?: string;
  pos?: "relative" | "sticky" | "fixed" | "absolute";
  top?: string;
  z?: number;
  cols?: number;
  opacity?: number;
  textAlign?: "left" | "center" | "right";
  border?: string;
  decoration?: "none" | "underline" | "line-through";
}

export interface Asset {
  url: string;
  kind?: "image" | "font" | "icon" | "video";
  alt?: string;
  w?: number;
  h?: number;
}

/** Optional semantics for a11y / classification. Open set, not a builder enum. */
export type Role =
  | "header"
  | "nav"
  | "main"
  | "footer"
  | "hero"
  | "card"
  | "list"
  | "form"
  | "aside"
  | "banner"
  | (string & {});

export type BindMap = Record<string, string | number | boolean | null>;

interface NodeBase {
  /** Shared look. Never inline a second copy of the same style object. */
  style?: string;
  role?: Role;
}

export type Node =
  | StackNode
  | TextNode
  | ImageNode
  | LinkNode
  | ButtonNode
  | IconNode
  | InputNode
  | SpacerNode
  | InstanceNode
  | ListNode;

export interface StackNode extends NodeBase {
  type: "stack" | "row" | "grid" | "layer";
  children: Node[];
}

export interface TextNode extends NodeBase {
  type: "text";
  text?: string;
  bind?: string;
  tag?: "p" | "h1" | "h2" | "h3" | "h4" | "span" | "label";
}

export interface ImageNode extends NodeBase {
  type: "image";
  asset?: string;
  bind?: string;
  alt?: string;
}

export interface LinkNode extends NodeBase {
  type: "link";
  href?: string;
  bind?: string;
  children: Node[];
}

export interface ButtonNode extends NodeBase {
  type: "button";
  text?: string;
  href?: string;
  bind?: string;
  action?: string;
}

export interface IconNode extends NodeBase {
  type: "icon";
  name: string;
}

export interface InputNode extends NodeBase {
  type: "input";
  input: "text" | "search" | "email" | "password";
  placeholder?: string;
}

export interface SpacerNode extends NodeBase {
  type: "spacer";
  size?: string;
}

export interface InstanceNode extends NodeBase {
  type: "instance";
  of: string;
  bind?: BindMap;
}

export interface ListNode extends NodeBase {
  type: "list";
  of: string;
  items: BindMap[];
}

export interface Component {
  /** Bind keys this template reads (`title`, `image`, …). */
  binds?: string[];
  root: Node;
}

export interface Page {
  id: string;
  name?: string;
  path: string;
  title?: string;
  root: Node;
}

export interface ReviewItem {
  /** JSON pointer from the document root, e.g. `/pages/0/root/children/2`. */
  path: string;
  reason: string;
  confidence?: number;
}

export interface ThemeDoc {
  schema: typeof THEME_SCHEMA;
  site: {
    name?: string;
    source?: string;
  };
  version: {
    id: string;
    status: "draft" | "published";
    parent?: string;
    at: string;
  };
  tokens: Tokens;
  styles: Record<string, Style>;
  assets: Record<string, Asset>;
  components: Record<string, Component>;
  pages: Page[];
  review: ReviewItem[];
}

export function emptyTokens(): Tokens {
  return { color: {}, font: {}, size: {}, weight: {}, space: {}, radius: {}, shadow: {} };
}

export function emptyTheme(partial?: Partial<ThemeDoc>): ThemeDoc {
  const { schema: _schema, ...rest } = partial ?? {};
  return {
    schema: THEME_SCHEMA,
    site: {},
    version: {
      id: "v1",
      status: "draft",
      at: new Date().toISOString(),
    },
    tokens: emptyTokens(),
    styles: {},
    assets: {},
    components: {},
    pages: [],
    review: [],
    ...rest,
  };
}

export function isTokenRef(value: string | undefined): value is TokenRef {
  return Boolean(value && value.startsWith("$") && value.includes("."));
}

export function parseTokenRef(
  ref: string,
): { group: TokenGroup; key: string } | null {
  if (!isTokenRef(ref)) return null;
  const body = ref.slice(1);
  const dot = body.indexOf(".");
  if (dot <= 0) return null;
  const group = body.slice(0, dot) as TokenGroup;
  const key = body.slice(dot + 1);
  if (!key) return null;
  return { group, key };
}
