// Observational verify: adaptive velocity + controls v2 + Moon visibility.
// 1. boot spawn frames Earth AND Luna, Luna pre-targeted; 2. warp Earth→Luna
// from low orbit (obstruction fix); 3. plain W at Luna reaches adaptive
// (distance-slaved) speeds ≫ the old 250 cap; 4. S damper-brakes to rest;
// 5. W+Space afterburner spools boost01 → VFX; 6. Luna surface close-up.
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const xv = () => page.evaluate(() => window.__XV);

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#boot');
  await page.waitForSelector('#boot.hidden', { timeout: 90_000 });
  await page.waitForTimeout(4000);
  await page.click('#app canvas');
  await page.waitForTimeout(1000);

  const s0 = await xv();
  check('boot + Luna pre-targeted', s0.target === 'Luna', `target=${s0.target}`);
  // game now boots LANDED at SpaceX Vandenberg — jump to the LEO framing (dev O)
  // for the orbital warp/boost checks below
  await page.keyboard.press('o');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'scripts/verify-spawn-earth-luna.png' });

  // warp to Luna from low Earth orbit (old code: permanently OBSTRUCTED here)
  await page.keyboard.press('b');
  await page.waitForTimeout(4500); // 3 s spool + align
  let s = await xv();
  check('warp engaged from low orbit', s.warp === 'WARP', `state=${s.warp}`);
  // well climb-out at V_MIN (~12 s) + two exponential legs ≈ 70–90 s
  let arrived = false;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    s = await xv();
    if (s.warp !== 'WARP' && s.target === 'Luna') { arrived = true; break; }
  }
  check('warp arrived at Luna', arrived, `warp=${s.warp}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'scripts/verify-luna-arrival.png' });

  // adaptive velocity: plain W (no NAV, no boost) must blow past the old 250 cap
  await page.keyboard.down('w');
  await page.waitForTimeout(5000);
  s = await xv();
  check('adaptive W speed ≫ 250 (>10 km/s)', s.speed > 10_000, `${(s.speed / 1000).toFixed(1)} km/s`);
  await page.keyboard.up('w');

  // S = damper-assisted brake back to rest
  await page.keyboard.down('s');
  await page.waitForTimeout(5000);
  await page.keyboard.up('s');
  s = await xv();
  check('S brake → rest (<100 m/s)', s.speed < 100, `${s.speed.toFixed(1)} m/s`);

  // afterburner: W+Space spools boost01 → VFX shell + speed rises again
  await page.keyboard.down('w');
  await page.keyboard.down(' ');
  await page.waitForTimeout(4000);
  s = await xv();
  check('afterburner spooled (boost01 > 0.95)', (s.boost ?? 0) > 0.95, `boost=${(s.boost ?? 0).toFixed(2)}`);
  check('afterburner speed (>5 km/s)', s.speed > 5_000, `${(s.speed / 1000).toFixed(1)} km/s`);
  await page.screenshot({ path: 'scripts/verify-boost-vfx.png' });
  await page.keyboard.up(' ');
  await page.keyboard.up('w');
  await page.keyboard.down('s');
  await page.waitForTimeout(5000);
  await page.keyboard.up('s');

  // close-up texture check: dev key 9 = Luna 1.06R (long wait: terrain streaming)
  await page.keyboard.press('9');
  await page.waitForTimeout(20_000);
  await page.screenshot({ path: 'scripts/verify-luna-surface.png' });

  check('zero page errors', pageErrors.length === 0, pageErrors[0] ?? '');
} catch (e) {
  check('script completed', false, e.message.slice(0, 150));
} finally {
  await browser.close().catch(() => {});
}

console.log(failures.length ? `\nVERIFY FAILED: ${failures.join(', ')}` : '\nVERIFY PASSED');
process.exitCode = failures.length ? 1 : 0;
