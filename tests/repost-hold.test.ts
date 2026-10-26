import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { repostTarget } from '../src/adapter.ts';
import { RepostHold } from '../src/repost-hold.ts';
import { environment } from './helpers/hold-dom.ts';

const expected = 'https://x.com/1oveWolfgirl/status/2114176286763675701/quotes';
function fixture(t: TestContext, pointerType = 'mouse') {
  const f = environment(t);
  const post = f.post();
  const navigations: { url: string; at: number }[] = [];
  let menuClicks = 0;
  f.doc.body.addEventListener('click', () => { menuClicks++; });
  const hold = new RepostHold(f.doc as unknown as Document, f.win as unknown as Window,
    target => { navigations.push({ url: target.url, at: f.clock.now }); });
  t.after(() => hold.dispose());
  const emit = (type: string, values: Record<string, unknown> = {}, target: any = post.path) =>
    f.emit(type, target, { pointerType, ...values });
  return { ...f, ...post, emit, hold, navigations, get menuClicks() { return menuClicks; } };
}

for (const pointerType of ['mouse', 'touch']) {
  test(`${pointerType}: release at 599ms immediately preserves the ordinary click`, t => {
    const f = fixture(t, pointerType);
    assert.equal(f.emit('pointerdown').defaultPrevented, false);
    f.clock.advance(599);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.emit('pointerup', { buttons: 0 }).defaultPrevented, false);
    assert.equal(f.emit('click', { buttons: 0 }).defaultPrevented, false);
    assert.equal(f.menuClicks, 1);
    f.clock.advance(2000);
    assert.deepEqual(f.navigations, []);
  });

  test(`${pointerType}: reaching 600ms navigates before release exactly once and consumes only that release/click`, t => {
    const f = fixture(t, pointerType);
    f.emit('pointerdown'); f.clock.advance(599);
    assert.deepEqual(f.navigations, []);
    f.clock.advance(1);
    assert.deepEqual(f.navigations, [{ url: expected, at: 700 }]);
    assert.equal(f.menuClicks, 0);
    f.clock.advance(1400);
    assert.equal(f.navigations.length, 1);
    assert.equal(f.emit('pointerup', { buttons: 0 }).defaultPrevented, true);
    assert.equal(f.emit('click', { buttons: 0 }).defaultPrevented, true);
    assert.equal(f.menuClicks, 0);
    f.emit('pointerdown'); f.clock.advance(30); f.emit('pointerup', { buttons: 0 });
    assert.equal(f.emit('click', { buttons: 0 }).defaultPrevented, false);
    assert.equal(f.menuClicks, 1);
    assert.equal(f.navigations.length, 1);
  });
}

test('a hold does not consume a keyboard click, another pointer, or a later independent press', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(600);
  assert.equal(f.emit('click', { detail: 0, pointerId: -1, buttons: 0 }).defaultPrevented, false);
  assert.equal(f.emit('click', { pointerId: 9, buttons: 0 }).defaultPrevented, false);
  assert.equal(f.menuClicks, 2);
  f.emit('pointerdown', { pointerId: 2 }); f.clock.advance(10);
  f.emit('pointerup', { pointerId: 2, buttons: 0 });
  assert.equal(f.emit('click', { pointerId: 2, buttons: 0 }).defaultPrevented, false);
  assert.equal(f.menuClicks, 3);
});

test('a completed release without a click expires instead of swallowing a future click', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(600); f.emit('pointerup', { buttons: 0 });
  f.clock.advance(801);
  assert.equal(f.emit('click', { buttons: 0 }).defaultPrevented, false);
});

for (const values of [
  { button: 2, buttons: 2 }, { button: 1, buttons: 4 }, { buttons: 0 }, { buttons: 3 }, { pointerType: 'pen' },
  { isPrimary: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
]) {
  test(`unsupported input keeps its native behavior: ${JSON.stringify(values)}`, t => {
    const f = fixture(t);
    assert.equal(f.emit('pointerdown', values).defaultPrevented, false);
    f.clock.advance(700);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.emit('contextmenu', values).defaultPrevented, false);
    assert.equal(f.emit('click', values).defaultPrevented, false);
  });
}

test('small pointer jitter is tolerated but deliberate movement cancels permanently', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointermove', { clientX: 46, clientY: 46 });
  f.clock.advance(399); assert.deepEqual(f.navigations, []);
  f.clock.advance(1); assert.equal(f.navigations.length, 1);
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointermove', { clientX: 51 });
  f.emit('pointermove', { clientX: 40 });
  f.clock.advance(600); assert.equal(f.navigations.length, 1);
  assert.equal(f.emit('click').defaultPrevented, false);
});

test('touch implicit capture cannot keep a hold alive after leaving the button coordinates', t => {
  const f = fixture(t, 'touch');
  f.button.rect = { left: 35, top: 35, right: 45, bottom: 45, width: 10, height: 10, x: 35, y: 35 };
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointermove', { clientX: 46 }); // Target is still the path, displacement only 6px.
  f.clock.advance(600);
  assert.deepEqual(f.navigations, []);
});

test('moving among icon descendants preserves a hold; leaving the button cancels it', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointerout', { relatedTarget: f.svg }); f.clock.advance(400);
  assert.equal(f.navigations.length, 1);
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointerout', { relatedTarget: f.doc.body });
  f.clock.advance(600); assert.equal(f.navigations.length, 1);
});

for (const type of ['scroll', 'wheel', 'pointercancel', 'popstate', 'hashchange', 'pagehide', 'blur', 'keydown']) {
  test(`${type} cancels a pending hold and leaves subsequent ordinary clicks alone`, t => {
    const f = fixture(t);
    f.emit('pointerdown'); f.clock.advance(300); f.emit(type, {}, type === 'blur' ? f.win : f.path);
    f.clock.advance(600);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.emit('click').defaultPrevented, false);
  });
}

test('tab hiding, disposal, and URL navigation cancel pending work', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(300); f.doc.hidden = true;
  f.emit('visibilitychange', {}, f.doc); f.doc.hidden = false; f.clock.advance(600);
  assert.deepEqual(f.navigations, []);
  f.emit('pointerdown'); f.clock.advance(300); f.win.location.href = 'https://x.com/explore';
  f.clock.advance(300); assert.deepEqual(f.navigations, []);
  f.win.location.href = 'https://x.com/home'; f.emit('pointerdown'); f.clock.advance(300);
  f.hold.dispose(); f.clock.advance(600); assert.deepEqual(f.navigations, []);
  assert.equal(f.emit('click').defaultPrevented, false);
  f.emit('pointerdown'); f.clock.advance(600); assert.deepEqual(f.navigations, []);
});

test('a touch context menu before the threshold is suppressed without delaying the navigation', t => {
  const f = fixture(t, 'touch');
  f.emit('pointerdown'); f.clock.advance(500);
  assert.equal(f.emit('contextmenu').defaultPrevented, true);
  assert.deepEqual(f.navigations, []);
  f.clock.advance(100); assert.deepEqual(f.navigations, [{ url: expected, at: 700 }]);
  assert.equal(f.emit('pointerup', { buttons: 0 }).defaultPrevented, true);
  assert.equal(f.emit('click', { buttons: 0 }).defaultPrevented, true);
});

test('new dynamic posts and reposted buttons work without home-tab recognition or duplicate timers', t => {
  const f = fixture(t);
  f.win.location.href = 'https://x.com/another/status/20'; f.win.location.pathname = '/another/status/20';
  const newer = f.post('987654', 'other'); newer.button.setAttribute('data-testid', 'unretweet');
  f.doc.targetAtPoint = newer.path;
  f.emit('pointerdown', {}, newer.path); f.clock.advance(300);
  f.emit('pointerdown', {}, newer.path); f.clock.advance(599);
  assert.deepEqual(f.navigations, []);
  f.clock.advance(1);
  assert.deepEqual(f.navigations, [{ url: 'https://x.com/other/status/987654/quotes', at: 1000 }]);
});

for (const mutation of ['remove', 'replace button', 'reuse article', 'change author URL', 'disable', 'obscure']) {
  test(`target mutation cancels before navigation: ${mutation}`, t => {
    const f = fixture(t);
    f.emit('pointerdown'); f.clock.advance(300);
    if (mutation === 'remove') f.article.remove();
    if (mutation === 'replace button') f.button.replaceWith(f.element('button', { 'data-testid': 'retweet' }));
    if (mutation === 'reuse article') f.link.setAttribute('href', '/different/status/999');
    if (mutation === 'change author URL') f.link.setAttribute('href', '/different/status/2114176286763675701');
    if (mutation === 'disable') f.button.setAttribute('disabled', '');
    if (mutation === 'obscure') f.doc.targetAtPoint = f.doc.body;
    f.clock.advance(300);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.emit('click').defaultPrevented, false);
  });
}

test('removing and reinserting the same post before observer delivery still cancels the old gesture', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(300);
  f.article.remove(); f.doc.body.append(f.article);
  f.clock.advance(300);
  assert.deepEqual(f.navigations, []);
});

test('the outer timestamp owns the destination; analytics and nested quote timestamps cannot replace it', t => {
  const f = fixture(t);
  for (const target of [f.button, f.div, f.svg, f.path]) {
    assert.equal(repostTarget(target as unknown as EventTarget)?.url, expected);
  }
  f.link.remove();
  assert.equal(repostTarget(f.path as unknown as EventTarget), null);
  f.emit('pointerdown'); f.clock.advance(600);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.emit('click').defaultPrevented, false);
});

test('quote previews, ambiguous headers, and unsafe timestamp URLs retain native behavior', t => {
  const f = fixture(t);
  const quotedButton = f.element('button', { 'data-testid': 'retweet' }); f.quote.append(quotedButton);
  assert.equal(repostTarget(quotedButton as unknown as EventTarget), null);
  const nested = f.post('321', 'nested'); nested.article.remove(); f.quote.append(nested.article);
  assert.equal(repostTarget(nested.path as unknown as EventTarget), null);
  const extraHeader = f.element('div', { 'data-testid': 'User-Name' }); f.article.append(extraHeader);
  assert.equal(repostTarget(f.path as unknown as EventTarget), null);
  extraHeader.remove();
  for (const href of ['https://evil.example/user/status/123', 'http://x.com/user/status/123', '/user/status/123/analytics']) {
    f.link.setAttribute('href', href);
    assert.equal(repostTarget(f.path as unknown as EventTarget), null);
  }
});


test('small touch jitter and the associated touchmove preserve the pending hold', t => {
  const f = fixture(t, 'touch');
  f.emit('pointerdown'); f.clock.advance(200);
  f.emit('pointermove', { clientX: 42 }); f.emit('touchmove');
  f.clock.advance(400);
  assert.deepEqual(f.navigations, [{ url: expected, at: 700 }]);
});

for (const type of ['navigate', 'currententrychange']) {
  test(`Navigation API ${type} cancels even when the URL returns before the next poll`, t => {
    const f = fixture(t);
    f.emit('pointerdown'); f.clock.advance(300);
    f.win.location.href = 'https://x.com/explore';
    f.emit(type, {}, f.win.navigation);
    f.win.location.href = 'https://x.com/home';
    f.clock.advance(300);
    assert.deepEqual(f.navigations, []);
  });
}

test('a completed hold suppresses a legacy compatibility click but leaves another button alone', t => {
  const f = fixture(t);
  f.emit('pointerdown'); f.clock.advance(600); f.emit('pointerup', { buttons: 0 });
  const other = f.post('12345', 'other');
  assert.equal(f.emit('click', { buttons: 0 }, other.path).defaultPrevented, false);
  assert.equal(f.emit('click', { buttons: 0, pointerId: undefined }).defaultPrevented, true);
  assert.equal(f.menuClicks, 1);
});

test('a completed touch hold preserves keyboard and unrelated-pointer context menus', t => {
  const f = fixture(t, 'touch');
  f.emit('pointerdown'); f.clock.advance(600);
  assert.equal(f.emit('contextmenu', { pointerType: '', pointerId: -1, detail: 0 }).defaultPrevented, false);
  assert.equal(f.emit('contextmenu', { pointerType: 'touch', pointerId: 9 }).defaultPrevented, false);
  assert.equal(f.emit('contextmenu', { pointerType: 'touch', pointerId: 1 }).defaultPrevented, true);
});

test('detail timestamps outside the author header identify the held post', t => {
  const f = fixture(t);
  const metadata = f.element('div');
  f.link.remove(); metadata.append(f.link); f.article.append(metadata);
  f.win.location.href = expected.replace('/quotes', '');
  f.win.location.pathname = new URL(f.win.location.href).pathname;
  assert.equal(repostTarget(f.button as unknown as EventTarget)?.url, expected);
  f.emit('pointerdown'); f.clock.advance(600);
  assert.deepEqual(f.navigations, [{ url: expected, at: 700 }]);
});

test('a reply in a detail view keeps its own footer timestamp identity', t => {
  const f = fixture(t);
  f.win.location.href = expected.replace('/quotes', '');
  const reply = f.post('456', 'reply');
  reply.link.remove(); reply.article.append(reply.link);
  assert.equal(repostTarget(reply.button as unknown as EventTarget)?.url, 'https://x.com/reply/status/456/quotes');
});

test('focusing the held button does not cancel when another page element blurs', t => {
  const f = fixture(t);
  f.emit('pointerdown');
  f.emit('blur', { relatedTarget: f.button }, f.link);
  f.clock.advance(600);
  assert.deepEqual(f.navigations, [{ url: expected, at: 700 }]);
});
