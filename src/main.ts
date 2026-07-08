/**
 * EXTRAVERSE — M2 Sol on rails.
 * f64 world coords + camera-relative rendering (ship pinned at render origin),
 * all planets/moons on Kepler rails at 1/10 scale, physical sun falloff +
 * eclipses, far-shell textured proxies, system map (F2), dev jumps (1–9).
 * Acceptance (§17): cruise past textured Jupiter; no jitter at Neptune.
 */
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { loadShip } from './engine/assets/shipLoader';
import { createPostFX } from './engine/render/postfx';
import { CameraRig } from './engine/render/cameraRig';
import { FarShell } from './engine/render/farShell';
import { InputSystem } from './engine/core/input';
import { ShipFlight } from './game/systems/flight';
import { SolSystem } from './game/systems/solSystem';
import { WarpDrive } from './game/systems/warpDrive';
import { Autoland } from './game/systems/autoland';
import {
  density, dragAccel, dynamicPressure, gravityAccel, spaceAltitude, suttonGraves,
  PLASMA_FULL_W_M2, PLASMA_START_W_M2,
} from './game/systems/environment';
import { PlanetTerrain } from './game/terrain/planetTerrain';
import { loadEarthLandMask } from './game/terrain/landMask';
import { AtmosphereShell } from './engine/render/atmosphere';
import { CloudLayer } from './game/vfx/cloudLayer';
import { LandingGear } from './game/vfx/landingGear';
import { Dust } from './game/vfx/dust';
import { ReentryGlow } from './game/vfx/reentryGlow';
import type { PlanetDef } from './data/solarSystem';
import { Exhaust } from './game/vfx/exhaust';
import { WarpTunnel } from './game/vfx/warpTunnel';
import { createStarfield } from './game/vfx/starfield';
import { Hud } from './ui/hud';
import { SystemMap } from './ui/systemMap';
import { SUN } from './data/constants';
import { AU_M, SYSTEM_SCALE } from './data/solarSystem';

const DT = 1 / 60;
const ZERO = new THREE.Vector3();

const boot = document.getElementById('boot')!;
const bootStatus = document.getElementById('boot-status')!;
const debugEl = document.getElementById('hud-debug')!;

boot.addEventListener('click', () => {
  boot.style.cursor = 'default';
  bootStatus.textContent = 'Initializing renderer…';
  init().catch(err => {
    console.error(err);
    bootStatus.textContent = '';
    const pre = document.createElement('p');
    pre.className = 'err';
    pre.textContent = `Failed to start:\n${err?.message ?? err}`;
    boot.appendChild(pre);
  });
}, { once: true });

async function init(): Promise<void> {
  // antialias OFF: TRAA is the AA (MSAA depth can't be resolved for the TRAA/AO passes)
  const renderer = new THREE.WebGPURenderer({ antialias: false, reversedDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app')!.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend.constructor.name.includes('WebGPU')) ? 'WebGPU' : 'WebGL2 (fallback)';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);

  bootStatus.textContent = 'Loading environment…';
  const hdr = await new HDRLoader().loadAsync('/env/satara_night_no_lamps_2k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr; // reflections only (real galaxy skybox lands M8)
  scene.environmentIntensity = 0.35;

  // --- the system on rails ---
  const sys = new SolSystem(Date.now());
  const shell = new FarShell(sys.bodies);
  scene.add(shell.group);

  // --- landable terrain (M4: Luna + Mars; M6: Earth with real continents) ---
  bootStatus.textContent = 'Building Earth…';
  const luna = sys.bodies.find(b => b.name === 'Luna')!;
  const mars = sys.planets[3];
  const earthBody = sys.planets[2];
  const earthMask = await loadEarthLandMask('/textures/planets/2k_earth_daymap.jpg');
  const terrains = [
    // Luna: real 8k albedo draped over the crater heightfield
    new PlanetTerrain(luna, 'luna', 20260706, 0xffffff, {
      realDayTexture: '/textures/planets/8k_moon.jpg',
    }),
    new PlanetTerrain(mars, 'mars', 19570104, 0xb4653f),
    new PlanetTerrain(earthBody, 'earth', 19690720, 0xffffff, {
      realDayTexture: '/textures/planets/2k_earth_daymap.jpg',
      realNightTexture: '/textures/planets/2k_earth_nightmap.jpg',
      ocean: true,
      mask: earthMask,
    }),
  ];
  for (const t of terrains) scene.add(t.group);
  const clouds = new CloudLayer(earthBody, '/textures/planets/2k_earth_clouds.jpg');
  scene.add(clouds.mesh);

  // atmosphere shells (§8.3) for every body with an AtmoDef
  const atmospheres = sys.planets
    .filter(p => (p.def as PlanetDef).atmo)
    .map(p => new AtmosphereShell(p, (p.def as PlanetDef).atmo!));
  for (const a of atmospheres) scene.add(a.mesh);

  const stars = createStarfield();
  scene.add(stars);

  // debug bisect: ?hide=exhaust,stars,shell,atmo,tunnel,dust,glow,gear,terrain
  const hidden = new Set((new URLSearchParams(location.search).get('hide') ?? '').split(','));
  if (hidden.has('stars')) stars.visible = false;
  if (hidden.has('shell')) shell.group.visible = false;
  if (hidden.has('terrain')) for (const t of terrains) t.group.visible = false;
  if (hidden.has('atmo')) for (const a of atmospheres) a.mesh.visible = false;

  // sun light: direction + intensity computed per frame from real geometry
  const sun = new THREE.DirectionalLight(SUN.COLOR, 8.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -2e-4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x334a66, 0.35);
  scene.add(fill, fill.target);

  bootStatus.textContent = 'Loading GRIDCORP drone…';
  const ship = await loadShip();
  const shipRoot = new THREE.Group(); // pinned at render origin — world moves around it
  shipRoot.add(ship.object);
  const exhaust = new Exhaust();
  shipRoot.add(exhaust.group);
  const gear = new LandingGear();
  shipRoot.add(gear.group);
  const glow = new ReentryGlow();
  shipRoot.add(glow.mesh);
  scene.add(shipRoot);
  const dust = new Dust();
  scene.add(dust.group);

  const rig = new CameraRig(window.innerWidth / window.innerHeight);
  const postfx = createPostFX(renderer, scene, rig.camera);
  const input = new InputSystem(renderer.domElement);
  const flight = new ShipFlight();
  const autoland = new Autoland();
  const warp = new WarpDrive(sys, flight);
  const tunnel = new WarpTunnel();
  scene.add(tunnel.object);
  const hud = new Hud(document.body);
  const map = new SystemMap(document.body);

  // spawn: LOW Earth orbit on the dayside — the planet LOOMS (fills half the
  // sky at 0.45R altitude), Star Citizen style. Scale reads instantly.
  const earth = sys.planets[2];
  spawnAt(earth.posM, earth.radiusM * 1.45);
  warp.target = earth; // pre-targeted: B warps, G cycles

  /** Mars terminator, 4 km AGL, nose at the setting sun — the M5 money shot */
  function spawnMarsSunset(): void {
    const sunward = new THREE.Vector3(-mars.posM.x, -mars.posM.y, -mars.posM.z).normalize();
    const tangent = new THREE.Vector3().crossVectors(sunward, new THREE.Vector3(0, 1, 0)).normalize();
    const r = mars.radiusM + 4000;
    flight.curr.pos.set(
      mars.posM.x + tangent.x * r, mars.posM.y + tangent.y * r, mars.posM.z + tangent.z * r);
    flight.curr.vel.set(0, 0, 0);
    const m = new THREE.Matrix4().lookAt(flight.curr.pos, new THREE.Vector3(0, 0, 0), tangent);
    flight.curr.quat.setFromRotationMatrix(m);
    flight.curr.omega.set(0, 0, 0);
    flight.prev.pos.copy(flight.curr.pos);
    flight.prev.quat.copy(flight.curr.quat);
    flight.prev.vel.copy(flight.curr.vel);
  }

  /** Earth low orbit, night side just past the terminator, nose at the rising sun limb */
  function spawnEarthSunrise(): void {
    const b = earthBody;
    const sunward = new THREE.Vector3(-b.posM.x, -b.posM.y, -b.posM.z).normalize();
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunward).normalize();
    // 105° from the subsolar point (just into night), 0.35R altitude
    const dir = new THREE.Vector3().copy(sunward).multiplyScalar(Math.cos(THREE.MathUtils.degToRad(105)))
      .addScaledVector(east, Math.sin(THREE.MathUtils.degToRad(105)));
    const r = b.radiusM * 1.35;
    flight.curr.pos.set(b.posM.x + dir.x * r, b.posM.y + dir.y * r, b.posM.z + dir.z * r);
    flight.curr.vel.set(0, 0, 0);
    // face the sun limb: look toward a point on the horizon in the sun direction
    tmp.set(b.posM.x + sunward.x * b.radiusM, b.posM.y + sunward.y * b.radiusM, b.posM.z + sunward.z * b.radiusM);
    const m = new THREE.Matrix4().lookAt(flight.curr.pos, tmp, dir);
    flight.curr.quat.setFromRotationMatrix(m);
    flight.curr.omega.set(0, 0, 0);
    flight.prev.pos.copy(flight.curr.pos);
    flight.prev.quat.copy(flight.curr.quat);
    flight.prev.vel.copy(flight.curr.vel);
  }

  /** Mars entry demo: 60 km up, ~2.4 km/s oblique dive — plasma within seconds */
  function spawnMarsEntry(): void {
    spawnAt(mars.posM, mars.radiusM + 60_000);
    flight.decoupled = true; // keep the dive Newtonian; FA would brake it
    const inward = new THREE.Vector3(
      mars.posM.x - flight.curr.pos.x, mars.posM.y - flight.curr.pos.y, mars.posM.z - flight.curr.pos.z).normalize();
    const across = new THREE.Vector3().crossVectors(inward, new THREE.Vector3(0, 1, 0)).normalize();
    flight.curr.vel.copy(inward).multiplyScalar(1900).addScaledVector(across, 1400);
    flight.prev.vel.copy(flight.curr.vel);
  }

  function spawnAt(target: { x: number; y: number; z: number }, standoffM: number): void {
    const toSun = new THREE.Vector3(-target.x, -target.y, -target.z).normalize();
    flight.curr.pos.set(target.x, target.y, target.z).addScaledVector(toSun, standoffM);
    flight.curr.vel.set(0, 0, 0);
    const m = new THREE.Matrix4().lookAt(flight.curr.pos, new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(0, 1, 0));
    flight.curr.quat.setFromRotationMatrix(m);
    flight.curr.omega.set(0, 0, 0);
    flight.prev.pos.copy(flight.curr.pos);
    flight.prev.quat.copy(flight.curr.quat);
    flight.prev.vel.copy(flight.curr.vel);
    flight.prev.omega.copy(flight.curr.omega);
  }

  renderer.domElement.addEventListener('click', () => void input.lock());
  window.addEventListener('resize', () => {
    rig.camera.aspect = window.innerWidth / window.innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- loop ---
  let acc = 0;
  let tick = 0;
  let last = performance.now();
  let fps = 60;
  let frames = 0;
  let gearRequested = false;
  let nHeldTicks = 0;
  let heatFlux = 0;          // W/m², smoothed
  let landedPin = false;
  let lastDust = 0;
  let inAtmo = false;        // below the body's Kármán-analog line
  const renderPos = new THREE.Vector3();   // f64 world (JS numbers)
  const renderQuat = new THREE.Quaternion();
  const camPosM = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const extAccel = new THREE.Vector3();
  const vHoriz = new THREE.Vector3();

  /** nearest body + radial data for the physics tick (f64) */
  function nearestBody() {
    let best: typeof sys.bodies[number] | null = null;
    let bd = Infinity;
    for (const b of sys.bodies) {
      if (b.kind === 'star') continue;
      const d = Math.hypot(
        b.posM.x - flight.curr.pos.x, b.posM.y - flight.curr.pos.y, b.posM.z - flight.curr.pos.z);
      if (d - b.radiusM < bd) { bd = d - b.radiusM; best = b; }
    }
    return best;
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtReal = Math.min((now - last) / 1000, 0.25);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dtReal, 1e-4)) * 0.05;

    acc += dtReal;
    let warpOwns = warp.state === 'WARP';
    while (acc >= DT) {
      const recenter = flight.flightAssist && !input.hasMouseInput;
      const intent = input.sample(tick++, DT, recenter);
      if (intent.pressed.has('camera.toggleChase')) rig.toggle();
      if (intent.pressed.has('ship.cycleTarget')) warp.cycleTarget();
      if (intent.pressed.has('ship.warpEngage')) warp.requestSpool();
      if (intent.codes.has('F2')) map.toggle();
      for (let d = 1; d <= 8; d++) {
        if (intent.codes.has(`Digit${d}`)) spawnAt(sys.planets[d - 1].posM, sys.planets[d - 1].radiusM * 6);
      }
      if (intent.codes.has('Digit9')) spawnAt(luna.posM, luna.radiusM * 1.06); // Luna, ~10 km AGL
      if (intent.codes.has('Digit0')) spawnMarsSunset();
      if (intent.codes.has('Minus')) spawnMarsEntry();
      if (intent.codes.has('Equal')) spawnEarthSunrise();

      // gear tap / autoland hold (N)
      if (intent.pressed.has('ship.gearToggle')) gearRequested = !gearRequested;
      nHeldTicks = intent.held.has('ship.gearToggle') ? nHeldTicks + 1 : 0;
      if (nHeldTicks === 60) autoland.engage(); // 1 s hold

      // any translation input cancels autoland / lifts off
      const translating =
        (intent.axes['ship.strafeX'] ?? 0) !== 0 ||
        (intent.axes['ship.strafeY'] ?? 0) !== 0 ||
        (intent.axes['ship.strafeZ'] ?? 0) !== 0;
      if (translating && autoland.state !== 'IDLE') {
        autoland.cancel();
        landedPin = false;
      }

      // --- environmental physics (§9.3): gravity + drag + autoland, body-local ---
      extAccel.set(0, 0, 0);
      lastDust = 0;
      const body = nearestBody();
      let qDyn = 0;
      let rawHeat = 0;
      if (body && warp.state !== 'WARP') {
        radial.set(
          flight.curr.pos.x - body.posM.x,
          flight.curr.pos.y - body.posM.y,
          flight.curr.pos.z - body.posM.z);
        const dCenter = radial.length();
        radial.divideScalar(dCenter);
        // gravity inside the local zone
        const def = body.def as PlanetDef; // MoonDef also satisfies gmKm3S2/atmo access
        if (dCenter < body.radiusM * 20) {
          extAccel.addScaledVector(radial, -gravityAccel(def.gmKm3S2, dCenter));
        }
        // atmosphere
        const altDatum = dCenter - body.radiusM;
        const nowInAtmo = !!def.atmo && altDatum < spaceAltitude(def.atmo);
        if (nowInAtmo && !inAtmo && flight.speed > 250) {
          rig.trauma = Math.max(rig.trauma, 0.35); // ENTRY INTERFACE buffet (§10 beat)
        }
        inAtmo = nowInAtmo;
        if (def.atmo && altDatum < def.atmo.topM) {
          const rho = density(def.atmo, altDatum);
          const speed = flight.curr.vel.length(); // frame-carried → body-relative
          if (speed > 1 && rho > 1e-9) {
            const aDrag = Math.min(dragAccel(rho, speed, 6, 50_000), 80);
            extAccel.addScaledVector(tmp.copy(flight.curr.vel).divideScalar(speed), -aDrag);
            qDyn = dynamicPressure(rho, speed);
            rawHeat = suttonGraves(rho, speed);
          }
        }
        // autoland command (radial frame → world)
        const terrain = terrains.find(t => t.body === body);
        const altAGL = terrain
          ? dCenter - terrain.surfaceRadiusAt(radial)
          : altDatum;
        const vR = flight.curr.vel.dot(radial);
        vHoriz.copy(flight.curr.vel).addScaledVector(radial, -vR);
        const cmd = autoland.step(DT, {
          altAGL: altAGL - 7.0, // gear plane sits ~7 m below CoM
          vRadial: vR,
          vHorizX: vHoriz.x, vHorizY: vHoriz.y, vHorizZ: vHoriz.z,
          gravity: gravityAccel(def.gmKm3S2, dCenter),
          maxAccel: 45,
        });
        extAccel.addScaledVector(radial, cmd.aRadial);
        extAccel.x += cmd.aHorizX;
        extAccel.y += cmd.aHorizY;
        extAccel.z += cmd.aHorizZ;
        lastDust = cmd.dust;
        if (cmd.landedNow) {
          landedPin = true;
          rig.trauma = Math.max(rig.trauma, 0.3);
          gear.update(DT, true, 1);
        }
        if (autoland.state === 'FINAL' || autoland.state === 'LANDED') gearRequested = true;
      }
      heatFlux += (rawHeat - heatFlux) * Math.min(1, 4 * DT);
      if (qDyn > 5000) rig.trauma = Math.max(rig.trauma, Math.min(0.45, qDyn / 60_000));

      // NAV safety ceiling: distance-slaved to the nearest surface (never cruise into a planet)
      let navCap = Infinity;
      if (body) {
        const dSurf = Math.hypot(
          body.posM.x - flight.curr.pos.x,
          body.posM.y - flight.curr.pos.y,
          body.posM.z - flight.curr.pos.z) - body.radiusM;
        navCap = Math.max(250, dSurf / 4);
      }
      flight.step(DT, intent, {
        steerScale: warp.steerScale,
        skipTranslation: warpOwns,
        externalAccel: extAccel,
        suppressAssist: autoland.state === 'DESCEND' || autoland.state === 'FINAL',
        navCap,
      });
      // LANDED: pin to the surface (rest on gear); thrust breaks the pin
      if (landedPin && body) {
        if (translating) {
          landedPin = false;
        } else {
          flight.curr.vel.set(0, 0, 0);
          const terrain = terrains.find(t => t.body === body);
          if (terrain) {
            const surf = terrain.surfaceRadiusAt(radial) + 7.0;
            flight.curr.pos.set(
              body.posM.x + radial.x * surf,
              body.posM.y + radial.y * surf,
              body.posM.z + radial.z * surf);
          }
        }
      }
      warpOwns = warp.step(DT);

      // terrain collision clamp: never let the ship penetrate the surface.
      // (skipped while warp owns translation — the drive's mass-lock handles bodies)
      for (const t of terrains) {
        if (warpOwns || !t.active) continue;
        const b = t.body;
        const rx = flight.curr.pos.x - b.posM.x;
        const ry = flight.curr.pos.y - b.posM.y;
        const rz = flight.curr.pos.z - b.posM.z;
        const d = Math.hypot(rx, ry, rz);
        if (d > b.radiusM * 1.5) continue;
        tmp.set(rx / d, ry / d, rz / d);
        const surf = t.surfaceRadiusAt(tmp) + 7.0; // CoM height with gear on the deck
        if (d < surf) {
          flight.curr.pos.set(
            b.posM.x + tmp.x * surf, b.posM.y + tmp.y * surf, b.posM.z + tmp.z * surf);
          const vr = flight.curr.vel.dot(tmp);
          if (vr < 0) {
            flight.curr.vel.addScaledVector(tmp, -vr); // kill inward radial velocity
            rig.trauma = Math.max(rig.trauma, Math.min(0.6, -vr / 60));
          }
        }
      }
      acc -= DT;
    }
    sys.update(dtReal); // rails are analytic — real-rate epoch advance

    // local-frame carry (§9.6): near a body, the ship rides the body's frame.
    // Zone = 60 radii: outside it a planet's ~3 km/s rail motion OUTRUNS the
    // 250 m/s thruster cap and the planet is literally unreachable — warp is
    // how you cross interplanetary space, normal flight lives in the body frame.
    if (warp.state !== 'WARP') {
      let carrier: typeof sys.bodies[number] | null = null;
      let best = Infinity;
      for (const b of sys.bodies) {
        if (b.kind === 'star') continue;
        const d = Math.hypot(
          b.posM.x - flight.curr.pos.x, b.posM.y - flight.curr.pos.y, b.posM.z - flight.curr.pos.z);
        if (d < b.radiusM * 60 && d < best) { best = d; carrier = b; }
      }
      if (carrier) {
        for (const s of [flight.curr.pos, flight.prev.pos]) {
          s.x += carrier.deltaM.x;
          s.y += carrier.deltaM.y;
          s.z += carrier.deltaM.z;
        }
      }
    }

    // interpolate sim state (f64 all the way)
    const alpha = acc / DT;
    renderPos.lerpVectors(flight.prev.pos, flight.curr.pos, alpha);
    renderQuat.slerpQuaternions(flight.prev.quat, flight.curr.quat, alpha);

    // camera-relative: ship stays at render origin; rig orbits origin
    shipRoot.position.set(0, 0, 0);
    shipRoot.quaternion.copy(renderQuat);
    const fovKick = warp.factor > 0.02 ? warp.factor * 2 : (flight.boosting ? 1 : 0);
    rig.update(dtReal, ZERO, renderQuat, fovKick);
    camPosM.copy(renderPos).add(rig.camera.position); // f64 add: world camera pos

    // warp VFX
    tunnel.object.position.copy(rig.camera.position);
    tunnel.update(dtReal, warp.factor, renderQuat);
    postfx.warpCA.value = 0.65 * warp.factor * warp.factor;
    if (warp.state === 'SPOOL') rig.trauma = Math.max(rig.trauma, 0.1 + 0.25 * (warp.spoolT / 3));
    if (warp.state === 'WARP' && warp.factor > 0.9) rig.trauma = Math.max(rig.trauma, 0.12);

    // terrain: LOD select + camera-relative placement; hide proxy when active
    let terrainAltitude: number | null = null;
    let terrainPatches = 0;
    for (const t of terrains) {
      const alt = t.update(camPosM);
      t.group.position.add(rig.camera.position); // group pos was planet−cam; offset to camera space
      shell.setBodyVisible(t.body, !t.active);
      // shader frame: planet center in scene space + sun dir (terminator/albedo drape)
      tmp.set(
        t.body.posM.x - camPosM.x, t.body.posM.y - camPosM.y, t.body.posM.z - camPosM.z,
      ).add(rig.camera.position);
      const bl = Math.hypot(t.body.posM.x, t.body.posM.y, t.body.posM.z) || 1;
      t.setShaderFrame(tmp, tmp2.set(-t.body.posM.x / bl, -t.body.posM.y / bl, -t.body.posM.z / bl));
      if (alt !== null) {
        terrainAltitude = alt;
        terrainPatches = t.stats.patches;
      }
    }

    // Earth cloud layer follows the same camera-relative convention
    {
      const b = earthBody;
      const dx = b.posM.x - camPosM.x, dy = b.posM.y - camPosM.y, dz = b.posM.z - camPosM.z;
      clouds.update(dtReal, tmp.set(dx, dy, dz).add(rig.camera.position), Math.hypot(dx, dy, dz));
    }

    // far shell + stars around the camera
    shell.update(camPosM);
    shell.group.position.copy(rig.camera.position);
    stars.position.copy(rig.camera.position);

    // physical sun: direction, 1/d² falloff, eclipse factor
    sunDir.set(-renderPos.x, -renderPos.y, -renderPos.z); // toward Sol (at world origin)
    const dSunM = sunDir.length();
    sunDir.divideScalar(dSunM);
    const dAU = dSunM / (AU_M * SYSTEM_SCALE);
    const vis = sys.sunVisibility(renderPos);
    sun.intensity = (8.0 / (dAU * dAU)) * vis;
    sun.position.copy(tmp.copy(sunDir).multiplyScalar(-800)); // light comes FROM the sun
    sun.target.position.set(0, 0, 0);
    fill.position.copy(tmp.copy(sunDir).multiplyScalar(600));
    fill.target.position.set(0, 0, 0);

    // ship visuals
    ship.setThrottle(flight.visualThrottle);
    exhaust.update(flight.visualThrottle, flight.boosting);

    // --- M5 visuals: gear, dust, reentry glow, atmosphere shells ---
    gear.update(dtReal, gearRequested, landedPin ? 1 : 0);
    const nearBody = nearestBody();
    if (nearBody && terrainAltitude !== null) {
      // ground point under the ship (scene space: ship at origin)
      tmp.set(
        flight.curr.pos.x - nearBody.posM.x,
        flight.curr.pos.y - nearBody.posM.y,
        flight.curr.pos.z - nearBody.posM.z).normalize();
      tmp2.copy(tmp).multiplyScalar(-(terrainAltitude));
      dust.update(dtReal, tmp2, tmp, Math.max(lastDust, terrainAltitude < 50 ? flight.visualThrottle * (1 - terrainAltitude / 50) : 0));
    } else {
      dust.update(dtReal, tmp2.set(0, -1e5, 0), tmp.set(0, 1, 0), 0);
    }
    const plasma01 = THREE.MathUtils.clamp(
      (heatFlux - PLASMA_START_W_M2) / (PLASMA_FULL_W_M2 - PLASMA_START_W_M2), 0, 1);
    glow.set(plasma01 > 0 ? 0.15 + plasma01 * 0.85 : heatFlux > PLASMA_START_W_M2 * 0.5 ? 0.08 : 0);
    if (plasma01 > 0.05) rig.trauma = Math.max(rig.trauma, 0.2 + plasma01 * 0.3);
    for (const a of atmospheres) {
      const b = a.body;
      const dx = b.posM.x - camPosM.x, dy = b.posM.y - camPosM.y, dz = b.posM.z - camPosM.z;
      const dist = Math.hypot(dx, dy, dz);
      tmp.set(dx, dy, dz).add(rig.camera.position); // scene-space center (camera-relative convention)
      tmp2.set(-b.posM.x, -b.posM.y, -b.posM.z).normalize(); // planet → sun
      a.update(tmp, tmp2, dist);
    }
    if (flight.boosting) rig.trauma = Math.max(rig.trauma, 0.35);

    // re-assert debug hides (systems flip visibility per frame)
    if (hidden.size > 1) {
      if (hidden.has('stars')) stars.visible = false;
      if (hidden.has('shell')) shell.group.visible = false;
      if (hidden.has('terrain')) for (const t of terrains) t.group.visible = false;
      if (hidden.has('atmo')) for (const a of atmospheres) a.mesh.visible = false;
      if (hidden.has('exhaust')) exhaust.group.visible = false;
      if (hidden.has('tunnel')) tunnel.object.visible = false;
      if (hidden.has('dust')) dust.group.visible = false;
      if (hidden.has('glow')) glow.mesh.visible = false;
      if (hidden.has('gear')) gear.group.visible = false;
    }

    postfx.render();

    hud.draw({
      speed: flight.speed,
      gForce: flight.gForce,
      boostHeat: flight.boostHeat,
      boosting: flight.boosting,
      flightAssist: flight.flightAssist,
      decoupled: flight.decoupled,
      reticleX: input.reticleX,
      reticleY: input.reticleY,
      reticleRadius: input.reticleRadius,
      vel: flight.curr.vel,
      camera: rig.camera,
      cockpit: rig.mode === 'cockpit',
      locked: input.locked,
      targetName: warp.target?.name,
      targetDistM: warp.target ? warp.targetDistance() : undefined,
      warpState: warp.state,
      warpEtaS: warp.v > 0 ? warp.targetDistance() / warp.v : undefined,
      altAGL: terrainAltitude,
      vRadial: nearBody
        ? flight.curr.vel.dot(tmp.set(
            flight.curr.pos.x - nearBody.posM.x,
            flight.curr.pos.y - nearBody.posM.y,
            flight.curr.pos.z - nearBody.posM.z).normalize())
        : 0,
      gearDown: gear.deploy01 > 0.5,
      autoland: autoland.state,
      heat01: THREE.MathUtils.clamp(heatFlux / PLASMA_FULL_W_M2, 0, 1),
      inAtmosphere: inAtmo,
      obstructed: warp.obstructed,
      navMode: flight.navMode,
    });
    map.draw(sys, renderPos);

    // E2E test hook: sim state snapshot (read by scripts/verify-*.mjs)
    (window as unknown as { __XV: object }).__XV = {
      target: warp.target?.name ?? null,
      autoland: autoland.state,
      gearDeploy: gear.deploy01,
      landedPin,
      speed: flight.speed,
      altAGL: terrainAltitude,
      heatFlux,
      warp: warp.state,
      fps: Math.round(fps),
    };

    if ((frames++ & 15) === 0) {
      // nearest body + f32 ULP at current |pos| — the "no jitter at Neptune" proof
      let nearest = sys.bodies[1];
      let nd = Infinity;
      for (const b of sys.bodies) {
        const d = Math.hypot(b.posM.x - renderPos.x, b.posM.y - renderPos.y, b.posM.z - renderPos.z) - b.radiusM;
        if (d < nd) { nd = d; nearest = b; }
      }
      const maxC = Math.max(Math.abs(renderPos.x), Math.abs(renderPos.y), Math.abs(renderPos.z), 1);
      const ulp32 = 2 ** (Math.floor(Math.log2(maxC)) - 23);
      const r = renderer.info.render;
      const terrainLine = terrainAltitude !== null
        ? `\nALT ${fmtDist(Math.max(0, terrainAltitude))} AGL · ${terrainPatches} patches`
        : '';
      debugEl.textContent =
        `EXTRAVERSE M4 · ${backend}\n` +
        `${fps.toFixed(0)} fps · ${r.drawCalls} draws · ${(r.triangles / 1000).toFixed(0)}k tris\n` +
        `${nearest.name} ${fmtDist(nd)} · sun ${dAU.toFixed(2)} AU · eclipse ${(1 - vis).toFixed(2)}\n` +
        `|pos| ${(maxC / 1e9).toFixed(2)}e9 m · f32 ULP ${ulp32.toFixed(3)} m (render is camera-relative f64)` +
        terrainLine;
    }
  });

  boot.classList.add('hidden');
}

function fmtDist(m: number): string {
  if (m > 1e9) return `${(m / 1e9).toFixed(2)} Gm`;
  if (m > 1e6) return `${(m / 1e6).toFixed(1)} Mm`;
  if (m > 1e3) return `${(m / 1e3).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}
