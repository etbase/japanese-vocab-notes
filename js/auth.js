/** 登入。Firebase 未設定時固定為 Demo Mode 的訪客。 */

import { isFirebaseConfigured } from './firebase-config.js';

export const DEMO_USER = {
  uid: 'local-demo',
  displayName: 'ゲスト',
  isDemo: true,
};

export function usingDemoMode() {
  return !isFirebaseConfigured();
}

export function getCurrentUser() {
  return DEMO_USER;
}

export function watchAuth(callback) {
  callback(getCurrentUser());
  return () => {};
}

export async function signInWithGoogle() {
  if (usingDemoMode()) return { ok: false, reason: 'demo' };
  return { ok: false, reason: 'not-ready' };
}

export async function signOutUser() {
  return { ok: true };
}
