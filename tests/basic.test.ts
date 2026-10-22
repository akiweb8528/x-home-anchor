import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseRefreshLabel } from '../src/adapter.ts';
import type { Post } from '../src/model.ts';
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

test('distributed popup and content contain no diagnostic collection or export interface', async () => {
  for (const file of ['content.js', 'popup.js', 'popup.html', 'popup.css', 'manifest.json']) {
    const output = await read(`dist/${file}`);
    assert.doesNotMatch(output, /diagnostic|observation|補正結果と記録|診断|JSONを出力/i, file);
    assert.doesNotMatch(output, /start-diagnostics|stop-diagnostics|clear-diagnostics|createObjectURL|JSON\.stringify/, file);
  }
});

test('new-post count labels recognize supported counts without inventing a count', () => {
  assert.deepEqual(parseRefreshLabel('Show 3 new posts'), { displayedCount: 3 });
  assert.deepEqual(parseRefreshLabel('３件の新しいポストを表示'), { displayedCount: 3 });
  assert.deepEqual(parseRefreshLabel('Show new posts'), {});
  assert.equal(parseRefreshLabel('Home'), null);
});

test('anchors preserve identity and neighbor offsets and reject ambiguous IDs', () => {
  const before = posts(['a', 'b', 'c', 'd']);
  const anchors = chooseAnchors(before, 600);
  assert.equal(anchors[0].id, 'b');
  const after = posts(['new', 'a', 'b', 'c', 'd']);
  assert.deepEqual(resolveAnchor(anchors, after), { delta: 150 });
  assert.deepEqual(resolveAnchor(anchors, after.filter(post => post.id !== 'b')), { delta: 150 });
  assert.equal(resolveAnchor(anchors, posts(['unrelated'])), null);
  assert.deepEqual(chooseAnchors(posts(['b', 'b']), 600), []);
});

test('position correction responds to a shifted anchor and stops after user input', () => {
  const scrolls: number[] = [];
  const win = {
    scrollY: 500, innerHeight: 600,
    document: { documentElement: { scrollHeight: 5000 } },
    scrollBy({ top = 0 }: ScrollToOptions) { this.scrollY += top; scrolls.push(top); },
  };
  const keeper = new PositionKeeper(win as unknown as Window);
  keeper.capture(posts(['a', 'b', 'c']));
  keeper.changed(posts(['a', 'b', 'c'], 75));
  assert.deepEqual(scrolls, [75]);
  assert.equal(win.scrollY, 575);
  assert.equal(keeper.correcting, true);
  keeper.input();
  keeper.changed(posts(['a', 'b', 'c'], 125));
  assert.deepEqual(scrolls, [75]);
  assert.equal(win.scrollY, 575);
  assert.equal(keeper.correcting, false);
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
  const keeper = new PositionKeeper(win as unknown as Window);
  const before = sample();
  keeper.refresh(before.slice(1), { boxes: before, displayedCount: 35 });

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
  assert.equal(keeper.refreshing, false);
  assert.equal(keeper.correcting, false);

  now = 6100;
  keeper.changed(sample(), { boxes: sample() });
  keeper.tick(sample(), { boxes: sample() });
  assert.deepEqual(scrolls, [6300]);
});
