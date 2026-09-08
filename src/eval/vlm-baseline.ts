/**
 * Zero-shot local-VLM baseline for the golden-set harness (workstream 6
 * step 1: measure this alongside the DOM-heuristic baseline before
 * training anything). Prompts the same local Ollama model the vision
 * fallback path uses (see from-vision.ts) with a full-page screenshot and
 * asks it to enumerate, top to bottom, which section-level roles the page
 * contains — no fine-tuning, few-shot examples pulled from the golden set
 * itself (excluding the site under test, to avoid leakage).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ollamaVisionJson } from "../build/ollama.js";
import { SECTION_ROLES, type GoldenCase } from "./golden-set.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sections: { type: "array", items: { type: "string", enum: [...SECTION_ROLES] } },
  },
  required: ["sections"],
};

function fewShotExamples(cases: GoldenCase[], excludeSite: string, limit = 4): string {
  return cases
    .filter((c) => c.site !== excludeSite && c.expected.length)
    .slice(0, limit)
    .map((c) => `- ${c.site}: [${c.expected.map((e) => e.role).join(", ")}]`)
    .join("\n");
}

function buildPrompt(goldenCase: GoldenCase, allCases: GoldenCase[]): string {
  const examples = fewShotExamples(allCases, goldenCase.site);
  return (
    `This is a full-page screenshot of an e-commerce website's homepage. List, top to bottom, ` +
    `which of these section types appear on the page: ${SECTION_ROLES.join(", ")}.\n` +
    `Only use roles from that list — skip a section entirely rather than inventing a new label. ` +
    `A page can have zero or more of any role (e.g. multiple "carousel" sections).\n` +
    (examples ? `\nExamples from other sites, for calibration only (don't copy these, judge this page on its own):\n${examples}\n` : "") +
    `\nReturn strict JSON matching the schema: {"sections": ["role1", "role2", ...]}.`
  );
}

/** Resolves this case's screenshot to bytes and asks the local VLM to enumerate section roles. Returns [] (not a throw) if the model or screenshot is unavailable — a missing baseline data point, not a crash. */
export async function nameSectionsWithVlm(
  goldenCase: GoldenCase,
  allCases: GoldenCase[],
  options?: { model?: string; host?: string },
): Promise<string[]> {
  const rel = goldenCase.capture.screenshots.full_page || goldenCase.capture.screenshots.viewport_top;
  if (!goldenCase.dir || !rel) return [];
  let imageBase64: string;
  try {
    imageBase64 = (await readFile(join(goldenCase.dir, rel))).toString("base64");
  } catch {
    return [];
  }

  const raw = await ollamaVisionJson<{ sections: string[] }>({
    model: options?.model,
    host: options?.host,
    prompt: buildPrompt(goldenCase, allCases),
    imageBase64,
    schema: RESPONSE_SCHEMA,
  });
  if (!raw?.sections) return [];
  const valid = new Set<string>(SECTION_ROLES);
  return raw.sections.filter((s) => valid.has(s));
}
