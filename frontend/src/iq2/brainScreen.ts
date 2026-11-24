import type { ScreenOp } from "../net/protocol";

export const W = 160;
export const H = 108;
const SCALE = 4; // canvases are drawn at 4x for crisp text

// (cell width, row height) per font; matches backend/vexsim/robots/iq2/brain.py
const FONTS: Record<string, [number, number]> = {
  mono12: [6, 12], mono15: [8, 15], mono20: [10, 20], mono30: [15, 30], mono40: [20, 40], mono60: [30, 60],
  prop20: [6, 20], prop30: [9, 30], prop40: [11, 40], prop60: [16, 60],
};
const MONO = '"DejaVu Sans Mono", "Menlo", "Consolas", monospace';
const PROP = '"Open Sans", "Helvetica Neue", Arial, sans-serif';

export function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext("2d")!;
  g.scale(SCALE, SCALE);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  return c;
}

/** The program's framebuffer: replays the drawing ops the worker sends. */
export class ProgramScreen {
  readonly canvas = makeCanvas();
  private g = this.canvas.getContext("2d")!;
  private clipped = false;

  apply(ops: ScreenOp[]): void {
    for (const op of ops) this.op(op);
  }

  clear(color = "#000000"): void {
    this.op({ o: "clr", c: color });
  }

  private op(op: ScreenOp): void {
    const g = this.g;
    switch (op.o) {
      case "clr":
        if (this.clipped) { g.restore(); this.clipped = false; }
        g.fillStyle = op.c ?? "#000";
        g.fillRect(0, 0, W, H);
        break;
      case "clip":
        if (this.clipped) g.restore();
        g.save();
        g.beginPath();
        g.rect(op.x ?? 0, op.y ?? 0, op.w ?? W, op.h ?? H);
        g.clip();
        this.clipped = true;
        break;
      case "t": {
        const f = op.f ?? "mono20";
        const [cw, rh] = FONTS[f] ?? FONTS.mono20;
        const mono = f.startsWith("mono");
        const size = mono ? Math.min(rh * 0.85, cw / 0.6) : rh * 0.78;
        g.font = `${size}px ${mono ? MONO : PROP}`;
        const text = op.s ?? "";
        const top = op.bl ? (op.y ?? 0) - rh * 0.8 : op.y ?? 0;
        const width = mono ? text.length * cw : g.measureText(text).width;
        if (op.b && op.b !== "transparent") {
          g.fillStyle = op.b;
          g.fillRect(op.x ?? 0, top, width, rh);
        }
        g.fillStyle = op.c ?? "#fff";
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
        g.strokeStyle = op.pc ?? "#fff";
        g.lineWidth = Math.max(1, op.pw ?? 1);
        g.stroke();
        break;
      case "p":
        g.fillStyle = op.pc ?? "#fff";
        g.fillRect(op.x!, op.y!, 1, 1);
        break;
    }
  }
}

/** Small drawing helpers for the brain's own menus (logical 160x108 coordinates). */
export class Painter {
  constructor(readonly g: CanvasRenderingContext2D) {}

  bg(color = "#14171a"): void {
    this.g.fillStyle = color;
    this.g.fillRect(0, 0, W, H);
  }

  text(s: string, x: number, y: number, size = 10, color = "#fff", align: CanvasTextAlign = "left", bold = false): void {
    const g = this.g;
    g.font = `${bold ? "700 " : ""}${size}px ${PROP}`;
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

  stroke(x: number, y: number, w: number, h: number, color: string, r = 0, width = 1.2): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.stroke();
  }

  image(c: HTMLCanvasElement): void {
    this.g.drawImage(c, 0, 0, W, H);
  }
}
