// Scroll events precede animation callbacks. A page can scroll in a later rAF,
// so an event-only correction can miss that paint. This refresh-only size probe
// schedules a ResizeObserver checkpoint after rAF without changing page APIs/CSS.
export class RefreshPaintGuard {
  private frame = 0;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  constructor(private doc: Document, private win: Window, private check: () => void, private active: () => boolean) {}
  start() {
    if (this.host) return;
    const host = this.doc.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:1px!important;height:1px!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;contain:strict!important;';
    const probe = this.doc.createElement('div');
    probe.style.cssText = 'width:1px;height:1px';
    host.attachShadow({ mode: 'closed' }).append(probe);
    this.host = host; this.doc.documentElement.append(host);
    this.observer = new ResizeObserver(() => {
      this.check();
      if (!this.active()) this.stop();
    });
    this.observer.observe(probe);
    let width = 1;
    const pulse = () => {
      if (!this.active()) { this.stop(); return; }
      probe.style.width = `${width = 3 - width}px`;
      this.frame = this.win.requestAnimationFrame(pulse);
    };
    this.frame = this.win.requestAnimationFrame(pulse);
  }
  stop() {
    this.win.cancelAnimationFrame(this.frame); this.frame = 0;
    this.observer?.disconnect(); this.observer = null;
    this.host?.remove(); this.host = null;
  }
  get running() { return this.host !== null; }
}
