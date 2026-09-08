import { useState } from "react";
import { api, type ReviewItem, type ThemeNodeView, type ThemeView } from "./api";

/** Same JSON-pointer semantics as the backend's resolveNodeAtPath, reimplemented
 * client-side (the web app doesn't import the server's schema module) — walks
 * `/pages/<i>/root(/children/<i>)*`. Anything else (a pipeline-level note like
 * `/pages/0/header`) resolves to undefined, which the UI treats as "not editable,
 * only dismissable". */
function resolveNode(theme: ThemeView, path: string): ThemeNodeView | undefined {
  const segs = path.split("/").filter(Boolean);
  if (segs[0] !== "pages" || segs[2] !== "root") return undefined;
  let cursor: ThemeNodeView | undefined = theme.pages[Number(segs[1])]?.root;
  for (let i = 3; i < segs.length; i += 2) {
    if (segs[i] !== "children" || !cursor?.children) return undefined;
    cursor = cursor.children[Number(segs[i + 1])];
  }
  return cursor;
}

function nodePreview(node: ThemeNodeView | undefined): string {
  if (!node) return "(no matching node — pipeline-level note)";
  const bits = [node.type, node.role ? `role: ${node.role}` : null, node.text ? `“${node.text}”` : null];
  return bits.filter(Boolean).join(" · ");
}

interface RowState {
  editing: boolean;
  role: string;
  text: string;
  busy: boolean;
  error: string | null;
}

function initialRowState(node: ThemeNodeView | undefined): RowState {
  return { editing: false, role: node?.role ?? "", text: node?.text ?? "", busy: false, error: null };
}

export function ReviewPanel({
  captureId,
  theme,
  onThemeUpdated,
}: {
  captureId: string;
  theme: ThemeView;
  onThemeUpdated: (next: ThemeView) => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const rowFor = (item: ReviewItem, node: ThemeNodeView | undefined) =>
    rows[item.path] ?? initialRowState(node);

  const setRow = (path: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [path]: { ...(prev[path] ?? initialRowState(undefined)), ...patch } }));

  async function run(item: ReviewItem, body: Parameters<typeof api.reviewAction>[1]) {
    setRow(item.path, { busy: true, error: null });
    try {
      const next = await api.reviewAction(captureId, body);
      onThemeUpdated(next);
      setRows((prev) => {
        const { [item.path]: _drop, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setRow(item.path, { busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!theme.review.length) {
    return <p className="muted">Nothing flagged for review — every section built with high confidence.</p>;
  }

  return (
    <ul className="review-list">
      {theme.review.map((item) => {
        const node = resolveNode(theme, item.path);
        const editable = Boolean(node);
        const row = rowFor(item, node);
        return (
          <li key={item.path} className="review-row">
            <div className="review-meta">
              <code>{item.path}</code>
              {typeof item.confidence === "number" ? (
                <span className="confidence">confidence {Math.round(item.confidence * 100)}%</span>
              ) : null}
            </div>
            <p className="reason">{item.reason}</p>
            <p className="preview">{nodePreview(node)}</p>

            {row.editing ? (
              <div className="review-edit">
                {node ? (
                  <label>
                    Role
                    <input
                      type="text"
                      value={row.role}
                      onChange={(e) => setRow(item.path, { role: e.target.value })}
                      disabled={row.busy}
                    />
                  </label>
                ) : null}
                {node && (node.type === "text" || node.type === "button") ? (
                  <label>
                    Text
                    <input
                      type="text"
                      value={row.text}
                      onChange={(e) => setRow(item.path, { text: e.target.value })}
                      disabled={row.busy}
                    />
                  </label>
                ) : null}
                <div className="review-actions">
                  <button
                    type="button"
                    disabled={row.busy}
                    onClick={() =>
                      void run(item, { path: item.path, action: "edit", role: row.role, text: row.text })
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="text" disabled={row.busy} onClick={() => setRow(item.path, { editing: false })}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="review-actions">
                <button type="button" disabled={row.busy} onClick={() => void run(item, { path: item.path, action: "accept" })}>
                  Accept
                </button>
                <button
                  type="button"
                  disabled={row.busy || !editable}
                  title={editable ? undefined : "No node to edit — this is a pipeline-level note"}
                  onClick={() => setRow(item.path, { editing: true })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={row.busy || !editable}
                  title={editable ? undefined : "No node to remove — this is a pipeline-level note"}
                  onClick={() => {
                    if (window.confirm("Remove this section from the built page?")) {
                      void run(item, { path: item.path, action: "reject" });
                    }
                  }}
                >
                  Reject
                </button>
              </div>
            )}
            {row.error ? <p className="error">{row.error}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
