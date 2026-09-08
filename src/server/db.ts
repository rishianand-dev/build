import dns from "node:dns";
import net from "node:net";
import pg from "pg";
import { databaseUrl } from "./env.js";

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const { Pool } = pg;

let pool: pg.Pool | undefined;
let migrated = false;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = databaseUrl()
      .replace(/[?&]channel_binding=require/, "")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
    pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

export async function migrate(): Promise<void> {
  if (migrated) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      name text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS themes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      capture_id text NOT NULL,
      url text NOT NULL,
      final_url text NOT NULL,
      title text NOT NULL DEFAULT '',
      theme jsonb NOT NULL,
      blocks int NOT NULL DEFAULT 0,
      assets int NOT NULL DEFAULT 0,
      warnings int NOT NULL DEFAULT 0,
      captured_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, capture_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS themes_user_id_idx ON themes(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS themes_user_captured_at_idx ON themes(user_id, captured_at DESC)`);
  // Every accept/edit/reject a human makes on a heuristic/vision/Figma-derived
  // node is one labeled training example (predicted vs. corrected) — the data
  // source for a future trained classifier. See src/server/corrections.ts.
  await db.query(`
    CREATE TABLE IF NOT EXISTS corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      capture_id text NOT NULL,
      node_path text NOT NULL,
      detector text,
      predicted_role text,
      predicted_confidence real,
      predicted_snapshot jsonb NOT NULL,
      action text NOT NULL CHECK (action IN ('accept', 'edit', 'reject')),
      corrected_snapshot jsonb,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS corrections_user_id_idx ON corrections(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS corrections_capture_id_idx ON corrections(capture_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS corrections_detector_idx ON corrections(detector)`);
  migrated = true;
}
