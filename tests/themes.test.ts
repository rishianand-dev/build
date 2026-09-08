import { describe, expect, it } from "vitest";
import { emptyTheme } from "../src/schema/theme.js";
import { registerUser } from "../src/server/auth.js";
import { getPool } from "../src/server/db.js";
import { getUserTheme, listUserThemes, saveUserTheme, deleteUserTheme } from "../src/server/themes.js";

const hasDb = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!hasDb)("per-client themes", () => {
  it("stores a theme on one user and hides it from another", async () => {
    const stamp = Date.now();
    const a = await registerUser({
      email: `theme-test+a${stamp}@example.com`,
      password: "testpass1",
      name: "Client A",
    });
    const b = await registerUser({
      email: `theme-test+b${stamp}@example.com`,
      password: "testpass1",
      name: "Client B",
    });
    try {
      const theme = emptyTheme({
        site: { name: "Shop A", source: "https://a.example/" },
      });
      await saveUserTheme({
        userId: a.user.id,
        captureId: `shop-a-${stamp}`,
        url: "https://a.example/",
        finalUrl: "https://a.example/",
        title: "Shop A",
        theme,
        blocks: 3,
        assets: 2,
        warnings: 0,
        capturedAt: new Date().toISOString(),
      });

      const mine = await listUserThemes(a.user.id);
      const theirs = await listUserThemes(b.user.id);
      expect(mine.map((row) => row.capture_id)).toContain(`shop-a-${stamp}`);
      expect(theirs.map((row) => row.capture_id)).not.toContain(`shop-a-${stamp}`);
      expect(await getUserTheme(b.user.id, `shop-a-${stamp}`)).toBeNull();

      const loaded = await getUserTheme(a.user.id, `shop-a-${stamp}`);
      expect(loaded?.theme.site.name).toBe("Shop A");

      expect(await deleteUserTheme(b.user.id, `shop-a-${stamp}`)).toBe(false);
      expect(await getUserTheme(a.user.id, `shop-a-${stamp}`)).not.toBeNull();
      expect(await deleteUserTheme(a.user.id, `shop-a-${stamp}`)).toBe(true);
      expect(await getUserTheme(a.user.id, `shop-a-${stamp}`)).toBeNull();
    } finally {
      await getPool().query(`DELETE FROM users WHERE email LIKE $1`, [`theme-test+%${stamp}@example.com`]);
    }
  }, 30_000);
});
