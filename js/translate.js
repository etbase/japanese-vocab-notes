/** 日文譯成繁體中文。使用 MyMemory 免費額度，不帶 API key，也不使用付費方案。 */

import { toTraditional } from './traditional.js';

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const HAN = /\p{Script=Han}/u;

export function needsChinese(word) {
  return Boolean(String(word?.kanji || '').trim()) && !String(word?.translation || '').trim();
}

export function readMyMemory(data, source) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'failed' };
  const status = Number(data.responseStatus);
  const translated = String(data.responseData?.translatedText || '').trim();
  const details = String(data.responseDetails || '');
  const warning = `${translated}\n${details}`;
  if (data.quotaFinished || status === 429 || /USED ALL AVAILABLE FREE TRANSLATIONS/i.test(warning)) {
    return { ok: false, reason: 'quota' };
  }
  if (/MYMEMORY WARNING/i.test(warning) || (status && status !== 200)) {
    return { ok: false, reason: 'failed' };
  }
  const text = toTraditional(translated).trim();
  if (!text || isUnusableEcho(text, source)) return { ok: false, reason: 'failed' };
  return { ok: true, text: text.slice(0, 80) };
}

function isUnusableEcho(text, source) {
  const translated = text.normalize('NFKC');
  const original = String(source || '').normalize('NFKC').trim();
  if (translated !== original) return false;
  return !HAN.test(translated);
}

export async function translateJapanese(text) {
  const source = String(text || '').trim();
  if (!source) return { ok: false, reason: 'empty' };
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', source);
  url.searchParams.set('langpair', 'ja|zh-TW');
  let response;
  try {
    response = await fetch(url);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (response.status === 429) return { ok: false, reason: 'quota' };
  try {
    return readMyMemory(await response.json(), source);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
