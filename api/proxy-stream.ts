import {once} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';

const IPTV_USER_AGENTS = [
  'IPTVSmartersPro/1.0',
  'VLC/3.0.20 LibVLC/3.0.20',
  'Lavf/58.76.100',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 6;

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

async function fetchWithRedirects(
  initialUrl: URL,
  userAgent: string,
  rangeHeader: string | undefined,
  signal: AbortSignal,
): Promise<{response: Response; finalUrl: string}> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: '*/*',
      Connection: 'keep-alive',
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const response = await fetch(currentUrl.toString(), {
      signal,
      headers,
      redirect: 'manual',
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get('location')
    ) {
      const location = response.headers.get('location')!;
      await response.body?.cancel().catch(() => {});
      const nextUrl = new URL(location, currentUrl);
      if (
        (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') ||
        isBlockedHostname(nextUrl.hostname)
      ) {
        throw new Error('Blocked redirect destination');
      }
      currentUrl = nextUrl;
      continue;
    }

    return {response, finalUrl: response.url || currentUrl.toString()};
  }

  throw new Error('Too many redirects');
}

function looksLikeM3u8Buffer(buf: Uint8Array): boolean {
  const sample = Buffer.from(buf.subarray(0, 512))
    .toString('utf-8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  return sample.startsWith('#EXTM3U');
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, X-Proxy-Upstream-Status');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', 'http://localhost');
  const rawUrl = reqUrl.searchParams.get('url') || '';
  const targetUrl = validateRemoteUrl(rawUrl);

  if (!targetUrl) {
    res.statusCode = 400;
    res.end('Invalid stream URL');
    return;
  }

  const controller = new AbortController();
  const connectTimeout = setTimeout(() => controller.abort(), 18000);
  res.on('close', () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });

  try {
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    let upstream: Response | null = null;
    let finalUrl = targetUrl.toString();

    for (const ua of IPTV_USER_AGENTS) {
      const attempt = await fetchWithRedirects(targetUrl, ua, rangeHeader, controller.signal);
      upstream = attempt.response;
      finalUrl = attempt.finalUrl;

      if (
        upstream.ok ||
        upstream.status === 206 ||
        (upstream.status !== 401 &&
          upstream.status !== 403 &&
          upstream.status !== 406 &&
          upstream.status !== 429 &&
          upstream.status !== 503)
      ) {
        break;
      }

      await upstream.body?.cancel().catch(() => {});
    }

    clearTimeout(connectTimeout);

    if (!upstream) {
      res.statusCode = 502;
      res.setHeader('X-Proxy-Upstream-Status', '502');
      res.end('Upstream connection failed');
      return;
    }

    res.setHeader('X-Proxy-Upstream-Status', String(upstream.status));

    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => {});
      res.statusCode = upstream.status;
      res.end(`Upstream error ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const lowerCt = contentType.toLowerCase();
    const isExplicitM3u8Ct =
      lowerCt.includes('mpegurl') || lowerCt.includes('m3u');
    const isVideoCt =
      lowerCt.startsWith('video/') ||
      lowerCt.startsWith('audio/') ||
      lowerCt.includes('mp2t');

    if (!upstream.body) {
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', contentType);
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const firstRead = await reader.read();

    if (firstRead.done || !firstRead.value) {
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', contentType);
      res.end();
      return;
    }

    const firstChunk = firstRead.value;
    const isM3u8Payload =
      looksLikeM3u8Buffer(firstChunk) ||
      (isExplicitM3u8Ct && !isVideoCt);

    if (isM3u8Payload) {
      const chunks: Uint8Array[] = [firstChunk];
      let totalBytes = firstChunk.byteLength;

      while (totalBytes < MAX_MANIFEST_BYTES) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.byteLength;
        }
      }

      const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const text = combined.toString('utf-8');
      const rewritten = rewriteM3u8Manifest(text, finalUrl);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.end(rewritten);
      return;
    }

    // Binary video/audio/TS stream
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', contentType);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!res.writableEnded) {
      const canContinue = res.write(Buffer.from(firstChunk));
      if (!canContinue) {
        await once(res, 'drain');
      }
    }

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (res.writableEnded || res.destroyed) {
        await reader.cancel().catch(() => {});
        break;
      }
      const canContinue = res.write(Buffer.from(value));
      if (!canContinue && !res.writableEnded && !res.destroyed) {
        await once(res, 'drain');
      }
    }

    if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('X-Proxy-Upstream-Status', '502');
      res.end(err instanceof Error ? `Stream proxy error: ${err.message}` : 'Stream proxy error');
    } else if (!res.writableEnded) {
      res.end();
    }
  } finally {
    clearTimeout(connectTimeout);
  }
}
