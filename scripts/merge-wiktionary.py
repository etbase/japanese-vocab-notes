"""把日文維基詞典的繁體中文對譯，以及寫明的外來語語源，併入 data/dict。

來源是 kaikki.org 的 jawiktionary 擷取檔（CC BY-SA / GFDL）。
沒有對譯或語源的詞保持空白，不把片假名轉成羅馬字。
"""
import gzip
import json
import re
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
DICT = ROOT / 'data' / 'dict'
BUCKETS = 16
TRAD = OpenCC('s2twp')
HAN_RE = re.compile(r'[\u4e00-\u9fff]')
SOURCE_RE = re.compile(
    r'(英語|ドイツ語|オランダ語|ポルトガル語|フランス語|スペイン語|イタリア語|ラテン語|ギリシア語|ギリシャ語|中国語|朝鮮語|韓国語|ロシア語|アラビア語|德語|葡萄牙語|荷蘭語|法語|西班牙語|意大利語|拉丁語)\s+'
    r"([A-Za-zÀ-ÖØ-öø-ÿĀ-žŒœÆæßðþĐđŁłØø'’\-]+)"
)
LANG_CODE = {
    '英語': 'eng',
    'ドイツ語': 'ger',
    'オランダ語': 'dut',
    'ポルトガル語': 'por',
    'フランス語': 'fre',
    'スペイン語': 'spa',
    'イタリア語': 'ita',
    'ラテン語': 'lat',
    'ギリシア語': 'gre',
    'ギリシャ語': 'gre',
    '中国語': 'chi',
    '朝鮮語': 'kor',
    '韓国語': 'kor',
    'ロシア語': 'rus',
    'アラビア語': 'ara',
    '德語': 'ger',
    '葡萄牙語': 'por',
    '荷蘭語': 'dut',
    '法語': 'fre',
    '西班牙語': 'spa',
    '意大利語': 'ita',
    '拉丁語': 'lat',
}
ISO_CODE = {
    'en': 'eng', 'de': 'ger', 'nl': 'dut', 'pt': 'por', 'fr': 'fre',
    'es': 'spa', 'it': 'ita', 'la': 'lat', 'el': 'gre', 'ru': 'rus',
    'ar': 'ara', 'zh': 'chi', 'ko': 'kor',
}
SEE_RE = re.compile(r'([ぁ-んー]{2,}) ?参照')


def compact_key(value):
    return str(value or '').strip().replace('・', '').replace('･', '').replace(' ', '')


def bucket_for(key):
    hash_value = 2166136261
    for char in key:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value % BUCKETS


def to_trad(text):
    return TRAD.convert(str(text or '')).strip()


def unique(items):
    seen = set()
    result = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def choose_glosses(words):
    cleaned = []
    for word in words:
        text = to_trad(word)
        text = re.sub(r'\s+', '', text)
        if not text or not HAN_RE.search(text) or len(text) > 20:
            continue
        cleaned.append(text)
    cleaned = unique(cleaned)
    longer = [word for word in cleaned if len(word) > 1]
    chosen = longer or cleaned
    return '、'.join(chosen[:3])[:40]


def gloss_from_translations(translations):
    words = []
    for item in translations or []:
        if item.get('lang_code') not in ('zh', 'cmn'):
            continue
        word = item.get('word') or ''
        if HAN_RE.search(word):
            words.append(word)
    return choose_glosses(words)


def gloss_from_senses(senses):
    """只取第一個義項的第一個短語，避免把整段詞典說明貼進筆記本。"""
    for sense in senses or []:
        for gloss in sense.get('glosses') or []:
            if re.search(r'[ぁ-んァ-ン]', gloss):
                continue
            text = re.sub(r'（[^）]*）', '', gloss)
            text = re.sub(r'\([^)]*\)', '', text).split('\n')[0].strip('。．. ')
            clauses = [part.strip() for part in re.split(r'[，,、；;]', text) if part.strip()]
            chosen = [part for part in clauses if HAN_RE.search(part) and 2 <= len(to_trad(part)) <= 8]
            if chosen:
                return choose_glosses(chosen[:1])
        break
    return ''


def simplified_form(forms):
    for form in forms or []:
        if 'Simplified-Chinese' in (form.get('tags') or []):
            text = form.get('form') or ''
            if HAN_RE.search(text):
                return choose_glosses([text])
    return ''


def kanji_forms(forms):
    result = []
    for form in forms or []:
        if 'kanji' in (form.get('tags') or []):
            result.append(form.get('form') or '')
    return result


def obscure(item):
    blob = json.dumps(item.get('senses') or [], ensure_ascii=False)
    categories = ' '.join(item.get('categories') or [])
    return '鉱物' in blob or '鉱物' in categories


def origin_from_text(text):
    if not text:
        return None
    best = None
    for match in SOURCE_RE.finditer(text):
        word = match.group(2).strip("-'’")
        if len(word) < 2:
            continue
        before = text[max(0, match.start() - 16):match.start()]
        after = text[match.end():match.end() + 12]
        score = 0
        if '借用語' in after or '借用' in before or '借自' in before or '借' in before:
            score += 3
        if '音写' in after:
            score += 2
        if 'から' in after or '由来' in after:
            score += 1
        if '表記' in before:
            score -= 3
        if best is None or score > best[0]:
            best = (score, word, LANG_CODE[match.group(1)])
    if not best or best[0] < 0:
        return None
    return best[1], best[2]


def origin_from_templates(templates):
    for template in templates or []:
        name = template.get('name') or ''
        if name in ('wasei', 'ja-r', 'm', 'l'):
            continue
        if name not in ('bor', 'der', 'inh', 'borrowed', 'derived', 'cog'):
            continue
        args = template.get('args') or {}
        word = args.get('3') or args.get('4') or ''
        lang = args.get('2') or ''
        if not word or not ISO_CODE.get(lang):
            continue
        if re.fullmatch(r'[ぁ-んァ-ンー]+', word):
            continue
        return word, ISO_CODE[lang]
    return None


def remember(store, key, translation='', origin='', lang=''):
    key = compact_key(key)
    if not key or len(key) > 18 or re.fullmatch(r'[\dA-Za-z._-]+', key):
        return
    current = store.setdefault(key, {'translation': '', 'origin': '', 'lang': ''})
    if translation and (not current['translation'] or (len(current['translation']) == 1 and 1 < len(translation) <= 8)):
        current['translation'] = translation
    if origin and not current['origin']:
        current['origin'] = origin
        current['lang'] = lang


def absorb(store, refs, item, from_chinese_wiki=False):
    form_gloss = simplified_form(item.get('forms'))
    if form_gloss and not from_chinese_wiki and item.get('lang_code') not in ('ja', None):
        remember(store, item.get('word'), form_gloss)
        return
    if item.get('lang_code') not in ('ja', None) and not from_chinese_wiki:
        return
    if from_chinese_wiki and item.get('lang_code') != 'ja':
        return
    word = item.get('word') or ''
    if obscure(item):
        return
    translation = gloss_from_translations(item.get('translations'))
    if not translation and from_chinese_wiki:
        translation = gloss_from_senses(item.get('senses'))
    if not translation:
        translation = simplified_form(item.get('forms'))
    origin = origin_from_templates(item.get('etymology_templates'))
    if not origin:
        texts = item.get('etymology_texts') or []
        origin = origin_from_text(' '.join(texts))
    origin_word, origin_lang = origin or ('', '')
    remember(store, word, translation, origin_word, origin_lang)
    for form in kanji_forms(item.get('forms')):
        remember(store, form, translation, origin_word, origin_lang)
    if not translation:
        for sense in item.get('senses') or []:
            for gloss in sense.get('glosses') or []:
                match = SEE_RE.search(gloss)
                if match:
                    refs.setdefault(word, match.group(1))


def read_jsonl(path, store, refs, from_chinese_wiki):
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as handle:
        for line in handle:
            if from_chinese_wiki and '"lang_code": "ja"' not in line and '"lang_code":"ja"' not in line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            absorb(store, refs, item, from_chinese_wiki)


def resolve_refs(store, refs):
    for word, target in list(refs.items()):
        source = store.get(compact_key(target))
        if source and source['translation']:
            remember(store, word, source['translation'], source['origin'], source['lang'])


def main():
    store = {}
    refs = {}
    ja_path = Path('/tmp/ja-extract.jsonl.gz')
    zh_path = Path('/tmp/zh-extract.jsonl.gz')
    if not ja_path.exists():
        raise SystemExit('缺少 /tmp/ja-extract.jsonl.gz')
    read_jsonl(ja_path, store, refs, False)
    resolve_refs(store, refs)
    if zh_path.exists() and zh_path.stat().st_size > 100_000_000:
        read_jsonl(zh_path, store, refs, True)
    resolve_refs(store, refs)

    buckets = []
    for index in range(BUCKETS):
        buckets.append(json.loads((DICT / f'b{index:02d}.json').read_text()))
    added_translation = 0
    added_origin = 0
    for key, extra in store.items():
        if not extra['translation'] and not extra['origin']:
            continue
        bucket = buckets[bucket_for(key)]
        row = list(bucket.get(key) or ['', '', ''])
        while len(row) < 3:
            row.append('')
        if extra['origin'] and not row[1]:
            row[1] = extra['origin']
            row[2] = extra['lang']
            added_origin += 1
        elif extra['origin'] and row[1] and extra['lang'] and extra['lang'] != row[2]:
            # 維基詞典寫明的傳入語優先於 EDICT 把英文放在前面的情形。
            row[1] = extra['origin']
            row[2] = extra['lang']
        if extra['translation']:
            if len(row) < 4 or not row[3]:
                added_translation += 1
            if len(row) < 4:
                row.append(extra['translation'])
            else:
                row[3] = extra['translation']
        bucket[key] = row
    for index, bucket in enumerate(buckets):
        (DICT / f'b{index:02d}.json').write_text(json.dumps(bucket, ensure_ascii=False, separators=(',', ':')))
    meta_path = DICT / 'meta.json'
    meta = json.loads(meta_path.read_text())
    meta.update({
        'translationSource': 'Japanese and Chinese Wiktionary via kaikki.org wiktextract',
        'translationLicense': 'CC BY-SA 3.0 and GFDL, same as Wiktionary',
        'translationUrl': 'https://ja.wiktionary.org/',
        'translations': added_translation,
        'wiktionaryOrigins': added_origin,
        'note': 'Chinese glosses are Traditional Chinese from Wiktionary. Simplified glosses are converted with OpenCC s2twp. Words without a gloss stay blank. Loanword origins come from explicit etymology, not from romanizing katakana.',
    })
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    print(f'translations {added_translation}, origins {added_origin}, wiktionary keys {len(store)}')


if __name__ == '__main__':
    main()
