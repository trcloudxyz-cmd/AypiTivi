import type {IncomingMessage, ServerResponse} from 'node:http';

const MAX_M3U_BYTES = 35 * 1024 * 1024;
const IPTV_USER_AGENTS = [
  'VLC/3.0.20 LibVLC/3.0.20',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

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

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function extractXtreamBaseUrl(raw: string): URL | null {
  try {
    const parsed = new URL(normalizeHttpUrl(raw));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }
    parsed.pathname = parsed.pathname
      .replace(/\/(player_api|get|xmltv)\.php$/i, '')
      .replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

async function readJsonBody(req: IncomingMessage & {body?: unknown}): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function fetchIptv(url: string, signal: AbortSignal): Promise<Response> {
  let lastRes: Response | null = null;
  for (const ua of IPTV_USER_AGENTS) {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': ua,
        Accept: '*/*',
      },
      redirect: 'follow',
    });
    if (res.ok || (res.status !== 403 && res.status !== 406 && res.status !== 503)) {
      return res;
    }
    await res.body?.cancel().catch(() => {});
    lastRes = res;
  }
  return lastRes!;
}

export default async function handler(
  req: IncomingMessage & {body?: unknown},
  res: ServerResponse,
) {
  if (req.method !== 'POST') {
    sendJson(res, 405, {error: 'Method not allowed'});
    return;
  }

  const body = await readJsonBody(req);
  const rawServerUrl = typeof body.serverUrl === 'string' ? body.serverUrl : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  if (!username || !password) {
    sendJson(res, 400, {error: 'Kullanıcı adı ve şifre zorunludur.'});
    return;
  }

  const baseUrl = extractXtreamBaseUrl(rawServerUrl);
  if (!baseUrl) {
    sendJson(res, 400, {
      error: 'Geçerli bir Sunucu URL adresi girin (örn: http://sunucu.com:8080).',
    });
    return;
  }

  const baseOrigin = baseUrl.toString().replace(/\/+$/, '');
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(password);

  let accountInfo: {status?: string; expDate?: string; maxConnections?: string} | undefined;
  let playerApiReachable = false;

  // Step 1: Validate credentials via player_api.php if available
  try {
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), 12000);
    try {
      const authRes = await fetchIptv(
        `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}`,
        authController.signal,
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
              sendJson(res, 401, {error: 'Kullanıcı adı veya şifre hatalı.'});
              return;
            }
            const status = authJson.user_info.status;
            if (status && status.toLowerCase() !== 'active') {
              sendJson(res, 403, {
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
    // Ignore auth check error and attempt get.php
  }

  // Step 2: Fetch M3U Plus playlist
  for (const fmt of ['m3u8', 'ts']) {
    const m3uController = new AbortController();
    const m3uTimer = setTimeout(() => m3uController.abort(), 25000);
    try {
      const m3uUrl = `${baseOrigin}/get.php?username=${encodedUser}&password=${encodedPass}&type=m3u_plus&output=${fmt}`;
      const m3uRes = await fetchIptv(m3uUrl, m3uController.signal);
      if (m3uRes.ok) {
        const contentLengthHeader = m3uRes.headers.get('content-length');
        if (contentLengthHeader && Number(contentLengthHeader) > MAX_M3U_BYTES) {
          sendJson(res, 413, {error: 'Sunucu listesi 35 MB sınırını aşıyor.'});
          return;
        }
        const buffer = await m3uRes.arrayBuffer();
        if (buffer.byteLength > MAX_M3U_BYTES) {
          sendJson(res, 413, {error: 'Sunucu listesi 35 MB sınırını aşıyor.'});
          return;
        }
        const content = new TextDecoder('utf-8').decode(buffer);
        if (content.includes('#EXTINF') || content.includes('#EXTM3U')) {
          sendJson(res, 200, {
            content,
            serverOrigin: baseOrigin,
            accountInfo,
          });
          return;
        }
      }
    } catch {
      // Try next format
    } finally {
      clearTimeout(m3uTimer);
    }
  }

  // Step 3: Fallback to player_api.php streams if get.php is unavailable
  if (playerApiReachable) {
    const apiController = new AbortController();
    const apiTimer = setTimeout(() => apiController.abort(), 20000);
    try {
      const [liveCatRes, liveRes, vodCatRes, vodRes] = await Promise.all([
        fetchIptv(
          `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_live_categories`,
          apiController.signal,
        ).catch(() => null),
        fetchIptv(
          `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_live_streams`,
          apiController.signal,
        ).catch(() => null),
        fetchIptv(
          `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_vod_categories`,
          apiController.signal,
        ).catch(() => null),
        fetchIptv(
          `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_vod_streams`,
          apiController.signal,
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
        sendJson(res, 200, {
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

  sendJson(res, 422, {
    error:
      'Sunucuya bağlanılamadı veya geçerli bir yayın listesi alınamadı. Sunucu adresini, kullanıcı adını ve şifreyi kontrol edin.',
  });
}
