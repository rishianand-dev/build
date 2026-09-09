/**
 * Splices a Node subtree built against one ThemeDoc's dictionaries (a
 * scratch "mini" theme, freshly built from an isolated real DOM section)
 * into another ThemeDoc (the "main" theme being iteratively repaired).
 *
 * Style/asset/token ids are per-theme sequential counters (`s1`, `a1`, ...),
 * so copying a node's `style`/`asset` string across themes verbatim would
 * silently point at the wrong (or a nonexistent) entry. This walks the
 * subtree and re-interns every reference through the main theme's own
 * intern functions, which already dedupe structurally-identical
 * styles/assets/components rather than piling up near-duplicates.
 */
import { internAsset, internStyle, internToken, prune } from "../schema/compact.js";
import {
  isTokenRef,
  parseTokenRef,
  type BoxEdges,
  type Component,
  type Node,
  type Style,
  type ThemeDoc,
} from "../schema/theme.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function remapTokenRef(main: ThemeDoc, mini: ThemeDoc, ref: string): string {
  const parsed = parseTokenRef(ref);
  if (!parsed) return ref;
  const value = mini.tokens[parsed.group][parsed.key];
  if (value === undefined) return ref;
  return internToken(main.tokens, parsed.group, value, parsed.key);
}

function remapEdges(main: ThemeDoc, mini: ThemeDoc, edges: BoxEdges): BoxEdges {
  if (typeof edges === "string") return isTokenRef(edges) ? remapTokenRef(main, mini, edges) : edges;
  return edges.map((v) => (isTokenRef(v) ? remapTokenRef(main, mini, v) : v)) as BoxEdges;
}

function remapStyleId(main: ThemeDoc, mini: ThemeDoc, miniStyleId: string): string {
  const style = mini.styles[miniStyleId];
  if (!style) return miniStyleId;
  const remapped: Style = { ...style };
  for (const key of Object.keys(remapped) as Array<keyof Style>) {
    const value = remapped[key];
    if (typeof value === "string" && isTokenRef(value)) {
      (remapped as Record<string, unknown>)[key] = remapTokenRef(main, mini, value);
    } else if (key === "pad" || key === "m") {
      (remapped as Record<string, unknown>)[key] = remapEdges(main, mini, value as BoxEdges);
    }
  }
  return internStyle(main.styles, remapped);
}

function remapAssetId(main: ThemeDoc, mini: ThemeDoc, miniAssetId: string): string {
  const asset = mini.assets[miniAssetId];
  if (!asset) return miniAssetId;
  return internAsset(main.assets, asset.url, { kind: asset.kind, alt: asset.alt, w: asset.w, h: asset.h });
}

function remapComponentId(main: ThemeDoc, mini: ThemeDoc, miniCompId: string): string {
  const comp = mini.components[miniCompId];
  if (!comp) return miniCompId;
  const remappedComp: Component = { ...comp, root: remapNode(main, mini, structuredClone(comp.root)) };
  const needle = canonical(prune(remappedComp));
  for (const [id, existing] of Object.entries(main.components)) {
    if (canonical(prune(existing)) === needle) return id;
  }
  let id = miniCompId;
  let i = 2;
  while (main.components[id]) id = `${miniCompId}${i++}`;
  main.components[id] = remappedComp;
  return id;
}

/** Remaps every style/asset/component reference in `node` (mutated in place,
 * and returned) from `mini`'s dictionaries onto `main`'s. Recurses through
 * children and, for instance/list nodes, through the referenced component. */
export function remapNode(main: ThemeDoc, mini: ThemeDoc, node: Node): Node {
  if (node.style) node.style = remapStyleId(main, mini, node.style);
  switch (node.type) {
    case "image":
      if (node.asset) node.asset = remapAssetId(main, mini, node.asset);
      break;
    case "instance":
    case "list":
      node.of = remapComponentId(main, mini, node.of);
      break;
    default:
      break;
  }
  if ("children" in node) node.children = node.children.map((c) => remapNode(main, mini, c));
  return node;
}

/**
 * Public entry point: deep-clones `node` (so the mini theme's own tree is
 * left untouched) and remaps it onto `main`'s dictionaries, ready to splice
 * into `main` at some path.
 */
export function mergeSubtreeIntoTheme(main: ThemeDoc, mini: ThemeDoc, node: Node): Node {
  return remapNode(main, mini, structuredClone(node));
}

/**
 * Replaces the node at `path` (a `walkPaths`/`resolveNodeAtPath`-style JSON
 * pointer, e.g. `/pages/0/root/children/2`) with `replacement`. Unlike
 * `deleteNodeAtPath`, this can also replace a page/component root itself
 * (a path with no `/children/<i>` suffix) since there's always something
 * to put there. Returns false if the path doesn't resolve to a real parent.
 */
export function replaceNodeAtPath(theme: ThemeDoc, path: string, replacement: Node): boolean {
  const segs = path.split("/").filter(Boolean);
  if (segs[0] === "pages" && segs[2] === "root" && segs.length === 3) {
    const page = theme.pages[Number(segs[1])];
    if (!page) return false;
    page.root = replacement;
    return true;
  }
  if (segs[0] === "components" && segs[2] === "root" && segs.length === 3) {
    const comp = theme.components[segs[1]!];
    if (!comp) return false;
    comp.root = replacement;
    return true;
  }
  if (segs.length < 2 || segs[segs.length - 2] !== "children") return false;
  const index = Number(segs[segs.length - 1]);
  const parentPath = `/${segs.slice(0, -2).join("/")}`;
  const parent = resolveParent(theme, parentPath);
  if (!parent || !("children" in parent) || index < 0 || index >= parent.children.length) return false;
  parent.children[index] = replacement;
  return true;
}

/**
 * Inserts `node` as a new child of the node at `parentPath` (e.g.
 * `/pages/0/root`) at `index`, clamped into range. Used for the "the real
 * section has no counterpart in the render at all yet" case — there's
 * nothing to replace, so a child needs to be added, not swapped in.
 */
export function insertChildAtPath(theme: ThemeDoc, parentPath: string, index: number, node: Node): boolean {
  const parent = resolveParent(theme, parentPath);
  if (!parent || !("children" in parent)) return false;
  const at = Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, node);
  return true;
}

function resolveParent(theme: ThemeDoc, path: string): Node | undefined {
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
