import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { resolveAssetFile } from "./assets.js";
import { loginUser, registerUser, revokeToken, userFromToken } from "./auth.js";
import {
  HttpError,
  createReadStream,
  listCaptures,
  readCapture,
  resolveCaptureFile,
  ensureSite,
  deleteCapture,
} from "./captures.js";
import { clearSessionCookie, readCookie, setSessionCookie } from "./cookies.js";
import { migrate } from "./db.js";
import { getJob, parseHttpUrl, startJob, type Job } from "./jobs.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", `${type}; charset=utf-8`);
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function publicJob(job: Job): Omit<Job, "userId"> {
  const { userId: _userId, ...rest } = job;
  return rest;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Invalid JSON");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Invalid JSON");
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function requireUser(req: IncomingMessage) {
  const user = await userFromToken(readCookie(req));
  if (!user) throw new HttpError(401, "Sign in to continue");
  return user;
}

function isDbDown(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "28P01" ||
    code === "3D000"
  ) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /DATABASE_URL|SESSION_SECRET|database unavailable/i.test(message);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;

  const method = req.method ?? "GET";
  const path = url.pathname;

  try {
    if (method === "GET" && path === "/api/health") {
      let db = false;
      try {
        await migrate();
        db = true;
      } catch (err) {
        console.error("[honebi] database health check failed:", err);
        db = false;
      }
      send(res, 200, { ok: true, db });
      return true;
    }

    if (method === "POST" && path === "/api/auth/register") {
      const body = await readJson(req);
      const result = await registerUser({
        email: str(body.email),
        password: str(body.password),
        name: str(body.name),
      });
      setSessionCookie(res, result.token, result.maxAgeSec);
      send(res, 201, { user: result.user });
      return true;
    }

    if (method === "POST" && path === "/api/auth/login") {
      const body = await readJson(req);
      const result = await loginUser({
        email: str(body.email),
        password: str(body.password),
      });
      setSessionCookie(res, result.token, result.maxAgeSec);
      send(res, 200, { user: result.user });
      return true;
    }

    if (method === "POST" && path === "/api/auth/logout") {
      await revokeToken(readCookie(req));
      clearSessionCookie(res);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === "GET" && path === "/api/auth/me") {
      const user = await userFromToken(readCookie(req));
      send(res, 200, { user });
      return true;
    }

    const user = await requireUser(req);

    if (method === "GET" && path === "/api/captures") {
      send(res, 200, await listCaptures(user.id));
      return true;
    }

    const siteMatch = path.match(/^\/api\/captures\/([^/]+)\/site$/);
    if (method === "GET" && siteMatch) {
      const { html } = await ensureSite(siteMatch[1]!, user.id);
      send(res, 200, html, "text/html");
      return true;
    }

    const themeMatch = path.match(/^\/api\/captures\/([^/]+)\/theme$/);
    if (method === "GET" && themeMatch) {
      const { theme } = await ensureSite(themeMatch[1]!, user.id);
      send(res, 200, theme);
      return true;
    }

    const captureMatch = path.match(/^\/api\/captures\/([^/]+)$/);
    if (method === "DELETE" && captureMatch) {
      await deleteCapture(captureMatch[1]!, user.id);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === "GET" && captureMatch) {
      const includeDom = url.searchParams.get("dom") === "1";
      send(res, 200, await readCapture(captureMatch[1]!, includeDom, user.id));
      return true;
    }

    const fileMatch = path.match(/^\/api\/captures\/([^/]+)\/file\/(.+)$/);
    if (method === "GET" && fileMatch) {
      const abs = await resolveCaptureFile(fileMatch[1]!, decodeURIComponent(fileMatch[2]!), user.id);
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME[extname(abs).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=3600");
      createReadStream(abs).pipe(res);
      return true;
    }

    const assetMatch = path.match(/^\/api\/assets\/([^/]+)$/);
    if (method === "GET" && assetMatch) {
      // Content-addressed and shared across users/captures (no ownership
      // check beyond being signed in) — knowing the hash is enough, same
      // as any content-addressed store.
      const abs = await resolveAssetFile(decodeURIComponent(assetMatch[1]!));
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME[extname(abs).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      createReadStream(abs).pipe(res);
      return true;
    }

    if (method === "POST" && path === "/api/jobs") {
      const body = await readJson(req);
      const target = parseHttpUrl(str(body.url) ?? "");
      const viewport =
        body.width && body.height
          ? { width: Number(body.width), height: Number(body.height) }
          : undefined;
      send(res, 202, publicJob(startJob(target, user.id, viewport)));
      return true;
    }

    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === "GET" && jobMatch) {
      const job = getJob(jobMatch[1]!, user.id);
      if (!job) throw new HttpError(404, "Job not found");
      send(res, 200, publicJob(job));
      return true;
    }

    send(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    if (err instanceof HttpError) {
      send(res, err.status, { error: err.message });
      return true;
    }
    if (isDbDown(err)) {
      console.error("[honebi] database unavailable:", err);
      send(res, 503, { error: "Database unavailable" });
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("URL") || message.includes("http") ? 400 : 500;
    send(res, status, { error: message });
    return true;
  }
}
