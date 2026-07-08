import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

// Dev: localhost. Production: Render.com server
const SERVER_URL = import.meta.env.PROD
  ? 'https://energy-duel-server.onrender.com'
  : window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
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
