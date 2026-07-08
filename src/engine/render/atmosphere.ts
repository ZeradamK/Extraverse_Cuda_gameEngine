/**
 * Single-scatter atmosphere shell (§8.3, O'Neil-class) in TSL.
 * BackSide shell at R_top; fragment raymarch: 12 view samples × 4 light samples,
 * Rayleigh + Mie (HG), ground-sphere occlusion inside the march. Loops are
 * unrolled in JS at graph-build time — no TSL Loop API risk.
 * Spectra per planet from solarSystem.AtmoDef (Mars: reversed Rayleigh → blue sunsets).
 */
import * as THREE from 'three/webgpu';
import {
  cameraPosition, dot, exp, float, max, min, normalize, positionWorld, select,
  sqrt, uniform, vec3,
} from 'three/tsl';
import type { AtmoDef } from '../../data/solarSystem';
import type { BodyState } from '../../game/systems/solSystem';

const N_VIEW = 12;
const N_LIGHT = 4;

export class AtmosphereShell {
  readonly mesh: THREE.Mesh;
  private uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  private uSunI = uniform(22.0);

  constructor(readonly body: BodyState, atmo: AtmoDef) {
    const Rg = body.radiusM;
    const Rt = body.radiusM + atmo.topM;

    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // --- node graph (all f32; shell is camera-near so magnitudes are safe) ---
    const uCenter = uniform(new THREE.Vector3());
    this.uCenter = uCenter;

    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const oc = ro.sub(uCenter);

    const b = dot(oc, rd);
    const c = dot(oc, oc).sub(Rt * Rt);
    const disc = b.mul(b).sub(c);
    const sq = sqrt(max(disc, 0.0));
    const tA = max(b.negate().sub(sq), 0.0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tB: any = b.negate().add(sq);

    // ground occlusion
    const cg = dot(oc, oc).sub(Rg * Rg);
    const discG = b.mul(b).sub(cg);
    const sqG = sqrt(max(discG, 0.0));
    const tG = b.negate().sub(sqG);
    // if the ground is hit in front of us, stop the march there
    const groundHit = discG.greaterThan(0.0).and(tG.greaterThan(0.0));
    tB = select(groundHit, min(tB, tG), tB);

    const seg = tB.sub(tA).div(N_VIEW);
    const betaR = vec3(atmo.betaR[0], atmo.betaR[1], atmo.betaR[2]);
    const HR = atmo.H; // use density scale height for Rayleigh
    const HM = atmo.HM;

    // graph accumulators (reassigned per unrolled iteration — loose typing on purpose)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let inscR: any = vec3(0.0);
    let inscM: any = vec3(0.0);
    let odRv: any = float(0.0);
    let odMv: any = float(0.0);

    for (let i = 0; i < N_VIEW; i++) {
      const t = tA.add(seg.mul(i + 0.5));
      const p = oc.add(rd.mul(t)); // planet-local sample
      const h = max(p.length().sub(Rg), 0.0);
      const dR = exp(h.div(-HR)).mul(seg);
      const dM = exp(h.div(-HM)).mul(seg);
      odRv = odRv.add(dR);
      odMv = odMv.add(dM);

      // light optical depth: p → shell top along sun dir
      const bs = dot(p, this.uSunDir);
      const ds = bs.mul(bs).sub(dot(p, p).sub(Rt * Rt));
      const ts = bs.negate().add(sqrt(max(ds, 0.0)));
      const lseg = ts.div(N_LIGHT);
      let odRs: any = float(0.0);
      let odMs: any = float(0.0);
      for (let j = 0; j < N_LIGHT; j++) {
        const lp = p.add(this.uSunDir.mul(lseg.mul(j + 0.5)));
        const lh = max(lp.length().sub(Rg), 0.0);
        odRs = odRs.add(exp(lh.div(-HR)).mul(lseg));
        odMs = odMs.add(exp(lh.div(-HM)).mul(lseg));
      }
      const tau = betaR.mul(odRv.add(odRs)).add(vec3(atmo.betaMExt).mul(odMv.add(odMs)));
      const T = exp(tau.negate());
      inscR = inscR.add(T.mul(dR));
      inscM = inscM.add(T.mul(dM));
    }

    // phases
    const mu = dot(rd, this.uSunDir);
    const phR = float(3 / (16 * Math.PI)).mul(mu.mul(mu).add(1.0));
    const g = atmo.g;
    const g2 = g * g;
    const phM = float((3 / (8 * Math.PI)) * ((1 - g2) / (2 + g2)))
      .mul(mu.mul(mu).add(1.0))
      .div(float(1 + g2).sub(mu.mul(2 * g)).pow(1.5));

    const L = inscR.mul(betaR).mul(phR).add(inscM.mul(atmo.betaMSca).mul(phM)).mul(this.uSunI);
    // kill fragments that miss the shell entirely
    mat.colorNode = L.mul(select(disc.greaterThan(0.0), float(1.0), float(0.0)));

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.scale.setScalar(Rt);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5; // after opaque terrain
    this.mesh.visible = false;
  }

  private uCenter!: ReturnType<typeof uniform>;

  /**
   * meshPos: planet center in SCENE space (camera-relative convention of main);
   * sunDir: unit vector planet→sun (world ≈ scene orientation); enable by distance.
   */
  update(meshPos: THREE.Vector3, sunDir: THREE.Vector3, camDistM: number): void {
    const maxDist = this.mesh.scale.x * 40;
    this.mesh.visible = camDistM < Math.min(maxDist, 8e6);
    if (!this.mesh.visible) return;
    this.mesh.position.copy(meshPos);
    (this.uCenter.value as THREE.Vector3).copy(meshPos);
    (this.uSunDir.value as THREE.Vector3).copy(sunDir);
  }
}
