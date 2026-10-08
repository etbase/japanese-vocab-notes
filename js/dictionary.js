/** 本地 JMdict / EDICT 查詢。只讀讀音與標明的語源，不查第三方 API。 */

const BUCKETS = 16;
const cache = new Map();
const loading = new Map();

const LANGUAGE_NAMES = {
  eng: 'English',
  ger: 'German',
  dut: 'Dutch',
  por: 'Portuguese',
  fre: 'French',
  spa: 'Spanish',
  ita: 'Italian',
  lat: 'Latin',
  gre: 'Greek',
  rus: 'Russian',
  ara: 'Arabic',
  chi: 'Chinese',
  kor: 'Korean',
  san: 'Sanskrit',
  hin: 'Hindi',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  pol: 'Polish',
  hun: 'Hungarian',
  tur: 'Turkish',
  may: 'Malay',
  haw: 'Hawaiian',
  afr: 'Afrikaans',
  glg: 'Galician',
  rum: 'Romanian',
  cze: 'Czech',
  bul: 'Bulgarian',
  fin: 'Finnish',
  heb: 'Hebrew',
  per: 'Persian',
  vie: 'Vietnamese',
  tha: 'Thai',
  ind: 'Indonesian',
  tgl: 'Tagalog',
};

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

async function loadBucket(index) {
  if (cache.has(index)) return cache.get(index);
  if (loading.has(index)) return loading.get(index);
  const name = `b${String(index).padStart(2, '0')}.json`;
  const pending = fetch(new URL(`../data/dict/${name}`, import.meta.url))
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then((data) => {
      const bucket = data && typeof data === 'object' ? data : {};
      cache.set(index, bucket);
      loading.delete(index);
      return bucket;
    });
  loading.set(index, pending);
  return pending;
}

/**
 * 找不到時回傳 null。
 * translation 一律是空字串：這份資料沒有可授權的繁體中文。
 */
export async function lookupDictionary(text) {
  const key = compactKey(text);
  if (!key || key.length > 18) return null;
  const bucket = await loadBucket(bucketFor(key));
  const row = bucket[key];
  if (!Array.isArray(row)) return null;
  const reading = String(row[0] || '');
  const originWord = String(row[1] || '');
  const code = String(row[2] || '');
  if (!reading && !originWord) return null;
  return {
    reading,
    originWord,
    originLanguage: originWord ? (LANGUAGE_NAMES[code] || code) : '',
    translation: '',
  };
}
