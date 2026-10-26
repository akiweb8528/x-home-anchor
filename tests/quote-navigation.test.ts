import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { repostTarget } from '../src/adapter.ts';
import { openQuotes } from '../src/quote-navigation.ts';
import { RepostHold } from '../src/repost-hold.ts';
import { environment } from './helpers/hold-dom.ts';

function fixture(t: TestContext) {
  const f = environment(t);
  const post = f.post();
  const target = repostTarget(post.button as unknown as EventTarget);
  assert.ok(target);
  const signal = new AbortController(); t.after(() => signal.abort());
  const actions: { kind: string; url: string }[] = [];
  const go = (kind: string) => {
    actions.push({ kind, url: target.url }); f.win.location.href = target.url;
    f.emit('currententrychange', f.win.navigation);
  };
  Object.assign(f.win.location, { assign: () => go('fallback') });
  const more = Object.assign(f.element('button', { 'data-testid': 'caret' }), { click() {} });
  post.article.append(more);
  const link = Object.assign(f.element('a', { href: target.url, role: 'menuitem' }), { href: target.url, click: () => go('spa') });
  const menu = f.element('div', { role: 'menu' });
  let visible = false;
  const query = f.doc.querySelectorAll.bind(f.doc);
  // The small helper models the popup lookup; the browser suite covers its CSS.
  t.mock.method(f.doc, 'querySelectorAll', (selector: string) => selector === '[role="menu"] a[role="menuitem"][href]'
    ? visible ? [link] : [] : query(selector));
  const show = () => { visible = true; menu.append(link); f.doc.body.append(menu); };
  return { ...f, ...post, target, signal, actions, show, open: () => openQuotes(target, signal.signal) };
}

for (const type of ['wheel', 'scroll', 'blur', 'pointercancel']) {
  for (const lateLink of [false, true]) {
    test(`waiting quotes cancel on ${type}; late link ${lateLink}`, t => {
      const f = fixture(t); f.open(); f.clock.advance(200);
      f.emit(type, type === 'blur' || type === 'scroll' ? f.win : f.button);
      if (lateLink) { f.clock.advance(200); f.show(); }
      f.clock.advance(1200);
      assert.deepEqual(f.actions, []);
    });
  }
}

test('waiting quotes still use a delayed SPA link without cancellation', t => {
  const f = fixture(t); f.open(); f.clock.advance(400); f.show(); f.clock.advance(1200);
  assert.deepEqual(f.actions, [{ kind: 'spa', url: f.target.url }]);
});

test('waiting quotes still fall back once when no link appears', t => {
  const f = fixture(t); f.open(); f.clock.advance(1600);
  assert.deepEqual(f.actions, [{ kind: 'fallback', url: f.target.url }]);
});

test('element blur while waiting does not cancel the window operation', t => {
  const f = fixture(t); f.open(); f.clock.advance(200);
  f.emit('blur', f.link, { relatedTarget: f.button }); f.show(); f.clock.advance(1200);
  assert.deepEqual(f.actions, [{ kind: 'spa', url: f.target.url }]);
});

for (const pointerType of ['mouse', 'touch']) {
  test(`${pointerType} release after hold keeps waiting and consumes its release/click`, t => {
    const f = fixture(t);
    const hold = new RepostHold(f.doc as unknown as Document, f.win as unknown as Window, target => openQuotes(target, f.signal.signal));
    t.after(() => hold.dispose());
    f.emit('pointerdown', f.path, { pointerType }); f.clock.advance(600);
    assert.equal(f.emit('pointerup', f.path, { pointerType, buttons: 0 }).defaultPrevented, true);
    assert.equal(f.emit('click', f.path, { pointerType, buttons: 0 }).defaultPrevented, true);
    f.clock.advance(200); f.show(); f.clock.advance(1200);
    assert.deepEqual(f.actions, [{ kind: 'spa', url: f.target.url }]);
  });
}
