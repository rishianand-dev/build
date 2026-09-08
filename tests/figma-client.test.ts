import { afterEach, describe, expect, it, vi } from "vitest";
import { FigmaApiError, getFigmaImageFills, getFigmaNode, renderFigmaNodes } from "../src/build/figma-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFigmaNode", () => {
  it("fetches one node subtree and sends the auth header", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.figma.com/v1/files/abc123/nodes?ids=1%3A2");
      expect((init?.headers as Record<string, string>)["X-Figma-Token"]).toBe("secret-token");
      return new Response(
        JSON.stringify({ name: "Fixture", nodes: { "1:2": { document: { id: "1:2", name: "Frame", type: "FRAME" } } } }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const node = await getFigmaNode("abc123", "1:2", "secret-token");
    expect(node).toEqual({ id: "1:2", name: "Frame", type: "FRAME" });
  });

  it("throws FigmaApiError when the node id isn't in the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ name: "F", nodes: {} }), { status: 200 })),
    );
    await expect(getFigmaNode("abc123", "9:9", "token")).rejects.toBeInstanceOf(FigmaApiError);
  });

  it("throws FigmaApiError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(getFigmaNode("abc123", "1:1", "bad-token")).rejects.toMatchObject({ status: 403 });
  });

  it("throws FigmaApiError when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    await expect(getFigmaNode("abc123", "1:1", "token")).rejects.toBeInstanceOf(FigmaApiError);
  });
});

describe("getFigmaImageFills", () => {
  it("returns the fill imageRef -> URL map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ meta: { images: { "ref-1": "https://s3.example/a.png" } } }), { status: 200 }),
      ),
    );
    expect(await getFigmaImageFills("abc123", "token")).toEqual({ "ref-1": "https://s3.example/a.png" });
  });
});

describe("renderFigmaNodes", () => {
  it("returns rendered node URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/images/abc123?ids=1%3A1&format=png");
        return new Response(JSON.stringify({ err: null, images: { "1:1": "https://s3.example/render.png" } }), {
          status: 200,
        });
      }),
    );
    expect(await renderFigmaNodes("abc123", ["1:1"], "token")).toEqual({ "1:1": "https://s3.example/render.png" });
  });

  it("throws when Figma reports a render error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ err: "invalid node", images: {} }), { status: 200 })),
    );
    await expect(renderFigmaNodes("abc123", ["1:1"], "token")).rejects.toBeInstanceOf(FigmaApiError);
  });
});
