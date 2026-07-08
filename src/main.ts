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
import { Exhaust } from './game/vfx/exhaust';
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

  const stars = createStarfield();
  scene.add(stars);

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
  scene.add(shipRoot);

  const rig = new CameraRig(window.innerWidth / window.innerHeight);
  const postfx = createPostFX(renderer, scene, rig.camera);
  const input = new InputSystem(renderer.domElement);
  const flight = new ShipFlight();
  const hud = new Hud(document.body);
  const map = new SystemMap(document.body);

  // spawn: sunward of Earth, 8 radii out, facing the planet
  const earth = sys.planets[2];
  spawnAt(earth.posM, earth.radiusM * 8);

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
  const renderPos = new THREE.Vector3();   // f64 world (JS numbers)
  const renderQuat = new THREE.Quaternion();
  const camPosM = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtReal = Math.min((now - last) / 1000, 0.25);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dtReal, 1e-4)) * 0.05;

    acc += dtReal;
    while (acc >= DT) {
      const recenter = flight.flightAssist && !input.hasMouseInput;
      const intent = input.sample(tick++, DT, recenter);
      if (intent.pressed.has('camera.toggleChase')) rig.toggle();
      if (intent.codes.has('F2')) map.toggle();
      for (let d = 1; d <= 8; d++) {
        if (intent.codes.has(`Digit${d}`)) spawnAt(sys.planets[d - 1].posM, sys.planets[d - 1].radiusM * 6);
      }
      flight.step(DT, intent);
      acc -= DT;
    }
    sys.update(dtReal); // rails are analytic — real-rate epoch advance

    // interpolate sim state (f64 all the way)
    const alpha = acc / DT;
    renderPos.lerpVectors(flight.prev.pos, flight.curr.pos, alpha);
    renderQuat.slerpQuaternions(flight.prev.quat, flight.curr.quat, alpha);

    // camera-relative: ship stays at render origin; rig orbits origin
    shipRoot.position.set(0, 0, 0);
    shipRoot.quaternion.copy(renderQuat);
    rig.update(dtReal, ZERO, renderQuat, flight.boosting);
    camPosM.copy(renderPos).add(rig.camera.position); // f64 add: world camera pos

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
    if (flight.boosting) rig.trauma = Math.max(rig.trauma, 0.35);

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
    });
    map.draw(sys, renderPos);

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
      debugEl.textContent =
        `EXTRAVERSE M2 sol · ${backend}\n` +
        `${fps.toFixed(0)} fps · ${r.drawCalls} draws · ${(r.triangles / 1000).toFixed(0)}k tris\n` +
        `${nearest.name} ${fmtDist(nd)} · sun ${dAU.toFixed(2)} AU · eclipse ${(1 - vis).toFixed(2)}\n` +
        `|pos| ${(maxC / 1e9).toFixed(2)}e9 m · f32 ULP ${ulp32.toFixed(3)} m (render is camera-relative f64)`;
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
