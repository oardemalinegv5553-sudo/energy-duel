import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';
import { getToken } from './auth';

// Dev: localhost. Production: Render.com server
const SERVER_URL = import.meta.env.PROD
  ? 'https://uprising-persuaded-fit.ngrok-free.dev'
  : window.location.origin;

let authToken = getToken() || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: { token: authToken },
});

export function connectSocket(): void {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket(): void {
  if (socket.connected) {
    socket.disconnect();
  }
}

/** Update auth token and reconnect with new credentials */
export function updateAuthToken(token?: string): void {
  authToken = token;
  (socket as any).auth = { token };
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}
