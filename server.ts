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

  function normalizeHttpUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `http://${trimmed}`;
  }

  function extractXtreamBaseUrl(raw: string): URL | null {
    const normalized = normalizeHttpUrl(raw);
    const parsed = validateRemoteUrl(normalized);
    if (!parsed) return null;
    // Strip trailing /player_api.php or /get.php if user pasted a full endpoint
    parsed.pathname = parsed.pathname
      .replace(/\/(player_api|get|xmltv)\.php$/i, '')
      .replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed;
  }

  // Fetch remote M3U/M3U8 playlist bypassing browser CORS
  app.post('/api/fetch-m3u', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const targetUrl = validateRemoteUrl(normalizeHttpUrl(rawUrl));
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
    const timeout = setTimeout(() => controller.abort(), 20000);

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
        res.status(422).json({
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
          ? 'Bağlantı zaman aşımına uğradı (20 saniye).'
          : 'Bağlantıya erişilemedi. Adresi ve internet erişimini kontrol edin.';
      res.status(422).json({error: message});
    } finally {
      clearTimeout(timeout);
    }
  });

  // Xtream Codes / Server Login endpoint (username, password, server URL)
  app.post('/api/xtream-login', async (req, res) => {
    const rawServerUrl = typeof req.body?.serverUrl === 'string' ? req.body.serverUrl : '';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!username || !password) {
      res.status(400).json({error: 'Kullanıcı adı ve şifre zorunludur.'});
      return;
    }

    const baseUrl = extractXtreamBaseUrl(rawServerUrl);
    if (!baseUrl) {
      res.status(400).json({error: 'Geçerli bir Sunucu URL adresi girin (örn: http://sunucu.com:8080).'});
      return;
    }

    const baseOrigin = baseUrl.toString().replace(/\/+$/, '');
    const encodedUser = encodeURIComponent(username);
    const encodedPass = encodeURIComponent(password);

    const requestHeaders = {
      'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
      Accept: '*/*',
    };

    let accountInfo: {status?: string; expDate?: string; maxConnections?: string} | undefined;
    let playerApiReachable = false;

    // Step 1: Validate credentials via player_api.php if available
    try {
      const authController = new AbortController();
      const authTimer = setTimeout(() => authController.abort(), 12000);
      try {
        const authRes = await fetch(
          `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}`,
          {signal: authController.signal, headers: requestHeaders, redirect: 'follow'},
        );
        if (authRes.ok) {
          const authText = await authRes.text();
          try {
            const authJson = JSON.parse(authText) as {
              user_info?: {
                auth?: number | string;
                status?: string;
                exp_date?: string | null;
                max_connections?: string;
              };
            };
            if (authJson?.user_info) {
              playerApiReachable = true;
              if (Number(authJson.user_info.auth) === 0) {
                res.status(401).json({error: 'Kullanıcı adı veya şifre hatalı.'});
                return;
              }
              const status = authJson.user_info.status;
              if (status && status.toLowerCase() !== 'active') {
                res.status(403).json({
                  error: `Hesap aktif değil (${status}). Aboneliğinizi kontrol edin.`,
                });
                return;
              }
              accountInfo = {
                status: authJson.user_info.status,
                expDate: authJson.user_info.exp_date || undefined,
                maxConnections: authJson.user_info.max_connections,
              };
            }
          } catch {
            // Non-JSON player_api response; continue to get.php
          }
        }
      } finally {
        clearTimeout(authTimer);
      }
    } catch {
      // Ignore auth check error and still attempt get.php
    }

    // Step 2: Fetch M3U Plus playlist (try m3u8 first, then ts)
    const formats = ['m3u8', 'ts'];
    for (const fmt of formats) {
      const m3uController = new AbortController();
      const m3uTimer = setTimeout(() => m3uController.abort(), 25000);
      try {
        const m3uUrl = `${baseOrigin}/get.php?username=${encodedUser}&password=${encodedPass}&type=m3u_plus&output=${fmt}`;
        const m3uRes = await fetch(m3uUrl, {
          signal: m3uController.signal,
          headers: requestHeaders,
          redirect: 'follow',
        });

        if (m3uRes.ok) {
          const contentLengthHeader = m3uRes.headers.get('content-length');
          if (contentLengthHeader && Number(contentLengthHeader) > MAX_M3U_BYTES) {
            res.status(413).json({error: 'Sunucu listesi 35 MB sınırını aşıyor.'});
            return;
          }
          const buffer = await m3uRes.arrayBuffer();
          if (buffer.byteLength > MAX_M3U_BYTES) {
            res.status(413).json({error: 'Sunucu listesi 35 MB sınırını aşıyor.'});
            return;
          }
          const content = new TextDecoder('utf-8').decode(buffer);
          if (content.includes('#EXTINF') || content.includes('#EXTM3U')) {
            res.json({
              content,
              serverOrigin: baseOrigin,
              accountInfo,
            });
            return;
          }
        }
      } catch {
        // Try next format or API fallback
      } finally {
        clearTimeout(m3uTimer);
      }
    }

    // Step 3: Fallback to player_api.php streams if get.php is disabled on server
    if (playerApiReachable) {
      const apiController = new AbortController();
      const apiTimer = setTimeout(() => apiController.abort(), 20000);
      try {
        const [liveCatRes, liveRes, vodCatRes, vodRes] = await Promise.all([
          fetch(
            `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_live_categories`,
            {signal: apiController.signal, headers: requestHeaders},
          ).catch(() => null),
          fetch(
            `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_live_streams`,
            {signal: apiController.signal, headers: requestHeaders},
          ).catch(() => null),
          fetch(
            `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_vod_categories`,
            {signal: apiController.signal, headers: requestHeaders},
          ).catch(() => null),
          fetch(
            `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_vod_streams`,
            {signal: apiController.signal, headers: requestHeaders},
          ).catch(() => null),
        ]);

        const liveCatMap = new Map<string, string>();
        if (liveCatRes?.ok) {
          const cats = (await liveCatRes.json().catch(() => [])) as Array<{
            category_id?: string | number;
            category_name?: string;
          }>;
          for (const c of cats) {
            if (c.category_id && c.category_name) {
              liveCatMap.set(String(c.category_id), c.category_name);
            }
          }
        }

        const vodCatMap = new Map<string, string>();
        if (vodCatRes?.ok) {
          const cats = (await vodCatRes.json().catch(() => [])) as Array<{
            category_id?: string | number;
            category_name?: string;
          }>;
          for (const c of cats) {
            if (c.category_id && c.category_name) {
              vodCatMap.set(String(c.category_id), c.category_name);
            }
          }
        }

        const lines: string[] = ['#EXTM3U'];

        if (liveRes?.ok) {
          const lives = (await liveRes.json().catch(() => [])) as Array<{
            stream_id?: number | string;
            name?: string;
            stream_icon?: string;
            category_id?: string | number;
            epg_channel_id?: string;
          }>;
          for (const ch of lives) {
            if (!ch.stream_id) continue;
            const grp = liveCatMap.get(String(ch.category_id || '')) || 'Canlı TV';
            const logo = (ch.stream_icon || '').replace(/"/g, '');
            const title = (ch.name || `Kanal ${ch.stream_id}`).replace(/\r?\n/g, ' ');
            const epg = (ch.epg_channel_id || '').replace(/"/g, '');
            lines.push(
              `#EXTINF:-1 tvg-id="${epg}" tvg-logo="${logo}" tvg-type="live" group-title="${grp}",${title}`,
            );
            lines.push(`${baseOrigin}/live/${encodedUser}/${encodedPass}/${ch.stream_id}.m3u8`);
          }
        }

        if (vodRes?.ok) {
          const vods = (await vodRes.json().catch(() => [])) as Array<{
            stream_id?: number | string;
            name?: string;
            stream_icon?: string;
            category_id?: string | number;
            container_extension?: string;
          }>;
          for (const v of vods) {
            if (!v.stream_id) continue;
            const grp = vodCatMap.get(String(v.category_id || '')) || 'Filmler';
            const logo = (v.stream_icon || '').replace(/"/g, '');
            const title = (v.name || `Film ${v.stream_id}`).replace(/\r?\n/g, ' ');
            const ext = v.container_extension || 'mp4';
            lines.push(
              `#EXTINF:-1 tvg-logo="${logo}" tvg-type="movie" group-title="${grp}",${title}`,
            );
            lines.push(`${baseOrigin}/movie/${encodedUser}/${encodedPass}/${v.stream_id}.${ext}`);
          }
        }

        if (lines.length > 1) {
          res.json({
            content: lines.join('\n'),
            serverOrigin: baseOrigin,
            accountInfo,
          });
          return;
        }
      } finally {
        clearTimeout(apiTimer);
      }
    }

    res.status(422).json({
      error:
        'Sunucuya bağlanılamadı veya geçerli bir yayın listesi alınamadı. Sunucu adresini, kullanıcı adını ve şifreyi kontrol edin.',
    });
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
