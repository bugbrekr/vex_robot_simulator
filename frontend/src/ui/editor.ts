import { EditorView, basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, keymap } from "@codemirror/view";
import { indentWithTab, redo, selectAll, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
        const line = tr.state.doc.line(e.value);
        return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)]);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class CodeEditor {
  readonly view: EditorView;

  constructor(host: HTMLElement, onChange: (code: string) => void, onRun: () => void) {
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          basicSetup,
          python(),
          keymap.of([indentWithTab, { key: "Mod-Enter", run: () => { onRun(); return true; } }]),
          errorLineField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
            if (u.selectionSet && u.view.hasFocus) this.placedCursor = true;
          }),
        ],
      }),
    });
  }

  get code(): string {
    return this.view.state.doc.toString();
  }

  set code(text: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  private placedCursor = false;

  insertAtCursor(text: string): void {
    if (!this.placedCursor) {
      // no cursor placed yet: append at the end of the program
      const doc = this.view.state.doc;
      const insert = (doc.length && !doc.toString().endsWith("\n") ? "\n" : "") + text + "\n";
      this.view.dispatch({ changes: { from: doc.length, insert }, selection: { anchor: doc.length + insert.length }, scrollIntoView: true });
      return;
    }
    const { from } = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(from);
    // insert as a new line below the cursor's line, keeping its indentation
    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const insert = (line.text.trim() ? "\n" : "") + indent + text;
    const at = line.text.trim() ? line.to : line.from;
    this.view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true });
    this.view.focus();
  }

  undo(): void { undo(this.view); }
  redo(): void { redo(this.view); }
  selectAll(): void { selectAll(this.view); this.view.focus(); }
  find(): void { openSearchPanel(this.view); }

  markError(line: number | null): void {
    this.view.dispatch({ effects: setErrorLine.of(line) });
    if (line && line <= this.view.state.doc.lines) {
      const pos = this.view.state.doc.line(line).from;
      this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    }
  }
}
