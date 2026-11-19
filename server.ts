import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';
import fetchM3uHandler from './api/fetch-m3u.ts';
import healthHandler from './api/health.ts';
import proxyStreamHandler from './api/proxy-stream.ts';
import xtreamLoginHandler from './api/xtream-login.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({limit: '2mb'}));

  app.all('/api/health', (req, res) => healthHandler(req, res));
  app.all('/api/fetch-m3u', (req, res) => fetchM3uHandler(req, res));
  app.all('/api/xtream-login', (req, res) => xtreamLoginHandler(req, res));
  app.all('/api/proxy-stream', (req, res) => proxyStreamHandler(req, res));

  // Ensure unmatched /api/* routes never return HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({error: 'API uç noktası bulunamadı.'});
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AyPi Tivi server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
