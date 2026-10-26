import { repostTarget, type RepostTarget } from './adapter.ts';

export const REPOST_HOLD_MS = 600;
const MOVE_TOLERANCE = 10;
const RELEASE_CLICK_MS = 800;

interface Press extends RepostTarget {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  page: string;
}

export class RepostHold {
  private pending: Press | null = null;
  private completed: Press | null = null;
  private timer = 0;
  private poll = 0;
  private releaseTimer = 0;
  private disposed = false;
  private listeners = new AbortController();
  private observer: MutationObserver;
  private doc: Document;
  private win: Window;
  private navigate: (target: RepostTarget) => void;

  constructor(doc: Document, win: Window, navigate: (target: RepostTarget) => void) {
    this.doc = doc; this.win = win; this.navigate = navigate;
    this.observer = new MutationObserver(records => {
      const press = this.pending;
      if (press && records.some(record => [...record.removedNodes].some(node =>
        node === press.article || node.contains(press.button)))) this.cancel();
      this.reconcile();
    });
    const options = { signal: this.listeners.signal, capture: true };
    win.addEventListener('pointerdown', event => this.down(event), options);
    win.addEventListener('pointermove', event => this.move(event), options);
    win.addEventListener('pointerout', event => {
      const press = this.pending;
      if (press && event.pointerId === press.pointerId && !this.onButton(event.relatedTarget, press)) this.cancel();
    }, options);
    win.addEventListener('pointerup', event => this.up(event), options);
    win.addEventListener('pointercancel', event => {
      if (this.pending?.pointerId === event.pointerId) this.cancel();
      if (this.completed?.pointerId === event.pointerId) this.releaseCompleted();
    }, options);
    win.addEventListener('click', event => {
      const press = this.completed;
      if (!press || event.button !== 0 || event.detail === 0 || !this.onButton(event.target, press)) return;
      // Modern click is a PointerEvent; older compatibility clicks only carry a target.
      if ('pointerId' in event && event.pointerId !== press.pointerId) return;
      this.suppress(event); this.clearCompleted();
    }, options);
    win.addEventListener('contextmenu', event => {
      const press = this.pending ?? this.completed;
      if (press?.pointerType !== 'touch' || !this.onButton(event.target, press)) return;
      if ('pointerType' in event && event.pointerType !== 'touch') return;
      if ('pointerId' in event && event.pointerId !== press.pointerId) return;
      // A native touch menu can arrive before 600 ms and take over the gesture.
      this.suppress(event);
    }, options);
    for (const type of ['scroll', 'wheel', 'popstate', 'hashchange', 'pagehide', 'keydown']) {
      win.addEventListener(type, () => this.cancel(), { ...options, passive: true });
    }
    win.addEventListener('blur', event => { if (event.target === win) this.cancel(); }, options);
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.cancel(); }, options);
    const navigation = (win as Window & { navigation?: EventTarget }).navigation;
    for (const type of ['navigate', 'currententrychange']) navigation?.addEventListener(type, () => this.cancel(), options);
  }

  private onButton(target: EventTarget | null, press: Press): boolean {
    return target instanceof Node && press.button.contains(target);
  }

  private inside(press: Press): boolean {
    const rect = press.button.getBoundingClientRect();
    return press.x >= rect.left && press.x < rect.right && press.y >= rect.top && press.y < rect.bottom
      && this.onButton(this.doc.elementFromPoint(press.x, press.y), press);
  }

  private valid(press: Press): boolean {
    if (this.disposed || this.doc.hidden || this.win.location.href !== press.page
      || !press.button.isConnected || !press.article.isConnected) return false;
    const current = repostTarget(press.button);
    return current?.button === press.button && current.article === press.article
      && current.url === press.url && this.inside(press);
  }

  private down(event: PointerEvent) {
    this.cancel(); this.clearCompleted();
    if (event.button !== 0 || event.buttons !== 1 || !event.isPrimary || !['mouse', 'touch'].includes(event.pointerType)
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || this.doc.hidden) return;
    const target = repostTarget(event.target);
    if (!target) return;
    const press: Press = { ...target, pointerId: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      page: this.win.location.href };
    if (!this.valid(press)) return;
    this.pending = press;
    this.observer.observe(this.doc.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['href', 'data-testid', 'role', 'disabled', 'aria-disabled'] });
    this.poll = this.win.setInterval(() => this.reconcile(), 50);
    this.timer = this.win.setTimeout(() => {
      const current = this.pending;
      if (!current) return;
      const valid = this.valid(current);
      this.cancel();
      if (!valid) return;
      this.completed = current;
      this.navigate(current);
    }, REPOST_HOLD_MS);
  }

  private move(event: PointerEvent) {
    const press = this.pending;
    if (!press || event.pointerId !== press.pointerId) return;
    press.x = event.clientX; press.y = event.clientY;
    if (Math.hypot(press.x - press.startX, press.y - press.startY) > MOVE_TOLERANCE
      || event.buttons !== 1 || !this.valid(press)) this.cancel();
  }

  private up(event: PointerEvent) {
    if (this.pending?.pointerId === event.pointerId) this.cancel();
    if (this.completed?.pointerId !== event.pointerId || event.button !== 0) return;
    this.suppress(event); this.releaseCompleted();
  }

  private suppress(event: Event) {
    event.preventDefault(); event.stopImmediatePropagation();
  }

  private releaseCompleted() {
    this.win.clearTimeout(this.releaseTimer);
    this.releaseTimer = this.win.setTimeout(() => this.clearCompleted(), RELEASE_CLICK_MS);
  }

  private clearCompleted() {
    this.win.clearTimeout(this.releaseTimer); this.releaseTimer = 0; this.completed = null;
  }

  private cancel() {
    this.win.clearTimeout(this.timer); this.win.clearInterval(this.poll);
    this.timer = 0; this.poll = 0; this.pending = null; this.observer.disconnect();
  }

  reconcile() {
    if (this.pending && !this.valid(this.pending)) this.cancel();
  }

  dispose() {
    this.disposed = true; this.cancel(); this.clearCompleted(); this.listeners.abort();
  }
}
