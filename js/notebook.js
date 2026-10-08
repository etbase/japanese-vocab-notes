/** 書架與筆記本內頁。使用者輸入一律以 textContent 寫入。 */

import { judgeAnswer } from './practice.js';
import { PAGE_SIZE, notebookStats, pageCount, spreadFor, wordsForPage } from './vocabulary.js';

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

function markNode(text, highlight, fresh) {
  if (!highlight) return document.createTextNode(text);
  const mark = el('span', `mark mark-${highlight}${fresh ? ' is-fresh' : ''}`, text);
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

function renderCover(notebook, words, { onEdit, onDelete, freshId }) {
  const stats = notebookStats(words);
  const card = el('article', 'notebook-card');
  if (freshId === notebook.id) card.classList.add('is-new');
  card.dataset.notebookId = notebook.id;

  const cover = el('div', 'cover');
  cover.dataset.color = notebook.color || 'sage';

  const link = el('a', 'cover-open');
  link.href = `#/n/${encodeURIComponent(notebook.id)}/p/1`;
  link.setAttribute(
    'aria-label',
    `${notebook.title}、${stats.total}語、覚えた${stats.percent}%。開く`,
  );

  const plate = el('div', 'cover-plate');
  plate.append(el('span', 'cover-tape'));
  const title = el('h3', 'cover-title hand', notebook.title);
  plate.append(title);

  const meta = el('div', 'cover-meta');
  const metaRow = el('p', 'cover-stats');
  metaRow.append(el('span', '', `${stats.total}語`));
  metaRow.append(el('span', '', `覚えた ${stats.percent}%`));
  const progress = el('div', 'progress');
  progress.setAttribute('aria-hidden', 'true');
  const bar = el('span');
  bar.style.width = `${stats.percent}%`;
  progress.append(bar);
  meta.append(metaRow, progress);

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
    hints,
    showResult,
    focusDraft,
    onStep,
    onHighlight,
    onTogglePen,
    onSelectPen,
    onAddWord,
    onEditWord,
    onDeleteWord,
    onStartPractice,
    onStartFocus,
    onExitStudy,
    onFinishPractice,
    onRetry,
    onReview,
    onFocusCorrect,
    onFocusWrong,
  } = options;
  const stats = notebookStats(totalWords || words);
  const studying = study?.kind === 'practice';
  const focusing = study?.kind === 'focus';
  const view = spreadFor(page, pageCount(words), { compact });

  const screen = el('section', 'notebook-screen');
  const toolbar = el('div', 'notebook-toolbar');
  const back = el('a', 'btn btn-ghost', 'ノート一覧');
  back.href = '#/';

  const heading = el('div', 'notebook-heading');
  const title = el('h2', 'hand', notebook.title);
  title.id = 'notebook-title';
  title.tabIndex = -1;
  const summary = el('p', 'notebook-summary', `${stats.total}語 · 覚えた ${stats.percent}%`);
  heading.append(title, summary);
  toolbar.append(back, heading, renderPen(pen, onTogglePen, onSelectPen));
  if (pen?.active) screen.classList.add('is-pen-mode');

  const tools = el('div', 'notebook-tools');
  if (focusing || studying) {
    const backStudy = el('button', 'btn btn-ghost', 'ノートに戻る');
    backStudy.type = 'button';
    backStudy.addEventListener('click', onExitStudy);
    tools.append(backStudy);
    if (studying && !showResult) {
      const done = el('button', 'btn btn-primary', 'できた');
      done.type = 'button';
      done.addEventListener('click', onFinishPractice);
      tools.append(done);
    }
  } else {
    const add = el('button', 'btn btn-primary', '＋ 単語を追加');
    add.type = 'button';
    add.id = 'add-word';
    add.addEventListener('click', onAddWord);
    const practice = el('button', 'btn btn-ghost', '練習する');
    practice.type = 'button';
    practice.addEventListener('click', onStartPractice);
    const focus = el('button', 'btn btn-ghost', '集中練習');
    focus.type = 'button';
    focus.addEventListener('click', onStartFocus);
    tools.append(add, practice, focus);
  }

  const book = el('div', 'book');
  if (focusing) {
    book.append(study.finished
      ? renderFocusResult(study, { onRetry, onExitStudy })
      : renderFocusSession({ study, focusDraft, onFocusCorrect, onFocusWrong, onFocusDraft: options.onFocusDraft }));
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
        hints,
        onHighlight,
        onEditWord,
        onDeleteWord,
      }));
    });
    book.append(spread);
  }

  const pager = el('div', 'pager');
  const prev = el('button', 'btn btn-ghost', '前のページ');
  prev.type = 'button';
  prev.disabled = focusing || !view.hasPrev;
  prev.addEventListener('click', () => onStep('prev'));

  const status = el('p', 'pager-status');
  const visible = view.pages.filter((pageNumber, index) => !(compact && index > 0));
  const label = focusing
    ? `${Math.min(study.index + 1, study.wordIds.length)} / ${study.wordIds.length}`
    : (visible.length > 1 ? `${visible[0]}–${visible[1]}` : String(visible[0]));
  status.textContent = label;
  status.setAttribute('aria-hidden', 'true');

  const next = el('button', 'btn btn-ghost', '次のページ');
  next.type = 'button';
  next.disabled = focusing || !view.hasNext;
  next.addEventListener('click', () => onStep('next'));
  pager.append(prev, status, next);
  if (focusing) pager.hidden = true;

  const visibleWords = view.pages
    .filter((pageNumber, index) => !(compact && index > 0))
    .flatMap((pageNumber) => wordsForPage(words, pageNumber));
  screen.append(toolbar, tools, book, pager);
  if (showResult && studying) {
    screen.append(renderPracticeResult(visibleWords, answers, { onRetry, onReview, onExitStudy }));
  }
  container.replaceChildren(screen);
  return view;
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
  const { notebook, words, pageNumber, side, showTitle } = options;
  const page = el('article', `page page-${side}`);
  page.dataset.side = side;
  page.dataset.page = String(pageNumber);
  page.setAttribute('aria-label', `${pageNumber}ページ`);

  const head = el('div', 'page-head hand');
  if (showTitle) head.textContent = notebook.title;
  page.append(head);

  const list = el('ol', 'word-lines');
  const pageWords = wordsForPage(words, pageNumber);
  for (let index = 0; index < PAGE_SIZE; index += 1) {
    const word = pageWords[index];
    const line = el('li', word ? 'word-line has-word' : 'word-line');
    if (!word) {
      line.setAttribute('aria-hidden', 'true');
    } else {
      if (word.note) line.title = word.note;
      line.append(renderWord(word, options));
    }
    list.append(line);
  }
  page.append(list);
  page.append(el('p', 'page-number hand', String(pageNumber)));
  return page;
}

function renderWord(word, options) {
  const { flashWordId, pen, studying, answers, revealed, hints, onHighlight, onEditWord, onDeleteWord } = options;
  const fragment = document.createDocumentFragment();
  const fresh = flashWordId === word.id;
  const kanji = el('span', 'word-kanji hand');
  kanji.translate = false;
  kanji.append(markNode(word.kanji, word.highlight, fresh));
  bindPenTarget(kanji, word, pen, onHighlight);

  const reading = el('span', 'word-reading hand');
  reading.translate = false;
  if (studying) {
    reading.append(renderAnswerField(word, answers, revealed, hints));
  } else {
    reading.append(markNode(word.hiragana, word.highlight, fresh));
    bindPenTarget(reading, word, pen, onHighlight);
  }

  fragment.append(kanji, reading);
  if (studying) {
    const tools = el('div', 'answer-tools');
    if (!revealed?.[word.id]) {
      const hint = el('button', 'text-button', 'ヒント');
      hint.type = 'button';
      hint.addEventListener('click', () => showHint(word, reading, hints));
      const answer = el('button', 'text-button', '答え');
      answer.type = 'button';
      answer.addEventListener('click', () => showAnswer(word, reading, revealed));
      tools.append(hint, answer);
    }
    fragment.append(tools);
  } else {
    const actions = el('div', 'word-actions');
    const edit = el('button', 'text-button', '編集');
    edit.type = 'button';
    edit.setAttribute('aria-label', `${word.kanji}を編集`);
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      onEditWord(word);
    });
    const remove = el('button', 'text-button text-button-quiet', '削除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${word.kanji}を削除`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      onDeleteWord(word);
    });
    actions.append(edit, remove);
    fragment.append(actions);
  }
  return fragment;
}

function bindPenTarget(node, word, pen, onHighlight) {
  node.addEventListener('click', () => {
    if (!pen?.active || !pen.tool) return;
    if (window.getSelection?.()?.toString()) return;
    onHighlight(word.id, pen.tool === 'erase' ? null : pen.tool);
  });
}

function renderAnswerField(word, answers, revealed, hints) {
  const saved = answers?.[word.id];
  const field = el('span', 'answer-field');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reading-input';
  input.lang = 'ja';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', `${word.kanji}のひらがな`);
  input.dataset.wordInput = word.id;
  if (saved?.value) input.value = saved.value;
  const judge = el('span', 'judge');
  judge.setAttribute('aria-live', 'polite');
  field.append(input, judge);
  if (revealed?.[word.id]) field.append(el('span', 'revealed hand', word.hiragana));
  else if (hints?.[word.id]) field.append(el('span', 'hint hand', [...word.hiragana][0] || ''));
  bindAnswerInput(input, judge, word, answers);
  if (saved?.status) paintJudgement(input, judge, { status: saved.status });
  return field;
}

function bindAnswerInput(input, judge, word, answers) {
  let composing = false;
  let timer = 0;
  const run = () => {
    if (composing) return;
    const result = judgeAnswer(input.value, word.hiragana, { composing: false });
    paintJudgement(input, judge, result);
    if (answers) {
      answers[word.id] = {
        value: input.value,
        status: result.status === 'empty' ? '' : result.status,
      };
    }
  };
  input.addEventListener('compositionstart', () => {
    composing = true;
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(timer);
    run();
  });
  input.addEventListener('input', (event) => {
    if (composing || event.isComposing) return;
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
    timer = setTimeout(run, 350);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || composing || event.isComposing) return;
    event.preventDefault();
    clearTimeout(timer);
    run();
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
    judge.textContent = result.status === 'incorrect' ? '✕' : '✕ ひらがなで';
    return;
  }
  judge.textContent = '';
}

function showHint(word, reading, hints) {
  if (reading.querySelector('.hint')) return;
  const field = reading.querySelector('.answer-field');
  if (!field || field.querySelector('.revealed')) return;
  field.append(el('span', 'hint hand', [...word.hiragana][0] || ''));
  if (hints) hints[word.id] = true;
}

function showAnswer(word, reading, revealed) {
  const field = reading.querySelector('.answer-field');
  field?.querySelector('.hint')?.remove();
  if (field && !field.querySelector('.revealed')) {
    field.append(el('span', 'revealed hand', word.hiragana));
  }
  if (revealed) revealed[word.id] = true;
  reading.closest('.word-line')?.querySelector('.answer-tools')?.remove();
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

function renderFocusSession({ study, focusDraft, onFocusCorrect, onFocusWrong, onFocusDraft }) {
  const wordId = study.wordIds[study.index];
  const word = study.wordsById[wordId];
  const sheet = el('article', 'page focus-sheet');
  sheet.append(el('p', 'focus-count', `${study.index + 1} / ${study.wordIds.length}`));
  const kanji = el('p', 'focus-kanji hand', word?.kanji || '');
  kanji.translate = false;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reading-input focus-input';
  input.lang = 'ja';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', `${word?.kanji || ''}のひらがな`);
  input.dataset.focusInput = 'true';
  input.value = focusDraft || '';
  const judge = el('span', 'judge');
  judge.setAttribute('aria-live', 'polite');
  sheet.append(kanji, input, judge);
  bindFocusInput(input, judge, word, { onFocusCorrect, onFocusWrong, onFocusDraft });
  queueMicrotask(() => input.focus());
  return sheet;
}

function bindFocusInput(input, judge, word, { onFocusCorrect, onFocusWrong, onFocusDraft }) {
  let composing = false;
  let timer = 0;
  let lastValue = '';
  const run = () => {
    if (composing || !word) return;
    const result = judgeAnswer(input.value, word.hiragana, { composing: false });
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
    composing = true;
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(timer);
    run();
  });
  input.addEventListener('input', (event) => {
    onFocusDraft?.(input.value);
    if (composing || event.isComposing) return;
    clearTimeout(timer);
    input.classList.remove('is-correct', 'is-incorrect');
    judge.textContent = '';
    timer = setTimeout(run, 350);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || composing || event.isComposing) return;
    event.preventDefault();
    clearTimeout(timer);
    run();
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
