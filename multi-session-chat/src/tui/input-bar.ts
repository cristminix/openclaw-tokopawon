import blessed from "blessed";

export class InputBar {
  private box: blessed.Widgets.BoxElement;
  private input: blessed.Widgets.TextboxElement;

  constructor(parent: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent,
      left: 0,
      right: 0,
      bottom: 1,
      height: 2,
    });

    this.input = blessed.textbox({
      parent: this.box,
      top: 0,
      left: 2,
      right: 2,
      height: 1,
      inputOnFocus: true,
      style: {
        fg: "white",
        bg: "black",
      },
    });
  }

  get element(): blessed.Widgets.TextboxElement {
    return this.input;
  }

  focus(): void {
    this.input.focus();
  }

  getValue(): string {
    return this.input.getValue() || "";
  }

  clear(): void {
    this.input.clearValue();
    this.input.setContent("");
  }

  onSubmit(callback: (value: string) => void): void {
    this.input.on("submit", () => {
      const val = this.getValue().trim();
      if (val) {
        callback(val);
      }
      this.clear();
      this.focus();
    });
  }
}
