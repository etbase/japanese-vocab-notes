/** 畫面切換、對話框與網址。資料寫入後由這裡重畫。 */

import { getCurrentUser, usingDemoMode } from './auth.js';
import {
  closeMarkerMenu,
  COVER_COLORS,
  renderNotebook,
  renderShelf,
} from './notebook.js';
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  getNotebooks,
  getWordsByNotebook,
  hasPersistenceWarning,
  ready,
  setActiveUser,
  setHighlight,
  updateNotebook,
} from './storage.js';
import { pageCount, spreadFor } from './vocabulary.js';

const COMPACT_QUERY = '(max-width: 720px), (max-height: 520px)';

const state = {
  view: 'shelf',
  notebookId: null,
  page: 1,
  turn: null,
  flashWordId: null,
  freshId: null,
  focusSelector: null,
};

let previousView = null;
let closeModal = () => {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyCompact() {
  document.documentElement.classList.toggle(
    'is-compact',
    window.matchMedia(COMPACT_QUERY).matches,
  );
}

function notebookHash(id, page) {
  return `#/n/${encodeURIComponent(id)}/p/${page}`;
}

function parseHash(hash) {
  const value = String(hash || '').replace(/^#/, '');
  const match = value.match(/^\/n\/([^/]+)\/p\/(\d+)$/);
  if (!match) return { view: 'shelf' };
  const page = Number.parseInt(match[2], 10);
  return {
    view: 'notebook',
    notebookId: decodeURIComponent(match[1]),
    page: Number.isFinite(page) ? page : 1,
  };
}

function isCompact() {
  return document.documentElement.classList.contains('is-compact');
}

function syncWarning() {
  const note = document.querySelector('#save-warning');
  if (!note) return;
  if (hasPersistenceWarning()) {
    note.hidden = false;
    note.textContent = 'ブラウザに保存できませんでした。読み込み直すと、変更が残らないことがあります。';
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

function focusPending() {
  if (!state.focusSelector) return;
  const selector = state.focusSelector;
  state.focusSelector = null;
  const target = document.querySelector(selector);
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

function render() {
  closeMarkerMenu();
  const root = document.querySelector('#app-root');
  const turn = state.turn;
  const flashWordId = state.flashWordId;
  const freshId = state.freshId;
  state.turn = null;
  state.flashWordId = null;
  state.freshId = null;

  const enteredNotebook = state.view === 'notebook' && previousView !== 'notebook';
  previousView = state.view;

  if (state.view === 'notebook') {
    const notebook = getNotebook(state.notebookId);
    if (!notebook) {
      state.view = 'shelf';
      state.notebookId = null;
      previousView = 'shelf';
      if (location.hash && location.hash !== '#/' && location.hash !== '#') {
        history.replaceState(null, '', '#/');
      }
      renderShelfView(root, freshId);
    } else {
      const words = getWordsByNotebook(notebook.id);
      const view = spreadFor(state.page, pageCount(words), { compact: isCompact() });
      if (view.current !== state.page) {
        state.page = view.current;
        const hash = notebookHash(notebook.id, state.page);
        if (location.hash !== hash) history.replaceState(null, '', hash);
      }
      renderNotebook(root, {
        notebook,
        words,
        page: state.page,
        compact: isCompact(),
        turn,
        flashWordId,
        onStep: step,
        onHighlight: changeHighlight,
      });
      if (!state.focusSelector && enteredNotebook) state.focusSelector = '#notebook-title';
    }
  } else {
    renderShelfView(root, freshId);
  }

  if (turn && state.view === 'notebook') {
    const live = document.querySelector('#live-status');
    if (live) live.textContent = `${state.page}ページを開きました`;
  }
  syncWarning();
  focusPending();
}

function renderShelfView(root, freshId) {
  const notebooks = getNotebooks();
  const wordsByNotebook = new Map(
    notebooks.map((notebook) => [notebook.id, getWordsByNotebook(notebook.id)]),
  );
  renderShelf(root, {
    notebooks,
    wordsByNotebook,
    freshId,
    onCreate: () => openNotebookDialog('create'),
    onEdit: (notebook) => openNotebookDialog('edit', notebook),
    onDelete: confirmDelete,
  });
}

function step(direction) {
  if (state.view !== 'notebook') return;
  const words = getWordsByNotebook(state.notebookId);
  const view = spreadFor(state.page, pageCount(words), { compact: isCompact() });
  if (direction === 'next' && !view.hasNext) return;
  if (direction === 'prev' && !view.hasPrev) return;
  const delta = isCompact() ? 1 : 2;
  const next = direction === 'next' ? view.current + delta : view.current - delta;
  state.turn = direction;
  state.page = next;
  const hash = notebookHash(state.notebookId, next);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  render();
}

async function changeHighlight(wordId, color) {
  const result = await setHighlight(wordId, color);
  if (!result.ok) return;
  state.flashWordId = wordId;
  state.focusSelector = `[data-marker="${CSS.escape(wordId)}"]`;
  render();
}

function syncFromHash() {
  closeModal({ restore: false });
  const route = parseHash(location.hash);
  if (route.view === 'notebook') {
    const notebook = getNotebook(route.notebookId);
    if (!notebook) {
      state.view = 'shelf';
      state.notebookId = null;
      state.page = 1;
      if (location.hash && location.hash !== '#/' && location.hash !== '#') {
        history.replaceState(null, '', '#/');
      }
      render();
      return;
    }
    state.view = 'notebook';
    state.notebookId = notebook.id;
    state.page = route.page;
  } else {
    state.view = 'shelf';
    state.notebookId = null;
    state.page = 1;
  }
  render();
}

function openModal({ title, body, actions = [] }) {
  closeModal({ restore: false });
  const previous = document.activeElement;
  const root = document.querySelector('#modal-root');
  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal-panel');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'modal-title');

  const heading = el('h2', 'modal-title hand', title);
  heading.id = 'modal-title';
  dialog.append(heading);
  if (typeof body === 'string') dialog.append(el('p', 'modal-text', body));
  else if (body) dialog.append(body);

  if (actions.length) {
    const row = el('div', 'modal-actions');
    actions.forEach((action) => {
      const button = el('button', action.className || 'btn btn-ghost', action.label);
      button.type = 'button';
      button.addEventListener('click', () => action.onClick?.());
      row.append(button);
    });
    dialog.append(row);
  }

  backdrop.append(dialog);
  root.replaceChildren(backdrop);
  document.body.classList.add('modal-open');

  const close = ({ restore = true } = {}) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.body.classList.remove('modal-open');
    closeModal = () => {};
    if (restore && previous instanceof HTMLElement && previous.isConnected) {
      previous.focus();
    }
  };
  closeModal = close;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, input, textarea, select, a[href]')]
      .filter((item) => !item.disabled && item.tabIndex !== -1);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const focusTarget = dialog.querySelector('input, button');
  focusTarget?.focus();
  return close;
}

function openNotebookDialog(mode, notebook) {
  const form = el('form', 'notebook-form');
  form.id = 'notebook-form';

  const field = el('label', 'field');
  field.append(el('span', 'field-label', 'ノートの名前'));
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'title';
  input.maxLength = 30;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.enterKeyHint = 'done';
  input.lang = 'ja';
  input.setAttribute('aria-describedby', 'notebook-form-error');
  if (notebook) input.value = notebook.title;
  field.append(input);

  const error = el('p', 'form-error');
  error.id = 'notebook-form-error';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  const colorField = el('fieldset', 'color-field');
  const legend = el('legend', 'field-label', 'カバーの色');
  const swatches = el('div', 'swatches');
  const selected = notebook?.color || 'sage';
  COVER_COLORS.forEach((color) => {
    const label = el('label', 'swatch');
    label.dataset.color = color.id;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'cover-color';
    radio.value = color.id;
    radio.checked = color.id === selected;
    label.append(radio, el('span', 'visually-hidden', color.label));
    swatches.append(label);
  });
  colorField.append(legend, swatches);

  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', 'キャンセル');
  cancel.type = 'button';
  const submit = el('button', 'btn btn-primary', mode === 'edit' ? '保存する' : 'つくる');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(field, error, colorField, actions);

  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  cancel.addEventListener('click', () => closeModal());

  const showError = (message) => {
    error.hidden = false;
    error.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing) return;
    const title = input.value;
    if (!title.trim()) {
      showError('ノートの名前を入力してください');
      return;
    }
    const color = form.querySelector('input[name="cover-color"]:checked')?.value || 'sage';
    submit.disabled = true;
    const result = mode === 'edit'
      ? await updateNotebook(notebook.id, { title: title.trim(), color })
      : await createNotebook({ title: title.trim(), color });
    submit.disabled = false;
    if (!result.ok) {
      showError(result.message || '保存できませんでした');
      return;
    }
    const id = mode === 'edit' ? notebook.id : result.notebook.id;
    closeModal({ restore: false });
    state.freshId = mode === 'create' ? id : null;
    state.focusSelector = `[data-notebook-id="${CSS.escape(id)}"] .cover-open`;
    render();
  });

  openModal({
    title: mode === 'edit' ? 'ノートを編集' : '新しいノート',
    body: form,
  });
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function confirmDelete(notebook) {
  const count = getWordsByNotebook(notebook.id).length;
  const body = el('p', 'modal-text');
  body.append('「');
  body.append(el('strong', 'hand', notebook.title));
  body.append('」');
  body.append(count
    ? `と、中の${count}語を削除します。元に戻せません。`
    : 'を削除します。元に戻せません。');

  openModal({
    title: 'ノートを削除しますか',
    body,
    actions: [
      { label: 'キャンセル', className: 'btn btn-ghost', onClick: () => closeModal() },
      {
        label: '削除する',
        className: 'btn btn-danger',
        onClick: async () => {
          const result = await deleteNotebook(notebook.id);
          if (!result.ok) return;
          closeModal({ restore: false });
          state.focusSelector = '#add-notebook';
          render();
        },
      },
    ],
  });
}

function openDemoDialog() {
  openModal({
    title: 'デモモード',
    body: 'Firebase を設定すると、Google でログインできます。それまでは、このブラウザの中にノートを保存します。',
    actions: [{ label: 'わかった', className: 'btn btn-primary', onClick: () => closeModal() }],
  });
}

function bindChrome() {
  const button = document.querySelector('#login-button');
  const badge = document.querySelector('#account-badge');
  const user = getCurrentUser();
  if (usingDemoMode() || user.isDemo) {
    badge.hidden = false;
    badge.textContent = 'デモ';
    button.textContent = 'ログイン';
    button.addEventListener('click', openDemoDialog);
  }
  document.querySelector('.brand')?.addEventListener('click', () => {
    state.turn = null;
  });
}

function bindKeys() {
  document.addEventListener('keydown', (event) => {
    if (state.view !== 'notebook') return;
    if (document.body.classList.contains('modal-open')) return;
    if (document.querySelector('.marker-menu')) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step('next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step('prev');
    }
  });
}

function showFatal() {
  const root = document.querySelector('#app-root');
  root.replaceChildren(el('p', 'loading', 'ノートを開けませんでした。ページを読み込み直してください。'));
}

async function start() {
  applyCompact();
  setActiveUser(getCurrentUser().uid);
  await ready();
  bindChrome();
  bindKeys();
  window.addEventListener('hashchange', syncFromHash);
  window.addEventListener('popstate', syncFromHash);
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', () => {
    applyCompact();
    render();
  });
  syncFromHash();
}

start().catch(() => {
  showFatal();
});
