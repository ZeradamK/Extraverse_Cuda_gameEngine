// M4 acceptance: Luna terrain — spawn ~10 km AGL, descend under thrust,
// terrain streams in (patch count grows), collision clamp stops at the deck,
// fps holds. Screenshots at orbit/approach/deck.
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
const altOf = t => {
  const m = t.match(/ALT ([\d.]+) (m|km) AGL/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'km' ? 1000 : 1);
};

await page.keyboard.press('9'); // Luna ~10 km
await page.waitForTimeout(2500); // patches stream
await page.screenshot({ path: 'scripts/m4-orbit.png' });
console.log('SPAWN:', JSON.stringify(await hud()));

// descend: hold W (spawn faces the planet)
await page.keyboard.down('w');
let lastAlt = Infinity;
let landed = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const t = await hud();
  const alt = altOf(t);
  if (alt !== null && alt < 2200 && lastAlt >= 2200) {
    await page.screenshot({ path: 'scripts/m4-approach.png' });
    console.log('APPROACH:', JSON.stringify(t));
  }
  if (alt !== null) lastAlt = alt;
  if (alt !== null && alt < 40) { landed = true; break; }
}
await page.keyboard.up('w');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/m4-deck.png' });
const deck = await hud();
console.log(`DECK (landed=${landed}):`, JSON.stringify(deck));

// hold W another 5 s — collision clamp must keep us above the surface
await page.keyboard.down('w');
await page.waitForTimeout(5000);
await page.keyboard.up('w');
const t2 = await hud();
const alt2 = altOf(t2);
console.log(`CLAMP TEST alt=${alt2}:`, alt2 !== null && alt2 > -5 ? 'PASS' : 'FAIL');
await page.screenshot({ path: 'scripts/m4-clamp.png' });

console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
