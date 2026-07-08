// M0 acceptance check: boots the app in headless Chrome (WebGPU), clicks launch,
// waits for the render loop, screenshots, and reports console errors + debug HUD text.
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'scripts/m0';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU',
    '--use-angle=metal',
    '--hide-scrollbars',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}-boot.png` });
await page.click('#boot');

// wait until the boot overlay hides (init complete) or an error is shown
try {
  await page.waitForSelector('#boot.hidden', { timeout: 60_000 });
} catch {
  const errText = await page.locator('#boot .err').textContent().catch(() => null);
  console.log('INIT FAILED:', errText ?? '(no error surfaced)');
}

await page.waitForTimeout(4500); // let TRAA/turntable settle + throttle swing high
const hud = await page.locator('#hud-debug').textContent();
await page.screenshot({ path: `${OUT}-render.png` });

// second shot ~1.6s later (other throttle phase)
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}-render2.png` });

console.log('HUD:', JSON.stringify(hud));
console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
