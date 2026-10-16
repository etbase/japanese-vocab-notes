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

const CSV_COLUMNS = new Map([
  ['漢字', 'kanji'],
  ['kanji', 'kanji'],
  ['ひらがな', 'hiragana'],
  ['平假名', 'hiragana'],
  ['假名', 'hiragana'],
  ['hiragana', 'hiragana'],
  ['繁體中文', 'translation'],
  ['繁体中文', 'translation'],
  ['中文', 'translation'],
  ['translation', 'translation'],
]);

function csvTable(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, message: '追加する単語がありません。' };
  const header = rows[0].map((cell) => cell.trim());
  const columns = {};
  header.forEach((cell, index) => {
    const key = CSV_COLUMNS.get(cell) || CSV_COLUMNS.get(cell.toLowerCase());
    if (key && columns[key] === undefined) columns[key] = index;
  });
  if (columns.kanji === undefined || columns.hiragana === undefined || columns.translation === undefined) {
    return { ok: false, message: '1行目は「漢字,ひらがな,繁體中文」にしてください。' };
  }
  const records = [];
  for (const row of rows.slice(1)) {
    if (!row.some(Boolean)) continue;
    const kanji = row[columns.kanji] || '';
    const hiragana = row[columns.hiragana] || '';
    const translation = row[columns.translation] || '';
    if (!kanji && !hiragana) return { ok: false, message: '漢字もひらがなもない行があるため、中止しました。' };
    records.push({ kanji, hiragana, translation, note: '', highlight: null, highlightKanji: null, highlightReading: null });
  }
  if (!records.length) return { ok: false, message: '追加する単語がありません。' };
  return { ok: true, records };
}

function jsonRecords(text) {
  let data;
  try {
    data = parseBackup(text);
  } catch {
    return { ok: false, message: 'JSONとして読み取れません。' };
  }
  if (!data) return { ok: false, message: 'ノートが入っていないファイルです。' };
  const notebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
  const words = Array.isArray(data.words) ? data.words : [];
  const ordered = [];
  const seen = new Set();
  const take = (list) => {
    list
      .slice()
      .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0) || String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')))
      .forEach((word) => {
        if (!word || seen.has(word)) return;
        seen.add(word);
        ordered.push(word);
      });
  };
  notebooks.forEach((notebook) => {
    take(words.filter((word) => word?.notebookId === notebook.id));
  });
  take(words);
  if (!ordered.length) return { ok: false, message: '追加する単語がありません。' };
  return { ok: true, records: ordered };
}

function nextOrder(words, notebookId) {
  return words
    .filter((word) => word.notebookId === notebookId)
    .reduce((max, word) => Math.max(max, Number.isInteger(word.order) ? word.order : -1), -1) + 1;
}

function sameSequence(owned, records) {
  const key = (word) => `${word.kanji}\n${word.hiragana}\n${word.translation}`;
  const haystack = [...owned]
    .sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(key)
    .join('\n---\n');
  const needle = records.map(key).join('\n---\n');
  return Boolean(needle) && haystack.includes(needle);
}

async function planAppend(records, session, notebookId, contentKind) {
  const notebook = (session.notebooks || []).find((item) => item.id === notebookId);
  if (!notebook) return { ok: false, message: '追加先のノートがありません。' };
  const owned = (session.words || []).filter((word) => word.notebookId === notebook.id);
  const ownedById = new Map(owned.map((word) => [word.id, word]));
  const freshRecords = [];
  for (const record of records) {
    const id = String(record.id ?? '').trim();
    if (!id || !ownedById.has(id)) {
      freshRecords.push(record);
      continue;
    }
    const current = ownedById.get(id);
    const changed = current.kanji !== String(record.kanji ?? '').trim()
      || current.hiragana !== String(record.hiragana ?? '').trim()
      || current.translation !== String(record.translation ?? '').trim();
    if (changed) {
      return { ok: false, message: 'クラウドにあるデータと重なるため、上書きせずに中止しました。' };
    }
  }
  if (!freshRecords.length || sameSequence(owned, freshRecords)) {
    return { ok: false, message: 'このファイルはすでに読み込まれています。' };
  }
  let order = nextOrder(session.words || [], notebook.id);
  const createdAt = new Date().toISOString();
  const words = [];
  const identity = [];
  for (let index = 0; index < freshRecords.length; index += 1) {
    const record = freshRecords[index];
    identity.push([
      record.kanji, record.hiragana, record.translation, record.note || '',
      record.highlight || '', record.highlightKanji || '', record.highlightReading || '',
    ]);
    const digest = await fingerprint(`${notebook.id}:${index}:${record.kanji}:${record.hiragana}:${record.translation}`);
    const shaped = shapeWordForImport({
      id: `add-${digest}`.slice(0, 80),
      notebookId: notebook.id,
      kanji: record.kanji,
      hiragana: record.hiragana,
      translation: record.translation,
      note: record.note || '',
      translationEdited: record.translationEdited !== undefined ? Boolean(record.translationEdited) : true,
      originWord: record.originWord || '',
      originLanguage: record.originLanguage || '',
      originEdited: Boolean(record.originEdited),
      readingEdited: record.readingEdited !== undefined ? Boolean(record.readingEdited) : true,
      glossStale: Boolean(record.glossStale),
      lookupKey: record.lookupKey || '',
      highlight: record.highlight ?? null,
      highlightKanji: record.highlightKanji,
      highlightReading: record.highlightReading,
      order,
      createdAt: record.createdAt || createdAt,
      updatedAt: record.updatedAt || createdAt,
    });
    if (!shaped.ok) return { ok: false, message: '単語の形式が保存できないため、中止しました。' };
    words.push(shaped.word);
    order += 1;
  }
  const contentId = await fingerprint({ kind: contentKind, notebookId: notebook.id, rows: identity });
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
  const last = lastWord(owned);
  const added = plan.words.length;
  return {
    ...plan,
    mode: 'append',
    kind: contentKind,
    notebooks: [],
    practiceLogs: [],
    totalWords: freshRecords.length,
    append: {
      notebookId: notebook.id,
      title: notebook.title,
      currentCount: owned.length,
      fileCount: freshRecords.length,
      addedCount: added,
      nextCount: owned.length + added,
      lastKanji: last?.kanji || '',
      lastHiragana: last?.hiragana || '',
      rows: freshRecords.map((record) => ({
        kanji: record.kanji,
        hiragana: record.hiragana,
        translation: record.translation,
      })),
    },
  };
}

export async function planCsvImport(text, session = emptySession(), notebookId) {
  const table = csvTable(text);
  if (!table.ok) return table;
  return planAppend(table.records, session, notebookId, 'csv');
}

export async function inspectImportFile(text, kind) {
  const table = kind === 'csv' ? csvTable(text) : jsonRecords(text);
  if (!table.ok) return table;
  return {
    ok: true,
    count: table.records.length,
    rows: table.records.map((record) => ({
      kanji: String(record.kanji ?? '').trim(),
      hiragana: String(record.hiragana ?? '').trim(),
      translation: String(record.translation ?? '').trim(),
    })),
  };
}

export async function planJsonAppend(text, session = emptySession(), notebookId) {
  const table = jsonRecords(text);
  if (!table.ok) return table;
  return planAppend(table.records, session, notebookId, 'json-append');
}
