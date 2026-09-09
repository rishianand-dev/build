/**
 * Semantic diff description: instead of only knowing *that* a region's
 * pixels differ (image-diff.ts), ask the local vision model *what's*
 * different — a missing section, a component classified as the wrong
 * type, a layout/spacing issue, a color/style issue — the way a human
 * reviewer would describe it. That description is what tells the
 * pixel-match loop which real-DOM identifiers to go learn (see
 * learned-patterns.ts), not just "diff went down."
 *
 * Two SEPARATE single-image calls, not one two-image "compare these"
 * call: measured live against this project's local model (qwen2.5vl:7b
 * via Ollama), a two-image request reliably crashes the runtime at the
 * tensor level (`GGML_ASSERT(a->ne[2] * 4 == b->ne[0]) failed`) — this
 * model/runtime combination's vision encoder doesn't support batching
 * more than one image per call. Classifying each crop independently and
 * comparing the results in code is the same pattern from-vision.ts's
 * `classifyRegion` already uses successfully (one image in, one
 * structured answer out), so this reuses a proven-reliable call shape
 * instead of a new, broken one.
 */
import { readFile } from "node:fs/promises";
import { CANONICAL_ROLES, canonicalRole, type CanonicalRole } from "../schema/roles.js";
import { cropPngToBase64 } from "./image-diff.js";
import { ollamaVisionJson } from "./ollama.js";

export type DiffIssue = "missing_section" | "wrong_type" | "layout" | "style" | "none";

export interface DiffDescription {
  issue: DiffIssue;
  suspectedRole: CanonicalRole | null;
  description: string;
}

interface CropRead {
  role: CanonicalRole | null;
  empty: boolean;
  description: string;
}

const CROP_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string", enum: [...CANONICAL_ROLES, ""] },
    empty: { type: "boolean" },
    description: { type: "string" },
  },
  required: ["role", "empty", "description"],
};

function buildCropPrompt(): string {
  return [
    "You are looking at one cropped region of a web page screenshot.",
    `Classify it into the single closest role from: ${CANONICAL_ROLES.join(", ")}. If genuinely nothing recognizable fits, use an empty string.`,
    'Set "empty" to true only if this crop is blank/near-blank (solid background color, no real content) — not merely simple.',
    "Return strict JSON matching the schema. Keep description under 150 characters and concrete (name what you actually see).",
  ].join("\n");
}

async function readCrop(pngPath: string, yStart: number, yEnd: number, opts: { model?: string; host?: string; timeoutMs?: number }): Promise<CropRead | null> {
  const crop = await cropPngToBase64(pngPath, yStart, yEnd);
  const raw = await ollamaVisionJson<{ role: string; empty: boolean; description: string }>({
    model: opts.model,
    host: opts.host,
    timeoutMs: opts.timeoutMs,
    prompt: buildCropPrompt(),
    imageBase64: crop,
    schema: CROP_SCHEMA,
  });
  if (!raw) return null;
  return {
    role: canonicalRole(raw.role) ?? null,
    empty: Boolean(raw.empty),
    description: String(raw.description ?? "").slice(0, 200),
  };
}

// Near-uniform-color crops (a blank/near-blank band) are a cheap, reliable
// non-LLM signal for "nothing rendered here yet" — checked in code rather
// than trusted purely to the model's self-reported "empty" flag.
async function isNearBlank(pngPath: string, yStart: number, yEnd: number): Promise<boolean> {
  const { PNG } = await import("pngjs");
  try {
    const buf = await readFile(pngPath);
    const png = PNG.sync.read(buf);
    const top = Math.max(0, Math.min(yStart, png.height));
    const bottom = Math.max(top + 1, Math.min(yEnd, png.height));
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = top; y < bottom; y += Math.max(1, Math.floor((bottom - top) / 60))) {
      for (let x = 0; x < png.width; x += Math.max(1, Math.floor(png.width / 60))) {
        const idx = (y * png.width + x) << 2;
        const gray = (png.data[idx]! + png.data[idx + 1]! + png.data[idx + 2]!) / 3;
        sum += gray;
        sumSq += gray * gray;
        n++;
      }
    }
    if (!n) return false;
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return variance < 8; // near-zero variance = solid/near-solid color
  } catch {
    return false;
  }
}

export interface DescribeDiffInput {
  actualPngPath: string;
  generatedPngPath: string;
  yStart: number;
  yEnd: number;
  model?: string;
  host?: string;
  timeoutMs?: number;
}

/** Classifies the real and generated crops independently and compares the
 * results in code. Returns null only if BOTH calls fail (model
 * unreachable) — a single failed call still lets the other side's
 * information through where useful. */
export async function describeDiff(input: DescribeDiffInput): Promise<DiffDescription | null> {
  const opts = { model: input.model, host: input.host, timeoutMs: input.timeoutMs };
  const [actual, generated, generatedBlank] = await Promise.all([
    readCrop(input.actualPngPath, input.yStart, input.yEnd, opts).catch(() => null),
    readCrop(input.generatedPngPath, input.yStart, input.yEnd, opts).catch(() => null),
    isNearBlank(input.generatedPngPath, input.yStart, input.yEnd),
  ]);
  if (!actual && !generated) return null;

  if (generatedBlank || generated?.empty) {
    return {
      issue: "missing_section",
      suspectedRole: actual?.role ?? null,
      description: actual
        ? `Real region looks like a ${actual.role ?? "section"} (${actual.description}); the rendered region is blank.`
        : "The rendered region is blank where the real page has content.",
    };
  }

  if (!actual || !generated) {
    return { issue: "none", suspectedRole: actual?.role ?? generated?.role ?? null, description: "Only one side could be classified — no comparison possible." };
  }

  if (actual.role && actual.role !== generated.role) {
    return {
      issue: "wrong_type",
      suspectedRole: actual.role,
      description: `Real region looks like a ${actual.role} (${actual.description}); rendered as ${generated.role ?? "something else"} (${generated.description}).`,
    };
  }

  // Same apparent role on both sides, yet this band was still flagged as a
  // real pixel mismatch (that's why it's being looked at at all) — most
  // often spacing/sizing rather than a classification problem.
  return {
    issue: "layout",
    suspectedRole: actual.role,
    description: `Both sides read as ${actual.role ?? "the same kind of section"}, but pixels still differ — likely spacing, sizing, or alignment.`,
  };
}
