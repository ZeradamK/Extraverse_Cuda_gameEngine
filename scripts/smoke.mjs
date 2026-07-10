// GATING smoke test (audit fix: E2E must be able to FAIL the build).
// Asserts: boot, zero page errors, fps floor, thrust closes distance, M7 exit/
// board round-trip on Luna. Exit code 1 on any failure. Headed by default
// (headless WebGPU is flaky on this machine — DECISIONS 2026-07-07).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173';
const HEADLESS = process.env.SMOKE_HEADLESS === '1';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: HEADLESS,
  args: HEADLESS
    ? ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal']
    : ['--window-size=1610,950'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const xv = () => page.evaluate(() => window.__XV);

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#boot');
  await page.waitForSelector('#boot.hidden', { timeout: 90_000 });
  check('boot', true);
  await page.waitForTimeout(3000);
  await page.click('#app canvas');

  // fps floor at spawn (LANDED at SpaceX Vandenberg — real ETOPO Earth)
  await page.waitForTimeout(2000);
  const s0 = await xv();
  check('fps ≥ 50 at spawn', s0.fps >= 50, `${s0.fps} fps`);
  check('boot: landed on the California pad', s0.landedPin === true && s0.altAGL !== null && s0.altAGL < 100,
    `pin=${s0.landedPin} alt=${s0.altAGL === null ? 'n/a' : s0.altAGL.toFixed(0) + ' m'}`);

  // liftoff: R (up-thrust) climbs off the pad through the real atmosphere
  await page.keyboard.down('r');
  await page.waitForTimeout(12_000);
  await page.keyboard.up('r');
  const s1 = await xv();
  check('liftoff climbs', !s1.landedPin && s1.altAGL !== null && s1.altAGL > 500,
    `alt ${s1.altAGL === null ? 'n/a' : (s1.altAGL / 1e3).toFixed(2) + ' km'}`);

  // M7 round-trip on Luna: land (autoland), exit, walk, board
  await page.keyboard.press('9');
  await page.waitForTimeout(2500);
  // manual dive to ~2 km (autoland's 55 m/s cap would take 3+ min from 10 km)
  await page.keyboard.down('w');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const s = await xv();
    if (s.altAGL !== null && s.altAGL < 2500) break;
  }
  await page.keyboard.up('w');
  await page.keyboard.down('n');
  await page.waitForTimeout(1400);
  await page.keyboard.up('n');
  let landed = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const s = await xv();
    if (s.autoland === 'LANDED' && s.landedPin) { landed = true; break; }
  }
  check('autoland → LANDED (Luna)', landed);

  if (landed) {
    await page.keyboard.down('y');
    await page.waitForTimeout(1400);
    await page.keyboard.up('y');
    await page.waitForTimeout(800);
    let s = await xv();
    check('Y-hold → on foot', s.mode === 'foot');
    await page.screenshot({ path: 'scripts/smoke-onfoot.png' });

    // walk a few seconds (sprint) — footSpeed must register
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(3000);
    s = await xv();
    check('walking (sprint > 3 m/s)', (s.footSpeed ?? 0) > 3, `${(s.footSpeed ?? 0).toFixed(1)} m/s`);
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.screenshot({ path: 'scripts/smoke-walk.png' });

    // walk back toward the ship, then board
    await page.keyboard.down('s');
    await page.waitForTimeout(3500);
    await page.keyboard.up('s');
    await page.keyboard.press('f');
    await page.waitForTimeout(800);
    s = await xv();
    check('[F] board ship', s.mode === 'ship');
  }

  // M8/M10: hyperjump to another star (galaxy map → cycle → J → tunnel → arrive)
  await page.keyboard.press('m');
  await page.waitForTimeout(500);
  await page.keyboard.press(']');
  await page.waitForTimeout(300);
  await page.keyboard.press('j');
  let jumped = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const s = await xv();
    if (s.system && s.system !== 'Sol') { jumped = true; break; }
  }
  await page.waitForTimeout(2000);
  const sysAfter = await xv();
  check('hyperjump → new system', jumped, `now at ${sysAfter.system}`);
  check('procgen system has planets', (sysAfter.planetCount ?? 0) >= 2, `${sysAfter.planetCount} planets`);
  await page.screenshot({ path: 'scripts/smoke-hyperjump.png' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xv-save') ?? 'null'));
  check('save persisted after jump', !!saved && saved.starId !== -1);

  check('zero page errors', pageErrors.length === 0, pageErrors[0] ?? '');
} catch (e) {
  check('script completed', false, e.message.slice(0, 150));
} finally {
  await browser.close().catch(() => {});
}

if (failures.length) {
  console.error(`\nSMOKE FAILED: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nSMOKE PASSED');
}
