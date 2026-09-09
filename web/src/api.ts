export interface CaptureSummary {
  id: string;
  title: string;
  url: string;
  final_url: string;
  captured_at: string;
  blocks: number;
  assets: number;
  warnings: number;
  thumb: string | null;
  has_site: boolean;
}

export interface Job {
  id: string;
  url: string;
  status: "queued" | "running" | "done" | "error";
  step: string;
  detail?: string;
  captureId?: string;
  error?: string;
}

export interface PageCaptureView {
  url: string;
  final_url: string;
  captured_at: string;
  title: string;
  viewport: { width: number; height: number };
  page_metrics: { scroll_width: number; scroll_height: number };
  seo: {
    description: string | null;
    canonical: string | null;
    og_title: string | null;
  };
  screenshots: {
    full_page: string;
    viewport_top: string;
    scroll_600: string;
    scroll_back: string;
    hovers: Array<{ index: number; selector: string; before: string; after: string }>;
  };
  assets: Array<{ url: string; resource_type: string }>;
  theme_hints: {
    background_color: string;
    text_color: string;
    fonts: string[];
    color_palette: string[];
  };
  header_behavior: {
    sticky_or_fixed: boolean;
    always_fixed_on_scroll: boolean;
    reappear_on_scroll_up: boolean;
    document_flow: boolean;
    confidence: number;
    evidence: string[];
  };
  hover_reveals: Array<{
    index: number;
    selector: string;
    revealed: boolean;
    text_preview: string;
  }>;
  candidate_blocks: Array<{
    index: number;
    selector: string;
    tag: string;
    role: string | null;
    landmark: boolean;
    box: { width: number; height: number };
    image_count: number;
    link_count: number;
    text_preview: string;
  }>;
  warnings: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface ReviewItem {
  path: string;
  reason: string;
  confidence?: number;
}

/** A loose view of a theme Node — only the fields the review UI reads/edits, not the full typed union. */
export interface ThemeNodeView {
  type: string;
  role?: string;
  text?: string;
  children?: ThemeNodeView[];
  [key: string]: unknown;
}

export interface ThemeView {
  pages: Array<{ id: string; path: string; name?: string; title?: string; root: ThemeNodeView }>;
  review: ReviewItem[];
}

export interface Band {
  yStart: number;
  yEnd: number;
  diffRatio: number;
}

export interface KeywordEvidence {
  label: string;
  matchedText: string;
}

export interface IterationRecord {
  iteration: number;
  diffRatio: number;
  band: Band | null;
  patchedPath: string | null;
  keywordEvidence: KeywordEvidence[];
  screenshotPath: string;
  diffPngPath: string;
  note?: string;
}

export interface PixelMatchRun {
  id: string;
  captureId: string;
  status: "queued" | "running" | "done" | "error";
  history: IterationRecord[];
  converged?: boolean;
  error?: string;
  started_at: string;
  finished_at?: string;
}

export type ReviewActionBody =
  | { path: string; action: "accept" }
  | { path: string; action: "reject" }
  | { path: string; action: "edit"; role?: string; text?: string };

const credentials: RequestInit = { credentials: "include" };

async function json<T>(resPromise: Promise<Response>): Promise<T> {
  const res = await resPromise;
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function fileUrl(id: string, rel: string): string {
  return `/api/captures/${id}/file/${rel}`;
}

export const api = {
  me: () => json<{ user: AuthUser | null }>(fetch("/api/auth/me", credentials)),
  login: (body: { email: string; password: string }) =>
    json<{ user: AuthUser }>(
      fetch("/api/auth/login", {
        ...credentials,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ).then((data) => data.user),
  register: (body: { email: string; password: string; name?: string }) =>
    json<{ user: AuthUser }>(
      fetch("/api/auth/register", {
        ...credentials,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ).then((data) => data.user),
  logout: () =>
    json<{ ok: boolean }>(
      fetch("/api/auth/logout", {
        ...credentials,
        method: "POST",
      }),
    ),
  captures: () => json<CaptureSummary[]>(fetch("/api/captures", credentials)),
  capture: (id: string) => json<PageCaptureView>(fetch(`/api/captures/${id}`, credentials)),
  theme: (id: string) => json<ThemeView>(fetch(`/api/captures/${id}/theme`, credentials)),
  reviewAction: (id: string, body: ReviewActionBody) =>
    json<ThemeView>(
      fetch(`/api/captures/${id}/theme/node`, {
        ...credentials,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  deleteCapture: (id: string) =>
    json<{ ok: boolean }>(fetch(`/api/captures/${id}`, { ...credentials, method: "DELETE" })),
  startJob: (url: string) =>
    json<Job>(
      fetch("/api/jobs", {
        ...credentials,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    ),
  job: (id: string) => json<Job>(fetch(`/api/jobs/${id}`, credentials)),
  startPixelMatch: (captureId: string, maxIterations?: number) =>
    json<PixelMatchRun>(
      fetch(`/api/captures/${captureId}/pixel-match`, {
        ...credentials,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maxIterations ? { maxIterations } : {}),
      }),
    ),
  pixelMatchRun: (runId: string) => json<PixelMatchRun>(fetch(`/api/pixel-match/${runId}`, credentials)),
};
