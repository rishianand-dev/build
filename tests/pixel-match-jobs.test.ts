import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { emptyTheme } from "../src/schema/theme.js";
import { registerUser } from "../src/server/auth.js";
import { captureDir } from "../src/server/captures.js";
import { getPool } from "../src/server/db.js";
import { getPixelMatchRun, startPixelMatchRun } from "../src/server/pixel-match-jobs.js";
import { saveUserTheme } from "../src/server/themes.js";
import type { PageCapture } from "../src/types/page-capture.js";

const hasDb = Boolean(process.env["DATABASE_URL"]);

function fixtureTheme() {
  return emptyTheme({
    pages: [
      {
        id: "home",
        path: "/",
        root: { type: "stack", children: [{ type: "text", text: "Hello world", tag: "h1" }] },
      },
    ],
  });
}

function fixtureCapture(): PageCapture {
  return {
    schema_version: "1.0",
    url: "https://example.test/",
    final_url: "https://example.test/",
    captured_at: new Date().toISOString(),
    title: "Fixture",
    viewport: { width: 60, height: 60 },
    page_metrics: { scroll_width: 60, scroll_height: 60 },
    seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
    screenshots: { full_page: "screenshots/full-page.png", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
    assets: [],
    theme_hints: { background_color: "", text_color: "", fonts: [], color_palette: [], css_variables: {} },
    header_behavior: {
      sticky_or_fixed: false,
      lock_height_enable: false,
      always_fixed_on_scroll: false,
      reappear_on_scroll_up: false,
      document_flow: true,
      confidence: 0,
      evidence: [],
      probe: null,
    },
    hover_reveals: [],
    candidate_blocks: [],
    warnings: [],
    dom: {
      tag: "body",
      id: "",
      className: "",
      role: null,
      ariaLabel: null,
      text: "",
      box: { x: 0, y: 0, width: 60, height: 60 },
      style: {
        display: "block",
        position: "static",
        top: "auto",
        left: "auto",
        right: "auto",
        bottom: "auto",
        zIndex: "auto",
        overflow: "visible",
        opacity: "1",
        visibility: "visible",
        transform: "none",
        backgroundColor: "rgba(0,0,0,0)",
        backgroundImage: "none",
        color: "rgb(0,0,0)",
        fontFamily: "Georgia",
        fontSize: "16px",
        fontWeight: "400",
        lineHeight: "1.4",
        textAlign: "left",
        padding: "0",
        margin: "0",
        borderRadius: "0",
        boxShadow: "none",
        flexDirection: "row",
        justifyContent: "flex-start",
        alignItems: "stretch",
        gap: "0",
        gridTemplateColumns: "none",
      },
      children: [
        {
          tag: "section",
          id: "",
          className: "",
          role: null,
          ariaLabel: null,
          text: "",
          box: { x: 0, y: 0, width: 60, height: 60 },
          style: {
            display: "block",
            position: "static",
            top: "auto",
            left: "auto",
            right: "auto",
            bottom: "auto",
            zIndex: "auto",
            overflow: "visible",
            opacity: "1",
            visibility: "visible",
            transform: "none",
            backgroundColor: "rgba(0,0,0,0)",
            backgroundImage: "none",
            color: "rgb(0,0,0)",
            fontFamily: "Georgia",
            fontSize: "16px",
            fontWeight: "400",
            lineHeight: "1.4",
            textAlign: "left",
            padding: "0",
            margin: "0",
            borderRadius: "0",
            boxShadow: "none",
            flexDirection: "row",
            justifyContent: "flex-start",
            alignItems: "stretch",
            gap: "0",
            gridTemplateColumns: "none",
          },
          children: [
            {
              tag: "h1",
              id: "",
              className: "",
              role: null,
              ariaLabel: null,
              text: "Hello world",
              box: { x: 0, y: 0, width: 60, height: 20 },
              style: {
                display: "block",
                position: "static",
                top: "auto",
                left: "auto",
                right: "auto",
                bottom: "auto",
                zIndex: "auto",
                overflow: "visible",
                opacity: "1",
                visibility: "visible",
                transform: "none",
                backgroundColor: "rgba(0,0,0,0)",
                backgroundImage: "none",
                color: "rgb(0,0,0)",
                fontFamily: "Georgia",
                fontSize: "16px",
                fontWeight: "400",
                lineHeight: "1.4",
                textAlign: "left",
                padding: "0",
                margin: "0",
                borderRadius: "0",
                boxShadow: "none",
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "stretch",
                gap: "0",
                gridTemplateColumns: "none",
              },
              children: [],
            },
          ],
        },
      ],
    },
  };
}

async function waitForFinish(runId: string, userId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = getPixelMatchRun(runId, userId);
    if (run && (run.status === "done" || run.status === "error")) return run;
    if (Date.now() > deadline) throw new Error("pixel-match run did not finish in time");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!hasDb)("pixel-match background job", () => {
  it("runs to completion against a real (tiny) capture and returns iteration history", async () => {
    const stamp = Date.now();
    const { user } = await registerUser({
      email: `pixelmatch-test+${stamp}@example.com`,
      password: "testpass1",
      name: "Pixel Matcher",
    });
    const captureId = `pixelmatch-fixture-${stamp}`;
    const dir = captureDir(captureId);
    try {
      await mkdir(join(dir, "screenshots"), { recursive: true });
      const png = new PNG({ width: 60, height: 60 });
      png.data.fill(255);
      await writeFile(join(dir, "screenshots", "full-page.png"), PNG.sync.write(png));
      await writeFile(join(dir, "capture.json"), JSON.stringify(fixtureCapture()), "utf8");

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

      const started = startPixelMatchRun(captureId, user.id, { maxIterations: 1 });
      expect(started.status === "queued" || started.status === "running").toBe(true);

      const finished = await waitForFinish(started.id, user.id);
      expect(finished.status).toBe("done");
      expect(finished.history.length).toBeGreaterThanOrEqual(1);
      expect(finished.history[0]!.diffRatio).toBeGreaterThanOrEqual(0);

      // A user who doesn't own the run can't poll it.
      expect(getPixelMatchRun(started.id, "someone-else")).toBeUndefined();
    } finally {
      await getPool().query(`DELETE FROM users WHERE id = $1`, [user.id]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
