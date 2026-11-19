import liveBroadcastImg from '../assets/images/sample_live_broadcast_1794570448528.jpg';
import docNatureImg from '../assets/images/sample_doc_nature_1794570449090.jpg';
import movieScifiImg from '../assets/images/sample_movie_scifi_1794570449092.jpg';
import seriesNoirImg from '../assets/images/sample_series_noir_1794570449857.jpg';
import type {ChannelItem, MediaCategory, Playlist, PlaylistStats} from '../types/iptv';

const SERIES_PATTERNS = [
  /\bS\d{1,2}\s*E\d{1,3}\b/i,
  /\b\d{1,2}x\d{1,3}\b/i,
  /\b(?:sezon|season)\s*\d+/i,
  /\b(?:bölüm|bolum|episode|ep\.?)\s*\d+/i,
];

const SERIES_GROUP_KEYWORDS = [
  'dizi',
  'diziler',
  'series',
  'tv show',
  'tv shows',
  'sezon',
  'bölüm',
  'episode',
  'yerli dizi',
  'yabancı dizi',
  'anime',
];

const MOVIE_GROUP_KEYWORDS = [
  'film',
  'filmler',
  'vod',
  'movie',
  'movies',
  'cinema',
  'sinema vod',
  'boxset',
  'yeşilçam',
  'yesilcam',
  'yerli film',
  'yabancı film',
  'animasyon film',
  'aksiyon',
  'komedi',
  'korku',
  'dram',
  'bilim kurgu',
];

const LIVE_GROUP_KEYWORDS = [
  'canlı',
  'canli',
  'live',
  'tv',
  'ulusal',
  'haber',
  'spor',
  'sport',
  'belgesel',
  'çocuk',
  'cocuk',
  'müzik',
  'muzik',
  'yerel',
  'genel',
  'radyo',
  'radio',
  'news',
  'kanal',
];

const VOD_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.flv', '.wmv'];

function extractAttribute(meta: string, attr: string): string | undefined {
  const doubleQuoted = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i').exec(meta);
  if (doubleQuoted?.[1]) return doubleQuoted[1].trim();
  const singleQuoted = new RegExp(`${attr}\\s*=\\s*'([^']*)'`, 'i').exec(meta);
  if (singleQuoted?.[1]) return singleQuoted[1].trim();
  const unquoted = new RegExp(`${attr}\\s*=\\s*([^\\s,]+)`, 'i').exec(meta);
  if (unquoted?.[1]) return unquoted[1].trim();
  return undefined;
}

function extractQualityLabel(title: string): string | undefined {
  const upper = title.toUpperCase();
  if (/\b(4K|UHD|2160P)\b/.test(upper)) return '4K';
  if (/\b(FHD|1080P|FULL HD)\b/.test(upper)) return 'FHD';
  if (/\b(HD|720P)\b/.test(upper)) return 'HD';
  if (/\b(SD|480P)\b/.test(upper)) return 'SD';
  return undefined;
}

function parseSeriesInfo(title: string): {
  seriesTitle?: string;
  season?: number;
  episode?: number;
} {
  // Match "Show Name S01E02" or "Show Name - S01 E02"
  const seMatch = /^(.*?)\s*[-–|:]?\s*S(\d{1,2})\s*E(\d{1,3})\b/i.exec(title);
  if (seMatch) {
    return {
      seriesTitle: seMatch[1].trim() || title,
      season: Number(seMatch[2]),
      episode: Number(seMatch[3]),
    };
  }

  // Match "Show Name 1x02"
  const xMatch = /^(.*?)\s*[-–|:]?\s*(\d{1,2})x(\d{1,3})\b/i.exec(title);
  if (xMatch) {
    return {
      seriesTitle: xMatch[1].trim() || title,
      season: Number(xMatch[2]),
      episode: Number(xMatch[3]),
    };
  }

  // Match "Show Name 1. Sezon 2. Bölüm"
  const trMatch = /^(.*?)\s*[-–|:]?\s*(\d{1,2})\.?\s*(?:sezon|season)\s*(\d{1,3})\.?\s*(?:bölüm|bolum|episode)/i.exec(
    title,
  );
  if (trMatch) {
    return {
      seriesTitle: trMatch[1].trim() || title,
      season: Number(trMatch[2]),
      episode: Number(trMatch[3]),
    };
  }

  return {};
}

export function classifyMediaType(
  title: string,
  group: string,
  url: string,
  tvgType?: string,
): MediaCategory {
  const lowerUrl = url.toLowerCase();
  const lowerGroup = group.toLowerCase();
  const lowerType = (tvgType || '').toLowerCase();

  // Explicit tvg-type
  if (lowerType === 'series' || lowerType === 'dizi') return 'series';
  if (lowerType === 'movie' || lowerType === 'vod' || lowerType === 'film') return 'movie';
  if (lowerType === 'live' || lowerType === 'tv') return 'live';

  // URL path signals (Xtream Codes & standard IPTV URL structure)
  if (lowerUrl.includes('/series/') || lowerUrl.includes('/dizi/')) return 'series';
  if (lowerUrl.includes('/movie/') || lowerUrl.includes('/vod/') || lowerUrl.includes('/film/')) {
    return 'movie';
  }

  // Title episode pattern strongly indicates series
  if (SERIES_PATTERNS.some((pattern) => pattern.test(title))) {
    return 'series';
  }

  // Group keyword checks
  if (SERIES_GROUP_KEYWORDS.some((kw) => lowerGroup.includes(kw))) {
    return 'series';
  }

  const hasVodExtension = VOD_EXTENSIONS.some((ext) => lowerUrl.split('?')[0].endsWith(ext));
  const hasLiveGroup = LIVE_GROUP_KEYWORDS.some((kw) => lowerGroup.includes(kw));
  const hasMovieGroup = MOVIE_GROUP_KEYWORDS.some((kw) => lowerGroup.includes(kw));

  // Distinguish "Sinema TV" live channels (.m3u8/.ts without VOD extension) vs actual VOD movies
  if (hasVodExtension) {
    return 'movie';
  }

  if (hasMovieGroup && !lowerUrl.includes('/live/') && !lowerGroup.includes('tv')) {
    return 'movie';
  }

  if (hasLiveGroup || lowerUrl.includes('/live/') || lowerUrl.endsWith('.ts')) {
    return 'live';
  }

  // Year in parentheses like "Inception (2010)" with movie-like group
  if (/\(\d{4}\)/.test(title) && !lowerUrl.includes('/live/')) {
    return 'movie';
  }

  return 'live';
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deriveTitleFromUrl(url: string, fallbackIndex: number): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const cleaned = decodeURIComponent(last)
        .replace(/\.(m3u8?|ts|mp4|mkv|avi|mov|m4v|webm|flv)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      if (cleaned) return cleaned;
    }
    if (parsed.hostname && parsed.hostname !== 'localhost') {
      return parsed.hostname.replace(/^www\./, '');
    }
  } catch {
    // Use fallback
  }
  return `Kanal ${fallbackIndex}`;
}

export function isHlsStreamManifest(content: string): boolean {
  return (
    /#EXT-X-TARGETDURATION/i.test(content) ||
    /#EXT-X-MEDIA-SEQUENCE/i.test(content) ||
    /#EXT-X-STREAM-INF/i.test(content)
  );
}

export function createDirectStreamItem(
  url: string,
  customName?: string,
  index = 1,
  streamFormat?: ChannelItem['streamFormat'],
): ChannelItem {
  const name = customName?.trim() || deriveTitleFromUrl(url, index);
  const group = 'Doğrudan Yayınlar';
  const mediaType = classifyMediaType(name, group, url);
  const seriesInfo = mediaType === 'series' ? parseSeriesInfo(name) : {};
  const qualityLabel = extractQualityLabel(name);

  return {
    id: `${stableHash(url + name)}_${index}`,
    index,
    name,
    url,
    group,
    mediaType,
    qualityLabel,
    streamFormat,
    ...seriesInfo,
  };
}

export function parseM3U(content: string): ChannelItem[] {
  const cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/);

  const items: ChannelItem[] = [];
  let pendingMeta = '';
  let pendingGroup = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      pendingMeta = line;
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice(8).trim();
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // Stream URL line (or "Channel Name | https://..." shortcut)
    const pipeMatch = /^(.+?)\s*\|\s*((?:https?|rtmp|rtsp|udp|mms):\/\/\S+)$/i.exec(line);
    const streamUrl = pipeMatch ? pipeMatch[2].trim() : line;
    const inlineTitle = pipeMatch ? pipeMatch[1].trim() : '';

    if (/^(https?|rtmp|rtsp|udp|mms):\/\//i.test(streamUrl) || streamUrl.startsWith('/')) {
      const commaIndex = pendingMeta.lastIndexOf(',');
      const attrPart = commaIndex >= 0 ? pendingMeta.slice(0, commaIndex) : pendingMeta;
      const rawTitle = commaIndex >= 0 ? pendingMeta.slice(commaIndex + 1).trim() : '';

      const tvgName = extractAttribute(attrPart, 'tvg-name');
      const tvgId = extractAttribute(attrPart, 'tvg-id');
      const logo = extractAttribute(attrPart, 'tvg-logo');
      const attrGroup = extractAttribute(attrPart, 'group-title');
      const tvgType =
        extractAttribute(attrPart, 'tvg-type') || extractAttribute(attrPart, 'type');

      const name =
        rawTitle ||
        inlineTitle ||
        tvgName ||
        deriveTitleFromUrl(streamUrl, items.length + 1);
      const group = attrGroup || pendingGroup || 'Genel';
      const mediaType = classifyMediaType(name, group, streamUrl, tvgType);
      const seriesInfo = mediaType === 'series' ? parseSeriesInfo(name) : {};
      const qualityLabel = extractQualityLabel(name);

      items.push({
        id: `${stableHash(streamUrl + name)}_${items.length}`,
        index: items.length + 1,
        name,
        url: streamUrl,
        logo: logo || undefined,
        group,
        mediaType,
        tvgId: tvgId || undefined,
        tvgName: tvgName || undefined,
        qualityLabel,
        ...seriesInfo,
      });

      pendingMeta = '';
      pendingGroup = '';
    } else {
      pendingMeta = '';
      pendingGroup = '';
    }
  }

  return items;
}

export function computePlaylistStats(items: ChannelItem[]): PlaylistStats {
  let live = 0;
  let movie = 0;
  let series = 0;
  for (const item of items) {
    if (item.mediaType === 'live') live++;
    else if (item.mediaType === 'movie') movie++;
    else if (item.mediaType === 'series') series++;
  }
  return {
    total: items.length,
    live,
    movie,
    series,
  };
}

export function createSamplePlaylist(): Playlist {
  const items: ChannelItem[] = [
    {
      id: 'sample_live_1',
      index: 1,
      name: 'Akış Haber HD (Canlı Test Yayını)',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      logo: liveBroadcastImg,
      group: 'Haber & Yayın',
      mediaType: 'live',
      qualityLabel: 'HD',
    },
    {
      id: 'sample_live_2',
      index: 2,
      name: 'Kuzey Belgesel 4K (Canlı Test Yayını)',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      logo: docNatureImg,
      group: 'Belgesel',
      mediaType: 'live',
      qualityLabel: '4K',
    },
    {
      id: 'sample_movie_1',
      index: 3,
      name: 'Tears of Steel (Bilim Kurgu · FHD)',
      url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      logo: movieScifiImg,
      group: 'Bilim Kurgu',
      mediaType: 'movie',
      qualityLabel: 'FHD',
    },
    {
      id: 'sample_movie_2',
      index: 4,
      name: 'Sintel (Fantastik Animasyon · HD)',
      url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
      logo: docNatureImg,
      group: 'Animasyon & Fantastik',
      mediaType: 'movie',
      qualityLabel: 'HD',
    },
    {
      id: 'sample_movie_3',
      index: 5,
      name: 'Big Buck Bunny (Komedi · MP4)',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      logo: movieScifiImg,
      group: 'Animasyon & Fantastik',
      mediaType: 'movie',
      qualityLabel: 'HD',
    },
    {
      id: 'sample_series_1',
      index: 6,
      name: 'Gece Devriyesi S01E01 · Başlangıç',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      logo: seriesNoirImg,
      group: 'Polisiye & Dram',
      mediaType: 'series',
      seriesTitle: 'Gece Devriyesi',
      season: 1,
      episode: 1,
      qualityLabel: 'HD',
    },
    {
      id: 'sample_series_2',
      index: 7,
      name: 'Gece Devriyesi S01E02 · İz Peşinde',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      logo: seriesNoirImg,
      group: 'Polisiye & Dram',
      mediaType: 'series',
      seriesTitle: 'Gece Devriyesi',
      season: 1,
      episode: 2,
      qualityLabel: 'HD',
    },
    {
      id: 'sample_series_3',
      index: 8,
      name: 'Kuzey Sınırı S01E01 · İlk Adım',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      logo: docNatureImg,
      group: 'Macera & Gerilim',
      mediaType: 'series',
      seriesTitle: 'Kuzey Sınırı',
      season: 1,
      episode: 1,
      qualityLabel: 'HD',
    },
  ];

  return {
    id: 'sample_playlist_default',
    name: 'Örnek Yayın Listesi',
    sourceType: 'sample',
    createdAt: Date.now(),
    items,
  };
}
