/**
 * 每個使用者一份資料。
 * Demo Mode 存在 localStorage；之後 Firebase 只讀寫 users/{uid} 底下的文件。
 * 本地寫入不會自動通知畫面，呼叫端處理完焦點與對話框後再自行重畫。
 * 遠端同步可呼叫 notify()。
 */

import { isHiragana, normalizeText } from './vocabulary.js';

const HIGHLIGHTS = new Set(['yellow', 'pink', 'green']);
const listeners = new Set();

let userId = 'local-demo';
let memory = null;
let memoryUser = null;
let persistenceWarning = false;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach((listener) => listener());
}

export function hasPersistenceWarning() {
  return persistenceWarning;
}

export function setActiveUser(id) {
  userId = String(id || 'local-demo');
  if (memoryUser !== userId) memory = null;
}

export function storageKey() {
  return `jvn.${userId}.v1`;
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function canUseStorage() {
  try {
    const key = '__jvn_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function cleanColor(color) {
  const value = String(color ?? '').trim();
  return /^[a-z]{1,20}$/.test(value) ? value : 'sage';
}

function cleanNotebook(input) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id ?? '').trim();
  const title = String(input.title ?? '').trim().slice(0, 30);
  if (!id || !title) return null;
  const createdAt = String(input.createdAt || nowIso());
  return {
    id,
    title,
    color: cleanColor(input.color),
    type: input.type === 'katakana' ? 'katakana' : 'kanji',
    autoLookup: input.autoLookup === undefined ? true : Boolean(input.autoLookup),
    showTranslation: input.showTranslation === undefined ? true : Boolean(input.showTranslation),
    createdAt,
    updatedAt: String(input.updatedAt || createdAt),
  };
}

function cleanWord(input, { strict = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id ?? '').trim();
  const notebookId = String(input.notebookId ?? '').trim();
  const kanji = String(input.kanji ?? '').trim().slice(0, 40);
  const hiragana = normalizeText(input.hiragana).slice(0, 80);
  if (!id || !notebookId) return null;
  if (strict && hiragana && !isHiragana(hiragana)) return null;
  const legacyHighlight = HIGHLIGHTS.has(input.highlight) ? input.highlight : null;
  const highlightKanji = input.highlightKanji === undefined
    ? legacyHighlight
    : (HIGHLIGHTS.has(input.highlightKanji) ? input.highlightKanji : null);
  const highlightReading = input.highlightReading === undefined
    ? legacyHighlight
    : (HIGHLIGHTS.has(input.highlightReading) ? input.highlightReading : null);
  const createdAt = String(input.createdAt || nowIso());
  const order = Number.isFinite(input.order) ? Math.max(0, Math.floor(input.order)) : 0;
  return {
    id,
    notebookId,
    kanji,
    hiragana,
    note: String(input.note ?? '').slice(0, 500),
    translation: String(input.translation ?? '').slice(0, 80),
    translationEdited: Boolean(input.translationEdited),
    originWord: String(input.originWord ?? '').slice(0, 80),
    originLanguage: String(input.originLanguage ?? '').slice(0, 40),
    originEdited: Boolean(input.originEdited),
    readingEdited: Boolean(input.readingEdited),
    glossStale: Boolean(input.glossStale),
    lookupKey: String(input.lookupKey ?? '').slice(0, 40),
    highlight: highlightKanji,
    highlightKanji,
    highlightReading,
    order,
    createdAt,
    updatedAt: String(input.updatedAt || createdAt),
  };
}

function seedWords(notebookId, createdAt, rows) {
  return rows.map((row, order) => ({
    id: `${notebookId}-${String(order + 1).padStart(2, '0')}`,
    notebookId,
    kanji: row[0],
    hiragana: row[1],
    note: row[2] || '',
    highlight: row[3] || null,
    order,
    createdAt,
    updatedAt: createdAt,
  }));
}

const OLD_SAMPLE_IDS = ['nb-daily', 'nb-n2', 'nb-n3', 'nb-weak', 'nb-work'];
const OLD_SAMPLE_WORD_COUNT = 86;

function isUntouchedSample(data) {
  if (!data || data.notebooks.length !== OLD_SAMPLE_IDS.length) return false;
  const ids = data.notebooks.map((notebook) => notebook.id).sort();
  if (ids.some((id, index) => id !== OLD_SAMPLE_IDS[index])) return false;
  if (data.words.length !== OLD_SAMPLE_WORD_COUNT) return false;
  if (data.words.some((word) => !OLD_SAMPLE_IDS.includes(word.notebookId))) return false;
  if (data.words.some((word) => !/^nb-(n3|n2|work|daily|weak)-\d\d$/.test(word.id))) return false;
  return ![...data.notebooks, ...data.words].some((item) => item.updatedAt !== item.createdAt);
}

function createSeedState() {
  const createdAt = new Date().toISOString();
  const notebooks = [{
    id: 'nb-starter',
    title: '日本語の単語帳',
    color: 'sage',
    createdAt,
    updatedAt: createdAt,
  }];
  const words = seedWords('nb-starter', createdAt, [
    ['禁止', 'きんし', '', null],
    ['危ない', 'あぶない', '', null],
    ['静か', 'しずか', '', null],
    ['危険', 'きけん', '', null],
    ['練習', 'れんしゅう', '', null],
  ]);
  return { version: 1, notebooks, words, practiceLogs: [] };
}

function normalizeState(data) {
  const notebooks = Array.isArray(data?.notebooks)
    ? data.notebooks.map((item) => cleanNotebook(item)).filter(Boolean)
    : [];
  const ids = new Set(notebooks.map((notebook) => notebook.id));
  const words = Array.isArray(data?.words)
    ? data.words
        .map((item) => cleanWord(item))
        .filter((word) => word && ids.has(word.notebookId))
    : [];
  const practiceLogs = Array.isArray(data?.practiceLogs)
    ? data.practiceLogs.filter((log) => log && typeof log === 'object' && ids.has(log.notebookId))
    : [];
  return { version: 1, notebooks, words, practiceLogs };
}

function persist() {
  if (!canUseStorage()) {
    persistenceWarning = true;
    return;
  }
  try {
    localStorage.setItem(storageKey(), JSON.stringify(memory));
    persistenceWarning = false;
  } catch {
    persistenceWarning = true;
  }
}

function load() {
  if (memory && memoryUser === userId) return memory;
  memoryUser = userId;
  if (!canUseStorage()) {
    persistenceWarning = true;
    memory = createSeedState();
    return memory;
  }
  persistenceWarning = false;
  const raw = localStorage.getItem(storageKey());
  if (!raw) {
    memory = createSeedState();
    persist();
    return memory;
  }
  try {
    memory = normalizeState(JSON.parse(raw));
    if (isUntouchedSample(memory)) {
      memory = createSeedState();
      persist();
    }
  } catch {
    memory = createSeedState();
    persist();
  }
  return memory;
}

export async function ready() {
  load();
}

function copyNotebook(notebook) {
  return { ...notebook };
}

function copyWord(word) {
  return { ...word };
}

export function getNotebooks() {
  return load()
    .notebooks
    .map(copyNotebook)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getNotebook(id) {
  return getNotebooks().find((notebook) => notebook.id === id) ?? null;
}

export function getAllWords() {
  return load().words.map(copyWord);
}

export function getWordsByNotebook(notebookId) {
  return getAllWords()
    .filter((word) => word.notebookId === notebookId)
    .sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function createNotebook({ title, color, type, autoLookup, showTranslation }) {
  const state = load();
  const notebook = cleanNotebook({
    id: createId(),
    title,
    color,
    type,
    autoLookup,
    showTranslation,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (!notebook) return { ok: false, message: 'ノートの名前を入力してください' };
  state.notebooks.push(notebook);
  persist();
  return { ok: true, notebook: copyNotebook(notebook) };
}

export async function updateNotebook(id, patch) {
  const state = load();
  const current = state.notebooks.find((notebook) => notebook.id === id);
  if (!current) return { ok: false, message: 'ノートが見つかりません' };
  const next = cleanNotebook({
    ...current,
    title: patch.title ?? current.title,
    color: patch.color ?? current.color,
    type: patch.type === undefined ? current.type : patch.type,
    autoLookup: patch.autoLookup === undefined ? current.autoLookup : patch.autoLookup,
    showTranslation: patch.showTranslation === undefined ? current.showTranslation : patch.showTranslation,
    updatedAt: nowIso(),
  });
  if (!next) return { ok: false, message: 'ノートの名前を入力してください' };
  Object.assign(current, next);
  persist();
  return { ok: true, notebook: copyNotebook(current) };
}

export async function deleteNotebook(id) {
  const state = load();
  const exists = state.notebooks.some((notebook) => notebook.id === id);
  if (!exists) return { ok: false, message: 'ノートが見つかりません' };
  state.notebooks = state.notebooks.filter((notebook) => notebook.id !== id);
  state.words = state.words.filter((word) => word.notebookId !== id);
  state.practiceLogs = state.practiceLogs.filter((log) => log.notebookId !== id);
  persist();
  return { ok: true };
}

export async function addWords(notebookId, entries) {
  const state = load();
  if (!state.notebooks.some((notebook) => notebook.id === notebookId)) {
    return { ok: false, message: 'ノートが見つかりません' };
  }
  const incoming = Array.isArray(entries) ? entries : [];
  if (!incoming.length) return { ok: false, message: '単語を入力してください' };
  for (const entry of incoming) {
    const hiragana = normalizeText(entry?.hiragana);
    if (hiragana && !isHiragana(hiragana)) {
      return { ok: false, message: '読みはひらがなで書いてください' };
    }
  }
  let order = state.words
    .filter((word) => word.notebookId === notebookId)
    .reduce((max, word) => Math.max(max, word.order), -1);
  const created = [];
  const timestamp = nowIso();
  incoming.forEach((entry) => {
    order += 1;
    const word = cleanWord(
      {
        id: createId(),
        notebookId,
        kanji: entry.kanji,
        hiragana: entry.hiragana,
        note: entry.note || '',
        highlight: null,
        order,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { strict: true },
    );
    if (!word) return;
    state.words.push(word);
    created.push(copyWord(word));
  });
  persist();
  return { ok: true, words: created };
}

export async function updateWord(wordId, patch) {
  const state = load();
  const current = state.words.find((word) => word.id === wordId);
  if (!current) return { ok: false, message: '単語が見つかりません' };
  const next = cleanWord(wordPatch(current, patch, nowIso()), { strict: false });
  if (!next) return { ok: false, message: '単語を入力してください' };
  Object.assign(current, next);
  persist();
  return { ok: true, word: copyWord(current) };
}

function wordsInNotebook(state, notebookId) {
  return state.words
    .filter((word) => word.notebookId === notebookId)
    .sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt)));
}

function renumber(list) {
  list.forEach((word, index) => {
    word.order = index;
  });
}

function blankWord(notebookId, order, timestamp) {
  return {
    id: createId(),
    notebookId,
    kanji: '',
    hiragana: '',
    note: '',
    highlight: null,
    order,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function ensureWordAt(notebookId, index, patch = {}) {
  const state = load();
  if (!state.notebooks.some((notebook) => notebook.id === notebookId)) {
    return { ok: false, message: 'ノートが見つかりません' };
  }
  const hiragana = patch.hiragana === undefined ? undefined : normalizeText(patch.hiragana);
  const list = wordsInNotebook(state, notebookId);
  renumber(list);
  const target = Math.max(0, Math.floor(index));
  const timestamp = nowIso();
  while (list.length <= target) {
    const created = blankWord(notebookId, list.length, timestamp);
    state.words.push(created);
    list.push(created);
  }
  const current = list[target];
  const next = cleanWord(
    wordPatch(current, hiragana === undefined ? patch : { ...patch, hiragana }, timestamp),
    { strict: false },
  );
  if (!next) return { ok: false, message: '保存できませんでした' };
  Object.assign(current, next);
  persist();
  return { ok: true, word: copyWord(current) };
}

export async function insertWordAt(notebookId, index) {
  const state = load();
  if (!state.notebooks.some((notebook) => notebook.id === notebookId)) {
    return { ok: false, message: 'ノートが見つかりません' };
  }
  const list = wordsInNotebook(state, notebookId);
  renumber(list);
  const target = Math.max(0, Math.min(Math.floor(index), list.length));
  list.forEach((word, position) => {
    word.order = position < target ? position : position + 1;
  });
  const word = blankWord(notebookId, target, nowIso());
  state.words.push(word);
  persist();
  return { ok: true, word: copyWord(word) };
}

export async function deleteWord(wordId) {
  const state = load();
  const current = state.words.find((word) => word.id === wordId);
  if (!current) return { ok: false, message: '単語が見つかりません' };
  const notebookId = current.notebookId;
  state.words = state.words.filter((word) => word.id !== wordId);
  renumber(wordsInNotebook(state, notebookId));
  persist();
  return { ok: true };
}

function wordPatch(current, patch, timestamp) {
  const pick = (key) => (patch[key] === undefined ? current[key] : patch[key]);
  return {
    ...current,
    kanji: pick('kanji'),
    hiragana: patch.hiragana === undefined ? current.hiragana : normalizeText(patch.hiragana),
    note: pick('note'),
    translation: pick('translation'),
    translationEdited: pick('translationEdited'),
    originWord: pick('originWord'),
    originLanguage: pick('originLanguage'),
    originEdited: pick('originEdited'),
    readingEdited: pick('readingEdited'),
    glossStale: pick('glossStale'),
    lookupKey: pick('lookupKey'),
    highlight: pick('highlight'),
    highlightKanji: pick('highlightKanji'),
    highlightReading: pick('highlightReading'),
    updatedAt: timestamp,
  };
}

export async function setHighlight(wordId, color, field = 'kanji') {
  const highlight = color == null || color === '' ? null : color;
  if (highlight !== null && !HIGHLIGHTS.has(highlight)) {
    return { ok: false, message: 'マーカーの色が正しくありません' };
  }
  if (field === 'reading') return updateWord(wordId, { highlightReading: highlight });
  return updateWord(wordId, { highlight, highlightKanji: highlight });
}

export async function addPracticeLog(entry) {
  const state = load();
  if (!state.notebooks.some((notebook) => notebook.id === entry?.notebookId)) {
    return { ok: false, message: 'ノートが見つかりません' };
  }
  const asInt = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.floor(number);
  };
  const log = {
    id: createId(),
    notebookId: entry.notebookId,
    mode: entry.mode === 'focus' ? 'focus' : 'practice',
    total: asInt(entry.total),
    correct: asInt(entry.correct),
    wrong: asInt(entry.wrong),
    durationMs: asInt(entry.durationMs),
    createdAt: nowIso(),
  };
  state.practiceLogs.push(log);
  persist();
  return { ok: true, log: { ...log } };
}
