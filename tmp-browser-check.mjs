import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 9337;
const profile = mkdtempSync(join(tmpdir(), 'jvn-dict-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function websocket() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(150);
    }
  }
  throw new Error('chrome did not start');
}

const url = await websocket();
const ws = new WebSocket(url);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    throw new Error(JSON.stringify(result.result.exceptionDetails));
  }
  return result.result?.result?.value;
}

const oldData = {
  version: 1,
  notebooks: [{
    id: 'nb-old',
    title: '旧ノート',
    color: 'sage',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-06-01T00:00:00.000Z',
  }],
  words: [{
    id: 'old-1',
    notebookId: 'nb-old',
    kanji: '禁止',
    hiragana: 'きんし',
    note: '',
    highlight: 'green',
    order: 0,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-06-01T00:00:00.000Z',
  }],
  practiceLogs: [],
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('jvn.local-demo.v1', ${JSON.stringify(JSON.stringify(oldData))});`,
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#/notebook/nb-old/1' });
await sleep(1200);
const report = {};
report.boot = await evaluate(`({ href: location.href, title: document.querySelector('#notebook-title')?.textContent || '', root: document.querySelector('#app-root')?.innerText?.slice(0, 180) || '' })`);

report.migrated = await evaluate(`(() => {
  const word = document.querySelector('[data-word-id="old-1"]');
  const marks = [...document.querySelectorAll('.mark')].map((node) => node.className);
  const notebook = JSON.parse(localStorage.getItem('jvn.local-demo.v1'));
  const stored = notebook.notebooks.find((item) => item.id === 'nb-old');
  const saved = notebook.words.find((item) => item.id === 'old-1');
  return {
    title: document.querySelector('#notebook-title')?.textContent || '',
    marks,
    type: stored?.type,
    show: stored?.showTranslation,
    lookup: stored?.autoLookup,
    kanji: saved?.kanji,
    reading: saved?.hiragana,
    highlightKanji: saved?.highlightKanji,
    highlightReading: saved?.highlightReading,
    gloss: word?.querySelector('[data-field="translation"]')?.value || '',
  };
})()`);

report.palette = await evaluate(`(() => {
  document.querySelector('#pen-toggle')?.click();
  const palette = document.querySelector('.pen-palette');
  const buttons = [...document.querySelectorAll('.pen-choice')].map((button) => {
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      tool: button.dataset.tool,
      text: button.textContent,
      w: Math.round(box.width),
      h: Math.round(box.height),
      radius: style.borderRadius,
      nowrap: style.whiteSpace,
      shrink: style.flexShrink,
    };
  });
  const paletteBox = palette?.getBoundingClientRect();
  const eraseNode = document.querySelector('[data-tool="erase"]');
  const erase = eraseNode?.getBoundingClientRect();
  if (!paletteBox || !erase) return { buttons, missing: true };
  return {
    buttons,
    paletteW: Math.round(paletteBox.width),
    paletteH: Math.round(paletteBox.height),
    eraseInside: erase.right <= paletteBox.right + 1 && erase.left >= paletteBox.left - 1 && erase.bottom <= paletteBox.bottom + 1,
  };
})()`);

await evaluate(`location.hash = '#/'`);
await sleep(300);
await evaluate(`document.querySelector('#add-notebook')?.click()`);
await sleep(200);
report.dialog = await evaluate(`(() => {
  const labels = [...document.querySelectorAll('.choice')].map((node) => node.textContent);
  const katakana = document.querySelector('input[name="notebook-type"][value="katakana"]');
  const off = document.querySelector('input[name="auto-lookup"][value="off"]');
  if (katakana) katakana.checked = true;
  if (off) off.checked = true;
  const title = document.querySelector('#notebook-form input[name="title"]');
  title.value = 'カタカナ練習';
  document.querySelector('#notebook-form')?.requestSubmit();
  return labels;
})()`);
await sleep(300);

report.created = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.cover-title')].find((node) => node.textContent === 'カタカナ練習');
  return {
    found: Boolean(card),
    meta: card?.closest('.cover')?.innerText || card?.parentElement?.parentElement?.innerText || '',
  };
})()`);

await evaluate(`(() => {
  document.querySelector('[data-notebook-id] .cover-open')?.click();
})()`);
await sleep(200);
const openKatakana = await evaluate(`(() => {
  const covers = [...document.querySelectorAll('.cover')];
  const target = covers.find((node) => node.textContent.includes('カタカナ練習'));
  target?.querySelector('.cover-open')?.click();
  return Boolean(target);
})()`);
await sleep(400);
report.katakanaPage = await evaluate(`(() => ({
  opened: ${openKatakana},
  title: document.querySelector('#notebook-title')?.textContent || '',
  katakanaRows: document.querySelectorAll('.word-line.is-katakana').length,
  readingInputs: document.querySelectorAll('[data-field="hiragana"]').length,
  origin: document.querySelectorAll('[data-field="origin"]').length,
}))()`);

await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="kanji"]');
  input.focus();
  input.value = 'アルバイト';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);
report.arbeit = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="0"]');
  return {
    origin: line?.querySelector('[data-field="origin"]')?.value || '',
    translation: line?.querySelector('[data-field="translation"]')?.value || '',
    language: line?.querySelector('[data-field="origin"]')?.title || '',
  };
})()`);

await evaluate(`(() => {
  const input = document.querySelector('[data-slot="1"] [data-field="kanji"]');
  input.focus();
  input.value = 'カード';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(700);
report.card = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="1"]');
  return {
    origin: line?.querySelector('[data-field="origin"]')?.value || '',
    translation: line?.querySelector('[data-field="translation"]')?.value || '',
  };
})()`);

await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="translation"]');
  input.focus();
  input.value = '打工';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
})()`);
await sleep(500);
await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent === '翻訳')?.click()`);
await sleep(200);
report.hidden = await evaluate(`(() => {
  const gloss = document.querySelector('[data-slot="0"] .line-gloss');
  const row = document.querySelector('[data-slot="0"]');
  return {
    hidden: gloss?.hidden === true,
    hasGlossClass: row?.classList.contains('has-gloss') || false,
    rowH: Math.round(row?.getBoundingClientRect().height || 0),
  };
})()`);
await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent === '翻訳')?.click()`);
await sleep(200);
report.restored = await evaluate(`document.querySelector('[data-slot="0"] [data-field="translation"]')?.value || ''`);

await evaluate(`(() => {
  const input = document.querySelector('[data-slot="0"] [data-field="kanji"]');
  input.focus();
  input.value = 'コーヒー';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(600);
report.stale = await evaluate(`(() => {
  const line = document.querySelector('[data-slot="0"]');
  return {
    translation: line?.querySelector('[data-field="translation"]')?.value || '',
    actions: [...line.querySelectorAll('.gloss-action')].map((node) => node.textContent),
  };
})()`);

await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await sleep(300);
report.mobile = await evaluate(`(() => {
  document.documentElement.classList.toggle('is-compact', matchMedia('(max-width: 720px), (max-height: 520px)').matches);
  document.querySelector('#pen-toggle')?.click();
  const palette = document.querySelector('.pen-palette');
  const erase = document.querySelector('[data-tool="erase"]');
  const box = palette?.getBoundingClientRect();
  const eraseBox = erase?.getBoundingClientRect();
  const colors = [...document.querySelectorAll('.pen-choice:not([data-tool="erase"])')].map((button) => {
    const rect = button.getBoundingClientRect();
    return { w: Math.round(rect.width), h: Math.round(rect.height) };
  });
  return {
    compact: document.documentElement.classList.contains('is-compact'),
    colors,
    eraseText: erase?.textContent || '',
    eraseW: Math.round(eraseBox?.width || 0),
    eraseInside: Boolean(box && eraseBox && eraseBox.right <= box.right + 1 && eraseBox.bottom <= box.bottom + 1 && eraseBox.top >= box.top - 1),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs/promises');
await fs.writeFile('/tmp/jvn-mobile-pen.png', Buffer.from(shot.result.data, 'base64'));

await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await evaluate(`document.documentElement.classList.remove('is-compact')`);
await sleep(200);
const desk = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile('/tmp/jvn-desktop-gloss.png', Buffer.from(desk.result.data, 'base64'));

console.log(JSON.stringify(report, null, 2));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
