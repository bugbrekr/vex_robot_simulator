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
    // print("\033[2J") clears the console in VEXcode (used throughout the CTE docs); other ANSI
    // escape sequences (cursor home, colours) are dropped
    text = text.replace(/\x1b\[2J/g, "\x0c").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
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
