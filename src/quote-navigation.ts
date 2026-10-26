import { repostTarget, type RepostTarget } from './adapter.ts';

export function openQuotes(target: RepostTarget, signal: AbortSignal): void {
  const { article, url } = target;
  const doc = article.ownerDocument;
  const win = doc.defaultView;
  const more = [...article.querySelectorAll<HTMLButtonElement>('button[data-testid="caret"]')]
    .find(button => button.closest('article[data-testid="tweet"]') === article
      && !button.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="tweetText"]'));
  if (!win || signal.aborted) return;
  const page = win.location.href;
  const isCurrent = () => {
    const current = repostTarget(target.button);
    return !signal.aborted && !doc.hidden && article.isConnected && win.location.href === page
      && current?.article === article && current.url === url;
  };
  const listeners = new AbortController();
  let finished = false;
  let activated = false;
  const finish = () => {
    if (finished) return;
    finished = true; observer.disconnect(); win.clearTimeout(timer); listeners.abort();
  };
  const fallback = () => {
    if (finished) return;
    const navigate = isCurrent();
    finish();
    if (navigate) win.location.assign(url);
  };
  const check = () => {
    if (finished) return;
    if (!isCurrent()) { finish(); return; }
    if (activated) return;
    const link = [...doc.querySelectorAll<HTMLAnchorElement>('[role="menu"] a[role="menuitem"][href]')]
      .find(link => link.href === url);
    if (link) { activated = true; link.click(); }
  };
  // X creates the menu asynchronously; activate its own link to keep SPA routing.
  const observer = new MutationObserver(check);
  const timer = win.setTimeout(fallback, 1000);
  const cancel = () => finish();
  const options = { signal: listeners.signal, capture: true, passive: true };
  for (const type of ['pointerdown', 'pointercancel', 'wheel', 'scroll', 'keydown', 'popstate', 'pagehide']) win.addEventListener(type, cancel, options);
  win.addEventListener('blur', event => { if (event.target === win) cancel(); }, options);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel(); }, options);
  signal.addEventListener('abort', cancel, options);
  const navigation = (win as Window & { navigation?: EventTarget }).navigation;
  for (const type of ['navigate', 'currententrychange']) navigation?.addEventListener(type, cancel, options);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'role'] });
  check();
  if (!finished && !activated) {
    if (more) { more.click(); check(); } else fallback();
  }
}
