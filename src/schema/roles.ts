/**
 * Canonical `Role` vocabulary and the alias table that maps external
 * vocabularies onto it.
 *
 * `Role` itself (in theme.ts) stays an open string union — this file is
 * where we write down which strings are actually meaningful today, so
 * new producers (vision, Figma) and consumers (capability graph, golden
 * set) don't each invent their own spelling.
 */

import type { Role } from "./theme.js";

/** Roles emitted today by `src/build/from-capture.ts` (grepped, not guessed). */
export const EMITTED_ROLES = [
  "badge",
  "banner",
  "card",
  "carousel",
  "cart",
  "collections",
  "footer",
  "header",
  "hero",
  "info",
  "legal",
  "media",
  "more",
  "nav",
  "newsletter",
  "prices",
  "tile",
  "tools",
  "list",
] as const;

/**
 * Declared in theme.ts's `Role` type but not yet emitted by any builder,
 * plus a few new ones needed to represent section concepts from the old
 * brief / capability registry that don't map cleanly onto an emitted role.
 * Kept here (not silently dropped) so a future builder or the capability
 * graph has a canonical spelling to target instead of inventing one.
 */
export const RESERVED_ROLES = [
  "main",
  "form",
  "aside",
  "search",
  "compare",
  "specification",
  "collapsible",
  "filters",
] as const;

export const CANONICAL_ROLES = [...EMITTED_ROLES, ...RESERVED_ROLES] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

/**
 * Maps `data/capability-registry.json`'s `suggested_section_types`
 * vocabulary (old-brief section-type enum spelling) onto `CanonicalRole`.
 * Grepped from the actual registry, not the old brief's full enum, since
 * only these values appear on real entries.
 */
export const CAPABILITY_ROLE_ALIASES: Record<string, CanonicalRole> = {
  Best: "collections",
  Collapsible: "collapsible",
  Collections: "collections",
  "Collections (filter UI)": "filters",
  Compare: "compare",
  Feature: "hero",
  Form: "form",
  Grid: "tile",
  Logos: "media",
  Menu: "nav",
  News_letter: "newsletter",
  ProductCard: "card",
  Search: "search",
  Specification: "specification",
  Title: "info",
};

export function canonicalRole(role: Role | string | undefined): CanonicalRole | undefined {
  if (!role) return undefined;
  return (CANONICAL_ROLES as readonly string[]).includes(role)
    ? (role as CanonicalRole)
    : undefined;
}

export function roleFromCapabilityTag(tag: string | undefined): CanonicalRole | undefined {
  if (!tag) return undefined;
  return CAPABILITY_ROLE_ALIASES[tag];
}
