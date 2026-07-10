import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { createSocketServer } from './socket';
import { AuthManager } from './auth/AuthManager';

const app = express();
const httpServer = createServer(app);

// Trust proxy for correct IP detection behind Render/nginx
app.set('trust proxy', true);

// Parse JSON bodies for REST auth endpoints
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';

// ---- Auth Manager ----
const authDbPath = path.resolve(__dirname, '../data/users.json');
const authManager = new AuthManager(authDbPath);

// ---- REST Auth Routes ----

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.json({ success: false, error: '用户名和密码不能为空' });
  }
  const ip = authManager.getClientIp(req);
  const result = authManager.register(username, password, ip);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, error: '账号和密码不能为空' });
  }
  const result = authManager.login(identifier, password);
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
