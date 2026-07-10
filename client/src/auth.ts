// Auth token & user info management via localStorage

const KEY_TOKEN = 'energy-duel-token';
const KEY_ACCOUNT_ID = 'energy-duel-account-id';
const KEY_USERNAME = 'energy-duel-username';

export interface StoredAuth {
  token: string;
  accountId: string;
  username: string;
}

export function saveAuth(token: string, accountId: string, username: string): void {
  localStorage.setItem(KEY_TOKEN, token);
  localStorage.setItem(KEY_ACCOUNT_ID, accountId);
  localStorage.setItem(KEY_USERNAME, username);
}

export function getAuth(): StoredAuth | null {
  const token = localStorage.getItem(KEY_TOKEN);
  const accountId = localStorage.getItem(KEY_ACCOUNT_ID);
  const username = localStorage.getItem(KEY_USERNAME);
  if (!token || !accountId || !username) return null;
  return { token, accountId, username };
}

export function clearAuth(): void {
  localStorage.removeItem(KEY_TOKEN);
  localStorage.removeItem(KEY_ACCOUNT_ID);
  localStorage.removeItem(KEY_USERNAME);
}

export function getToken(): string | null {
  return localStorage.getItem(KEY_TOKEN);
}
