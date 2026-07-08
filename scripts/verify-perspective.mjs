// Perspective & reachability fixes:
// 1. spawn: Earth LOOMS (low orbit) — screenshot
// 2. thrust toward the planet CLOSES distance (frame-carry fix — was unreachable)
// 3. distant planets are glints, not fake discs — screenshot at Jupiter range
// 4. warp arrival: target grows from dot to dominating the view
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
await page.waitForSelector('#boot.hidden', { timeout: 90_000 });
await page.waitForTimeout(3000);
await page.click('#app canvas');
await page.waitForTimeout(300);

const hud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);
const earthDist = async () => {
  const t = await hud();
  const m = t.match(/Earth ([\d.]+) (km|Mm|Gm|m)\b/);
  if (!m) return null;
  const mult = { m: 1, km: 1e3, Mm: 1e6, Gm: 1e9 }[m[2]];
  return parseFloat(m[1]) * mult;
};

// 1. spawn framing
await page.screenshot({ path: 'scripts/persp-spawn.png' });
console.log('SPAWN:', JSON.stringify(await hud()));

// 2. reachability: hold W 10 s — Earth surface distance must DECREASE
const d0 = await earthDist();
await page.keyboard.down('w');
await page.waitForTimeout(10_000);
await page.keyboard.up('w');
const d1 = await earthDist();
console.log(`REACHABILITY: ${(d0 / 1e3).toFixed(0)} km -> ${(d1 / 1e3).toFixed(0)} km`,
  d1 < d0 - 1000 ? 'PASS (closing)' : 'FAIL (planet outruns ship)');

// 3. distant planets = glints: jump to Mercury (1), look outward — Jupiter/Saturn sub-pixel
await page.keyboard.press('1');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/persp-distant.png' });

// 4. warp arrival growth: from Mars-space, warp to EARTH (clear line of sight —
// warping to a target behind the local planet is now correctly OBSTRUCTED)
await page.keyboard.press('4'); // Mars, 6R sunward standoff
await page.waitForTimeout(1500);
const xvT = () => page.evaluate(() => window.__XV?.target);
for (let i = 0; i < 9 && (await xvT()) !== 'Earth'; i++) {
  await page.keyboard.press('g');
  await page.waitForTimeout(150);
}
console.log('TARGET:', await xvT());
await page.keyboard.press('b');
await page.waitForTimeout(45_000);
await page.screenshot({ path: 'scripts/persp-midwarp.png' });
const xv = () => page.evaluate(() => window.__XV);
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const s = await xv();
  if (s.warp === 'COOLDOWN' || s.warp === 'IDLE') break;
}
await page.waitForTimeout(2000);
await page.screenshot({ path: 'scripts/persp-arrival.png' });
console.log('ARRIVAL:', JSON.stringify(await hud()));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
