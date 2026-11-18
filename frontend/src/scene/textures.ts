import * as THREE from "three";

/** Procedural canvas textures (no image assets needed). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wood planks (table top). */
export function woodTexture(base = "#b98a5a"): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const r = rng(7);
  g.fillStyle = base;
  g.fillRect(0, 0, 1024, 1024);
  const plank = 1024 / 6;
  for (let p = 0; p < 6; p++) {
    const y0 = p * plank;
    const tint = (r() - 0.5) * 30;
    g.fillStyle = `rgba(${tint > 0 ? 255 : 0},${tint > 0 ? 220 : 0},${tint > 0 ? 180 : 0},${Math.abs(tint) / 255})`;
    g.fillRect(0, y0, 1024, plank);
    for (let i = 0; i < 70; i++) { // grain lines
      const y = y0 + r() * plank;
      g.strokeStyle = `rgba(80,45,15,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / (90 + r() * 60) + r()) * 3);
      g.stroke();
    }
    g.fillStyle = "rgba(40,20,5,0.35)";
    g.fillRect(0, y0, 1024, 2);
  }
  return tex(c, 3);
}

/** Speckled laminate. */
export function laminateTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rng(3);
  g.fillStyle = "#cfd3d6";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 150 + Math.floor(r() * 90);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
    g.fillRect(r() * 512, r() * 512, 1.4, 1.4);
  }
  return tex(c, 6);
}

/** Subtle plastic noise for the tile / arm (used as roughness variation). */
export function noiseTexture(seed = 1, scale = 4): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + r() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, scale, false);
}

/** Vertical gradient for the scene background. */
export function gradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const [c, g] = canvas(2, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 2, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
