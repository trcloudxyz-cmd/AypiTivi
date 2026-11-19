import type {IncomingMessage, ServerResponse} from 'node:http';

const MAX_M3U_BYTES = 35 * 1024 * 1024;
const DIRECT_STREAM_EXTENSIONS = ['.ts', '.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv'];
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

function validateRemoteUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(normalizeHttpUrl(rawUrl));
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
  const rawUrl = typeof body.url === 'string' ? body.url : '';
  const targetUrl = validateRemoteUrl(rawUrl);
  if (!targetUrl) {
    sendJson(res, 400, {error: 'Geçerli bir http:// veya https:// bağlantısı girin.'});
    return;
  }

  const lowerPath = targetUrl.pathname.toLowerCase();
  if (DIRECT_STREAM_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    sendJson(res, 200, {
      isDirectStream: true,
      finalUrl: targetUrl.toString(),
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 24000);

  try {
    const upstream = await fetchIptv(targetUrl.toString(), controller.signal);

    if (!upstream.ok) {
      sendJson(res, 422, {
        error: `Uzak sunucu ${upstream.status} (${upstream.statusText}) yanıtı döndürdü.`,
      });
      return;
    }

    // Only treat explicit video/* or audio/* (excluding mpegurl) as direct stream;
    // Many IPTV panels serve M3U playlists as application/octet-stream!
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isMediaBinary =
      (contentType.startsWith('video/') || contentType.startsWith('audio/')) &&
      !contentType.includes('mpegurl');

    if (isMediaBinary) {
      await upstream.body?.cancel().catch(() => {});
      sendJson(res, 200, {
        isDirectStream: true,
        finalUrl: upstream.url || targetUrl.toString(),
      });
      return;
    }

    const contentLengthHeader = upstream.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_M3U_BYTES) {
      sendJson(res, 413, {error: 'M3U dosyası 35 MB sınırını aşıyor.'});
      return;
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_M3U_BYTES) {
      sendJson(res, 413, {error: 'M3U dosyası 35 MB sınırını aşıyor.'});
      return;
    }

    const content = new TextDecoder('utf-8').decode(buffer);
    sendJson(res, 200, {
      isDirectStream: false,
      content,
      finalUrl: upstream.url || targetUrl.toString(),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Bağlantı zaman aşımına uğradı (24 saniye).'
        : 'Bağlantıya erişilemedi. Adresi ve internet erişimini kontrol edin.';
    sendJson(res, 422, {error: message});
  } finally {
    clearTimeout(timeout);
  }
}
