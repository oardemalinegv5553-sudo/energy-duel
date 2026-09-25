import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { createSocketServer } from './socket';
import { AuthManager } from './auth/AuthManager';
const app = express();
const httpServer = createServer(app);

// Trust proxy for correct IP detection behind Render/nginx
app.set('trust proxy', true);

// Last-resort logging so a stray rejection/exception doesn't kill the process silently
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});

// CORS for REST API (GitHub Pages → this server)
app.use(cors());

// Parse JSON bodies for REST auth endpoints
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';

// ---- Auth Manager ----
const authDbPath = path.resolve(__dirname, '../data/users.json');
const authManager = new AuthManager(authDbPath);

// ---- Auth rate limiting (per-IP sliding window) ----
const AUTH_WINDOW_MS = 60_000;
const AUTH_LIMIT = 10;
const authAttempts = new Map<string, number[]>();

function authRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = authManager.getClientIp(req);
  const now = Date.now();
  const arr = (authAttempts.get(ip) || []).filter(t => now - t < AUTH_WINDOW_MS);
  if (arr.length >= AUTH_LIMIT) {
    res.status(429).json({ success: false, error: '尝试过于频繁，请一分钟后再试' });
    return;
  }
  arr.push(now);
  authAttempts.set(ip, arr);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of authAttempts) {
    const live = arr.filter(t => now - t < AUTH_WINDOW_MS);
    if (live.length === 0) authAttempts.delete(ip);
    else authAttempts.set(ip, live);
  }
}, AUTH_WINDOW_MS).unref();

// ---- REST Auth Routes ----

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.json({ success: false, error: '用户名和密码不能为空' });
  }
  const ip = authManager.getClientIp(req);
  const result = await authManager.register(username, password, ip);
  res.json(result);
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const { identifier, password } = req.body ?? {};
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier || !password) {
    return res.json({ success: false, error: '账号和密码不能为空' });
  }
  const result = await authManager.login(identifier, password);
  res.json(result);
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = req.body;
  if (token) {
    authManager.logout(token);
  }
  res.json({ success: true });
});

// Health check endpoint (required by Render)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files from client build
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send('蓄气对决 server is running. Connect via WebSocket.');
  });
}

// Socket.IO
createSocketServer(httpServer, authManager);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`[server] 蓄气对决 running on port ${PORT} (${isProduction ? 'production' : 'development'})`);
});
