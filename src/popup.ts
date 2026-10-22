import type { Status } from './controller.ts';

const status = document.getElementById('status')!;
const states: Record<Status['state'], string> = {
  active: '位置保持が動作中です。',
  outside: '対象外の画面です。',
  unrecognized: '画面構造を認識できません。',
};

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active tab');
    const value = await chrome.tabs.sendMessage(tab.id, { command: 'status' }) as Status;
    status.textContent = states[value.state];
  } catch {
    status.textContent = '接続できません。';
  }
}

void initialize();
