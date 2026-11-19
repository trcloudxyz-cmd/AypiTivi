import {ArrowLeft, FolderOpen, Loader2, Play, RefreshCw, SearchX, Star} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ChannelItem, NavFilter} from '../types/iptv';
import {ChannelThumbnail} from './ChannelThumbnail';

interface SeriesGroup {
  title: string;
  group: string;
  logo?: string;
  rating?: string;
  episodes: ChannelItem[];
}

interface ChannelBrowserProps {
  items: ChannelItem[];
  activeChannelId: string | null;
  favoritesSet: Set<string>;
  viewMode: 'grid' | 'list';
  activeFilter: NavFilter;
  searchQuery: string;
  onPlayChannel: (channel: ChannelItem, queue?: ChannelItem[]) => void;
  onToggleFavorite: (id: string) => void;
  onResetFilters: () => void;
  onFetchSeriesEpisodes?: (series: ChannelItem) => Promise<ChannelItem[]>;
}

const PAGE_SIZE = 60;

function formatMediaLabel(type: ChannelItem['mediaType']): string {
  if (type === 'live') return 'Canlı TV';
  if (type === 'movie') return 'Film';
  return 'Dizi';
}

function formatRating(raw?: string): string | null {
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

export function ChannelBrowser({
  items,
  activeChannelId,
  favoritesSet,
  viewMode,
  activeFilter,
  searchQuery,
  onPlayChannel,
  onToggleFavorite,
  onResetFilters,
  onFetchSeriesEpisodes,
}: ChannelBrowserProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [groupSeries, setGroupSeries] = useState(true);
  const [selectedSeriesTitle, setSelectedSeriesTitle] = useState<string | null>(null);

  // On-demand Xtream series state
  const [openedXtreamSeries, setOpenedXtreamSeries] = useState<ChannelItem | null>(null);
  const [xtreamEpisodes, setXtreamEpisodes] = useState<ChannelItem[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>('all');

  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset pagination & series drill-down when filter/search/items change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedSeriesTitle(null);
    setOpenedXtreamSeries(null);
    setXtreamEpisodes([]);
    setEpisodesError(null);
    setSelectedSeason('all');
  }, [activeFilter, searchQuery, items]);

  const handleOpenXtreamSeries = async (series: ChannelItem) => {
    setOpenedXtreamSeries(series);
    setXtreamEpisodes([]);
    setEpisodesError(null);
    setSelectedSeason('all');

    if (!onFetchSeriesEpisodes) {
      setEpisodesError('Dizi bölümleri bu kaynak için yüklenemiyor.');
      return;
    }

    setIsLoadingEpisodes(true);
    try {
      const episodes = await onFetchSeriesEpisodes(series);
      setXtreamEpisodes(episodes);
      const seasons = Array.from(new Set(episodes.map((e) => e.season || 1))).sort((a, b) => a - b);
      if (seasons.length > 0) {
        setSelectedSeason(seasons[0]);
      }
    } catch (err) {
      setEpisodesError(
        err instanceof Error ? err.message : 'Dizi bölümleri sunucudan alınamadı.',
      );
    } finally {
      setIsLoadingEpisodes(false);
    }
  };

  // Client-side series grouping for flat M3U files (non-Xtream)
  const seriesGroups = useMemo<SeriesGroup[]>(() => {
    if (activeFilter !== 'series') return [];
    const hasXtreamFolders = items.some((i) => i.isSeriesFolder);
    if (hasXtreamFolders) return [];

    const map = new Map<string, SeriesGroup>();
    for (const item of items) {
      const key = item.seriesTitle || item.name;
      const existing = map.get(key);
      if (existing) {
        existing.episodes.push(item);
        if (!existing.logo && item.logo) existing.logo = item.logo;
      } else {
        map.set(key, {
          title: key,
          group: item.group,
          logo: item.logo,
          rating: item.rating,
          episodes: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [items, activeFilter]);

  const hasGroupedSeries =
    activeFilter === 'series' &&
    seriesGroups.length > 0 &&
    seriesGroups.some((g) => g.episodes.length > 1);

  const showSeriesFolders =
    activeFilter === 'series' && hasGroupedSeries && groupSeries && !selectedSeriesTitle;

  const displayedItems = useMemo(() => {
    if (activeFilter === 'series' && hasGroupedSeries && groupSeries && selectedSeriesTitle) {
      const found = seriesGroups.find((g) => g.title === selectedSeriesTitle);
      return found ? found.episodes : items;
    }
    return items;
  }, [items, activeFilter, hasGroupedSeries, groupSeries, selectedSeriesTitle, seriesGroups]);

  const totalListLength = showSeriesFolders ? seriesGroups.length : displayedItems.length;

  const visibleSeriesGroups = useMemo(
    () => (showSeriesFolders ? seriesGroups.slice(0, visibleCount) : []),
    [showSeriesFolders, seriesGroups, visibleCount],
  );

  const visibleItems = useMemo(
    () => (showSeriesFolders ? [] : displayedItems.slice(0, visibleCount)),
    [showSeriesFolders, displayedItems, visibleCount],
  );

  // Infinite scroll trigger
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || visibleCount >= totalListLength || openedXtreamSeries) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(totalListLength, c + PAGE_SIZE));
        }
      },
      {rootMargin: '240px'},
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, totalListLength, openedXtreamSeries]);

  // Xtream Series Season/Episode Detail View
  if (openedXtreamSeries) {
    const seasons = Array.from(new Set(xtreamEpisodes.map((e) => e.season || 1))).sort(
      (a, b) => a - b,
    );
    const filteredEpisodes =
      selectedSeason === 'all'
        ? xtreamEpisodes
        : xtreamEpisodes.filter((e) => (e.season || 1) === selectedSeason);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setOpenedXtreamSeries(null);
              setXtreamEpisodes([]);
              setEpisodesError(null);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#10131A] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
          >
            <ArrowLeft size={14} />
            <span>Dizilere Dön</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-display text-sm font-semibold text-white">
              {openedXtreamSeries.name}
            </span>
            <span aria-hidden="true">·</span>
            <span>{openedXtreamSeries.group}</span>
          </div>
        </div>

        {isLoadingEpisodes ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#10131A] py-16 text-center">
            <Loader2 size={28} className="animate-spin text-blue-500" />
            <p className="mt-3 text-sm text-slate-300">Sezonlar ve bölümler yükleniyor...</p>
          </div>
        ) : episodesError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#10131A] px-6 py-14 text-center">
            <p className="text-sm text-rose-300">{episodesError}</p>
            <button
              type="button"
              onClick={() => handleOpenXtreamSeries(openedXtreamSeries)}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] px-4 text-xs font-medium text-white hover:bg-white/[0.1]"
            >
              <RefreshCw size={13} />
              <span>Tekrar Dene</span>
            </button>
          </div>
        ) : xtreamEpisodes.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#10131A] px-6 py-14 text-center text-sm text-slate-400">
            Bu dizi için henüz bölüm bulunamadı.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Season Selector */}
            {seasons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {seasons.map((seasonNum) => {
                  const isActiveSeason = selectedSeason === seasonNum;
                  return (
                    <button
                      key={seasonNum}
                      type="button"
                      onClick={() => setSelectedSeason(seasonNum)}
                      className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActiveSeason
                          ? 'bg-blue-600 text-white'
                          : 'border border-white/[0.07] bg-[#10131A] text-slate-300 hover:bg-white/[0.06]'
                      }`}
                    >
                      {seasonNum}. Sezon
                    </button>
                  );
                })}
              </div>
            )}

            {/* Episode List */}
            <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#10131A]">
              <div className="divide-y divide-white/[0.05]">
                {filteredEpisodes.map((ep) => {
                  const isActive = ep.id === activeChannelId;
                  const isFav = favoritesSet.has(ep.id);
                  const epCode = `S${String(ep.season || 1).padStart(2, '0')}E${String(
                    ep.episode || ep.index,
                  ).padStart(2, '0')}`;
                  return (
                    <div
                      key={ep.id}
                      className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${
                        isActive ? 'bg-[#172030]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onPlayChannel(ep, filteredEpisodes)}
                        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                      >
                        <span className="w-16 font-mono text-xs tabular-nums text-blue-400 shrink-0">
                          {epCode}
                        </span>
                        <ChannelThumbnail
                          src={ep.logo}
                          name={ep.name}
                          mediaType="series"
                          fit="cover"
                          iconSize={15}
                          className="h-11 w-18 rounded-md shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-medium ${
                              isActive ? 'text-blue-400' : 'text-white'
                            }`}
                          >
                            {ep.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            {ep.season || 1}. Sezon · {ep.episode || ep.index}. Bölüm
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(ep.id)}
                          aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                            isFav
                              ? 'text-amber-400 hover:bg-amber-500/10'
                              : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                          }`}
                        >
                          <Star size={15} className={isFav ? 'fill-amber-400' : ''} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onPlayChannel(ep, filteredEpisodes)}
                          className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'border border-white/[0.08] bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]'
                          }`}
                        >
                          <Play size={13} className="fill-current" />
                          <span>{isActive ? 'Oynatılıyor' : 'İzle'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#10131A] px-6 py-16 text-center">
        <SearchX size={32} className="text-slate-500" />
        <h3 className="mt-3 font-display text-base font-semibold text-white">
          Eşleşen içerik bulunamadı
        </h3>
        <p className="mt-1 max-w-md text-sm text-slate-400">
          {searchQuery
            ? `"${searchQuery}" aramasına uygun kanal, film veya dizi bulunamadı.`
            : 'Seçili kategori veya filtrede henüz içerik bulunmuyor.'}
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-5 inline-flex h-9 items-center rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 text-xs font-medium text-white transition-colors hover:bg-white/[0.08]"
        >
          Filtreleri Temizle
        </button>
      </div>
    );
  }

  const isPosterLayout =
    viewMode === 'grid' && (activeFilter === 'movie' || activeFilter === 'series');

  const handleCardAction = (item: ChannelItem) => {
    if (item.isSeriesFolder) {
      void handleOpenXtreamSeries(item);
    } else {
      onPlayChannel(item);
    }
  };

  return (
    <div>
      {/* Series Grouping Toggle Bar (for flat M3U series lists) */}
      {activeFilter === 'series' && hasGroupedSeries && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {selectedSeriesTitle ? (
            <button
              type="button"
              onClick={() => setSelectedSeriesTitle(null)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#10131A] px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
            >
              <ArrowLeft size={14} />
              <span>Tüm Dizilere Dön · {selectedSeriesTitle}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#10131A] p-1">
              <button
                type="button"
                onClick={() => setGroupSeries(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  groupSeries ? 'bg-[#1D2432] text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dizilere Göre ({seriesGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setGroupSeries(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  !groupSeries ? 'bg-[#1D2432] text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tüm Bölümler ({items.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Grouped Flat M3U Series Cards (2:3 Vertical Posters) */}
      {showSeriesFolders ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visibleSeriesGroups.map((series) => (
            <button
              key={series.title}
              type="button"
              onClick={() => setSelectedSeriesTitle(series.title)}
              className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#10131A] text-left transition-colors hover:border-white/[0.16] hover:bg-[#141923]"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden">
                <ChannelThumbnail
                  src={series.logo}
                  name={series.title}
                  mediaType="series"
                  fit="cover"
                  className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute right-2.5 bottom-2 flex items-center gap-1 text-[11px] font-medium text-white">
                  <FolderOpen size={12} className="text-blue-400" />
                  <span className="font-mono tabular-nums">{series.episodes.length} Bölüm</span>
                </div>
              </div>
              <div className="p-3">
                <h3 className="line-clamp-1 font-display text-sm font-semibold text-white">
                  {series.title}
                </h3>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  Dizi · {series.group}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : isPosterLayout ? (
        /* Vertical 2:3 Poster Cards for Movies & Series */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visibleItems.map((item) => {
            const isActive = item.id === activeChannelId;
            const isFav = favoritesSet.has(item.id);
            const rating = formatRating(item.rating);
            return (
              <div
                key={item.id}
                className={`group relative flex flex-col overflow-hidden rounded-xl border transition-colors ${
                  isActive
                    ? 'border-blue-500/60 bg-[#151B26]'
                    : 'border-white/[0.07] bg-[#10131A] hover:border-white/[0.16] hover:bg-[#141923]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleCardAction(item)}
                  className="relative aspect-[2/3] w-full overflow-hidden text-left"
                >
                  <ChannelThumbnail
                    src={item.logo}
                    name={item.name}
                    mediaType={item.mediaType}
                    fit="cover"
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {rating && (
                    <span className="absolute top-2 left-2 rounded-md bg-blue-600/95 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white shadow">
                      {rating}
                    </span>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45">
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-opacity duration-150 ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {item.isSeriesFolder ? (
                        <FolderOpen size={18} />
                      ) : (
                        <Play size={18} className="ml-0.5 fill-current" />
                      )}
                    </span>
                  </div>
                </button>

                <div className="flex items-start justify-between gap-1.5 p-3">
                  <button
                    type="button"
                    onClick={() => handleCardAction(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <h3 className="line-clamp-1 font-display text-sm font-semibold text-white">
                      {item.name}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {formatMediaLabel(item.mediaType)} · {item.group}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(item.id)}
                    aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors shrink-0 ${
                      isFav
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                    }`}
                  >
                    <Star size={14} className={isFav ? 'fill-amber-400' : ''} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'grid' ? (
        /* Live TV & Mixed Grid Cards (Clean contain framing for channel logos) */
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {visibleItems.map((item) => {
            const isActive = item.id === activeChannelId;
            const isFav = favoritesSet.has(item.id);
            const fitMode = item.mediaType === 'live' ? 'contain' : 'cover';
            return (
              <div
                key={item.id}
                className={`group relative flex flex-col overflow-hidden rounded-xl border transition-colors ${
                  isActive
                    ? 'border-blue-500/60 bg-[#151B26]'
                    : 'border-white/[0.07] bg-[#10131A] hover:border-white/[0.16] hover:bg-[#141923]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleCardAction(item)}
                  className="relative aspect-[16/10] w-full overflow-hidden text-left"
                >
                  <ChannelThumbnail
                    src={item.logo}
                    name={item.name}
                    mediaType={item.mediaType}
                    fit={fitMode}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-opacity duration-150 ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {item.isSeriesFolder ? (
                        <FolderOpen size={17} />
                      ) : (
                        <Play size={17} className="ml-0.5 fill-current" />
                      )}
                    </span>
                  </div>
                </button>

                <div className="flex items-start justify-between gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => handleCardAction(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <h3 className="line-clamp-1 font-display text-sm font-semibold text-white">
                      {item.name}
                    </h3>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400">
                      <span className="font-mono tabular-nums text-slate-500">
                        #{item.index}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{item.group}</span>
                      {item.qualityLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-300">{item.qualityLabel}</span>
                        </>
                      )}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(item.id)}
                    aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors shrink-0 ${
                      isFav
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                    }`}
                  >
                    <Star size={14} className={isFav ? 'fill-amber-400' : ''} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Dense List View */
        <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#10131A]">
          <div className="divide-y divide-white/[0.05]">
            {visibleItems.map((item) => {
              const isActive = item.id === activeChannelId;
              const isFav = favoritesSet.has(item.id);
              const fitMode = item.mediaType === 'live' ? 'contain' : 'cover';
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors ${
                    isActive ? 'bg-[#172030]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleCardAction(item)}
                    className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                  >
                    <span className="w-10 font-mono text-xs tabular-nums text-slate-500 shrink-0">
                      #{item.index}
                    </span>
                    <ChannelThumbnail
                      src={item.logo}
                      name={item.name}
                      mediaType={item.mediaType}
                      fit={fitMode}
                      iconSize={15}
                      className="h-10 w-16 rounded-md shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${
                          isActive ? 'text-blue-400' : 'text-white'
                        }`}
                      >
                        {item.name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-400">
                        <span>{formatMediaLabel(item.mediaType)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{item.group}</span>
                        {item.qualityLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-300">{item.qualityLabel}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(item.id)}
                      aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                        isFav
                          ? 'text-amber-400 hover:bg-amber-500/10'
                          : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                      }`}
                    >
                      <Star size={15} className={isFav ? 'fill-amber-400' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCardAction(item)}
                      aria-label={`${item.name} ${item.isSeriesFolder ? 'aç' : 'oynat'}`}
                      className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'border border-white/[0.08] bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]'
                      }`}
                    >
                      {item.isSeriesFolder ? (
                        <>
                          <FolderOpen size={13} />
                          <span>Bölümler</span>
                        </>
                      ) : (
                        <>
                          <Play size={13} className="fill-current" />
                          <span>{isActive ? 'Oynatılıyor' : 'İzle'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load More / Infinite Scroll Sentinel */}
      {visibleCount < totalListLength && (
        <div ref={loadMoreRef} className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((c) => Math.min(totalListLength, c + PAGE_SIZE))}
            className="inline-flex h-10 items-center rounded-lg border border-white/[0.08] bg-[#10131A] px-5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
          >
            Daha Fazla Göster (
            {(totalListLength - visibleCount).toLocaleString('tr-TR')} içerik kaldı)
          </button>
        </div>
      )}
    </div>
  );
}
