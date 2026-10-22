export type Timeline = 'for-you' | 'following';
export type State = 'outside' | 'active' | 'unrecognized';
export interface PostBox { element: HTMLElement; top: number; bottom: number }
export interface Post extends PostBox { id: string }
export type UnidentifiedReason = 'missing-header' | 'missing-time' | 'invalid-status-link' | 'multiple-candidates';
export type UnidentifiedReasons = Record<UnidentifiedReason, number>;
export interface PostSample {
  posts: Post[];
  boxes: PostBox[];
  domCount: number;
  unidentified: number;
  unidentifiedReasons: UnidentifiedReasons;
  overLimit: boolean;
}
export interface Anchor { id: string; top: number }
export interface PositionResult {
  at: number;
  reason: 'refresh-started' | 'settled' | 'corrected' | 'neighbor' | 'stable' | 'missing-anchor' | 'unsafe-distance' | 'user-input' | 'explicit-navigation' | 'timeline-change' | 'expired' | 'external-scroll' | 'unrecognized' | 'scroll-clamped' | 'approximate' | 'no-update' | 'no-estimate';
  delta?: number;
  method?: 'anchor' | 'neighbor' | 'measured-height' | 'count-estimate';
  displayedCount?: number;
  countSource?: 'refresh-control';
  representativeHeight?: number;
  addedHeight?: number;
  plannedY?: number;
  actualDelta?: number;
  clamped?: boolean;
}
export const timelineLabel = (kind: Timeline | null) => kind === 'for-you' ? 'おすすめ' : kind === 'following' ? 'フォロー中' : '未判定';
