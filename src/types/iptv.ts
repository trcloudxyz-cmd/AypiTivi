export type MediaCategory = 'live' | 'movie' | 'series';

export type NavFilter = 'all' | MediaCategory | 'favorites' | 'recent';

export interface ChannelItem {
  id: string;
  index: number;
  name: string;
  url: string;
  logo?: string;
  group: string;
  mediaType: MediaCategory;
  tvgId?: string;
  tvgName?: string;
  qualityLabel?: string;
  streamFormat?: 'hls' | 'mpegts' | 'native';
  seriesTitle?: string;
  season?: number;
  episode?: number;
}

export interface Playlist {
  id: string;
  name: string;
  sourceType: 'file' | 'url' | 'paste' | 'sample';
  sourceRef?: string;
  createdAt: number;
  items: ChannelItem[];
}

export interface PlaylistStats {
  total: number;
  live: number;
  movie: number;
  series: number;
}
