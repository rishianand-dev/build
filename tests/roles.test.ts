import { describe, expect, it } from "vitest";
import { CANONICAL_ROLES, canonicalRole, roleFromCapabilityTag } from "../src/schema/roles.js";
import capabilityRegistry from "../data/capability-registry.json" with { type: "json" };

describe("roles", () => {
  it("recognizes every role actually emitted by from-capture.ts", () => {
    const emitted = [
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
    ];
    for (const role of emitted) {
      expect(canonicalRole(role)).toBe(role);
    }
  });

  it("returns undefined for a role outside the canonical vocabulary", () => {
    expect(canonicalRole("not-a-role")).toBeUndefined();
    expect(canonicalRole(undefined)).toBeUndefined();
  });

  it("maps every suggested_section_types value in the real capability registry to a canonical role", () => {
    const tags = new Set<string>();
    for (const entry of capabilityRegistry as Array<{ suggested_section_types?: string[] | string }>) {
      const v = entry.suggested_section_types;
      if (!v) continue;
      for (const t of Array.isArray(v) ? v : [v]) tags.add(t);
    }
    expect(tags.size).toBeGreaterThan(0);
    for (const tag of tags) {
      const role = roleFromCapabilityTag(tag);
      expect(role, `no alias for capability tag "${tag}"`).toBeDefined();
      expect(CANONICAL_ROLES).toContain(role);
    }
  });

  it("returns undefined for an unmapped capability tag", () => {
    expect(roleFromCapabilityTag("Nonexistent")).toBeUndefined();
  });
});
