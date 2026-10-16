/** 登入後才讀寫自己的 Firestore。未登入時不碰雲端。 */

import { getFirebaseApp } from './auth.js';
import { isFirebaseConfigured } from './firebase-config.js';

const FIREBASE_VERSION = '11.10.0';
const BATCH_LIMIT = 400;

let firestoreApi = null;

async function api() {
  if (!isFirebaseConfigured()) return null;
  if (firestoreApi) return firestoreApi;
  const app = await getFirebaseApp();
  if (!app) return null;
  const mod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
  firestoreApi = { db: mod.getFirestore(app), mod };
  return firestoreApi;
}

function dataOf(snap) {
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function pullUserState(uid) {
  if (!uid) return { missing: true };
  try {
    const store = await api();
    if (!store) return { missing: true };
    const { db, mod } = store;
    const notebooksSnap = await mod.getDocs(mod.collection(db, 'users', uid, 'notebooks'));
    const wordsSnap = await mod.getDocs(mod.collection(db, 'users', uid, 'words'));
    const logsSnap = await mod.getDocs(mod.collection(db, 'users', uid, 'practiceLogs'));
    const metaSnap = await mod.getDoc(mod.doc(db, 'users', uid, 'private', 'state'));
    if (notebooksSnap.empty && wordsSnap.empty && logsSnap.empty && !metaSnap.exists()) {
      return { missing: true };
    }
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    return {
      ok: true,
      state: {
        version: 1,
        starterWordsVersion: meta.starterWordsVersion || 0,
        importedBatches: meta.importedBatches || [],
        completedImports: meta.completedImports || [],
        notebooks: dataOf(notebooksSnap),
        words: dataOf(wordsSnap),
        practiceLogs: dataOf(logsSnap),
      },
    };
  } catch {
    return { ok: false };
  }
}

async function commitOps(mod, db, ops) {
  for (let index = 0; index < ops.length; index += BATCH_LIMIT) {
    const batch = mod.writeBatch(db);
    ops.slice(index, index + BATCH_LIMIT).forEach((op) => {
      if (op.type === 'delete') batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    });
    await batch.commit();
  }
}

export async function pushUserState(uid, state) {
  if (!uid || !state) return { ok: false };
  try {
    const store = await api();
    if (!store) return { ok: false };
    const { db, mod } = store;
    const notebooks = mod.collection(db, 'users', uid, 'notebooks');
    const words = mod.collection(db, 'users', uid, 'words');
    const logs = mod.collection(db, 'users', uid, 'practiceLogs');
    const [notebooksSnap, wordsSnap, logsSnap] = await Promise.all([
      mod.getDocs(notebooks),
      mod.getDocs(words),
      mod.getDocs(logs),
    ]);
    const keepNotebooks = new Set(state.notebooks.map((item) => item.id));
    const keepWords = new Set(state.words.map((item) => item.id));
    const keepLogs = new Set(state.practiceLogs.map((item) => item.id));
    const ops = [];
    state.notebooks.forEach((item) => {
      const { id, ...data } = item;
      ops.push({ type: 'set', ref: mod.doc(notebooks, id), data });
    });
    state.words.forEach((item) => {
      const { id, ...data } = item;
      ops.push({ type: 'set', ref: mod.doc(words, id), data });
    });
    state.practiceLogs.forEach((item) => {
      const { id, ...data } = item;
      ops.push({ type: 'set', ref: mod.doc(logs, id), data });
    });
    notebooksSnap.docs.forEach((item) => {
      if (!keepNotebooks.has(item.id)) ops.push({ type: 'delete', ref: item.ref });
    });
    wordsSnap.docs.forEach((item) => {
      if (!keepWords.has(item.id)) ops.push({ type: 'delete', ref: item.ref });
    });
    logsSnap.docs.forEach((item) => {
      if (!keepLogs.has(item.id)) ops.push({ type: 'delete', ref: item.ref });
    });
    ops.push({
      type: 'set',
      ref: mod.doc(db, 'users', uid, 'private', 'state'),
      data: {
        starterWordsVersion: state.starterWordsVersion || 0,
        importedBatches: state.importedBatches || [],
        completedImports: state.completedImports || [],
        updatedAt: new Date().toISOString(),
      },
    });
    await commitOps(mod, db, ops);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function writeOwnedDocuments(uid, { notebooks = [], words = [], practiceLogs = [], meta = null } = {}) {
  if (!uid) return { ok: false, created: [] };
  const created = [];
  try {
    const store = await api();
    if (!store) return { ok: false, created };
    const { db, mod } = store;
    const ops = [];
    const pushSet = (collectionName, item) => {
      const id = String(item?.id ?? '');
      if (!id || id.includes('/')) throw new Error('bad-id');
      const data = { ...item };
      delete data.id;
      ops.push({
        ref: mod.doc(db, 'users', uid, collectionName, id),
        data,
        created: { collectionName, id },
      });
    };
    notebooks.forEach((item) => pushSet('notebooks', item));
    words.forEach((item) => pushSet('words', item));
    practiceLogs.forEach((item) => pushSet('practiceLogs', item));
    for (let index = 0; index < ops.length; index += BATCH_LIMIT) {
      const slice = ops.slice(index, index + BATCH_LIMIT);
      const batch = mod.writeBatch(db);
      slice.forEach((op) => batch.set(op.ref, op.data));
      await batch.commit();
      created.push(...slice.map((op) => op.created));
    }
    if (meta) {
      await mod.setDoc(mod.doc(db, 'users', uid, 'private', 'state'), {
        starterWordsVersion: meta.starterWordsVersion || 0,
        importedBatches: meta.importedBatches || [],
        completedImports: meta.completedImports || [],
        updatedAt: meta.updatedAt || new Date().toISOString(),
      });
    }
    return { ok: true, created };
  } catch {
    return { ok: false, created };
  }
}

export async function deleteOwnedDocuments(uid, created) {
  if (!uid || !created?.length) return { ok: true };
  try {
    const store = await api();
    if (!store) return { ok: false };
    const { db, mod } = store;
    const ops = created
      .filter((item) => ['notebooks', 'words', 'practiceLogs'].includes(item.collectionName))
      .filter((item) => item.id && !String(item.id).includes('/'))
      .map((item) => ({
        type: 'delete',
        ref: mod.doc(db, 'users', uid, item.collectionName, item.id),
      }));
    await commitOps(mod, db, ops);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
