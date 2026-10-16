/** 匯出與匯入。只讀 localStorage，雲端只新增確認過的文件。 */

import { CLAIM_TITLE } from './claim.js';
import { shapeNotebookForImport, shapeWordForImport } from './storage.js';

export const BACKUP_FORMAT = 'jvn-backup';
export const BACKUP_VERSION = 1;
const ORIGINAL_TITLE = '日本語の単語帳';
const BATCH_LIMIT = 20;
const IMPORT_LIMIT = 40;

const WORD_FIELDS = [
  'notebookId', 'kanji', 'hiragana', 'note', 'translation', 'translationEdited',
  'originWord', 'originLanguage', 'originEdited', 'readingEdited', 'glossStale',
  'lookupKey', 'highlight', 'highlightKanji', 'highlightReading',
];
const NOTEBOOK_FIELDS = [
  'title', 'color', 'type', 'autoLookup', 'showTranslation', 'locked',
];
const LOG_FIELDS = ['notebookId', 'mode', 'total', 'correct', 'wrong', 'durationMs', 'createdAt'];

function emptySession() {
  return {
    starterWordsVersion: 0,
    importedBatches: [],
    completedImports: [],
    notebooks: [],
    words: [],
    practiceLogs: [],
  };
}

function sameFields(left, right, fields) {
  return fields.every((key) => left?.[key] === right?.[key]);
}

export async function fingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildExportFile(raw, source) {
  let state = null;
  try {
    state = JSON.parse(raw);
  } catch {
    state = null;
  }
  const file = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source,
  };
  if (state && typeof state === 'object' && !Array.isArray(state)) file.state = state;
  else file.raw = String(raw ?? '');
  return file;
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.format === BACKUP_FORMAT && data.state && typeof data.state === 'object' && !Array.isArray(data.state)) {
    return data.state;
  }
  if (Array.isArray(data.notebooks)) return data;
  return null;
}

function unionIds(left, right, limit) {
  const merged = [...new Set([...(left || []), ...(right || [])].map((item) => String(item ?? '').trim()).filter(Boolean))];
  if (merged.length > limit) return null;
  return merged;
}

function shapeLog(input, notebookIds) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'log' };
  const id = String(input.id ?? '').trim();
  const notebookId = String(input.notebookId ?? '').trim();
  if (!id || id.includes('/') || !notebookIds.has(notebookId)) return { ok: false, reason: 'log' };
  if (input.mode !== 'practice' && input.mode !== 'focus') return { ok: false, reason: 'log' };
  for (const key of ['total', 'correct', 'wrong', 'durationMs']) {
    if (!Number.isInteger(input[key]) || input[key] < 0) return { ok: false, reason: 'log' };
  }
  if (typeof input.createdAt !== 'string' || !input.createdAt.trim()) return { ok: false, reason: 'log' };
  return {
    ok: true,
    log: {
      id,
      notebookId,
      mode: input.mode,
      total: input.total,
      correct: input.correct,
      wrong: input.wrong,
      durationMs: input.durationMs,
      createdAt: input.createdAt,
    },
  };
}

function lastWord(words) {
  return [...words].sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt))).at(-1) || null;
}

function previewOf(notebooks, words) {
  return notebooks.map((notebook) => {
    const owned = words.filter((word) => word.notebookId === notebook.id);
    const last = lastWord(owned);
    return {
      id: notebook.id,
      title: notebook.title,
      previousTitle: notebook.previousTitle || '',
      count: owned.length,
      lastKanji: last?.kanji || '',
      lastHiragana: last?.hiragana || '',
      locked: notebook.locked,
      showTranslation: notebook.showTranslation,
      autoLookup: notebook.autoLookup,
    };
  });
}

function selectNew(items, existing, fields) {
  const fresh = [];
  for (const item of items) {
    const current = existing.get(item.id);
    if (!current) {
      fresh.push(item);
      continue;
    }
    if (!sameFields(current, item, fields)) return null;
  }
  return fresh;
}

function finishPlan({
  session, contentId, notebooks, words, practiceLogs, importedBatches, starterWordsVersion,
}) {
  if ((session.completedImports || []).includes(contentId)) {
    return { ok: false, message: 'このファイルはすでに読み込まれています。' };
  }
  const notebookMap = new Map((session.notebooks || []).map((item) => [item.id, item]));
  const wordMap = new Map((session.words || []).map((item) => [item.id, item]));
  const logMap = new Map((session.practiceLogs || []).map((item) => [item.id, item]));
  const storedNotebooks = notebooks.map(({ previousTitle, ...notebook }) => notebook);
  const newNotebooks = selectNew(storedNotebooks, notebookMap, NOTEBOOK_FIELDS);
  const newWords = selectNew(words, wordMap, WORD_FIELDS);
  const newLogs = selectNew(practiceLogs, logMap, LOG_FIELDS);
  if (!newNotebooks || !newWords || !newLogs) {
    return { ok: false, message: 'クラウドにあるデータと重なるため、上書きせずに中止しました。' };
  }
  const completedImports = unionIds(session.completedImports, [contentId], IMPORT_LIMIT);
  const batches = unionIds(session.importedBatches, importedBatches, BATCH_LIMIT);
  if (!completedImports || !batches) {
    return { ok: false, message: '読み込みの記録がいっぱいです。' };
  }
  return {
    ok: true,
    contentId,
    notebooks: newNotebooks,
    words: newWords,
    practiceLogs: newLogs,
    totalWords: words.length,
    preview: previewOf(notebooks, words),
    meta: {
      starterWordsVersion: Math.max(session.starterWordsVersion || 0, starterWordsVersion || 0),
      importedBatches: batches,
      completedImports,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function planJsonImport(text, session = emptySession()) {
  let data;
  try {
    data = parseBackup(text);
  } catch {
    return { ok: false, message: 'JSONとして読み取れません。' };
  }
  if (!data || !Array.isArray(data.notebooks) || !data.notebooks.length) {
    return { ok: false, message: 'ノートが入っていないファイルです。' };
  }
  const notebooks = [];
  for (const item of data.notebooks) {
    const previousTitle = String(item?.title ?? '').trim();
    const title = previousTitle === ORIGINAL_TITLE ? CLAIM_TITLE : previousTitle;
    const shaped = shapeNotebookForImport(item, { title });
    if (!shaped.ok) return { ok: false, message: 'ノートの形式が保存できないため、中止しました。' };
    notebooks.push({ ...shaped.notebook, previousTitle: previousTitle === title ? '' : previousTitle });
  }
  const ids = new Set(notebooks.map((notebook) => notebook.id));
  if (ids.size !== notebooks.length) return { ok: false, message: 'ノートのIDが重複しています。' };
  const words = [];
  for (const item of Array.isArray(data.words) ? data.words : []) {
    const shaped = shapeWordForImport(item);
    if (!shaped.ok || !ids.has(shaped.word.notebookId)) {
      return { ok: false, message: '単語の形式が保存できないため、中止しました。' };
    }
    words.push(shaped.word);
  }
  if (new Set(words.map((word) => word.id)).size !== words.length) {
    return { ok: false, message: '単語のIDが重複しています。' };
  }
  const practiceLogs = [];
  for (const item of Array.isArray(data.practiceLogs) ? data.practiceLogs : []) {
    const shaped = shapeLog(item, ids);
    if (!shaped.ok) return { ok: false, message: '練習記録の形式が保存できないため、中止しました。' };
    practiceLogs.push(shaped.log);
  }
  const contentId = await fingerprint({
    kind: 'json',
    notebooks: notebooks.map(({ previousTitle, ...notebook }) => notebook),
    words,
    practiceLogs,
    importedBatches: data.importedBatches || [],
    starterWordsVersion: data.starterWordsVersion || 0,
  });
  const plan = finishPlan({
    session,
    contentId,
    notebooks,
    words,
    practiceLogs,
    importedBatches: data.importedBatches || [],
    starterWordsVersion: Number.isInteger(data.starterWordsVersion) ? data.starterWordsVersion : 0,
  });
  if (!plan.ok) return plan;
  return { ...plan, kind: 'json' };
}

function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((item) => item.some(Boolean));
}

function csvRows(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const headed = /漢字|単語|kanji|ことば/.test(header[0] || '');
  return (headed ? rows.slice(1) : rows).filter((row) => row.some(Boolean));
}

export async function planCsvImport(text, session = emptySession(), notebookId) {
  const notebook = (session.notebooks || []).find((item) => item.id === notebookId);
  if (!notebook) return { ok: false, message: '追加先のノートがありません。' };
  const rows = csvRows(text);
  if (!rows.length) return { ok: false, message: '追加する単語がありません。' };
  const owned = (session.words || []).filter((word) => word.notebookId === notebook.id);
  let order = owned.reduce((max, word) => Math.max(max, Number.isInteger(word.order) ? word.order : 0), -1) + 1;
  const createdAt = new Date().toISOString();
  const words = [];
  const identity = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.length !== 3) return { ok: false, message: 'CSVは「漢字,ひらがな,中文」の3列にしてください。' };
    const [kanji, hiragana, translation] = row;
    identity.push([kanji, hiragana, translation]);
    const digest = await fingerprint(`${notebook.id}:${index}:${kanji}:${hiragana}:${translation}`);
    const id = `csv-${digest}`.slice(0, 80);
    const shaped = shapeWordForImport({
      id,
      notebookId: notebook.id,
      kanji,
      hiragana,
      translation,
      note: '',
      translationEdited: true,
      originWord: '',
      originLanguage: '',
      originEdited: false,
      readingEdited: true,
      glossStale: false,
      lookupKey: '',
      highlight: null,
      highlightKanji: null,
      highlightReading: null,
      order,
      createdAt,
      updatedAt: createdAt,
    });
    if (!shaped.ok) return { ok: false, message: 'CSVの単語が保存できない形式です。' };
    words.push(shaped.word);
    order += 1;
  }
  const contentId = await fingerprint({ kind: 'csv', notebookId: notebook.id, rows: identity });
  const plan = finishPlan({
    session,
    contentId,
    notebooks: [],
    words,
    practiceLogs: [],
    importedBatches: [],
    starterWordsVersion: session.starterWordsVersion || 0,
  });
  if (!plan.ok) return plan;
  return {
    ...plan,
    kind: 'csv',
    preview: [{
      id: notebook.id,
      title: notebook.title,
      previousTitle: '',
      count: words.length,
      lastKanji: words.at(-1)?.kanji || '',
      lastHiragana: words.at(-1)?.hiragana || '',
      locked: notebook.locked,
      showTranslation: notebook.showTranslation,
      autoLookup: notebook.autoLookup,
    }],
    totalWords: words.length,
  };
}
