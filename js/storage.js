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
  if (!id || !notebookId || !kanji || !hiragana) return null;
  if (strict && !isHiragana(hiragana)) return null;
  const highlight = HIGHLIGHTS.has(input.highlight) ? input.highlight : null;
  const createdAt = String(input.createdAt || nowIso());
  const order = Number.isFinite(input.order) ? Math.max(0, Math.floor(input.order)) : 0;
  return {
    id,
    notebookId,
    kanji,
    hiragana,
    note: String(input.note ?? '').slice(0, 500),
    highlight,
    order,
    createdAt,
    updatedAt: String(input.updatedAt || createdAt),
  };
}

function notebookStamp(offsetDays) {
  return new Date(Date.UTC(2026, 0, 12 + offsetDays, 1, 0, 0)).toISOString();
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

function createSeedState() {
  const notebooks = [
    ['nb-n3', '日本語 N3', 'sage', 4],
    ['nb-n2', '日本語 N2', 'milk', 3],
    ['nb-work', '仕事の日本語', 'sky', 2],
    ['nb-daily', '日常会話', 'blush', 1],
    ['nb-weak', '苦手な単語', 'lemon', 0],
  ].map(([id, title, color, offset]) => {
    const createdAt = notebookStamp(offset);
    return { id, title, color, createdAt, updatedAt: createdAt };
  });

  const words = [
    ...seedWords('nb-n3', notebookStamp(4), [
      ['禁止', 'きんし', '禁止進入', null],
      ['危ない', 'あぶない', '危險', null],
      ['静か', 'しずか', '安靜', null],
      ['危険', 'きけん', '危險', 'pink'],
      ['経験', 'けいけん', '經驗', null],
      ['続ける', 'つづける', '持續', 'pink'],
      ['調べる', 'しらべる', '查詢', null],
      ['案内', 'あんない', '引導、介紹', null],
      ['準備', 'じゅんび', '準備', null],
      ['約束', 'やくそく', '約定', null],
      ['遠慮', 'えんりょ', '客氣、遠慮', 'yellow'],
      ['丁寧', 'ていねい', '禮貌、仔細', 'yellow'],
      ['複雑', 'ふくざつ', '複雜', 'yellow'],
      ['簡単', 'かんたん', '簡單', 'green'],
      ['必要', 'ひつよう', '必要', 'green'],
      ['便利', 'べんり', '方便', 'green'],
      ['不便', 'ふべん', '不方便', null],
      ['安全', 'あんぜん', '安全', 'green'],
      ['注意', 'ちゅうい', '注意', null],
      ['説明', 'せつめい', '說明', null],
      ['参加', 'さんか', '參加', null],
      ['予定', 'よてい', '預定', 'green'],
      ['連絡', 'れんらく', '聯絡', null],
      ['確認', 'かくにん', '確認', 'green'],
      ['反対', 'はんたい', '反對', null],
      ['賛成', 'さんせい', '贊成', null],
      ['理由', 'りゆう', '理由', null],
      ['原因', 'げんいん', '原因', 'yellow'],
      ['結果', 'けっか', '結果', null],
      ['方法', 'ほうほう', '方法', null],
    ]),
    ...seedWords('nb-n2', notebookStamp(3), [
      ['影響', 'えいきょう', '影響', 'green'],
      ['改善', 'かいぜん', '改善', 'green'],
      ['増加', 'ぞうか', '增加', 'green'],
      ['減少', 'げんしょう', '減少', 'green'],
      ['維持', 'いじ', '維持', 'green'],
      ['実現', 'じつげん', '實現', 'green'],
      ['提案', 'ていあん', '提案', 'green'],
      ['議論', 'ぎろん', '議論', 'green'],
      ['判断', 'はんだん', '判斷', 'green'],
      ['責任', 'せきにん', '責任', 'green'],
      ['協力', 'きょうりょく', '協力', null],
      ['貢献', 'こうけん', '貢獻', null],
      ['解決', 'かいけつ', '解決', null],
      ['課題', 'かだい', '課題', null],
      ['状況', 'じょうきょう', '狀況', null],
      ['傾向', 'けいこう', '傾向', null],
      ['特徴', 'とくちょう', '特徵', null],
      ['比較', 'ひかく', '比較', null],
      ['関連', 'かんれん', '相關', null],
      ['条件', 'じょうけん', '條件', null],
    ]),
    ...seedWords('nb-work', notebookStamp(2), [
      ['会議', 'かいぎ', '會議', 'green'],
      ['資料', 'しりょう', '資料', 'green'],
      ['報告', 'ほうこく', '報告', 'green'],
      ['提出', 'ていしゅつ', '提交', null],
      ['締め切り', 'しめきり', '截止', 'pink'],
      ['残業', 'ざんぎょう', '加班', null],
      ['出勤', 'しゅっきん', '上班', null],
      ['退勤', 'たいきん', '下班', null],
      ['取引先', 'とりひきさき', '客戶、往來對象', null],
      ['見積もり', 'みつもり', '估價', 'yellow'],
      ['請求書', 'せいきゅうしょ', '請款單', 'yellow'],
      ['納期', 'のうき', '交期', null],
      ['在宅', 'ざいたく', '在家', null],
      ['担当', 'たんとう', '負責', 'green'],
      ['共有', 'きょうゆう', '共享', null],
      ['確認事項', 'かくにんじこう', '需要確認的事項', null],
    ]),
    ...seedWords('nb-daily', notebookStamp(1), [
      ['朝食', 'ちょうしょく', '早餐', 'green'],
      ['通勤', 'つうきん', '通勤', 'green'],
      ['買い物', 'かいもの', '購物', 'green'],
      ['天気', 'てんき', '天氣', 'green'],
      ['洗濯', 'せんたく', '洗衣服', null],
      ['掃除', 'そうじ', '打掃', 'green'],
      ['料理', 'りょうり', '做菜', 'green'],
      ['休憩', 'きゅうけい', '休息', 'green'],
      ['散歩', 'さんぽ', '散步', 'green'],
      ['予約', 'よやく', '預約', null],
      ['忘れ物', 'わすれもの', '遺失物', null],
      ['元気', 'げんき', '精神好、健康', 'green'],
    ]),
    ...seedWords('nb-weak', notebookStamp(0), [
      ['似合う', 'にあう', '適合、相襯', 'pink'],
      ['相槌', 'あいづち', '應和、附和', 'pink'],
      ['微妙', 'びみょう', '微妙、有點不對勁', 'yellow'],
      ['適当', 'てきとう', '隨便、適當', 'yellow'],
      ['面倒', 'めんどう', '麻煩', 'yellow'],
      ['申し訳ない', 'もうしわけない', '不好意思、抱歉', 'pink'],
      ['頑張る', 'がんばる', '加油、努力', 'green'],
      ['気を遣う', 'きをつかう', '看場合說話、顧慮對方', 'pink'],
    ]),
  ];

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

export async function createNotebook({ title, color }) {
  const state = load();
  const notebook = cleanNotebook({
    id: createId(),
    title,
    color,
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
    const kanji = String(entry?.kanji ?? '').trim();
    const hiragana = normalizeText(entry?.hiragana);
    if (!kanji || !isHiragana(hiragana)) {
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
  const nextHiragana = patch.hiragana === undefined ? current.hiragana : patch.hiragana;
  if (!isHiragana(nextHiragana)) {
    return { ok: false, message: '読みはひらがなで書いてください' };
  }
  const next = cleanWord(
    {
      ...current,
      kanji: patch.kanji === undefined ? current.kanji : patch.kanji,
      hiragana: nextHiragana,
      note: patch.note === undefined ? current.note : patch.note,
      highlight: patch.highlight === undefined ? current.highlight : patch.highlight,
      updatedAt: nowIso(),
    },
    { strict: true },
  );
  if (!next) return { ok: false, message: '単語を入力してください' };
  Object.assign(current, next);
  persist();
  return { ok: true, word: copyWord(current) };
}

export async function deleteWord(wordId) {
  const state = load();
  const exists = state.words.some((word) => word.id === wordId);
  if (!exists) return { ok: false, message: '単語が見つかりません' };
  state.words = state.words.filter((word) => word.id !== wordId);
  persist();
  return { ok: true };
}

export async function setHighlight(wordId, color) {
  const highlight = color == null || color === '' ? null : color;
  if (highlight !== null && !HIGHLIGHTS.has(highlight)) {
    return { ok: false, message: 'マーカーの色が正しくありません' };
  }
  return updateWord(wordId, { highlight });
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
