/**
 * EXTRAVERSE — M0 Lookdev boot.
 * Acceptance gate (§17): ship renders with zero gray meshes, reactor blooms orange, 60 fps.
 */
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadShip } from './engine/assets/shipLoader';
import { createPostFX } from './engine/render/postfx';
import { SUN } from './data/constants';

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

  // environment: dim night HDRI so PBR has something to reflect (galaxy skybox arrives in M2/M8)
  bootStatus.textContent = 'Loading environment…';
  const hdr = await new HDRLoader().loadAsync('/env/satara_night_no_lamps_2k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr; // reflections only — background is deep space, not a golf course
  scene.environmentIntensity = 0.9;
  scene.background = new THREE.Color(0x030508);

  // key light: the local star (physical scale comes later; lookdev value here)
  const sun = new THREE.DirectionalLight(SUN.COLOR, 8.0);
  sun.position.set(35, 28, 40); // key from aft-starboard high — lights the lookdev camera side
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
  sun.shadow.camera.right = sun.shadow.camera.top = 25;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -2e-4;
  scene.add(sun);
  // cool fill from below-behind, sells the metal
  const fill = new THREE.DirectionalLight(0x334a66, 0.6);
  fill.position.set(-25, -12, -30);
  scene.add(fill);

  // the ship
  bootStatus.textContent = 'Loading GRIDCORP drone…';
  const ship = await loadShip();
  scene.add(ship.object);

  // camera + controls (lookdev turntable)
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(16, 7, 30); // aft three-quarter: engines + reactor in frame
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 8;
  controls.maxDistance = 120;

  const postfx = createPostFX(renderer, scene, camera);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // loop: slow turntable + breathing throttle so the reactor/bloom reads
  let last = performance.now();
  let fps = 60;
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

    ship.object.rotation.y += dt * 0.15;
    ship.setThrottle(0.5 + 0.5 * Math.sin(now / 1600));

    controls.update();
    postfx.render();

    if ((frames++ & 15) === 0) {
      const r = renderer.info.render; // drawCalls/triangles are per-frame (info.autoReset)
      debugEl.textContent =
        `EXTRAVERSE M0 lookdev · ${backend}\n` +
        `${fps.toFixed(0)} fps · ${r.drawCalls} draws · ${(r.triangles / 1000).toFixed(0)}k tris\n` +
        `throttle ${(ship.throttle * 100).toFixed(0)}%`;
    }
  });

  boot.classList.add('hidden');
}
