/**
 * Cube-sphere quadtree terrain (§8.1): 6 face quadtrees, split when
 * camDist < 2.5 × nodeSize, skirted 33×33 patches built in a worker pool,
 * LRU mesh cache. Patch vertices are patch-local; the terrain group is placed
 * camera-relative each frame, rotated by the body's spin.
 */
import * as THREE from 'three/webgpu';
import {
  atan, asin, color, float, normalWorld, positionLocal, positionWorld,
  smoothstep, texture, triplanarTexture, uniform, vec2,
} from 'three/tsl';
import { bodyOrientation, type BodyState } from '../systems/solSystem';
import type { Vec3d } from '../../engine/math/kepler';
import type { PatchRequest, PatchResult } from '../../engine/workers/terrainWorker';
import { createHeightField, type HeightField, type PlanetKind } from './heightfield';
import type { LandMask } from './landMask';

export interface TerrainOptions {
  /** drape a real equirect day texture; optional night-lights emissive with terminator blend */
  realDayTexture?: string;
  realNightTexture?: string;
  /** render an ocean sphere at datum radius (Earth) */
  ocean?: boolean;
  /** land mask for the heightfield + workers (Earth continents) */
  mask?: LandMask;
}

const SPLIT_FACTOR = 2.2;
const MAX_LEVEL = 12; // ~1.3 m cells (Luna) / 2.6 m (Mars) — fps > detail for hover heights
const MAX_INFLIGHT = 12;
const CACHE_MAX = 1600;
/** evict only patches unused for this many frames (prevents standin/evict thrash) */
const EVICT_AGE = 240;

interface NodeKeyed { key: string; face: number; level: number; ix: number; iy: number }

export class PlanetTerrain {
  readonly group = new THREE.Group();
  readonly heightField: HeightField;
  active = false;

  private workers: Worker[] = [];
  private nextWorker = 0;
  private nextId = 1;
  private inflight = new Map<number, string>();
  private meshes = new Map<string, THREE.Mesh>(); // built patches (may be hidden)
  private lastUsed = new Map<string, number>();   // key → frame stamp
  private frame = 0;
  private missing: { node: NodeKeyed; dist: number }[] = [];
  private material: THREE.MeshStandardNodeMaterial;
  private camLocal = new THREE.Vector3();
  private lastResolveCam = new THREE.Vector3(1e12, 0, 0);
  private invSpin = new THREE.Quaternion();

  /** scene-space planet center + sun dir + inverse body orientation (drape) */
  private uCenter = uniform(new THREE.Vector3());
  private uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  private uInvOrient = uniform(new THREE.Matrix3());
  private scratchQ = new THREE.Quaternion();
  private scratchQ2 = new THREE.Quaternion();
  private scratchM4 = new THREE.Matrix4();
  private ocean: THREE.Mesh | null = null;

  constructor(
    readonly body: BodyState,
    private kind: PlanetKind,
    private seed: number,
    tint: number,
    private opts: TerrainOptions = {},
    workerCount = 2,
  ) {
    this.heightField = createHeightField(kind, seed, opts.mask);
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('../../engine/workers/terrainWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<PatchResult>) => this.onPatch(e.data);
      if (opts.mask) {
        // one-time mask init (copy per worker — buffers can't be shared post-transfer)
        w.postMessage({ type: 'mask', data: opts.mask.data.slice(), w: opts.mask.w, h: opts.mask.h });
      }
      this.workers.push(w);
    }
    const loader = new THREE.TextureLoader();
    const diff = loader.load('/textures/terrain/rock_diff.jpg');
    diff.wrapS = diff.wrapT = THREE.RepeatWrapping;
    diff.colorSpace = THREE.SRGBColorSpace;
    const rough = loader.load('/textures/terrain/rock_rough.jpg');
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    rough.colorSpace = THREE.NoColorSpace;
    this.material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });

    // triplanar rock detail (patch-local space)
    const macro = triplanarTexture(texture(diff), null, null, float(1 / 700), positionLocal);
    const detail = triplanarTexture(texture(diff), null, null, float(1 / 9), positionLocal);
    const rockColor = macro.mul(detail).mul(2.0).mul(color(tint));

    if (opts.realDayTexture) {
      // real equirect albedo draped by world direction (spin-corrected longitude)
      const day = loader.load(opts.realDayTexture);
      day.colorSpace = THREE.SRGBColorSpace;
      day.wrapS = THREE.RepeatWrapping;
      // full inverse body orientation (tilt+spin+wobble) → body-fixed direction
      const dir = this.uInvOrient.mul(positionWorld.sub(this.uCenter).normalize()).normalize();
      const lon = atan(dir.z, dir.x.negate());
      const lat = asin(dir.y.clamp(-1, 1));
      // audit fix: flipY=true upload puts the image TOP (north) at v=1, so
      // north (+lat) must ADD — the old .sub() mirrored the drape N/S and
      // disagreed with the CPU land-mask path (row 0 = north)
      const uvE = vec2(
        lon.div(2 * Math.PI).add(0.5).fract(),
        float(0.5).add(lat.div(Math.PI)),
      );
      const albedo = texture(day, uvE);
      // real color carries; rock detail modulates up close (patch-local freq)
      this.material.colorNode = albedo.mul(detail.mul(0.65).add(0.68));
      if (opts.realNightTexture) {
        const night = loader.load(opts.realNightTexture);
        night.colorSpace = THREE.SRGBColorSpace;
        night.wrapS = THREE.RepeatWrapping;
        // terminator blend (§8.4): lights only past the twilight band
        const dayFactor = smoothstep(-0.12, 0.12, normalWorld.dot(this.uSunDir));
        this.material.emissiveNode = texture(night, uvE).mul(float(1.0).sub(dayFactor)).mul(1.4);
      }
      this.material.roughnessNode = float(0.95);
    } else {
      this.material.colorNode = rockColor;
      this.material.roughnessNode = triplanarTexture(texture(rough), null, null, float(1 / 9), positionLocal).r.max(0.65);
    }

    if (opts.ocean) {
      // datum-radius water sphere: deep blue, tight specular for the sun glint
      const oceanMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0 });
      oceanMat.colorNode = color(0x06284a);
      oceanMat.roughnessNode = float(0.12);
      this.ocean = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), oceanMat);
      this.ocean.scale.setScalar(body.radiusM);
      this.ocean.receiveShadow = true;
      this.group.add(this.ocean);
    }
    this.group.visible = false;
  }

  /** per-frame shader inputs (scene space) — called by main after update() */
  setShaderFrame(centerScene: THREE.Vector3, sunDir: THREE.Vector3): void {
    (this.uCenter.value as THREE.Vector3).copy(centerScene);
    (this.uSunDir.value as THREE.Vector3).copy(sunDir);
    bodyOrientation(this.body, this.scratchQ, this.scratchQ2);
    this.scratchM4.makeRotationFromQuaternion(this.scratchQ).invert();
    (this.uInvOrient.value as THREE.Matrix3).setFromMatrix4(this.scratchM4);
  }

  /** height above datum at a world-frame unit direction (full orientation) — collision */
  surfaceRadiusAt(dirWorld: THREE.Vector3): number {
    // audit fix: rebuild the inverse orientation from CURRENT body state so
    // collision never uses a stale frame (was only refreshed while active)
    bodyOrientation(this.body, this.scratchQ, this.scratchQ2);
    this.invSpin.copy(this.scratchQ).invert();
    const d = this.camLocal.copy(dirWorld).applyQuaternion(this.invSpin).normalize();
    const h = this.heightField.height(d);
    // ocean worlds: you land on (or splash into) the water surface, not the seafloor
    return this.body.radiusM + (this.opts.ocean ? Math.max(h, 0) : h);
  }

  /**
   * per-frame: LOD select + place group camera-relative.
   * camPosM = camera world f64; returns altitude above terrain (m) if active.
   */
  /** latched true once a resolve pass finds full coverage; false while inactive */
  covered = false;
  private patchesDirty = true;

  update(camPosM: Vec3d): number | null {
    const b = this.body;
    const dx = camPosM.x - b.posM.x, dy = camPosM.y - b.posM.y, dz = camPosM.z - b.posM.z;
    const dist = Math.hypot(dx, dy, dz);
    this.active = dist < b.radiusM * 2.2;
    this.group.visible = this.active;
    if (!this.active) { this.covered = false; return null; }

    // unified body orientation (tilt + spin + wobble) — matches the proxy exactly
    const spinQ = new THREE.Quaternion();
    bodyOrientation(b, spinQ, this.scratchQ2);
    this.invSpin.copy(spinQ).invert();
    this.group.quaternion.copy(spinQ);
    this.group.position.set(dx * -1, dy * -1, dz * -1); // planet center, camera-relative

    // camera in planet-local (unspun) frame
    this.camLocal.set(dx, dy, dz).applyQuaternion(this.invSpin);

    // re-resolve the LOD tree when the camera moved meaningfully OR worker
    // patches completed since the last pass. Audit fix (2026-07-08): the old
    // skip (a) scaled with distance to the planet CENTER — landed, "0.4% of
    // dist" was ~700 m, so a parked/slow ship never resolved again — and
    // (b) ignored build completions, so a stationary camera froze streaming at
    // the first 12 builds: completed patches stayed invisible (onPatch adds
    // them hidden) and the queue never refilled. Threshold now scales with
    // ALTITUDE; patchesDirty forces a pass whenever new geometry landed.
    const altNow = dist - (this.body.radiusM + this.heightField.height(this.camLocal.clone().normalize()));
    const moved = this.lastResolveCam.distanceTo(this.camLocal);
    if (moved < Math.max(altNow, 50) * 0.02 && !this.patchesDirty && this.frame > 1) {
      return altNow;
    }
    this.patchesDirty = false;
    this.lastResolveCam.copy(this.camLocal);

    // LOD select + EXCLUSIVE render-set resolve: a node renders either itself
    // or (all of) its children — never both, or coarse surfaces/skirts poke
    // through fine terrain. While children stream in, the built parent stands
    // in for the whole quad; holes only when nothing in the chain is built.
    this.frame++;
    for (const mesh of this.meshes.values()) mesh.visible = false;
    const show: string[] = [];
    this.missing.length = 0;
    for (let f = 0; f < 6; f++) {
      this.resolve({ key: `${f}:0:0:0`, face: f, level: 0, ix: 0, iy: 0 }, show);
    }
    for (const key of show) {
      const m = this.meshes.get(key);
      if (m) { m.visible = true; this.touch(key); }
    }
    // dispatch missing builds NEAREST-FIRST — the ground under the ship must
    // never lose worker slots to far-horizon nodes
    this.missing.sort((a, b) => a.dist - b.dist);
    for (const m of this.missing) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      if (!this.meshes.has(m.node.key) && !this.isInflight(m.node.key)) this.request(m.node);
    }
    // full coverage reached: a resolve pass found nothing missing — the proxy
    // can hand over without a black-silhouette gap (latches until deactivated)
    if (this.missing.length === 0 && this.inflight.size === 0) this.covered = true;
    this.evict();

    // altitude above terrain under the camera
    const dirLocal = this.camLocal.clone().normalize();
    const surf = this.body.radiusM + this.heightField.height(dirLocal);
    return dist - surf;
  }

  private nodeCenterTmp = new THREE.Vector3();

  /**
   * Resolve a node into the render set. Returns true if the node's whole area
   * is covered (by itself or fully by descendants).
   */
  private resolve(n: NodeKeyed, out: string[]): boolean {
    const size = 2 / (1 << n.level);
    const u = -1 + (n.ix + 0.5) * size;
    const v = -1 + (n.iy + 0.5) * size;
    this.faceDir(n.face, u, v, this.nodeCenterTmp).multiplyScalar(this.body.radiusM);
    const nodeArc = this.body.radiusM * (Math.PI / 2) * size;
    const d = this.nodeCenterTmp.distanceTo(this.camLocal);
    const wantSplit = d < nodeArc * SPLIT_FACTOR && n.level < MAX_LEVEL;

    if (!wantSplit) {
      if (this.meshes.has(n.key)) { out.push(n.key); return true; }
      this.missing.push({ node: n, dist: d });
      return false;
    }

    // want children: resolve all four into a scratch list first
    const scratch: string[] = [];
    let complete = true;
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const ix = n.ix * 2 + cx, iy = n.iy * 2 + cy;
        const child = { key: `${n.face}:${n.level + 1}:${ix}:${iy}`, face: n.face, level: n.level + 1, ix, iy };
        if (!this.resolve(child, scratch)) complete = false;
      }
    }
    if (complete) {
      out.push(...scratch);
      return true;
    }
    // children incomplete → the built parent stands in EXCLUSIVELY
    if (this.meshes.has(n.key)) { out.push(n.key); this.touch(n.key); return true; }
    // parent not built either: surface partial children (holes beat nothing)
    out.push(...scratch);
    this.missing.push({ node: n, dist: d });
    return false;
  }

  private faceDir(face: number, u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
    const w = (t: number) => Math.tan(t * (Math.PI / 4)) / Math.tan(Math.PI / 4);
    const uu = w(u), vv = w(v);
    switch (face) {
      case 0: out.set(1, vv, -uu); break;
      case 1: out.set(-1, vv, uu); break;
      case 2: out.set(uu, 1, -vv); break;
      case 3: out.set(uu, -1, vv); break;
      case 4: out.set(uu, vv, 1); break;
      default: out.set(-uu, vv, -1); break;
    }
    return out.normalize();
  }

  private isInflight(key: string): boolean {
    for (const v of this.inflight.values()) if (v === key) return true;
    return false;
  }

  private request(n: NodeKeyed): void {
    const id = this.nextId++;
    this.inflight.set(id, n.key);
    const req: PatchRequest = {
      id, kind: this.kind, seed: this.seed, radiusM: this.body.radiusM,
      face: n.face, level: n.level, ix: n.ix, iy: n.iy,
    };
    this.workers[this.nextWorker].postMessage(req);
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
  }

  /** ?debugTerrain: flat color per LOD level (magenta = level 0) to expose holes/ceilings */
  private static DEBUG = typeof location !== 'undefined' && location.search.includes('debugTerrain');
  private debugMats = new Map<number, THREE.MeshBasicMaterial>();

  private debugMat(level: number): THREE.MeshBasicMaterial {
    let m = this.debugMats.get(level);
    if (!m) {
      const c = new THREE.Color().setHSL((level * 0.13) % 1, 0.85, 0.55);
      m = new THREE.MeshBasicMaterial({ color: c, wireframe: false });
      this.debugMats.set(level, m);
    }
    return m;
  }

  private onPatch(res: PatchResult): void {
    const key = this.inflight.get(res.id);
    this.inflight.delete(res.id);
    if (!key || this.meshes.has(key)) return;
    const level = Number(key.split(':')[1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(res.indices, 1));
    const mesh = new THREE.Mesh(geo, PlanetTerrain.DEBUG ? this.debugMat(level) : this.material);
    mesh.position.set(res.origin[0], res.origin[1], res.origin[2]);
    mesh.castShadow = false; // terrain receives; casting would double shadow-pass draws
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.meshes.set(key, mesh);
    this.lastUsed.set(key, this.frame);
    this.group.add(mesh);
    this.patchesDirty = true; // wake the next update(): reveal + refill the queue
  }

  private touch(key: string): void {
    this.lastUsed.set(key, this.frame);
  }

  private evict(): void {
    if (this.meshes.size <= CACHE_MAX) return;
    let budget = 32; // bounded work per frame
    for (const [key, mesh] of this.meshes) {
      if (budget <= 0 || this.meshes.size <= CACHE_MAX) break;
      if (mesh.visible) continue;
      const age = this.frame - (this.lastUsed.get(key) ?? 0);
      if (age < EVICT_AGE) continue; // recently useful — standins/hidden kids stay warm
      mesh.geometry.dispose();
      this.group.remove(mesh);
      this.meshes.delete(key);
      this.lastUsed.delete(key);
      budget--;
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.meshes.clear();
    this.group.removeFromParent();
  }

  get stats(): { patches: number; inflight: number } {
    return { patches: this.meshes.size, inflight: this.inflight.size };
  }
}
