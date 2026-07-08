// M3 acceptance: Earth → Mars warp. Cycle target to Mars (G×4), engage (B),
// watch spool → tunnel → auto-drop. Track ETA + arrival distance + timing.
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#boot');
await page.waitForSelector('#boot.hidden', { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.click('#app canvas');
await page.waitForTimeout(300);

const hud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);

// target Mars: G cycles Mercury, Venus, Earth, Mars
for (let i = 0; i < 4; i++) { await page.keyboard.press('g'); await page.waitForTimeout(120); }
await page.keyboard.press('b'); // spool
const t0 = Date.now();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'scripts/m3-spool.png' });

await page.waitForTimeout(4000); // in warp by now
await page.screenshot({ path: 'scripts/m3-warp.png' });
console.log('WARP:', JSON.stringify(await hud()));

// poll until Mars is nearest & close (drop) or timeout 300s
let dropped = false;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(2000);
  const t = await hud();
  if (/Mars\s+(\d+\.?\d*)\s+Mm/.test(t)) {
    const mm = parseFloat(t.match(/Mars\s+(\d+\.?\d*)\s+Mm/)[1]);
    if (mm < 30) { dropped = true; break; }
  }
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/m3-arrival.png' });
console.log(`ARRIVAL after ~${elapsed}s, dropped=${dropped}:`, JSON.stringify(await hud()));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
