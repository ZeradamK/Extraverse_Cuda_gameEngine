// M2 acceptance: spawn at Earth (textured, Luna visible), dev-jump to Jupiter
// (textured + Galileans), Saturn (rings), Neptune (jitter probe), system map.
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
await page.waitForTimeout(2500); // textures stream in

const hud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);

await page.click('#app canvas');
await page.waitForTimeout(300);

await page.screenshot({ path: 'scripts/m2-earth.png' });
console.log('EARTH:', JSON.stringify(await hud()));

await page.keyboard.press('5'); // Jupiter
await page.waitForTimeout(1800);
await page.screenshot({ path: 'scripts/m2-jupiter.png' });
console.log('JUPITER:', JSON.stringify(await hud()));

await page.keyboard.press('6'); // Saturn
await page.waitForTimeout(1800);
await page.screenshot({ path: 'scripts/m2-saturn.png' });
console.log('SATURN:', JSON.stringify(await hud()));

await page.keyboard.press('8'); // Neptune — jitter probe: hold W, watch stability
await page.waitForTimeout(1200);
await page.keyboard.down('w');
await page.waitForTimeout(2000);
await page.keyboard.up('w');
await page.screenshot({ path: 'scripts/m2-neptune.png' });
console.log('NEPTUNE:', JSON.stringify(await hud()));

await page.keyboard.press('F2'); // system map
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/m2-map.png' });

console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
