import { basename, join } from "node:path";
import { capturePage, defaultCaptureDir } from "../capture/capture.js";
import { CAPTURES_ROOT } from "./captures.js";
import { figmaToken } from "./env.js";
import { saveUserTheme } from "./themes.js";

export interface Job {
  id: string;
  url: string;
  userId: string;
  status: "queued" | "running" | "done" | "error";
  step: string;
  detail?: string;
  captureId?: string;
  error?: string;
  started_at: string;
  finished_at?: string;
}

const jobs = new Map<string, Job>();
let queue: Promise<void> = Promise.resolve();
let n = 0;

export function getJob(id: string, userId: string): Job | undefined {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return undefined;
  return job;
}

export function startJob(
  url: string,
  userId: string,
  viewport?: { width: number; height: number },
): Job {
  const id = `job-${Date.now().toString(36)}-${++n}`;
  const job: Job = {
    id,
    url,
    userId,
    status: "queued",
    step: "queued",
    started_at: new Date().toISOString(),
  };
  jobs.set(id, job);

  queue = queue.then(() => runJob(job, viewport), () => runJob(job, viewport));
  return job;
}

async function runJob(job: Job, viewport?: { width: number; height: number }): Promise<void> {
  job.status = "running";
  job.step = "launch";
  try {
    const outDir = defaultCaptureDir(job.url, CAPTURES_ROOT);
    const capture = await capturePage({
      url: job.url,
      outDir,
      viewport,
      onProgress: (event) => {
        job.step = event.step;
        job.detail = event.detail;
      },
    });
    job.step = "build";
    job.detail = "Assembling website";
    const { persistBuild } = await import("../build/persist.js");
    const theme = await persistBuild(outDir, capture);
    const captureId = basename(outDir);
    await saveUserTheme({
      userId: job.userId,
      captureId,
      url: capture.url,
      finalUrl: capture.final_url,
      title: capture.title,
      theme,
      blocks: capture.candidate_blocks.length,
      assets: capture.assets.length,
      warnings: capture.warnings.length,
      capturedAt: capture.captured_at,
    });
    job.status = "done";
    job.step = "done";
    job.captureId = captureId;
    job.detail = capture.title;
    job.finished_at = new Date().toISOString();
  } catch (err) {
    job.status = "error";
    job.step = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.finished_at = new Date().toISOString();
  }
}

export function startFigmaJob(fileKey: string, nodeId: string, userId: string): Job {
  const id = `job-${Date.now().toString(36)}-${++n}`;
  const job: Job = {
    id,
    url: `https://www.figma.com/design/${fileKey}?node-id=${nodeId}`,
    userId,
    status: "queued",
    step: "queued",
    started_at: new Date().toISOString(),
  };
  jobs.set(id, job);

  // Shares the same serialized queue as URL-capture jobs: a Figma import
  // (API calls + downloads) is lighter than a Playwright capture, but
  // running both kinds unbounded-concurrently isn't worth the complexity
  // this MVP needs — same conservative choice runJob already makes.
  queue = queue.then(
    () => runFigmaJob(job, fileKey, nodeId),
    () => runFigmaJob(job, fileKey, nodeId),
  );
  return job;
}

async function runFigmaJob(job: Job, fileKey: string, nodeId: string): Promise<void> {
  job.status = "running";
  job.step = "fetch";
  job.detail = "Fetching Figma frame";
  try {
    const token = figmaToken();
    if (!token) throw new Error("FIGMA_TOKEN is not set");
    const dirName = `figma-${fileKey}-${nodeId.replace(/:/g, "-")}-${Date.now().toString(36)}`;
    const outDir = join(CAPTURES_ROOT, dirName);

    job.step = "build";
    job.detail = "Assembling website";
    const { persistBuildFromFigma } = await import("../build/persist.js");
    const { theme, capture } = await persistBuildFromFigma(outDir, { fileKey, nodeId, token });

    const captureId = basename(outDir);
    await saveUserTheme({
      userId: job.userId,
      captureId,
      url: capture.url,
      finalUrl: capture.final_url,
      title: capture.title,
      theme,
      blocks: capture.candidate_blocks.length,
      assets: capture.assets.length,
      warnings: capture.warnings.length,
      capturedAt: capture.captured_at,
    });
    job.status = "done";
    job.step = "done";
    job.captureId = captureId;
    job.detail = capture.title;
    job.finished_at = new Date().toISOString();
  } catch (err) {
    job.status = "error";
    job.step = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.finished_at = new Date().toISOString();
  }
}

/** Accepts a pasted Figma frame URL (`.../design/<fileKey>/...?node-id=<id>` or the
 * older `/file/` path) or a `fileKey:nodeId` shorthand. Figma's URLs spell node ids
 * with a dash (`1-234`); the API itself wants a colon (`1:234`). */
export function parseFigmaInput(input: string): { fileKey: string; nodeId: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("A Figma file/frame URL or 'fileKey:nodeId' is required");

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const fileKey = url.pathname.match(/\/(?:design|file)\/([^/]+)/)?.[1];
    const nodeIdRaw = url.searchParams.get("node-id");
    if (!fileKey || !nodeIdRaw) {
      throw new Error("Figma URL must be a /design/ or /file/ link with a node-id query param");
    }
    return { fileKey, nodeId: nodeIdRaw.replace(/-/g, ":") };
  }

  const idx = trimmed.indexOf(":");
  if (idx <= 0 || idx === trimmed.length - 1) {
    throw new Error("Provide a Figma frame URL (with node-id) or 'fileKey:nodeId'");
  }
  return { fileKey: trimmed.slice(0, idx), nodeId: trimmed.slice(idx + 1) };
}

export function parseHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("URL is required");
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  return url.toString();
}
