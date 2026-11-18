/** Print Console: student output, simulator warnings, errors. */
export class ConsolePanel {
  constructor(private el: HTMLElement) {}

  clear(): void {
    this.el.textContent = "";
  }

  private append(text: string, cls?: string): void {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    this.el.appendChild(span);
    this.el.scrollTop = this.el.scrollHeight;
  }

  print(text: string): void {
    const parts = text.split("\x0c"); // form feed = brain.clear()
    if (parts.length > 1) this.clear();
    this.append(parts[parts.length - 1]);
  }

  warn(text: string): void {
    this.append(`⚠ ${text}\n`, "c-warn");
  }

  error(text: string): void {
    this.append(`${text}\n`, "c-error");
  }

  info(text: string): void {
    this.append(`${text}\n`, "c-info");
  }
}
