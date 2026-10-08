/** 練習判定。畫面在後續階段接上；這裡先固定規則，避免提早在 IME 組字時判錯。 */

import { hasKatakana, isHiragana, normalizeText } from './vocabulary.js';

export function judgeAnswer(raw, expected, { composing = false } = {}) {
  if (composing) return { status: 'pending' };
  const input = normalizeText(raw);
  const answer = normalizeText(expected);
  if (!input) return { status: 'empty' };
  if (hasKatakana(input)) {
    return { status: 'katakana', message: 'ひらがなで入力してください' };
  }
  if (!isHiragana(input)) {
    return { status: 'invalid', message: 'ひらがなで入力してください' };
  }
  if (input === answer) return { status: 'correct' };
  return { status: 'incorrect' };
}

export function summarizePractice(results) {
  const list = results ?? [];
  const total = list.length;
  const correct = list.filter((item) => item.status === 'correct').length;
  const incorrect = list.filter((item) => item.status === 'incorrect' || item.status === 'katakana').length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { total, correct, incorrect, percent };
}
