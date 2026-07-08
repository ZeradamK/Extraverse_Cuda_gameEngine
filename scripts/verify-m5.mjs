// M5 acceptance: (1) Mars sunset — butterscotch sky, blue glow at the sun;
// (2) reentry plasma on a 2.4 km/s dive; (3) autoland: N-hold → gear → dust →
// soft touchdown → LANDED pin; liftoff cancels.
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

// --- 1. Mars sunset ---
await page.keyboard.press('0');
await page.waitForTimeout(3500); // terrain + shell stream in; slight gravity fall is fine
await page.screenshot({ path: 'scripts/m5-sunset.png' });
console.log('SUNSET:', JSON.stringify(await hud()));

// --- 2. reentry plasma dive ---
await page.keyboard.press('-');
await page.waitForTimeout(9000); // 60 km @ ~1.9 km/s radial → deep atmosphere in ~7 s
await page.screenshot({ path: 'scripts/m5-plasma.png' });
console.log('PLASMA:', JSON.stringify(await hud()));

// --- 3. autoland from the sunset spot ---
await page.keyboard.press('v'); // back to coupled (entry demo decoupled us)
await page.keyboard.press('0');
await page.waitForTimeout(2000);
await page.keyboard.down('n');  // hold 1 s+ → autoland engage
await page.waitForTimeout(1400);
await page.keyboard.up('n');

const xv = () => page.evaluate(() => window.__XV);
let landed = false;
let sawFinal = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const s = await xv();
  if (s.autoland === 'FINAL' && !sawFinal) {
    sawFinal = true;
    await page.screenshot({ path: 'scripts/m5-final.png' });
    console.log('FINAL:', JSON.stringify(s));
  }
  if (s.autoland === 'LANDED' && s.landedPin) { landed = true; break; }
}
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/m5-landed.png' });
console.log(`LANDED=${landed}:`, JSON.stringify(await xv()));

// hold position ~5 s — LANDED pin must keep alt constant while Mars rails move
const a1 = await hud();
await page.waitForTimeout(5000);
const a2 = await hud();
console.log('PIN t0:', JSON.stringify(a1.split('\n')[4] ?? ''));
console.log('PIN t1:', JSON.stringify(a2.split('\n')[4] ?? ''));

// liftoff: thrust breaks the pin (Space = up)
await page.keyboard.down(' ');
await page.waitForTimeout(3000);
await page.keyboard.up(' ');
const lift = await xv();
console.log('LIFTOFF:', JSON.stringify(lift));
await page.screenshot({ path: 'scripts/m5-liftoff.png' });

console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
