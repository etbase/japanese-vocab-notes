/** 既有單字的歸屬。正式匯入必須等確認，而且只寫入當時登入者自己的 UID。 */

import { getCurrentUser } from './auth.js';

export const OWNER_EMAIL = 'ting023858@gmail.com';
export const CLAIM_TITLE = '漢字N2';
export const CLAIM_ENABLED = false;

export function isOwnerAccount(user = getCurrentUser()) {
  return String(user?.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

export async function claimArchive() {
  if (!CLAIM_ENABLED) return { ok: false, reason: 'awaiting-confirmation' };
  const user = getCurrentUser();
  if (!isOwnerAccount(user) || !user.uid) return { ok: false, reason: 'not-owner' };
  return { ok: false, reason: 'not-run' };
}
