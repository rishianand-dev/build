import { useEffect, useMemo, useState } from "react";
import {
  api,
  fileUrl,
  type AuthUser,
  type CaptureSummary,
  type IterationRecord,
  type PageCaptureView,
  type PixelMatchRun,
} from "./api";

/**
 * A deliberately separate page (its own route, its own component tree —
 * nothing shared with Studio's view-switcher) for the pixel-match loop:
 * build -> screenshot -> diff against the real capture -> re-derive the
 * worst-mismatched region from its real HTML/CSS -> splice it back in ->
 * repeat, until the render is pixel-close to the real page or it plateaus.
 * Kept off the normal Studio tabs so it can't affect that view at all.
 */
export function PixelMatchPage({ user, onBack }: { user: AuthUser; onBack: () => void }) {
  const [list, setList] = useState<CaptureSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCapture, setSelectedCapture] = useState<PageCaptureView | null>(null);
  const [maxIterations, setMaxIterations] = useState(15);
  const [run, setRun] = useState<PixelMatchRun | null>(null);
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    void api
      .captures()
      .then((rows) => {
        setList(rows);
        setLoadingList(false);
        setSelectedId((current) => current ?? rows[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoadingList(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedCapture(null);
      return;
    }
    let cancelled = false;
    void api
      .capture(selectedId)
      .then((data) => {
        if (!cancelled) setSelectedCapture(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const busy = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    if (!run || !busy) return;
    const timer = window.setInterval(() => {
      void api
        .pixelMatchRun(run.id)
        .then((next) => setRun(next))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, 800);
    return () => window.clearInterval(timer);
  }, [run, busy]);

  async function onStart() {
    if (!selectedId) return;
    setError(null);
    setSelectedIteration(null);
    try {
      const started = await api.startPixelMatch(selectedId, maxIterations);
      setRun(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const latest = run?.history[run.history.length - 1] ?? null;
  const shown: IterationRecord | null = useMemo(() => {
    if (!run) return null;
    if (selectedIteration == null) return latest;
    return run.history.find((r) => r.iteration === selectedIteration) ?? latest;
  }, [run, selectedIteration, latest]);

  const captureIdForImages = run?.captureId ?? selectedId;

  return (
    <div className="pm-page">
      <header className="pm-top">
        <div className="brand">
          <span className="mark">Hb</span>
          <div>
            <strong>Pixel-Match Loop</strong>
            <p>Iteratively re-derive mismatched regions from real HTML/CSS until the render converges</p>
          </div>
        </div>
        <div className="account">
          <span>{user.name || user.email}</span>
          <button type="button" className="text" onClick={onBack}>
            ← Back to Studio
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner" role="alert">
          {error}
          <button type="button" className="text" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="pm-controls">
        <label>
          Capture
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            disabled={busy || loadingList}
          >
            {loadingList ? <option>Loading…</option> : null}
            {!loadingList && list.length === 0 ? <option>No captures yet</option> : null}
            {list.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title || row.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max iterations
          <input
            type="number"
            min={1}
            max={50}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            disabled={busy}
          />
        </label>
        <button type="button" onClick={() => void onStart()} disabled={busy || !selectedId}>
          {busy ? "Running…" : "Start run"}
        </button>
        {run ? (
          <span className={`pm-status pm-status-${run.status}`}>
            {run.status}
            {run.status === "done" ? (run.converged ? " · converged" : " · plateaued") : ""}
          </span>
        ) : null}
      </div>

      {!run ? (
        <div className="empty">
          <h1>No run yet</h1>
          <p>
            Pick a capture that already has a built theme, then start a run. Each iteration renders the
            current theme, screenshots it, diffs it pixel-by-pixel against the real capture, and — for the
            worst-mismatched region — re-derives that region from its real HTML/CSS in isolation before
            trying again.
          </p>
        </div>
      ) : (
        <div className="pm-body">
          <div className="pm-chart-col">
            <DiffChart
              history={run.history}
              selected={shown?.iteration ?? null}
              onSelect={setSelectedIteration}
            />
            <ol className="pm-history">
              {run.history.map((r) => (
                <li key={r.iteration}>
                  <button
                    type="button"
                    className={shown?.iteration === r.iteration ? "active" : ""}
                    onClick={() => setSelectedIteration(r.iteration)}
                  >
                    <strong>#{r.iteration}</strong>
                    <span>{(r.diffRatio * 100).toFixed(1)}% diff</span>
                    {r.patchedPath ? <code>{r.patchedPath}</code> : null}
                    {r.keywordEvidence.length ? (
                      <em>{r.keywordEvidence.map((k) => k.label).join(", ")}</em>
                    ) : null}
                    {r.note ? <small>{r.note}</small> : null}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="pm-images">
            {shown && captureIdForImages && selectedCapture?.screenshots.full_page ? (
              <>
                <figure>
                  <figcaption>Real page</figcaption>
                  <img
                    src={fileUrl(captureIdForImages, selectedCapture.screenshots.full_page)}
                    alt="Real page screenshot"
                  />
                </figure>
                <figure>
                  <figcaption>Rendered (iteration {shown.iteration})</figcaption>
                  <img src={fileUrl(captureIdForImages, shown.screenshotPath)} alt="Rendered screenshot" />
                </figure>
                <figure>
                  <figcaption>Diff (red = mismatched pixels)</figcaption>
                  <img src={fileUrl(captureIdForImages, shown.diffPngPath)} alt="Diff mask" />
                </figure>
              </>
            ) : (
              <p className="muted">Waiting for the first iteration…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffChart({
  history,
  selected,
  onSelect,
}: {
  history: IterationRecord[];
  selected: number | null;
  onSelect: (iteration: number) => void;
}) {
  if (!history.length) return null;
  const width = 480;
  const height = 120;
  const pad = 8;
  const maxRatio = Math.max(0.05, ...history.map((r) => r.diffRatio));
  const points = history.map((r, i) => {
    const x = history.length === 1 ? pad : pad + (i / (history.length - 1)) * (width - pad * 2);
    const y = height - pad - (r.diffRatio / maxRatio) * (height - pad * 2);
    return { x, y, r };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg className="pm-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pixel diff by iteration">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p) => (
        <circle
          key={p.r.iteration}
          cx={p.x}
          cy={p.y}
          r={p.r.iteration === selected ? 5 : 3}
          fill={p.r.iteration === selected ? "var(--accent)" : "var(--ink)"}
          onClick={() => onSelect(p.r.iteration)}
          style={{ cursor: "pointer" }}
        />
      ))}
    </svg>
  );
}
