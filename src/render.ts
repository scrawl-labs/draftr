// SVG -> PNG via headless Chromium (Playwright). Optional: everything else works without it.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function svgToPng(svg: string, { scale = 2 }: { scale?: number } = {}): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('PNG rendering needs Playwright (npm i -g playwright && npx playwright install chromium). SVG output works without it.');
  }
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  const width = m ? Number(m[1]) : 1200, height = m ? Number(m[2]) : 800;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    return await page.locator('svg').first().screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}
