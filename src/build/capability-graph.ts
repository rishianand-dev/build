/**
 * Capability graph: maps `data/capability-registry.json`'s 174 endpoint
 * entries to component roles and bind keys, so a component's data needs
 * (its `role` plus its `Component.binds` keys) can be matched against
 * real backend endpoints — grounding for an LLM's or a trained model's
 * decisions about what data a section needs (see the plan's workstream 1).
 *
 * Read-only derived data, like `src/schema/impact.ts` — no schema change,
 * recomputed on demand from the registry file.
 *
 * `request_body_fields_guess` is explicitly unvalidated (extracted
 * heuristically from source, per the registry's own `notes` field on
 * every entry) — this module never treats a match as a confirmed binding,
 * only a candidate worth a human's or an LLM's attention.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { roleFromCapabilityTag, type CanonicalRole } from "../schema/roles.js";

export interface CapabilityRegistryEntry {
  capability: string[];
  suggested_section_types: string[];
  service: string;
  function: string;
  method: string;
  path: string;
  requires_auth: boolean;
  request_body_fields_guess: string[];
  params_signature: string;
  notes: string;
}

/**
 * One real endpoint, deduped by `path` from however many registry entries
 * (different service/function names) hit it — the registry's own
 * documented gotcha: e.g. `getSalesOrderDetails`/`getoneOrderHistoryEndPoint`/
 * `getPosOrdersById` all resolve to `/sales-orders/one`.
 */
export interface CanonicalEndpoint {
  path: string;
  methods: string[];
  functions: string[];
  capabilities: string[];
  requestFieldsGuess: string[];
  /** `suggested_section_types` mapped through roles.ts's alias table, deduped. */
  roles: CanonicalRole[];
  requiresAuth: boolean;
}

const DEFAULT_REGISTRY_PATH = resolve(process.cwd(), "data/capability-registry.json");

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Loads and dedupes the registry by path. Cheap enough (174 entries) to not bother caching. */
export function buildCapabilityIndex(registryPath: string = DEFAULT_REGISTRY_PATH): CanonicalEndpoint[] {
  const raw = readFileSync(registryPath, "utf8");
  const entries = JSON.parse(raw) as CapabilityRegistryEntry[];

  const byPath = new Map<string, CanonicalEndpoint>();
  for (const entry of entries) {
    let endpoint = byPath.get(entry.path);
    if (!endpoint) {
      endpoint = {
        path: entry.path,
        methods: [],
        functions: [],
        capabilities: [],
        requestFieldsGuess: [],
        roles: [],
        requiresAuth: entry.requires_auth,
      };
      byPath.set(entry.path, endpoint);
    }
    endpoint.methods.push(entry.method);
    endpoint.functions.push(entry.function);
    endpoint.capabilities.push(...entry.capability);
    endpoint.requestFieldsGuess.push(...entry.request_body_fields_guess);
    endpoint.roles.push(
      ...entry.suggested_section_types
        .map((tag) => roleFromCapabilityTag(tag))
        .filter((r): r is CanonicalRole => Boolean(r)),
    );
    // requires_auth: if any entry sharing this path is auth-free, treat the
    // endpoint as reachable without auth rather than over-restricting.
    endpoint.requiresAuth &&= entry.requires_auth;
  }

  for (const endpoint of byPath.values()) {
    endpoint.methods = dedupe(endpoint.methods);
    endpoint.functions = dedupe(endpoint.functions);
    endpoint.capabilities = dedupe(endpoint.capabilities);
    endpoint.requestFieldsGuess = dedupe(endpoint.requestFieldsGuess);
    endpoint.roles = dedupe(endpoint.roles);
  }
  return [...byPath.values()];
}

export interface CapabilityMatch {
  endpoint: CanonicalEndpoint;
  /** "role": the endpoint is tagged for this exact section role — a strong signal.
   * "bind-keyword": a bind key showed up (as a substring, case-insensitive) in the
   * endpoint's guessed request fields, function name, or capability tags — weak,
   * suggestive only, never a confirmed binding (see module doc). */
  matchedBy: Array<"role" | "bind-keyword">;
  score: number;
}

const ROLE_MATCH_SCORE = 2;
const BIND_KEYWORD_SCORE = 1;

function textFieldsOf(endpoint: CanonicalEndpoint): string {
  return [...endpoint.requestFieldsGuess, ...endpoint.functions, ...endpoint.capabilities].join(" ").toLowerCase();
}

/**
 * Ranks candidate endpoints for a component's data needs. `role` is
 * typically the instance/list node's `role` (e.g. "card", "collections");
 * `binds` is typically its resolved `Component.binds`. Both optional —
 * pass whichever you have.
 */
export function matchCapabilities(
  index: CanonicalEndpoint[],
  input: { role?: string; binds?: string[] },
): CapabilityMatch[] {
  const matches: CapabilityMatch[] = [];
  for (const endpoint of index) {
    const matchedBy: Array<"role" | "bind-keyword"> = [];
    let score = 0;

    if (input.role && endpoint.roles.includes(input.role as CanonicalRole)) {
      matchedBy.push("role");
      score += ROLE_MATCH_SCORE;
    }

    if (input.binds?.length) {
      const haystack = textFieldsOf(endpoint);
      const hits = input.binds.filter((bind) => bind.length >= 3 && haystack.includes(bind.toLowerCase()));
      if (hits.length) {
        matchedBy.push("bind-keyword");
        score += hits.length * BIND_KEYWORD_SCORE;
      }
    }

    if (score > 0) matches.push({ endpoint, matchedBy, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}
