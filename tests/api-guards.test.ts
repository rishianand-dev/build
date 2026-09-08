import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, assertCaptureId } from "../src/server/captures.js";
import { handleApi } from "../src/server/http.js";
import { parseHttpUrl } from "../src/server/jobs.js";

describe("parseHttpUrl", () => {
  it("adds https when the protocol is missing", () => {
    expect(parseHttpUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects non-http protocols", () => {
    expect(() => parseHttpUrl("file:///etc/passwd")).toThrow(/http/i);
  });
});

describe("assertCaptureId", () => {
  it("allows folder-style ids", () => {
    expect(assertCaptureId("example-com")).toBe("example-com");
  });

  it("rejects path traversal", () => {
    expect(() => assertCaptureId("../secret")).toThrow(HttpError);
  });
});

describe("auth guards", () => {
  it("rejects capture listing without a session", async () => {
    const req = {
      url: "/api/captures",
      method: "GET",
      headers: {},
    } as IncomingMessage;
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(payload?: string) {
        this.body = payload ?? "";
      },
      body: "",
    };
    const handled = await handleApi(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Sign in to continue" });
  });

  it("rejects deleting a capture without a session", async () => {
    const req = {
      url: "/api/captures/example-com",
      method: "DELETE",
      headers: {},
    } as IncomingMessage;
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(payload?: string) {
        this.body = payload ?? "";
      },
      body: "",
    };
    const handled = await handleApi(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
  });
});
