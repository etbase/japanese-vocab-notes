/**
 * 每個使用者一份資料。
 * Demo Mode 存在 localStorage；之後 Firebase 只讀寫 users/{uid} 底下的文件。
 * 本地寫入不會自動通知畫面，呼叫端處理完焦點與對話框後再自行重畫。
 * 遠端同步可呼叫 notify()。
 */

import { pullUserState, pushUserState } from './cloud.js';
import { STARTER_WORD_ROWS } from './starter-words.js';
import { PHOTO_VOCAB_BATCH_ID, PHOTO_VOCAB_ROWS } from './vocab-batch-20261014.js';
import { PHOTO_1113_BATCH_ID, PHOTO_1113_ROWS } from './vocab-batch-20261014-11-13.js';
import { isHiragana, normalizeText } from './vocabulary.js';

const HIGHLIGHTS = new Set(['yellow', 'pink', 'green']);
const listeners = new Set();

const ARCHIVE_KEY = 'jvn.local-demo.v1';
const ARCHIVE_BACKUP_KEY = 'jvn.local-demo.v1.backup-20261016';

let userId = '';
let memory = null;
let memoryUser = null;
let hydrating = false;
let persistenceWarning = false;
let cloudWarning = false;
let pushTimer = 0;

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

export function hasCloudWarning() {
  return cloudWarning;
}

export function setActiveUser(id) {
  const next = String(id || '');
  if (next === userId) return;
  userId = next;
  memory = null;
  memoryUser = null;
  cloudWarning = false;
}

export function storageKey() {
  return userId ? `jvn.${userId}.v1` : '';
}

export function backupArchive() {
  if (!canUseStorage()) return false;
  const raw = localStorage.getItem(ARCHIVE_KEY);
  if (!raw) return false;
  if (!localStorage.getItem(ARCHIVE_BACKUP_KEY)) localStorage.setItem(ARCHIVE_BACKUP_KEY, raw);
  return true;
}

export function readArchiveRaw() {
  if (!canUseStorage()) return null;
  return localStorage.getItem(ARCHIVE_KEY);
}

export function readSession() {
  if (!userId) return null;
  const state = load();
  return {
    version: 1,
    starterWordsVersion: state.starterWordsVersion || 0,
    importedBatches: [...(state.importedBatches || [])],
    completedImports: [...(state.completedImports || [])],
    notebooks: state.notebooks.map(copyNotebook),
    words: state.words.map(copyWord),
    practiceLogs: state.practiceLogs.map((log) => ({ ...log })),
  };
}

export function readArchiveSummary() {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(ARCHIVE_KEY);
  if (!raw) return null;
  try {
    const data = normalizeState(JSON.parse(raw));
    const notebook = data.notebooks.find((item) => item.id === STARTER_ID) || data.notebooks[0];
    if (!notebook) return null;
    const words = data.words
      .filter((word) => word.notebookId === notebook.id)
      .sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt)));
    const last = words.at(-1);
    return {
      notebookId: notebook.id,
      title: notebook.title,
      count: words.length,
      lastKanji: last?.kanji || '',
      lastHiragana: last?.hiragana || '',
    };
  } catch {
    return null;
  }
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

function cleanWord(input, { strict = false, preserveGloss = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id ?? '').trim();
  const notebookId = String(input.notebookId ?? '').trim();
  const kanji = String(input.kanji ?? '').trim().slice(0, 40);
  const hiragana = normalizeReading(input.hiragana).slice(0, 80);
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
  const translationText = String(input.translation ?? '').trim().slice(0, 80);
  const originText = String(input.originWord ?? '').trim().slice(0, 80);
  const gloss = preserveGloss
    ? { translation: translationText, originWord: originText, changed: false }
    : splitLoanGloss(translationText, originText);
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

export function shapeNotebookForImport(input, { title } = {}) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'notebook' };
  const source = { ...input };
  if (title) source.title = title;
  const titleText = String(source.title ?? '').trim();
  if (!titleText || titleText.length > 30) return { ok: false, reason: 'title' };
  if (source.color != null && source.color !== '' && !/^[a-z]{1,20}$/.test(String(source.color).trim())) {
    return { ok: false, reason: 'color' };
  }
  if (source.type != null && source.type !== 'kanji' && source.type !== 'katakana') {
    return { ok: false, reason: 'type' };
  }
  const notebook = cleanNotebook(source);
  if (!notebook || notebook.title !== titleText) return { ok: false, reason: 'notebook' };
  return { ok: true, notebook };
}

export function shapeWordForImport(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'word' };
  const id = String(input.id ?? '').trim();
  const notebookId = String(input.notebookId ?? '').trim();
  const kanji = String(input.kanji ?? '').trim();
  const hiragana = normalizeReading(input.hiragana);
  const translation = String(input.translation ?? '').trim();
  const note = String(input.note ?? '');
  const originWord = String(input.originWord ?? '').trim();
  const originLanguage = String(input.originLanguage ?? '').trim();
  const lookupKey = String(input.lookupKey ?? '').trim();
  if (!id || id.includes('/') || !notebookId || notebookId.includes('/')) return { ok: false, reason: 'word' };
  if (!Number.isInteger(input.order) || input.order < 0) return { ok: false, reason: 'order' };
  if (typeof input.createdAt !== 'string' || !input.createdAt.trim()) return { ok: false, reason: 'time' };
  if (kanji.length > 40) return { ok: false, reason: 'kanji' };
  if (hiragana.length > 80) return { ok: false, reason: 'hiragana' };
  if (translation.length > 80) return { ok: false, reason: 'translation' };
  if (note.length > 500) return { ok: false, reason: 'note' };
  if (originWord.length > 80 || originLanguage.length > 40 || lookupKey.length > 40) return { ok: false, reason: 'field' };
  if (!kanji && !hiragana) return { ok: false, reason: 'empty' };
  for (const key of ['highlight', 'highlightKanji', 'highlightReading']) {
    const value = input[key];
    if (value != null && value !== '' && !HIGHLIGHTS.has(value)) return { ok: false, reason: 'highlight' };
  }
  const word = cleanWord(input, { preserveGloss: true });
  if (!word || word.kanji !== kanji || word.hiragana !== hiragana) return { ok: false, reason: 'word' };
  if (word.translation !== translation || word.originWord !== originWord || word.note !== note) {
    return { ok: false, reason: 'translation' };
  }
  return { ok: true, word };
}

function normalizeReading(value) {
  const kept = [];
  const shielded = String(value ?? '').replace(/[（）]/gu, (char) => {
    kept.push(char);
    return '\u0000';
  });
  let index = 0;
  return shielded.normalize('NFKC').replace(/\u0000/g, () => kept[index++] ?? '').trim();
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

function cleanBatches(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

const VOCAB_IMPORTS = [
  { id: PHOTO_VOCAB_BATCH_ID, rows: PHOTO_VOCAB_ROWS, prefix: 'p20261014' },
  { id: PHOTO_1113_BATCH_ID, rows: PHOTO_1113_ROWS, prefix: 'p1113-20261014' },
];

function appendVocabBatch(state, batch) {
  const batches = cleanBatches(state.importedBatches);
  state.importedBatches = batches;
  if (batches.includes(batch.id)) return false;
  const notebook = state.notebooks.find((item) => item.id === STARTER_ID);
  if (!notebook) return false;
  const createdAt = nowIso();
  const owned = state.words.filter((word) => word.notebookId === STARTER_ID);
  let order = owned.reduce((max, word) => Math.max(max, Number(word.order) || 0), -1);
  const usedIds = new Set(state.words.map((word) => word.id));
  batch.rows.forEach((row, index) => {
    let id = `${STARTER_ID}-${batch.prefix}-${String(index + 1).padStart(3, '0')}`;
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
      highlight: null,
      order: order + 1,
      createdAt,
      updatedAt: createdAt,
    });
    if (!clean) return;
    order = clean.order;
    state.words.push(clean);
    usedIds.add(clean.id);
  });
  state.importedBatches = [...batches, batch.id];
  return true;
}

function importPhotoVocabBatch(state) {
  return VOCAB_IMPORTS.reduce((changed, batch) => appendVocabBatch(state, batch) || changed, false);
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
  return {
    version: 1,
    starterWordsVersion,
    importedBatches: cleanBatches(data?.importedBatches),
    completedImports: cleanBatches(data?.completedImports),
    notebooks,
    words,
    practiceLogs,
  };
}

function emptyState() {
  return {
    version: 1,
    starterWordsVersion: 0,
    importedBatches: [],
    completedImports: [],
    notebooks: [],
    words: [],
    practiceLogs: [],
  };
}

function persistLocal() {
  if (!userId || !memory || !canUseStorage()) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(memory));
    persistenceWarning = false;
  } catch {
    persistenceWarning = true;
  }
}

function persist() {
  persistLocal();
  if (hydrating || !userId || !memory) return;
  clearTimeout(pushTimer);
  const snapshot = memory;
  const uid = userId;
  pushTimer = setTimeout(() => {
    pushUserState(uid, snapshot).then((result) => {
      cloudWarning = !result.ok;
    });
  }, 500);
}

function loadCachedState() {
  if (!userId || !canUseStorage()) return null;
  const raw = localStorage.getItem(storageKey());
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function load() {
  if (memory && memoryUser === userId) return memory;
  memoryUser = userId;
  if (!userId) {
    memory = emptyState();
    return memory;
  }
  memory = loadCachedState() || emptyState();
  return memory;
}

export function canonicalArchiveState() {
  const state = createSeedState();
  importPhotoVocabBatch(state);
  return normalizeState(state);
}

export function normalizeImportedState(data) {
  return normalizeState(data);
}

export function pauseCloudPush() {
  hydrating = true;
  clearTimeout(pushTimer);
}

export function resumeCloudPush() {
  hydrating = false;
}

export function commitImportedState(next) {
  memory = {
    version: 1,
    starterWordsVersion: next?.starterWordsVersion || 0,
    importedBatches: [...(next?.importedBatches || [])],
    completedImports: [...(next?.completedImports || [])],
    notebooks: (next?.notebooks || []).map(copyNotebook),
    words: (next?.words || []).map(copyWord),
    practiceLogs: (next?.practiceLogs || []).map((log) => ({ ...log })),
  };
  memoryUser = userId;
  persistLocal();
}

export async function ready() {
  backupArchive();
  if (memory && memoryUser === userId) return;
  memoryUser = userId;
  if (!userId) {
    memory = emptyState();
    return;
  }
  hydrating = true;
  const remote = await pullUserState(userId);
  if (remote?.ok) {
    memory = normalizeState(remote.state);
    persistLocal();
  } else if (remote?.missing) {
    memory = loadCachedState() || emptyState();
  } else {
    cloudWarning = true;
    memory = loadCachedState() || emptyState();
  }
  hydrating = false;
}

function copyNotebook(notebook) {
  return { ...notebook };
}

function copyWord(word) {
  return { ...word };
}

function sessionState() {
  const state = load();
  if (!userId) return null;
  return state;
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
  const exists = state.notebooks.some((notebook) => notebook.id === id);
  if (!exists) return { ok: false, message: 'ノートが見つかりません' };
  state.notebooks = state.notebooks.filter((notebook) => notebook.id !== id);
  state.words = state.words.filter((word) => word.notebookId !== id);
  state.practiceLogs = state.practiceLogs.filter((log) => log.notebookId !== id);
  persist();
  return { ok: true };
}

export async function addWords(notebookId, entries) {
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
  const current = state.words.find((word) => word.id === wordId);
  if (!current) return { ok: false, message: '単語が見つかりません' };
  const reading = current.highlightReading !== undefined ? current.highlightReading : (current.highlight || null);
  const kanji = current.highlightKanji !== undefined ? current.highlightKanji : (current.highlight || null);
  if (field === 'reading') {
    return updateWord(wordId, { highlightReading: highlight, highlightKanji: kanji });
  }
  return updateWord(wordId, { highlight, highlightKanji: highlight, highlightReading: reading });
}

export async function addPracticeLog(entry) {
  const state = sessionState();
  if (!state) return { ok: false, message: 'ログインしてください' };
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
