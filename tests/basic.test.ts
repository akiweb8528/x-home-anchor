import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseRefreshLabel } from '../src/adapter.ts';
import type { Post, PositionResult } from '../src/model.ts';
import { Observation, SESSION_MS } from '../src/observation.ts';
import { chooseAnchors, PositionKeeper, resolveAnchor } from '../src/position.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');
const posts = (ids: string[], offset = 0): Post[] => ids.map((id, i) => ({
  id, element: {} as HTMLElement, top: i * 150 + offset, bottom: (i + 1) * 150 + offset,
}));

test('build contains the extension, matching manifest and MIT license', async () => {
  const files = ['LICENSE', 'content.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js'];
  assert.deepEqual((await readdir(new URL('dist/', root))).sort(), files);
  for (const file of files) assert.ok((await read(`dist/${file}`)).trim().length > 0);
  assert.equal(await read('dist/LICENSE'), await read('LICENSE'));
  assert.match(await read('dist/LICENSE'), /^MIT License\n/);
  assert.match(await read('dist/LICENSE'), /Copyright \(c\) 2026 akiweb8528/);
  assert.equal(await read('dist/manifest.json'), await read('manifest.json'));
  const manifest = JSON.parse(await read('dist/manifest.json'));
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.license, 'MIT');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(manifest.content_scripts, [{
    matches: ['https://x.com/*'], js: ['content.js'], run_at: 'document_idle',
  }]);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.host_permissions, undefined);
});

test('new-post count labels recognize supported counts without inventing a count', () => {
  assert.deepEqual(parseRefreshLabel('Show 3 new posts'), { displayedCount: 3, countSource: 'refresh-control' });
  assert.deepEqual(parseRefreshLabel('３件の新しいポストを表示'), { displayedCount: 3, countSource: 'refresh-control' });
  assert.deepEqual(parseRefreshLabel('Show new posts'), {});
  assert.equal(parseRefreshLabel('Home'), null);
});

test('diagnostics require start, distinguish redraw and reappearance, and separate timelines', () => {
  const observation = new Observation();
  observation.observe('for-you', ['synthetic-a'], 1, 1);
  assert.equal(observation.report(2).events.length, 0);
  observation.start(10);
  observation.observe('for-you', ['synthetic-a', 'synthetic-b', 'synthetic-b'], 3, 20);
  observation.observe('for-you', ['synthetic-a', 'synthetic-b', 'synthetic-b'], 3, 30);
  observation.observe('for-you', ['synthetic-b'], 1, 40);
  observation.observe('for-you', ['synthetic-a', 'synthetic-b'], 2, 50);
  observation.leave('timeline-change', 60);
  observation.observe('following', ['synthetic-a'], 1, 70);
  const report = observation.report(80);
  assert.equal(report.running, true);
  assert.equal(report.source, 'DOM-only');
  assert.equal(report.counts['for-you'].unique, 2);
  assert.equal(report.counts['for-you'].reappeared, 1);
  assert.equal(report.counts['for-you'].changes, 3);
  assert.equal(report.counts.following.unique, 1);
  assert.equal(report.counts.following.reappeared, 0);
  assert.equal(report.events[0].domCount, 3);
  assert.equal(report.events[0].distinctDomIds, 2);
});

test('diagnostic export omits IDs, stop prevents collection, and clear and expiry discard data', () => {
  const observation = new Observation();
  observation.start(0);
  observation.observe('for-you', ['synthetic-private-id'], 1, 10);
  observation.stop('manual', 20);
  observation.observe('for-you', ['synthetic-after-stop'], 1, 30);
  const report = observation.report(40);
  assert.equal(report.running, false);
  assert.equal(report.stopReason, 'manual');
  assert.equal(report.counts['for-you'].unique, 1);
  assert.equal(JSON.stringify(report).includes('synthetic-'), false);
  assert.equal(report.limits.sessionMs, 30 * 60 * 1000);
  assert.equal(report.limits.retainedAfterStopMs, 30 * 60 * 1000);
  assert.equal(observation.report(20 + SESSION_MS).startedAt, null);
  assert.equal(observation.report(20 + SESSION_MS).events.length, 0);
  observation.start(0);
  observation.observe('for-you', ['synthetic-expired'], 1, SESSION_MS);
  assert.equal(observation.report(SESSION_MS).stopReason, 'time-limit');
  observation.clear();
  assert.equal(observation.report(SESSION_MS).startedAt, null);
  assert.equal(observation.report(SESSION_MS).counts['for-you'].unique, 0);
  assert.equal(observation.report(SESSION_MS).events.length, 0);
});

test('anchors preserve identity and neighbor offsets and reject ambiguous IDs', () => {
  const before = posts(['a', 'b', 'c', 'd']);
  const anchors = chooseAnchors(before, 600);
  assert.equal(anchors[0].id, 'b');
  const after = posts(['new', 'a', 'b', 'c', 'd']);
  assert.deepEqual(resolveAnchor(anchors, after), { delta: 150, neighbor: false });
  assert.deepEqual(resolveAnchor(anchors, after.filter(post => post.id !== 'b')), { delta: 150, neighbor: true });
  assert.equal(resolveAnchor(anchors, posts(['unrelated'])), null);
  assert.deepEqual(chooseAnchors(posts(['b', 'b']), 600), []);
});

test('position correction responds to a shifted anchor and stops after user input', () => {
  const results: PositionResult[] = [];
  const scrolls: number[] = [];
  const win = {
    scrollY: 500, innerHeight: 600,
    document: { documentElement: { scrollHeight: 5000 } },
    scrollBy({ top = 0 }: ScrollToOptions) { this.scrollY += top; scrolls.push(top); },
  };
  const keeper = new PositionKeeper(win as unknown as Window, result => results.push(result));
  keeper.capture(posts(['a', 'b', 'c']));
  keeper.changed(posts(['a', 'b', 'c'], 75));
  assert.deepEqual(scrolls, [75]);
  assert.equal(win.scrollY, 575);
  assert.equal(results.at(-1)?.reason, 'corrected');
  keeper.input();
  keeper.changed(posts(['a', 'b', 'c'], 125));
  assert.deepEqual(scrolls, [75]);
  assert.equal(results.at(-1)?.reason, 'user-input');
});

test('partial ID recovery without position movement still permits one counted downward fallback', t => {
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  const scrolls: number[] = [];
  const win = {
    scrollY: 1050, innerHeight: 800,
    document: { documentElement: { scrollHeight: 20000 } },
    scrollTo({ top = 0 }: ScrollToOptions) { scrolls.push(top - this.scrollY); this.scrollY = top; },
    scrollBy({ top = 0 }: ScrollToOptions) { scrolls.push(top); this.scrollY += top; },
  };
  const elements = Array.from({ length: 10 }, () => ({} as HTMLElement));
  const sample = (): Post[] => elements.map((element, i) => ({
    id: String(i + 1), element, top: i * 180 - win.scrollY, bottom: (i + 1) * 180 - win.scrollY,
  }));
  const keeper = new PositionKeeper(win as unknown as Window, () => {});
  const before = sample();
  keeper.refresh(before.slice(1), { boxes: before, displayedCount: 35, countSource: 'refresh-control' });

  // An offscreen post's ID becomes readable; the existing anchor and scroll stay put.
  now = 3000;
  keeper.changed(sample(), { boxes: sample() });
  assert.equal(win.scrollY, 1050);
  assert.deepEqual(scrolls, []);
  now = 3649;
  keeper.tick(sample(), { boxes: sample() });
  assert.deepEqual(scrolls, []);
  now = 3650;
  keeper.scrolled(sample, () => ({ boxes: sample() }));
  assert.equal(win.scrollY, 7350);
  assert.deepEqual(scrolls, [6300]);
  assert.equal(keeper.result?.method, 'count-estimate');

  now = 6100;
  keeper.changed(sample(), { boxes: sample() });
  keeper.tick(sample(), { boxes: sample() });
  assert.deepEqual(scrolls, [6300]);
});
