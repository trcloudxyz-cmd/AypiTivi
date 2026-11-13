import {ArrowLeft, FolderOpen, Play, SearchX, Star} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ChannelItem, NavFilter} from '../types/iptv';
import {ChannelThumbnail} from './ChannelThumbnail';

interface SeriesGroup {
  title: string;
  group: string;
  logo?: string;
  episodes: ChannelItem[];
}

interface ChannelBrowserProps {
  items: ChannelItem[];
  activeChannelId: string | null;
  favoritesSet: Set<string>;
  viewMode: 'grid' | 'list';
  activeFilter: NavFilter;
  searchQuery: string;
  onPlayChannel: (channel: ChannelItem) => void;
  onToggleFavorite: (id: string) => void;
  onResetFilters: () => void;
}

const PAGE_SIZE = 60;

function formatMediaLabel(type: ChannelItem['mediaType']): string {
  if (type === 'live') return 'Canlı TV';
  if (type === 'movie') return 'Film';
  return 'Dizi';
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
}: ChannelBrowserProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [groupSeries, setGroupSeries] = useState(true);
  const [selectedSeriesTitle, setSelectedSeriesTitle] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset pagination & series drill-down when filter/search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedSeriesTitle(null);
  }, [activeFilter, searchQuery, items.length]);

  // Detect if series grouping is useful (at least one item with seriesTitle)
  const seriesGroups = useMemo<SeriesGroup[]>(() => {
    if (activeFilter !== 'series') return [];
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

  const displayedItems = useMemo(() => {
    if (activeFilter === 'series' && hasGroupedSeries && groupSeries && selectedSeriesTitle) {
      const found = seriesGroups.find((g) => g.title === selectedSeriesTitle);
      return found ? found.episodes : items;
    }
    return items;
  }, [items, activeFilter, hasGroupedSeries, groupSeries, selectedSeriesTitle, seriesGroups]);

  const visibleItems = useMemo(
    () => displayedItems.slice(0, visibleCount),
    [displayedItems, visibleCount],
  );

  // Infinite scroll trigger
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || visibleCount >= displayedItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(displayedItems.length, c + PAGE_SIZE));
        }
      },
      {rootMargin: '240px'},
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, displayedItems.length]);

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

  // Series Folder View when viewing Diziler and no specific series is opened yet
  const showSeriesFolders =
    activeFilter === 'series' && hasGroupedSeries && groupSeries && !selectedSeriesTitle;

  return (
    <div>
      {/* Series Grouping Toggle Bar */}
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

      {/* Grouped Series Cards */}
      {showSeriesFolders ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {seriesGroups.map((series) => (
            <button
              key={series.title}
              type="button"
              onClick={() => setSelectedSeriesTitle(series.title)}
              className="group overflow-hidden rounded-xl border border-white/[0.07] bg-[#10131A] text-left transition-colors hover:border-white/[0.16] hover:bg-[#141923]"
            >
              <div className="relative aspect-video w-full overflow-hidden">
                <ChannelThumbnail
                  src={series.logo}
                  name={series.title}
                  mediaType="series"
                  className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5 text-xs font-medium text-white">
                  <FolderOpen size={14} className="text-blue-400" />
                  <span className="font-mono tabular-nums">{series.episodes.length} Bölüm</span>
                </div>
              </div>
              <div className="p-3.5">
                <h3 className="truncate font-display text-sm font-semibold text-white">
                  {series.title}
                </h3>
                <p className="mt-1 truncate text-xs text-slate-400">
                  Dizi · {series.group}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map((item) => {
            const isActive = item.id === activeChannelId;
            const isFav = favoritesSet.has(item.id);
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
                  onClick={() => onPlayChannel(item)}
                  className="relative aspect-video w-full overflow-hidden text-left"
                >
                  <ChannelThumbnail
                    src={item.logo}
                    name={item.name}
                    mediaType={item.mediaType}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45">
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-opacity duration-150 ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Play size={18} className="ml-0.5 fill-current" />
                    </span>
                  </div>
                </button>

                <div className="flex items-start justify-between gap-2 p-3.5">
                  <button
                    type="button"
                    onClick={() => onPlayChannel(item)}
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
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(item.id)}
                    aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0 ${
                      isFav
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                    }`}
                  >
                    <Star size={15} className={isFav ? 'fill-amber-400' : ''} />
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
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors ${
                    isActive ? 'bg-[#172030]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onPlayChannel(item)}
                    className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                  >
                    <span className="w-10 font-mono text-xs tabular-nums text-slate-500 shrink-0">
                      #{item.index}
                    </span>
                    <ChannelThumbnail
                      src={item.logo}
                      name={item.name}
                      mediaType={item.mediaType}
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
                      onClick={() => onPlayChannel(item)}
                      aria-label={`${item.name} oynat`}
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
      )}

      {/* Load More / Infinite Scroll Sentinel */}
      {!showSeriesFolders && visibleCount < displayedItems.length && (
        <div ref={loadMoreRef} className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((c) => Math.min(displayedItems.length, c + PAGE_SIZE))
            }
            className="inline-flex h-10 items-center rounded-lg border border-white/[0.08] bg-[#10131A] px-5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
          >
            Daha Fazla Göster (
            {(displayedItems.length - visibleCount).toLocaleString('tr-TR')} içerik kaldı)
          </button>
        </div>
      )}
    </div>
  );
}
