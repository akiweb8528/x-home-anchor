import { countedRefreshDetails, isHome } from './adapter.ts';

const memoryKey = Symbol.for('x-home-anchor.refresh-total');
type PageMemory = Document & { [memoryKey]?: { total: bigint } };

export class RefreshTotal {
  private memory: { total: bigint };
  private host: HTMLElement;
  private value: HTMLElement;
  constructor(private doc: Document) {
    this.memory = (doc as PageMemory)[memoryKey] ??= { total: 0n };
    this.host = doc.createElement('div');
    this.host.id = 'x-home-new-post-total';
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'off');
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        top: 8px !important;
        left: 8px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        user-select: none !important;
        display: block !important;
        width: max-content !important;
        font: 0.8rem/1.4 system-ui, sans-serif !important;
      }
      :host([hidden]) { display: none !important; }
      span {
        display: block;
        padding: 2px 6px;
        border-radius: 3px;
        background: #303030;
        color: #f5f5f5;
        font: 0.8rem/1.4 system-ui, sans-serif;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        pointer-events: none;
      }
    `;
    this.value = doc.createElement('span');
    shadow.append(style, this.value);
    this.render();
  }
  private render() {
    const total = this.memory.total.toString();
    this.value.textContent = total;
    this.host.setAttribute('aria-label', `操作した新着表示ボタンの件数の累計: ${total}`);
  }
  show(home: boolean) {
    this.host.hidden = !home;
    // Outside body and the timeline; private text updates cannot notify either observer.
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
  }
  activate(event: MouseEvent, url: URL) {
    if (!event.isTrusted || !isHome(url)) return;
    const count = countedRefreshDetails(event.target, this.doc)?.displayedCount;
    if (count === undefined) return;
    this.memory.total += BigInt(count);
    this.render();
    this.show(true);
  }
  dispose() { this.host.remove(); }
}
