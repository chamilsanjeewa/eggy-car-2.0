export class Input {
  gas = false;
  brake = false;
  private keys = new Set<string>();
  private touchGas = false;
  private touchBrake = false;

  constructor(gasBtn: HTMLElement, brakeBtn: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      this.refresh();
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.refresh();
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.touchGas = this.touchBrake = false;
      this.refresh();
    });

    this.bindPedal(gasBtn, (v) => (this.touchGas = v));
    this.bindPedal(brakeBtn, (v) => (this.touchBrake = v));
  }

  private bindPedal(el: HTMLElement, set: (v: boolean) => void): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      set(true);
      el.classList.add("active");
      this.refresh();
    };
    const up = () => {
      set(false);
      el.classList.remove("active");
      this.refresh();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private refresh(): void {
    const k = this.keys;
    this.gas = this.touchGas || k.has("arrowright") || k.has("d") || k.has("arrowup") || k.has("w");
    this.brake = this.touchBrake || k.has("arrowleft") || k.has("a") || k.has("arrowdown") || k.has("s");
  }
}
