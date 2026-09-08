import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCapabilityIndex,
  matchCapabilities,
  type CapabilityRegistryEntry,
} from "../src/build/capability-graph.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function registryFixture(entries: CapabilityRegistryEntry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capability-registry-"));
  cleanupDirs.push(dir);
  const path = join(dir, "registry.json");
  await writeFile(path, JSON.stringify(entries), "utf8");
  return path;
}

function entry(partial: Partial<CapabilityRegistryEntry> & { path: string; function: string }): CapabilityRegistryEntry {
  return {
    capability: [],
    suggested_section_types: [],
    service: "Svc",
    method: "POST",
    requires_auth: true,
    request_body_fields_guess: [],
    params_signature: "()",
    notes: "",
    ...partial,
  };
}

describe("buildCapabilityIndex (real registry)", () => {
  it("dedupes the real 174-entry registry down to 151 unique paths", () => {
    const index = buildCapabilityIndex();
    expect(index).toHaveLength(151);
  });

  it("merges distinct function names hitting the same path (the documented gotcha)", () => {
    const index = buildCapabilityIndex();
    const entitiesOne = index.find((e) => e.path === "/entities/one");
    expect(entitiesOne).toBeTruthy();
    expect(entitiesOne!.functions).toEqual(
      expect.arrayContaining(["getExperienceStore", "getOneEntity", "getStoreByEntityId"]),
    );
  });

  it("maps suggested_section_types through the roles.ts alias table", () => {
    const index = buildCapabilityIndex();
    const cms = index.find((e) => e.path === "/business-units/cms");
    expect(cms).toBeTruthy();
    // suggested_section_types includes "Collapsible"/"Feature"/"Title" -> collapsible/hero/info
    expect(cms!.roles).toEqual(expect.arrayContaining(["collapsible", "hero", "info"]));
  });
});

describe("buildCapabilityIndex (synthetic fixture)", () => {
  it("dedupes by path and unions fields across entries", async () => {
    const path = await registryFixture([
      entry({
        path: "/things/one",
        function: "getThingA",
        capability: ["get_thing"],
        request_body_fields_guess: ["id"],
      }),
      entry({
        path: "/things/one",
        function: "getThingB",
        capability: ["get_thing_alt"],
        request_body_fields_guess: ["slug"],
        requires_auth: false,
      }),
    ]);
    const index = buildCapabilityIndex(path);
    expect(index).toHaveLength(1);
    const [thing] = index;
    expect(thing!.functions).toEqual(["getThingA", "getThingB"]);
    expect(thing!.capabilities).toEqual(["get_thing", "get_thing_alt"]);
    expect(thing!.requestFieldsGuess).toEqual(["id", "slug"]);
    // one entry sharing the path doesn't require auth -> endpoint treated as reachable
    expect(thing!.requiresAuth).toBe(false);
  });
});

describe("matchCapabilities", () => {
  it("scores a role match higher than a bind-keyword-only match", async () => {
    const path = await registryFixture([
      entry({
        path: "/products/list",
        function: "listProducts",
        suggested_section_types: ["ProductCard"],
        request_body_fields_guess: ["page", "page_size"],
      }),
      entry({
        path: "/products/price-check",
        function: "checkPrice",
        request_body_fields_guess: ["product_id", "price"],
      }),
    ]);
    const index = buildCapabilityIndex(path);
    const matches = matchCapabilities(index, { role: "card", binds: ["price"] });

    expect(matches).toHaveLength(2);
    expect(matches[0]!.endpoint.path).toBe("/products/list");
    expect(matches[0]!.matchedBy).toEqual(["role"]);
    expect(matches[1]!.endpoint.path).toBe("/products/price-check");
    expect(matches[1]!.matchedBy).toEqual(["bind-keyword"]);
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it("combines role and bind-keyword scores when both match the same endpoint", async () => {
    const path = await registryFixture([
      entry({
        path: "/products/list",
        function: "listProducts",
        suggested_section_types: ["ProductCard"],
        request_body_fields_guess: ["price", "title"],
      }),
    ]);
    const index = buildCapabilityIndex(path);
    const matches = matchCapabilities(index, { role: "card", binds: ["price", "title"] });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedBy).toEqual(expect.arrayContaining(["role", "bind-keyword"]));
    expect(matches[0]!.score).toBe(2 + 2); // role(2) + two bind-keyword hits(1 each)
  });

  it("returns nothing for an input that matches no endpoint", async () => {
    const path = await registryFixture([entry({ path: "/things/one", function: "getThing" })]);
    const index = buildCapabilityIndex(path);
    expect(matchCapabilities(index, { role: "footer", binds: ["nonexistent"] })).toEqual([]);
  });

  it("ignores very short bind keys to avoid noisy substring matches", async () => {
    const path = await registryFixture([
      entry({ path: "/things/one", function: "getThing", request_body_fields_guess: ["id"] }),
    ]);
    const index = buildCapabilityIndex(path);
    // "id" as a bind key would trivially substring-match "id" in "getThing"/"id" itself —
    // the >=3 length guard exists specifically to keep 2-letter keys like this from
    // matching everything.
    expect(matchCapabilities(index, { binds: ["id"] })).toEqual([]);
  });
});
