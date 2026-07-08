import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { createSocketServer } from './socket';

const app = express();
const httpServer = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

// Health check endpoint (required by Render)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files from client build (development only)
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
createSocketServer(httpServer);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`[server] 蓄气对决 running on port ${PORT} (${isProduction ? 'production' : 'development'})`);
});
