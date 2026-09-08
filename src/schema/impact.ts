/**
 * Read-side dependency/impact index over an existing ThemeDoc.
 *
 * Not a schema or storage change — this walks the interned dictionaries
 * and the page/component trees already in `ThemeDoc` and builds reverse
 * maps: given a token/style/asset/component id, what paths reference it.
 * Powers "what breaks if I delete this" safe-deletion previews.
 */

import { walkPaths } from "./compact.js";
import { isTokenRef, parseTokenRef, type Node, type ThemeDoc, type TokenGroup } from "./theme.js";

export interface ImpactIndex {
  /** `$group.key` -> style ids that reference the token. */
  tokenToStyles: Map<string, Set<string>>;
  /** style id -> paths (pages/components) of nodes using it. */
  styleToPaths: Map<string, Set<string>>;
  /** asset id -> paths of image nodes using it. */
  assetToPaths: Map<string, Set<string>>;
  /** component id -> paths of instance/list nodes using it. */
  componentToPaths: Map<string, Set<string>>;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

export function buildImpactIndex(theme: ThemeDoc): ImpactIndex {
  const index: ImpactIndex = {
    tokenToStyles: new Map(),
    styleToPaths: new Map(),
    assetToPaths: new Map(),
    componentToPaths: new Map(),
  };

  for (const [styleId, style] of Object.entries(theme.styles)) {
    for (const value of Object.values(style)) {
      if (typeof value === "string" && isTokenRef(value)) {
        addTo(index.tokenToStyles, value, styleId);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string" && isTokenRef(v)) addTo(index.tokenToStyles, v, styleId);
        }
      }
    }
  }

  const visit = (node: Node, path: string) => {
    if (node.style) addTo(index.styleToPaths, node.style, path);
    if (node.type === "image" && node.asset) addTo(index.assetToPaths, node.asset, path);
    if (node.type === "instance" || node.type === "list") {
      addTo(index.componentToPaths, node.of, path);
    }
  };

  for (const [id, component] of Object.entries(theme.components)) {
    walkPaths(component.root, `/components/${id}/root`, visit);
  }
  theme.pages.forEach((page, i) => {
    walkPaths(page.root, `/pages/${i}/root`, visit);
  });

  return index;
}

export interface Usage {
  count: number;
  paths: string[];
}

function usageOf(map: Map<string, Set<string>>, id: string): Usage {
  const set = map.get(id);
  return { count: set?.size ?? 0, paths: set ? [...set] : [] };
}

export function whatUsesToken(index: ImpactIndex, ref: string): Usage {
  return usageOf(index.tokenToStyles, ref);
}

export function whatUsesStyle(index: ImpactIndex, styleId: string): Usage {
  return usageOf(index.styleToPaths, styleId);
}

export function whatUsesAsset(index: ImpactIndex, assetId: string): Usage {
  return usageOf(index.assetToPaths, assetId);
}

export function whatUsesComponent(index: ImpactIndex, componentId: string): Usage {
  return usageOf(index.componentToPaths, componentId);
}

/** Parse a token ref (`$color.brand`) into its group, for callers building a UI label. */
export function tokenGroupOf(ref: string): TokenGroup | undefined {
  return parseTokenRef(ref)?.group;
}
