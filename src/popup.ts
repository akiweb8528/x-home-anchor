import { timelineLabel, type PositionResult, type UnidentifiedReasons } from './model.ts';
import type { Status } from './controller.ts';
const byId = (id: string) => document.getElementById(id)!;
const button = (id: string) => byId(id) as HTMLButtonElement;
let tabId: number | undefined;
let status: Status | null = null;
let pending = false;
const reasons: Record<string, string> = {
  'refresh-started': '新着表示前の位置を記録', settled: '表示が落ち着いたため補正を終了',
  corrected: '投稿の位置を補正', neighbor: '近くの投稿で補正', stable: '位置に変化なし',
  'missing-anchor': '基準の投稿が見つからず、復元方法を確認中', 'unsafe-distance': '移動量が大きいため補正せず',
  'user-input': '本人の操作で中断', 'explicit-navigation': '明示操作で中断',
  'timeline-change': '画面・タイムライン変更', expired: '補正期間が終了', 'external-scroll': '画面側のスクロールで中断',
  unrecognized: '画面構造を認識できないため補正を休止', 'scroll-clamped': 'スクロール範囲の端で復元できず',
  approximate: '概算で読んでいた辺りへ移動', 'no-update': '新着の反映を確認できず移動せず', 'no-estimate': '移動量の根拠が足りず移動せず',
  manual: '手動停止', 'time-limit': '30分で自動停止', 'id-limit': 'ID数の上限で自動停止', 'dom-limit': '表示中の投稿数の上限で停止', outside: 'ホームから移動'
};
const methods = { anchor: '基準の投稿', neighbor: '近くの投稿', 'measured-height': '上方追加の実測高さ', 'count-estimate': '表示件数 × 代表高さ・間隔' };
const identificationLabels = { 'missing-header': '対象ヘッダーなし', 'missing-time': '日時なし', 'invalid-status-link': '日時リンク不明', 'multiple-candidates': '候補が複数' };
function identificationText(reasons: UnidentifiedReasons) {
  return Object.entries(reasons).filter(([, count]) => count > 0).map(([reason, count]) => `${identificationLabels[reason as keyof UnidentifiedReasons]} ${count}`).join(' / ');
}
function restorationDetails(value: Partial<Omit<PositionResult, 'reason'>>) {
  return [
    value.method ? `方式: ${methods[value.method]}` : '',
    value.displayedCount !== undefined ? `表示件数: ${value.displayedCount}件（新着ボタン）` : '',
    value.representativeHeight !== undefined ? `代表高さ・間隔: ${Math.round(value.representativeHeight)}px` : '',
    value.addedHeight !== undefined ? `上方追加量: ${Math.round(value.addedHeight)}px` : '',
    value.plannedY !== undefined ? `予定位置: ${Math.round(value.plannedY)}px` : '',
    value.actualDelta !== undefined ? `実際の移動: ${Math.round(value.actualDelta)}px` : '',
    value.clamped ? 'スクロール範囲の端まで移動しました' : '',
  ].filter(Boolean).join('\n');
}
function render(value: Status) {
  status = value;
  const states = { outside: '対象外の画面です。ホームで動作します。', active: '位置保持が動作中です。', unrecognized: '画面構造を認識できません。補正を休止しています。' };
  byId('status').textContent = states[value.state];
  if (value.state === 'active') {
    if (value.position?.reason === 'approximate') byId('status').textContent = value.position.clamped ? '概算で移動しました。スクロール範囲の端に達しました。' : '位置保持が動作中です。直近は概算で移動しました。';
    else if (value.unidentified && value.unidentified === value.domCount) byId('status').textContent = '投稿IDを識別できません。新着表示時に概算移動を試みます。';
    else if (value.unidentified) byId('status').textContent = '一部の投稿IDが不明です。位置保持は動作中です。';
  }
  const report = value.diagnostic;
  byId('recording').textContent = report.running ? '● 診断中' : report.stopReason ? reasons[report.stopReason] ?? '停止中' : '停止中';
  byId('timeline').textContent = timelineLabel(value.timeline);
  byId('dom').textContent = `${value.domCount}${value.unidentified ? `（識別不可 ${value.unidentified}）` : ''}${value.overLimit ? '（観測上限超過）' : ''}`;
  const counts = value.timeline ? report.counts[value.timeline] : null;
  byId('unique').textContent = counts ? String(counts.unique) : '—';
  byId('repeat').textContent = counts ? String(counts.reappeared) : '—';
  byId('changed').textContent = counts?.lastChangeAt ? new Date(counts.lastChangeAt).toLocaleTimeString('ja-JP') : '—';
  byId('interval').textContent = counts?.intervalMs != null ? `${(counts.intervalMs / 1000).toFixed(1)} 秒` : '—';
  byId('position').textContent = value.position ? `${reasons[value.position.reason]}${value.position.delta === undefined ? '' : `（${value.position.delta}px）`}\n${restorationDetails(value.position)}`.trim() : 'まだ補正していません';
  byId('identification').textContent = value.unidentified ? `現在の識別不可: ${identificationText(value.unidentifiedReasons)}` : value.domCount && !value.overLimit ? '現在の投稿IDは識別できています。' : '投稿の識別状態は未確認です。';
  byId('events').textContent = report.events.length ? report.events.slice(-15).map(e => `${new Date(e.at).toLocaleTimeString('ja-JP')} ${timelineLabel(e.timeline)} ${e.type === 'display' ? `DOM ${e.domCount} / 初見 +${e.newIds} / 再出現 +${e.reappeared}` : e.type === 'identification' ? `識別不可: ${identificationText(e.unidentifiedReasons!) || 'なし'}` : `${reasons[e.reason ?? ''] ?? e.reason}${e.method ? ` / ${methods[e.method]}` : ''}${e.actualDelta !== undefined ? ` / ${Math.round(e.actualDelta)}px` : ''}`}`).join('\n') : '診断を開始すると記録されます。';
  button('start').disabled = pending || report.running || value.state === 'outside' || value.timeline === null || value.overLimit;
  button('stop').disabled = pending || !report.running;
  button('start').classList.toggle('primary', !report.running);
  button('stop').classList.toggle('primary', report.running);
  button('export').disabled = !report.startedAt;
  button('clear').disabled = pending || !report.startedAt;
}
async function request(command = 'status') {
  if (tabId === undefined) return;
  try { render(await chrome.tabs.sendMessage(tabId, { command }) as Status); }
  catch {
    status = null;
    byId('status').textContent = '接続できません。x.comのタブを開き、導入直後は再読み込みしてください。';
    for (const id of ['start', 'stop', 'export', 'clear']) button(id).disabled = true;
  }
}
for (const command of ['start', 'stop', 'clear']) button(command).addEventListener('click', async () => {
  pending = true; if (status) render(status);
  await request(command); pending = false; if (status) render(status);
  byId('feedback').textContent = status ? { start: 'このタブの診断を開始しました', stop: '診断を停止しました', clear: '診断を消去しました' }[command]! : '';
});
button('export').addEventListener('click', () => {
  if (!status) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...status.diagnostic, current: { state: status.state, timeline: status.timeline, domCount: status.domCount, unidentified: status.unidentified, unidentifiedReasons: status.unidentifiedReasons, overLimit: status.overLimit, position: status.position, positionPhase: status.positionPhase } }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `x-home-diagnostic-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  byId('feedback').textContent = '診断JSONを出力しました';
});
async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    await request();
  } catch { byId('status').textContent = '拡張機能を読み込んだChromeで開いてください。'; }
}
void initialize();
setInterval(() => { if (!pending) void request(); }, 1000);
