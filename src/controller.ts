import { clickIntent, isHome, readPosts, refreshDetails, timelineKind, timelineRoot, timelineViewportTop } from './adapter.ts';
import { RefreshPaintGuard } from './refresh-paint-guard.ts';
import { RefreshTotal } from './refresh-total.ts';
import { RepostHold } from './repost-hold.ts';
import { openQuotes } from './quote-navigation.ts';
import { PositionKeeper, INPUT_QUIET_MS } from './position.ts';
import type { PostSample, State, Timeline } from './model.ts';

export class HomeController {
  private kind: Timeline | null = null;
  private root: HTMLElement | null = null;
  private keeper: PositionKeeper;
  private paintGuard: RefreshPaintGuard;
  private refreshTotal: RefreshTotal;
  private repostHold: RepostHold;
  private state: State = 'outside';
  private overLimit = false;
  private frame = 0;
  private settleTimer = 0;
  private expiryTimer = 0;
  private poll = 0;
  private disposed = false;
  private coveredPointer: number | null = null;
  private coveredClickUntil = 0;
  private lifecycle = new AbortController();
  private inputs: AbortController | null = null;
  private rootObserver: MutationObserver;
  private resizeObserver: ResizeObserver;
  private pageObserver: MutationObserver;
  private measured = new Set<HTMLElement>();
  private lastPath = '';
  private lastKind: Timeline | null = null;
  constructor(private doc: Document, private win: Window) {
    this.keeper = new PositionKeeper(win);
    this.paintGuard = new RefreshPaintGuard(doc, win, () => this.checkScroll(), () => this.keeper.refreshing);
    this.refreshTotal = new RefreshTotal(doc);
    this.repostHold = new RepostHold(doc, win, target => {
      this.keeper.interrupt(); this.detach();
      openQuotes(target, this.lifecycle.signal);
    });
    this.rootObserver = new MutationObserver(() => { this.reconcile(); this.flush(); });
    this.resizeObserver = new ResizeObserver(() => {
      // ResizeObserver runs before paint; avoid deferring a late image's correction a frame.
      if (this.root && this.isCurrent()) this.flush();
    });
    this.pageObserver = new MutationObserver(records => {
      if (this.root && !this.root.isConnected) { this.reconcile(); return; }
      if (this.root?.isConnected && this.lastPath === win.location.pathname && records.every(r => this.root!.contains(r.target))) return;
      this.schedule();
    });
    this.pageObserver.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-label'] });
    const signal = this.lifecycle.signal;
    // A frozen post must not activate a different post now underneath it.
    win.addEventListener('pointerdown', event => {
      this.coveredPointer = null;
      if (!this.paintGuard.contains(event.target)) return;
      this.coveredPointer = event.pointerId; this.coveredClickUntil = performance.now() + 1000;
      event.preventDefault(); event.stopImmediatePropagation();
      this.keeper.input(); this.paintGuard.stop(); this.settle();
    }, { signal, capture: true });
    win.addEventListener('click', event => {
      if (this.coveredPointer === null || event.detail === 0 || performance.now() > this.coveredClickUntil
        || event instanceof PointerEvent && event.pointerId !== this.coveredPointer) return;
      this.coveredPointer = null;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { signal, capture: true });
    win.addEventListener('pointercancel', () => { this.coveredPointer = null; }, { signal, capture: true });
    win.addEventListener('click', event => this.refreshTotal.activate(event, new URL(win.location.href)), { signal, capture: true });
    win.addEventListener('popstate', () => this.reconcile(), { signal });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) this.keeper.interrupt();
      this.reconcile();
    }, { signal });
    // Location-only fallback covers SPA pushState without patching the site's History API.
    this.poll = win.setInterval(() => {
      if (this.lastPath !== win.location.pathname || !this.root?.isConnected) this.reconcile();
    }, 500);
    this.reconcile();
  }
  private isCurrent() {
    return isHome(new URL(this.win.location.href)) && timelineKind(this.doc) === this.kind && !this.doc.hidden;
  }
  private currentSample(): PostSample | null {
    if (!this.root?.isConnected || timelineRoot(this.doc) !== this.root) return null;
    return readPosts(this.root);
  }
  private schedule() {
    if (this.frame || this.disposed) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.reconcile();
    });
  }
  private detach(preservePaint = false) {
    this.rootObserver.disconnect(); this.resizeObserver.disconnect(); this.measured.clear();
    this.inputs?.abort(); this.inputs = null;
    this.win.clearTimeout(this.settleTimer); this.win.clearTimeout(this.expiryTimer);
    this.root = null;
    if (!preservePaint) this.paintGuard.stop();
  }
  private settle() {
    this.win.clearTimeout(this.settleTimer);
    this.settleTimer = this.win.setTimeout(() => {
      if (!this.root || !this.isCurrent()) return;
      const sample = this.currentSample();
      if (sample?.overLimit) { this.keeper.interrupt(); this.paintGuard.stop(); return; }
      if (!sample) this.keeper.changed([], { boxes: [] });
      this.keeper.tick(sample?.posts ?? [], { boxes: sample?.boxes ?? [] });
    }, INPUT_QUIET_MS + 100);
  }
  private expireCorrection() {
    this.win.clearTimeout(this.expiryTimer);
    if (this.keeper.correcting) this.expiryTimer = this.win.setTimeout(() => {
      if (this.isCurrent()) {
        const sample = this.currentSample();
        if (sample?.overLimit) { this.keeper.interrupt(); this.paintGuard.stop(); return; }
        if (!sample) this.keeper.changed([], { boxes: [] });
        this.keeper.tick(sample?.posts ?? [], { boxes: sample?.boxes ?? [] });
        this.expireCorrection(); this.settle();
      }
    }, this.keeper.remainingMs + 1);
  }
  private attach(root: HTMLElement) {
    this.root = root;
    this.rootObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-testid', 'role'] });
    this.inputs = new AbortController();
    const signal = this.inputs.signal;
    const interrupt = () => {
      this.keeper.input();
      this.paintGuard.stop(); this.settle();
    };
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) this.win.addEventListener(type, interrupt, { signal, passive: true, capture: true });
    this.win.addEventListener('resize', interrupt, { signal, passive: true });
    this.win.addEventListener('keydown', event => {
      if (this.paintGuard.running || ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'j', 'k'].includes(event.key)) interrupt();
    }, { signal, capture: true });
    this.win.addEventListener('click', event => {
      const intent = clickIntent(event.target);
      if (intent === 'refresh' && event.isTrusted && this.root && this.isCurrent() && this.state === 'active') {
        const sample = this.currentSample();
        if (!sample || sample.overLimit) { this.keeper.interrupt(); this.paintGuard.stop(); return; }
        const viewportTop = timelineViewportTop(this.root, this.win);
        const control = event.target instanceof Element ? event.target.closest('a, button, [role="button"], [role="tab"]') : null;
        const boundary = sample.posts.find(post => post.top >= (control?.getBoundingClientRect().bottom ?? Infinity));
        this.keeper.refresh(sample.posts, { boxes: sample.boxes, ...refreshDetails(event.target), boundary: boundary ? { id: boundary.id, top: viewportTop } : undefined });
        this.expireCorrection(); if (this.keeper.refreshing) this.paintGuard.start(this.root, viewportTop);
      } else if (intent === 'navigate') { this.keeper.interrupt(); this.paintGuard.stop(); }
      this.settle();
    }, { signal, capture: true });
    this.win.addEventListener('scroll', () => { this.checkScroll(); this.settle(); }, { signal, passive: true });
    this.flush();
  }
  private checkScroll() {
    if (!this.isCurrent()) {
      this.keeper.interrupt(); this.paintGuard.stop(); return;
    }
    let sample: PostSample | null = null;
    const current = () => {
      if (!sample && this.root) { sample = this.currentSample(); }
      if (sample?.overLimit) { this.keeper.interrupt(); return null; }
      return sample;
    };
    this.keeper.scrolled(() => current()?.posts ?? [], () => ({ boxes: current()?.boxes ?? [] }));
    if (!this.keeper.refreshing) this.paintGuard.finish();
  }
  reconcile() {
    if (this.disposed) return;
    this.repostHold.reconcile();
    this.lastPath = this.win.location.pathname;
    const home = isHome(new URL(this.win.location.href));
    this.refreshTotal.show(home);
    const kind = home ? timelineKind(this.doc) : null;
    const root = home ? timelineRoot(this.doc) : null;
    if (kind !== this.lastKind || !home) {
      this.keeper.interrupt(); this.detach();
    }
    this.kind = kind; this.lastKind = kind;
    this.state = !home ? 'outside' : !kind || !root || this.overLimit ? 'unrecognized' : 'active';
    const needsTimeline = home && kind && root && !this.doc.hidden;
    if (!needsTimeline) {
      if (home && kind && !root && !this.doc.hidden && this.keeper.refreshing) {
        this.rootObserver.disconnect(); this.resizeObserver.disconnect(); this.measured.clear();
        this.root = null; this.keeper.changed([], { boxes: [] }); return;
      }
      this.keeper.interrupt();
      this.detach(); this.overLimit = false; return;
    }
    if (root !== this.root) { this.detach(this.keeper.refreshing); this.attach(root); if (this.keeper.refreshing) this.paintGuard.start(root, timelineViewportTop(root, this.win)); }
  }
  private flush() {
    if (!this.root || !this.isCurrent()) return;
    const sample = this.currentSample();
    if (!sample) { this.keeper.changed([], { boxes: [] }); return; }
    this.overLimit = sample.overLimit;
    this.state = sample.overLimit ? 'unrecognized' : 'active';
    const nodes = new Set(sample.boxes.map(p => p.element));
    for (const element of this.measured) if (!nodes.has(element)) this.resizeObserver.unobserve(element);
    for (const element of nodes) if (!this.measured.has(element)) this.resizeObserver.observe(element);
    this.measured = nodes;
    if (this.state === 'active') {
      this.keeper.changed(sample.posts, { boxes: sample.boxes });
      this.keeper.capture(sample.posts);
      this.expireCorrection();
    } else this.keeper.interrupt();
    this.settle();
  }
  status() {
    this.reconcile();
    return { state: this.state };
  }
  dispose() {
    this.repostHold.dispose();
    this.disposed = true; this.keeper.interrupt(); this.detach(); this.lifecycle.abort(); this.pageObserver.disconnect(); this.refreshTotal.dispose();
    this.win.cancelAnimationFrame(this.frame); this.win.clearInterval(this.poll);
  }
}
export type Status = ReturnType<HomeController['status']>;
