import { describe, expect, it } from "vitest";
import { emptyTheme } from "../src/schema/theme.js";
import { registerUser } from "../src/server/auth.js";
import { getPool } from "../src/server/db.js";
import { applyReviewAction } from "../src/server/review.js";
import { getUserTheme, saveUserTheme } from "../src/server/themes.js";
import { HttpError } from "../src/server/captures.js";

const hasDb = Boolean(process.env["DATABASE_URL"]);

function fixtureTheme() {
  return emptyTheme({
    pages: [
      {
        id: "home",
        path: "/",
        root: {
          type: "stack",
          children: [
            { type: "text", text: "Hello", tag: "h1", role: "hero" },
            { type: "text", text: "Bye", tag: "p" },
          ],
        },
      },
    ],
    review: [{ path: "/pages/0/root/children/0", reason: "vision: looks like a hero banner", confidence: 0.6 }],
  });
}

describe.skipIf(!hasDb)("applyReviewAction", () => {
  async function withUser<T>(fn: (userId: string, captureId: string) => Promise<T>): Promise<T> {
    const stamp = Date.now();
    const { user } = await registerUser({
      email: `review-test+${stamp}@example.com`,
      password: "testpass1",
      name: "Reviewer",
    });
    const captureId = `review-fixture-${stamp}`;
    try {
      await saveUserTheme({
        userId: user.id,
        captureId,
        url: "https://example.test/",
        finalUrl: "https://example.test/",
        title: "Fixture",
        theme: fixtureTheme(),
        blocks: 1,
        assets: 0,
        warnings: 0,
        capturedAt: new Date().toISOString(),
      });
      return await fn(user.id, captureId);
    } finally {
      await getPool().query(`DELETE FROM users WHERE id = $1`, [user.id]);
    }
  }

  it("accept: clears the review item, logs a correction, leaves the node untouched", async () => {
    await withUser(async (userId, captureId) => {
      const theme = await applyReviewAction(captureId, userId, {
        path: "/pages/0/root/children/0",
        action: "accept",
      });
      expect(theme.review).toEqual([]);
      const root = theme.pages[0]!.root;
      if (root.type !== "stack") throw new Error("expected stack");
      expect(root.children[0]).toMatchObject({ text: "Hello", role: "hero" });

      const { rows } = await getPool().query(
        `SELECT action, detector, predicted_role, corrected_snapshot FROM corrections WHERE user_id = $1`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("accept");
      expect(rows[0].detector).toBe("vision");
      expect(rows[0].predicted_role).toBe("hero");
      expect(rows[0].corrected_snapshot).toBeNull();
    });
  }, 30_000);

  it("edit: applies the role/text patch, persists it, and logs predicted vs corrected", async () => {
    await withUser(async (userId, captureId) => {
      const theme = await applyReviewAction(captureId, userId, {
        path: "/pages/0/root/children/0",
        action: "edit",
        role: "newsletter",
        text: "Corrected heading",
      });
      const root = theme.pages[0]!.root;
      if (root.type !== "stack") throw new Error("expected stack");
      expect(root.children[0]).toMatchObject({ role: "newsletter", text: "Corrected heading" });
      expect(theme.review).toEqual([]);

      const reloaded = await getUserTheme(userId, captureId);
      const reloadedRoot = reloaded!.theme.pages[0]!.root;
      if (reloadedRoot.type !== "stack") throw new Error("expected stack");
      expect(reloadedRoot.children[0]).toMatchObject({ role: "newsletter", text: "Corrected heading" });

      const { rows } = await getPool().query(
        `SELECT action, predicted_role, corrected_snapshot FROM corrections WHERE user_id = $1`,
        [userId],
      );
      expect(rows[0].action).toBe("edit");
      expect(rows[0].predicted_role).toBe("hero");
      expect(rows[0].corrected_snapshot).toMatchObject({ role: "newsletter", text: "Corrected heading" });
    });
  }, 30_000);

  it("reject: removes the node from its parent and logs the deletion", async () => {
    await withUser(async (userId, captureId) => {
      const theme = await applyReviewAction(captureId, userId, {
        path: "/pages/0/root/children/0",
        action: "reject",
      });
      const root = theme.pages[0]!.root;
      if (root.type !== "stack") throw new Error("expected stack");
      expect(root.children).toHaveLength(1);
      expect(root.children[0]).toMatchObject({ text: "Bye" });

      const { rows } = await getPool().query(`SELECT action FROM corrections WHERE user_id = $1`, [userId]);
      expect(rows[0].action).toBe("reject");
    });
  }, 30_000);

  it("rejects editing text on a node type that has no text field", async () => {
    await withUser(async (userId, captureId) => {
      await expect(
        applyReviewAction(captureId, userId, {
          path: "/pages/0/root",
          action: "edit",
          text: "nope",
        }),
      ).rejects.toBeInstanceOf(HttpError);
    });
  }, 30_000);

  it("404s when reject/edit target a path that doesn't resolve to a node", async () => {
    await withUser(async (userId, captureId) => {
      await expect(
        applyReviewAction(captureId, userId, { path: "/pages/0/root/children/99", action: "reject" }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        applyReviewAction(captureId, userId, { path: "/pages/0/root/children/99", action: "edit", role: "x" }),
      ).rejects.toMatchObject({ status: 404 });
    });
  }, 30_000);

  it("accept still works for a pipeline-level ReviewItem whose path isn't a real node (e.g. 'No header element')", async () => {
    const stamp = Date.now();
    const { user } = await registerUser({
      email: `review-test+${stamp}@example.com`,
      password: "testpass1",
      name: "Reviewer",
    });
    const captureId = `review-fixture-${stamp}`;
    try {
      const theme = fixtureTheme();
      theme.review.push({ path: "/pages/0/header", reason: "No header element", confidence: 0.2 });
      await saveUserTheme({
        userId: user.id,
        captureId,
        url: "https://example.test/",
        finalUrl: "https://example.test/",
        title: "Fixture",
        theme,
        blocks: 1,
        assets: 0,
        warnings: 0,
        capturedAt: new Date().toISOString(),
      });

      const result = await applyReviewAction(captureId, user.id, { path: "/pages/0/header", action: "accept" });
      expect(result.review.find((r) => r.path === "/pages/0/header")).toBeUndefined();

      const { rows } = await getPool().query(
        `SELECT action, predicted_snapshot FROM corrections WHERE user_id = $1`,
        [user.id],
      );
      expect(rows[0].action).toBe("accept");
      expect(rows[0].predicted_snapshot).toMatchObject({ unresolved: true });
    } finally {
      await getPool().query(`DELETE FROM users WHERE id = $1`, [user.id]);
    }
  }, 30_000);
});
