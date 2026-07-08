/**
 * Far-shell rendering (§4.3, simplified — see DECISIONS.md M2):
 * distant bodies are proxies projected onto a fixed-radius shell around the
 * camera: pos = dir·R_SHELL, scale = R_SHELL·radius/dist. Perspectively exact,
 * numerically tiny — no second camera/pass needed until M4 promotes terrain.
 * All position math in f64; only small camera-relative deltas hit the GPU.
 */
import * as THREE from 'three/webgpu';
import { color, float, normalWorld, smoothstep, texture as texNode, uniform } from 'three/tsl';
import type { Vec3d } from '../math/kepler';
import { bodyOrientation, type BodyState } from '../../game/systems/solSystem';
import type { PlanetDef, MoonDef } from '../../data/solarSystem';

const R_SHELL = 9000; // m — inside camera far (5e4), beyond any near geometry

export class FarShell {
  readonly group = new THREE.Group();
  private proxies = new Map<BodyState, THREE.Group>();
  private sunUniforms = new Map<BodyState, { value: THREE.Vector3 }>();
  private scratchQ = new THREE.Quaternion();
  private sunMesh!: THREE.Mesh;
  private loader = new THREE.TextureLoader();

  constructor(bodies: BodyState[], private geoOverrides: Map<string, THREE.BufferGeometry> = new Map()) {
    this.group.renderOrder = -1;
    for (const b of bodies) {
      const g = b.kind === 'star' ? this.buildSun(b) : this.buildBody(b);
      if (b.kind !== 'star') g.add(this.buildGlint(b)); // sub-pixel planets read as star-like glints (Elite-style)
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

  private glints = new Map<BodyState, THREE.Sprite>();

  private buildGlint(b: BodyState): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      color: b.kind === 'moon' ? 0xd8dce2 : 0xfff3e0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }));
    s.renderOrder = -99;
    this.glints.set(b, s);
    return s;
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
    // user-authored geometry when provided (photoreal_earth / moon gltfs).
    // 'orient' carries the unified body quaternion (tilt·spin·wobble) so the
    // ring/clouds tilt WITH the planet and poles never precess (audit fix).
    const geo = this.geoOverrides.get(b.name) ?? new THREE.SphereGeometry(1, 48, 24);
    const orient = new THREE.Group();
    orient.name = 'orient';
    g.add(orient);
    const sphere = new THREE.Mesh(geo, mat);
    orient.add(sphere);

    const pd = def as PlanetDef;
    if (pd.emissiveNight) {
      // terminator-blended night lights (M6): emissive only past the twilight band
      const nodeMat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
      nodeMat.colorNode = texNode(this.tex(pd.texture)).mul(color(0xffffff));
      const uSun = uniform(new THREE.Vector3(0, 1, 0));
      this.sunUniforms.set(b, uSun);
      const dayFactor = smoothstep(-0.12, 0.12, normalWorld.dot(uSun));
      nodeMat.emissiveNode = texNode(this.tex(pd.emissiveNight!)).mul(float(1.0).sub(dayFactor)).mul(1.4);
      sphere.material = nodeMat as unknown as THREE.MeshStandardMaterial;
      (mat as THREE.Material).dispose();
    }
    if (pd.clouds) {
      const cloudMat = new THREE.MeshStandardMaterial({
        map: this.tex(pd.clouds), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, roughness: 1, metalness: 0,
      });
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 48, 24), cloudMat);
      clouds.name = 'clouds';
      orient.add(clouds);
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
      ring.rotation.x = -Math.PI / 2; // ring plane = equator (inherits the body tilt via 'orient')
      ring.name = 'ring';
      orient.add(ring);
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
      // TRUE angular size — no floor. Perspective is sacred: the disc only
      // grows by real geometry (2·atan(R/d)). Sub-pixel bodies get a glint.
      const s = (R_SHELL * b.radiusM) / d;
      const k = R_SHELL / d;
      g.position.set(dx * k, dy * k, dz * k);
      g.scale.setScalar(s);
      const glint = this.glints.get(b);
      if (glint) {
        // fade the glint in as the true disc shrinks below ~2 px (θ ≈ 0.0011 rad at 1600px/60°)
        const theta = (2 * b.radiusM) / d;
        const glintFade = THREE.MathUtils.clamp((0.0016 - theta) / 0.0008, 0, 1);
        (glint.material as THREE.SpriteMaterial).opacity = glintFade * 0.9;
        glint.scale.setScalar((0.0012 * R_SHELL) / s); // constant on-screen size (undo parent scale)
      }
      const orient = g.getObjectByName('orient');
      if (orient) bodyOrientation(b, orient.quaternion, this.scratchQ);
      const uSun = this.sunUniforms.get(b);
      if (uSun) {
        const l = Math.hypot(b.posM.x, b.posM.y, b.posM.z) || 1;
        uSun.value.set(-b.posM.x / l, -b.posM.y / l, -b.posM.z / l); // body → sun
      }
      const clouds = g.getObjectByName('clouds');
      if (clouds) clouds.rotation.y = b.spin * 0.03; // slow drift RELATIVE to the surface
      order.push({ g, d });
    }
    // farthest first
    order.sort((a, bb) => bb.d - a.d);
    order.forEach((o, i) => o.g.traverse(ob => { ob.renderOrder = -100 + i; }));
  }
}
