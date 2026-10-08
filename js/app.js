/** 畫面切換、對話框與網址。資料寫入後由這裡重畫。 */

import { getCurrentUser, usingDemoMode } from './auth.js';
import { lookupDictionary } from './dictionary.js';
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
  hasPersistenceWarning,
  insertWordAt,
  ready,
  setActiveUser,
  setHighlight,
  updateNotebook,
  updateWord,
} from './storage.js';
import { judgeAnswer } from './practice.js';
import {
  PAGE_SIZE,
  editablePageLimit,
  isHiragana,
  notebookStats,
  pageCount,
  practicePrompt,
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
  hints: {},
  showResult: false,
  focusDraft: '',
  focusSlot: null,
};

let previousView = null;
let closeModal = () => {};
let rendering = false;
const lineTimers = new Map();
const glossTimers = new Map();
const lookupTimers = new Map();

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
  if (hasPersistenceWarning()) {
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
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
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
  if (state.study && currentNotebook()?.type === 'katakana') {
    words = words.filter((word) => practicePrompt(word));
  }
  return words;
}

function currentNotebook() {
  return state.notebookId ? getNotebook(state.notebookId) : null;
}

function meaningfulWords(words) {
  return words.filter((word) => word.kanji.trim() || word.hiragana.trim());
}

function practiceWords(words) {
  const list = meaningfulWords(words);
  if (currentNotebook()?.type !== 'katakana') return list;
  return list.filter((word) => practicePrompt(word));
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
  if (summary) summary.textContent = `${stats.total}語 · 覚えた ${stats.percent}%`;
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

function saveSlotNow(slot, kanji, hiragana) {
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const nextKanji = String(kanji ?? '').trim();
  const nextReading = String(hiragana ?? '').trim();
  const input = line?.querySelector('[data-field="hiragana"]');
  const invalid = Boolean(nextReading) && !isHiragana(nextReading);
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
  if (stored && stored.kanji === nextKanji && stored.hiragana === nextReading) return;
  const notebook = currentNotebook();
  const headChanged = Boolean(stored) && stored.kanji !== nextKanji;
  const readingChanged = Boolean(stored) && stored.hiragana !== nextReading;
  const hasGloss = Boolean(String(stored?.translation || '').trim() || String(stored?.originWord || '').trim());
  const patch = { kanji: nextKanji, hiragana: nextReading };
  if (readingChanged) patch.readingEdited = true;
  if (headChanged && !readingChanged && stored && !stored.readingEdited) patch.hiragana = '';
  if (headChanged && hasGloss) {
    patch.glossStale = true;
    patch.lookupKey = '';
  }
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
  if (headChanged && hasGloss) {
    if (!rendering) render();
    return;
  }
  if (!word || !nextKanji || notebook?.autoLookup === false || word.glossStale) return;
  if (word.lookupKey === nextKanji) return;
  scheduleLookup(word.id, nextKanji);
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
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const text = String(value ?? '').trim();
  const stored = id
    ? getWordsByNotebook(state.notebookId).find((word) => word.id === id)
    : null;
  if (field === 'origin') {
    if ((stored?.originWord || '') === text) return;
    const patch = {
      originWord: text,
      originEdited: true,
      originLanguage: '',
      glossStale: false,
    };
    if (stored) updateWord(stored.id, patch);
    else if (text) ensureWordAt(state.notebookId, slot, patch).then(() => stampLineIds());
    return;
  }
  if ((stored?.translation || '') === text) return;
  const patch = { translation: text, translationEdited: true, glossStale: false };
  if (stored) updateWord(stored.id, patch);
  else if (text) ensureWordAt(state.notebookId, slot, patch).then(() => stampLineIds());
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

function scheduleLookup(wordId, head) {
  clearTimeout(lookupTimers.get(wordId));
  lookupTimers.set(wordId, setTimeout(() => {
    lookupTimers.delete(wordId);
    applyLookup(wordId, head, false);
  }, 40));
}

async function applyLookup(wordId, head, force) {
  const notebook = currentNotebook();
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  const key = String(head || word?.kanji || '').trim();
  if (!notebook || !word || !key) return;
  if (!force && (notebook.autoLookup === false || word.glossStale || word.lookupKey === key)) return;
  const result = await lookupDictionary(key);
  const latest = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (!latest || latest.kanji !== key) return;
  const patch = { lookupKey: key };
  if (force) patch.glossStale = false;
  if (
    result?.reading
    && isHiragana(result.reading)
    && notebook.type !== 'katakana'
    && (force ? !latest.readingEdited : !latest.hiragana.trim())
  ) {
    patch.hiragana = result.reading;
  }
  if (result?.originWord && (force || !latest.originEdited)) {
    patch.originWord = result.originWord;
    patch.originLanguage = result.originLanguage || '';
    if (force) patch.originEdited = false;
  }
  await updateWord(wordId, patch);
  const saved = getWordsByNotebook(state.notebookId).find((item) => item.id === wordId);
  if (saved) syncPaperLine(saved);
  if (!force) return;
  const live = document.querySelector('#live-status');
  if (live) {
    live.textContent = result?.reading || result?.originWord
      ? '辞書の読みと語源を入れました'
      : '辞書には、読みも語源も見当たりませんでした';
  }
  if (!rendering) render();
}

function keepGloss(slot) {
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === id);
  if (!word) return;
  updateWord(word.id, {
    glossStale: false,
    translationEdited: Boolean(String(word.translation || '').trim()) || word.translationEdited,
    originEdited: Boolean(String(word.originWord || '').trim()) || word.originEdited,
    lookupKey: word.kanji,
  });
  render();
}

async function relookupLine(slot) {
  flushLineEdits();
  flushGlossEdits();
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const id = line?.dataset.wordId || '';
  const word = getWordsByNotebook(state.notebookId).find((item) => item.id === id);
  if (!word?.kanji.trim()) {
    const live = document.querySelector('#live-status');
    if (live) live.textContent = '単語を書いてから検索できます';
    return;
  }
  await applyLookup(word.id, word.kanji, true);
}

function toggleTranslation() {
  const notebook = currentNotebook();
  if (!notebook) return;
  flushLineEdits();
  flushGlossEdits();
  updateNotebook(notebook.id, { showTranslation: notebook.showTranslation === false });
  render();
}

function toggleLookup() {
  const notebook = currentNotebook();
  if (!notebook) return;
  updateNotebook(notebook.id, { autoLookup: notebook.autoLookup === false });
  render();
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
      const pool = state.study ? meaningfulWords(allWords) : allWords;
      const words = displayedWords(pool);
      const view = spreadFor(state.page, pageLimitFor(allWords), { compact: isCompact() });
      if (view.current !== state.page) {
        state.page = view.current;
        const hash = notebookHash(notebook.id, state.page);
        if (location.hash !== hash) history.replaceState(null, '', hash);
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
        hints: state.hints,
        showResult: state.showResult,
        focusDraft: state.focusDraft,
        onStep: step,
        onHighlight: changeHighlight,
        onTogglePen: togglePen,
        onSelectPen: selectPen,
        onDeleteWord: confirmDeleteLine,
        onEditLine: ({ slot, kanji, hiragana }) => scheduleLineSave(slot, kanji, hiragana),
        onEditGloss: ({ slot, field, value }) => scheduleGlossSave(slot, field, value),
        onRelookup: relookupLine,
        onKeepGloss: keepGloss,
        onToggleTranslation: toggleTranslation,
        onToggleLookup: toggleLookup,
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
  if (state.view !== 'notebook' || state.study?.kind === 'focus') return;
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

async function changeHighlight(wordId, color, field) {
  if (state.study) return;
  const target = field === 'hiragana' || field === 'reading' ? 'reading' : 'kanji';
  const result = await setHighlight(wordId, color, target);
  if (!result.ok) return;
  state.flashWordId = wordId;
  render();
}

function togglePen() {
  state.pen.active = !state.pen.active;
  if (state.pen.active && !state.pen.tool) state.pen.tool = 'yellow';
  render();
}

function selectPen(tool) {
  state.pen.tool = tool;
  state.pen.active = true;
  render();
}

function emptyWordNotice() {
  openModal({
    title: '練習',
    body: 'まだ単語がありません。',
    actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
  });
}

function startPractice() {
  const notebook = currentNotebook();
  const words = practiceWords(getWordsByNotebook(state.notebookId));
  if (!words.length) {
    if (notebook?.type === 'katakana') {
      openModal({
        title: '練習',
        body: '原文か訳を書くと、カタカナの練習ができます。',
        actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
      });
      return;
    }
    emptyWordNotice();
    return;
  }
  state.study = {
    kind: 'practice',
    reviewIds: null,
    script: notebook?.type === 'katakana' ? 'katakana' : 'hiragana',
  };
  state.answers = {};
  state.revealed = {};
  state.hints = {};
  state.showResult = false;
  render();
}

function startFocus() {
  const notebook = currentNotebook();
  const words = practiceWords(getWordsByNotebook(state.notebookId));
  if (!words.length) {
    if (notebook?.type === 'katakana') {
      openModal({
        title: '練習',
        body: '原文か訳を書くと、カタカナの練習ができます。',
        actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
      });
      return;
    }
    emptyWordNotice();
    return;
  }
  state.study = {
    kind: 'focus',
    script: notebook?.type === 'katakana' ? 'katakana' : 'hiragana',
    wordIds: words.map((word) => word.id),
    wordsById: Object.fromEntries(words.map((word) => [word.id, word])),
    index: 0,
    wrong: 0,
    startedAt: Date.now(),
    finished: false,
    durationMs: 0,
  };
  state.focusDraft = '';
  state.showResult = false;
  state.skipSnapshot = true;
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
  state.hints = {};
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
    const script = state.study?.script === 'katakana' ? 'katakana' : 'hiragana';
    const expected = script === 'katakana' ? word.kanji : word.hiragana;
    const result = judgeAnswer(saved.value, expected, { script });
    saved.status = result.status === 'empty' ? '' : result.status;
  });
  state.showResult = true;
  render();
}

function retryPractice() {
  if (state.study?.kind === 'focus') {
    startFocus();
    return;
  }
  state.skipSnapshot = true;
  state.answers = {};
  state.revealed = {};
  state.hints = {};
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
    script: state.study?.script === 'katakana' ? 'katakana' : 'hiragana',
  };
  state.answers = {};
  state.revealed = {};
  state.hints = {};
  state.showResult = false;
  state.page = 1;
  const hash = notebookHash(state.notebookId, 1);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

function syncFromHash() {
  closeModal({ restore: false });
  const route = parseHash(location.hash);
  const nextId = route.view === 'notebook' ? route.notebookId : null;
  if (nextId !== state.notebookId) {
    state.study = null;
    state.answers = {};
    state.revealed = {};
    state.hints = {};
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
  const lookupField = choiceField('auto-lookup', '自動検索', [
    { value: 'on', label: 'ON' },
    { value: 'off', label: 'OFF' },
  ], notebook?.autoLookup === false ? 'off' : 'on');

  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', 'キャンセル');
  cancel.type = 'button';
  const submit = el('button', 'btn btn-primary', mode === 'edit' ? '保存する' : 'つくる');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(field, error, typeField, lookupField, colorField, actions);

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
    const autoLookup = form.querySelector('input[name="auto-lookup"]:checked')?.value !== 'off';
    submit.disabled = true;
    const payload = { title: title.trim(), color, type, autoLookup };
    const result = mode === 'edit'
      ? await updateNotebook(notebook.id, payload)
      : await createNotebook({ ...payload, showTranslation: true });
    submit.disabled = false;
    if (!result.ok) {
      showError(result.message || '保存できませんでした');
      return;
    }
    const id = mode === 'edit' ? notebook.id : result.notebook.id;
    closeModal({ restore: false });
    state.freshId = mode === 'create' ? id : null;
    state.focusSelector = `[data-notebook-id="${CSS.escape(id)}"] .cover-open`;
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

function bindChrome() {
  const button = document.querySelector('#login-button');
  const badge = document.querySelector('#account-badge');
  const user = getCurrentUser();
  if (usingDemoMode() || user.isDemo) {
    badge.hidden = false;
    badge.textContent = 'デモ';
    button.textContent = 'ログイン';
    button.addEventListener('click', openDemoDialog);
  }
  document.querySelector('.brand')?.addEventListener('click', () => {
    state.turn = null;
  });
}

function bindKeys() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
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
    if (state.study?.kind === 'focus') return;
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
  setActiveUser(getCurrentUser().uid);
  await ready();
  bindChrome();
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
