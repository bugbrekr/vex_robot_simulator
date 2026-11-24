import type { ClientMsg, ServerMsg } from "./protocol";

type Handler = (msg: ServerMsg) => void;

/** A random id per browser (not per tab). The server only counts distinct ids. */
function clientId(): string {
  const key = "vexsim:client";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "";
  }
}

/** WebSocket client with auto-reconnect. */
export class SimSession {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private queue: ClientMsg[] = [];
  onOpen: () => void = () => {};
  private retryMs = 1000;
  onClose: () => void = () => {};

  /** `base` is the app root relative to the page ("" for the CTE page, "../" for iq2/). */
  constructor(private platform: string, private base = "") {
    this.connect();
  }

  private connect(): void {
    // relative to the page, so the app works under any reverse-proxy prefix
    const url = new URL(`${this.base}ws/${this.platform}`, location.href);
    url.searchParams.set("cid", clientId()); // anonymous; lets the server count distinct browsers
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.onClose();
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(10000, this.retryMs * 1.6); // back off while the server is down
    };
  }

  on(h: Handler): void {
    this.handlers.push(h);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }
}
