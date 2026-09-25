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

// ---- Room state persistence (reconnection after refresh) ----

const KEY_ROOM = 'energy-duel-room';

export interface SavedRoom {
  roomCode: string;
  playerId: string;
  roomType: string;
  reconnectToken?: string;
}

export function saveRoomState(state: SavedRoom): void {
  localStorage.setItem(KEY_ROOM, JSON.stringify(state));
}

export function getSavedRoom(): SavedRoom | null {
  try {
    const raw = localStorage.getItem(KEY_ROOM);
    if (!raw) return null;
    return JSON.parse(raw) as SavedRoom;
  } catch {
    return null;
  }
}

export function clearRoomState(): void {
  localStorage.removeItem(KEY_ROOM);
}
