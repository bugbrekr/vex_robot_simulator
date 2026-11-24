import { EditorView, basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, keymap } from "@codemirror/view";
import { indentWithTab, redo, undo } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { ICONS } from "../ui/icons";
import { MenuBar, toast } from "../ui/menus";
import type { App } from "./app";
import {
  DEVICES, DEVICE_SHORT, type ExampleInfo, KEYS, type Project, SLOT_COUNT, TEMPLATES,
  loadProjects, newProject, saveProjects, store,
} from "./store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const icon = (name: keyof typeof ICONS, cls = "ico ico-sm") => `<span class="${cls}">${ICONS[name]}</span>`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- editor theme (Dark Modern-like)
const darkTheme = EditorView.theme({
  "&": { color: "#cccccc", backgroundColor: "#1f1f1f", height: "100%" },
  ".cm-content": { caretColor: "#aeafad", fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace', fontSize: "14px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#aeafad" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#264f78" },
  ".cm-gutters": { backgroundColor: "#1f1f1f", color: "#6e7681", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "#1f1f1f", color: "#cccccc" },
  ".cm-activeLine": { backgroundColor: "#ffffff08" },
  ".cm-matchingBracket": { backgroundColor: "#0064001a", outline: "1px solid #888" },
  ".cm-panels": { backgroundColor: "#252526", color: "#ccc" },
  ".cm-tooltip": { backgroundColor: "#252526", border: "1px solid #454545" },
  ".cm-error-line": { backgroundColor: "rgba(244, 71, 71, 0.18)" },
}, { dark: true });
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c586c0" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#c586c0" },
  { tag: [t.definitionKeyword, t.bool, t.null], color: "#569cd6" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#dcdcaa" },
  { tag: t.definition(t.variableName), color: "#9cdcfe" },
  { tag: [t.variableName, t.propertyName], color: "#9cdcfe" },
  { tag: t.className, color: "#4ec9b0" },
  { tag: [t.number], color: "#b5cea8" },
  { tag: [t.string, t.special(t.string)], color: "#ce9178" },
  { tag: t.comment, color: "#6a9955" },
  { tag: t.operator, color: "#d4d4d4" },
  { tag: t.self, color: "#569cd6" },
]);

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
        return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(tr.state.doc.line(e.value).from)]);
      }
    }
    return tr.docChanged ? Decoration.none : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface Problem { file: string; line: number | null; message: string }

/** Code tab: a VS Code + VEX extension look-alike for IQ (2nd gen) Python projects. */
export class CodeTab {
  private projects: Record<string, Project> = loadProjects();
  private current: string | null = store.get<string | null>(KEYS.openProject, null);
  private tabs: string[] = [];
  private active: string | null = null;
  private states = new Map<string, EditorState>();
  private view: EditorView;
  private sideView: "explorer" | "vex" = "vex";
  private collapsed = new Set<string>();
  private slot = store.get<number>(KEYS.slot, 1);
  private problems: Problem[] = [];
  private saveTimer = 0;
  private busy = false;
  private menubar: MenuBar;

  constructor(private app: App) {
    this.view = new EditorView({ parent: $("vsc-editor"), state: this.makeState("", "") });
    if (this.current && !this.projects[this.current]) this.current = null;
    if (this.current) this.openProject(this.current, store.get<string | null>(KEYS.openFile, null));
    else this.sideView = "vex";

    $("vsc-activity").querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      b.onclick = () => { this.sideView = b.dataset.view as "explorer" | "vex"; this.renderSide(); };
    });
    this.menubar = new MenuBar($("vsc-menubar"));
    this.buildMenus();
    this.wirePanel();

    app.on("slots", () => { this.renderSide(); this.renderStatus(); });
    app.on("config", () => this.renderSide());
    app.on("examples", () => this.renderSide());
    app.on("console", (text) => this.term("user", text));
    app.on("warning", (text) => this.term("user", `⚠ ${text}\n`, "c-warn"));
    app.on("error", (e) => {
      const slot = app.runningSlot ? app.slots[app.runningSlot] : null;
      this.term("user", `${e.traceback ?? ""}${e.message}${e.line ? `  (line ${e.line})` : ""}\n`, "c-error");
      this.problems = [{ file: slot ? `${slot.project}/${slot.file}` : "main.py", line: e.line, message: e.message }];
      this.renderProblems();
      if (slot && slot.project === this.current && slot.file === this.active) this.markError(e.line);
    });
    app.on("status", (s) => {
      if (s === "finished") this.term("user", "[program finished]\n", "c-info");
      if (s === "stopped") this.term("user", "[program stopped]\n", "c-info");
      this.renderStatus();
    });
    window.addEventListener("keydown", (e) => {
      if (!$("tab-code").classList.contains("active")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); this.flushSave(); toast("Saved"); }
    });
    this.renderAll();
  }

  // ------------------------------------------------------------ editor
  private makeState(doc: string, path: string): EditorState {
    const ext: Extension[] = [
      basicSetup, darkTheme, syntaxHighlighting(darkHighlight), errorLineField,
      keymap.of([indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.onEdit();
        if (u.selectionSet || u.docChanged) this.renderCursor();
      }),
    ];
    if (path.endsWith(".py")) ext.push(python());
    if (path.endsWith(".json")) ext.push(EditorState.tabSize.of(2));
    return EditorState.create({ doc, extensions: ext });
  }

  private onEdit(): void {
    if (!this.current || !this.active) return;
    const p = this.projects[this.current];
    p.files[this.active] = this.view.state.doc.toString();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
    this.renderTabs();
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer);
    if (this.current && this.active) this.states.set(this.active, this.view.state);
    saveProjects(this.projects);
  }

  private markError(line: number | null): void {
    this.view.dispatch({ effects: setErrorLine.of(line) });
    if (line && line <= this.view.state.doc.lines) {
      this.view.dispatch({ selection: { anchor: this.view.state.doc.line(line).from }, scrollIntoView: true });
    }
  }

  // ------------------------------------------------------------ projects & files
  private openProject(name: string, file: string | null = null): void {
    this.flushSave();
    this.current = name;
    store.set(KEYS.openProject, name);
    this.states.clear();
    this.tabs = [];
    const p = this.projects[name];
    this.openFile(file && p.files[file] !== undefined ? file : p.main);
    this.renderAll();
  }

  private openFile(path: string): void {
    if (!this.current) return;
    if (this.active) this.states.set(this.active, this.view.state);
    const p = this.projects[this.current];
    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.active = path;
    store.set(KEYS.openFile, path);
    const st = this.states.get(path) ?? this.makeState(p.files[path] ?? "", path);
    this.view.setState(st);
    this.renderTabs();
    this.renderSide();
    this.renderCursor();
  }

  private closeTab(path: string): void {
    if (this.active === path) this.states.set(path, this.view.state);
    this.tabs = this.tabs.filter((x) => x !== path);
    if (this.active === path) {
      this.active = null;
      if (this.tabs.length) this.openFile(this.tabs[this.tabs.length - 1]);
    }
    this.renderAll();
  }

  private uniqueName(base: string): string {
    const clean = base.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Project";
    let name = clean, i = 2;
    while (this.projects[name]) name = `${clean}_${i++}`;
    return name;
  }

  private createProject(p: Project): void {
    this.projects[p.name] = p;
    saveProjects(this.projects);
    this.sideView = "explorer";
    this.openProject(p.name);
    this.log(`[Info]  Created project ${p.name}`);
  }

  private deleteProject(name: string): void {
    if (!confirm(`Delete project "${name}" from this browser? This cannot be undone.`)) return;
    delete this.projects[name];
    saveProjects(this.projects);
    if (this.current === name) {
      this.current = null; this.active = null; this.tabs = [];
      store.set(KEYS.openProject, null);
      this.view.setState(this.makeState("", ""));
    }
    this.renderAll();
  }

  async openExample(ex: ExampleInfo): Promise<void> {
    const code = await this.app.exampleCode(ex.id);
    const name = this.uniqueName(ex.title.replace(/^Exp\s*(\d+):\s*/, "Exp$1_").replace(/\s+/g, ""));
    const p = newProject(name, ex.title, "");
    p.files["src/main.py"] = code;
    this.createProject(p);
    this.app.applyPreset(ex);
    if (ex.map && ex.map !== this.app.map) this.app.setMap(ex.map);
    toast(`Opened ${ex.title}: robot devices and map set up for it`);
  }

  // ------------------------------------------------------------ download / run
  private async download(): Promise<void> {
    if (this.busy) return;
    if (!this.current) { this.log("[Error] No VEX project is open", "c-error"); toast("Open or create a project first"); return; }
    this.flushSave();
    const p = this.projects[this.current];
    const file = p.main;
    const code = p.files[file];
    if (code === undefined) { this.log(`[Error] ${file} not found`, "c-error"); return; }
    if (!this.app.connected) { this.log("[Error] No device connected (simulator offline)", "c-error"); return; }
    this.busy = true;
    this.showTerm("log");
    const now = new Date().toLocaleTimeString();
    this.log(`[Info]  ${now}  Download started: project "${p.name}" to slot ${this.slot}`);
    await sleep(250);
    this.log(`[Info]  Python project, checking ${file} (${new Blob([code]).size} bytes)`);
    await sleep(300);
    this.log(`[Info]  Download User Program  ${p.name}.py -> IQ2 Brain slot ${this.slot}`);
    await sleep(450);
    this.app.download(this.slot, { project: p.name, file, code, downloaded: new Date().toISOString(), description: p.description });
    this.log("[Info]  Download Finished", "c-ok");
    $<HTMLPreElement>("vsc-term-user").textContent = ""; // cleared after build & download, like the extension
    this.busy = false;
    this.renderStatus();
  }

  private play(): void {
    const s = this.app.slots[this.slot];
    if (!s) { this.log(`[Error] Slot ${this.slot} is empty: download a program first`, "c-error"); this.showTerm("log"); return; }
    if (this.current === s.project && this.projects[s.project]?.files[s.file] !== s.code) {
      this.log(`[Warn]  ${s.project}/${s.file} changed since it was downloaded: slot ${this.slot} still has the old version`, "c-warn");
    }
    this.problems = [];
    this.renderProblems();
    this.markError(null);
    $<HTMLPreElement>("vsc-term-user").textContent = "";
    this.log(`[Info]  Run program in slot ${this.slot} (${s.project})`);
    if (this.app.runSlot(this.slot)) {
      this.showTerm("user");
      this.app.switchTab("sim");
    }
  }

  // ------------------------------------------------------------ terminal / problems
  private wirePanel(): void {
    const sel = $<HTMLSelectElement>("vsc-term-select");
    sel.onchange = () => this.showTerm(sel.value as "log" | "user");
    $("vsc-term-clear").onclick = () => { $(sel.value === "log" ? "vsc-term-log" : "vsc-term-user").textContent = ""; };
    $("vsc-panel").querySelectorAll<HTMLButtonElement>("[data-ptab]").forEach((b) => {
      b.onclick = () => {
        $("vsc-panel").querySelectorAll("[data-ptab]").forEach((x) => x.classList.toggle("on", x === b));
        const prob = b.dataset.ptab === "problems";
        $("vsc-problems").hidden = !prob;
        $("vsc-term-select").hidden = prob;
        $("vsc-term-clear").hidden = prob;
        if (prob) { $("vsc-term-log").hidden = $("vsc-term-user").hidden = true; } else this.showTerm(sel.value as "log" | "user");
      };
    });
    this.log("VEX Robotics extension (simulated) ready - IQ (2nd gen) Brain connected over the simulator", "c-info");
  }

  private showTerm(which: "log" | "user"): void {
    $<HTMLSelectElement>("vsc-term-select").value = which;
    $("vsc-panel").querySelectorAll("[data-ptab]").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.ptab === "terminal"));
    $("vsc-problems").hidden = true;
    $("vsc-term-select").hidden = $("vsc-term-clear").hidden = false;
    $("vsc-term-log").hidden = which !== "log";
    $("vsc-term-user").hidden = which !== "user";
  }

  private log(text: string, cls?: string): void {
    this.term("log", text + "\n", cls);
  }

  private term(which: "log" | "user", text: string, cls?: string): void {
    const el = $(which === "log" ? "vsc-term-log" : "vsc-term-user");
    text = text.replace(/\x1b\[2J/g, "\x0c").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const parts = text.split("\x0c");
    if (parts.length > 1) el.textContent = "";
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = parts[parts.length - 1];
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }

  private renderProblems(): void {
    const n = this.problems.length;
    const badge = $("vsc-problem-count");
    badge.hidden = !n;
    badge.textContent = String(n);
    $("vsc-problems").innerHTML = n
      ? this.problems.map((p, i) => `<div class="prob" data-i="${i}"><span class="perr">⊗</span> ${esc(p.message)} <span class="muted">${esc(p.file)}${p.line ? ` [Ln ${p.line}]` : ""}</span></div>`).join("")
      : `<div class="muted">No problems have been detected in the workspace.</div>`;
    $("vsc-problems").querySelectorAll<HTMLElement>(".prob").forEach((el) => {
      el.onclick = () => {
        const p = this.problems[Number(el.dataset.i)];
        const slot = this.app.runningSlot ? this.app.slots[this.app.runningSlot] : null;
        if (slot && this.projects[slot.project]) {
          if (this.current !== slot.project) this.openProject(slot.project, slot.file);
          else this.openFile(slot.file);
          this.markError(p.line);
        }
      };
    });
  }

  // ------------------------------------------------------------ menus & quick picks
  private buildMenus(): void {
    this.menubar.add("File", () => [
      { label: "New Project…", action: () => this.newProjectWizard() },
      { label: "Import Project…", action: () => this.importProject() },
      { separator: true },
      { label: "New File…", disabled: !this.current, action: () => this.newFile() },
      { label: "Save", shortcut: "Ctrl+S", action: () => { this.flushSave(); toast("Saved"); } },
      { label: "Download File to Computer", disabled: !this.active, action: () => this.exportFile() },
      { separator: true },
      { label: "Open Project", items: Object.keys(this.projects).length
        ? Object.keys(this.projects).map((n) => ({ label: n, action: () => this.openProject(n) }))
        : [{ label: "(no projects yet)", disabled: true }] },
      { label: "Open Lab Program", items: this.app.examples.map((ex) => ({ label: ex.title, action: () => void this.openExample(ex) })) },
      { separator: true },
      { label: "Close Project", disabled: !this.current, action: () => { this.current = null; this.tabs = []; this.active = null; store.set(KEYS.openProject, null); this.view.setState(this.makeState("", "")); this.renderAll(); } },
    ]);
    this.menubar.add("Edit", () => [
      { label: "Undo", shortcut: "Ctrl+Z", action: () => undo(this.view) },
      { label: "Redo", shortcut: "Ctrl+Y", action: () => redo(this.view) },
      { separator: true },
      { label: "Find", shortcut: "Ctrl+F", action: () => openSearchPanel(this.view) },
    ]);
    this.menubar.add("View", () => [
      { label: "Explorer", action: () => { this.sideView = "explorer"; this.renderSide(); } },
      { label: "VEX", action: () => { this.sideView = "vex"; this.renderSide(); } },
      { label: "Log Terminal", action: () => this.showTerm("log") },
      { label: "Interactive Terminal", action: () => this.showTerm("user") },
    ]);
    this.menubar.add("Run", () => [
      { label: "Download to Brain", action: () => void this.download() },
      { label: "Run Program on Brain", action: () => this.play() },
      { label: "Stop Program", action: () => this.app.stop() },
    ]);
    this.menubar.add("Help", () => [
      { label: "VEX IQ (2nd gen) Python API", action: () => window.open("https://api.vex.com/iq2/home/python/index.html", "_blank") },
      { label: "About this simulator", action: () => toast("A simulated VS Code + VEX extension for IQ (2nd gen) Python") },
    ]);
  }

  private quickPick<T>(title: string, items: { label: string; detail?: string; value: T; disabled?: boolean }[]): Promise<T | null> {
    return new Promise((resolve) => {
      document.querySelector(".vsc-quickpick")?.remove();
      const box = document.createElement("div");
      box.className = "vsc-quickpick";
      box.innerHTML = `<input placeholder="${esc(title)}"><div class="qp-list"></div>`;
      $("vsc").appendChild(box);
      const input = box.querySelector("input")!;
      const list = box.querySelector<HTMLElement>(".qp-list")!;
      let sel = 0;
      const shown = () => items.filter((i) => i.label.toLowerCase().includes(input.value.toLowerCase()));
      const draw = () => {
        const s = shown();
        sel = Math.min(sel, s.length - 1);
        list.innerHTML = s.map((i, k) => `<div class="qp-item ${k === sel ? "sel" : ""} ${i.disabled ? "dis" : ""}" data-k="${k}"><span>${esc(i.label)}</span>${i.detail ? `<span class="qp-detail">${esc(i.detail)}</span>` : ""}</div>`).join("");
        list.querySelectorAll<HTMLElement>(".qp-item").forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); pick(s[Number(el.dataset.k)]); }; });
      };
      const done = (v: T | null) => { box.remove(); resolve(v); };
      const pick = (i?: { value: T; disabled?: boolean }) => { if (i && !i.disabled) done(i.value); };
      input.oninput = () => { sel = 0; draw(); };
      input.onkeydown = (e) => {
        const s = shown();
        if (e.key === "ArrowDown") { sel = Math.min(s.length - 1, sel + 1); draw(); e.preventDefault(); }
        if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        if (e.key === "Enter") pick(s[sel]);
        if (e.key === "Escape") done(null);
      };
      input.onblur = () => setTimeout(() => { if (box.isConnected) done(null); }, 100);
      draw();
      input.focus();
    });
  }

  private async pickSlot(): Promise<void> {
    const v = await this.quickPick("Select a program slot on the brain", Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = this.app.slots[i + 1];
      return { label: `Slot ${i + 1}`, detail: s ? `${s.project}  ·  ${new Date(s.downloaded).toLocaleString()}` : "empty", value: i + 1 };
    }));
    if (v) { this.slot = v; store.set(KEYS.slot, v); this.renderStatus(); }
  }

  private async pickPythonFile(): Promise<void> {
    if (!this.current) return;
    const p = this.projects[this.current];
    const files = Object.keys(p.files).filter((f) => f.endsWith(".py"));
    const v = await this.quickPick("Select the Python file to download", files.map((f) => ({ label: f, value: f })));
    if (v) { p.main = v; saveProjects(this.projects); this.renderStatus(); }
  }

  private async pickProject(): Promise<void> {
    const v = await this.quickPick("Select a project", Object.keys(this.projects).map((n) => ({ label: n, detail: this.projects[n].description, value: n })));
    if (v) this.openProject(v);
  }

  // ------------------------------------------------------------ dialogs
  private newProjectWizard(): void {
    const dlg = $<HTMLDialogElement>("vsc-dialog");
    let step = 0;
    let template = TEMPLATES[0].id;
    let filter = "";
    const name = { value: this.uniqueName("IQ2Project"), description: "" };
    const platforms = [
      { id: "V5", label: "V5", ok: false }, { id: "EXP", label: "EXP", ok: false },
      { id: "IQ2", label: "IQ 2nd Generation", ok: true }, { id: "AIM", label: "AIM", ok: false },
    ];
    const draw = () => {
      const steps = ["Platform", "Language", "Template", "Details"];
      let body = "";
      if (step === 0) {
        body = `<div class="wiz-grid">${platforms.map((p) => `<button class="wiz-card ${p.ok ? "" : "dis"}" data-p="${p.id}" ${p.ok ? "" : "disabled title=\"Only IQ 2nd Generation is simulated\""}>
          ${icon("vexchip", "ico")}<span>${p.label}</span></button>`).join("")}</div>`;
      } else if (step === 1) {
        body = `<div class="wiz-grid two"><button class="wiz-card" data-l="python">${icon("code", "ico")}<span>Python</span></button>
          <button class="wiz-card dis" disabled title="Only Python is simulated">${icon("code", "ico")}<span>C++</span></button></div>`;
      } else if (step === 2) {
        const shown = TEMPLATES.filter((x) => (x.title + " " + x.tags).toLowerCase().includes(filter.toLowerCase()));
        body = `<input class="wiz-search" placeholder="Search templates" value="${esc(filter)}">
          <div class="wiz-list">${shown.map((x) => `<button class="wiz-row ${x.id === template ? "sel" : ""}" data-t="${x.id}"><b>${esc(x.title)}</b><span>${esc(x.description)}</span></button>`).join("")}</div>`;
      } else {
        body = `<label class="wiz-field">Project Name<input id="wiz-name" value="${esc(name.value)}"></label>
          <label class="wiz-field">Project Description<input id="wiz-desc" value="${esc(name.description)}" placeholder="Shown on the brain"></label>
          <label class="wiz-field">SDK version<select disabled><option>IQ2 Python (simulated)</option></select></label>
          <label class="wiz-field">Location<div class="wiz-loc"><input disabled value="~/Documents/vex-vscode-projects"><button disabled>Browse</button></div></label>`;
      }
      dlg.innerHTML = `<div class="wiz">
        <div class="wiz-head"><span>${icon("vexchip")} New Project</span><button class="wiz-x" data-close>${icon("close")}</button></div>
        <div class="wiz-steps">${steps.map((s, i) => `<span class="${i === step ? "on" : i < step ? "done" : ""}">${i + 1}. ${s}</span>`).join("")}</div>
        <div class="wiz-body">${body}</div>
        <div class="wiz-foot">${step > 0 ? `<button class="vbtn sec" data-back>Back</button>` : ""}<span class="grow"></span>
          ${step === 2 ? `<button class="vbtn" data-next>Next</button>` : ""}${step === 3 ? `<button class="vbtn" data-create>Create</button>` : ""}</div>
      </div>`;
      dlg.querySelector<HTMLElement>("[data-close]")!.onclick = () => dlg.close();
      dlg.querySelector<HTMLElement>("[data-back]")?.addEventListener("click", () => { step--; draw(); });
      dlg.querySelectorAll<HTMLElement>("[data-p]").forEach((b) => { b.onclick = () => { step = 1; draw(); }; });
      dlg.querySelectorAll<HTMLElement>("[data-l]").forEach((b) => { b.onclick = () => { step = 2; draw(); }; });
      dlg.querySelectorAll<HTMLElement>("[data-t]").forEach((b) => {
        b.onclick = () => { template = b.dataset.t!; draw(); };
        b.ondblclick = () => { template = b.dataset.t!; step = 3; draw(); };
      });
      const search = dlg.querySelector<HTMLInputElement>(".wiz-search");
      if (search) {
        search.oninput = () => { filter = search.value; const pos = search.selectionStart; draw(); const s2 = dlg.querySelector<HTMLInputElement>(".wiz-search")!; s2.focus(); s2.setSelectionRange(pos, pos); };
      }
      dlg.querySelector<HTMLElement>("[data-next]")?.addEventListener("click", () => { step = 3; draw(); });
      dlg.querySelector<HTMLElement>("[data-create]")?.addEventListener("click", () => {
        const n = (dlg.querySelector<HTMLInputElement>("#wiz-name")!.value || "IQ2Project").trim();
        const d = dlg.querySelector<HTMLInputElement>("#wiz-desc")!.value.trim();
        const pname = this.uniqueName(n);
        const tpl = TEMPLATES.find((x) => x.id === template)!;
        dlg.close();
        this.createProject(newProject(pname, d, tpl.body));
      });
    };
    draw();
    dlg.showModal();
  }

  private importProject(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".py,.iqpython,.txt";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      let code = await f.text();
      if (f.name.endsWith(".iqpython")) {
        try { code = JSON.parse(code).textContent ?? code; } catch { /* plain text */ }
      }
      const base = f.name.replace(/\.[^.]+$/, "");
      const p = newProject(this.uniqueName(base), `Imported from ${f.name}`, "");
      p.files["src/main.py"] = code;
      this.createProject(p);
    };
    input.click();
  }

  private newFile(): void {
    if (!this.current) return;
    const n = prompt("New file name (inside src/)", "helpers.py");
    if (!n) return;
    const path = `src/${n.replace(/^\/+/, "")}`;
    const p = this.projects[this.current];
    if (p.files[path] !== undefined) { toast("A file with that name already exists"); return; }
    p.files[path] = "";
    saveProjects(this.projects);
    this.openFile(path);
  }

  private deleteFile(path: string): void {
    if (!this.current || !confirm(`Delete ${path}?`)) return;
    const p = this.projects[this.current];
    delete p.files[path];
    if (p.main === path) p.main = Object.keys(p.files).find((f) => f.endsWith(".py")) ?? "src/main.py";
    saveProjects(this.projects);
    this.states.delete(path);
    this.closeTab(path);
  }

  private exportFile(): void {
    if (!this.active || !this.current) return;
    const blob = new Blob([this.view.state.doc.toString()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = this.active.split("/").pop()!;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------ rendering
  private renderAll(): void {
    this.renderSide();
    this.renderTabs();
    this.renderStatus();
    this.renderProblems();
    this.renderCursor();
  }

  private renderTabs(): void {
    const p = this.current ? this.projects[this.current] : null;
    const welcome = !p || !this.active;
    $("vsc-editor").hidden = welcome;
    $("vsc-welcome").hidden = !welcome;
    $("vsc-title-text").textContent = p ? `${this.active ? this.active.split("/").pop() + " — " : ""}${p.name} — VEX Workspace` : "VEX Workspace";
    if (welcome) {
      $("vsc-welcome").innerHTML = `<div class="welcome">
        <div class="w-logo">${icon("vexchip", "ico")}</div>
        <h2>VEX IQ (2nd gen) — Python</h2>
        <p>Create a project, write your program, download it to a slot on the brain, then run it on the simulated robot.</p>
        <div class="w-actions"><button class="vbtn" data-act="new">New Project</button><button class="vbtn sec" data-act="import">Import Project</button><button class="vbtn sec" data-act="lab">Open a Lab Program</button></div>
      </div>`;
      $("vsc-welcome").querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
        b.onclick = () => {
          if (b.dataset.act === "new") this.newProjectWizard();
          else if (b.dataset.act === "import") this.importProject();
          else { this.sideView = "vex"; this.renderSide(); }
        };
      });
    }
    $("vsc-tabs").innerHTML = p ? this.tabs.map((path) => `<div class="vtab ${path === this.active ? "on" : ""}" data-path="${esc(path)}">
      <span class="ftype ${path.endsWith(".py") ? "py" : "json"}">${path.endsWith(".py") ? "🐍" : "{}"}</span>${esc(path.split("/").pop()!)}
      <button class="vtab-x" title="Close">${icon("close")}</button></div>`).join("") : "";
    $("vsc-tabs").querySelectorAll<HTMLElement>(".vtab").forEach((el) => {
      el.onclick = () => this.openFile(el.dataset.path!);
      el.querySelector<HTMLElement>(".vtab-x")!.onclick = (e) => { e.stopPropagation(); this.closeTab(el.dataset.path!); };
    });
    $("vsc-crumbs").innerHTML = p && this.active ? [p.name, ...this.active.split("/")].map(esc).join(' <span class="sep">›</span> ') : "";
  }

  private renderSide(): void {
    $("vsc-activity").querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === this.sideView));
    const side = $("vsc-side");
    side.innerHTML = this.sideView === "explorer" ? this.explorerHtml() : this.vexHtml();
    side.querySelectorAll<HTMLElement>("[data-section]").forEach((h) => {
      h.onclick = () => { const k = h.dataset.section!; if (this.collapsed.has(k)) this.collapsed.delete(k); else this.collapsed.add(k); this.renderSide(); };
    });
    side.querySelectorAll<HTMLElement>("[data-file]").forEach((el) => { el.onclick = () => this.openFile(el.dataset.file!); });
    side.querySelectorAll<HTMLElement>("[data-delfile]").forEach((el) => { el.onclick = (e) => { e.stopPropagation(); this.deleteFile(el.dataset.delfile!); }; });
    side.querySelectorAll<HTMLElement>("[data-folder]").forEach((el) => {
      el.onclick = () => { const k = "dir:" + el.dataset.folder; if (this.collapsed.has(k)) this.collapsed.delete(k); else this.collapsed.add(k); this.renderSide(); };
    });
    side.querySelectorAll<HTMLElement>("[data-project]").forEach((el) => { el.onclick = () => this.openProject(el.dataset.project!); });
    side.querySelectorAll<HTMLElement>("[data-delproject]").forEach((el) => { el.onclick = (e) => { e.stopPropagation(); this.deleteProject(el.dataset.delproject!); }; });
    side.querySelectorAll<HTMLElement>("[data-example]").forEach((el) => {
      el.onclick = () => { const ex = this.app.examples.find((x) => x.id === el.dataset.example); if (ex) void this.openExample(ex); };
    });
    side.querySelectorAll<HTMLElement>("[data-eraseslot]").forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); const n = Number(el.dataset.eraseslot); if (confirm(`Erase the program in slot ${n}? This cannot be undone.`)) this.app.eraseSlot(n); };
    });
    side.querySelectorAll<HTMLElement>("[data-slotsel]").forEach((el) => {
      el.onclick = () => { this.slot = Number(el.dataset.slotsel); store.set(KEYS.slot, this.slot); this.renderStatus(); this.renderSide(); };
    });
    side.querySelector<HTMLElement>("[data-act=new]")?.addEventListener("click", () => this.newProjectWizard());
    side.querySelector<HTMLElement>("[data-act=import]")?.addEventListener("click", () => this.importProject());
    side.querySelector<HTMLElement>("[data-act=newfile]")?.addEventListener("click", (e) => { e.stopPropagation(); this.newFile(); });
    side.querySelector<HTMLElement>("[data-act=rename]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const n = prompt("Brain name", this.app.brainName);
      if (n) { this.app.brainName = n.slice(0, 16); store.set(KEYS.brainName, this.app.brainName); this.app.os.render(); this.renderSide(); }
    });
  }

  private section(key: string, title: string, body: string, actions = ""): string {
    const open = !this.collapsed.has(key);
    return `<div class="vs-section"><div class="vs-head" data-section="${key}"><span class="chev ${open ? "open" : ""}">›</span>${title}<span class="grow"></span>${actions}</div>${open ? `<div class="vs-body">${body}</div>` : ""}</div>`;
  }

  private explorerHtml(): string {
    if (!this.current) {
      return `<div class="vs-title">EXPLORER</div><div class="vs-empty">No folder opened.<br><br>
        <button class="vbtn" data-act="new">New Project</button><br><br><button class="vbtn sec" data-act="import">Import Project</button></div>`;
    }
    const p = this.projects[this.current];
    // folder tree
    const paths = Object.keys(p.files).sort((a, b) => {
      const da = a.includes("/") ? 0 : 1, db = b.includes("/") ? 0 : 1;
      return da - db || a.localeCompare(b);
    });
    const rows: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const parts = path.split("/");
      let hidden = false;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts.slice(0, i + 1).join("/");
        if (!seen.has(dir) && !hidden) {
          seen.add(dir);
          const open = !this.collapsed.has("dir:" + dir);
          rows.push(`<div class="tree-row" style="padding-left:${8 + i * 12}px" data-folder="${esc(dir)}"><span class="chev ${open ? "open" : ""}">›</span>${esc(parts[i])}</div>`);
        }
        if (this.collapsed.has("dir:" + dir)) hidden = true;
      }
      if (hidden) continue;
      const depth = parts.length - 1;
      const name = parts[parts.length - 1];
      const py = name.endsWith(".py");
      rows.push(`<div class="tree-row file ${path === this.active ? "on" : ""}" style="padding-left:${20 + depth * 12}px" data-file="${esc(path)}">
        <span class="ftype ${py ? "py" : "json"}">${py ? "🐍" : "{}"}</span>${esc(name)}${path === p.main ? '<span class="tag">download</span>' : ""}
        ${path.startsWith(".vscode/") ? "" : `<button class="row-act" title="Delete" data-delfile="${esc(path)}">${icon("trash")}</button>`}</div>`);
    }
    return `<div class="vs-title">EXPLORER</div>` +
      this.section("proj", esc(p.name.toUpperCase()), rows.join(""), `<button class="head-act" title="New File" data-act="newfile">${icon("newFile")}</button>`);
  }

  private vexHtml(): string {
    const actions = `<div class="vex-actions"><button class="vbtn wide" data-act="new">${icon("newFile")} New Project</button>
      <button class="vbtn wide sec" data-act="import">${icon("download")} Import Project</button></div>`;
    const cfg = this.app.config;
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = this.app.slots[i + 1];
      return `<div class="tree-row l3 ${this.slot === i + 1 ? "on" : ""}" data-slotsel="${i + 1}" title="Select slot ${i + 1}">${icon("slot")}Slot ${i + 1}: ${s ? `<b>${esc(s.project)}</b>` : '<span class="muted">empty</span>'}
        ${s ? `<button class="row-act" title="Erase program" data-eraseslot="${i + 1}">${icon("trash")}</button>` : ""}</div>`;
    }).join("");
    const devices = DEVICES.filter((d) => cfg[d].enabled).sort((a, b) => cfg[a].port - cfg[b].port)
      .map((d) => `<div class="tree-row l3">Port ${cfg[d].port}: ${DEVICE_SHORT[d]}${d.endsWith("motor") ? ` (${d === "left_motor" ? "left" : "right"})` : ""}</div>`).join("");
    const info = `<div class="tree-row l1">${icon("brain")}<b>IQ (2nd gen) Brain</b><span class="pill-ok">${this.app.connected ? "connected" : "offline"}</span></div>
      <div class="tree-row l2"><span class="chev open">›</span>System</div>
      <div class="tree-row l3">Name: ${esc(this.app.brainName)} <button class="row-act show" title="Set brain name" data-act="rename">✎</button></div>
      <div class="tree-row l3">VEXos: simulated · Python runtime</div>
      <div class="tree-row l2"><span class="chev open">›</span>Programs</div>${slots}
      <div class="tree-row l2"><span class="chev open">›</span>Devices</div>${devices || '<div class="tree-row l3 muted">no devices plugged in</div>'}`;
    const groups = new Map<string, ExampleInfo[]>();
    for (const ex of this.app.examples) groups.set(ex.group, [...(groups.get(ex.group) ?? []), ex]);
    const labs = [...groups].sort(([a], [b]) => (a === "Lab Programs" ? -1 : b === "Lab Programs" ? 1 : a.localeCompare(b))).map(([g, list]) =>
      `<div class="tree-row l1 muted">${esc(g)}</div>` + list.map((ex) => `<div class="tree-row l2 link" data-example="${ex.id}" title="Open as a new project (also sets up the robot's devices and the map)">
        ${icon(g === "Lab Programs" ? "flask" : "files")}${esc(ex.title)}${ex.exam === false ? '<span class="tag">not in exam</span>' : ""}</div>`).join("")).join("");
    const projects = Object.keys(this.projects).map((n) => `<div class="tree-row l1 ${n === this.current ? "on" : ""}" data-project="${esc(n)}">${icon("folder")}${esc(n)}
      <button class="row-act" title="Delete project" data-delproject="${esc(n)}">${icon("trash")}</button></div>`).join("") || '<div class="tree-row l1 muted">No projects yet</div>';
    return `<div class="vs-title">VEX</div>` +
      this.section("actions", "PROJECT ACTIONS", actions) +
      this.section("device", "VEX DEVICE INFO", info) +
      this.section("labs", "LAB PROGRAMS", labs || '<div class="tree-row l1 muted">loading…</div>') +
      this.section("projects", "PROJECTS", projects);
  }

  private renderStatus(): void {
    const p = this.current ? this.projects[this.current] : null;
    const running = this.app.runState === "running";
    const s = this.app.slots[this.slot];
    $("vsc-status").innerHTML = `
      <button class="st-item st-device" data-st="device" title="Device Picker">${icon("brain")} IQ2 Brain (sim)</button>
      <button class="st-item" data-st="slot" title="Slot Selector${s ? `: ${s.project}` : ""}">Slot ${this.slot}</button>
      <button class="st-item" data-st="download" title="Download to the brain">${icon("download")}</button>
      <button class="st-item" data-st="play" title="Run the program in the selected slot">${icon("run")}</button>
      <button class="st-item ${running ? "" : "dim"}" data-st="stop" title="Stop">${icon("stop")}</button>
      ${p ? `<button class="st-item" data-st="project" title="Project Selector">${icon("folder")} ${esc(p.name)}</button>
      <button class="st-item" data-st="pyfile" title="Python File Selector">${icon("files")} ${esc(p.main.split("/").pop()!)}</button>` : ""}
      ${running ? `<span class="st-item st-run">● running slot ${this.app.runningSlot ?? ""}</span>` : ""}
      <span class="grow"></span>
      <span class="st-item" id="vsc-cursor"></span>
      <span class="st-item">Spaces: 4</span><span class="st-item">UTF-8</span><span class="st-item">${this.active?.endsWith(".json") ? "JSON" : "Python"}</span>`;
    const act: Record<string, () => void> = {
      device: () => void this.quickPick("Select a device", [{ label: "IQ (2nd gen) Brain — simulator", detail: this.app.connected ? "connected" : "offline", value: 1 }]),
      slot: () => void this.pickSlot(),
      download: () => void this.download(),
      play: () => this.play(),
      stop: () => this.app.stop(),
      project: () => void this.pickProject(),
      pyfile: () => void this.pickPythonFile(),
    };
    $("vsc-status").querySelectorAll<HTMLElement>("[data-st]").forEach((b) => { b.onclick = () => act[b.dataset.st!]?.(); });
    this.renderCursor();
  }

  private renderCursor(): void {
    const el = document.getElementById("vsc-cursor");
    if (!el) return;
    if (!this.active) { el.textContent = ""; return; }
    const pos = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(pos);
    el.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
  }
}
