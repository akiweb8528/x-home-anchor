import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PositionKeeper, APPROXIMATE_WAIT_MS, REFRESH_MAX_MS, REFRESH_WAIT_MS } from '../src/position.ts';
import type { Post, PostBox, PositionResult } from '../src/model.ts';

const INITIAL_Y = 1050;
const COUNT = 35;
const PITCH = 180;
const INSERTION_HEIGHT = COUNT * PITCH;

function fixture(t: TestContext) {
  let now = 100;
  let y = INITIAL_Y;
  t.mock.method(performance, 'now', () => now);
  const moves: number[] = [];
  const events: PositionResult[] = [];
  const nodes = Array.from({ length: 10 }, () => ({} as HTMLElement));
  const replacement = nodes.map(() => ({} as HTMLElement));
  const win = {
    get scrollY() { return y; }, innerHeight: 800,
    document: { documentElement: { scrollHeight: 13700 } },
    scrollTo({ top = 0 }: ScrollToOptions) { moves.push(top - y); y = top; },
    scrollBy({ top = 0 }: ScrollToOptions) { moves.push(top); y += top; },
  };
  const keeper = new PositionKeeper(win as unknown as Window, result => events.push(result));
  const sample = ({ replaced = false, known = true, originalIds = false, shift = 0, firstId = replaced && !originalIds ? 101 : 1 } = {}) => {
    const elements = replaced ? replacement : nodes;
    const boxes: PostBox[] = elements.map((element, i) => ({
      element, top: i * PITCH + shift - y, bottom: (i + 1) * PITCH + shift - y,
    }));
    const posts: Post[] = known ? boxes.map((box, i) => ({ ...box, id: String(i + firstId) })) : [];
    return { posts, boxes };
  };
  const refresh = () => {
    const before = sample();
    keeper.refresh(before.posts, { boxes: before.boxes, displayedCount: COUNT, countSource: 'refresh-control' });
  };
  const change = (options: Parameters<typeof sample>[0] = {}) => {
    const current = sample(options); keeper.changed(current.posts, current);
  };
  const tick = (options: Parameters<typeof sample>[0] = {}) => {
    const current = sample(options); keeper.tick(current.posts, current);
  };
  const reset = () => {
    y = 0; keeper.scrolled(() => sample().posts, sample);
  };
  return {
    keeper, sample, refresh, change, tick, reset, moves, events,
    at(ms: number) { now = 100 + ms; },
    insertHeight(height = INSERTION_HEIGHT) { win.document.documentElement.scrollHeight += height; },
    pageScroll(top: number) { y = top; },
    get y() { return y; },
  };
}

for (const preliminary of ['reset', 'layout'] as const) {
  for (const known of [true, false]) {
    test(`later replacement after ${preliminary} reaches the original counted target; IDs known: ${known}`, t => {
      const f = fixture(t); f.refresh();
      f.at(100);
      if (preliminary === 'reset') f.reset();
      else f.change({ shift: 20 });
      const preliminaryY = f.y;
      assert.equal(preliminaryY, INITIAL_Y + (preliminary === 'layout' ? 20 : 0));

      // The new viewport contains newly inserted posts; the old anchors are no longer rendered.
      f.at(500); f.insertHeight(); f.change({ replaced: true, known });
      assert.equal(f.y, preliminaryY);
      f.at(500 + APPROXIMATE_WAIT_MS - 1); f.tick({ replaced: true, known });
      assert.equal(f.y, preliminaryY);
      assert.equal(f.keeper.remainingMs, 1);
      f.at(500 + APPROXIMATE_WAIT_MS); f.tick({ replaced: true, known });
      assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
      assert.equal(f.events.filter(event => event.reason === 'approximate').length, 1);
      assert.equal(f.keeper.result?.method, 'count-estimate');
      assert.equal(f.moves.at(-1), INITIAL_Y + INSERTION_HEIGHT - preliminaryY);

      f.at(REFRESH_WAIT_MS); f.tick({ replaced: true, known });
      f.at(REFRESH_MAX_MS + 100); f.change({ replaced: true, known }); f.tick({ replaced: true, known });
      assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
      assert.equal(f.events.filter(event => event.reason === 'approximate').length, 1);
    });
  }
}

test('a later measured insertion after a reset can recover without an additional count estimate', t => {
  const f = fixture(t); f.refresh();
  f.at(100); f.reset();
  f.at(500); f.insertHeight(); f.change({ shift: INSERTION_HEIGHT });
  assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
  f.at(600); f.change({ known: false, shift: INSERTION_HEIGHT });
  f.at(REFRESH_WAIT_MS); f.tick({ known: false, shift: INSERTION_HEIGHT });
  f.at(REFRESH_MAX_MS); f.tick({ known: false, shift: INSERTION_HEIGHT });
  assert.deepEqual(f.moves, [INITIAL_Y, INSERTION_HEIGHT]);
  assert.equal(f.events.some(event => event.reason === 'approximate'), false);
});

test('recycled elements with new IDs and document growth still permit recovery after a reset', t => {
  const f = fixture(t); f.refresh();
  f.at(100); f.reset();
  f.at(500); f.insertHeight(); f.change({ firstId: 101 });
  f.at(500 + APPROXIMATE_WAIT_MS); f.tick({ firstId: 101 });
  assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
  assert.deepEqual(f.moves, [INITIAL_Y, INSERTION_HEIGHT]);
  assert.equal(f.keeper.result?.method, 'count-estimate');
  f.at(REFRESH_MAX_MS); f.tick({ firstId: 101 });
  assert.equal(f.events.filter(event => event.reason === 'approximate').length, 1);
});

test('a new post range after reset-only recovery permits a count estimate without document growth', t => {
  const f = fixture(t); f.refresh();
  f.at(100); f.reset();
  f.at(500); f.change({ replaced: true });
  f.at(500 + APPROXIMATE_WAIT_MS); f.tick({ replaced: true });
  assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
  assert.deepEqual(f.moves, [INITIAL_Y, INSERTION_HEIGHT]);
  assert.equal(f.keeper.result?.method, 'count-estimate');
  f.at(REFRESH_MAX_MS); f.tick({ replaced: true });
  assert.equal(f.events.filter(event => event.reason === 'approximate').length, 1);
});

test('virtualization to a new post range after a completed insertion does not add the displayed count', t => {
  const f = fixture(t); f.refresh();
  const measuredInsertion = 450;
  f.at(100); f.insertHeight(measuredInsertion); f.change({ shift: measuredInsertion });
  const newRange = { replaced: true, shift: measuredInsertion };
  f.at(500); f.change(newRange);
  f.at(500 + APPROXIMATE_WAIT_MS); f.tick(newRange);
  f.at(REFRESH_WAIT_MS); f.tick(newRange);
  f.at(REFRESH_MAX_MS); f.tick(newRange);
  assert.equal(f.y, INITIAL_Y + measuredInsertion);
  assert.deepEqual(f.moves, [measuredInsertion]);
  assert.equal(f.events.some(event => event.reason === 'approximate'), false);
});

for (const native of [true, false]) {
  test(`the same completed insertion is not added again after IDs disappear; native: ${native}`, t => {
    const f = fixture(t); f.refresh();
    f.at(100); f.insertHeight();
    if (native) f.pageScroll(INITIAL_Y + INSERTION_HEIGHT);
    f.change({ shift: INSERTION_HEIGHT });
    assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
    f.at(500); f.change({ known: false, shift: INSERTION_HEIGHT });
    f.at(REFRESH_WAIT_MS); f.tick({ known: false, shift: INSERTION_HEIGHT });
    f.at(REFRESH_MAX_MS); f.tick({ known: false, shift: INSERTION_HEIGHT });
    assert.deepEqual(f.moves, native ? [] : [INSERTION_HEIGHT]);
    assert.equal(f.events.some(event => event.reason === 'approximate'), false);
  });
}

test('a reset without a later update does not add the displayed count', t => {
  const f = fixture(t); f.refresh();
  f.at(100); f.reset();
  f.at(REFRESH_WAIT_MS); f.tick();
  f.at(REFRESH_MAX_MS); f.tick();
  assert.equal(f.y, INITIAL_Y);
  assert.deepEqual(f.moves, [INITIAL_Y]);
  assert.equal(f.events.some(event => event.reason === 'approximate'), false);
});

for (const known of [true, false]) {
  test(`same-position redraw after exact restoration does not repeat the insertion; IDs known: ${known}`, t => {
    const f = fixture(t); f.refresh();
    f.at(100); f.insertHeight(); f.change({ shift: INSERTION_HEIGHT });
    const redrawn = { replaced: true, known, originalIds: true, shift: INSERTION_HEIGHT };
    f.at(500); f.change(redrawn);
    f.at(REFRESH_WAIT_MS); f.tick(redrawn);
    f.at(REFRESH_MAX_MS); f.tick(redrawn);
    assert.equal(f.y, INITIAL_Y + INSERTION_HEIGHT);
    assert.deepEqual(f.moves, [INSERTION_HEIGHT]);
    assert.equal(f.events.some(event => event.reason === 'approximate'), false);
  });
}

for (const reason of ['user-input', 'explicit-navigation', 'timeline-change'] as const) {
  test(`a later update after reset cannot resume a correction cancelled by ${reason}`, t => {
    const f = fixture(t); f.refresh();
    f.at(100); f.reset();
    f.at(300); f.keeper.interrupt(reason);
    f.at(500); f.insertHeight(); f.change({ replaced: true });
    f.at(REFRESH_WAIT_MS); f.tick({ replaced: true });
    assert.equal(f.y, INITIAL_Y);
    assert.deepEqual(f.moves, [INITIAL_Y]);
  });
}

test('a later replacement cannot extend the original five-second deadline', t => {
  const f = fixture(t); f.refresh();
  f.at(100); f.reset();
  // Keep the recognized refresh active while the original anchors are temporarily absent.
  f.at(500); f.change({ known: false });
  f.at(REFRESH_MAX_MS - 100); f.insertHeight(); f.change({ replaced: true });
  f.at(REFRESH_MAX_MS); f.tick({ replaced: true });
  f.at(REFRESH_MAX_MS + APPROXIMATE_WAIT_MS); f.tick({ replaced: true });
  assert.equal(f.y, INITIAL_Y);
  assert.deepEqual(f.moves, [INITIAL_Y]);
  assert.equal(f.events.some(event => event.reason === 'approximate'), false);
});
