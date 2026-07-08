/**
 * EXTRAVERSE — M1 Flight.
 * Fixed-timestep loop (§4.5) + IntentFrame input + 6DOF flight assist +
 * cockpit/chase rig + throttle-driven exhaust + HUD v1.
 * Acceptance (§17): flying feels like SC arena mode in an empty starfield.
 */
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { loadShip } from './engine/assets/shipLoader';
import { createPostFX } from './engine/render/postfx';
import { CameraRig } from './engine/render/cameraRig';
import { InputSystem } from './engine/core/input';
import { ShipFlight } from './game/systems/flight';
import { Exhaust } from './game/vfx/exhaust';
import { createStarfield } from './game/vfx/starfield';
import { Hud } from './ui/hud';
import { SUN } from './data/constants';

const DT = 1 / 60;

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
  scene.environment = hdr; // reflections only (galaxy skybox arrives M2/M8)
  scene.environmentIntensity = 0.9;

  // the local star — follows the ship so self-shadowing works anywhere
  const sunOffset = new THREE.Vector3(350, 280, 400);
  const sun = new THREE.DirectionalLight(SUN.COLOR, 8.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 1200;
  sun.shadow.bias = -2e-4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x334a66, 0.5);
  scene.add(fill, fill.target);

  const stars = createStarfield();
  scene.add(stars);

  bootStatus.textContent = 'Loading GRIDCORP drone…';
  const ship = await loadShip();
  const shipRoot = new THREE.Group(); // entity node: visual + exhaust, driven by sim
  shipRoot.add(ship.object);
  const exhaust = new Exhaust();
  shipRoot.add(exhaust.group);
  scene.add(shipRoot);

  const rig = new CameraRig(window.innerWidth / window.innerHeight);
  const postfx = createPostFX(renderer, scene, rig.camera);
  const input = new InputSystem(renderer.domElement);
  const flight = new ShipFlight();
  const hud = new Hud(document.body);

  renderer.domElement.addEventListener('click', () => void input.lock());

  window.addEventListener('resize', () => {
    rig.camera.aspect = window.innerWidth / window.innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- fixed-timestep loop with render interpolation (§4.5) ---
  let acc = 0;
  let tick = 0;
  let last = performance.now();
  let fps = 60;
  let frames = 0;
  const renderPos = new THREE.Vector3();
  const renderQuat = new THREE.Quaternion();

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
      flight.step(DT, intent);
      acc -= DT;
    }

    // interpolate sim → render transform
    const alpha = acc / DT;
    renderPos.lerpVectors(flight.prev.pos, flight.curr.pos, alpha);
    renderQuat.slerpQuaternions(flight.prev.quat, flight.curr.quat, alpha);
    shipRoot.position.copy(renderPos);
    shipRoot.quaternion.copy(renderQuat);

    // visuals driven by sim
    ship.setThrottle(flight.visualThrottle);
    exhaust.update(flight.visualThrottle, flight.boosting);
    if (flight.boosting) rig.trauma = Math.max(rig.trauma, 0.35);
    stars.position.copy(rig.camera.position); // stars at infinity
    sun.position.copy(renderPos).add(sunOffset);
    sun.target.position.copy(renderPos);
    fill.position.copy(renderPos).sub(sunOffset);
    fill.target.position.copy(renderPos);

    rig.update(dtReal, renderPos, renderQuat, flight.boosting);
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

    if ((frames++ & 15) === 0) {
      const r = renderer.info.render;
      debugEl.textContent =
        `EXTRAVERSE M1 flight · ${backend}\n` +
        `${fps.toFixed(0)} fps · ${r.drawCalls} draws · ${(r.triangles / 1000).toFixed(0)}k tris\n` +
        `pos ${renderPos.x.toFixed(0)},${renderPos.y.toFixed(0)},${renderPos.z.toFixed(0)} m`;
    }
  });

  boot.classList.add('hidden');
}
