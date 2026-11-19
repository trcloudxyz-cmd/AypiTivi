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

async function fetchJsonSafe<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetchIptv(url, signal);
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractQuality(title: string): string | undefined {
  const upper = title.toUpperCase();
  if (/\b(4K|UHD|2160P)\b/.test(upper)) return '4K';
  if (/\b(FHD|1080P|FULL HD)\b/.test(upper)) return 'FHD';
  if (/\b(HD|720P)\b/.test(upper)) return 'HD';
  if (/\b(SD|480P)\b/.test(upper)) return 'SD';
  return undefined;
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
  const action = typeof body.action === 'string' ? body.action : 'auth';
  const seriesId = typeof body.seriesId === 'string' ? body.seriesId.trim() : '';
  const seriesTitle = typeof body.seriesTitle === 'string' ? body.seriesTitle.trim() : '';
  const seriesGroup = typeof body.seriesGroup === 'string' ? body.seriesGroup.trim() : 'Diziler';
  const seriesLogo = typeof body.seriesLogo === 'string' ? body.seriesLogo.trim() : undefined;

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
  const apiBase = `${baseOrigin}/player_api.php?username=${encodedUser}&password=${encodedPass}`;

  // Fetch episodes for a specific series on demand
  if (action === 'series_info' && seriesId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const info = await fetchJsonSafe<{
        info?: {name?: string; cover?: string};
        episodes?: Record<
          string,
          Array<{
            id?: string | number;
            episode_num?: number | string;
            title?: string;
            container_extension?: string;
            season?: number | string;
            info?: {movie_image?: string};
          }>
        >;
      }>(`${apiBase}&action=get_series_info&series_id=${encodeURIComponent(seriesId)}`, controller.signal);

      if (!info || !info.episodes) {
        sendJson(res, 422, {error: 'Dizi bölümleri alınamadı.'});
        return;
      }

      const resolvedTitle = seriesTitle || info.info?.name || 'Dizi';
      const episodes: Array<Record<string, unknown>> = [];
      let idx = 1;

      const seasonKeys = Object.keys(info.episodes).sort((a, b) => Number(a) - Number(b));
      for (const sKey of seasonKeys) {
        const list = info.episodes[sKey] || [];
        for (const ep of list) {
          if (!ep.id) continue;
          const seasonNum = Number(ep.season ?? sKey) || 1;
          const epNum = Number(ep.episode_num) || idx;
          const ext = ep.container_extension || 'mp4';
          const epCode = `S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
          const epName = ep.title ? `${resolvedTitle} ${epCode} · ${ep.title}` : `${resolvedTitle} ${epCode}`;
          episodes.push({
            id: `xt_ep_${ep.id}`,
            index: idx++,
            name: epName,
            url: `${baseOrigin}/series/${encodedUser}/${encodedPass}/${ep.id}.${ext}`,
            logo: ep.info?.movie_image || seriesLogo || info.info?.cover || undefined,
            group: seriesGroup,
            mediaType: 'series',
            seriesTitle: resolvedTitle,
            season: seasonNum,
            episode: epNum,
          });
        }
      }

      sendJson(res, 200, {episodes});
      return;
    } finally {
      clearTimeout(timer);
    }
  }

  // Action: fetch live, movie, or series list separately (keeps responses fast & under payload limits)
  if (action === 'live' || action === 'movie' || action === 'series') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);
    try {
      if (action === 'live') {
        const [cats, streams] = await Promise.all([
          fetchJsonSafe<Array<{category_id?: string | number; category_name?: string}>>(
            `${apiBase}&action=get_live_categories`,
            controller.signal,
          ),
          fetchJsonSafe<
            Array<{
              stream_id?: string | number;
              name?: string;
              stream_icon?: string;
              category_id?: string | number;
              epg_channel_id?: string;
            }>
          >(`${apiBase}&action=get_live_streams`, controller.signal),
        ]);
        const catMap = new Map<string, string>();
        for (const c of cats || []) {
          if (c.category_id && c.category_name) catMap.set(String(c.category_id), c.category_name);
        }
        const items = (streams || [])
          .filter((s) => s.stream_id)
          .map((s, idx) => {
            const name = s.name || `Kanal ${s.stream_id}`;
            return {
              id: `xt_live_${s.stream_id}`,
              index: idx + 1,
              name,
              url: `${baseOrigin}/live/${encodedUser}/${encodedPass}/${s.stream_id}.m3u8`,
              logo: s.stream_icon || undefined,
              group: catMap.get(String(s.category_id || '')) || 'Canlı TV',
              mediaType: 'live',
              tvgId: s.epg_channel_id || undefined,
              qualityLabel: extractQuality(name),
            };
          });
        sendJson(res, 200, {items});
        return;
      }

      if (action === 'movie') {
        const [cats, streams] = await Promise.all([
          fetchJsonSafe<Array<{category_id?: string | number; category_name?: string}>>(
            `${apiBase}&action=get_vod_categories`,
            controller.signal,
          ),
          fetchJsonSafe<
            Array<{
              stream_id?: string | number;
              name?: string;
              stream_icon?: string;
              category_id?: string | number;
              container_extension?: string;
              rating?: string | number;
            }>
          >(`${apiBase}&action=get_vod_streams`, controller.signal),
        ]);
        const catMap = new Map<string, string>();
        for (const c of cats || []) {
          if (c.category_id && c.category_name) catMap.set(String(c.category_id), c.category_name);
        }
        const items = (streams || [])
          .filter((s) => s.stream_id)
          .map((s, idx) => {
            const name = s.name || `Film ${s.stream_id}`;
            const ext = s.container_extension || 'mp4';
            return {
              id: `xt_vod_${s.stream_id}`,
              index: idx + 1,
              name,
              url: `${baseOrigin}/movie/${encodedUser}/${encodedPass}/${s.stream_id}.${ext}`,
              logo: s.stream_icon || undefined,
              group: catMap.get(String(s.category_id || '')) || 'Filmler',
              mediaType: 'movie',
              rating: s.rating ? String(s.rating) : undefined,
              qualityLabel: extractQuality(name),
            };
          });
        sendJson(res, 200, {items});
        return;
      }

      if (action === 'series') {
        const [cats, seriesList] = await Promise.all([
          fetchJsonSafe<Array<{category_id?: string | number; category_name?: string}>>(
            `${apiBase}&action=get_series_categories`,
            controller.signal,
          ),
          fetchJsonSafe<
            Array<{
              series_id?: string | number;
              name?: string;
              cover?: string;
              category_id?: string | number;
              rating?: string | number;
            }>
          >(`${apiBase}&action=get_series`, controller.signal),
        ]);
        const catMap = new Map<string, string>();
        for (const c of cats || []) {
          if (c.category_id && c.category_name) catMap.set(String(c.category_id), c.category_name);
        }
        const items = (seriesList || [])
          .filter((s) => s.series_id)
          .map((s, idx) => ({
            id: `xt_series_${s.series_id}`,
            seriesId: String(s.series_id),
            isSeriesFolder: true,
            index: idx + 1,
            name: s.name || `Dizi ${s.series_id}`,
            seriesTitle: s.name || `Dizi ${s.series_id}`,
            url: '',
            logo: s.cover || undefined,
            group: catMap.get(String(s.category_id || '')) || 'Diziler',
            mediaType: 'series',
            rating: s.rating ? String(s.rating) : undefined,
          }));
        sendJson(res, 200, {items});
        return;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Default action ('auth'): Validate credentials via player_api.php, or fallback to get.php
  let accountInfo: {status?: string; expDate?: string; maxConnections?: string} | undefined;
  let playerApiSupported = false;
  let resolvedServerOrigin = baseOrigin;

  try {
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), 12000);
    try {
      const authJson = await fetchJsonSafe<{
        user_info?: {
          auth?: number | string;
          status?: string;
          exp_date?: string | null;
          max_connections?: string;
        };
        server_info?: {
          url?: string;
          port?: string | number;
          https_port?: string | number;
          server_protocol?: string;
        };
      }>(apiBase, authController.signal);

      if (authJson?.user_info) {
        playerApiSupported = true;
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

        const si = authJson.server_info;
        if (
          si?.server_protocol?.toLowerCase() === 'https' &&
          si.url &&
          !isBlockedHostname(si.url)
        ) {
          const httpsPort = si.https_port ? String(si.https_port).trim() : '443';
          const portSuffix = httpsPort && httpsPort !== '443' ? `:${httpsPort}` : '';
          const candidate = extractXtreamBaseUrl(`https://${si.url}${portSuffix}`);
          if (candidate) {
            resolvedServerOrigin = candidate.toString().replace(/\/+$/, '');
          }
        }
      }
    } finally {
      clearTimeout(authTimer);
    }
  } catch {
    // Fallback to get.php below
  }

  if (playerApiSupported) {
    sendJson(res, 200, {
      mode: 'xtream',
      serverOrigin: resolvedServerOrigin,
      accountInfo,
    });
    return;
  }

  // Fallback to get.php if server doesn't expose player_api.php
  for (const fmt of ['m3u8', 'ts']) {
    const m3uController = new AbortController();
    const m3uTimer = setTimeout(() => m3uController.abort(), 24000);
    try {
      const m3uUrl = `${baseOrigin}/get.php?username=${encodedUser}&password=${encodedPass}&type=m3u_plus&output=${fmt}`;
      const m3uRes = await fetchIptv(m3uUrl, m3uController.signal);
      if (m3uRes.ok) {
        const buffer = await m3uRes.arrayBuffer();
        if (buffer.byteLength <= MAX_M3U_BYTES) {
          const content = new TextDecoder('utf-8').decode(buffer);
          if (content.includes('#EXTINF') || content.includes('#EXTM3U')) {
            sendJson(res, 200, {
              mode: 'm3u',
              content,
              serverOrigin: baseOrigin,
              accountInfo,
            });
            return;
          }
        }
      }
    } catch {
      // Try next format
    } finally {
      clearTimeout(m3uTimer);
    }
  }

  sendJson(res, 422, {
    error:
      'Sunucuya bağlanılamadı veya geçerli bir yayın listesi alınamadı. Sunucu adresini, kullanıcı adını ve şifreyi kontrol edin.',
  });
}
