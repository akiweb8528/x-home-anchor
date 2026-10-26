import type { Post, PostBox, PostSample, Timeline } from './model.ts';
export const MAX_DOM_POSTS = 500;
const articleSelector = 'article[data-testid="tweet"]';
const primarySelector = '[data-testid="primaryColumn"]';

export function isHome(url: URL): boolean {
  return url.pathname.replace(/\/$/, '') === '/home';
}

export function timelineKind(doc: Document): Timeline | null {
  const tabs = [...doc.querySelector(primarySelector)?.querySelector('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? []];
  const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const text = tabs[index]?.textContent?.replace(/\s+/g, ' ').trim();
  return text ? `${index}:${text}` : null;
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

// Keep the live sticky header outside the refresh-only viewport copy.
export function timelineViewportTop(root: HTMLElement, win: Window): number {
  const primary = root.closest(primarySelector);
  let top = 0;
  for (let node = primary?.querySelector<HTMLElement>('[role="tablist"]') ?? null; node && primary?.contains(node); node = node.parentElement) {
    const position = win.getComputedStyle(node).position;
    const rect = node.getBoundingClientRect();
    if ((position === 'sticky' || position === 'fixed') && rect.top <= 1 && rect.bottom > 0) top = Math.max(top, rect.bottom);
  }
  return top;
}

const excludedContent = '[data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="tweetText"]';
function insideExcludedContent(element: Element, article: HTMLElement, timestamp?: Element): boolean {
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (node.matches(excludedContent) || node.matches('[role="link"]') && node !== timestamp) return true;
  }
  return element.closest(articleSelector) !== article;
}
function timestampStatusLinks(scope: Element, article: HTMLElement): { id: string; url: URL }[] {
  const links: { id: string; url: URL }[] = [];
  for (const time of scope.querySelectorAll('time')) {
    const link = time.closest('a[href]');
    if (insideExcludedContent(time, article, link ?? undefined)) continue;
    if (!link || !scope.contains(link)) continue;
    let url: URL;
    try { url = new URL(link.getAttribute('href') ?? '', 'https://x.com'); } catch { continue; }
    if (url.hostname !== 'x.com' || url.protocol !== 'https:') continue;
    const match = url.pathname.match(/^\/[^/]+\/status\/(\d{1,30})(?:\/)?$/);
    if (match) links.push({ id: match[1], url });
  }
  return links;
}
export function postId(article: HTMLElement): string | null {
  // The outer header owns identity. Only its timestamp link may itself have
  // role=link; an enclosing role-link remains a quote/card boundary.
  const header = [...article.querySelectorAll('[data-testid="User-Name"]')]
    .find(el => !insideExcludedContent(el, article));
  if (!header) return null;
  const ids = new Set(timestampStatusLinks(header, article).map(link => link.id));
  return ids.size === 1 ? [...ids][0] : null;
}

export interface RepostTarget { button: HTMLButtonElement; article: HTMLElement; url: string }
export function repostTarget(target: EventTarget | null): RepostTarget | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>('button[data-testid="retweet"], button[data-testid="unretweet"]');
  if (!button || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return null;
  const article = button.closest<HTMLElement>(articleSelector);
  if (!article || insideExcludedContent(button, article)
    || article.parentElement?.closest(`${articleSelector}, ${excludedContent}, [role="link"]`)) return null;
  const headers = [...article.querySelectorAll('[data-testid="User-Name"]')]
    .filter(header => !insideExcludedContent(header, article));
  if (headers.length !== 1) return null;
  const urls = new Set(timestampStatusLinks(article, article)
    .filter(({ url }) => url.origin === 'https://x.com' && !url.username && !url.password)
    .map(({ url }) => `https://x.com${url.pathname.replace(/\/$/, '')}/quotes`));
  if (urls.size !== 1) return null;
  return { button, article, url: [...urls][0] };
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
