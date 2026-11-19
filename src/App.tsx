import {LayoutGrid, List, Menu, Search, Upload, X} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChannelBrowser} from './components/ChannelBrowser';
import {Sidebar, type GroupCount} from './components/Sidebar';
import {UploadPanel} from './components/UploadPanel';
import {VideoPlayer} from './components/VideoPlayer';
import type {ChannelItem, NavFilter, Playlist} from './types/iptv';
import {computePlaylistStats} from './utils/m3uParser';
import {
  loadAllPlaylists,
  loadPreferences,
  removePlaylist,
  savePlaylist,
  savePreferences,
} from './utils/storage';

const QUICK_TABS: Array<{id: NavFilter; label: string}> = [
  {id: 'all', label: 'Tümü'},
  {id: 'live', label: 'Canlı TV'},
  {id: 'movie', label: 'Filmler'},
  {id: 'series', label: 'Diziler'},
  {id: 'favorites', label: 'Favoriler'},
];

function getDefaultFilterForItems(items: ChannelItem[]): NavFilter {
  const stats = computePlaylistStats(items);
  if (stats.live > 0) return 'live';
  if (stats.movie > 0) return 'movie';
  if (stats.series > 0) return 'series';
  return 'all';
}

export default function App() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const [activeFilter, setActiveFilter] = useState<NavFilter>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('__ALL__');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [onDemandActiveChannel, setOnDemandActiveChannel] = useState<ChannelItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<ChannelItem[] | null>(null);

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTheatreMode, setIsTheatreMode] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const seriesEpisodesCacheRef = useRef<Map<string, ChannelItem[]>>(new Map());

  // Hydrate playlists and preferences from IndexedDB / localStorage
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [loadedPlaylists, prefs] = await Promise.all([
        loadAllPlaylists(),
        Promise.resolve(loadPreferences()),
      ]);
      if (!mounted) return;
      setPlaylists(loadedPlaylists);
      const validPlaylist =
        loadedPlaylists.find((p) => p.id === prefs.activePlaylistId) ??
        loadedPlaylists[0] ??
        null;
      setActivePlaylistId(validPlaylist?.id ?? null);
      if (validPlaylist) {
        setActiveFilter(getDefaultFilterForItems(validPlaylist.items));
      }
      setFavorites(prefs.favorites);
      setRecentIds(prefs.recentIds);
      setIsHydrated(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist user preferences
  useEffect(() => {
    if (!isHydrated) return;
    savePreferences({
      activePlaylistId,
      favorites,
      recentIds,
    });
  }, [isHydrated, activePlaylistId, favorites, recentIds]);

  // '/' shortcut focuses search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId],
  );

  const allItems = useMemo(() => activePlaylist?.items ?? [], [activePlaylist]);

  const stats = useMemo(() => computePlaylistStats(allItems), [allItems]);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const favoritesCount = useMemo(
    () => allItems.filter((item) => favoritesSet.has(item.id)).length,
    [allItems, favoritesSet],
  );

  const recentItems = useMemo(() => {
    const itemMap = new Map(allItems.map((i) => [i.id, i]));
    return recentIds
      .map((id) => itemMap.get(id))
      .filter((item): item is ChannelItem => Boolean(item));
  }, [allItems, recentIds]);

  // Base items matching NavFilter (before group and search)
  const navFilteredItems = useMemo(() => {
    if (activeFilter === 'all') return allItems;
    if (activeFilter === 'favorites') return allItems.filter((i) => favoritesSet.has(i.id));
    if (activeFilter === 'recent') return recentItems;
    return allItems.filter((i) => i.mediaType === activeFilter);
  }, [allItems, activeFilter, favoritesSet, recentItems]);

  // Dynamic group counts inside the selected NavFilter
  const groups = useMemo<GroupCount[]>(() => {
    const map = new Map<string, number>();
    for (const item of navFilteredItems) {
      map.set(item.group, (map.get(item.group) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({name, count}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
  }, [navFilteredItems]);

  // Reset group selection if selected group no longer exists in current filter
  useEffect(() => {
    if (selectedGroup !== '__ALL__' && !groups.some((g) => g.name === selectedGroup)) {
      setSelectedGroup('__ALL__');
    }
  }, [groups, selectedGroup]);

  // Final filtered items (NavFilter + Group + Search)
  const filteredItems = useMemo(() => {
    let list = navFilteredItems;
    if (selectedGroup !== '__ALL__') {
      list = list.filter((item) => item.group === selectedGroup);
    }
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    if (q) {
      list = list.filter(
        (item) =>
          item.name.toLocaleLowerCase('tr-TR').includes(q) ||
          item.group.toLocaleLowerCase('tr-TR').includes(q) ||
          String(item.index).includes(q),
      );
    }
    return list;
  }, [navFilteredItems, selectedGroup, searchQuery]);

  const activeChannel = useMemo(() => {
    if (!activeChannelId) return null;
    return (
      allItems.find((i) => i.id === activeChannelId) ??
      (onDemandActiveChannel?.id === activeChannelId ? onDemandActiveChannel : null)
    );
  }, [allItems, activeChannelId, onDemandActiveChannel]);

  const activeQueue = useMemo(
    () => (playbackQueue && playbackQueue.length > 0 ? playbackQueue : filteredItems),
    [playbackQueue, filteredItems],
  );

  const activeChannelPos = useMemo(() => {
    if (!activeChannel) return -1;
    return activeQueue.findIndex((i) => i.id === activeChannel.id);
  }, [activeQueue, activeChannel]);

  const handlePlayChannel = useCallback((channel: ChannelItem, queue?: ChannelItem[]) => {
    setActiveChannelId(channel.id);
    setOnDemandActiveChannel(channel);
    setPlaybackQueue(queue ?? null);
    setRecentIds((prev) => [channel.id, ...prev.filter((id) => id !== channel.id)].slice(0, 40));
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  const handleClosePlayer = useCallback(() => {
    setActiveChannelId(null);
    setOnDemandActiveChannel(null);
    setPlaybackQueue(null);
    setIsTheatreMode(false);
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const handleFetchSeriesEpisodes = useCallback(
    async (series: ChannelItem): Promise<ChannelItem[]> => {
      const cacheKey = `${activePlaylist?.id || 'pl'}_${series.seriesId || series.id}`;
      const cached = seriesEpisodesCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const creds = activePlaylist?.xtreamCredentials;
      if (!creds || !series.seriesId) {
        throw new Error('Dizi bölümleri için sunucu bilgileri bulunamadı.');
      }

      const response = await fetch('/api/xtream-login', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          serverUrl: creds.serverUrl,
          username: creds.username,
          password: creds.password,
          action: 'series_info',
          seriesId: series.seriesId,
          seriesTitle: series.name,
          seriesGroup: series.group,
          seriesLogo: series.logo,
        }),
      });

      const rawText = await response.text();
      let data: {episodes?: ChannelItem[]; error?: string} | null = null;
      try {
        data = JSON.parse(rawText) as {episodes?: ChannelItem[]; error?: string};
      } catch {
        data = null;
      }

      if (!response.ok || !data?.episodes) {
        throw new Error(data?.error || 'Dizi bölümleri sunucudan alınamadı.');
      }

      seriesEpisodesCacheRef.current.set(cacheKey, data.episodes);
      return data.episodes;
    },
    [activePlaylist],
  );

  const handleImportPlaylist = useCallback(async (playlist: Playlist) => {
    await savePlaylist(playlist);
    setPlaylists((prev) => {
      const withoutSame = prev.filter((p) => p.id !== playlist.id);
      return [playlist, ...withoutSame];
    });
    setActivePlaylistId(playlist.id);
    setActiveFilter(getDefaultFilterForItems(playlist.items));
    setSelectedGroup('__ALL__');
    setSearchQuery('');
    setActiveChannelId(null);
    setOnDemandActiveChannel(null);
    setPlaybackQueue(null);
    setIsUploadModalOpen(false);
  }, []);

  const handleDeletePlaylist = useCallback(
    async (id: string) => {
      await removePlaylist(id);
      setPlaylists((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (activePlaylistId === id) {
          const nextActive = next[0] ?? null;
          setActivePlaylistId(nextActive?.id ?? null);
          if (nextActive) {
            setActiveFilter(getDefaultFilterForItems(nextActive.items));
          }
          setActiveChannelId(null);
          setOnDemandActiveChannel(null);
          setPlaybackQueue(null);
        }
        return next;
      });
    },
    [activePlaylistId],
  );

  const handleSelectPlaylist = useCallback(
    (id: string) => {
      const target = playlists.find((p) => p.id === id);
      setActivePlaylistId(id);
      setActiveFilter(target ? getDefaultFilterForItems(target.items) : 'all');
      setSelectedGroup('__ALL__');
      setSearchQuery('');
      setActiveChannelId(null);
      setOnDemandActiveChannel(null);
      setPlaybackQueue(null);
    },
    [playlists],
  );

  const handleResetFilters = useCallback(() => {
    setActiveFilter('all');
    setSelectedGroup('__ALL__');
    setSearchQuery('');
  }, []);

  const handlePrevChannel = useCallback(() => {
    if (activeChannelPos > 0) {
      handlePlayChannel(activeQueue[activeChannelPos - 1], playbackQueue ?? undefined);
    }
  }, [activeChannelPos, activeQueue, playbackQueue, handlePlayChannel]);

  const handleNextChannel = useCallback(() => {
    if (activeChannelPos >= 0 && activeChannelPos < activeQueue.length - 1) {
      handlePlayChannel(activeQueue[activeChannelPos + 1], playbackQueue ?? undefined);
    }
  }, [activeChannelPos, activeQueue, playbackQueue, handlePlayChannel]);

  return (
    <div className="flex min-h-screen bg-[#090B0F] text-[#F3F4F6]">
      {/* Sidebar (hidden only when Theatre Mode is explicitly enabled) */}
      {!isTheatreMode && (
        <Sidebar
          playlists={playlists}
          activePlaylist={activePlaylist}
          onSelectPlaylist={handleSelectPlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onOpenUpload={() => setIsUploadModalOpen(true)}
          activeFilter={activeFilter}
          onSelectFilter={(filter) => {
            setActiveFilter(filter);
            setSelectedGroup('__ALL__');
          }}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          groups={groups}
          stats={stats}
          favoritesCount={favoritesCount}
          recentCount={recentItems.length}
          mobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Workspace Top Bar */}
        <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#090B0F]/90 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {!isTheatreMode && (
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(true)}
                  aria-label="Menüyü aç"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-[#10131A] text-slate-300 hover:bg-white/[0.06] lg:hidden shrink-0"
                >
                  <Menu size={18} />
                </button>
              )}

              {isTheatreMode && (
                <button
                  type="button"
                  onClick={() => setIsTheatreMode(false)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#10131A] px-3 text-xs font-medium text-slate-200 hover:bg-white/[0.06] whitespace-nowrap shrink-0"
                >
                  Kenar Çubuğunu Göster
                </button>
              )}

              {/* Search Input */}
              <div className="relative max-w-xl flex-1">
                <Search
                  size={16}
                  className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-500"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Kanal, film, dizi veya kategori ara... (/)"
                  aria-label="İçerik ara"
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#10131A] pr-9 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Aramayı temizle"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden items-center rounded-lg border border-white/[0.08] bg-[#10131A] p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Izgara görünümü"
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-[#1D2432] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Liste görünümü"
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                    viewMode === 'list'
                      ? 'bg-[#1D2432] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <List size={15} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsUploadModalOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#10131A] px-3.5 text-xs font-medium text-white transition-colors hover:bg-white/[0.07] whitespace-nowrap shrink-0 lg:hidden"
              >
                <Upload size={14} />
                <span>Liste Yükle</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Workspace Viewport */}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          {!isHydrated ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-blue-500" />
            </div>
          ) : !activePlaylist ? (
            <div className="py-6 sm:py-10">
              <div className="mx-auto mb-8 max-w-3xl text-center">
                <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
                  Canlı TV, Film ve Dizilerinizi Tek Ekranda İzleyin
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
                  M3U/M3U8 yayın listenizi veya sunucu bilgilerinizi ekleyin; içerikleriniz otomatik olarak Canlı TV, Film ve Dizi kategorilerine ayrılsın.
                </p>
              </div>
              <UploadPanel onImportPlaylist={handleImportPlaylist} />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Active Video Player */}
              {activeChannel && (
                <div className="space-y-2">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={handleClosePlayer}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#10131A] px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <X size={13} />
                      <span>Oynatıcıyı Kapat</span>
                    </button>
                  </div>
                  <VideoPlayer
                    channel={activeChannel}
                    isFavorite={favoritesSet.has(activeChannel.id)}
                    onToggleFavorite={handleToggleFavorite}
                    onPrevChannel={handlePrevChannel}
                    onNextChannel={handleNextChannel}
                    hasPrev={activeChannelPos > 0}
                    hasNext={activeChannelPos >= 0 && activeChannelPos < activeQueue.length - 1}
                    isTheatreMode={isTheatreMode}
                    onToggleTheatreMode={() => setIsTheatreMode((prev) => !prev)}
                  />
                </div>
              )}

              {/* Library Header & Quick Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
                <div>
                  <h1 className="font-display text-lg font-semibold text-white sm:text-xl">
                    {activePlaylist.name}
                  </h1>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono tabular-nums">
                      {filteredItems.length.toLocaleString('tr-TR')} sonuç
                    </span>
                    {selectedGroup !== '__ALL__' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Kategori: {selectedGroup}</span>
                      </>
                    )}
                    {searchQuery && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Arama: &ldquo;{searchQuery}&rdquo;</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.07] bg-[#10131A] p-1">
                  {QUICK_TABS.map((tab) => {
                    const isActive = activeFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveFilter(tab.id);
                          setSelectedGroup('__ALL__');
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel / Movie / Series Grid or List */}
              <ChannelBrowser
                items={filteredItems}
                activeChannelId={activeChannelId}
                favoritesSet={favoritesSet}
                viewMode={viewMode}
                activeFilter={activeFilter}
                searchQuery={searchQuery}
                onPlayChannel={handlePlayChannel}
                onToggleFavorite={handleToggleFavorite}
                onResetFilters={handleResetFilters}
                onFetchSeriesEpisodes={handleFetchSeriesEpisodes}
              />
            </div>
          )}
        </main>
      </div>

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="M3U Yayın Listesi Yükle"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <UploadPanel
            isModal
            onClose={() => setIsUploadModalOpen(false)}
            onImportPlaylist={handleImportPlaylist}
          />
        </div>
      )}
    </div>
  );
}
