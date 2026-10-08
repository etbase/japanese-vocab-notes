/**
 * 從 EDICT 抽出平假名讀音，以及標明語源的外來語。
 * 不收錄英文釋義，也不把羅馬字當成語源。
 *
 * 用法：node scripts/build-dict.mjs /path/to/edict.utf8
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const BUCKETS = 16;
const LANGS = new Set([
  'eng', 'ger', 'dut', 'por', 'fre', 'spa', 'ita', 'lat', 'gre', 'rus',
  'ara', 'chi', 'kor', 'san', 'hin', 'swe', 'nor', 'dan', 'pol', 'hun',
  'tur', 'may', 'haw', 'afr', 'glg', 'rum', 'cze', 'bul', 'fin', 'heb',
  'per', 'vie', 'tha', 'ind', 'tgl',
]);
const HIRAGANA_RE = /^[\u3041-\u3096\u309d\u309e\u30fc]+$/u;
const KANA_RE = /^[\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc\u30fd\u30fe・･]+$/u;

function compactKey(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/[・･\s]/g, '');
}

function bucketFor(key) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % BUCKETS;
}

function sourcesFrom(body) {
  const found = [];
  const pattern = /\(([a-z]{2,3}):\s*([^,)]*)/g;
  let match = pattern.exec(body);
  while (match) {
    const lang = match[1];
    const word = match[2].trim();
    if (word && lang !== 'wasei' && LANGS.has(lang)) {
      found.push({ lang, word: word.slice(0, 40) });
    }
    match = pattern.exec(body);
  }
  return found;
}

function consider(store, key, entry) {
  const id = compactKey(key);
  if (!id || id.length > 18 || /^[\dA-Za-z._-]+$/.test(id)) return;
  const reading = HIRAGANA_RE.test(entry.reading || '') ? entry.reading : '';
  const origin = entry.origin || '';
  const lang = origin ? entry.lang || '' : '';
  if (!reading && !origin) return;
  const next = { reading, origin, lang, priority: Boolean(entry.priority) };
  const prev = store.get(id);
  if (!prev) {
    store.set(id, next);
    return;
  }
  if (next.priority && !prev.priority) {
    store.set(id, next);
    return;
  }
  if (!next.priority && prev.priority) return;
  const score = (item) => (item.reading ? 1 : 0) + (item.origin ? 2 : 0);
  if (score(next) > score(prev)) store.set(id, next);
}

const source = resolve(process.argv[2] || '');
if (!source) {
  console.error('請提供 UTF-8 的 EDICT 檔案路徑');
  process.exit(1);
}

const store = new Map();
const lines = createInterface({ input: createReadStream(source, { encoding: 'utf8' }) });
for await (const line of lines) {
  if (!line || line.startsWith('　') || line.startsWith('#')) continue;
  const parsed = line.match(/^(.+?)(?: \[([^\]]+)\])? \/(.+)\/$/);
  if (!parsed) continue;
  const heads = parsed[1].split(';').map((part) => part.trim()).filter(Boolean);
  const reading = (parsed[2] || '').split(';')[0].trim();
  const sources = sourcesFrom(parsed[3]);
  const origin = sources[0] || null;
  const entry = {
    reading,
    origin: origin?.word || '',
    lang: origin?.lang || '',
    priority: parsed[3].includes('(P)'),
  };
  heads.forEach((head) => consider(store, head, entry));
  if (KANA_RE.test(reading) && entry.origin) consider(store, reading, entry);
}

const buckets = Array.from({ length: BUCKETS }, () => ({}));
let readings = 0;
let origins = 0;
store.forEach((entry, key) => {
  const row = [];
  row.push(entry.reading || '');
  if (entry.origin) {
    row.push(entry.origin, entry.lang || '');
    origins += 1;
  }
  if (entry.reading) readings += 1;
  buckets[bucketFor(key)][key] = row;
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../data/dict');
await mkdir(root, { recursive: true });
await Promise.all(buckets.map((bucket, index) => {
  const name = `b${String(index).padStart(2, '0')}.json`;
  return writeFile(resolve(root, name), JSON.stringify(bucket));
}));
await writeFile(resolve(root, 'meta.json'), `${JSON.stringify({
  source: 'JMdict / EDICT',
  publisher: 'Electronic Dictionary Research and Development Group',
  license: 'CC BY-SA 4.0',
  licenseScope: 'Japanese and English components. This build keeps hiragana readings and explicit loanword sources only.',
  url: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
  entries: store.size,
  readings,
  origins,
  note: 'English glosses are not stored. Traditional Chinese translations are not included. Empty loanword tags are not guessed.',
}, null, 2)}\n`);
console.log(`entries ${store.size}, readings ${readings}, origins ${origins}`);
