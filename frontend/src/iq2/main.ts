import "../styles.css";
import "./iq2.css";
import { ICONS } from "../ui/icons";
import { App } from "./app";
import { BuildTab } from "./buildTab";
import { CodeTab } from "./codeTab";
import { KEYS, store } from "./store";
import { SimTab } from "./simTab";

document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = ICONS[el.dataset.icon as keyof typeof ICONS] ?? "";
});

const app = new App();
new BuildTab(app);
new CodeTab(app);
new SimTab(app);

const TABS = ["build", "code", "sim"];
function showTab(name: string): void {
  if (!TABS.includes(name)) name = "code";
  for (const t of TABS) {
    document.getElementById(`tab-${t}`)!.classList.toggle("active", t === name);
    document.querySelector(`[data-tab="${t}"]`)!.classList.toggle("on", t === name);
  }
  store.set(KEYS.tab, name);
  window.dispatchEvent(new Event("resize"));
}
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab!); });
app.on("tab", showTab);
showTab(store.get<string>(KEYS.tab, "build"));

const pill = document.getElementById("run-pill")!;
const setPill = () => {
  const s = app.runState;
  pill.textContent = !app.connected ? "Offline" : s === "running" ? `Running${app.runningSlot ? ` · slot ${app.runningSlot}` : ""}` : s === "idle" ? "Ready" : s === "finished" ? "Finished" : "Stopped";
  pill.className = `run-pill ${app.connected ? s : "offline"}`;
};
app.on("status", setPill);
app.on("hello", setPill);
setInterval(setPill, 1000);
