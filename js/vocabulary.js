/** 單字、分頁與批量輸入。純函式，不碰畫面。 */

export const PAGE_SIZE = 14;

const HIRAGANA_RE = /^[\u3041-\u3096\u309d\u309e\u30fc]+$/u;
const KATAKANA_LETTER_RE = /[\u30a1-\u30fa\u30fd\u30fe]/u;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export function isHiragana(value) {
  const text = normalizeText(value);
  return text.length > 0 && HIRAGANA_RE.test(text);
}

const KATAKANA_RE = /^[\u30a1-\u30fa\u30fc\u30fd\u30fe]+$/u;

export function hasKatakana(value) {
  return KATAKANA_LETTER_RE.test(normalizeText(value));
}

export function isKatakana(value) {
  const text = normalizeText(value);
  return text.length > 0 && KATAKANA_RE.test(text);
}

export function practicePrompt(word) {
  const origin = String(word?.originWord ?? '').trim();
  const translation = String(word?.translation ?? '').trim();
  if (origin && translation) return `${origin}（${translation}）`;
  if (origin) return origin;
  if (translation) return translation;
  return '';
}

export function sortWords(words) {
  return [...words].sort((a, b) => {
    const byOrder = (a.order ?? 0) - (b.order ?? 0);
    if (byOrder !== 0) return byOrder;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

export function pageCount(words) {
  if (!words?.length) return 1;
  return Math.max(1, Math.ceil(words.length / PAGE_SIZE));
}

export function isBlankWord(word) {
  return !String(word?.kanji ?? '').trim() && !String(word?.hiragana ?? '').trim();
}

/**
 * 最後一頁寫滿時多留一頁空白。
 * 電腦版會一併打開這一頁的對頁，方便在攤開的兩頁上繼續寫。
 * 對頁之外不再自動加頁，避免空白頁一直增加。
 */
export function editablePageLimit(words, { compact = false } = {}) {
  const count = words?.length ?? 0;
  if (count === 0) return compact ? 1 : 2;
  const content = Math.ceil(count / PAGE_SIZE);
  const trailing = count % PAGE_SIZE === 0 ? content + 1 : content;
  if (compact || count % PAGE_SIZE === 0) return trailing;
  return trailing % 2 === 1 ? trailing + 1 : trailing;
}

/** 超出範圍時回傳空陣列，避免空白對頁重複顯示最後一頁。 */
export function wordsForPage(words, page) {
  const sorted = sortWords(words ?? []);
  const total = pageCount(sorted);
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) return [];
  const start = (pageNumber - 1) * PAGE_SIZE;
  return sorted.slice(start, start + PAGE_SIZE);
}

export function pageForWord(words, wordId) {
  const index = sortWords(words).findIndex((word) => word.id === wordId);
  if (index < 0) return 1;
  return Math.floor(index / PAGE_SIZE) + 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 電腦版一次翻開兩頁（奇數頁在左）。
 * 右頁超過實際單字頁時，呼叫端畫空白頁。
 */
export function spreadFor(page, total, { compact = false } = {}) {
  const safeTotal = Math.max(1, total || 1);
  const current = clamp(Number(page) || 1, 1, safeTotal);
  if (compact) {
    return {
      current,
      pages: [current],
      hasPrev: current > 1,
      hasNext: current < safeTotal,
    };
  }
  const left = current % 2 === 0 ? current - 1 : current;
  const lastLeft = safeTotal % 2 === 0 ? safeTotal - 1 : safeTotal;
  return {
    current: left,
    pages: [left, left + 1],
    hasPrev: left > 1,
    hasNext: left < lastLeft,
  };
}

export function notebookStats(words) {
  const list = (words ?? []).filter((word) => !isBlankWord(word));
  const total = list.length;
  const remembered = list.filter((word) => word.highlight === 'green').length;
  const percent = total === 0 ? 0 : Math.round((remembered / total) * 100);
  return { total, remembered, percent };
}

/**
 * 每一行：第一欄單字、第二欄平假名，其後可當成備註。
 * 有任何一行格式不對時 entries 為空，呼叫端不可寫入。
 * source 原樣返回，避免清掉使用者已經輸入的文字。
 */
export function parseBulkVocabulary(text) {
  const source = String(text ?? '');
  const parsed = [];
  const errors = [];

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/[\s\u3000]+/);
    if (parts.length < 2) {
      errors.push({
        line: index + 1,
        message: '単語とひらがなを空白で区切ってください',
      });
      return;
    }
    const [kanji, hiragana, ...rest] = parts;
    if (!isHiragana(hiragana)) {
      errors.push({
        line: index + 1,
        message: '読みはひらがなで書いてください',
      });
      return;
    }
    parsed.push({
      kanji,
      hiragana: normalizeText(hiragana),
      note: rest.join(' '),
    });
  });

  if (!parsed.length && !errors.length) {
    errors.push({ line: 0, message: '単語を入力してください' });
  }

  return {
    ok: errors.length === 0 && parsed.length > 0,
    entries: errors.length === 0 ? parsed : [],
    errors,
    source,
  };
}
