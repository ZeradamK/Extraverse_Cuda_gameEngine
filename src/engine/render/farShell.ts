/**
 * Far-shell rendering (§4.3, simplified — see DECISIONS.md M2):
 * distant bodies are proxies projected onto a fixed-radius shell around the
 * camera: pos = dir·R_SHELL, scale = R_SHELL·radius/dist. Perspectively exact,
 * numerically tiny — no second camera/pass needed until M4 promotes terrain.
 * All position math in f64; only small camera-relative deltas hit the GPU.
 */
import * as THREE from 'three/webgpu';
import type { Vec3d } from '../math/kepler';
import type { BodyState } from '../../game/systems/solSystem';
import type { PlanetDef, MoonDef } from '../../data/solarSystem';

const R_SHELL = 9000; // m — inside camera far (5e4), beyond any near geometry

export class FarShell {
  readonly group = new THREE.Group();
  private proxies = new Map<BodyState, THREE.Group>();
  private sunMesh!: THREE.Mesh;
  private loader = new THREE.TextureLoader();

  constructor(bodies: BodyState[]) {
    this.group.renderOrder = -1;
    for (const b of bodies) {
      const g = b.kind === 'star' ? this.buildSun(b) : this.buildBody(b);
      // draw far shell without depth so near geometry always wins; among
      // proxies, renderOrder is set per-frame by distance
      g.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const m = mesh.material as THREE.Material;
          m.depthWrite = false;
          m.depthTest = false;
        }
      });
      this.proxies.set(b, g);
      this.group.add(g);
    }
  }

  private tex(url: string): THREE.Texture {
    const t = this.loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  private buildSun(b: BodyState): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex((b.def as { texture: string }).texture),
      color: 0xffffff,
    });
    // emissive boost for bloom happens via tone mapping headroom
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    g.add(this.sunMesh);
    // additive corona sprite
    const corona = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffe9c4, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    }));
    corona.scale.setScalar(3.2);
    g.add(corona);
    return g;
  }

  private buildBody(b: BodyState): THREE.Group {
    const g = new THREE.Group();
    const def = b.def as PlanetDef | MoonDef;
    const hasTex = 'texture' in def && def.texture;
    const mat = new THREE.MeshStandardMaterial({
      map: hasTex ? this.tex((def as PlanetDef).texture!) : null,
      color: hasTex ? 0xffffff : (def as MoonDef).color ?? 0x999999,
      roughness: 1.0,
      metalness: 0.0,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    sphere.rotation.order = 'ZXY';
    g.add(sphere);

    const pd = def as PlanetDef;
    if (pd.emissiveNight) {
      mat.emissiveMap = this.tex(pd.emissiveNight);
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = 1.2; // visible on the dark side, bloom picks it up
    }
    if (pd.clouds) {
      const cloudMat = new THREE.MeshStandardMaterial({
        map: this.tex(pd.clouds), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, roughness: 1, metalness: 0,
      });
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 48, 24), cloudMat);
      clouds.name = 'clouds';
      g.add(clouds);
    }
    if (pd.ring) {
      const inner = pd.ring.innerKm / pd.radiusKm;
      const outer = pd.ring.outerKm / pd.radiusKm;
      const ringGeo = new THREE.RingGeometry(inner, outer, 128, 1);
      // map ring texture radially (strip): remap uv.x from angle→radius
      const uv = ringGeo.attributes.uv as THREE.BufferAttribute;
      const pos = ringGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const ringMat = new THREE.MeshStandardMaterial({
        map: this.tex(pd.ring.texture), transparent: true, side: THREE.DoubleSide,
        roughness: 1, metalness: 0,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2; // ring plane = equator
      ring.name = 'ring';
      g.add(ring);
    }
    return g;
  }

  private hidden = new Set<BodyState>();

  /** hide a body's proxy (its real terrain has taken over) */
  setBodyVisible(b: BodyState, visible: boolean): void {
    if (visible) this.hidden.delete(b);
    else this.hidden.add(b);
  }

  /** camPosM: camera position in world f64; per-frame */
  update(camPosM: Vec3d): void {
    const order: { g: THREE.Group; d: number }[] = [];
    for (const [b, g] of this.proxies) {
      g.visible = !this.hidden.has(b);
      if (!g.visible) continue;
      const dx = b.posM.x - camPosM.x;
      const dy = b.posM.y - camPosM.y;
      const dz = b.posM.z - camPosM.z;
      const d = Math.hypot(dx, dy, dz);
      const s = (R_SHELL * b.radiusM) / d;
      const k = R_SHELL / d;
      g.position.set(dx * k, dy * k, dz * k);
      // apparent size floor: keep distant planets ≥ ~1.5px-ish (0.35 m at shell)
      g.scale.setScalar(Math.max(s, 0.35));
      const sphere = g.children[0] as THREE.Mesh;
      sphere.rotation.z = b.axialTiltRad;
      sphere.rotation.y = b.spin;
      const clouds = g.getObjectByName('clouds');
      if (clouds) clouds.rotation.y = b.spin * 0.85;
      order.push({ g, d });
    }
    // farthest first
    order.sort((a, bb) => bb.d - a.d);
    order.forEach((o, i) => o.g.traverse(ob => { ob.renderOrder = -100 + i; }));
  }
}
