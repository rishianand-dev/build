import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AuthBoot, AuthScreen } from "./Auth";
import {
  api,
  fileUrl,
  type AuthUser,
  type CaptureSummary,
  type Job,
  type PageCaptureView,
  type ThemeView,
} from "./api";
import { ReviewPanel } from "./Review";

const STEPS = [
  "queued",
  "launch",
  "navigate",
  "lazy-load",
  "header",
  "hover",
  "screenshot",
  "snapshot",
    "write",
    "build",
    "done",
];

type ShotKey = "viewport_top" | "full_page" | "scroll_600" | "scroll_back" | `hover-${number}`;

function stepLabel(step: string): string {
  switch (step) {
    case "queued":
      return "Queued";
    case "launch":
      return "Launching browser";
    case "navigate":
      return "Loading page";
    case "lazy-load":
      return "Loading lazy images";
    case "header":
      return "Reading header behavior";
    case "hover":
      return "Probing card hovers";
    case "screenshot":
      return "Taking screenshots";
    case "snapshot":
      return "Snapshotting DOM";
    case "write":
      return "Writing capture";
    case "build":
      return "Building website";
    case "done":
      return "Done";
    case "error":
      return "Failed";
    default:
      return step;
  }
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`flag ${on ? "on" : "off"}`}>
      {label}
      <em>{on ? "yes" : "no"}</em>
    </span>
  );
}

export function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    void api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <AuthBoot />;
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return (
    <Studio
      user={user}
      onLogout={async () => {
        try {
          await api.logout();
        } finally {
          setUser(null);
        }
      }}
    />
  );
}

function Studio({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [url, setUrl] = useState("https://");
  const [list, setList] = useState<CaptureSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capture, setCapture] = useState<PageCaptureView | null>(null);
  const [theme, setTheme] = useState<ThemeView | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<ShotKey>("viewport_top");
  const [view, setView] = useState<"site" | "source" | "review">("site");
  const [sitePath, setSitePath] = useState("/");
  const [navPages, setNavPages] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const [loadingList, setLoadingList] = useState(true);

  async function onDeleteTheme(id: string) {
    const row = list.find((item) => item.id === id);
    const label = row?.title || "this theme";
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.deleteCapture(id);
      const next = list.filter((item) => item.id !== id);
      setList(next);
      if (selectedId === id) {
        setCapture(null);
        setNavPages([]);
        setSitePath("/");
        setSelectedId(next[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const refreshList = useCallback(async (preferId?: string) => {
    const rows = await api.captures();
    setList(rows);
    setLoadingList(false);
    setSelectedId((current) => preferId ?? current ?? rows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refreshList().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      setLoadingList(false);
    });
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setCapture(null);
      setTheme(null);
      setNavPages([]);
      setSitePath("/");
      return;
    }
    let cancelled = false;
    void Promise.all([api.capture(selectedId), api.theme(selectedId).catch(() => null)])
      .then(([data, fetchedTheme]) => {
        if (cancelled) return;
        setCapture(data);
        setTheme(fetchedTheme);
        setShot("viewport_top");
        setView("site");
        setSitePath("/");
        setUrl(data.url);
        const pages = (fetchedTheme?.pages ?? [])
          .filter((page) => page.path === "/" || page.path === "/shop")
          .map((page) => ({
            id: page.id,
            path: page.path,
            name: page.name || (page.path === "/shop" ? "Shop" : "Home"),
          }));
        setNavPages(
          pages.length
            ? pages
            : [
                { id: "home", path: "/", name: "Home" },
                { id: "list", path: "/shop", name: "Shop" },
              ],
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const timer = window.setInterval(() => {
      void api.job(job.id).then((next) => {
        setJob(next);
        if (next.status === "done" && next.captureId) {
          void refreshList(next.captureId);
        }
        if (next.status === "error") setError(next.error ?? "Capture failed");
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [job, refreshList]);

  const busy = job?.status === "queued" || job?.status === "running";

  const shotSrc = useMemo(() => {
    if (!selectedId || !capture) return null;
    if (shot.startsWith("hover-")) {
      const index = Number(shot.slice(6));
      const hover = capture.screenshots.hovers.find((h) => h.index === index);
      return hover ? { before: fileUrl(selectedId, hover.before), after: fileUrl(selectedId, hover.after) } : null;
    }
    const rel = capture.screenshots[shot as "viewport_top" | "full_page" | "scroll_600" | "scroll_back"];
    return rel ? { single: fileUrl(selectedId, rel) } : null;
  }, [capture, selectedId, shot]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const started = await api.startJob(url);
      setJob(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark">Hb</span>
          <div>
            <strong>Honebi Capture</strong>
            <p>URL → page snapshot</p>
          </div>
        </div>
        <form className="urlbar" onSubmit={onSubmit}>
          <input
            type="text"
            inputMode="url"
            spellCheck={false}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            aria-label="Website URL"
          />
          <button type="submit" disabled={busy || !url.replace(/^https?:\/\//i, "").trim()}>
            {busy ? "Capturing…" : "Capture"}
          </button>
          {selectedId ? (
            <a
              className="preview"
              href={`/api/captures/${encodeURIComponent(selectedId)}/site`}
              target="_blank"
              rel="noreferrer"
            >
              Preview
            </a>
          ) : (
            <span className="preview disabled" aria-disabled="true">
              Preview
            </span>
          )}
          <button
            type="button"
            className="delete"
            disabled={!selectedId || busy}
            onClick={() => {
              if (selectedId) void onDeleteTheme(selectedId);
            }}
          >
            Delete
          </button>
        </form>
        <div className="account">
          <span>{user.name || user.email}</span>
          <button type="button" className="text" onClick={() => void onLogout()}>
            Sign out
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

      {busy && job ? (
        <div className="progress" aria-live="polite">
            {STEPS.map((step) => {
            const currentIndex = Math.max(0, STEPS.indexOf(job.step));
            const i = STEPS.indexOf(step);
            const state = i < currentIndex ? "done" : i === currentIndex ? "now" : "";
            return (
              <span key={step} className={`pip ${state}`}>
                {stepLabel(step)}
              </span>
            );
          })}
          {job.detail ? <span className="detail">{job.detail}</span> : null}
        </div>
      ) : null}

      <div className="workspace">
        <aside className="rail">
          <h2>Captures</h2>
          {loadingList ? <p className="muted">Loading…</p> : null}
          {!loadingList && list.length === 0 ? (
            <p className="muted">None yet. Paste a URL and capture a page.</p>
          ) : null}
          <ul>
            {list.map((row) => (
              <li key={row.id} className="capture-row">
                <button
                  type="button"
                  className={`pick ${row.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  {row.thumb ? <img src={row.thumb} alt="" /> : <span className="ph" />}
                  <span>
                    <strong>{row.title}</strong>
                    <small>{new URL(row.final_url || row.url).hostname}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Delete ${row.title}`}
                  onClick={() => void onDeleteTheme(row.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="stage">
          {!capture ? (
            <div className="empty">
              <h1>Build a website from a URL</h1>
              <p>
                Paste a live page, capture it, and Honebi reconstructs a real site from tokens, shared
                components, and sections — not a screenshot.
              </p>
            </div>
          ) : (
            <>
              <div className="shot-tabs">
                <button
                  type="button"
                  className={view === "site" ? "active" : ""}
                  onClick={() => setView("site")}
                >
                  Built website
                </button>
                <button
                  type="button"
                  className={view === "source" ? "active" : ""}
                  onClick={() => setView("source")}
                >
                  Source snapshot
                </button>
                <button
                  type="button"
                  className={view === "review" ? "active" : ""}
                  onClick={() => setView("review")}
                >
                  Review{theme?.review.length ? ` (${theme.review.length})` : ""}
                </button>
                {view === "site"
                  ? navPages.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        className={sitePath === page.path ? "active" : ""}
                        onClick={() => setSitePath(page.path)}
                      >
                        {page.name}
                      </button>
                    ))
                  : null}
                {view === "source"
                  ? (
                      [
                        ["viewport_top", "Viewport"],
                        ["full_page", "Full page"],
                        ["scroll_600", "Scrolled"],
                        ["scroll_back", "Scroll back"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={shot === key ? "active" : ""}
                        onClick={() => setShot(key)}
                      >
                        {label}
                      </button>
                    ))
                  : null}
                {view === "source"
                  ? capture.screenshots.hovers.map((h) => (
                      <button
                        key={h.index}
                        type="button"
                        className={shot === `hover-${h.index}` ? "active" : ""}
                        onClick={() => setShot(`hover-${h.index}`)}
                      >
                        Hover {h.index + 1}
                      </button>
                    ))
                  : null}
              </div>
              {view === "site" ? (
                <iframe
                  className="site-frame"
                  title={`Built site: ${capture.title}`}
                  src={`/api/captures/${selectedId}/site#${sitePath}`}
                  key={`${selectedId}:${sitePath}`}
                />
              ) : null}
              {view === "source" ? (
                <div className="frame">
                  {shotSrc && "single" in shotSrc ? (
                    <img src={shotSrc.single} alt={`${capture.title} ${shot}`} />
                  ) : null}
                  {shotSrc && "before" in shotSrc ? (
                    <div className="split">
                      <figure>
                        <figcaption>Before</figcaption>
                        <img src={shotSrc.before} alt="Before hover" />
                      </figure>
                      <figure>
                        <figcaption>After</figcaption>
                        <img src={shotSrc.after} alt="After hover" />
                      </figure>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {view === "review" ? (
                theme && selectedId ? (
                  <div className="review-frame">
                    <ReviewPanel captureId={selectedId} theme={theme} onThemeUpdated={setTheme} />
                  </div>
                ) : (
                  <p className="muted">Loading…</p>
                )
              ) : null}
            </>
          )}
        </main>

        <aside className="inspect">
          {capture ? (
            <>
              <section>
                <h2 className="doc-title">{capture.title}</h2>
                <a href={capture.final_url} target="_blank" rel="noreferrer">
                  {capture.final_url}
                </a>
        <p className="muted">
                  {capture.viewport.width}×{capture.viewport.height} · Home, Shop, and product
                  pages share this header. Click a product card for its details page.
                </p>
              </section>
              <section>
                <h3>Header</h3>
                <div className="flags">
                  <Flag on={capture.header_behavior.sticky_or_fixed} label="sticky/fixed" />
                  <Flag on={capture.header_behavior.always_fixed_on_scroll} label="stays pinned" />
                  <Flag on={capture.header_behavior.reappear_on_scroll_up} label="reappear" />
                  <Flag on={capture.header_behavior.document_flow} label="in flow" />
                </div>
                <ul className="evidence">
                  {capture.header_behavior.evidence.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Theme hints</h3>
                <div className="swatches">
                  {capture.theme_hints.color_palette.slice(0, 12).map((c) => (
                    <i key={c} style={{ background: c }} title={c} />
                  ))}
                </div>
                <p className="muted">{capture.theme_hints.fonts.join(" · ") || "No fonts sampled"}</p>
              </section>
              <section>
                <h3>
                  Blocks <small>{capture.candidate_blocks.length}</small>
                </h3>
                <ol className="blocks">
                  {capture.candidate_blocks.map((block) => (
                    <li key={block.index}>
                      <code>
                        {block.tag}
                        {block.landmark ? " · landmark" : ""}
                      </code>
                      <span>
                        {block.box.width}×{block.box.height} · {block.image_count} img · {block.link_count}{" "}
                        links
                      </span>
                      <p>{block.text_preview || "—"}</p>
                    </li>
                  ))}
                </ol>
              </section>
              {capture.warnings.length ? (
                <section>
                  <h3>Warnings</h3>
                  <ul className="evidence">
                    {capture.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <p className="muted">Select a capture to inspect header behavior, blocks, and colors.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
