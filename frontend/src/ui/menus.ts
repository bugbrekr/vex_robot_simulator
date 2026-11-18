export interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  items?: MenuItem[]; // submenu
}

/** Toolbar dropdown menus (File / Edit / Tools / Help), VEXcode style. */
export class MenuBar {
  private open: HTMLElement | null = null;

  constructor(private host: HTMLElement) {
    document.addEventListener("pointerdown", (e) => {
      if (this.open && !this.host.contains(e.target as Node)) this.close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
  }

  add(label: string, items: () => MenuItem[]): void {
    const wrap = document.createElement("div");
    wrap.className = "menu";
    const btn = document.createElement("button");
    btn.className = "menu-btn";
    btn.textContent = label;
    wrap.appendChild(btn);
    btn.onclick = () => {
      const wasOpen = this.open === wrap;
      this.close();
      if (wasOpen) return;
      wrap.appendChild(this.build(items()));
      wrap.classList.add("open");
      this.open = wrap;
    };
    btn.onpointerenter = () => { if (this.open && this.open !== wrap) btn.click(); };
    this.host.appendChild(wrap);
  }

  private build(items: MenuItem[]): HTMLElement {
    const list = document.createElement("div");
    list.className = "menu-list";
    for (const it of items) {
      if (it.separator) { list.appendChild(Object.assign(document.createElement("hr"), {})); continue; }
      const row = document.createElement("button");
      row.className = "menu-item";
      row.disabled = !!it.disabled;
      row.innerHTML = `<span>${it.label}</span>${it.shortcut ? `<kbd>${it.shortcut}</kbd>` : ""}${it.items ? "<kbd>▸</kbd>" : ""}`;
      if (it.items) {
        row.classList.add("has-sub");
        const sub = this.build(it.items);
        sub.classList.add("sub");
        row.appendChild(sub);
      } else {
        row.onclick = () => { this.close(); it.action?.(); };
      }
      list.appendChild(row);
    }
    return list;
  }

  close(): void {
    if (!this.open) return;
    this.open.classList.remove("open");
    this.open.querySelector(".menu-list")?.remove();
    this.open = null;
  }
}

export function toast(text: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2200);
}
