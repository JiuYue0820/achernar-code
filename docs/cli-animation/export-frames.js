'use strict';
// Render the animation frame by frame (no dropped frames), then encode with FFmpeg.
// Usage: node docs/cli-animation/export-frames.js [--fps 30] [--out <dir>] [--from ms] [--to ms] [--no-grain]
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function launch() {
  // Uses an installed Chrome or Edge; playwright-core does not ship a browser.
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel }); } catch { /* try next */ }
  }
  throw new Error('No Chrome or Edge found. Install one, or run `npx playwright install chromium`.');
}

async function main() {
  const fps = Number(option('fps', 30));
  const outDir = path.resolve(option('out', 'outputs/cli-animation/frames'));
  const from = Number(option('from', 0));
  const to = Number(option('to', 60000));
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('--fps must be between 1 and 120');
  await fs.mkdir(outDir, { recursive: true });

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href + '?export');
    await page.waitForFunction(() => window.achernarAnimation);
    if (process.argv.includes('--no-grain')) await page.evaluate(() => window.achernarAnimation.setGrain(false));

    const total = Math.floor(((to - from) / 1000) * fps);
    for (let i = 0; i <= total; i++) {
      const t = from + (i * 1000) / fps;
      await page.evaluate((ms) => window.achernarAnimation.render(ms), t);
      await page.screenshot({ path: path.join(outDir, `frame-${String(i).padStart(5, '0')}.png`) });
      if (i % fps === 0) process.stdout.write(`\r${(t / 1000).toFixed(0)}s / ${(to / 1000).toFixed(0)}s`);
    }
    process.stdout.write('\n');
    if (errors.length) throw new Error(`Page reported errors:\n${errors.join('\n')}`);
    console.log(`${total + 1} frames → ${outDir}`);
    console.log(`ffmpeg -framerate ${fps} -i "${path.join(outDir, 'frame-%05d.png')}" -c:v libx264 -pix_fmt yuv420p -crf 18 achernar-code.mp4`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
