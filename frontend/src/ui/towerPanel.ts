import type { ClientMsg, TowerSnapshot } from "../net/protocol";

const CSS: Record<string, string> = {
  red: "#ff2a2a", yellow: "#ffd21f", green: "#22dd55", blue: "#2a7bff", white: "#ffffff",
};

/** 2D Signal Tower widget with a press-and-hold bumper. */
export class TowerPanel {
  private leds = new Map<string, HTMLElement>();

  constructor(el: HTMLElement, colors: string[], send: (m: ClientMsg) => void) {
    el.innerHTML = "";
    const stack = document.createElement("div");
    stack.className = "tower-stack";
    const bumper = document.createElement("button");
    bumper.className = "tower-bumper";
    bumper.textContent = "bumper";
    bumper.title = "Press and hold: Signal Tower bumper";
    const press = (p: boolean) => (e: Event) => { e.preventDefault(); send({ type: "bumper", pressed: p }); };
    bumper.addEventListener("pointerdown", press(true));
    bumper.addEventListener("pointerup", press(false));
    bumper.addEventListener("pointerleave", (e) => { if ((e as PointerEvent).buttons) press(false)(e); });
    stack.appendChild(bumper);
    for (const c of colors) {
      const d = document.createElement("div");
      d.className = "tower-led";
      d.style.setProperty("--led", CSS[c]);
      d.title = c;
      this.leds.set(c, d);
      stack.appendChild(d);
    }
    el.appendChild(stack);
  }

  update(s: TowerSnapshot): void {
    for (const [c, d] of this.leds) {
      d.classList.toggle("lit", !!s.lit[c]);
      d.dataset.state = s.leds[c];
    }
  }
}
