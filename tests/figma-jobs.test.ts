import { describe, expect, it } from "vitest";
import { parseFigmaInput } from "../src/server/jobs.js";

describe("parseFigmaInput", () => {
  it("parses a /design/ URL with a node-id query param", () => {
    expect(parseFigmaInput("https://www.figma.com/design/abc123/My-File?node-id=1-234")).toEqual({
      fileKey: "abc123",
      nodeId: "1:234",
    });
  });

  it("parses the older /file/ URL form", () => {
    expect(parseFigmaInput("https://www.figma.com/file/abc123/My-File?node-id=5-67")).toEqual({
      fileKey: "abc123",
      nodeId: "5:67",
    });
  });

  it("parses the fileKey:nodeId shorthand", () => {
    expect(parseFigmaInput("abc123:1:234")).toEqual({ fileKey: "abc123", nodeId: "1:234" });
  });

  it("throws for a URL missing node-id", () => {
    expect(() => parseFigmaInput("https://www.figma.com/design/abc123/My-File")).toThrow();
  });

  it("throws for an unrelated URL", () => {
    expect(() => parseFigmaInput("https://example.com/whatever")).toThrow();
  });

  it("throws for empty input", () => {
    expect(() => parseFigmaInput("")).toThrow();
    expect(() => parseFigmaInput("   ")).toThrow();
  });

  it("throws for shorthand with no nodeId", () => {
    expect(() => parseFigmaInput("abc123:")).toThrow();
    expect(() => parseFigmaInput("abc123")).toThrow();
  });
});
