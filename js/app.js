/** 畫面切換、對話框與網址。資料寫入後由這裡重畫。 */

import { getCurrentUser, readyAuth, signInWithGoogle, signOutUser, usingDemoMode, watchAuth } from './auth.js';
import { deleteOwnedDocuments, writeOwnedDocuments } from './cloud.js';
import { lookupDictionary } from './dictionary.js';
import { needsChinese, translateJapanese } from './translate.js';
import {
  COVER_COLORS,
  closeLineMenus,
  renderNotebook,
  renderShelf,
  syncNoteDot,
  syncPaperLine,
} from './notebook.js';
import {
  addPracticeLog,
  createNotebook,
  deleteNotebook,
  deleteWord,
  ensureWordAt,
  getNotebook,
  getNotebooks,
  getWordsByNotebook,
  commitImportedState,
  hasCloudWarning,
  hasPersistenceWarning,
  pauseCloudPush,
  readSession,
  resumeCloudPush,
  insertWordAt,
  ready,
  setActiveUser,
  setHighlight,
  updateNotebook,
  updateWord,
} from './storage.js';
import { judgeAnswer } from './practice.js';
import { buildExportFile, inspectImportFile, planCsvImport, planJsonAppend } from './transfer.js';
import {
  PAGE_SIZE,
  editablePageLimit,
  isHiragana,
  notebookStats,
  pageCount,
  pageForWord,
  spreadFor,
  wordsForPage,
} from './vocabulary.js';

const COMPACT_QUERY = '(max-width: 720px), (max-height: 520px)';

const state = {
  view: 'shelf',
  notebookId: null,
  page: 1,
  turn: null,
  flashWordId: null,
  freshId: null,
  focusSelector: null,
  pen: { active: false, tool: 'yellow' },
  study: null,
  answers: {},
  revealed: {},
  showResult: false,
  focusDraft: '',
  focusSlot: null,
};

let previousView = null;
let closeModal = () => {};
let rendering = false;
const lineTimers = new Map();
const glossTimers = new Map();
let statusTimer = 0;
let translationQueue = Promise.resolve();
let batchRunning = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyCompact() {
  document.documentElement.classList.toggle(
    'is-compact',
    window.matchMedia(COMPACT_QUERY).matches,
  );
}

function notebookHash(id, page) {
  return `#/n/${encodeURIComponent(id)}/p/${page}`;
}

function parseHash(hash) {
  const value = String(hash || '').replace(/^#/, '');
  const match = value.match(/^\/n\/([^/]+)\/p\/(\d+)$/);
  if (!match) return { view: 'shelf' };
  const page = Number.parseInt(match[2], 10);
  return {
    view: 'notebook',
    notebookId: decodeURIComponent(match[1]),
    page: Number.isFinite(page) ? page : 1,
  };
}

function isCompact() {
  return document.documentElement.classList.contains('is-compact');
}

function syncWarning() {
  const note = document.querySelector('#save-warning');
  if (!note) return;
  if (hasCloudWarning()) {
    note.hidden = false;
    note.textContent = 'クラウドに保存できませんでした。ログインと通信を確認してください。';
  } else if (hasPersistenceWarning()) {
    note.hidden = false;
    note.textContent = 'ブラウザに保存できませんでした。読み込み直すと、変更が残らないことがあります。';
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

function focusPending() {
  if (!state.focusSelector) return;
  const selector = state.focusSelector;
  state.focusSelector = null;
  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement)) return;
  const options = { preventScroll: true };
  if (target.id === 'notebook-title' || target.classList.contains('cover-open')) options.focusVisible = false;
  try {
    target.focus(options);
  } catch {
    target.focus({ preventScroll: true });
  }
  if (target instanceof HTMLInputElement) {
    const end = target.value.length;
    target.setSelectionRange(end, end);
  }
}

function snapshotPracticeFields() {
  if (state.skipSnapshot) {
    state.skipSnapshot = false;
    return;
  }
  document.querySelectorAll('[data-word-input]').forEach((input) => {
    const current = state.answers[input.dataset.wordInput] || {};
    state.answers[input.dataset.wordInput] = { ...current, value: input.value };
  });
  const focusInput = document.querySelector('[data-focus-input]');
  if (focusInput) state.focusDraft = focusInput.value;
}

function displayedWords(allWords) {
  let words = allWords;
  if (state.study?.kind === 'practice' && state.study.reviewIds) {
    const ids = new Set(state.study.reviewIds);
    words = words.filter((word) => ids.has(word.id));
  }
  if (state.study?.script === 'zh' || state.study?.script === 'katakana') {
    words = words.filter((word) => practiceEligible(word, state.study.script));
  }
  return words;
}

function practiceEligible(word, script) {
  if (script === 'zh') return Boolean(String(word?.translation || '').trim());
  if (script === 'katakana') {
    return Boolean(String(word?.translation || '').trim() || String(word?.originWord || '').trim());
  }
  return Boolean(String(word?.kanji || '').trim() || String(word?.hiragana || '').trim());
}

function currentNotebook() {
  return state.notebookId ? getNotebook(state.notebookId) : null;
}

function meaningfulWords(words) {
  return words.filter((word) => word.kanji.trim() || word.hiragana.trim());
}

function practiceWords(words, script) {
  const list = meaningfulWords(words);
  const mode = script || (currentNotebook()?.type === 'katakana' ? 'katakana' : 'hiragana');
  if (mode === 'hiragana') return list;
  return list.filter((word) => practiceEligible(word, mode));
}

function pageLimitFor(allWords) {
  if (state.study) return pageCount(displayedWords(meaningfulWords(allWords)));
  return editablePageLimit(allWords, { compact: isCompact() });
}

function refreshNotebookChrome() {
  if (rendering || state.view !== 'notebook' || state.study?.kind === 'focus') return;
  const words = getWordsByNotebook(state.notebookId);
  const stats = notebookStats(words);
  const summary = document.querySelector('.notebook-summary');
  const kind = currentNotebook()?.type === 'katakana' ? 'カタカナ' : '漢字';
  if (summary) summary.textContent = `${stats.total}語・${kind}`;
  const view = spreadFor(state.page, pageLimitFor(words), { compact: isCompact() });
  const prev = document.querySelector('[data-pager="prev"]');
  const next = document.querySelector('[data-pager="next"]');
  if (prev) prev.disabled = Boolean(state.study) && state.study.kind === 'focus' ? true : !view.hasPrev;
  if (next) next.disabled = Boolean(state.study) && state.study.kind === 'focus' ? true : !view.hasNext;
  if (state.study?.kind === 'focus') return;
  const status = document.querySelector('.pager-status');
  if (!status) return;
  const visible = view.pages.filter((pageNumber, index) => !(isCompact() && index > 0));
  status.textContent = visible.length > 1 ? `${visible[0]}–${visible[1]}` : String(visible[0] || '');
}

function stampLineIds() {
  getWordsByNotebook(state.notebookId).forEach((word, index) => {
    const line = document.querySelector(`[data-slot="${index}"]`);
    if (line) line.dataset.wordId = word.id;
  });
}

function saveSlotNow(slot, kanji, hiragana, { lookup = false } = {}) {
  if (isLocked()) return;
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const nextKanji = String(kanji ?? '').trim();
  const nextReading = String(hiragana ?? '').trim();
  const input = line?.querySelector('[data-field="hiragana"]');
  const typingRomaji = document.activeElement === input && /^[A-Za-z]+$/.test(nextReading);
  const invalid = Boolean(nextReading) && !isHiragana(nextReading) && !typingRomaji;
  if (input) {
    input.classList.toggle('is-invalid', invalid);
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const storedList = getWordsByNotebook(state.notebookId);
  const stored = id
    ? storedList.find((word) => word.id === id)
    : storedList[slot];
  if (id && !stored) return;
  if (!stored && !nextKanji && !nextReading) return;
  if (stored && stored.kanji === nextKanji && stored.hiragana === nextReading) {
    if (lookup && nextKanji) assistWord(stored.id, nextKanji);
    return;
  }
  const headChanged = Boolean(stored) && stored.kanji !== nextKanji;
  const readingChanged = Boolean(stored) && stored.hiragana !== nextReading;
  const patch = { kanji: nextKanji, hiragana: nextReading };
  if (readingChanged) patch.readingEdited = true;
  if (headChanged && !readingChanged && stored && !stored.readingEdited) patch.hiragana = '';
  if (id) updateWord(id, patch);
  else ensureWordAt(state.notebookId, slot, patch);
  if (patch.hiragana === '') {
    const readingInput = line?.querySelector('[data-field="hiragana"]');
    if (readingInput && document.activeElement !== readingInput) readingInput.value = '';
  }
  stampLineIds();
  refreshNotebookChrome();
  const wordId = id || document.querySelector(`[data-slot="${slot}"]`)?.dataset.wordId || '';
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (lookup && word && nextKanji) assistWord(word.id, nextKanji);
}

function scheduleLineSave(slot, kanji, hiragana) {
  clearTimeout(lineTimers.get(slot));
  lineTimers.set(slot, setTimeout(() => {
    lineTimers.delete(slot);
    saveSlotNow(slot, kanji, hiragana);
  }, 400));
}

function scheduleGlossSave(slot, field, value) {
  const key = `${slot}:${field}`;
  clearTimeout(glossTimers.get(key));
  glossTimers.set(key, setTimeout(() => {
    glossTimers.delete(key);
    saveGlossNow(slot, field, value);
  }, 400));
}

function saveGlossNow(slot, field, value) {
  if (isLocked()) return;
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const text = String(value ?? '').trim();
  const stored = id
    ? getWordsByNotebook(state.notebookId).find((word) => word.id === id)
    : null;
  if (id && !stored) return;
  if (field === 'origin') {
    if ((stored?.originWord || '') === text) {
      clearGlossDirty(slot, field, text);
      return;
    }
    const patch = {
      originWord: text,
      originEdited: true,
      originLanguage: '',
      glossStale: false,
    };
    if (stored) updateWord(stored.id, patch);
    else if (text) ensureWordAt(state.notebookId, slot, patch).then(() => stampLineIds());
    clearGlossDirty(slot, field, text);
    return;
  }
  if ((stored?.translation || '') === text) {
    clearGlossDirty(slot, field, text);
    return;
  }
  const patch = { translation: text, translationEdited: true, glossStale: false };
  if (stored) updateWord(stored.id, patch);
  else if (text) ensureWordAt(state.notebookId, slot, patch).then(() => stampLineIds());
  clearGlossDirty(slot, field, text);
}

function clearGlossDirty(slot, field, text) {
  const input = document.querySelector(`[data-slot="${slot}"] [data-field="${field}"]`);
  if (input instanceof HTMLInputElement && input.value.trim() === text) delete input.dataset.dirty;
}

function flushGlossEdits() {
  document.querySelectorAll('.gloss-input').forEach((input) => {
    const line = input.closest('[data-slot]');
    if (!line) return;
    const slot = Number(line.dataset.slot);
    const field = input.dataset.field || 'translation';
    clearTimeout(glossTimers.get(`${slot}:${field}`));
    glossTimers.delete(`${slot}:${field}`);
    saveGlossNow(slot, field, input.value);
  });
}

function enqueueTranslation(task) {
  const run = translationQueue.then(task, task);
  translationQueue = run.then(() => {}, () => {});
  return run;
}

function assistWord(wordId, head) {
  if (isLocked()) return;
  fillReading(wordId, head);
  enqueueTranslation(() => translateWord(wordId, head));
}

async function fillReading(wordId, head) {
  const notebook = currentNotebook();
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  const key = String(head || word?.kanji || '').trim();
  if (!notebook || !word || word.kanji !== key) return;
  let result = null;
  try {
    result = await lookupDictionary(key);
  } catch {
    result = null;
  }
  if (result?.unavailable) return;
  const latest = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (!latest || latest.kanji !== key) return;
  const patch = {};
  if (
    result?.reading
    && isHiragana(result.reading)
    && notebook.type !== 'katakana'
    && !latest.readingEdited
    && !latest.hiragana.trim()
  ) {
    patch.hiragana = result.reading;
  }
  const origin = String(result?.originWord || '').trim();
  if (
    origin
    && /[A-Za-z\u00C0-\u024F]/u.test(origin)
    && !latest.originEdited
    && !String(latest.originWord || '').trim()
  ) {
    patch.originWord = origin;
    patch.originLanguage = result.originLanguage || '';
  }
  if (!Object.keys(patch).length) return;
  await updateWord(wordId, patch);
  const saved = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (saved) syncPaperLine(saved);
}

async function translateWord(wordId, head) {
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  const key = String(head || word?.kanji || '').trim();
  if (!word || word.kanji !== key || !needsChinese(word)) return { ok: false, reason: 'skip' };
  const pending = pendingField(wordId, 'translation');
  if (pending !== null && pending !== String(word.translation || '').trim()) return { ok: false, reason: 'skip' };
  const result = await translateJapanese(key);
  const latest = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (!latest || latest.kanji !== key || !needsChinese(latest)) return { ok: false, reason: 'skip' };
  if (!result.ok) return result;
  await updateWord(wordId, { translation: result.text, translationEdited: false });
  const line = document.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  const input = line?.querySelector('[data-field="translation"]');
  if (input instanceof HTMLInputElement && !input.value.trim()) delete input.dataset.dirty;
  const saved = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (saved) syncPaperLine(saved);
  return { ok: true };
}

function pendingField(wordId, field) {
  const line = document.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  const input = line?.querySelector(`[data-field="${field}"]`);
  if (!(input instanceof HTMLInputElement)) return null;
  if (input.dataset.dirty === 'true') return input.value.trim();
  return null;
}

function toggleTranslation() {
  const notebook = currentNotebook();
  if (!notebook) return;
  flushLineEdits();
  flushGlossEdits();
  updateNotebook(notebook.id, { showTranslation: notebook.showTranslation === false });
  render();
}

function flashStatus(message, { sticky = false, duration = 3200 } = {}) {
  const live = document.querySelector('#live-status');
  if (live) live.textContent = message;
  const slot = document.querySelector('#tool-status');
  if (!slot) return;
  slot.hidden = false;
  slot.textContent = message;
  clearTimeout(statusTimer);
  if (sticky) return;
  statusTimer = setTimeout(() => {
    if (slot.textContent === message) {
      slot.hidden = true;
      slot.textContent = '';
    }
  }, duration);
}

async function translateMissing() {
  if (batchRunning || isLocked()) return;
  flushLineEdits();
  flushGlossEdits();
  const notebook = currentNotebook();
  if (!notebook) return;
  const words = getWordsByNotebook(state.notebookId);
  const skipped = words.filter((word) => String(word.kanji || '').trim() && !needsChinese(word)).length;
  const targets = words.filter(needsChinese);
  if (!targets.length) {
    flashStatus(skipped ? `未翻訳の単語はありません。\n${skipped}語はスキップしました。` : '未翻訳の単語はありません。');
    return;
  }
  batchRunning = true;
  let success = 0;
  let failed = 0;
  let quota = false;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      flashStatus(`翻訳中 ${index + 1}/${targets.length}`, { sticky: true });
      const outcome = await enqueueTranslation(() => translateWord(targets[index].id, targets[index].kanji));
      if (outcome?.reason === 'quota') {
        quota = true;
        break;
      }
      if (outcome?.ok) success += 1;
      else if (outcome?.reason !== 'skip') failed += 1;
    }
  } finally {
    batchRunning = false;
  }
  const lines = [
    `${success}語を翻訳しました。`,
    `${failed}語は失敗しました。`,
    `${skipped}語はスキップしました。`,
  ];
  if (quota) lines.push('本日の無料翻訳上限に達したため、残りの翻訳を停止しました。');
  flashStatus(lines.join('\n'), { duration: 7000 });
}

function flushLineEdits() {
  document.querySelectorAll('.word-line[data-slot]').forEach((line) => {
    const slot = Number(line.dataset.slot);
    clearTimeout(lineTimers.get(slot));
    lineTimers.delete(slot);
    const kanji = line.querySelector('[data-field="kanji"]')?.value ?? '';
    const hiragana = line.querySelector('[data-field="hiragana"]')?.value ?? '';
    if (!kanji.trim() && !hiragana.trim() && !line.dataset.wordId) return;
    saveSlotNow(slot, kanji, hiragana);
  });
}

function captureLineFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !active.classList.contains('paper-input')) return;
  const line = active.closest('[data-slot]');
  if (!line) return;
  state.focusSlot = {
    slot: Number(line.dataset.slot),
    field: active.dataset.field,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restoreLineFocus() {
  const pending = state.focusSlot;
  if (!pending) return;
  state.focusSlot = null;
  const input = document.querySelector(`[data-slot="${pending.slot}"] [data-field="${pending.field}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  const end = input.value.length;
  const start = Math.min(pending.start ?? end, end);
  const stop = Math.min(pending.end ?? end, end);
  try {
    input.setSelectionRange(start, stop);
  } catch {
    /* 部分輸入法在組字時不允許設定選取範圍。 */
  }
}

function render() {
  rendering = true;
  if (!state.focusSlot) captureLineFocus();
  flushLineEdits();
  flushGlossEdits();
  snapshotPracticeFields();
  const root = document.querySelector('#app-root');
  const turn = state.turn;
  const flashWordId = state.flashWordId;
  const freshId = state.freshId;
  state.turn = null;
  state.flashWordId = null;
  state.freshId = null;

  const enteredNotebook = state.view === 'notebook' && previousView !== 'notebook';
  previousView = state.view;

  if (state.view === 'notebook') {
    const notebook = getNotebook(state.notebookId);
    if (!notebook) {
      state.view = 'shelf';
      state.notebookId = null;
      previousView = 'shelf';
      if (location.hash && location.hash !== '#/' && location.hash !== '#') {
        history.replaceState(null, '', '#/');
      }
      renderShelfView(root, freshId);
    } else {
      const allWords = getWordsByNotebook(notebook.id);
      if (state.study?.kind === 'focus' && state.study.wordsById) {
        const fresh = new Map(allWords.map((word) => [word.id, word]));
        state.study.wordIds.forEach((id) => {
          const word = fresh.get(id);
          if (word) state.study.wordsById[id] = word;
        });
      }
      const pool = state.study ? meaningfulWords(allWords) : allWords;
      const words = displayedWords(pool);
      if (state.study?.kind !== 'focus') {
        const view = spreadFor(state.page, pageLimitFor(allWords), { compact: isCompact() });
        if (view.current !== state.page) {
          state.page = view.current;
          const hash = notebookHash(notebook.id, state.page);
          if (location.hash !== hash) history.replaceState(null, '', hash);
        }
      }
      renderNotebook(root, {
        notebook,
        words,
        totalWords: allWords,
        page: state.page,
        compact: isCompact(),
        turn,
        flashWordId,
        pen: state.pen,
        study: state.study,
        answers: state.answers,
        revealed: state.revealed,
        showResult: state.showResult,
        focusDraft: state.focusDraft,
        onStep: step,
        onHighlight: changeHighlight,
        onTogglePen: togglePen,
        onSelectPen: selectPen,
        onToggleLock: toggleLock,
        onDeleteWord: confirmDeleteLine,
        onEditLine: ({ slot, kanji, hiragana, lookup }) => {
          if (lookup) {
            clearTimeout(lineTimers.get(slot));
            lineTimers.delete(slot);
            saveSlotNow(slot, kanji, hiragana, { lookup: true });
            return;
          }
          scheduleLineSave(slot, kanji, hiragana);
        },
        onEditGloss: ({ slot, field, value }) => scheduleGlossSave(slot, field, value),
        onToggleTranslation: toggleTranslation,
        onTranslateMissing: translateMissing,
        onAdvance: advanceToSlot,
        onInsertLine: insertLine,
        onSaveNote: saveLineNote,
        pageLimit: pageLimitFor(allWords),
        onStartPractice: startPractice,
        onStartFocus: startFocus,
        onExitStudy: exitStudy,
        onFinishPractice: finishPractice,
        onRetry: retryPractice,
        onReview: reviewWrong,
        onFocusCorrect: focusCorrect,
        onFocusWrong: focusWrong,
        onFocusDraft: (value) => {
          state.focusDraft = value;
        },
        onExport: exportOpenNotebook,
        onAppend: openAppendForCurrent,
      });
      if (!state.focusSelector && !state.focusSlot && enteredNotebook) state.focusSelector = '#notebook-title';
    }
  } else {
    renderShelfView(root, freshId);
  }

  if (turn && state.view === 'notebook') {
    const live = document.querySelector('#live-status');
    if (live) live.textContent = `${state.page}ページを開きました`;
  }
  syncWarning();
  rendering = false;
  restoreLineFocus();
  focusPending();
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportOpenNotebook() {
  if (!getCurrentUser().uid) {
    requireSignIn();
    return;
  }
  const notebook = getNotebook(state.notebookId);
  if (!notebook) return;
  const words = getWordsByNotebook(notebook.id);
  const logs = (readSession()?.practiceLogs || []).filter((log) => log.notebookId === notebook.id);
  const file = buildExportFile(JSON.stringify({
    version: 1,
    notebooks: [notebook],
    words,
    practiceLogs: logs,
  }), 'notebook');
  const filename = `jvn-${notebook.title.replace(/[\\/:*?"<>|]/g, '')}.json`;
  downloadJson(filename, file);
}

function requireSignIn() {
  if (getCurrentUser().uid) return true;
  openModal({
    title: 'ログイン',
    body: 'ログインすると、自分のノートに読み込めます。',
    actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
  });
  return false;
}

function fillPreview(container, plan) {
  if (plan.mode === 'append' && plan.append) {
    const info = plan.append;
    const last = info.lastKanji ? `${info.lastKanji}（${info.lastHiragana}）` : 'なし';
    container.append(el('p', 'modal-text', '読み込み方：既存ノートに追加'));
    container.append(el('p', 'modal-text', `ノート：${info.title}`));
    container.append(el('p', 'modal-text', `いまの単語：${info.currentCount}`));
    container.append(el('p', 'modal-text', `追加：${info.fileCount}`));
    container.append(el('p', 'modal-text', `あわせて：${info.nextCount}`));
    container.append(el('p', 'modal-text', `いまの最後：${last}`));
    const list = el('ol', 'import-word-list');
    info.rows.forEach((row) => {
      const item = document.createElement('li');
      item.append(
        el('span', '', row.kanji),
        el('span', '', row.hiragana),
        el('span', 'vocab-translation', row.translation),
      );
      list.append(item);
    });
    container.append(list);
    container.append(el('p', 'modal-text', 'いまの単語、マーカー、設定はそのままです。確認するまで保存しません。'));
    if (info.addedCount !== info.fileCount) {
      container.append(el('p', 'modal-text', `新しく保存するのは${info.addedCount}語です。`));
    }
    return;
  }
  const target = plan.preview[0];
  container.append(el('p', 'modal-text', plan.kind === 'csv'
    ? `「${target?.title || 'ノート'}」に${plan.totalWords}語を追加します。`
    : `${plan.preview.length}冊、${plan.totalWords}語を読み込みます。`));
  plan.preview.forEach((item) => {
    const rename = item.previousTitle ? `名前は「${item.previousTitle}」から「${item.title}」になります。` : '';
    const last = item.lastKanji ? `最後は「${item.lastKanji}」。` : '';
    container.append(el('p', 'modal-text', `「${item.title}」${item.count}語。${last}${rename}`));
  });
  if (plan.kind === 'json') {
    container.append(el('p', 'modal-text', '平仮名、中文、順序、マーカー、設定もそのまま移します。'));
  }
  container.append(el('p', 'modal-text', 'クラウドの既存データは上書きも削除もしません。確認するまで保存しません。'));
  if (!plan.words.length && !plan.notebooks.length && !plan.practiceLogs.length) {
    container.append(el('p', 'modal-text', '同じ内容はすでにあります。記録だけ残します。'));
  } else if (plan.words.length !== plan.totalWords) {
    container.append(el('p', 'modal-text', `新しく保存するのは${plan.words.length}語です。`));
  }
}

let importBusy = false;

async function applyImport(plan, button) {
  if (!plan?.ok || importBusy) return;
  const user = getCurrentUser();
  if (!user.uid) {
    closeModal();
    requireSignIn();
    return;
  }
  importBusy = true;
  if (button) button.disabled = true;
  const uid = user.uid;
  pauseCloudPush();
  const written = await writeOwnedDocuments(uid, {
    notebooks: plan.notebooks,
    words: plan.words,
    practiceLogs: plan.practiceLogs,
    meta: { ...plan.meta, updatedAt: new Date().toISOString() },
  });
  if (!written.ok) {
    const undone = await deleteOwnedDocuments(uid, written.created);
    resumeCloudPush();
    importBusy = false;
    closeModal();
    openModal({
      title: '読み込めませんでした',
      body: undone.ok
        ? 'クラウドには保存されていません。もう一度読み込めます。'
        : '保存を取り消せませんでした。同じファイルは、重なるデータがあると上書きせずに止まります。',
      actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
    });
    return;
  }
  if (getCurrentUser().uid !== uid) {
    resumeCloudPush();
    importBusy = false;
    closeModal();
    return;
  }
  const session = readSession();
  resumeCloudPush();
  commitImportedState({
    ...session,
    starterWordsVersion: plan.meta.starterWordsVersion,
    importedBatches: plan.meta.importedBatches,
    completedImports: plan.meta.completedImports,
    notebooks: [...session.notebooks, ...plan.notebooks],
    words: [...session.words, ...plan.words],
    practiceLogs: [...session.practiceLogs, ...plan.practiceLogs],
  });
  importBusy = false;
  closeModal();
  render();
  if (plan.mode === 'append' && plan.words.length) {
    const first = plan.words[0];
    const title = plan.append?.title || 'ノート';
    openModal({
      title: '読み込みました',
      body: `「${title}」に${plan.words.length}語を追加しました。`,
      actions: [
        {
          label: '最初の新しい単語を開く',
          className: 'btn btn-primary',
          onClick: () => {
            const page = pageForWord(getWordsByNotebook(first.notebookId), first.id);
            closeModal({ restore: false });
            location.hash = notebookHash(first.notebookId, page);
          },
        },
        { label: '閉じる', className: 'btn btn-ghost', onClick: () => closeModal() },
      ],
    });
  }
}

function showPlan(plan) {
  if (!plan?.ok) {
    openModal({
      title: '読み込む',
      body: plan?.message || 'このファイルは読み込めません。',
      actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
    });
    return;
  }
  const body = el('div', 'import-preview');
  fillPreview(body, plan);
  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', 'キャンセル');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal());
  const confirm = el('button', 'btn btn-primary', '読み込む');
  confirm.type = 'button';
  confirm.addEventListener('click', () => applyImport(plan, confirm));
  actions.append(cancel, confirm);
  body.append(actions);
  openModal({ title: '読み込みの確認', body, actions: [] });
}

function openAppendPreview(text, kind, notebooks) {
  const body = el('div', 'import-preview');
  const summary = el('div');
  let selected = notebooks[0].id;
  let plan = null;
  let ticket = 0;
  const confirm = el('button', 'btn btn-primary', '読み込む');
  confirm.type = 'button';
  confirm.disabled = true;
  const refresh = async () => {
    const current = ticket + 1;
    ticket = current;
    confirm.disabled = true;
    const session = readSession();
    const next = kind === 'csv'
      ? await planCsvImport(text, session, selected)
      : await planJsonAppend(text, session, selected);
    if (current !== ticket) return;
    plan = next;
    summary.replaceChildren();
    if (!plan.ok) {
      summary.append(el('p', 'modal-text', plan.message));
      return;
    }
    fillPreview(summary, plan);
    confirm.disabled = plan.words.length === 0;
  };
  if (notebooks.length > 1) {
    const label = el('label', 'field');
    label.append(el('span', 'field-label', '追加先のノート'));
    const select = document.createElement('select');
    notebooks.forEach((notebook) => {
      const option = document.createElement('option');
      option.value = notebook.id;
      option.textContent = notebook.title;
      select.append(option);
    });
    select.addEventListener('change', () => {
      selected = select.value;
      refresh();
    });
    label.append(select);
    body.append(label);
  }
  body.append(summary);
  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', 'キャンセル');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal());
  confirm.addEventListener('click', () => applyImport(plan, confirm));
  actions.append(cancel, confirm);
  body.append(actions);
  openModal({ title: '読み込みの確認', body, actions: [] });
  refresh();
}

function importKind(file, text) {
  const name = file.name.toLowerCase();
  const trimmed = text.trimStart();
  return name.endsWith('.csv') || (!trimmed.startsWith('{') && !trimmed.startsWith('[')) ? 'csv' : 'json';
}

function openAppendForCurrent() {
  if (!requireSignIn()) return;
  const notebook = getNotebook(state.notebookId);
  if (!notebook) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,application/json,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    openAppendPreview(text, importKind(file, text), [notebook]);
  });
  input.click();
}

function notebookImportField() {
  let current = { status: 'empty' };
  const field = el('div', 'field import-file-field');
  field.append(el('span', 'field-label', '単語を読み込む（任意）'));
  const row = el('div', 'import-file-row');
  const pick = el('button', 'btn btn-ghost', 'ファイルを選択');
  pick.type = 'button';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,application/json,text/csv';
  input.hidden = true;
  const clear = el('button', 'text-button', '選ばない');
  clear.type = 'button';
  const name = el('p', 'import-file-name', 'ファイルはまだ選んでいません');
  const preview = el('div', 'import-file-preview');
  const reset = () => {
    input.value = '';
    current = { status: 'empty' };
    name.textContent = 'ファイルはまだ選んでいません';
    preview.replaceChildren();
  };
  pick.addEventListener('click', () => input.click());
  clear.addEventListener('click', reset);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    preview.replaceChildren();
    if (!file) {
      reset();
      return;
    }
    const text = await file.text();
    const kind = importKind(file, text);
    const inspected = await inspectImportFile(text, kind);
    if (!inspected.ok) {
      current = { status: 'error', message: inspected.message };
      name.textContent = file.name;
      preview.append(el('p', 'form-error', inspected.message));
      return;
    }
    current = { status: 'ready', text, kind, count: inspected.count };
    name.textContent = `${file.name}（${inspected.count}語）`;
    const list = el('ol', 'import-word-list');
    inspected.rows.forEach((row) => {
      const item = document.createElement('li');
      item.append(el('span', '', row.kanji), el('span', '', row.hiragana), el('span', 'vocab-translation', row.translation));
      list.append(item);
    });
    preview.append(list);
    paintConfirm();
  });
  const confirm = el('p', 'modal-text');
  confirm.hidden = true;
  const paintConfirm = () => {
    if (current.status !== 'ready') {
      confirm.hidden = true;
      confirm.textContent = '';
      return;
    }
    const form = field.closest('form');
    const title = form?.querySelector('input[name="title"]')?.value.trim() || '（名前が未入力）';
    const type = form?.querySelector('input[name="notebook-type"]:checked')?.value === 'katakana' ? 'カタカナノート' : '漢字ノート';
    const color = form?.querySelector('input[name="cover-color"]:checked')?.closest('label')?.querySelector('.visually-hidden')?.textContent || '';
    confirm.hidden = false;
    confirm.textContent = `「${title}」（${type}${color ? `・${color}` : ''}）を作り、${current.count}語を読み込みます。ファイル内の名前・種類・色は使いません。つくるまで保存しません。`;
  };
  field.addEventListener('input', paintConfirm);
  field.addEventListener('change', paintConfirm);
  row.append(pick, clear, input);
  field.append(row, name, confirm, preview);
  return { field, state: () => current, refresh: paintConfirm };
}

async function createNotebookWithWords(payload, imported) {
  const user = getCurrentUser();
  if (!user.uid) return { ok: false, message: 'ログインしてください' };
  pauseCloudPush();
  const created = await createNotebook(payload);
  if (!created.ok) {
    resumeCloudPush();
    return created;
  }
  const plan = imported.kind === 'csv'
    ? await planCsvImport(imported.text, readSession(), created.notebook.id)
    : await planJsonAppend(imported.text, readSession(), created.notebook.id);
  if (!plan.ok || !plan.words.length) {
    await deleteNotebook(created.notebook.id);
    resumeCloudPush();
    return { ok: false, message: plan.message || '単語を読み込めませんでした。ノートは作られていません。' };
  }
  const written = await writeOwnedDocuments(user.uid, {
    notebooks: [created.notebook],
    words: plan.words,
    practiceLogs: [],
    meta: { ...plan.meta, updatedAt: new Date().toISOString() },
  });
  if (!written.ok) {
    await deleteOwnedDocuments(user.uid, written.created);
    await deleteNotebook(created.notebook.id);
    resumeCloudPush();
    return { ok: false, message: '保存できませんでした。ノートは作られていません。' };
  }
  if (getCurrentUser().uid !== user.uid) {
    resumeCloudPush();
    return { ok: false, message: 'ログインが変わったため、中止しました。' };
  }
  const session = readSession();
  commitImportedState({
    ...session,
    starterWordsVersion: plan.meta.starterWordsVersion,
    importedBatches: plan.meta.importedBatches,
    completedImports: plan.meta.completedImports,
    notebooks: session.notebooks,
    words: [...session.words, ...plan.words],
    practiceLogs: session.practiceLogs,
  });
  resumeCloudPush();
  return created;
}

function renderShelfView(root, freshId) {
  const notebooks = getNotebooks();
  const wordsByNotebook = new Map(
    notebooks.map((notebook) => [notebook.id, getWordsByNotebook(notebook.id)]),
  );
  renderShelf(root, {
    notebooks,
    wordsByNotebook,
    freshId,
    onCreate: () => openNotebookDialog('create'),
    onEdit: (notebook) => openNotebookDialog('edit', notebook),
    onDelete: confirmDelete,
  });
}

function step(direction) {
  if (state.view !== 'notebook') return;
  if (state.study?.kind === 'focus') {
    stepFocus(direction);
    return;
  }
  flushLineEdits();
  const allWords = getWordsByNotebook(state.notebookId);
  const view = spreadFor(state.page, pageLimitFor(allWords), { compact: isCompact() });
  if (direction === 'next' && !view.hasNext) return;
  if (direction === 'prev' && !view.hasPrev) return;
  const delta = isCompact() ? 1 : 2;
  const next = direction === 'next' ? view.current + delta : view.current - delta;
  state.turn = direction;
  state.page = next;
  const hash = notebookHash(state.notebookId, next);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

function notebookWords() {
  return getWordsByNotebook(state.notebookId);
}

function isLocked(notebook = currentNotebook()) {
  return notebook?.locked !== false;
}

function focusPageOf(wordId, words = notebookWords()) {
  return pageForWord(words, wordId);
}

function focusStartIndex(words, practiceList) {
  const total = pageCount(words);
  const view = spreadFor(state.page, total, { compact: isCompact() });
  const ids = new Set(practiceList.map((word) => word.id));
  const order = [];
  for (let page = view.pages[0]; page <= total; page += 1) order.push(page);
  for (let page = view.pages[0] - 1; page >= 1; page -= 1) order.push(page);
  for (const page of order) {
    const found = wordsForPage(words, page).find((word) => ids.has(word.id));
    if (!found) continue;
    return practiceList.findIndex((word) => word.id === found.id);
  }
  return 0;
}

function rememberNotebookPage(page) {
  state.page = page;
  const hash = notebookHash(state.notebookId, page);
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function syncStudyPage() {
  const study = state.study;
  if (!study || study.kind !== 'focus' || study.finished) return;
  const words = notebookWords();
  const page = focusPageOf(study.wordIds[study.index], words);
  if (page !== state.page) rememberNotebookPage(page);
}

function stepFocus(direction) {
  const study = state.study;
  if (!study || study.finished) return;
  const index = study.index + (direction === 'next' ? 1 : -1);
  if (index < 0 || index >= study.wordIds.length) return;
  study.index = index;
  state.focusDraft = '';
  state.skipSnapshot = true;
  state.turn = null;
  syncStudyPage();
  render();
}

async function changeHighlight(wordId, color, field) {
  const target = field === 'hiragana' || field === 'reading' ? 'reading' : 'kanji';
  const word = notebookWords().find((item) => item.id === wordId);
  if (!word) return;
  const current = target === 'reading'
    ? (word.highlightReading !== undefined ? word.highlightReading : (word.highlight || null))
    : (word.highlightKanji !== undefined ? word.highlightKanji : (word.highlight || null));
  const next = current ? null : (color === 'yellow' || color === 'pink' || color === 'green' ? color : null);
  if (next === current) return;
  const result = await setHighlight(wordId, next, target);
  if (!result.ok) return;
  state.flashWordId = wordId;
  render();
}

function togglePen() {
  state.pen.active = !state.pen.active;
  if (state.pen.active && state.pen.tool !== 'pink' && state.pen.tool !== 'green') state.pen.tool = 'yellow';
  render();
}

function selectPen(tool) {
  state.pen.tool = tool;
  state.pen.active = true;
  render();
}

function startPractice() {
  if (currentNotebook()?.type === 'katakana') {
    chooseStudy('practice');
    return;
  }
  beginStudy('practice', 'hiragana');
}

function startFocus() {
  if (currentNotebook()?.type === 'katakana') {
    chooseStudy('focus', { fromCurrentPage: true });
    return;
  }
  beginStudy('focus', 'hiragana', { fromCurrentPage: true });
}

function toggleLock() {
  const notebook = currentNotebook();
  if (!notebook) return;
  updateNotebook(notebook.id, { locked: !isLocked(notebook) });
  render();
}

function chooseStudy(kind, options = {}) {
  openModal({
    title: '練習',
    body: '練習の種類を選んでください。',
    actions: [
      {
        label: 'カタカナを練習',
        className: 'btn btn-primary',
        onClick: () => {
          closeModal({ restore: false });
          beginStudy(kind, 'katakana', options);
        },
      },
      {
        label: '中国語を練習',
        className: 'btn btn-ghost',
        onClick: () => {
          closeModal({ restore: false });
          beginStudy(kind, 'zh', options);
        },
      },
    ],
  });
}

function beginStudy(kind, script, { fromCurrentPage = false } = {}) {
  flushLineEdits();
  flushGlossEdits();
  const stored = getWordsByNotebook(state.notebookId);
  const words = practiceWords(stored, script);
  if (!words.length) {
    const body = script === 'zh'
      ? '中国語の訳がある単語がありません。'
      : (script === 'katakana' ? '訳か原文があると、カタカナの練習ができます。' : 'まだ単語がありません。');
    openModal({
      title: '練習',
      body,
      actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
    });
    return;
  }
  state.answers = {};
  state.revealed = {};
  state.showResult = false;
  state.focusDraft = '';
  if (kind === 'focus') {
    const index = fromCurrentPage ? focusStartIndex(stored, words) : 0;
    state.study = {
      kind: 'focus',
      script,
      wordIds: words.map((word) => word.id),
      wordsById: Object.fromEntries(words.map((word) => [word.id, word])),
      index,
      wrong: 0,
      startedAt: Date.now(),
      finished: false,
      durationMs: 0,
    };
    state.focusDraft = '';
    state.skipSnapshot = true;
    rememberNotebookPage(focusPageOf(words[index].id, stored));
  } else {
    state.study = { kind: 'practice', reviewIds: null, script };
  }
  render();
}

function focusCorrect() {
  const study = state.study;
  if (!study || study.kind !== 'focus' || study.finished) return;
  study.index += 1;
  state.focusDraft = '';
  state.skipSnapshot = true;
  if (study.index >= study.wordIds.length) {
    study.finished = true;
    study.durationMs = Date.now() - study.startedAt;
    addPracticeLog({
      notebookId: state.notebookId,
      mode: 'focus',
      total: study.wordIds.length,
      correct: study.wordIds.length,
      wrong: study.wrong,
      durationMs: study.durationMs,
    });
  } else {
    syncStudyPage();
  }
  render();
}

function focusWrong() {
  if (state.study?.kind === 'focus' && !state.study.finished) state.study.wrong += 1;
}

function exitStudy() {
  state.study = null;
  state.answers = {};
  state.revealed = {};
  state.showResult = false;
  state.focusDraft = '';
  render();
}

function finishPractice() {
  snapshotPracticeFields();
  const words = displayedWords(meaningfulWords(getWordsByNotebook(state.notebookId)));
  words.forEach((word) => {
    const saved = state.answers[word.id];
    if (!saved?.value) return;
    const script = state.study?.script === 'zh' || state.study?.script === 'katakana' ? state.study.script : 'hiragana';
    const expected = script === 'zh' ? word.translation : (script === 'katakana' ? word.kanji : word.hiragana);
    const result = judgeAnswer(saved.value, expected, { script });
    saved.status = result.status === 'empty' ? '' : result.status;
  });
  state.showResult = true;
  render();
}

function retryPractice() {
  if (state.study?.kind === 'focus') {
    const script = state.study.script === 'zh' || state.study.script === 'katakana' ? state.study.script : 'hiragana';
    beginStudy('focus', script);
    return;
  }
  state.skipSnapshot = true;
  state.answers = {};
  state.revealed = {};
  state.showResult = false;
  render();
}

function reviewWrong() {
  const words = displayedWords(meaningfulWords(getWordsByNotebook(state.notebookId)));
  const view = spreadFor(state.page, pageCount(words), { compact: isCompact() });
  const visible = view.pages
    .filter((pageNumber, index) => !(isCompact() && index > 0))
    .flatMap((pageNumber) => wordsForPage(words, pageNumber));
  const wrongIds = visible
    .filter((word) => state.answers[word.id]?.status !== 'correct')
    .map((word) => word.id);
  if (!wrongIds.length) return;
  state.skipSnapshot = true;
  state.study = {
    kind: 'practice',
    reviewIds: wrongIds,
    script: state.study?.script === 'zh' || state.study?.script === 'katakana' ? state.study.script : 'hiragana',
  };
  state.answers = {};
  state.revealed = {};
  state.showResult = false;
  state.page = 1;
  const hash = notebookHash(state.notebookId, 1);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

function syncFromHash() {
  closeModal({ restore: false });
  flushLineEdits();
  flushGlossEdits();
  const route = parseHash(location.hash);
  const nextId = route.view === 'notebook' ? route.notebookId : null;
  if (nextId !== state.notebookId) {
    state.study = null;
    state.answers = {};
    state.revealed = {};
    state.showResult = false;
    state.focusDraft = '';
    state.pen.active = false;
  }
  if (route.view === 'notebook') {
    const notebook = getNotebook(route.notebookId);
    if (!notebook) {
      state.view = 'shelf';
      state.notebookId = null;
      state.page = 1;
      if (location.hash && location.hash !== '#/' && location.hash !== '#') {
        history.replaceState(null, '', '#/');
      }
      render();
      return;
    }
    state.view = 'notebook';
    state.notebookId = notebook.id;
    state.page = route.page;
  } else {
    state.view = 'shelf';
    state.notebookId = null;
    state.page = 1;
  }
  render();
}

function openModal({ title, body, actions = [] }) {
  closeModal({ restore: false });
  const previous = document.activeElement;
  const root = document.querySelector('#modal-root');
  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal-panel');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'modal-title');

  const heading = el('h2', 'modal-title hand', title);
  heading.id = 'modal-title';
  dialog.append(heading);
  if (typeof body === 'string') dialog.append(el('p', 'modal-text', body));
  else if (body) dialog.append(body);

  if (actions.length) {
    const row = el('div', 'modal-actions');
    actions.forEach((action) => {
      const button = el('button', action.className || 'btn btn-ghost', action.label);
      button.type = 'button';
      button.addEventListener('click', () => action.onClick?.());
      row.append(button);
    });
    dialog.append(row);
  }

  backdrop.append(dialog);
  root.replaceChildren(backdrop);
  document.body.classList.add('modal-open');

  const close = ({ restore = true } = {}) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.body.classList.remove('modal-open');
    closeModal = () => {};
    if (restore && previous instanceof HTMLElement && previous.isConnected) {
      previous.focus();
    }
  };
  closeModal = close;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, input, textarea, select, a[href]')]
      .filter((item) => !item.disabled && item.tabIndex !== -1);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const focusTarget = dialog.querySelector('input, button');
  focusTarget?.focus();
  return close;
}

function advanceToSlot(slot) {
  flushLineEdits();
  const words = getWordsByNotebook(state.notebookId);
  const limit = editablePageLimit(words, { compact: isCompact() });
  const page = Math.floor(slot / PAGE_SIZE) + 1;
  if (page > limit) return;
  state.focusSlot = { slot, field: 'kanji', start: 0, end: 0 };
  const input = document.querySelector(`[data-slot="${slot}"] [data-field="kanji"]`);
  if (input) {
    state.focusSlot = null;
    input.focus();
    return;
  }
  state.page = !isCompact() && page % 2 === 0 ? page - 1 : page;
  state.turn = 'next';
  const hash = notebookHash(state.notebookId, state.page);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

function insertLine(slot) {
  if (isLocked()) return;
  flushLineEdits();
  const words = getWordsByNotebook(state.notebookId);
  const index = Math.min(slot + 1, words.length);
  insertWordAt(state.notebookId, index);
  state.focusSlot = { slot: index, field: 'kanji', start: 0, end: 0 };
  const page = Math.floor(index / PAGE_SIZE) + 1;
  state.page = !isCompact() && page % 2 === 0 ? page - 1 : page;
  const hash = notebookHash(state.notebookId, state.page);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

function saveLineNote({ slot, note }) {
  if (isLocked()) return;
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const kanji = line?.querySelector('[data-field="kanji"]')?.value ?? '';
  const hiragana = line?.querySelector('[data-field="hiragana"]')?.value ?? '';
  const patch = { kanji: kanji.trim(), hiragana: hiragana.trim(), note };
  if (id) updateWord(id, patch);
  else {
    ensureWordAt(state.notebookId, slot, patch);
    stampLineIds();
  }
  syncNoteDot(slot, note);
}

function confirmDeleteLine(slot) {
  if (isLocked()) return;
  flushLineEdits();
  const word = getWordsByNotebook(state.notebookId)[slot];
  if (!word) return;
  const body = el('p', 'modal-text');
  if (word.kanji) {
    body.append('「');
    body.append(el('strong', 'hand', word.kanji));
    body.append('」を削除します。うしろの行は前に詰まります。');
  } else {
    body.textContent = 'この行を削除します。うしろの行は前に詰まります。';
  }
  openModal({
    title: 'この行を削除しますか',
    body,
    actions: [
      { label: 'キャンセル', className: 'btn btn-ghost', onClick: () => closeModal() },
      {
        label: '削除する',
        className: 'btn btn-danger',
        onClick: async () => {
          const result = await deleteWord(word.id);
          if (!result.ok) return;
          delete state.answers[word.id];
          closeModal({ restore: false });
          const words = getWordsByNotebook(state.notebookId);
          const limit = editablePageLimit(words, { compact: isCompact() });
          if (state.page > limit) state.page = limit;
          render();
        },
      },
    ],
  });
}

function openNotebookDialog(mode, notebook) {
  if (mode === 'create' && !getCurrentUser().uid) {
    openModal({
      title: 'ログイン',
      body: 'ログインすると、自分のノートを保存できます。',
      actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
    });
    return;
  }
  const form = el('form', 'notebook-form');
  form.id = 'notebook-form';

  const field = el('label', 'field');
  field.append(el('span', 'field-label', 'ノートの名前'));
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'title';
  input.maxLength = 30;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.enterKeyHint = 'done';
  input.lang = 'ja';
  input.setAttribute('aria-describedby', 'notebook-form-error');
  if (notebook) input.value = notebook.title;
  field.append(input);

  const error = el('p', 'form-error');
  error.id = 'notebook-form-error';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  const colorField = el('fieldset', 'color-field');
  const legend = el('legend', 'field-label', 'カバーの色');
  const swatches = el('div', 'swatches');
  const selected = notebook?.color || 'sage';
  COVER_COLORS.forEach((color) => {
    const label = el('label', 'swatch');
    label.dataset.color = color.id;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'cover-color';
    radio.value = color.id;
    radio.checked = color.id === selected;
    label.append(radio, el('span', 'visually-hidden', color.label));
    swatches.append(label);
  });
  colorField.append(legend, swatches);

  const typeField = choiceField('notebook-type', 'ノートの種類', [
    { value: 'kanji', label: '漢字ノート' },
    { value: 'katakana', label: 'カタカナノート' },
  ], notebook?.type === 'katakana' ? 'katakana' : 'kanji');

  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', 'キャンセル');
  cancel.type = 'button';
  const submit = el('button', 'btn btn-primary', mode === 'edit' ? '保存する' : 'つくる');
  submit.type = 'submit';
  actions.append(cancel, submit);
  const importField = mode === 'create' ? notebookImportField() : null;
  form.append(field, error, typeField, colorField);
  if (importField) {
    form.append(importField.field);
    form.addEventListener('input', () => importField.refresh());
    form.addEventListener('change', () => importField.refresh());
  }
  form.append(actions);

  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  cancel.addEventListener('click', () => closeModal());

  const showError = (message) => {
    error.hidden = false;
    error.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing) return;
    const title = input.value;
    if (!title.trim()) {
      showError('ノートの名前を入力してください');
      return;
    }
    const color = form.querySelector('input[name="cover-color"]:checked')?.value || 'sage';
    const type = form.querySelector('input[name="notebook-type"]:checked')?.value === 'katakana' ? 'katakana' : 'kanji';
    submit.disabled = true;
    const payload = { title: title.trim(), color, type, showTranslation: true };
    if (mode === 'edit') {
      const result = await updateNotebook(notebook.id, payload);
      submit.disabled = false;
      if (!result.ok) {
        showError(result.message || '保存できませんでした');
        return;
      }
      closeModal({ restore: false });
      state.focusSelector = `[data-notebook-id="${CSS.escape(notebook.id)}"] .cover-open`;
      render();
      return;
    }
    const imported = importField?.state() || { status: 'empty' };
    if (imported.status === 'error') {
      submit.disabled = false;
      showError(imported.message || 'ファイルを確認してください');
      return;
    }
    if (imported.status === 'ready') {
      const checked = await inspectImportFile(imported.text, imported.kind);
      if (!checked.ok) {
        submit.disabled = false;
        showError(checked.message || 'ファイルを確認してください');
        return;
      }
      const created = await createNotebookWithWords(payload, imported);
      submit.disabled = false;
      if (!created.ok) {
        showError(created.message || '保存できませんでした');
        return;
      }
      closeModal({ restore: false });
      state.freshId = created.notebook.id;
      state.focusSelector = `[data-notebook-id="${CSS.escape(created.notebook.id)}"] .cover-open`;
      render();
      return;
    }
    const result = await createNotebook(payload);
    submit.disabled = false;
    if (!result.ok) {
      showError(result.message || '保存できませんでした');
      return;
    }
    closeModal({ restore: false });
    state.freshId = result.notebook.id;
    state.focusSelector = `[data-notebook-id="${CSS.escape(result.notebook.id)}"] .cover-open`;
    render();
  });

  openModal({
    title: mode === 'edit' ? 'ノートを編集' : '新しいノート',
    body: form,
  });
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function choiceField(name, legendText, choices, selected) {
  const field = el('fieldset', 'choice-field');
  field.append(el('legend', 'field-label', legendText));
  const row = el('div', 'choice-row');
  choices.forEach((choice) => {
    const label = el('label', 'choice');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = choice.value;
    radio.checked = choice.value === selected;
    label.append(radio, document.createTextNode(choice.label));
    row.append(label);
  });
  field.append(row);
  return field;
}

function confirmDelete(notebook) {
  const count = getWordsByNotebook(notebook.id).length;
  const body = el('p', 'modal-text');
  body.append('「');
  body.append(el('strong', 'hand', notebook.title));
  body.append('」');
  body.append(count
    ? `と、中の${count}語を削除します。元に戻せません。`
    : 'を削除します。元に戻せません。');

  openModal({
    title: 'ノートを削除しますか',
    body,
    actions: [
      { label: 'キャンセル', className: 'btn btn-ghost', onClick: () => closeModal() },
      {
        label: '削除する',
        className: 'btn btn-danger',
        onClick: async () => {
          const result = await deleteNotebook(notebook.id);
          if (!result.ok) return;
          closeModal({ restore: false });
          state.focusSelector = '#add-notebook';
          render();
        },
      },
    ],
  });
}

function openDemoDialog() {
  openModal({
    title: 'デモモード',
    body: 'Firebase を設定すると、Google でログインできます。それまでは、このブラウザの中にノートを保存します。',
    actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
  });
}

function authMessage(reason) {
  if (reason === 'auth/unauthorized-domain') return 'このサイトは Firebase の承認済みドメインに入っていません。';
  if (reason === 'auth/popup-blocked') return 'ログイン画面を開けませんでした。もう一度試してください。';
  return 'ログインできませんでした。しばらくしてからもう一度試してください。';
}

function renderAccount() {
  const button = document.querySelector('#login-button');
  const badge = document.querySelector('#account-badge');
  const chip = document.querySelector('#account-chip');
  const avatar = document.querySelector('#account-avatar');
  const name = document.querySelector('#account-name');
  const user = getCurrentUser();
  if (!button || !badge || !chip || !avatar || !name) return;
  button.disabled = false;
  const hideAccount = () => {
    chip.hidden = true;
    name.textContent = '';
    avatar.hidden = true;
    avatar.removeAttribute('src');
  };
  if (usingDemoMode() || user.isDemo) {
    hideAccount();
    badge.hidden = false;
    badge.textContent = 'デモ';
    button.hidden = false;
    button.textContent = 'ログイン';
    button.onclick = openDemoDialog;
    return;
  }
  badge.hidden = true;
  if (user.uid) {
    chip.hidden = false;
    name.textContent = user.displayName || '会員';
    if (user.photoURL) {
      avatar.hidden = false;
      avatar.referrerPolicy = 'no-referrer';
      avatar.src = user.photoURL;
    } else {
      avatar.hidden = true;
      avatar.removeAttribute('src');
    }
    button.hidden = false;
    button.textContent = 'ログアウト';
    button.onclick = () => {
      signOutUser();
    };
    return;
  }
  hideAccount();
  button.hidden = false;
  button.textContent = 'ログイン';
  button.onclick = async () => {
    button.disabled = true;
    const result = await signInWithGoogle();
    button.disabled = false;
    if (!result.ok && result.reason !== 'cancelled' && result.reason !== 'demo') {
      openModal({
        title: 'ログイン',
        body: authMessage(result.reason),
        actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
      });
    }
  };
}

let sessionUserId = null;
let sessionQueue = Promise.resolve();

function resetViewState() {
  state.view = 'shelf';
  state.notebookId = null;
  state.page = 1;
  state.study = null;
  state.answers = {};
  state.revealed = {};
  state.showResult = false;
  state.focusDraft = '';
  state.turn = null;
  if (location.hash && location.hash !== '#/' && location.hash !== '#') {
    history.replaceState(null, '', '#/');
  }
}

async function adoptUser(user) {
  const next = user?.uid && !user.isDemo ? user.uid : '';
  if (next === sessionUserId) return;
  const switching = sessionUserId !== null;
  if (switching) {
    flushLineEdits();
    flushGlossEdits();
    resetViewState();
  }
  sessionUserId = next;
  setActiveUser(next);
  await ready();
  if (switching) render();
}

function bindChrome() {
  watchAuth((user) => {
    renderAccount();
    sessionQueue = sessionQueue.then(() => adoptUser(user)).catch(() => {});
  });
  document.querySelector('.brand')?.addEventListener('click', () => {
    state.turn = null;
  });
}

function bindKeys() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (document.activeElement?.id === 'notebook-title' && !(target instanceof Element && target.closest('#notebook-title'))) {
      document.activeElement.blur();
    }
    if (target instanceof Element && target.closest('.row-more, .row-popover, .note-popover, .note-dot, .note-tip')) return;
    closeLineMenus();
  });
  window.addEventListener('pagehide', () => {
    flushLineEdits();
    flushGlossEdits();
  });
  document.addEventListener('keydown', (event) => {
    if (state.view !== 'notebook') return;
    if (document.body.classList.contains('modal-open')) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step('next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step('prev');
    }
  });
}

function showFatal() {
  const root = document.querySelector('#app-root');
  root.replaceChildren(el('p', 'loading', 'ノートを開けませんでした。ページを読み込み直してください。'));
}

async function start() {
  applyCompact();
  await readyAuth();
  bindChrome();
  await sessionQueue;
  bindKeys();
  window.addEventListener('hashchange', syncFromHash);
  window.addEventListener('popstate', syncFromHash);
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', () => {
    applyCompact();
    render();
  });
  syncFromHash();
}

start().catch(() => {
  showFatal();
});
