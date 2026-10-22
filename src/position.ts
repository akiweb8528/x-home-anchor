import type { Anchor, Post, PostBox, PositionResult } from './model.ts';
export const CORRECTION_MS = 1800;
export const INPUT_QUIET_MS = 700;
export function chooseAnchors(posts: Post[], viewportHeight: number): Anchor[] {
  const counts = new Map<string, number>();
  for (const post of posts) counts.set(post.id, (counts.get(post.id) ?? 0) + 1);
  const visible = posts.filter(p => p.bottom > 80 && p.top < viewportHeight && counts.get(p.id) === 1);
  // Prefer the first fully readable post; preserve neighbors' own offsets as fallbacks.
  const first = visible.find(p => p.top >= 80) ?? visible[0];
  if (!first) return [];
  const index = posts.indexOf(first);
  return [first, ...[...posts.slice(index + 1, index + 5), ...posts.slice(Math.max(0, index - 2), index).reverse()].filter(p => counts.get(p.id) === 1)]
    .slice(0, 7).map(p => ({ id: p.id, top: p.top }));
}
export function resolveAnchor(anchors: Anchor[], posts: Post[]) {
  for (const [index, anchor] of anchors.entries()) {
    const matches = posts.filter(p => p.id === anchor.id);
    if (matches.length === 1) return { delta: matches[0].top - anchor.top, neighbor: index > 0 };
  }
  return null;
}

// A refresh can wait for asynchronous work, then settle, but never outlive
// its original deadline. A completed/cancelled refresh cannot rearm from DOM work.
export const REFRESH_WAIT_MS = 3000;
export const REFRESH_MAX_MS = 5000;
export const REFRESH_SETTLE_MS = 1000;
export const APPROXIMATE_WAIT_MS = 650;
export interface PositionContext {
  boxes: PostBox[];
  displayedCount?: number;
  countSource?: 'refresh-control';
}
interface RefreshMeasurement {
  y: number;
  boxes: { element: HTMLElement; y: number }[];
  ids: string[];
  representativeHeight?: number;
  displayedCount?: number;
  countSource?: 'refresh-control';
  updateAt?: number;
  addedHeight?: number;
}
function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}
export function representativeHeight(boxes: PostBox[], viewportHeight: number) {
  // Local pitches include spacing. The median resists a single tall image/post;
  // large virtualization gaps are not representative post spacing.
  const local = boxes.map((box, index) => ({ box, index }))
    .sort((a, b) => Math.abs(a.box.top - viewportHeight / 2) - Math.abs(b.box.top - viewportHeight / 2))
    .slice(0, 9).sort((a, b) => a.index - b.index);
  const height = median(local.map(({ box }) => box.bottom - box.top).filter(n => n > 0));
  if (height === undefined || local.length < 3) return undefined;
  const pitches = local.slice(1).map(({ box, index }, i) => index === local[i].index + 1 ? box.top - local[i].box.top : 0)
    .filter(n => n > 0 && n <= height * 3);
  return pitches.length >= 2 ? median(pitches) : height;
}
export type PositionPhase = 'idle' | 'waiting' | 'updating' | 'recovering' | 'layout' | 'retired';

export class PositionKeeper {
  private anchors: Anchor[] = [];
  private until = 0;
  private quietUntil = 0;
  private needsIdle = false;
  private retired = false;
  private retireUntil = 0;
  private refreshStart: number | null = null;
  private lastActivity = 0;
  private sawUpdate = false;
  private resetUsed = false;
  private missing = false;
  private knownY: number;
  private lastResult: PositionResult | null = null;
  private measurement: RefreshMeasurement | null = null;
  private restoration: Partial<PositionResult> = {};
  private precisionRestored = false;
  private geometryAvailable = false;
  private win: Window;
  private emit: (result: PositionResult) => void;
  constructor(win: Window, emit: (result: PositionResult) => void) { this.win = win; this.emit = emit; this.knownY = win.scrollY; }
  get result() { return this.lastResult; }
  get refreshing() { return this.refreshStart !== null; }
  get phase(): PositionPhase {
    if (this.refreshing) return this.missing ? 'recovering' : this.sawUpdate ? 'updating' : 'waiting';
    return this.retired ? 'retired' : this.until ? 'layout' : 'idle';
  }
  get remainingMs() {
    let end = this.completionDeadline();
    const fallbackAt = this.approximationAt();
    if (this.geometryAvailable && fallbackAt !== null) end = Math.min(end, fallbackAt);
    return Math.max(0, end - performance.now());
  }
  get correcting() { return this.until > performance.now(); }
  private report(reason: PositionResult['reason'], delta?: number, details: Partial<PositionResult> = {}) {
    this.lastResult = { ...this.restoration, ...details, at: Date.now(), reason, ...(delta === undefined ? {} : { delta: Math.round(delta * 100) / 100 }) };
    this.emit(this.lastResult);
  }
  capture(posts: Post[]) {
    if (this.until || this.retired || this.needsIdle || performance.now() < this.quietUntil) return;
    this.anchors = chooseAnchors(posts, this.win.innerHeight);
    this.restoration = {};
    this.knownY = this.win.scrollY;
  }
  interrupt(reason: PositionResult['reason'], delta?: number) {
    if (this.until || this.anchors.length) this.report(reason, delta);
    if (this.refreshing) { this.retired = true; this.retireUntil = this.until; }
    this.until = 0; this.refreshStart = null; this.anchors = []; this.missing = false;
    this.measurement = null;
    this.knownY = this.win.scrollY;
    this.quietUntil = performance.now() + INPUT_QUIET_MS; this.needsIdle = true;
  }
  input() {
    // Only a NEW input after the old transaction's horizon can restore ordinary
    // layout anchoring. Its delayed callbacks cannot recapture a stale baseline.
    if (this.retired && performance.now() >= this.retireUntil) this.retired = false;
    this.interrupt('user-input');
  }
  refresh(posts: Post[], context?: PositionContext) {
    this.until = 0; this.refreshStart = null; this.anchors = [];
    this.retired = false; this.needsIdle = false; this.quietUntil = 0;
    this.capture(posts);
    this.restoration = {};
    const boxes = context?.boxes ?? posts;
    this.geometryAvailable = boxes.length > 0;
    if (!this.anchors.length && !boxes.length) { this.measurement = null; return; }
    const displayedCount = context?.displayedCount;
    this.measurement = {
      y: this.win.scrollY, boxes: boxes.map(box => ({ element: box.element, y: box.top + this.win.scrollY })),
      ids: posts.map(post => post.id), representativeHeight: representativeHeight(boxes, this.win.innerHeight),
      ...(displayedCount !== undefined && displayedCount > 0 && Number.isSafeInteger(displayedCount) ? { displayedCount, countSource: context?.countSource } : {}),
    };
    this.restoration = { displayedCount: this.measurement.displayedCount, countSource: this.measurement.countSource, representativeHeight: this.measurement.representativeHeight };
    this.refreshStart = performance.now(); this.until = this.refreshStart + REFRESH_MAX_MS;
    this.lastActivity = this.refreshStart; this.sawUpdate = false; this.resetUsed = false; this.missing = false; this.precisionRestored = false;
    this.report('refresh-started');
  }
  private completionDeadline() {
    if (this.refreshStart === null) return this.until;
    // An unresolved estimate keeps its original hard deadline, including when
    // IDs recover without moving an anchor. Its wake-up reads current geometry.
    if (!this.precisionRestored && this.approximationTarget()) return this.until;
    if (!this.sawUpdate) return this.refreshStart + REFRESH_WAIT_MS;
    return this.missing ? this.until : Math.min(this.until, Math.max(this.refreshStart + REFRESH_WAIT_MS, this.lastActivity + REFRESH_SETTLE_MS));
  }
  private checkDeadline() {
    if (!this.until || performance.now() < this.completionDeadline()) return false;
    this.interrupt(this.refreshing && !this.sawUpdate && !this.precisionRestored ? 'no-update' : !this.missing && performance.now() < this.until ? 'settled' : 'expired');
    return true;
  }
  private acceptScroll() {
    const y = this.win.scrollY;
    if (Math.abs(y - this.knownY) < 1) return true;
    // One top-reset episode belongs to a recognized refresh. Arbitrary positions
    // and a second reset terminate it rather than fighting a page's scroll loop.
    if (this.refreshing && !this.resetUsed && y <= 1 && this.knownY > 1) {
      this.resetUsed = true; this.lastActivity = performance.now(); return true;
    }
    this.interrupt('external-scroll'); return false;
  }
  private measureUpdate(posts: Post[], boxes: PostBox[]) {
    const baseline = this.measurement;
    if (!baseline || !boxes.length) return;
    const before = new Set(baseline.boxes.map(box => box.element));
    const first = baseline.boxes[0];
    const firstIndex = boxes.findIndex(box => box.element === first?.element);
    if (firstIndex >= 0) {
      const added = boxes[firstIndex].top + this.win.scrollY - first.y;
      const prefixInserted = firstIndex > 0 && boxes.slice(0, firstIndex).some(box => !before.has(box.element));
      const commonShift = baseline.boxes.slice(0, 3).filter(old => boxes.some(box => box.element === old.element && Math.abs(box.top + this.win.scrollY - old.y - added) <= 1)).length >= 3;
      if (added > 1 && (prefixInserted || commonShift)) baseline.addedHeight = added;
    }
    // Replacement alone may just be a redraw. Unknown-ID replacements also
    // need changed document geometry, rather than a click or scroll reset alone.
    const newNodes = boxes.some(box => !before.has(box.element));
    const newIds = posts.some(post => !baseline.ids.includes(post.id));
    const upperPlacementChanged = first && boxes[0].top + this.win.scrollY > first.y + 1;
    const sameKnownIds = baseline.ids.length > 0 && posts.length === baseline.ids.length && posts.every((post, i) => post.id === baseline.ids[i]);
    if ((baseline.addedHeight !== undefined || newIds || newNodes && upperPlacementChanged && !sameKnownIds) && baseline.updateAt === undefined) {
      baseline.updateAt = performance.now(); this.sawUpdate = true; this.lastActivity = baseline.updateAt;
    }
  }
  private approximationTarget() {
    const m = this.measurement;
    if (!m) return null;
    const addedHeight = m.addedHeight ?? (m.displayedCount && m.representativeHeight ? m.displayedCount * m.representativeHeight : undefined);
    return addedHeight === undefined ? null : { y: m.y + addedHeight, addedHeight, method: m.addedHeight !== undefined ? 'measured-height' as const : 'count-estimate' as const };
  }
  private approximationAt() {
    if (this.refreshStart === null || this.precisionRestored || !this.approximationTarget()) return null;
    return this.measurement?.updateAt === undefined ? this.refreshStart + REFRESH_WAIT_MS : this.measurement.updateAt + APPROXIMATE_WAIT_MS;
  }
  private approximate() {
    const m = this.measurement;
    if (!m || !this.geometryAvailable || this.precisionRestored || this.refreshStart === null) return;
    const readyAt = m.updateAt === undefined ? this.refreshStart + REFRESH_WAIT_MS : m.updateAt + APPROXIMATE_WAIT_MS;
    if (performance.now() < readyAt) return;
    const target = this.approximationTarget();
    if (!target) {
      if (m.updateAt !== undefined && this.missing) this.interrupt('no-estimate');
      return;
    }
    this.restoration = { ...this.restoration, method: target.method, addedHeight: target.addedHeight, plannedY: target.y, actualDelta: 0 };
    if (target.addedHeight > 50_000) { this.interrupt('unsafe-distance'); return; }
    const maxY = Math.max(0, this.win.document.documentElement.scrollHeight - this.win.innerHeight);
    const plannedY = Math.max(0, Math.min(maxY, target.y));
    const before = this.win.scrollY;
    // Absolute pre-activation position avoids adding the same height after native
    // anchoring or a page-maintained scroll position.
    if (plannedY > before) this.win.scrollTo({ top: plannedY, behavior: 'instant' });
    const actualDelta = this.win.scrollY - before;
    this.knownY = this.win.scrollY;
    this.restoration = { ...this.restoration, method: target.method, addedHeight: target.addedHeight, plannedY: target.y, actualDelta, clamped: Math.abs(plannedY - target.y) > 1 };
    // No later geometry change may issue another large estimate for this action.
    this.interrupt('approximate', actualDelta);
  }
  changed(posts: Post[], context?: PositionContext) {
    this.geometryAvailable = (context?.boxes ?? posts).length > 0;
    if (this.checkDeadline() || (!this.anchors.length && !this.refreshing) || this.retired || performance.now() < this.quietUntil) return;
    const now = performance.now();
    if (this.refreshing) this.measureUpdate(posts, context?.boxes ?? posts);
    const moved = this.knownY - this.win.scrollY;
    const match = resolveAnchor(this.anchors, posts);
    // A layout batch may include native scroll anchoring. With no residual
    // displacement it needs no correction or reset classification.
    const target = !match ? this.approximationTarget() : null;
    const maxY = Math.max(0, this.win.document.documentElement.scrollHeight - this.win.innerHeight);
    const nativeTolerance = target?.method === 'count-estimate' ? Math.min(target.addedHeight * 0.15, (this.measurement?.representativeHeight ?? 0) * 2) : 1;
    const alreadyAnchored = target && this.win.scrollY > 1 && Math.abs(this.win.scrollY - Math.min(maxY, target.y)) <= nativeTolerance;
    if (moved && (!match || Math.abs(match.delta) >= 1) && !alreadyAnchored && !this.acceptScroll()) return;
    this.knownY = this.win.scrollY;
    if (!match) {
      if (this.refreshing && this.anchors.length && !this.missing) { this.sawUpdate = true; this.lastActivity = now; }
      if (!this.missing) this.report('missing-anchor');
      this.missing = true;
      if (this.refreshing) this.approximate();
      else this.interrupt('missing-anchor');
      return;
    }
    if (this.refreshing && (this.missing || Math.abs(match.delta - moved) >= 1)) {
      this.sawUpdate = true; this.lastActivity = now;
    }
    this.missing = false;
    // An unchanged anchor alone does not prove restoration: an offscreen ID may
    // simply have become identifiable. Native anchoring must have moved the
    // scroll position and left no residual displacement to cancel the estimate.
    if (this.refreshing && Math.abs(moved) >= 1 && Math.abs(match.delta) < 1) this.precisionRestored = true;
    if (this.refreshing) this.restoration = { ...this.restoration, method: match.neighbor ? 'neighbor' : 'anchor', plannedY: this.win.scrollY + match.delta };
    if (!this.until && Math.abs(match.delta) < 1) { this.capture(posts); return; }
    if (!this.until) this.until = now + CORRECTION_MS;
    if (Math.abs(match.delta) > 50_000) { this.interrupt('unsafe-distance'); return; }
    if (Math.abs(match.delta) >= 1) {
      const before = this.win.scrollY;
      this.win.scrollBy({ top: match.delta, behavior: 'instant' });
      this.knownY = this.win.scrollY;
      const actual = this.win.scrollY - before;
      this.restoration = { ...this.restoration, actualDelta: actual };
      if (Math.abs(actual - match.delta) > 1) this.interrupt('scroll-clamped');
      else {
        if (this.refreshing && Math.abs(actual) >= 1) this.precisionRestored = true;
        this.report(match.neighbor ? 'neighbor' : 'corrected', actual);
      }
    }
    if (this.refreshing) this.approximate();
  }
  scrolled(read: () => Post[], context?: () => PositionContext) {
    if (this.checkDeadline()) return;
    const fallbackAt = this.approximationAt();
    if (Math.abs(this.win.scrollY - this.knownY) < 1 && !(this.geometryAvailable && fallbackAt !== null && performance.now() >= fallbackAt)) return;
    if (this.refreshing) { const posts = read(); this.changed(posts, context?.()); }
    else this.interrupt('external-scroll');
  }
  tick(posts: Post[], context?: PositionContext) {
    if (this.checkDeadline()) return;
    if (this.refreshing) this.changed(posts, context);
    if (performance.now() >= this.quietUntil) this.needsIdle = false;
    this.capture(posts);
  }
}
