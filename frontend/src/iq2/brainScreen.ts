import type { ScreenOp } from "../net/protocol";

/** The IQ (2nd gen) brain's 160x128 panel: a 20 px status bar above the 160x108 user area
 *  that programs draw on (REAL: KB screen captures are 160x128; the API's area is 160x108). */
export const W = 160;
export const H = 128;
export const BAR = 20; // status bar height
export const PW = 160; // program area
export const PH = 108;
const SCALE = 4; // canvases are drawn at 4x for crisp text

// (cell width, row height) per font; matches backend/vexsim/robots/iq2/brain.py
const FONTS: Record<string, [number, number]> = {
  mono12: [6, 12], mono15: [8, 15], mono20: [10, 20], mono30: [15, 30], mono40: [20, 40], mono60: [30, 60],
  prop20: [6, 20], prop30: [9, 30], prop40: [11, 40], prop60: [16, 60],
};
const MONO = '"DejaVu Sans Mono", "Menlo", "Consolas", monospace';
export const UI_FONT = '"Noto Sans", "Open Sans", "Helvetica Neue", Arial, sans-serif';

/** Colours sampled from the KB screen captures. */
export const UI = {
  status: "#adafad", title: "#e6e6e6", tile: "#ececec", tileEdge: "#2a2a2a", sel: "#151515",
  bar: "#151515", text: "#2b2b2b", blue: "#1a7be0", deep: "#0b4f9c", green: "#22b14c",
  orange: "#f6a020", grey: "#9a9a9a",
};

export function makeCanvas(w = W, h = H, bg = "#ffffff"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w * SCALE;
  c.height = h * SCALE;
  const g = c.getContext("2d")!;
  g.scale(SCALE, SCALE);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  return c;
}

/** The program's framebuffer (160x108): replays the drawing ops the worker sends. */
export class ProgramScreen {
  readonly canvas = makeCanvas(PW, PH);
  private g = this.canvas.getContext("2d")!;
  private clipped = false;

  apply(ops: ScreenOp[]): void {
    for (const op of ops) this.op(op);
  }

  clear(color = "#ffffff"): void {
    this.op({ o: "clr", c: color });
  }

  private op(op: ScreenOp): void {
    const g = this.g;
    switch (op.o) {
      case "clr":
        if (this.clipped) { g.restore(); this.clipped = false; }
        g.fillStyle = op.c ?? "#fff";
        g.fillRect(0, 0, PW, PH);
        break;
      case "clip":
        if (this.clipped) g.restore();
        g.save();
        g.beginPath();
        g.rect(op.x ?? 0, op.y ?? 0, op.w ?? PW, op.h ?? PH);
        g.clip();
        this.clipped = true;
        break;
      case "t": {
        const f = op.f ?? "mono20";
        const [cw, rh] = FONTS[f] ?? FONTS.mono20;
        const mono = f.startsWith("mono");
        const size = mono ? Math.min(rh * 0.85, cw / 0.6) : rh * 0.78;
        g.font = `${size}px ${mono ? MONO : UI_FONT}`;
        const text = op.s ?? "";
        const top = op.bl ? (op.y ?? 0) - rh * 0.8 : op.y ?? 0;
        const width = mono ? text.length * cw : g.measureText(text).width;
        if (op.b && op.b !== "transparent") {
          g.fillStyle = op.b;
          g.fillRect(op.x ?? 0, top, width, rh);
        }
        g.fillStyle = op.c ?? "#000";
        g.textBaseline = "middle";
        const mid = top + rh / 2;
        if (mono) {
          for (let i = 0; i < text.length; i++) g.fillText(text[i], (op.x ?? 0) + i * cw + cw * 0.05, mid);
        } else {
          g.fillText(text, op.x ?? 0, mid);
        }
        break;
      }
      case "r":
        if (op.fc && op.fc !== "transparent") { g.fillStyle = op.fc; g.fillRect(op.x!, op.y!, op.w!, op.h!); }
        if (op.pc && op.pc !== "transparent" && (op.pw ?? 1) > 0) {
          g.strokeStyle = op.pc; g.lineWidth = op.pw ?? 1;
          g.strokeRect(op.x! + 0.5, op.y! + 0.5, op.w! - 1, op.h! - 1);
        }
        break;
      case "c":
        g.beginPath();
        g.arc(op.x!, op.y!, op.r!, 0, Math.PI * 2);
        if (op.fc && op.fc !== "transparent") { g.fillStyle = op.fc; g.fill(); }
        if (op.pc && op.pc !== "transparent" && (op.pw ?? 1) > 0) { g.strokeStyle = op.pc; g.lineWidth = op.pw ?? 1; g.stroke(); }
        break;
      case "l":
        g.beginPath();
        g.moveTo(op.x!, op.y!);
        g.lineTo(op.x2!, op.y2!);
        g.strokeStyle = op.pc ?? "#000";
        g.lineWidth = Math.max(1, op.pw ?? 1);
        g.stroke();
        break;
      case "p":
        g.fillStyle = op.pc ?? "#000";
        g.fillRect(op.x!, op.y!, 1, 1);
        break;
    }
  }
}

/** Drawing helpers for the brain's own menus (logical 160x128 coordinates). */
export class Painter {
  constructor(readonly g: CanvasRenderingContext2D) {}

  fill(color: string, x = 0, y = 0, w = W, h = H): void {
    this.g.fillStyle = color;
    this.g.fillRect(x, y, w, h);
  }

  text(s: string, x: number, y: number, size = 10, color = UI.text, align: CanvasTextAlign = "left", bold = false): void {
    const g = this.g;
    g.font = `${bold ? "700 " : "500 "}${size}px ${UI_FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.fillText(s, x, y);
    g.textAlign = "left";
  }

  rect(x: number, y: number, w: number, h: number, fill: string, r = 0): void {
    const g = this.g;
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  }

  stroke(x: number, y: number, w: number, h: number, color: string, r = 0, width = 1): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.stroke();
  }

  tri(x: number, y: number, s: number, dir: 1 | -1, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - dir * s * 0.5, y - s * 0.6);
    g.lineTo(x + dir * s * 0.5, y);
    g.lineTo(x - dir * s * 0.5, y + s * 0.6);
    g.closePath();
    g.fill();
  }

  image(c: HTMLCanvasElement, x = 0, y = 0, w = W, h = H): void {
    this.g.drawImage(c, x, y, w, h);
  }
}
