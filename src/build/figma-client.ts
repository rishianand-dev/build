/**
 * Thin client for the parts of the Figma REST API the import path needs.
 * No SDK — like ollama.ts, the surface we use is small enough that a raw
 * `fetch` beats a dependency. https://www.figma.com/developers/api
 */

const API_BASE = "https://api.figma.com/v1";

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  imageRef?: string;
}

export interface FigmaTextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  textAlignHorizontal?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  cornerRadius?: number;
  opacity?: number;
  characters?: string;
  style?: FigmaTextStyle;
  componentId?: string;
  mainComponent?: { id: string };
}

export interface FigmaFileNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

export interface FigmaImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { "X-Figma-Token": token } });
  } catch (err) {
    throw new FigmaApiError(`Figma API request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new FigmaApiError(`Figma API returned ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

/** Fetches one node subtree (a frame/component) by id, not the whole file. */
export async function getFigmaNode(fileKey: string, nodeId: string, token: string): Promise<FigmaNode> {
  const data = await figmaGet<FigmaFileNodesResponse>(
    `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
    token,
  );
  const entry = data.nodes[nodeId] ?? data.nodes[nodeId.replace(/-/g, ":")];
  if (!entry) throw new FigmaApiError(`Node ${nodeId} not found in file ${fileKey}`);
  return entry.document;
}

/** Fill-image download URLs, keyed by the `imageRef` used in a paint's `imageRef`. */
export async function getFigmaImageFills(fileKey: string, token: string): Promise<Record<string, string>> {
  const data = await figmaGet<{ meta: { images: Record<string, string> } }>(
    `/files/${encodeURIComponent(fileKey)}/images`,
    token,
  );
  return data.meta.images;
}

/** Renders whole nodes to an image (PNG by default) — used as the screenshot substitute for a Figma-sourced page. */
export async function renderFigmaNodes(
  fileKey: string,
  nodeIds: string[],
  token: string,
  format: "png" | "svg" = "png",
): Promise<Record<string, string | null>> {
  const data = await figmaGet<FigmaImagesResponse>(
    `/images/${encodeURIComponent(fileKey)}?ids=${nodeIds.map(encodeURIComponent).join(",")}&format=${format}`,
    token,
  );
  if (data.err) throw new FigmaApiError(`Figma image render failed: ${data.err}`);
  return data.images;
}
