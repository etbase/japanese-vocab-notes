import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const port = 9338;
const profile = mkdtempSync(join(tmpdir(), 'jvn-check-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(150);
  }
  throw new Error('no chrome');
}
const ws = new WebSocket(await connect());
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) pending.get(message.id)(message);
});
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || 'eval failed');
  return result.result?.result?.value;
}
const oldData = {
  version: 1,
  notebooks: [{ id: 'nb-old', title: '旧ノート', color: 'sage', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-06-01T00:00:00.000Z' }],
  words: [{ id: 'old-1', notebookId: 'nb-old', kanji: '禁止', hiragana: 'きんし', note: '残す', highlight: 'green', order: 0, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-06-01T00:00:00.000Z' }],
  practiceLogs: [],
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('jvn.local-demo.v1', ${JSON.stringify(JSON.stringify(oldData))});`,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#/n/nb-old/p/1' });
await sleep(1000);
const report = {};
report.old = await evaluate(`(() => {
  const line = document.querySelector('[data-word-id="old-1"]');
  const marks = [...document.querySelectorAll('.mark')].map((node) => ({
    field: node.querySelector('input')?.dataset.field || '',
    ink: node.dataset.ink || '',
    cls: node.className,
  }));
  const data = JSON.parse(localStorage.getItem('jvn.local-demo.v1'));
  return {
    title: document.querySelector('#notebook-title')?.textContent || '',
    note: line?.querySelector('.note-dot')?.dataset.note || '',
    marks,
    storedKanji: data.words[0].kanji,
  };
})()`);
report.pen = await evaluate(`(() => {
  document.querySelector('#pen-toggle').click();
  const line = document.querySelector('[data-word-id="old-1"]');
  line.querySelector('[data-field="kanji"]').click();
  const palette = document.querySelector('.pen-palette').getBoundingClientRect();
  const buttons = [...document.querySelectorAll('.pen-choice')].map((button) => {
    const box = button.getBoundingClientRect();
    return { tool: button.dataset.tool, text: button.textContent, w: Math.round(box.width), h: Math.round(box.height) };
  });
  const erase = document.querySelector('[data-tool="erase"]').getBoundingClientRect();
  return {
    buttons,
    eraseInside: erase.right <= palette.right + 1 && erase.bottom <= palette.bottom + 1,
    kanji: line.querySelector('.word-kanji .mark')?.className || '',
    reading: line.querySelector('.word-reading .mark')?.className || '',
  };
})()`);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 80, y: 180, width: 560, height: 220, scale: 2 } });
await writeFile('/tmp/jvn-mark.png', Buffer.from(shot.result.data, 'base64'));

await evaluate(`location.hash = '#/'`);
await sleep(300);
await evaluate(`document.querySelector('#add-notebook').click()`);
await sleep(150);
await evaluate(`(() => {
  document.querySelector('#notebook-form input[name="title"]').value = '漢字練習';
  document.querySelector('input[name="notebook-type"][value="kanji"]').checked = true;
  document.querySelector('input[name="auto-lookup"][value="on"]').checked = true;
  document.querySelector('#notebook-form').requestSubmit();
})()`);
await sleep(300);
await evaluate(`([...document.querySelectorAll('.cover')].find((node) => node.textContent.includes('漢字練習')) || document.querySelector('.cover')).querySelector('.cover-open').click()`);
await sleep(400);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="kanji"]');
  input.focus();
  input.value = '経験';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1200);
report.keiken = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="0"]');
  return {
    reading: line.querySelector('[data-field="hiragana"]').value,
    translation: line.querySelector('[data-field="translation"]').value,
    rowH: Math.round(line.getBoundingClientRect().height),
  };
})()`);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="translation"]');
  input.focus();
  input.value = '經驗';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(500);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="kanji"]');
  input.focus();
  input.value = '約束';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(700);
report.stale = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="0"]');
  return {
    reading: line.querySelector('[data-field="hiragana"]').value,
    translation: line.querySelector('[data-field="translation"]').value,
    actions: [...line.querySelectorAll('.gloss-action')].map((node) => node.textContent),
  };
})()`);
await evaluate(`[...document.querySelectorAll('.gloss-action')].find((node) => node.textContent === '再検索')?.click()`);
await sleep(800);
report.research = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="0"]');
  const data = JSON.parse(localStorage.getItem('jvn.local-demo.v1'));
  const word = data.words.find((item) => item.kanji === '約束');
  return {
    reading: line.querySelector('[data-field="hiragana"]').value,
    translation: line.querySelector('[data-field="translation"]').value,
    edited: word?.translationEdited,
    storedTranslation: word?.translation,
  };
})()`);
await evaluate(`location.hash = '#/'`);
await sleep(250);
await evaluate(`document.querySelector('#add-notebook').click()`);
await sleep(150);
await evaluate(`(() => {
  document.querySelector('#notebook-form input[name="title"]').value = '外来語';
  document.querySelector('input[name="notebook-type"][value="katakana"]').checked = true;
  document.querySelector('input[name="auto-lookup"][value="on"]').checked = true;
  document.querySelector('#notebook-form').requestSubmit();
})()`);
await sleep(300);
await evaluate(`([...document.querySelectorAll('.cover')].find((node) => node.textContent.includes('外来語'))).querySelector('.cover-open').click()`);
await sleep(400);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="kanji"]');
  input.focus();
  input.value = 'アルバイト';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1000);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="1"] [data-field="kanji"]');
  input.focus();
  input.value = 'カード';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(800);
report.loan = await evaluate(`(() => {
  const first = document.querySelector('[data-slot="0"]');
  const second = document.querySelector('[data-slot="1"]');
  const empty = document.querySelector('[data-slot="3"]');
  const style = getComputedStyle(empty.querySelector('.gloss-input'), '::placeholder');
  return {
    arbeit: first.querySelector('[data-field="origin"]').value,
    arbeitLang: first.querySelector('[data-field="origin"]').title,
    arbeitZh: first.querySelector('[data-field="translation"]').value,
    card: second.querySelector('[data-field="origin"]').value,
    cardZh: second.querySelector('[data-field="translation"]').value,
    emptyPlaceholder: style.color,
    rows: document.querySelectorAll('.is-katakana').length,
  };
})()`);
await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="translation"]');
  input.value = '打工';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(500);
await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent === '練習する')?.click()`);
await sleep(400);
report.practice = await evaluate(`(() => {
  const prompt = document.querySelector('.word-kanji')?.textContent || '';
  const input = document.querySelector('.reading-input');
  input.focus();
  input.value = 'アルバイト';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return { prompt, status: input.className };
})()`);
await sleep(500);
report.judged = await evaluate(`document.querySelector('.reading-input')?.className || ''`);
await evaluate(`location.reload()`);
await sleep(900);
report.reload = await evaluate(`(() => {
  const data = JSON.parse(localStorage.getItem('jvn.local-demo.v1'));
  return {
    titles: data.notebooks.map((item) => item.title + ':' + item.type),
    old: data.words.find((item) => item.id === 'old-1'),
    loan: data.words.filter((item) => item.kanji === 'アルバイト' || item.kanji === 'カード').map((item) => ({
      kanji: item.kanji, origin: item.originWord, translation: item.translation, edited: item.translationEdited,
    })),
  };
})()`);
console.log(JSON.stringify(report, null, 2));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
