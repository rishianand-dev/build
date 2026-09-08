import { describe, expect, it } from "vitest";
import { normalizeEmail, validateCredentials } from "../src/server/auth.js";
import { HttpError } from "../src/server/captures.js";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
  });
});

describe("validateCredentials", () => {
  it("accepts a valid email and password", () => {
    expect(validateCredentials({ email: "A@B.com", password: "password1", name: " Ada " })).toEqual({
      email: "a@b.com",
      password: "password1",
      name: "Ada",
    });
  });

  it("rejects a short password", () => {
    expect(() => validateCredentials({ email: "a@b.com", password: "short" })).toThrow(HttpError);
  });

  it("rejects a missing email", () => {
    expect(() => validateCredentials({ password: "password1" })).toThrow(/email/i);
  });
});
