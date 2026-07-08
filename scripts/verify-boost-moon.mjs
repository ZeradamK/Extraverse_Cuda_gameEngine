// Observational verify: new control scheme + Moon visibility (2026-07-08).
// 1. spawn frames Earth AND Luna; 2. W+Space afterburner → 5× speed + boost01;
// 3. release Space (W held) → decel back to ~250; 4. S brake → ~0;
// 5. B at spawn → warp to Luna engages (obstruction fix) and arrives;
// 6. Luna close-up (texture drape). Screenshots to scripts/*.png.
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
  await page.screenshot({ path: 'scripts/verify-spawn-earth-luna.png' });

  // afterburner: W+Space → boost01 ~1, speed → ~1250
  await page.keyboard.down('w');
  await page.keyboard.down(' ');
  await page.waitForTimeout(9000);
  let s = await xv();
  check('afterburner spooled (boost01 > 0.95)', (s.boost ?? 0) > 0.95, `boost=${(s.boost ?? 0).toFixed(2)}`);
  check('afterburner speed ≈ 5× (>1100 m/s)', s.speed > 1100 && s.speed < 1300, `${s.speed.toFixed(0)} m/s`);
  await page.screenshot({ path: 'scripts/verify-boost-vfx.png' });

  // release Space, keep W → decel to the 250 cap
  await page.keyboard.up(' ');
  await page.waitForTimeout(8000);
  s = await xv();
  check('release → decel to SCM cap (240–260)', s.speed > 240 && s.speed < 260, `${s.speed.toFixed(0)} m/s`);

  // S brake → near zero
  await page.keyboard.up('w');
  await page.keyboard.down('s');
  await page.waitForTimeout(4000);
  await page.keyboard.up('s');
  s = await xv();
  check('S brake → stop (<5 m/s)', s.speed < 5, `${s.speed.toFixed(1)} m/s`);

  // warp to Luna from spawn orbit (old code: permanently OBSTRUCTED here)
  await page.keyboard.press('b');
  await page.waitForTimeout(4500); // 3 s spool + align
  s = await xv();
  check('warp engaged from low orbit', s.warp === 'WARP', `state=${s.warp}`);
  // well climb-out at V_MIN (~12 s) + two exponential legs ≈ 70–90 s
  let arrived = false;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    s = await xv();
    if (s.warp !== 'WARP' && s.target === 'Luna') { arrived = true; break; }
  }
  s = await xv();
  check('warp arrived at Luna', arrived, `warp=${s.warp} alt=${s.altAGL === null ? 'n/a' : (s.altAGL / 1e3).toFixed(0) + ' km'}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'scripts/verify-luna-arrival.png' });

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
