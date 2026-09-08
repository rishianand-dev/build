import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE = "honebi_session";

export function readCookie(req: IncomingMessage, name = COOKIE): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: ServerResponse, token: string, maxAgeSec: number): void {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
