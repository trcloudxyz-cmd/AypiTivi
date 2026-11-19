import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const MAX_M3U_BYTES = 35 * 1024 * 1024; // 35 MB limit

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // Block private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return true;
    }
  }
  return false;
}

function validateRemoteUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function rewriteM3u8Manifest(manifest: string, baseUrl: string): string {
  const lines = manifest.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." attributes inside tags like #EXT-X-KEY or #EXT-X-MEDIA
        return line.replace(/URI="([^"]+)"/g, (_match, uriValue: string) => {
          try {
            const resolved = new URL(uriValue, baseUrl).toString();
            return `URI="/api/proxy-stream?url=${encodeURIComponent(resolved)}"`;
          } catch {
            return `URI="${uriValue}"`;
          }
        });
      }
      try {
        const resolved = new URL(trimmed, baseUrl).toString();
        return `/api/proxy-stream?url=${encodeURIComponent(resolved)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '2mb'}));

const DIRECT_STREAM_EXTENSIONS = ['.ts', '.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv'];

  // Fetch remote M3U/M3U8 playlist bypassing browser CORS
  app.post('/api/fetch-m3u', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const targetUrl = validateRemoteUrl(rawUrl);
    if (!targetUrl) {
      res.status(400).json({error: 'Geçerli bir http:// veya https:// bağlantısı girin.'});
      return;
    }

    const lowerPath = targetUrl.pathname.toLowerCase();
    if (DIRECT_STREAM_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
      res.json({
        isDirectStream: true,
        finalUrl: targetUrl.toString(),
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);

    try {
      const upstream = await fetch(targetUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          Accept: '*/*',
        },
        redirect: 'follow',
      });

      if (!upstream.ok) {
        res.status(502).json({
          error: `Uzak sunucu ${upstream.status} (${upstream.statusText}) yanıtı döndürdü.`,
        });
        return;
      }

      const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
      const isMediaBinary =
        (contentType.startsWith('video/') ||
          contentType.startsWith('audio/') ||
          contentType === 'application/octet-stream') &&
        !contentType.includes('mpegurl');

      if (isMediaBinary) {
        await upstream.body?.cancel();
        res.json({
          isDirectStream: true,
          finalUrl: upstream.url || targetUrl.toString(),
        });
        return;
      }

      const contentLengthHeader = upstream.headers.get('content-length');
      if (contentLengthHeader && Number(contentLengthHeader) > MAX_M3U_BYTES) {
        res.status(413).json({error: 'M3U dosyası 35 MB sınırını aşıyor.'});
        return;
      }

      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > MAX_M3U_BYTES) {
        res.status(413).json({error: 'M3U dosyası 35 MB sınırını aşıyor.'});
        return;
      }

      const content = new TextDecoder('utf-8').decode(buffer);
      res.json({
        isDirectStream: false,
        content,
        finalUrl: upstream.url || targetUrl.toString(),
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Bağlantı zaman aşımına uğradı (18 saniye).'
          : 'Bağlantıya erişilemedi. Adresi ve internet erişimini kontrol edin.';
      res.status(502).json({error: message});
    } finally {
      clearTimeout(timeout);
    }
  });

  // Optional CORS/mixed-content stream proxy for HLS manifests, TS streams, and media segments
  app.get('/api/proxy-stream', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const targetUrl = validateRemoteUrl(rawUrl);
    if (!targetUrl) {
      res.status(400).send('Invalid stream URL');
      return;
    }

    const controller = new AbortController();
    const connectTimeout = setTimeout(() => controller.abort(), 20000);
    req.on('close', () => controller.abort());

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        Accept: '*/*',
      };
      if (typeof req.headers.range === 'string') {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(targetUrl.toString(), {
        signal: controller.signal,
        headers,
        redirect: 'follow',
      });
      clearTimeout(connectTimeout);

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send(`Upstream error ${upstream.status}`);
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const isM3u8 =
        contentType.includes('mpegurl') ||
        targetUrl.pathname.toLowerCase().endsWith('.m3u8') ||
        targetUrl.pathname.toLowerCase().endsWith('.m3u');

      res.setHeader('Access-Control-Allow-Origin', '*');

      if (isM3u8) {
        const text = await upstream.text();
        const rewritten = rewriteM3u8Manifest(text, upstream.url || targetUrl.toString());
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.status(200).send(rewritten);
        return;
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (!res.writableEnded) {
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(502).send('Stream proxy error');
      } else {
        res.end();
      }
    } finally {
      clearTimeout(connectTimeout);
    }
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
