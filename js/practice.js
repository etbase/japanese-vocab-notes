/** 練習判定。畫面在後續階段接上；這裡先固定規則，避免提早在 IME 組字時判錯。 */

import { hasKatakana, isHiragana, isKatakana, normalizeText } from './vocabulary.js';

const CHINESE_SPLIT = /[／/、;；|｜]+/u;
const KANA_SEPARATOR = /[\s\u3000・]+/gu;

function kanaBody(value) {
  return normalizeText(value).replace(KANA_SEPARATOR, '');
}

function kanaAnswer(value) {
  return normalizeText(value).replace(KANA_SEPARATOR, '・').replace(/^・+|・+$/g, '');
}

export function normalizeChinese(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/^[，,。．.！!？?、]+|[，,。．.！!？?、]+$/g, '');
}

export function acceptedChinese(expected) {
  const seen = new Set();
  const answers = [];
  String(expected ?? '').split(CHINESE_SPLIT).forEach((part) => {
    const text = normalizeChinese(part);
    if (!text || seen.has(text)) return;
    seen.add(text);
    answers.push(text);
  });
  return answers;
}

export function judgeAnswer(raw, expected, { composing = false, script = 'hiragana' } = {}) {
  if (composing) return { status: 'pending' };
  const input = normalizeText(raw);
  if (!input) return { status: 'empty' };
  if (script === 'zh') {
    const given = normalizeChinese(input);
    if (!given) return { status: 'empty' };
    if (acceptedChinese(expected).includes(given)) return { status: 'correct' };
    return { status: 'incorrect' };
  }
  if (script === 'katakana') {
    if (!isKatakana(kanaBody(input))) return { status: 'invalid', message: 'カタカナで' };
    if (kanaAnswer(input) === kanaAnswer(expected)) return { status: 'correct' };
    return { status: 'incorrect' };
  }
  if (hasKatakana(kanaBody(input))) {
    return { status: 'katakana', message: 'ひらがなで' };
  }
  if (!isHiragana(kanaBody(input))) {
    return { status: 'invalid', message: 'ひらがなで' };
  }
  if (kanaAnswer(input) === kanaAnswer(expected)) return { status: 'correct' };
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
