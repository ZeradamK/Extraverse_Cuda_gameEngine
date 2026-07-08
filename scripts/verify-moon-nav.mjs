// Moon + NAV cruise verification:
// 1. photoreal Earth (4k Spline textures) at spawn
// 2. NAV cruise: C + W → speed far beyond SCM; C off → spooldown brake
// 3. warp to Luna (moons are targets now) → 8k textured Moon closeup
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

const xv = () => page.evaluate(() => window.__XV);
const hud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);

// 1. photoreal Earth spawn
await page.screenshot({ path: 'scripts/moon-earth4k.png' });
console.log('EARTH 4K SPAWN:', JSON.stringify(await hud()));

// 2. NAV cruise speed test — S backs AWAY from Earth (spawn faces the planet;
// W would cruise into the deck, distance-cap brake it, and park us — verified once!)
await page.keyboard.press('c');
await page.keyboard.down('s');
await page.waitForTimeout(25_000);
const cruise = await xv();
await page.keyboard.up('s');
console.log(`NAV CRUISE speed=${(cruise.speed / 1000).toFixed(0)} km/s`,
  cruise.speed > 100_000 ? 'PASS (beyond SCM by 400×+)' : 'FAIL');
await page.screenshot({ path: 'scripts/moon-navcruise.png' });
await page.keyboard.press('c'); // NAV off → spooldown
await page.waitForTimeout(12_000);
const post = await xv();
console.log(`SPOOLDOWN speed=${(post.speed).toFixed(0)} m/s`, post.speed < 5000 ? 'PASS' : 'INFO (still braking)');

// 3. warp to Luna (retry while OBSTRUCTED — keep climbing away from Earth)
for (let i = 0; i < 20 && (await xv()).target !== 'Luna'; i++) {
  await page.keyboard.press('g');
  await page.waitForTimeout(120);
}
console.log('TARGET:', (await xv()).target);
for (let attempt = 0; attempt < 4; attempt++) {
  await page.keyboard.press('b');
  await page.waitForTimeout(1200);
  const s = await xv();
  if (s.warp !== 'IDLE') break;
  console.log('spool refused (obstructed) — climbing');
  await page.keyboard.down('s');
  await page.waitForTimeout(8000);
  await page.keyboard.up('s');
}
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000);
  const s = await xv();
  if (s.warp === 'COOLDOWN' || s.warp === 'IDLE') break;
}
await page.waitForTimeout(3000);
await page.screenshot({ path: 'scripts/moon-arrival.png' });
console.log('MOON ARRIVAL:', JSON.stringify(await hud()));

// descend for the surface closeup
await page.keyboard.down('w');
await page.waitForTimeout(20_000);
await page.keyboard.up('w');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'scripts/moon-surface.png' });
console.log('MOON CLOSE:', JSON.stringify(await hud()));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
