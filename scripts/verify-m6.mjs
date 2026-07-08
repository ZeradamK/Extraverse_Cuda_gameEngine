// M6 acceptance: sunrise over Earth from orbit — real continents below, blue
// atmosphere limb, city lights on the night side only, clouds. Plus a low pass.
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
await page.waitForTimeout(2500);
await page.click('#app canvas');
await page.waitForTimeout(300);

const hud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);
const xv = () => page.evaluate(() => window.__XV);

// --- the money shot: sunrise over Earth from orbit ---
await page.keyboard.press('=');
await page.waitForTimeout(6000); // terrain + clouds + atmosphere stream
await page.screenshot({ path: 'scripts/m6-sunrise.png' });
console.log('SUNRISE:', JSON.stringify(await hud()));

// pitch down slightly to frame the night side + city lights
await page.mouse.move(0, 300);
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/m6-nightside.png' });

// --- low pass: descend toward the surface (continents should be under us) ---
await page.keyboard.press('=');
await page.waitForTimeout(1000);
// pitch nose down toward the planet: autoland handles the descent instead
await page.keyboard.down('n');
await page.waitForTimeout(1400);
await page.keyboard.up('n');
let low = false;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000);
  const s = await xv();
  if (s.altAGL !== null && s.altAGL < 20_000) { low = true; break; }
}
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/m6-lowpass.png' });
console.log(`LOW PASS (reached<20km=${low}):`, JSON.stringify(await xv()));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
