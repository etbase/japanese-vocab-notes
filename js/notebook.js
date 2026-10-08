/** 書架與筆記本內頁。使用者輸入一律以 textContent 寫入。 */

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

const MARKS = [
  { id: 'yellow', label: 'まだあやふや' },
  { id: 'pink', label: 'よく間違える' },
  { id: 'green', label: '覚えた' },
];

let highlightHandler = () => {};
let menuCleanup = () => {};

export function closeMarkerMenu() {
  menuCleanup();
  menuCleanup = () => {};
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function markLabel(color) {
  return MARKS.find((mark) => mark.id === color)?.label ?? 'なし';
}

export function renderShelf(container, { notebooks, wordsByNotebook, onCreate, onEdit, onDelete, freshId }) {
  closeMarkerMenu();
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

export function renderNotebook(container, {
  notebook,
  words,
  page,
  compact,
  turn,
  flashWordId,
  onStep,
  onHighlight,
}) {
  closeMarkerMenu();
  highlightHandler = onHighlight;
  const stats = notebookStats(words);
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
  toolbar.append(back, heading);

  const book = el('div', 'book');
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
    }));
  });
  book.append(spread);

  const pager = el('div', 'pager');
  const prev = el('button', 'btn btn-ghost', '前のページ');
  prev.type = 'button';
  prev.disabled = !view.hasPrev;
  prev.addEventListener('click', () => onStep('prev'));

  const status = el('p', 'pager-status');
  const visible = view.pages.filter((pageNumber, index) => !(compact && index > 0));
  const label = visible.length > 1 ? `${visible[0]}–${visible[1]}` : String(visible[0]);
  status.textContent = label;
  status.setAttribute('aria-hidden', 'true');

  const next = el('button', 'btn btn-ghost', '次のページ');
  next.type = 'button';
  next.disabled = !view.hasNext;
  next.addEventListener('click', () => onStep('next'));

  pager.append(prev, status, next);
  screen.append(toolbar, book, pager);
  container.replaceChildren(screen);
  return view;
}

function renderPage({ notebook, words, pageNumber, side, showTitle, flashWordId }) {
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
      line.append(renderWord(word, flashWordId));
    }
    list.append(line);
  }
  page.append(list);

  const footer = el('p', 'page-number hand', String(pageNumber));
  page.append(footer);
  return page;
}

function renderWord(word, flashWordId) {
  const fragment = document.createDocumentFragment();
  const marker = el('button', 'marker');
  marker.type = 'button';
  marker.dataset.marker = word.id;
  if (word.highlight) marker.dataset.color = word.highlight;
  marker.setAttribute('aria-haspopup', 'menu');
  marker.setAttribute('aria-expanded', 'false');
  marker.setAttribute('aria-label', `${word.kanji}のマーカー。いまは${markLabel(word.highlight)}`);
  marker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMarkerMenu(marker, word);
  });

  const kanji = el('span', 'word-kanji hand');
  const reading = el('span', 'word-reading hand');
  kanji.translate = false;
  reading.translate = false;
  const fresh = flashWordId === word.id ? ' is-fresh' : '';
  if (word.highlight) {
    kanji.append(el('span', `mark mark-${word.highlight}${fresh}`, word.kanji));
    reading.append(el('span', `mark mark-${word.highlight}${fresh}`, word.hiragana));
  } else {
    kanji.textContent = word.kanji;
    reading.textContent = word.hiragana;
  }

  const practice = el('span', 'practice-cell');
  practice.append(el('span', 'practice-blank'));
  practice.setAttribute('aria-hidden', 'true');

  fragment.append(marker, kanji, reading, practice);
  return fragment;
}

function toggleMarkerMenu(button, word) {
  const existing = document.querySelector('.marker-menu');
  const same = existing?.dataset.wordId === word.id;
  closeMarkerMenu();
  if (same) return;
  openMarkerMenu(button, word);
}

function openMarkerMenu(button, word) {
  const menu = el('div', 'marker-menu');
  menu.dataset.wordId = word.id;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `${word.kanji}のマーカー`);

  MARKS.forEach((mark) => {
    const item = el('button', 'marker-option', mark.label);
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', word.highlight === mark.id ? 'true' : 'false');
    const swatch = el('span', `marker-swatch mark-${mark.id}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.prepend(swatch);
    item.addEventListener('click', () => {
      closeMarkerMenu();
      highlightHandler(word.id, mark.id);
    });
    menu.append(item);
  });

  const clear = el('button', 'marker-option marker-clear', 'マーカーを消す');
  clear.type = 'button';
  clear.setAttribute('role', 'menuitem');
  clear.disabled = !word.highlight;
  clear.addEventListener('click', () => {
    closeMarkerMenu();
    highlightHandler(word.id, null);
  });
  menu.append(clear);

  const width = 210;
  const height = 188;
  const rect = button.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.body.append(menu);
  button.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();

  const onPointerDown = (event) => {
    if (menu.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('.marker')) return;
    closeMarkerMenu();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeMarkerMenu();
    if (button.isConnected) button.focus();
  };
  const onDismiss = () => closeMarkerMenu();
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onDismiss);
  window.addEventListener('scroll', onDismiss, true);
  menuCleanup = () => {
    menu.remove();
    if (button.isConnected) button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onDismiss);
    window.removeEventListener('scroll', onDismiss, true);
  };
}
