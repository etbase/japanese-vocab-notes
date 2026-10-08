/** 羅馬字與假名轉換。只綁在平假名、片假名與練習答案欄。 */

import { bind, toHiragana, toKatakana } from './vendor/wanakana.js';

const KATAKANA_CHAR = /[\u30a1-\u30fa\u30fd\u30fe]/u;
const HIRAGANA_CHAR = /[\u3041-\u3096\u309d\u309e]/u;

/**
 * 使用 WanaKana.bind。平假名欄 IMEMode: toHiragana，片假名欄 IMEMode: toKatakana。
 * 同一個 input 只綁一次。
 */
export function bindKanaInput(input, mode) {
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.kanaBound) return;
  const script = mode === 'katakana' ? 'katakana' : 'hiragana';
  input.dataset.kanaBound = script;
  bind(input, { IMEMode: script === 'katakana' ? 'toKatakana' : 'toHiragana' });
}

/**
 * 組字中不要改字。compositionend 之後才把對方假名轉成這個欄位的文字。
 * 長音符號保持原樣，避免 ー 被展開成あ。
 */
export function settleKana(input) {
  const mode = input?.dataset?.kanaBound;
  if (mode !== 'hiragana' && mode !== 'katakana') return;
  const pattern = mode === 'katakana' ? HIRAGANA_CHAR : KATAKANA_CHAR;
  if (!pattern.test(input.value)) return;
  const convert = mode === 'katakana'
    ? (char) => toKatakana(char, { convertLongVowelMark: false })
    : (char) => toHiragana(char, { convertLongVowelMark: false });
  const next = [...input.value].map((char) => (pattern.test(char) ? convert(char) : char)).join('');
  if (next === input.value) return;
  const start = input.selectionStart ?? next.length;
  const end = input.selectionEnd ?? start;
  input.value = next;
  const max = next.length;
  try {
    input.setSelectionRange(Math.min(start, max), Math.min(end, max));
  } catch {
    /* 非文字欄位沒有選取範圍 */
  }
}

export function watchIme(input) {
  const state = { composing: false, endedAt: 0 };
  input.addEventListener('compositionstart', () => {
    state.composing = true;
    input.dataset.ignoreComposition = 'true';
  });
  input.addEventListener('compositionend', () => {
    state.composing = false;
    state.endedAt = performance.now();
    input.dataset.ignoreComposition = 'false';
  });
  return state;
}

/** IME 確認候選字的 Enter 不拿來換行或判定。 */
export function imeBlocks(state, event) {
  if (!state) return false;
  if (state.composing || event.isComposing || event.keyCode === 229) return true;
  return event.key === 'Enter' && performance.now() - state.endedAt < 120;
}
