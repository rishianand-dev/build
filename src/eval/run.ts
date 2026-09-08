#!/usr/bin/env node
/**
 * CLI for the golden-set harness: `npm run eval:golden [-- --update-baseline] [-- --vlm]`.
 *
 * Loads every `data/golden-set/<slug>/{capture.json, expected.json}` pair,
 * scores the current DOM-heuristic classifier (`themeFromCapture`)
 * against it, and — per the plan's "local script only, no CI" decision —
 * fails with a non-zero exit if any role's F1 regresses against the
 * checked-in `data/golden-set/baseline-scores.json`. `--update-baseline`
 * writes the current run as the new baseline instead of gating on it
 * (use after a deliberate, reviewed change). `--vlm` additionally runs
 * the zero-shot local-VLM baseline (workstream 6 step 1) — slow (one
 * Ollama call per site) and off by default.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { themeFromCapture } from "../build/from-capture.js";
import { evaluate, evaluateRoleSequences, type EvalReport, type GoldenCase } from "./golden-set.js";
import { nameSectionsWithVlm } from "./vlm-baseline.js";
import type { PageCapture } from "../types/page-capture.js";

const GOLDEN_ROOT = resolve(process.cwd(), "data/golden-set");
const BASELINE_PATH = join(GOLDEN_ROOT, "baseline-scores.json");

async function loadCases(): Promise<GoldenCase[]> {
  const entries = await readdir(GOLDEN_ROOT, { withFileTypes: true }).catch(() => []);
  const cases: GoldenCase[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(GOLDEN_ROOT, entry.name);
    try {
      const [captureRaw, expectedRaw] = await Promise.all([
        readFile(join(dir, "capture.json"), "utf8"),
        readFile(join(dir, "expected.json"), "utf8"),
      ]);
      cases.push({
        site: entry.name,
        capture: JSON.parse(captureRaw) as PageCapture,
        expected: JSON.parse(expectedRaw) as GoldenCase["expected"],
        dir,
      });
    } catch {
      // no expected.json (or no capture.json) yet — not part of the labeled corpus
    }
  }
  return cases;
}

function printReport(label: string, report: EvalReport): void {
  console.log(`\n=== ${label} (${report.sites} sites) ===`);
  console.log(`overall F1 (macro): ${report.overallF1.toFixed(3)}`);
  const roles = Object.keys(report.perRole).sort();
  for (const role of roles) {
    const s = report.perRole[role]!;
    console.log(
      `  ${role.padEnd(12)} P=${s.precision.toFixed(2)} R=${s.recall.toFixed(2)} F1=${s.f1.toFixed(2)}  (tp=${s.tp} fp=${s.fp} fn=${s.fn})`,
    );
  }
  console.log("  confusion (expected -> found):");
  for (const [expected, row] of Object.entries(report.confusion)) {
    const parts = Object.entries(row)
      .map(([found, n]) => `${found}:${n}`)
      .join(", ");
    console.log(`    ${expected} -> ${parts}`);
  }
}

async function loadBaseline(): Promise<Record<string, number> | null> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, "utf8")) as Record<string, number>;
  } catch {
    return null;
  }
}

function scoresByRole(report: EvalReport): Record<string, number> {
  return Object.fromEntries(Object.entries(report.perRole).map(([role, s]) => [role, s.f1]));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const withVlm = args.includes("--vlm");

  const cases = await loadCases();
  if (!cases.length) {
    console.error(`No labeled golden-set cases found under ${GOLDEN_ROOT} (each needs capture.json + expected.json).`);
    process.exit(1);
  }

  const heuristicReport = evaluate(themeFromCapture, cases);
  printReport("DOM-heuristic (from-capture.ts)", heuristicReport);

  if (withVlm) {
    const vlmReport = await evaluateRoleSequences((c) => nameSectionsWithVlm(c, cases), cases);
    printReport("Zero-shot local VLM (Ollama)", vlmReport);
  }

  if (updateBaseline) {
    await writeFile(BASELINE_PATH, JSON.stringify(scoresByRole(heuristicReport), null, 2) + "\n", "utf8");
    console.log(`\nWrote baseline to ${BASELINE_PATH}`);
    return;
  }

  const baseline = await loadBaseline();
  if (!baseline) {
    console.log(`\nNo baseline at ${BASELINE_PATH} yet — run with --update-baseline to create one. Nothing to gate on.`);
    return;
  }

  const current = scoresByRole(heuristicReport);
  const regressions = Object.entries(baseline).filter(([role, prevF1]) => (current[role] ?? 0) < prevF1 - 1e-9);
  if (regressions.length) {
    console.error("\nREGRESSION — these roles scored lower than the checked-in baseline:");
    for (const [role, prevF1] of regressions) {
      console.error(`  ${role}: ${prevF1.toFixed(3)} -> ${(current[role] ?? 0).toFixed(3)}`);
    }
    process.exit(1);
  }
  console.log("\nNo regressions against baseline.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
