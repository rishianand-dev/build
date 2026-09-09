/**
 * Background-job wrapper around the pixel-match loop (src/build/pixel-loop.ts),
 * mirroring jobs.ts's in-memory Map + serialized queue pattern — a run is
 * genuinely long (many Playwright screenshots), so it's started and polled,
 * not returned synchronously from one request.
 *
 * Deliberately its own queue, separate from jobs.ts's capture/Figma queue:
 * this is experimental, opt-in work on a capture that already has a saved
 * theme, and shouldn't block (or be blocked by) normal capture jobs.
 */
import { captureDir, ensureSite, readCapture } from "./captures.js";
import { runPixelMatchLoop, type IterationRecord } from "../build/pixel-loop.js";

export interface PixelMatchRun {
  id: string;
  captureId: string;
  userId: string;
  status: "queued" | "running" | "done" | "error";
  history: IterationRecord[];
  converged?: boolean;
  error?: string;
  started_at: string;
  finished_at?: string;
}

const runs = new Map<string, PixelMatchRun>();
let queue: Promise<void> = Promise.resolve();
let n = 0;

export function getPixelMatchRun(id: string, userId: string): PixelMatchRun | undefined {
  const run = runs.get(id);
  if (!run || run.userId !== userId) return undefined;
  return run;
}

export function startPixelMatchRun(
  captureId: string,
  userId: string,
  opts: { maxIterations?: number } = {},
): PixelMatchRun {
  const id = `pm-${Date.now().toString(36)}-${++n}`;
  const run: PixelMatchRun = {
    id,
    captureId,
    userId,
    status: "queued",
    history: [],
    started_at: new Date().toISOString(),
  };
  runs.set(id, run);
  queue = queue.then(
    () => execute(run, opts),
    () => execute(run, opts),
  );
  return run;
}

async function execute(run: PixelMatchRun, opts: { maxIterations?: number }): Promise<void> {
  run.status = "running";
  try {
    const capture = await readCapture(run.captureId, true, run.userId);
    const { theme: initialTheme } = await ensureSite(run.captureId, run.userId);
    const dir = captureDir(run.captureId);
    const result = await runPixelMatchLoop(dir, capture, initialTheme, {
      maxIterations: opts.maxIterations,
      onIteration: (record) => {
        run.history = [...run.history, record];
      },
    });
    run.converged = result.converged;
    run.status = "done";
    run.finished_at = new Date().toISOString();
  } catch (err) {
    run.status = "error";
    run.error = err instanceof Error ? err.message : String(err);
    run.finished_at = new Date().toISOString();
  }
}
