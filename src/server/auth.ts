import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { HttpError } from "./captures.js";
import { getPool, migrate } from "./db.js";
import { sessionSecret } from "./env.js";

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
}

const SESSION_DAYS = 14;
const BCRYPT_ROUNDS = 10;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateCredentials(input: {
  email?: string;
  password?: string;
  name?: string;
}): { email: string; password: string; name: string | null } {
  const email = normalizeEmail(input.email ?? "");
  const password = input.password ?? "";
  const name = input.name?.trim() || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address");
  }
  if (password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  if (name && name.length > 80) {
    throw new HttpError(400, "Name is too long");
  }
  return { email, password, name };
}

function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function registerUser(input: {
  email?: string;
  password?: string;
  name?: string;
}): Promise<{ user: PublicUser; token: string; maxAgeSec: number }> {
  await migrate();
  const { email, password, name } = validateCredentials(input);
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const db = getPool();
  try {
    const inserted = await db.query<{ id: string; email: string; name: string | null }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email, password_hash, name],
    );
    const user = inserted.rows[0]!;
    const session = await createSession(user.id);
    return { user, ...session };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") throw new HttpError(409, "An account with that email already exists");
    throw err;
  }
}

export async function loginUser(input: {
  email?: string;
  password?: string;
}): Promise<{ user: PublicUser; token: string; maxAgeSec: number }> {
  await migrate();
  const email = normalizeEmail(input.email ?? "");
  const password = input.password ?? "";
  if (!email || !password) {
    throw new HttpError(401, "Email or password is incorrect");
  }
  const db = getPool();
  const found = await db.query<{
    id: string;
    email: string;
    name: string | null;
    password_hash: string;
  }>(`SELECT id, email, name, password_hash FROM users WHERE email = $1`, [email]);
  const row = found.rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, "Email or password is incorrect");
  }
  const session = await createSession(row.id);
  return { user: { id: row.id, email: row.email, name: row.name }, ...session };
}

export async function createSession(
  userId: string,
): Promise<{ token: string; maxAgeSec: number }> {
  const token = randomBytes(32).toString("hex");
  const maxAgeSec = SESSION_DAYS * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAgeSec * 1000);
  await getPool().query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expires.toISOString()],
  );
  return { token, maxAgeSec };
}

export async function userFromToken(token: string | null): Promise<PublicUser | null> {
  if (!token) return null;
  await migrate();
  const found = await getPool().query<PublicUser>(
    `SELECT u.id, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return found.rows[0] ?? null;
}

export async function revokeToken(token: string | null): Promise<void> {
  if (!token) return;
  await migrate();
  await getPool().query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}
