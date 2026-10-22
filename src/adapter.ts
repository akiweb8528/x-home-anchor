import type { Post, PostBox, PostSample, Timeline } from './model.ts';
export const MAX_DOM_POSTS = 500;
const articleSelector = 'article[data-testid="tweet"]';
const primarySelector = '[data-testid="primaryColumn"]';

export function isHome(url: URL): boolean {
  return url.pathname.replace(/\/$/, '') === '/home';
}

export function timelineKind(doc: Document): Timeline | null {
  const primary = doc.querySelector(primarySelector);
  const selected = primary?.querySelector('[role="tab"][aria-selected="true"]');
  const text = selected?.textContent?.replace(/\s+/g, ' ').trim().toLowerCase();
  if (text === 'おすすめ' || text === 'for you') return 'for-you';
  if (text === 'フォロー中' || text === 'following') return 'following';
  return null;
}

export function timelineRoot(doc: Document): HTMLElement | null {
  const primary = doc.querySelector(primarySelector);
  if (!primary) return null;
  // Restrict the adapter to a named timeline region, never the page's other tweets.
  for (const region of primary.querySelectorAll<HTMLElement>('[aria-label]')) {
    const label = region.getAttribute('aria-label') ?? '';
    if (/^(Timeline:|タイムライン[:：])/.test(label)) return region;
  }
  return null;
}

const excludedContent = '[data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="tweetText"]';
function insideExcludedContent(element: Element, article: HTMLElement, timestamp?: Element): boolean {
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (node.matches(excludedContent) || node.matches('[role="link"]') && node !== timestamp) return true;
  }
  return element.closest(articleSelector) !== article;
}
export function postId(article: HTMLElement): string | null {
  // The outer header owns identity. Only its timestamp link may itself have
  // role=link; an enclosing role-link remains a quote/card boundary.
  const header = [...article.querySelectorAll('[data-testid="User-Name"]')]
    .find(el => !insideExcludedContent(el, article));
  if (!header) return null;
  const ids = new Set<string>();
  for (const time of header.querySelectorAll('time')) {
    const link = time.closest('a[href]');
    if (insideExcludedContent(time, article, link ?? undefined)) continue;
    if (!link || !header.contains(link)) continue;
    let url: URL;
    try { url = new URL(link.getAttribute('href') ?? '', 'https://x.com'); } catch { continue; }
    if (url.hostname !== 'x.com' || url.protocol !== 'https:') continue;
    const match = url.pathname.match(/^\/[^/]+\/status\/(\d{1,30})(?:\/)?$/);
    if (match) ids.add(match[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

export function readPosts(root: HTMLElement): PostSample {
  const elements = [...root.querySelectorAll<HTMLElement>(articleSelector)]
    .filter(el => !el.parentElement?.closest(articleSelector));
  const posts: Post[] = [];
  const boxes: PostBox[] = [];
  for (const element of elements.slice(0, MAX_DOM_POSTS)) {
    const id = postId(element);
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const box = { element, top: rect.top, bottom: rect.bottom };
    boxes.push(box);
    if (id !== null) posts.push({ ...box, id });
  }
  return { posts, boxes, overLimit: elements.length > MAX_DOM_POSTS };
}

export interface RefreshDetails { displayedCount?: number }
export function parseRefreshLabel(label: string): RefreshDetails | null {
  const normalized = label.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const english = normalized.match(/^Show (?:(\d+(?:,\d{3})*) (?:new )?|new )(?:posts?|Tweets?)$/i);
  const compact = normalized.replace(/\s/g, '');
  const japanese = compact.match(/^(?:(\d+(?:,\d{3})*)件の(?:新しい|新着)?|新しい|新着)(?:ポスト|ツイート)を表示$/)
    ?? compact.match(/^(?:新しい|新着)(?:ポスト|ツイート)を(\d+(?:,\d{3})*)件表示$/);
  const match = english ?? japanese;
  if (!match) return null;
  if (!match[1]) return {};
  const displayedCount = Number(match[1].replace(/,/g, ''));
  return Number.isSafeInteger(displayedCount) && displayedCount > 0 ? { displayedCount } : {};
}
export function refreshDetails(target: EventTarget | null): RefreshDetails | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest('a, button, [role="button"], [role="tab"]');
  if (!control) return null;
  return parseRefreshLabel(control.textContent ?? '') ?? parseRefreshLabel(control.getAttribute('aria-label') ?? '');
}
export function countedRefreshDetails(target: EventTarget | null, doc: Document): RefreshDetails | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest('a, button, [role="button"], [role="tab"]');
  if (!control || !doc.querySelector(primarySelector)?.contains(control)
    || control.closest(`article, ${excludedContent}`)) return null;
  return refreshDetails(control);
}
export function clickIntent(target: EventTarget | null): 'refresh' | 'navigate' | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest('a, button, [role="button"], [role="tab"]');
  if (!control) return null;
  if (refreshDetails(target)) return 'refresh';
  return 'navigate';
}
