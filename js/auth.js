/** Google 登入。未填入 Firebase 設定時，維持原本的示範模式。 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const FIREBASE_VERSION = '11.10.0';

export const DEMO_USER = {
  uid: 'local-demo',
  displayName: 'ゲスト',
  photoURL: '',
  email: '',
  isDemo: true,
};

const SIGNED_OUT = {
  uid: '',
  displayName: '',
  photoURL: '',
  email: '',
  isDemo: false,
};

let currentUser = DEMO_USER;
let authReady = null;
let authApi = null;
const listeners = new Set();

export function usingDemoMode() {
  return !isFirebaseConfigured();
}

export function getCurrentUser() {
  return currentUser;
}

export function watchAuth(callback) {
  listeners.add(callback);
  callback(currentUser);
  return () => listeners.delete(callback);
}

function publish(user) {
  currentUser = user;
  listeners.forEach((callback) => callback(currentUser));
}

function accountFrom(firebaseUser) {
  if (!firebaseUser) return { ...SIGNED_OUT };
  return {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName || '会員',
    photoURL: firebaseUser.photoURL || '',
    email: firebaseUser.email || '',
    isDemo: false,
  };
}

export function readyAuth() {
  if (!authReady) authReady = initAuth();
  return authReady;
}

async function initAuth() {
  if (!isFirebaseConfigured()) {
    publish({ ...DEMO_USER });
    return;
  }
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  const authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  authApi = { auth, authMod, app };
  await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  await new Promise((resolve) => {
    const stop = authMod.onAuthStateChanged(auth, (firebaseUser) => {
      publish(accountFrom(firebaseUser));
      stop();
      resolve();
    });
  });
  authMod.onAuthStateChanged(auth, (firebaseUser) => {
    publish(accountFrom(firebaseUser));
    if (firebaseUser) rememberProfile(firebaseUser);
  });
  try {
    const redirected = await authMod.getRedirectResult(auth);
    if (redirected?.user) rememberProfile(redirected.user);
  } catch {
    /* 重新導向失敗時仍維持未登入，不改動本地單字。 */
  }
}

async function rememberProfile(firebaseUser) {
  const account = accountFrom(firebaseUser);
  if (!account.uid || !authApi) return;
  try {
    const { getFirestore, doc, setDoc } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    const db = getFirestore(authApi.app);
    await setDoc(doc(db, 'users', account.uid), {
      displayName: account.displayName.slice(0, 80),
      photoURL: account.photoURL.slice(0, 500),
      email: account.email.slice(0, 120),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch {
    /* 會員識別不依賴這筆資料。單字仍留在這個瀏覽器。 */
  }
}

export async function signInWithGoogle() {
  if (usingDemoMode()) return { ok: false, reason: 'demo' };
  await readyAuth();
  if (!authApi) return { ok: false, reason: 'not-ready' };
  const { auth, authMod } = authApi;
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await authMod.signInWithPopup(auth, provider);
    return { ok: true };
  } catch (error) {
    const code = error?.code || 'unknown';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await authMod.signInWithRedirect(auth, provider);
      return { ok: true, redirect: true };
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: code };
  }
}

export async function signOutUser() {
  if (usingDemoMode() || !authApi) return { ok: true };
  await authApi.authMod.signOut(authApi.auth);
  return { ok: true };
}
