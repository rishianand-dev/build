import { basename } from "node:path";
import { capturePage, defaultCaptureDir } from "../capture/capture.js";
import { CAPTURES_ROOT } from "./captures.js";
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
