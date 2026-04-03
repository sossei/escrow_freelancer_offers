#!/usr/bin/env node
/**
 * Converts a Playwright .webm video to an optimised .gif using ffmpeg.
 *
 * Usage:
 *   node scripts/video-to-gif.mjs <input.webm> [output.gif] [fps] [width]
 *
 * Examples:
 *   node scripts/video-to-gif.mjs test-results/tutorial/video.webm tutorial.gif
 *   node scripts/video-to-gif.mjs video.webm demo.gif 12 800
 *
 * Or via npm script:
 *   npm run gif -- test-results/tutorial-chromium/video.webm tutorial.gif
 *
 * Requires: ffmpeg installed (`brew install ffmpeg`)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const [, , input, output = "output.gif", fps = "15", width = "1280"] =
  process.argv;

if (!input) {
  console.error("Usage: node scripts/video-to-gif.mjs <input.webm> [output.gif] [fps] [width]");
  process.exit(1);
}

const inputPath = resolve(input);
const outputPath = resolve(output);

if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

// Check ffmpeg is available
try {
  execSync("ffmpeg -version", { stdio: "ignore" });
} catch {
  console.error(
    "ffmpeg not found. Install it with:\n  brew install ffmpeg\n  # or: sudo apt install ffmpeg"
  );
  process.exit(1);
}

console.log(`Converting ${inputPath} → ${outputPath}`);
console.log(`Settings: ${fps} fps, ${width}px wide`);

// Two-pass palette approach for best quality GIF
const paletteFilter = `fps=${fps},scale=${width}:-1:flags=lanczos`;
const cmd = [
  "ffmpeg -y",
  `-i "${inputPath}"`,
  `-vf "${paletteFilter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"`,
  `-loop 0`,
  `"${outputPath}"`,
].join(" ");

try {
  execSync(cmd, { stdio: "inherit" });
  console.log(`\nDone! GIF saved to: ${outputPath}`);
} catch {
  process.exit(1);
}
