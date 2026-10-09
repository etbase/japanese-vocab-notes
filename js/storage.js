/**
 * 每個使用者一份資料。
 * Demo Mode 存在 localStorage；之後 Firebase 只讀寫 users/{uid} 底下的文件。
 * 本地寫入不會自動通知畫面，呼叫端處理完焦點與對話框後再自行重畫。
 * 遠端同步可呼叫 notify()。
 */

import { STARTER_WORD_ROWS } from './starter-words.js';
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
    locked: input.locked === undefined ? true : Boolean(input.locked),
    createdAt,
    updatedAt: String(input.updatedAt || createdAt),
  };
}

const HAN_RE = /[\u3400-\u9fff]/u;
let glossMigrated = false;

function splitLoanGloss(translation, originWord) {
  const current = {
    translation: String(translation ?? '').trim(),
    originWord: String(originWord ?? '').trim(),
    changed: false,
  };
  const parsed = (!current.originWord && parseLoanPair(current.translation))
    || (!current.translation && parseLoanPair(current.originWord));
  if (!parsed) return current;
  glossMigrated = true;
  return { translation: parsed.translation, originWord: parsed.originWord, changed: true };
}

function parseLoanPair(value) {
  const match = String(value ?? '').trim().match(/^([^（()）]{1,40})[（(]([^（()）]{1,40})[）)]$/u);
  if (!match) return null;
  const outside = match[1].trim();
  const inside = match[2].trim();
  if (!outside || !inside) return null;
  const outsideHan = HAN_RE.test(outside);
  const insideHan = HAN_RE.test(inside);
  const latinOrigin = /[A-Za-z\u00C0-\u024F]/u;
  if (!outsideHan && insideHan && latinOrigin.test(outside)) return { originWord: outside, translation: inside };
  if (outsideHan && !insideHan && latinOrigin.test(inside)) return { originWord: inside, translation: outside };
  return null;
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
  const gloss = splitLoanGloss(
    String(input.translation ?? '').slice(0, 80),
    String(input.originWord ?? '').slice(0, 80),
  );
  return {
    id,
    notebookId,
    kanji,
    hiragana,
    note: String(input.note ?? '').slice(0, 500),
    translation: gloss.translation,
    translationEdited: gloss.changed ? true : Boolean(input.translationEdited),
    originWord: gloss.originWord,
    originLanguage: String(input.originLanguage ?? '').slice(0, 40),
    originEdited: gloss.changed ? true : Boolean(input.originEdited),
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

const STARTER_ID = 'nb-starter';
const STARTER_WORDS_VERSION = 3;
const LEGACY_STARTER_HEADS = new Set(['禁止', '危ない', '静か', '危険', '練習', '貯める']);

function starterWords(createdAt) {
  return STARTER_WORD_ROWS.map((row, order) => ({
    id: `${STARTER_ID}-${String(order + 1).padStart(3, '0')}`,
    notebookId: STARTER_ID,
    kanji: row[0],
    hiragana: row[1],
    note: '',
    translation: row[2],
    translationEdited: true,
    originWord: '',
    originLanguage: '',
    originEdited: false,
    readingEdited: true,
    glossStale: false,
    lookupKey: '',
    highlight: null,
    order,
    createdAt,
    updatedAt: createdAt,
  }));
}

function correctStarterWord(word) {
  if (word.kanji === '安静（な）') {
    word.kanji = '安静';
    word.hiragana = 'あんせい';
    word.translation = '安靜、靜養';
  } else if (word.kanji === '御～') {
    word.hiragana = 'お・ご';
    word.translation = '表示尊敬或禮貌的前綴';
  } else if (word.kanji === '御手洗い') {
    word.kanji = 'お手洗い';
    word.hiragana = 'おてあらい';
    word.translation = '洗手間、廁所';
  } else if (word.kanji === '開放厳禁') {
    word.hiragana = 'かいほうげんきん';
    word.translation = '嚴禁開放、請保持關閉';
  } else if (word.kanji === '備え付け（の）') {
    word.kanji = '備え付け';
    word.hiragana = 'そなえつけ';
    word.translation = '附設、配備';
  } else if (word.kanji === '精算') {
    if (word.hiragana === 'せいさん' && word.translation === '結算、補票結算') return false;
    word.hiragana = 'せいさん';
    if (!String(word.translation || '').trim()) word.translation = '結算、補票結算';
  } else {
    return false;
  }
  word.translationEdited = true;
  word.readingEdited = true;
  word.updatedAt = nowIso();
  return true;
}

function appendStarterRows(state, rows, createdAt) {
  const owned = state.words.filter((word) => word.notebookId === STARTER_ID);
  const seen = new Set(owned.map((word) => word.kanji));
  let order = owned.reduce((max, word) => Math.max(max, Number(word.order) || 0), -1) + 1;
  const usedIds = new Set(state.words.map((word) => word.id));
  rows.forEach((row, index) => {
    if (seen.has(row[0])) return;
    let id = `${STARTER_ID}-n${String(index + 1).padStart(3, '0')}`;
    while (usedIds.has(id)) id = `${id}-x`;
    const clean = cleanWord({
      id,
      notebookId: STARTER_ID,
      kanji: row[0],
      hiragana: row[1],
      note: '',
      translation: row[2],
      translationEdited: true,
      readingEdited: true,
      order,
      createdAt,
      updatedAt: createdAt,
    });
    if (!clean) return;
    state.words.push(clean);
    seen.add(clean.kanji);
    usedIds.add(clean.id);
    order += 1;
  });
}

function migrateStarterNotebook(state) {
  if ((state.starterWordsVersion || 0) >= STARTER_WORDS_VERSION) return false;
  state.starterWordsVersion = STARTER_WORDS_VERSION;
  const notebook = state.notebooks.find((item) => item.id === STARTER_ID);
  if (!notebook) return true;
  const createdAt = notebook.createdAt || nowIso();
  const owned = state.words.filter((word) => word.notebookId === STARTER_ID);
  const hasCurriculum = owned.some((word) => word.kanji === '一万円札' || word.kanji === '禁煙');
  const legacyOnly = owned.length > 0 && owned.every((word) => LEGACY_STARTER_HEADS.has(word.kanji));
  if (!hasCurriculum && (owned.length === 0 || legacyOnly)) {
    state.words = state.words.filter((word) => word.notebookId !== STARTER_ID);
    starterWords(createdAt).forEach((word) => {
      const clean = cleanWord(word);
      if (clean) state.words.push(clean);
    });
    return true;
  }
  owned.forEach(correctStarterWord);
  const anchor = STARTER_WORD_ROWS.findIndex((row) => row[0] === '一万円札');
  appendStarterRows(state, STARTER_WORD_ROWS.slice(anchor + 1), nowIso());
  return true;
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
    id: STARTER_ID,
    title: '日本語の単語帳',
    color: 'sage',
    type: 'kanji',
    createdAt,
    updatedAt: createdAt,
  }];
  return {
    version: 1,
    starterWordsVersion: STARTER_WORDS_VERSION,
    notebooks,
    words: starterWords(createdAt),
    practiceLogs: [],
  };
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
  const starterWordsVersion = Number.isFinite(Number(data?.starterWordsVersion))
    ? Math.max(0, Math.floor(Number(data.starterWordsVersion)))
    : 0;
  return { version: 1, starterWordsVersion, notebooks, words, practiceLogs };
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
    glossMigrated = false;
    memory = normalizeState(JSON.parse(raw));
    if (isUntouchedSample(memory)) {
      memory = createSeedState();
      persist();
    } else if (migrateStarterNotebook(memory) || glossMigrated) {
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
    locked: patch.locked === undefined ? current.locked : Boolean(patch.locked),
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
