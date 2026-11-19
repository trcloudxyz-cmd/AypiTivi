export type MediaCategory = 'live' | 'movie' | 'series';

export type NavFilter = 'all' | MediaCategory | 'favorites' | 'recent';

export interface XtreamCredentials {
  serverUrl: string;
  streamOrigin?: string;
  username: string;
  password: string;
}

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
  rating?: string;
  streamFormat?: 'hls' | 'mpegts' | 'native';
  seriesTitle?: string;
  seriesId?: string;
  isSeriesFolder?: boolean;
  season?: number;
  episode?: number;
}

export interface Playlist {
  id: string;
  name: string;
  sourceType: 'file' | 'url' | 'paste' | 'sample' | 'xtream';
  sourceRef?: string;
  xtreamCredentials?: XtreamCredentials;
  createdAt: number;
  items: ChannelItem[];
}

export interface PlaylistStats {
  total: number;
  live: number;
  movie: number;
  series: number;
}
