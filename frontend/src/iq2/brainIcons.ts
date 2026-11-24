import { UI, UI_FONT } from "./brainScreen";

/** Menu icons for the brain UI, modelled on the IQ (2nd gen) screen captures (own drawings).
 *  Each draws centred on (x, y) within roughly a 36 px box. `on` = drawn on the black tile. */
export type Icon = (g: CanvasRenderingContext2D, x: number, y: number, on: boolean) => void;

const ink = (on: boolean) => (on ? "#f2f2f2" : "#1e1e1e");

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Controller silhouette (Drive). */
export const gamepad = (color: string): Icon => (g, x, y) => {
  g.fillStyle = color;
  rr(g, x - 17, y - 9, 34, 13, 6); g.fill();
  g.beginPath(); // grips
  g.moveTo(x - 17, y - 2); g.lineTo(x - 13, y + 12); g.lineTo(x - 6, y + 10); g.lineTo(x - 5, y + 3);
  g.lineTo(x + 5, y + 3); g.lineTo(x + 6, y + 10); g.lineTo(x + 13, y + 12); g.lineTo(x + 17, y - 2); g.closePath(); g.fill();
  g.fillStyle = "#ffffff";
  for (const dx of [-8, 8]) { g.beginPath(); g.arc(x + dx, y - 3, 3.2, 0, Math.PI * 2); g.fill(); }
};

/** Program document with refresh arrows (Programs). */
export const programs: Icon = (g, x, y, on) => {
  g.strokeStyle = ink(on); g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(x - 9, y - 13); g.lineTo(x - 14, y - 13); g.lineTo(x - 14, y + 13); g.lineTo(x + 4, y + 13); g.stroke();
  g.beginPath(); g.moveTo(x + 9, y + 13); g.lineTo(x + 14, y + 13); g.lineTo(x + 14, y - 13); g.lineTo(x - 4, y - 13); g.stroke();
  g.fillStyle = ink(on);
  g.beginPath(); g.moveTo(x + 4, y + 9); g.lineTo(x + 9, y + 13); g.lineTo(x + 4, y + 17); g.fill();
  g.beginPath(); g.moveTo(x - 4, y - 17); g.lineTo(x - 9, y - 13); g.lineTo(x - 4, y - 9); g.fill();
  g.fillStyle = UI.blue;
  [[-8, -6, 14], [-8, -1, 16], [-8, 4, 12], [-8, 9, 15]].forEach(([dx, dy, w]) => g.fillRect(x + dx, y + dy, w, 2.4));
};

/** Smart Port (Devices). */
export const port: Icon = (g, x, y, on) => {
  g.fillStyle = ink(on);
  g.beginPath();
  g.moveTo(x - 6, y - 15); g.lineTo(x + 6, y - 15); g.lineTo(x + 6, y - 10); g.lineTo(x + 11, y - 10);
  g.lineTo(x + 11, y + 13); g.lineTo(x - 11, y + 13); g.lineTo(x - 11, y - 10); g.lineTo(x - 6, y - 10); g.closePath(); g.fill();
  g.fillStyle = UI.blue;
  for (let i = 0; i < 4; i++) g.fillRect(x - 9 + i * 5, y + 8, 3.4, 4);
};

/** Wrench and gear (Settings). */
export const settings: Icon = (g, x, y, on) => {
  g.fillStyle = ink(on);
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 11 : 14;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  g.fillStyle = on ? UI.sel : UI.tile;
  g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = UI.blue;
  g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
};

/** A downloaded project (blue file badge). */
export const project: Icon = (g, x, y) => {
  g.fillStyle = UI.blue; rr(g, x - 16, y - 15, 32, 30, 2); g.fill();
  g.fillStyle = UI.deep;
  g.beginPath(); g.moveTo(x - 16, y - 4); g.lineTo(x, y + 15); g.lineTo(x + 16, y - 4); g.lineTo(x + 16, y + 15); g.lineTo(x - 16, y + 15); g.closePath(); g.fill();
  g.fillStyle = "#cfe6ff";
  for (let i = 0; i < 3; i++) g.fillRect(x - 6, y - 11 + i * 4, 12 - i * 2, 1.8);
};

/** An empty program slot: grey frame with the slot number. */
export const emptySlot = (n: number): Icon => (g, x, y) => {
  g.strokeStyle = "#c8c8c8"; g.lineWidth = 3;
  rr(g, x - 13, y - 17, 30, 28, 1); g.stroke();
  g.fillStyle = "#e4e4e4"; rr(g, x - 17, y - 13, 30, 29, 1); g.fill();
  g.strokeStyle = "#cfcfcf"; g.lineWidth = 2; rr(g, x - 17, y - 13, 30, 29, 1); g.stroke();
  g.fillStyle = "#c6c6c6"; g.font = `700 22px ${UI_FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(n), x - 2, y + 2.5); g.textAlign = "left";
};

export const play: Icon = (g, x, y) => {
  g.fillStyle = UI.blue;
  g.beginPath(); g.moveTo(x - 8, y - 13); g.lineTo(x + 11, y); g.lineTo(x - 8, y + 13); g.closePath(); g.fill();
};

/** Two people with controllers (driver controls). */
export const people: Icon = (g, x, y) => {
  g.fillStyle = UI.blue;
  for (const dx of [-8, 8]) {
    g.beginPath(); g.arc(x + dx, y - 11, 3.6, 0, Math.PI * 2); g.fill();
    rr(g, x + dx - 4.5, y - 6, 9, 18, 2); g.fill();
  }
  g.fillStyle = "#1e1e1e"; rr(g, x - 11, y, 7, 4, 1.5); g.fill(); rr(g, x + 4, y, 7, 4, 1.5); g.fill();
};

/** Program + controller (configure). */
export const config: Icon = (g, x, y, on) => {
  g.save(); g.translate(x - 6, y - 6); g.scale(0.6, 0.6); programs(g, 0, 0, on); g.restore();
  g.save(); g.translate(x + 7, y + 7); g.scale(0.55, 0.55); gamepad(ink(on))(g, 0, 0, on); g.restore();
};

export const globe: Icon = (g, x, y) => {
  g.strokeStyle = UI.blue; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(x, y, 6, 14, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.moveTo(x - 12, y - 7); g.lineTo(x + 12, y - 7); g.moveTo(x - 12, y + 7); g.lineTo(x + 12, y + 7); g.stroke();
};

export const link: Icon = (g, x, y, on) => {
  g.save(); g.translate(x - 8, y - 9); g.scale(0.45, 0.45); gamepad(ink(on))(g, 0, 0, on); g.restore();
  g.strokeStyle = UI.blue; g.lineWidth = 2.4;
  g.beginPath(); g.ellipse(x - 2, y + 1, 4, 7, Math.PI / 4, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(x + 4, y + 5, 4, 7, Math.PI / 4, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = ink(on); g.lineWidth = 1.6; rr(g, x + 4, y + 8, 12, 8, 1); g.stroke();
};

export const info: Icon = (g, x, y, on) => {
  g.strokeStyle = ink(on); g.lineWidth = 2.2;
  g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.stroke();
  g.fillStyle = UI.blue; g.fillRect(x - 1.6, y - 3, 3.2, 11);
  g.beginPath(); g.arc(x, y - 7.5, 2, 0, Math.PI * 2); g.fill();
};

export const log: Icon = (g, x, y, on) => {
  g.strokeStyle = ink(on); g.lineWidth = 2; rr(g, x - 12, y - 14, 24, 28, 2); g.stroke();
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i < 2 ? UI.blue : UI.green;
    g.fillRect(x - 8, y - 9 + i * 6, 16, 2.2);
  }
};

export const trash: Icon = (g, x, y, on) => {
  g.fillStyle = ink(on);
  g.fillRect(x - 11, y - 11, 22, 3); g.fillRect(x - 4, y - 14, 8, 3);
  g.beginPath(); g.moveTo(x - 9, y - 6); g.lineTo(x + 9, y - 6); g.lineTo(x + 7, y + 14); g.lineTo(x - 7, y + 14); g.closePath(); g.fill();
  g.fillStyle = UI.orange; for (const dx of [-4, 0, 4]) g.fillRect(x + dx - 0.8, y - 2, 1.6, 12);
};

export const reset: Icon = (g, x, y, on) => {
  g.strokeStyle = ink(on); g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, 12, -Math.PI * 0.2, Math.PI * 1.45); g.stroke();
  g.fillStyle = UI.orange;
  g.beginPath(); g.moveTo(x + 13, y - 13); g.lineTo(x + 14, y - 2); g.lineTo(x + 4, y - 6); g.closePath(); g.fill();
};

/** Status-bar glyphs: signal bars, brain, battery. */
export function statusIcons(g: CanvasRenderingContext2D, battery: number, linked: boolean): void {
  const right = 159;
  g.font = `700 9px ${UI_FONT}`;
  g.textAlign = "right"; g.textBaseline = "middle"; g.fillStyle = "#151515";
  g.fillText(`${battery}%`, right - 1, 10.5);
  const tw = g.measureText(`${battery}%`).width;
  let x = right - tw - 9;
  g.fillStyle = "#151515"; rr(g, x, 4, 6, 13, 1); g.fill();
  g.fillRect(x + 1.8, 2.6, 2.4, 1.6);
  g.fillStyle = battery > 25 ? UI.green : battery > 10 ? UI.orange : "#e23b2e";
  const fill = 11 * Math.max(0.08, battery / 100);
  g.fillRect(x + 1, 16 - fill, 4, fill);
  x -= 19;
  g.strokeStyle = "#151515"; g.lineWidth = 1.2; rr(g, x, 5.5, 16, 10, 1); g.stroke();
  g.strokeRect(x + 3, 8, 10, 5);
  x -= 15;
  for (let i = 0; i < 5; i++) {
    g.fillStyle = linked || i < 1 ? "#151515" : "#8f918f";
    const h = 3 + i * 2.2;
    g.fillRect(x + i * 2.6, 16 - h, 1.8, h);
  }
  g.textAlign = "left";
}
