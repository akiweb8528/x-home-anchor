import { emptyUnidentifiedReasons } from './adapter.ts';
import type { PositionResult, Timeline, UnidentifiedReasons } from './model.ts';
export const MAX_IDS = 5000;
export const MAX_EVENTS = 200;
export const SESSION_MS = 30 * 60 * 1000;
export interface Counts { unique: number; reappeared: number; changes: number; lastChangeAt: number | null; intervalMs: number | null }
export interface DiagnosticEvent extends Omit<PositionResult, 'reason'> {
  type: 'display' | 'position' | 'lifecycle' | 'identification'; timeline: Timeline | null;
  domCount?: number; distinctDomIds?: number; newIds?: number; reappeared?: number;
  intervalMs?: number | null; reason?: string; unidentifiedReasons?: UnidentifiedReasons;
}
export class Observation {
  running = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  stopReason: string | null = null;
  private seen: Record<Timeline, Set<string>> = { 'for-you': new Set(), following: new Set() };
  private previous: string[] = [];
  private previousKind: Timeline | null = null;
  private counts = this.emptyCounts();
  private identification: Record<Timeline, UnidentifiedReasons> = { 'for-you': emptyUnidentifiedReasons(), following: emptyUnidentifiedReasons() };
  private events: DiagnosticEvent[] = [];
  private droppedEvents = 0;
  private emptyCounts(): Record<Timeline, Counts> {
    return Object.fromEntries(['for-you', 'following'].map(k => [k, { unique: 0, reappeared: 0, changes: 0, lastChangeAt: null, intervalMs: null }])) as Record<Timeline, Counts>;
  }
  start(now = Date.now()) { this.clear(); this.running = true; this.startedAt = now; }
  stop(reason = 'manual', now = Date.now()) {
    if (!this.running) return;
    this.running = false; this.stoppedAt = now; this.stopReason = reason;
    this.seen['for-you'].clear(); this.seen.following.clear(); this.previous = []; this.previousKind = null;
  }
  clear() {
    this.running = false; this.startedAt = this.stoppedAt = null; this.stopReason = null;
    this.seen['for-you'].clear(); this.seen.following.clear(); this.previous = []; this.previousKind = null;
    this.counts = this.emptyCounts(); this.events = []; this.droppedEvents = 0;
    this.identification = { 'for-you': emptyUnidentifiedReasons(), following: emptyUnidentifiedReasons() };
  }
  expire(now = Date.now()) {
    if (this.running && now - this.startedAt! >= SESSION_MS) this.stop('time-limit', now);
    if (this.stoppedAt !== null && now - this.stoppedAt >= SESSION_MS) this.clear();
  }
  private append(event: DiagnosticEvent) {
    if (!this.running) return;
    if (this.events.length === MAX_EVENTS) { this.events.shift(); this.droppedEvents++; }
    this.events.push(event);
  }
  leave(reason: string, now = Date.now()) {
    this.append({ at: now, type: 'lifecycle', timeline: this.previousKind, reason });
    this.previous = []; this.previousKind = null;
  }
  observe(kind: Timeline, ids: string[], domCount: number, now = Date.now(), unidentifiedReasons: UnidentifiedReasons = emptyUnidentifiedReasons()) {
    this.expire(now);
    if (!this.running) return;
    const same = this.previousKind === kind && ids.length === this.previous.length && ids.every((id, i) => id === this.previous[i]);
    const sameIdentification = Object.entries(unidentifiedReasons).every(([reason, count]) => this.identification[kind][reason as keyof UnidentifiedReasons] === count);
    if (same) {
      if (!sameIdentification) {
        this.identification[kind] = { ...unidentifiedReasons };
        this.append({ at: now, type: 'identification', timeline: kind, domCount, unidentifiedReasons: { ...unidentifiedReasons } });
      }
      return;
    }
    const old = new Set(this.previousKind === kind ? this.previous : []);
    const current = new Set(ids);
    const unseen = [...current].filter(id => !this.seen[kind].has(id));
    if (this.seen['for-you'].size + this.seen.following.size + unseen.length > MAX_IDS) {
      this.stop('id-limit', now); return;
    }
    let newIds = 0, reappeared = 0;
    for (const id of current) {
      if (this.seen[kind].has(id)) { if (!old.has(id)) reappeared++; }
      else {
        this.seen[kind].add(id); newIds++;
      }
    }
    const count = this.counts[kind];
    const intervalMs = count.lastChangeAt === null ? null : now - count.lastChangeAt;
    count.unique += newIds; count.reappeared += reappeared; count.changes++;
    count.intervalMs = intervalMs; count.lastChangeAt = now;
    this.previous = [...ids]; this.previousKind = kind;
    this.identification[kind] = { ...unidentifiedReasons };
    this.append({ at: now, type: 'display', timeline: kind, domCount, distinctDomIds: current.size, newIds, reappeared, intervalMs, unidentifiedReasons: { ...unidentifiedReasons } });
  }
  position(result: PositionResult, kind: Timeline | null) {
    this.append({ ...result, type: 'position', timeline: kind });
  }
  report(now = Date.now()) {
    this.expire(now);
    return { schemaVersion: 2, source: 'DOM-only', running: this.running, startedAt: this.startedAt, stoppedAt: this.stoppedAt, stopReason: this.stopReason, counts: structuredClone(this.counts), identification: structuredClone(this.identification), events: [...this.events], droppedEvents: this.droppedEvents, limits: { ids: MAX_IDS, events: MAX_EVENTS, sessionMs: SESSION_MS, retainedAfterStopMs: SESSION_MS } };
  }
}
