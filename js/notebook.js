/** 書架與筆記本內頁。使用者輸入一律以 textContent 寫入。 */

import { bindKanaInput, imeBlocks, settleKana, watchIme } from './kana-input.js';
import { lookupDictionary } from './dictionary.js';
import { judgeAnswer } from './practice.js';
import { PAGE_SIZE, isHiragana, notebookStats, pageCount, sortWords, spreadFor, wordsForPage } from './vocabulary.js';

export const COVER_COLORS = [
  { id: 'sage', label: 'セージ' },
  { id: 'milk', label: 'ミルクティー' },
  { id: 'blush', label: 'ピンク' },
  { id: 'lemon', label: 'レモン' },
  { id: 'sky', label: 'そら' },
  { id: 'lilac', label: 'ライラック' },
  { id: 'sand', label: 'サンド' },
  { id: 'mist', label: 'かすみ' },
];

const PEN_TOOLS = [
  { id: 'yellow', label: '黄色' },
  { id: 'pink', label: 'ピンク' },
  { id: 'green', label: '緑' },
  { id: 'erase', label: '消す' },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function penIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14.2 3.8l6 6-9.4 9.4H4.8v-6.1L14.2 3.8z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function inkVariant(id, field) {
  const text = `${id || 'row'}:${field || ''}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index) * (index + 1)) % 4;
  }
  return String(hash);
}

function fieldHighlight(word, field) {
  if (!word) return null;
  if (field === 'hiragana' || field === 'reading') {
    return word.highlightReading !== undefined ? word.highlightReading : (word.highlight || null);
  }
  return word.highlightKanji !== undefined ? word.highlightKanji : (word.highlight || null);
}

function markNode(text, highlight, fresh, ink) {
  if (!highlight || !text) return document.createTextNode(text || '');
  const mark = el('span', `mark mark-${highlight}${fresh ? ' is-fresh' : ''}`, text);
  mark.dataset.ink = ink || '0';
  return mark;
}

export function renderShelf(container, { notebooks, wordsByNotebook, onCreate, onEdit, onDelete, freshId }) {
  const section = el('section', 'shelf');
  section.setAttribute('aria-labelledby', 'shelf-title');

  const header = el('div', 'shelf-header');
  const headingWrap = el('div', 'shelf-heading');
  const title = el('h2', 'hand', 'わたしのノート');
  title.id = 'shelf-title';
  const lead = el('p', 'shelf-lead', 'カバーを開いて、単語を見返せます。');
  headingWrap.append(title, lead);
  header.append(headingWrap);
  if (notebooks.length) header.append(el('p', 'shelf-count', `${notebooks.length}冊`));
  section.append(header);

  if (!notebooks.length) {
    const empty = el('div', 'empty-shelf');
    empty.append(el('p', 'hand empty-title', 'まだノートがありません'));
    empty.append(el('p', 'empty-text', '最初の一冊をつくりましょう。'));
    section.append(empty);
  }

  const grid = el('div', 'shelf-grid');
  notebooks.forEach((notebook) => {
    grid.append(renderCover(notebook, wordsByNotebook.get(notebook.id) ?? [], { onEdit, onDelete, freshId }));
  });
  grid.append(renderNewCard(onCreate));
  section.append(grid);
  container.replaceChildren(section);
}

function notebookLabel(notebook, words) {
  const total = notebookStats(words).total;
  const kind = notebook?.type === 'katakana' ? 'カタカナ' : '漢字';
  return `${total}語・${kind}`;
}

function renderCover(notebook, words, { onEdit, onDelete, freshId }) {
  const label = notebookLabel(notebook, words);
  const card = el('article', 'notebook-card');
  if (freshId === notebook.id) card.classList.add('is-new');
  card.dataset.notebookId = notebook.id;

  const cover = el('div', 'cover');
  cover.dataset.color = notebook.color || 'sage';

  const link = el('a', 'cover-open');
  link.href = `#/n/${encodeURIComponent(notebook.id)}/p/1`;
  link.setAttribute('aria-label', `${notebook.title}、${label}。開く`);

  const plate = el('div', 'cover-plate');
  const title = el('h3', 'cover-title hand', notebook.title);
  plate.append(title);

  const meta = el('div', 'cover-meta');
  meta.append(el('p', 'cover-stats', label));

  link.append(plate, meta);
  cover.append(link);

  const actions = el('div', 'card-actions');
  const edit = el('button', 'text-button', '編集');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  edit.setAttribute('aria-label', `${notebook.title}を編集`);
  edit.addEventListener('click', () => onEdit(notebook));

  const remove = el('button', 'text-button text-button-quiet', '削除');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.setAttribute('aria-label', `${notebook.title}を削除`);
  remove.addEventListener('click', () => onDelete(notebook));
  actions.append(edit, remove);

  card.append(cover, actions);
  return card;
}

function renderNewCard(onCreate) {
  const card = el('article', 'notebook-card');
  const button = el('button', 'cover cover-new');
  button.type = 'button';
  button.id = 'add-notebook';
  button.append(el('span', 'cover-plus', '＋'), el('span', 'cover-new-label hand', '新しいノート'));
  button.addEventListener('click', onCreate);
  const spacer = el('div', 'card-actions');
  spacer.setAttribute('aria-hidden', 'true');
  card.append(button, spacer);
  return card;
}

function adjacentFocusPage(words, study, page, direction) {
  const total = pageCount(words);
  const ids = new Set(study?.wordIds || []);
  for (let next = page + direction; next >= 1 && next <= total; next += direction) {
    if (wordsForPage(words, next).some((word) => ids.has(word.id))) return next;
  }
  return 0;
}

export function renderNotebook(container, options) {
  const {
    notebook,
    words,
    totalWords,
    page,
    compact,
    turn,
    flashWordId,
    pen,
    study,
    answers,
    revealed,
    showResult,
    focusDraft,
    onStep,
    onHighlight,
    onTogglePen,
    onSelectPen,
    onDeleteWord,
    onEditLine,
    onAdvance,
    onInsertLine,
    onSaveNote,
    pageLimit,
    onStartPractice,
    onStartFocus,
    onExitStudy,
    onFinishPractice,
    onRetry,
    onReview,
    onFocusCorrect,
    onFocusWrong,
    onToggleLock,
  } = options;
  const studying = study?.kind === 'practice';
  const focusing = study?.kind === 'focus';
  const view = spreadFor(page, pageLimit || pageCount(words), { compact });
  closeLineMenus();

  const screen = el('section', 'notebook-screen');
  const toolbar = el('div', 'notebook-toolbar');
  const back = el('a', 'back-link', '← ノート一覧');
  back.href = '#/';

  const heading = el('div', 'notebook-heading');
  const title = el('h2', 'hand', notebook.title);
  title.id = 'notebook-title';
  title.tabIndex = -1;
  const summary = el('p', 'notebook-summary', notebookLabel(notebook, totalWords || words));
  heading.append(title, summary);
  const actions = el('div', 'toolbar-actions');
  actions.append(renderLock(notebook, onToggleLock), renderPen(pen, onTogglePen, onSelectPen));
  toolbar.append(back, heading, actions);
  if (pen?.active) screen.classList.add('is-pen-mode');

  const tools = el('div', 'notebook-tools');
  const translationButton = (disabled = false) => {
    const translation = el('button', notebook.showTranslation === false || disabled ? 'btn btn-ghost' : 'btn btn-ghost is-on', '翻訳');
    translation.type = 'button';
    translation.setAttribute('aria-pressed', disabled || notebook.showTranslation === false ? 'false' : 'true');
    if (disabled) {
      translation.disabled = true;
      translation.title = 'この練習では訳が答えです';
    } else {
      translation.addEventListener('click', () => options.onToggleTranslation?.());
    }
    return translation;
  };
  if (focusing || studying) {
    const backStudy = el('button', 'btn btn-ghost', 'ノートに戻る');
    backStudy.type = 'button';
    backStudy.addEventListener('click', onExitStudy);
    tools.append(backStudy);
    if (focusing && !study.finished) tools.append(translationButton(study.script === 'zh'));
    if (studying && !showResult) {
      const done = el('button', 'btn btn-primary', 'できた');
      done.type = 'button';
      done.addEventListener('click', onFinishPractice);
      tools.append(done);
    }
  } else {
    const translate = el('button', 'btn btn-ghost', '自動翻訳');
    translate.type = 'button';
    translate.disabled = notebook.locked !== false;
    translate.addEventListener('click', () => options.onTranslateMissing?.());
    const practice = el('button', 'btn btn-ghost', '練習する');
    practice.type = 'button';
    practice.addEventListener('click', onStartPractice);
    const focus = el('button', 'btn btn-ghost', '字卡練習');
    focus.type = 'button';
    focus.addEventListener('click', onStartFocus);
    const status = el('p', 'tool-status');
    status.id = 'tool-status';
    status.hidden = true;
    tools.append(translationButton(), translate, practice, focus, status);
  }

  const book = el('div', 'book');
  if (focusing) {
    book.append(study.finished
      ? renderFocusResult(study, { onRetry, onExitStudy })
      : renderFocusSession({
        study,
        notebook,
        pen,
        flashWordId,
        focusDraft,
        onFocusCorrect,
        onFocusWrong,
        onFocusDraft: options.onFocusDraft,
        onHighlight,
      }));
  } else {
    const spread = el('div', 'spread');
    if (turn === 'next') spread.classList.add('is-turning-next');
    if (turn === 'prev') spread.classList.add('is-turning-prev');
    view.pages.forEach((pageNumber, index) => {
      if (compact && index > 0) return;
      const side = index === 0 ? 'left' : 'right';
      spread.append(renderPage({
        notebook,
        words,
        pageNumber,
        side,
        showTitle: compact || side === 'left',
        flashWordId,
        pen,
        studying,
        answers,
        revealed,
        onHighlight,
        onDeleteWord,
        onEditLine,
        onEditGloss: options.onEditGloss,
        onAdvance,
        onInsertLine,
        onSaveNote,
        pageLimit,
        study,
      }));
    });
    book.append(spread);
  }

  const pager = el('div', 'pager');
  const prev = el('button', 'btn btn-ghost', '前のページ');
  prev.type = 'button';
  prev.dataset.pager = 'prev';
  const catalog = totalWords || words;
  const focusPaging = focusing && !study.finished;
  prev.disabled = focusPaging ? !adjacentFocusPage(catalog, study, page, -1) : !view.hasPrev;
  prev.addEventListener('click', () => onStep('prev'));

  const status = el('p', 'pager-status');
  const visible = view.pages.filter((pageNumber, index) => !(compact && index > 0));
  status.textContent = focusPaging
    ? String(page)
    : (visible.length > 1 ? `${visible[0]}–${visible[1]}` : String(visible[0]));
  status.setAttribute('aria-hidden', 'true');

  const next = el('button', 'btn btn-ghost', '次のページ');
  next.type = 'button';
  next.dataset.pager = 'next';
  next.disabled = focusPaging ? !adjacentFocusPage(catalog, study, page, 1) : !view.hasNext;
  next.addEventListener('click', () => onStep('next'));
  pager.append(prev, status, next);
  if (focusing && study.finished) pager.hidden = true;

  const visibleWords = view.pages
    .filter((pageNumber, index) => !(compact && index > 0))
    .flatMap((pageNumber) => wordsForPage(words, pageNumber));
  screen.append(toolbar, tools, book, pager);
  if (showResult && studying) {
    screen.append(renderPracticeResult(visibleWords, answers, { onRetry, onReview, onExitStudy }));
  }
  container.replaceChildren(screen);
  scheduleNotebookFit(screen);
  return view;
}

function lockIcon(locked) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', locked
    ? 'M8 11V8a4 4 0 0 1 8 0v3M7 11h10v8H7z'
    : 'M8 11V8a4 4 0 0 1 7.2-2.4M7 11h10v8H7z');
  svg.append(path);
  return svg;
}

function renderLock(notebook, onToggleLock) {
  const locked = notebook?.locked !== false;
  const button = el('button', 'lock-toggle');
  button.type = 'button';
  button.append(lockIcon(locked), el('span', 'visually-hidden', locked ? 'ロック中' : '編集可能'));
  button.title = locked ? 'ロック中' : '編集可能';
  button.setAttribute('aria-pressed', locked ? 'true' : 'false');
  button.setAttribute('aria-label', locked ? 'ロック中。編集できない' : '編集可能。ロックする');
  if (locked) button.classList.add('is-locked');
  button.addEventListener('click', () => onToggleLock?.());
  return button;
}

function renderPen(pen, onTogglePen, onSelectPen) {
  const wrap = el('div', 'pen-wrap');
  const button = el('button', 'pen-toggle');
  button.type = 'button';
  button.id = 'pen-toggle';
  button.append(penIcon(), el('span', 'visually-hidden', '蛍光ペン'));
  button.setAttribute('aria-pressed', pen?.active ? 'true' : 'false');
  button.setAttribute('aria-label', pen?.active ? '蛍光ペンを終了' : '蛍光ペン');
  if (pen?.active) button.classList.add('is-active');
  button.addEventListener('click', onTogglePen);
  wrap.append(button);
  if (pen?.active) {
    const palette = el('div', 'pen-palette');
    palette.setAttribute('role', 'group');
    palette.setAttribute('aria-label', '蛍光ペンの色');
    PEN_TOOLS.forEach((tool) => {
      const choice = el('button', 'pen-choice', tool.id === 'erase' ? '消す' : '');
      choice.type = 'button';
      choice.dataset.tool = tool.id;
      choice.setAttribute('aria-label', tool.label);
      choice.setAttribute('aria-pressed', pen.tool === tool.id ? 'true' : 'false');
      if (pen.tool === tool.id) choice.classList.add('is-selected');
      choice.addEventListener('click', () => onSelectPen(tool.id));
      palette.append(choice);
    });
    wrap.append(palette);
  }
  return wrap;
}

function renderPage(options) {
  const { notebook, words, pageNumber, side, showTitle, studying, pageLimit } = options;
  const page = el('article', `page page-${side}`);
  page.dataset.side = side;
  page.dataset.page = String(pageNumber);
  page.setAttribute('aria-label', `${pageNumber}ページ`);

  const head = el('div', 'page-head hand');
  if (showTitle) head.textContent = notebook.title;
  page.append(head);

  const list = el('ol', 'word-lines');
  const editable = !studying && pageNumber <= (pageLimit || pageCount(words));
  const sorted = sortWords(words);
  const pageWords = wordsForPage(words, pageNumber);
  for (let index = 0; index < PAGE_SIZE; index += 1) {
    const slot = (pageNumber - 1) * PAGE_SIZE + index;
    const word = studying ? pageWords[index] : (editable ? sorted[slot] || null : null);
    const line = el('li', 'word-line');
    if (studying) {
      line.classList.add('is-study');
      if (!word) line.setAttribute('aria-hidden', 'true');
      else line.append(renderWord(word, options));
    } else if (!editable) {
      line.setAttribute('aria-hidden', 'true');
    } else {
      line.classList.add('is-editable');
      if (notebook?.type === 'katakana') line.classList.add('is-katakana');
      if (word && (word.kanji || word.hiragana)) line.classList.add('has-word');
      line.dataset.slot = String(slot);
      if (word?.id) line.dataset.wordId = word.id;
      line.append(renderEditableWord(word, slot, options));
    }
    list.append(line);
  }
  page.append(list);
  page.append(el('p', 'page-number hand', String(pageNumber)));
  return page;
}

function renderWord(word, options) {
  const { flashWordId, pen, studying, answers, revealed, onHighlight, notebook, study } = options;
  const script = study?.script || (notebook?.type === 'katakana' ? 'katakana' : 'hiragana');
  const expected = script === 'zh' ? (word.translation || '') : (script === 'katakana' ? word.kanji : word.hiragana);
  const fragment = document.createDocumentFragment();
  const fresh = flashWordId === word.id;
  const kanji = el('span', 'word-kanji hand');
  kanji.translate = false;
  if (studying && (script === 'katakana' || script === 'zh')) {
    kanji.append(renderPracticePrompt(word, script));
  } else {
    kanji.append(markNode(word.kanji, fieldHighlight(word, 'kanji'), fresh, inkVariant(word.id, 'kanji')));
    bindPenTarget(kanji, word, pen, onHighlight, 'kanji');
  }

  const reading = el('span', 'word-reading hand');
  reading.translate = false;
  if (studying) {
    reading.append(renderAnswerField(word, answers, notebook, script));
  } else {
    reading.append(markNode(word.hiragana, fieldHighlight(word, 'reading'), fresh, inkVariant(word.id, 'reading')));
    bindPenTarget(reading, word, pen, onHighlight, 'reading');
  }

  fragment.append(kanji, reading);
  if (studying) fragment.append(renderAnswerTools(word, revealed, expected, script));
  return fragment;
}

function renderAnswerTools(word, revealed, expected, script) {
  const tools = el('div', 'answer-tools');
  if (revealed?.[word.id]) {
    tools.append(revealedLabel(expected, script));
    return tools;
  }
  const answer = el('button', 'text-button', '答え');
  answer.type = 'button';
  answer.addEventListener('mousedown', (event) => event.preventDefault());
  answer.addEventListener('click', () => showAnswer(answer.closest('.word-line'), revealed, word.id, expected, script));
  tools.append(answer);
  return tools;
}

function revealedLabel(expected, script) {
  const chinese = script === 'zh';
  const label = el('span', chinese ? 'revealed vocab-translation' : 'revealed hand', expected);
  if (chinese) label.lang = 'zh-Hant';
  label.title = expected;
  return label;
}

function renderPracticePrompt(word, script) {
  if (script === 'zh') {
    const prompt = el('span', 'hand', word?.kanji || '');
    prompt.translate = false;
    return prompt;
  }
  const block = el('span', 'practice-prompt');
  const meaning = el('span', 'practice-meaning vocab-translation', word?.translation || '');
  meaning.lang = 'zh-Hant';
  block.append(meaning);
  if (word?.originWord) block.append(el('span', 'practice-origin', word.originWord));
  return block;
}

function renderEditableWord(word, slot, options) {
  const katakana = options.notebook?.type === 'katakana';
  const fragment = document.createDocumentFragment();
  const kanji = buildPaperField(word, slot, 'kanji', options);
  const translation = buildGlossField(word, slot, 'translation', options);
  const third = katakana
    ? buildGlossField(word, slot, 'origin', options)
    : buildPaperField(word, slot, 'hiragana', options);
  if (katakana) fragment.append(kanji, translation, third, buildLineTools(word, slot, options));
  else fragment.append(kanji, third, translation, buildLineTools(word, slot, options));
  bindPaperLine(kanji, katakana ? null : third, slot, options);
  return fragment;
}

function buildPaperField(word, slot, field, options) {
  const { flashWordId, pen } = options;
  const katakana = options.notebook?.type === 'katakana';
  const value = field === 'kanji' ? (word?.kanji || '') : (word?.hiragana || '');
  const cell = el('span', field === 'kanji' ? 'word-kanji hand' : 'word-reading hand');
  cell.translate = false;
  const wrap = el('span', 'paper-field');
  const fresh = flashWordId && flashWordId === word?.id;
  const highlight = fieldHighlight(word, field);
  if (highlight && value) {
    wrap.classList.add('mark', `mark-${highlight}`);
    wrap.dataset.ink = inkVariant(word?.id, field);
    if (fresh) wrap.classList.add('is-fresh');
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'paper-input';
  input.lang = 'ja';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.autocorrect = 'off';
  input.enterKeyHint = 'next';
  input.maxLength = field === 'kanji' ? 40 : 80;
  input.dataset.field = field;
  input.value = value;
  const label = field === 'kanji'
    ? (katakana ? 'カタカナ' : '漢字・単語')
    : 'ひらがな';
  input.setAttribute('aria-label', `${slot + 1}行目の${label}`);
  if (pen?.active || options.notebook?.locked !== false) input.readOnly = true;
  if (field === 'hiragana') bindKanaInput(input, 'hiragana');
  else if (katakana) bindKanaInput(input, 'katakana');
  fitPaperInput(input);
  wrap.append(input);
  cell.append(wrap);
  if (field === 'hiragana') cell.append(buildReadingHint());
  cell.addEventListener('mousedown', (event) => {
    if (pen?.active || options.notebook?.locked !== false) {
      event.preventDefault();
      return;
    }
    if (event.target === input) return;
    event.preventDefault();
    input.focus();
  });
  cell.addEventListener('click', () => {
    if (!pen?.active || !pen.tool || !word?.id) return;
    options.onHighlight?.(word.id, pen.tool === 'erase' ? null : pen.tool, field);
  });
  return cell;
}

function buildGlossField(word, slot, field, options) {
  const cell = el('span', field === 'origin' ? 'line-origin' : 'line-gloss');
  const concealed = options.notebook?.showTranslation === false;
  if (concealed) {
    cell.classList.add('is-concealed');
    cell.setAttribute('aria-hidden', 'true');
  }
  const value = field === 'origin' ? (word?.originWord || '') : (word?.translation || '');
  const label = field === 'origin' ? '原文' : '中国語';
  const input = glossInput(value, label, field, field === 'origin' ? (word?.originLanguage || '') : '');
  if (concealed) input.tabIndex = -1;
  if (options.notebook?.locked !== false) {
    input.readOnly = true;
    input.addEventListener('mousedown', (event) => event.preventDefault());
  }
  if (field === 'translation') {
    cell.classList.add('has-gloss-view', 'vocab-translation');
    cell.lang = 'zh-Hant';
    cell.append(el('span', 'gloss-view'));
  }
  cell.append(input);
  bindGlossInput(input, slot, options);
  return cell;
}

function glossInput(value, label, field, language) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gloss-input hand';
  input.lang = field === 'origin' ? 'en' : 'zh-Hant';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.placeholder = '';
  input.maxLength = 80;
  input.dataset.field = field;
  input.value = value;
  input.title = value || language || '';
  input.setAttribute('aria-label', label);
  return input;
}

const KANJI_TEXT = /^[\u3400-\u9fff\uf900-\ufaff々〆]+$/u;

function buildReadingHint() {
  const hint = el('button', 'reading-suggest');
  hint.type = 'button';
  hint.hidden = true;
  hint.tabIndex = -1;
  return hint;
}

function bindGlossInput(input, slot, options) {
  const ime = watchIme(input);
  const emit = () => {
    if (ime.composing) return;
    options.onEditGloss?.({ slot, field: input.dataset.field, value: input.value });
  };
  input.addEventListener('compositionstart', () => {
    input.dataset.dirty = 'true';
  });
  input.addEventListener('compositionend', () => {
    input.dataset.dirty = 'true';
    input.title = input.value;
    fitGlossInput(input);
    setTimeout(emit, 0);
  });
  input.addEventListener('input', (event) => {
    input.dataset.dirty = 'true';
    input.title = input.value;
    fitGlossInput(input);
    if (ime.composing || event.isComposing) return;
    emit();
  });
  input.addEventListener('keydown', (event) => {
    if (imeBlocks(ime, event)) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    emit();
    focusNextField(input, slot);
  });
}

function focusNextField(input, slot) {
  const line = input.closest('.word-line');
  const order = ['kanji', 'hiragana', 'translation', 'origin'];
  const index = order.indexOf(input.dataset.field);
  for (let cursor = index + 1; cursor < order.length; cursor += 1) {
    const next = line?.querySelector(`[data-field="${order[cursor]}"]`);
    if (next instanceof HTMLElement && next.tabIndex !== -1 && !next.closest('.is-concealed')) {
      next.focus();
      return true;
    }
  }
  const nextKanji = document.querySelector(`[data-slot="${slot + 1}"] [data-field="kanji"]`);
  if (nextKanji) {
    nextKanji.focus();
    return true;
  }
  return false;
}

export function syncPaperLine(word) {
  if (!word?.id || typeof CSS === 'undefined') return;
  const line = document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`);
  if (!line) return;
  [
    ['hiragana', word.hiragana || ''],
    ['translation', word.translation || ''],
    ['origin', word.originWord || ''],
  ].forEach(([field, value]) => {
    const input = line.querySelector(`[data-field="${field}"]`);
    if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
    if (input.dataset.dirty === 'true' || input.value === value) return;
    input.value = value;
    if (input.classList.contains('gloss-input')) {
      input.title = value || input.title;
      fitGlossInput(input);
    } else fitPaperInput(input);
    if (field === 'origin' && word.originLanguage && !value) input.title = word.originLanguage;
  });
}

const measureCanvas = document.createElement('canvas');
let fontsReady = false;
let fontFitPending = false;

function fitPaperInput(input) {
  if (input.dataset.field === 'hiragana') {
    fitHiraganaInput(input);
    return;
  }
  const chars = Array.from(input.value).length;
  if (!chars) {
    const placeholder = Array.from(input.placeholder || '').length;
    input.style.width = `${Math.max(placeholder, 3)}em`;
    return;
  }
  const width = Math.ceil(measureWidth(input, input.value)) + fieldPadding(input);
  input.style.width = `${Math.max(width, 1)}px`;
  watchNotebookFonts();
}

function fieldPadding(input) {
  const style = getComputedStyle(input);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

function fitHiraganaInput(input) {
  const cell = input.closest('.word-reading');
  if (!cell?.isConnected) return;
  input.style.fontSize = '';
  const base = parseFloat(getComputedStyle(input).fontSize) || 22;
  const hint = cell.querySelector('.reading-suggest');
  const hintWidth = hint && !hint.hidden ? hint.getBoundingClientRect().width + 6 : 0;
  const limit = Math.max(0, cell.clientWidth - hintWidth);
  const available = Math.max(0, limit - fieldPadding(input));
  const text = input.value;
  if (!text || available <= 0) {
    if (!text) input.style.width = '3em';
    return;
  }
  const full = measureWidth(input, text, base);
  let size = base;
  if (full > available) size = Math.max(base * 0.75, Math.min(base, base * (available / full)));
  const fitted = measureWidth(input, text, size);
  if (fitted > available) size = base * 0.75;
  const drawn = measureWidth(input, text, size);
  input.style.fontSize = size < base - 0.2 ? `${size}px` : '';
  input.style.width = `${Math.max(1, Math.min(Math.ceil(drawn) + fieldPadding(input), limit))}px`;
  if (drawn > available + 1) input.title = text;
  else if (input.title === text) input.removeAttribute('title');
  watchNotebookFonts();
}

function fitGlossInput(input) {
  const view = input.closest('.line-gloss')?.querySelector('.gloss-view');
  if (!(view instanceof HTMLElement) || !view.isConnected) return;
  const text = input.value;
  const width = view.clientWidth || input.closest('.line-gloss')?.clientWidth || 0;
  if (width <= 0) return;
  const base = parseFloat(getComputedStyle(view).fontSize) || 15;
  let size = base;
  let layout = layoutGloss(text, width, size, view);
  if (!layout.fits && text) {
    let low = base * 0.75;
    let high = base;
    let best = layoutGloss(text, width, low, view);
    if (best.fits) {
      for (let step = 0; step < 6; step += 1) {
        const mid = (low + high) / 2;
        const trial = layoutGloss(text, width, mid, view);
        if (trial.fits) {
          best = trial;
          low = mid;
        } else {
          high = mid;
        }
      }
      size = low;
      layout = best;
    } else {
      size = low;
      layout = best;
    }
  }
  view.style.fontSize = size < base - 0.2 ? `${size}px` : '';
  view.replaceChildren(...layout.lines.map((line) => {
    const span = el('span', 'gloss-line', line);
    return span;
  }));
  if (!layout.fits && text) view.title = text;
  else view.removeAttribute('title');
  watchNotebookFonts();
}

function layoutGloss(text, width, size, sample) {
  if (!text) return { lines: [], fits: true };
  if (measureWidth(sample, text, size) <= width) return { lines: [text], fits: true };
  const parts = glossParts(text);
  if (parts.length > 1) {
    let chosen = null;
    let chosenOverflow = Infinity;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const left = parts.slice(0, index + 1).join('');
      const right = parts.slice(index + 1).join('');
      const overflow = Math.max(0, measureWidth(sample, left, size) - width)
        + Math.max(0, measureWidth(sample, right, size) - width);
      if (overflow === 0) return { lines: [left, right], fits: true };
      if (overflow < chosenOverflow) {
        chosen = [left, right];
        chosenOverflow = overflow;
      }
    }
    if (chosen) return { lines: chosen, fits: false };
  }
  const chars = [...text];
  const cut = largestPrefix(chars, width, size, sample);
  if (cut > 0 && cut < chars.length) {
    const left = chars.slice(0, cut).join('');
    const right = chars.slice(cut).join('');
    return {
      lines: [left, right],
      fits: measureWidth(sample, left, size) <= width + 0.5 && measureWidth(sample, right, size) <= width + 0.5,
    };
  }
  return { lines: [text], fits: false };
}

function glossParts(text) {
  const primary = splitKeeping(text, '、');
  if (primary.length > 1) return primary;
  return splitKeeping(text, /[，,；;]/u);
}

function splitKeeping(text, delimiter) {
  const parts = [];
  let buffer = '';
  for (const char of text) {
    buffer += char;
    if (typeof delimiter === 'string' ? char === delimiter : delimiter.test(char)) {
      parts.push(buffer);
      buffer = '';
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

function largestPrefix(chars, width, size, sample) {
  let low = 1;
  let high = chars.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (measureWidth(sample, chars.slice(0, mid).join(''), size) <= width) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function measureWidth(sample, text, size) {
  const style = getComputedStyle(sample);
  const context = measureCanvas.getContext('2d');
  context.font = size
    ? `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`
    : style.font;
  return context.measureText(text).width;
}

function watchNotebookFonts() {
  if (fontsReady || fontFitPending || !document.fonts?.ready) return;
  fontFitPending = true;
  document.fonts.ready.then(() => {
    fontsReady = true;
    fontFitPending = false;
    scheduleNotebookFit();
  });
}

let notebookFitFrame = 0;

function scheduleNotebookFit(root = document) {
  cancelAnimationFrame(notebookFitFrame);
  notebookFitFrame = requestAnimationFrame(() => fitNotebookFields(root));
}

function fitNotebookFields(root) {
  root.querySelectorAll('.paper-input').forEach((input) => {
    if (input instanceof HTMLInputElement) fitPaperInput(input);
  });
  root.querySelectorAll('.line-gloss .gloss-input').forEach((input) => {
    if (input instanceof HTMLInputElement) fitGlossInput(input);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => scheduleNotebookFit());
}

function updateReadingHint(input) {
  if (input?.dataset?.field !== 'hiragana') return;
  const hint = input.closest('.word-reading')?.querySelector('.reading-suggest');
  if (!hint) return;
  const text = input.value.trim();
  if (!KANJI_TEXT.test(text)) {
    hint.hidden = true;
    hint.textContent = '';
    hint.classList.remove('is-prompt');
    return;
  }
  input.title = 'ひらがなで入力';
  const token = String(Number(input.dataset.hintToken || 0) + 1);
  input.dataset.hintToken = token;
  lookupDictionary(text).then((result) => {
    if (input.dataset.hintToken !== token || input.value.trim() !== text) return;
    hint.hidden = false;
    if (result?.reading && isHiragana(result.reading)) {
      hint.classList.remove('is-prompt');
      hint.textContent = result.reading;
      hint.title = 'この読みを入れる';
      hint.setAttribute('aria-label', `読みの候補 ${result.reading}`);
      return;
    }
    hint.classList.add('is-prompt');
    hint.textContent = 'ひらがなで';
    hint.title = 'ひらがなで入力';
    hint.setAttribute('aria-label', 'ひらがなで入力');
  });
}

function bindPaperLine(kanjiCell, readingCell, slot, options) {
  const kanji = kanjiCell.querySelector('input');
  const reading = readingCell?.querySelector('input') || null;
  const imes = new Map();
  [kanji, reading].filter(Boolean).forEach((input) => imes.set(input, watchIme(input)));
  const emit = (lookup) => {
    if ([...imes.values()].some((state) => state.composing)) return;
    options.onEditLine?.({
      slot,
      kanji: kanji.value,
      hiragana: reading ? reading.value : '',
      lookup: Boolean(lookup),
    });
  };
  const afterIme = (input) => {
    settleKana(input);
    fitPaperInput(input);
    updateReadingHint(input);
    emit(false);
  };
  const hint = readingCell?.querySelector('.reading-suggest');
  if (hint && reading) {
    hint.addEventListener('mousedown', (event) => event.preventDefault());
    hint.addEventListener('click', () => {
      const suggested = hint.textContent.trim();
      if (hint.classList.contains('is-prompt') || !isHiragana(suggested)) return;
      reading.value = suggested;
      hint.hidden = true;
      fitPaperInput(reading);
      reading.focus();
      emit(false);
    });
  }
  [kanji, reading].filter(Boolean).forEach((input) => {
    const ime = imes.get(input);
    input.addEventListener('compositionend', () => {
      setTimeout(() => afterIme(input), 0);
    });
    input.addEventListener('input', (event) => {
      if (!ime.composing && !event.isComposing) settleKana(input);
      fitPaperInput(input);
      const line = input.closest('.word-line');
      const hasText = kanji.value.trim() || (reading?.value.trim() || '');
      line?.classList.toggle('has-word', Boolean(hasText) || Boolean(line?.dataset.wordId));
      if (ime.composing || event.isComposing) return;
      updateReadingHint(input);
      emit(false);
    });
    input.addEventListener('blur', () => {
      if (ime.composing || input.dataset.field !== 'kanji') return;
      emit(true);
    });
    input.addEventListener('keydown', (event) => {
      if (options.pen?.active) return;
      if (imeBlocks(ime, event)) return;
      if (event.key !== 'Enter') return;
      event.preventDefault();
      emit(input.dataset.field === 'kanji');
      const moved = focusNextField(input, slot);
      if (moved) return;
      const line = input.closest('.word-line');
      const hasText = kanji.value.trim() || (reading?.value.trim() || '') || line?.dataset.wordId;
      if (hasText) options.onAdvance?.(slot + 1);
    });
  });
}

function buildLineTools(word, slot, options) {
  const tools = el('div', 'line-tools');
  const noteSlot = el('span', 'note-slot');
  if (word?.note) noteSlot.append(buildNoteDot(word.note));
  tools.append(noteSlot);
  if (options.notebook?.locked !== false) return tools;
  const more = el('button', 'row-more', '⋯');
  more.type = 'button';
  more.tabIndex = -1;
  more.setAttribute('aria-label', '行の操作');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('mousedown', (event) => event.stopPropagation());
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleRowMenu(more, slot, options);
  });
  tools.append(more);
  return tools;
}

export function syncNoteDot(slot, note) {
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const slotNode = line?.querySelector('.note-slot');
  if (!slotNode) return;
  const text = String(note || '');
  const dot = slotNode.querySelector('.note-dot');
  if (!text.trim()) {
    dot?.remove();
    return;
  }
  if (!dot) {
    slotNode.append(buildNoteDot(text));
    return;
  }
  dot.dataset.note = text;
}

function buildNoteDot(note) {
  const dot = el('button', 'note-dot');
  dot.type = 'button';
  dot.tabIndex = -1;
  dot.setAttribute('aria-label', 'メモを見る');
  dot.dataset.note = note;
  dot.addEventListener('mousedown', (event) => event.stopPropagation());
  dot.addEventListener('mouseenter', () => showNoteTip(dot));
  dot.addEventListener('mouseleave', () => {
    if (!dot.classList.contains('is-pinned')) hideNoteTip();
  });
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    if (document.querySelector('.note-tip')) {
      hideNoteTip();
      dot.classList.remove('is-pinned');
      return;
    }
    dot.classList.add('is-pinned');
    showNoteTip(dot);
  });
  return dot;
}

function showNoteTip(dot) {
  hideNoteTip();
  const tip = el('div', 'note-tip', dot.dataset.note || '');
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  const rect = dot.getBoundingClientRect();
  tip.style.top = `${rect.bottom + 6}px`;
  tip.style.left = `${Math.max(8, rect.left - 8)}px`;
}

function hideNoteTip() {
  document.querySelectorAll('.note-tip').forEach((node) => node.remove());
}

function toggleRowMenu(button, slot, options) {
  const open = button.getAttribute('aria-expanded') === 'true';
  closeLineMenus();
  if (open) return;
  button.setAttribute('aria-expanded', 'true');
  const menu = el('div', 'row-popover');
  menu.setAttribute('role', 'menu');
  const remove = menuButton('この行を削除', () => options.onDeleteWord?.(slot));
  const insert = menuButton('下に行を追加', () => options.onInsertLine?.(slot));
  const note = menuButton('メモを編集', () => openNotePopover(button, slot, options));
  menu.append(remove, insert, note);
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  const width = 196;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 150)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
}

function menuButton(label, action) {
  const button = el('button', 'row-popover-item', label);
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    closeLineMenus();
    action();
  });
  return button;
}

export function closeLineMenus() {
  document.querySelectorAll('.note-popover').forEach((node) => {
    if (typeof node.saveNote === 'function') node.saveNote();
    node.remove();
  });
  document.querySelectorAll('.row-popover, .lookup-popover, .note-tip').forEach((node) => node.remove());
  document.querySelectorAll('.row-more[aria-expanded="true"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.note-dot.is-pinned').forEach((dot) => dot.classList.remove('is-pinned'));
}

function openNotePopover(anchor, slot, options) {
  closeLineMenus();
  const line = document.querySelector(`[data-slot="${slot}"]`);
  const pop = el('div', 'note-popover');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'メモ');
  const label = el('label', 'note-popover-label', 'メモ');
  const area = document.createElement('textarea');
  area.className = 'note-popover-input';
  area.lang = 'ja';
  area.rows = 3;
  area.maxLength = 500;
  area.autocomplete = 'off';
  area.spellcheck = false;
  area.value = line?.querySelector('.note-dot')?.dataset.note || '';
  label.append(area);
  pop.append(label);
  let composing = false;
  let timer = 0;
  const save = () => {
    if (composing) return;
    options.onSaveNote?.({ slot, note: area.value });
  };
  pop.saveNote = save;
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 180)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 236))}px`;
  area.addEventListener('compositionstart', () => {
    composing = true;
  });
  area.addEventListener('compositionend', () => {
    composing = false;
    save();
  });
  area.addEventListener('input', (event) => {
    if (composing || event.isComposing) return;
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      save();
      pop.remove();
    }
  });
  area.focus();
}

function bindPenTarget(node, word, pen, onHighlight, field) {
  node.addEventListener('click', () => {
    if (!pen?.active || !pen.tool) return;
    if (window.getSelection?.()?.toString()) return;
    onHighlight(word.id, pen.tool === 'erase' ? null : pen.tool, field);
  });
}

function renderAnswerField(word, answers, notebook, script) {
  const answerScript = script || (notebook?.type === 'katakana' ? 'katakana' : 'hiragana');
  const expected = answerScript === 'zh'
    ? (word.translation || '')
    : (answerScript === 'katakana' ? word.kanji : word.hiragana);
  const saved = answers?.[word.id];
  const field = el('span', 'answer-field');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reading-input';
  input.lang = answerScript === 'zh' ? 'zh-Hant' : 'ja';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', answerScript === 'zh' ? '中国語' : (answerScript === 'katakana' ? 'カタカナ' : `${word.kanji}のひらがな`));
  input.dataset.wordInput = word.id;
  if (answerScript !== 'zh') bindKanaInput(input, answerScript);
  if (saved?.value) input.value = saved.value;
  const judge = el('span', 'judge');
  judge.setAttribute('aria-live', 'polite');
  field.append(input, judge);
  bindAnswerInput(input, judge, word, answers, { expected, script: answerScript });
  if (saved?.status) paintJudgement(input, judge, { status: saved.status, message: saved.message || '' });
  return field;
}

function bindAnswerInput(input, judge, word, answers, { expected, script }) {
  const ime = watchIme(input);
  let timer = 0;
  const run = (commit = false) => {
    if (ime.composing) return;
    settleKana(input);
    if (!commit && /[A-Za-z]/.test(input.value)) return;
    const result = judgeAnswer(input.value, expected, { composing: false, script });
    paintJudgement(input, judge, result);
    if (answers) {
      answers[word.id] = {
        value: input.value,
        status: result.status === 'empty' ? '' : result.status,
        message: result.message || '',
      };
    }
  };
  input.addEventListener('compositionstart', () => {
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
  });
  input.addEventListener('compositionend', () => {
    clearTimeout(timer);
    setTimeout(run, 0);
  });
  input.addEventListener('input', (event) => {
    if (ime.composing || event.isComposing) return;
    settleKana(input);
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
    timer = setTimeout(run, 350);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || imeBlocks(ime, event)) return;
    event.preventDefault();
    clearTimeout(timer);
    run(true);
  });
}

function paintJudgement(input, judge, result) {
  input.classList.remove('is-correct', 'is-incorrect');
  judge.classList.remove('is-correct', 'is-incorrect');
  if (result.status === 'correct') {
    input.classList.add('is-correct');
    judge.classList.add('is-correct');
    judge.textContent = '✓';
    return;
  }
  if (result.status === 'incorrect' || result.status === 'katakana' || result.status === 'invalid') {
    input.classList.add('is-incorrect');
    judge.classList.add('is-incorrect');
    judge.textContent = result.status === 'incorrect' ? '✕' : `✕ ${result.message || 'ひらがなで'}`;
    return;
  }
  judge.textContent = '';
}

function showAnswer(line, revealed, wordId, expected, script) {
  const tools = line?.querySelector('.answer-tools');
  if (!tools || tools.querySelector('.revealed')) return;
  tools.replaceChildren(revealedLabel(expected, script));
  if (revealed) revealed[wordId] = true;
}

function renderPracticeResult(words, answers, { onRetry, onReview, onExitStudy }) {
  const total = words.length;
  const correct = words.filter((word) => answers?.[word.id]?.status === 'correct').length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  const panel = el('section', 'result-panel');
  panel.append(el('p', 'result-line hand', `${total}問中 ${correct}問正解`));
  panel.append(el('p', 'result-line', `正答率 ${percent}%`));
  const actions = el('div', 'modal-actions');
  const again = el('button', 'btn btn-primary', 'もう一度');
  again.type = 'button';
  again.addEventListener('click', onRetry);
  const review = el('button', 'btn btn-ghost', '間違えた単語を復習');
  review.type = 'button';
  review.disabled = correct >= total;
  review.addEventListener('click', onReview);
  const back = el('button', 'btn btn-ghost', 'ノートに戻る');
  back.type = 'button';
  back.addEventListener('click', onExitStudy);
  actions.append(again, review, back);
  panel.append(actions);
  return panel;
}

function renderFocusSession({
  study,
  notebook,
  pen,
  flashWordId,
  focusDraft,
  onFocusCorrect,
  onFocusWrong,
  onFocusDraft,
  onHighlight,
}) {
  const wordId = study.wordIds[study.index];
  const word = study.wordsById[wordId];
  const script = study.script === 'zh' || study.script === 'katakana' ? study.script : 'hiragana';
  const expected = script === 'zh' ? (word?.translation || '') : (script === 'katakana' ? (word?.kanji || '') : (word?.hiragana || ''));
  const sheet = el('article', 'page focus-sheet');
  sheet.append(el('p', 'focus-count', `${study.index + 1} / ${study.wordIds.length}`));
  const kanji = el('div', 'focus-kanji hand');
  kanji.translate = false;
  const prompt = el('span', 'focus-prompt');
  const kanjiMark = fieldHighlight(word, 'kanji');
  const readingMark = fieldHighlight(word, 'reading');
  const shownMark = kanjiMark || readingMark;
  const markField = kanjiMark || !readingMark ? 'kanji' : 'reading';
  if (shownMark) {
    prompt.classList.add('mark', `mark-${shownMark}`);
    prompt.dataset.ink = inkVariant(word?.id, markField);
    if (flashWordId && flashWordId === word?.id) prompt.classList.add('is-fresh');
  }
  if (script === 'hiragana') prompt.textContent = word?.kanji || '';
  else prompt.append(renderPracticePrompt(word, script));
  prompt.addEventListener('click', () => {
    if (!pen?.active || !pen.tool || !word?.id) return;
    onHighlight?.(word.id, pen.tool === 'erase' ? null : pen.tool, markField);
  });
  kanji.append(prompt);
  if (script === 'hiragana') {
    const gloss = el('p', 'focus-gloss vocab-translation', word?.translation || '');
    gloss.lang = 'zh-Hant';
    if (notebook?.showTranslation === false) gloss.classList.add('is-concealed');
    kanji.append(gloss);
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reading-input focus-input';
  input.lang = script === 'zh' ? 'zh-Hant' : 'ja';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', script === 'zh' ? '中国語' : (script === 'katakana' ? 'カタカナ' : `${word?.kanji || ''}のひらがな`));
  input.dataset.focusInput = 'true';
  if (script !== 'zh') bindKanaInput(input, script);
  input.value = focusDraft || '';
  const judge = el('span', 'judge');
  judge.setAttribute('aria-live', 'polite');
  const field = el('div', 'focus-field');
  const entry = el('div', 'answer-field');
  entry.append(input);
  const answer = el('p', 'focus-expected');
  answer.id = 'focus-expected';
  answer.hidden = true;
  const answerText = el('span', script === 'zh' ? 'vocab-translation' : 'hand', expected);
  if (script === 'zh') answerText.lang = 'zh-Hant';
  answer.append(document.createTextNode('正解：'), answerText);
  const reveal = el('button', 'btn focus-reveal', '答えを見る');
  reveal.type = 'button';
  reveal.setAttribute('aria-expanded', 'false');
  reveal.setAttribute('aria-controls', 'focus-expected');
  reveal.addEventListener('mousedown', (event) => event.preventDefault());
  reveal.addEventListener('click', () => {
    const open = answer.hidden;
    answer.hidden = !open;
    reveal.textContent = open ? '答えを隠す' : '答えを見る';
    reveal.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  field.append(entry, reveal, answer, judge);
  sheet.append(kanji, field);
  bindFocusInput(input, judge, { expected, script }, { onFocusCorrect, onFocusWrong, onFocusDraft });
  queueMicrotask(() => input.focus({ focusVisible: false }));
  return sheet;
}

function bindFocusInput(input, judge, { expected, script }, { onFocusCorrect, onFocusWrong, onFocusDraft }) {
  const ime = watchIme(input);
  let timer = 0;
  let lastValue = '';
  const run = (commit = false) => {
    if (ime.composing) return;
    settleKana(input);
    if (!commit && /[A-Za-z]/.test(input.value)) return;
    const result = judgeAnswer(input.value, expected, { composing: false, script });
    if (result.status === 'empty') {
      paintJudgement(input, judge, result);
      lastValue = '';
      return;
    }
    if (result.status === 'correct') {
      paintJudgement(input, judge, result);
      onFocusCorrect(input.value);
      return;
    }
    if (input.value === lastValue) return;
    lastValue = input.value;
    paintJudgement(input, judge, result);
    onFocusWrong(input.value);
  };
  input.addEventListener('compositionstart', () => {
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
  });
  input.addEventListener('compositionend', () => {
    clearTimeout(timer);
    setTimeout(run, 0);
  });
  input.addEventListener('input', (event) => {
    if (ime.composing || event.isComposing) return;
    settleKana(input);
    onFocusDraft?.(input.value);
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
    timer = setTimeout(run, 350);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || imeBlocks(ime, event)) return;
    event.preventDefault();
    clearTimeout(timer);
    run(true);
  });
}

function renderFocusResult(study, { onRetry, onExitStudy }) {
  const seconds = Math.round((study.durationMs || 0) / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const sheet = el('article', 'page focus-sheet');
  sheet.append(el('p', 'result-line hand', `全${study.wordIds.length}問`));
  sheet.append(el('p', 'result-line', `正解 ${study.wordIds.length}`));
  sheet.append(el('p', 'result-line', `まちがい ${study.wrong}回`));
  sheet.append(el('p', 'result-line', time));
  const actions = el('div', 'modal-actions');
  const again = el('button', 'btn btn-primary', 'もう一度');
  again.type = 'button';
  again.addEventListener('click', onRetry);
  const back = el('button', 'btn btn-ghost', 'ノートに戻る');
  back.type = 'button';
  back.addEventListener('click', onExitStudy);
  actions.append(again, back);
  sheet.append(actions);
  return sheet;
}
