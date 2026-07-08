/**
 * Earth land mask (M6): derived from the Blue Marble day texture so terrain
 * GEOMETRY matches the real albedo — continents rise, oceans sit at datum.
 * Pure sampling math is exported for tests; the loader needs a DOM canvas.
 */
import type { Vec3 } from './heightfield';

export interface LandMask {
  data: Uint8Array; // 0 = ocean, 255 = land (bilinear-sampled soft shores)
  w: number;
  h: number;
}

/** unit direction → equirect [u, v] (u: lon 0..1 from −π; v: 0 at north pole) */
export function equirectUV(dir: Vec3): [number, number] {
  const lon = Math.atan2(dir.z, -dir.x); // matches three's SphereGeometry mapping
  const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  return [lon / (2 * Math.PI) + 0.5, 0.5 - lat / Math.PI];
}

/** bilinear mask sample, 0..1 */
export function sampleMask(mask: LandMask, u: number, v: number): number {
  const x = ((u % 1) + 1) % 1 * (mask.w - 1);
  const y = Math.max(0, Math.min(1, v)) * (mask.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(mask.w - 1, x0 + 1), y1 = Math.min(mask.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (xx: number, yy: number) => mask.data[yy * mask.w + xx] / 255;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
         (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

export function landAtDir(mask: LandMask, dir: Vec3): number {
  const [u, v] = equirectUV(dir);
  return sampleMask(mask, u, v);
}

/** classify a Blue-Marble pixel as water (blue-dominant, darkish) */
export function isWaterPixel(r: number, g: number, b: number): boolean {
  return b > r * 1.1 && b > g * 0.96 && r < 110;
}

/** load the day texture and build a mask (browser only) */
export async function loadEarthLandMask(url: string, w = 1024, h = 512): Promise<LandMask> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    data[i] = isWaterPixel(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) ? 0 : 255;
  }
  return { data, w, h };
}
