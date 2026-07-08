// M1 acceptance: boot → pointer lock → thrust forward (W) 2.5 s → speed > 0,
// boost check, camera toggle, decouple drift check. Screenshots + console errors.
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
await page.waitForTimeout(1500);

// lock pointer (click canvas), then thrust forward
await page.click('#app canvas');
await page.waitForTimeout(300);

const readHud = () => page.evaluate(() => document.getElementById('hud-debug').textContent);

await page.keyboard.down('w');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/m1-thrust.png' });
const hudThrust = await readHud();
await page.keyboard.down('Shift');           // boost
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/m1-boost.png' });
await page.keyboard.up('Shift');
await page.keyboard.up('w');

// speed via page state: read from HUD debug line (pos changes) — sample positions 1s apart
const p1 = await readHud();
await page.waitForTimeout(1000);
const p2 = await readHud();

// camera toggle + cockpit screenshot
await page.keyboard.press('F4');
await page.waitForTimeout(800);
await page.screenshot({ path: 'scripts/m1-cockpit.png' });

// decoupled drift: V, cut thrust, turn — ship should keep moving
await page.keyboard.press('v');
await page.mouse.move(400, 0); // yaw reticle
await page.waitForTimeout(1000);
await page.screenshot({ path: 'scripts/m1-decoupled.png' });

console.log('HUD after thrust:', JSON.stringify(hudThrust));
console.log('pos t0:', JSON.stringify(p1.split('\n')[2]));
console.log('pos t1:', JSON.stringify(p2.split('\n')[2]));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
