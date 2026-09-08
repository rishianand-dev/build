import { capturePage, defaultCaptureDir } from "./capture/capture.js";

function printHelp(): void {
  console.log(`Usage:
  npm run capture -- <url> [--out <dir>] [--width 1440] [--height 900]

Captures a fully rendered page (DOM, computed styles, screenshots, scroll/hover
behavior) into PageCapture JSON. This is Phase 1 of the URL → builder pipeline.
`);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd !== "capture") {
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  const url = args[1];
  if (!url || url.startsWith("-")) {
    console.error("A URL is required.");
    printHelp();
    process.exit(1);
  }

  const out = argValue(args, "--out") ?? defaultCaptureDir(url);
  const width = Number(argValue(args, "--width") ?? 1440);
  const height = Number(argValue(args, "--height") ?? 900);

  console.log(`Capturing ${url}`);
  console.log(`Output    ${out}`);

  const result = await capturePage({
    url,
    outDir: out,
    viewport: { width, height },
  });

  console.log(`Title     ${result.title}`);
  console.log(`Final URL ${result.final_url}`);
  console.log(`Blocks    ${result.candidate_blocks.length}`);
  console.log(`Assets    ${result.assets.length}`);
  console.log(
    `Header    sticky=${result.header_behavior.sticky_or_fixed} fixed=${result.header_behavior.always_fixed_on_scroll} reappear=${result.header_behavior.reappear_on_scroll_up} conf=${result.header_behavior.confidence}`,
  );
  console.log(`Hovers    ${result.hover_reveals.length}`);
  if (result.warnings.length) {
    console.log("Warnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  console.log(`Wrote     ${out}/capture.json`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
