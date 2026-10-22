import { clickIntent, emptyUnidentifiedReasons, isHome, readPosts, refreshDetails, timelineKind, timelineRoot } from './adapter.ts';
import { RefreshPaintGuard } from './refresh-paint-guard.ts';
import { RefreshTotal } from './refresh-total.ts';
import { Observation } from './observation.ts';
import { PositionKeeper, INPUT_QUIET_MS } from './position.ts';
import type { PostSample, State, Timeline } from './model.ts';

export class HomeController {
  readonly observation = new Observation();
  private kind: Timeline | null = null;
  private root: HTMLElement | null = null;
  private keeper: PositionKeeper;
  private paintGuard: RefreshPaintGuard;
  private refreshTotal: RefreshTotal;
  private state: State = 'outside';
  private domCount = 0;
  private unidentified = 0;
  private unidentifiedReasons = emptyUnidentifiedReasons();
  private overLimit = false;
  private frame = 0;
  private settleTimer = 0;
  private expiryTimer = 0;
  private poll = 0;
  private disposed = false;
  private lifecycle = new AbortController();
  private inputs: AbortController | null = null;
  private rootObserver: MutationObserver;
  private resizeObserver: ResizeObserver;
  private pageObserver: MutationObserver;
  private measured = new Set<HTMLElement>();
  private lastPath = '';
  private lastKind: Timeline | null = null;
  private scans = 0;
  private attachments = 0;
  constructor(private doc: Document, private win: Window) {
    this.keeper = this.newKeeper();
    this.paintGuard = new RefreshPaintGuard(doc, win, () => this.checkScroll(), () => this.keeper.refreshing);
    this.refreshTotal = new RefreshTotal(doc);
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
    win.addEventListener('click', event => this.refreshTotal.activate(event, new URL(win.location.href)), { signal, capture: true });
    win.addEventListener('popstate', () => this.reconcile(), { signal });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) this.keeper.interrupt('explicit-navigation');
      this.reconcile();
    }, { signal });
    // Location-only fallback covers SPA pushState without patching the site's History API.
    this.poll = win.setInterval(() => {
      this.observation.expire();
      if (this.lastPath !== win.location.pathname || !this.root?.isConnected) this.reconcile();
    }, 500);
    this.reconcile();
  }
  private newKeeper() { return new PositionKeeper(this.win, result => this.observation.position(result, this.kind)); }
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
  private detach() {
    this.rootObserver.disconnect(); this.resizeObserver.disconnect(); this.measured.clear();
    this.inputs?.abort(); this.inputs = null;
    this.win.clearTimeout(this.settleTimer); this.win.clearTimeout(this.expiryTimer);
    this.root = null;
    this.paintGuard.stop();
  }
  private settle() {
    this.win.clearTimeout(this.settleTimer);
    this.settleTimer = this.win.setTimeout(() => {
      if (!this.root || !this.isCurrent()) return;
      const sample = this.currentSample();
      if (sample?.overLimit) { this.keeper.interrupt('unrecognized'); this.paintGuard.stop(); return; }
      if (!sample) this.keeper.changed([], { boxes: [] });
      this.keeper.tick(sample?.posts ?? [], { boxes: sample?.boxes ?? [] });
    }, INPUT_QUIET_MS + 100);
  }
  private expireCorrection() {
    this.win.clearTimeout(this.expiryTimer);
    if (this.keeper.correcting) this.expiryTimer = this.win.setTimeout(() => {
      if (this.isCurrent()) {
        const sample = this.currentSample();
        if (sample?.overLimit) { this.keeper.interrupt('unrecognized'); this.paintGuard.stop(); return; }
        if (!sample) this.keeper.changed([], { boxes: [] });
        this.keeper.tick(sample?.posts ?? [], { boxes: sample?.boxes ?? [] });
        this.expireCorrection(); this.settle();
      }
    }, this.keeper.remainingMs + 1);
  }
  private attach(root: HTMLElement) {
    this.root = root; this.attachments++;
    this.rootObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-testid', 'role'] });
    this.inputs = new AbortController();
    const signal = this.inputs.signal;
    const interrupt = () => {
      this.keeper.input();
      this.paintGuard.stop(); this.settle();
    };
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) this.win.addEventListener(type, interrupt, { signal, passive: true, capture: true });
    this.win.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'j', 'k'].includes(event.key)) interrupt();
    }, { signal, capture: true });
    this.win.addEventListener('click', event => {
      const intent = clickIntent(event.target);
      if (intent === 'refresh' && event.isTrusted && this.root && this.isCurrent() && this.state === 'active') {
        const sample = this.currentSample();
        if (!sample || sample.overLimit) { this.keeper.interrupt('unrecognized'); this.paintGuard.stop(); return; }
        this.keeper.refresh(sample.posts, { boxes: sample.boxes, ...refreshDetails(event.target) });
        this.expireCorrection(); if (this.keeper.refreshing) this.paintGuard.start();
      } else if (intent === 'navigate') { this.keeper.interrupt('explicit-navigation'); this.paintGuard.stop(); }
      this.settle();
    }, { signal, capture: true });
    this.win.addEventListener('scroll', () => { this.checkScroll(); this.settle(); }, { signal, passive: true });
    this.flush();
  }
  private checkScroll() {
    if (!this.isCurrent()) {
      this.keeper.interrupt('explicit-navigation'); this.paintGuard.stop(); return;
    }
    let sample: PostSample | null = null;
    const current = () => {
      if (!sample && this.root) { this.scans++; sample = this.currentSample(); }
      if (sample?.overLimit) { this.keeper.interrupt('unrecognized'); return null; }
      return sample;
    };
    this.keeper.scrolled(() => current()?.posts ?? [], () => ({ boxes: current()?.boxes ?? [] }));
    if (!this.keeper.refreshing) this.paintGuard.stop();
  }
  reconcile() {
    if (this.disposed) return;
    this.lastPath = this.win.location.pathname;
    const home = isHome(new URL(this.win.location.href));
    this.refreshTotal.show(home);
    const kind = home ? timelineKind(this.doc) : null;
    const root = home ? timelineRoot(this.doc) : null;
    if (kind !== this.lastKind || !home) {
      if (this.lastKind) this.observation.leave(home ? 'timeline-change' : 'outside');
      this.keeper.interrupt('timeline-change'); this.detach();
    }
    this.kind = kind; this.lastKind = kind;
    this.state = !home ? 'outside' : !kind || !root || this.overLimit ? 'unrecognized' : 'active';
    const needsObservation = home && kind && root && !this.doc.hidden;
    if (!needsObservation) {
      if (home && kind && !root && !this.doc.hidden && this.keeper.refreshing) {
        this.rootObserver.disconnect(); this.resizeObserver.disconnect(); this.measured.clear();
        this.root = null; this.keeper.changed([], { boxes: [] }); return;
      }
      this.keeper.interrupt('explicit-navigation');
      this.detach(); this.domCount = 0; this.unidentified = 0; this.unidentifiedReasons = emptyUnidentifiedReasons(); this.overLimit = false; return;
    }
    if (root !== this.root) { this.detach(); this.attach(root); if (this.keeper.refreshing) this.paintGuard.start(); }
  }
  private flush() {
    if (!this.root || !this.isCurrent()) return;
    this.scans++;
    const sample = this.currentSample();
    if (!sample) { this.keeper.changed([], { boxes: [] }); return; }
    this.domCount = sample.domCount; this.unidentified = sample.unidentified; this.unidentifiedReasons = sample.unidentifiedReasons; this.overLimit = sample.overLimit;
    this.state = sample.overLimit ? 'unrecognized' : 'active';
    const nodes = new Set(sample.boxes.map(p => p.element));
    for (const element of this.measured) if (!nodes.has(element)) this.resizeObserver.unobserve(element);
    for (const element of nodes) if (!this.measured.has(element)) this.resizeObserver.observe(element);
    this.measured = nodes;
    if (sample.overLimit) this.observation.stop('dom-limit');
    else this.observation.observe(this.kind!, sample.posts.map(p => p.id), sample.domCount, Date.now(), sample.unidentifiedReasons);
    if (this.state === 'active') {
      this.keeper.changed(sample.posts, { boxes: sample.boxes });
      this.keeper.capture(sample.posts);
      this.expireCorrection();
    } else this.keeper.interrupt('unrecognized');
    this.settle();
  }
  command(command: 'status' | 'start' | 'stop' | 'clear') {
    this.reconcile();
    if (command === 'start') { this.observation.start(); this.reconcile(); this.flush(); }
    if (command === 'stop') { this.observation.stop(); this.reconcile(); }
    if (command === 'clear') { this.observation.clear(); this.reconcile(); }
    if (!this.root && this.kind) {
      const root = timelineRoot(this.doc);
      if (root) {
        const sample = readPosts(root);
        this.domCount = sample.domCount; this.unidentified = sample.unidentified; this.unidentifiedReasons = sample.unidentifiedReasons; this.overLimit = sample.overLimit;
      }
    }
    return this.status();
  }
  status() {
    return { state: this.state, timeline: this.kind, domCount: this.domCount, unidentified: this.unidentified, unidentifiedReasons: { ...this.unidentifiedReasons }, overLimit: this.overLimit, correcting: this.keeper.correcting, positionPhase: this.keeper.phase, position: this.keeper.result, diagnostic: this.observation.report() };
  }
  // Local fixture instrumentation, never included in diagnostic exports.
  debug() { return { scans: this.scans, attachments: this.attachments, activeInputScopes: this.inputs ? 1 : 0, refreshPaintGuard: this.paintGuard.running }; }
  dispose() {
    this.disposed = true; this.keeper.interrupt('explicit-navigation'); this.detach(); this.lifecycle.abort(); this.pageObserver.disconnect(); this.refreshTotal.dispose();
    this.win.cancelAnimationFrame(this.frame); this.win.clearInterval(this.poll); this.observation.clear();
  }
}
export type Status = ReturnType<HomeController['status']>;
