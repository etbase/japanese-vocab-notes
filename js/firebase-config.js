/**
 * Firebase 網頁設定。
 * 這裡只放 Firebase Console 提供的 client config，可以出現在前端。
 * 不要放入 Admin SDK、service account 或任何私密金鑰。
 * 欄位留空時，網站會以 Demo Mode 把資料存在這個瀏覽器。
 * Project ID：japanese-vocab-notes。這是網頁用的 client config，可以出現在前端。
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyDWlwRJFdaANU0uycShhLHN-rX6gtZpJ8E',
  authDomain: 'japanese-vocab-notes.firebaseapp.com',
  projectId: 'japanese-vocab-notes',
  storageBucket: 'japanese-vocab-notes.firebasestorage.app',
  messagingSenderId: '261211487774',
  appId: '1:261211487774:web:92d78269013de08f79b80f',
};

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

export function isFirebaseConfigured(config = firebaseConfig) {
  return REQUIRED_KEYS.every((key) => {
    const value = String(config[key] ?? '').trim();
    return value.length > 0 && !value.startsWith('YOUR_');
  });
}
