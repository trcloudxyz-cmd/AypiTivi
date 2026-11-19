import type {IncomingMessage, ServerResponse} from 'node:http';

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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const reqUrl = new URL(req.url || '/', 'http://localhost');
  const rawUrl = reqUrl.searchParams.get('url') || '';
  const targetUrl = validateRemoteUrl(rawUrl);

  if (!targetUrl) {
    res.statusCode = 400;
    res.end('Invalid stream URL');
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
      res.statusCode = upstream.status;
      res.end(`Upstream error ${upstream.status}`);
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
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.end(rewritten);
      return;
    }

    res.statusCode = upstream.status;
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
      res.statusCode = 502;
      res.end('Stream proxy error');
    } else {
      res.end();
    }
  } finally {
    clearTimeout(connectTimeout);
  }
}
