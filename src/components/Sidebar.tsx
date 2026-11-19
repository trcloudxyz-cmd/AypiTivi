import {
  Clapperboard,
  Clock,
  Film,
  Layers,
  Plus,
  Star,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import type {NavFilter, Playlist, PlaylistStats} from '../types/iptv';

export interface GroupCount {
  name: string;
  count: number;
}

interface SidebarProps {
  playlists: Playlist[];
  activePlaylist: Playlist | null;
  onSelectPlaylist: (id: string) => void;
  onDeletePlaylist: (id: string) => void;
  onOpenUpload: () => void;
  activeFilter: NavFilter;
  onSelectFilter: (filter: NavFilter) => void;
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  groups: GroupCount[];
  stats: PlaylistStats;
  favoritesCount: number;
  recentCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  playlists,
  activePlaylist,
  onSelectPlaylist,
  onDeletePlaylist,
  onOpenUpload,
  activeFilter,
  onSelectFilter,
  selectedGroup,
  onSelectGroup,
  groups,
  stats,
  favoritesCount,
  recentCount,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{
    id: NavFilter;
    label: string;
    count: number;
    icon: typeof Tv;
  }> = [
    {id: 'all', label: 'Tümü', count: stats.total, icon: Layers},
    {id: 'live', label: 'Canlı TV', count: stats.live, icon: Tv},
    {id: 'movie', label: 'Filmler', count: stats.movie, icon: Film},
    {id: 'series', label: 'Diziler', count: stats.series, icon: Clapperboard},
    {id: 'favorites', label: 'Favoriler', count: favoritesCount, icon: Star},
    {id: 'recent', label: 'Son İzlenenler', count: recentCount, icon: Clock},
  ];

  const totalInGroups = groups.reduce((acc, g) => acc + g.count, 0);

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0D1016] text-slate-200">
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-5 shrink-0">
        <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          AyPi Tivi
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Menüyü kapat"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Primary Upload Action */}
      <div className="p-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            onOpenUpload();
            onCloseMobile();
          }}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
        >
          <Plus size={16} />
          <span>M3U Liste Yükle</span>
        </button>
      </div>

      {/* Scrollable Navigation */}
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {/* Media Type Navigation */}
        <div className="mt-1">
          <p className="px-2.5 pb-1.5 text-xs font-medium text-slate-500">İçerik Türü</p>
          <nav aria-label="İçerik Türü" className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectFilter(item.id);
                    onCloseMobile();
                  }}
                  className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[#171D28] font-medium text-white'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      size={16}
                      className={isActive ? 'text-blue-400 shrink-0' : 'text-slate-500 shrink-0'}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="ml-2 font-mono text-xs tabular-nums text-slate-500 shrink-0">
                    {item.count.toLocaleString('tr-TR')}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Saved Playlists */}
        {playlists.length > 0 && (
          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <p className="px-2.5 pb-1.5 text-xs font-medium text-slate-500">Kayıtlı Listeler</p>
            <div className="space-y-0.5">
              {playlists.map((pl) => {
                const isSelected = activePlaylist?.id === pl.id;
                return (
                  <div
                    key={pl.id}
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                      isSelected
                        ? 'bg-[#171D28] font-medium text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPlaylist(pl.id);
                        onCloseMobile();
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate">{pl.name}</span>
                      <span className="block font-mono text-[11px] tabular-nums text-slate-500">
                        {pl.items.length.toLocaleString('tr-TR')} içerik
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePlaylist(pl.id)}
                      aria-label={`${pl.name} listesini sil`}
                      className="ml-2 flex h-7 w-7 items-center justify-center rounded text-slate-500 opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Group / Category Filter */}
        {groups.length > 0 && (
          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <p className="px-2.5 pb-1.5 text-xs font-medium text-slate-500">Kategoriler</p>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  onSelectGroup('__ALL__');
                  onCloseMobile();
                }}
                className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm transition-colors ${
                  selectedGroup === '__ALL__'
                    ? 'bg-[#171D28] font-medium text-white'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <span className="truncate">Tüm Kategoriler</span>
                <span className="ml-2 font-mono text-xs tabular-nums text-slate-500 shrink-0">
                  {totalInGroups.toLocaleString('tr-TR')}
                </span>
              </button>

              {groups.map((grp) => {
                const isSelected = selectedGroup === grp.name;
                return (
                  <button
                    key={grp.name}
                    type="button"
                    onClick={() => {
                      onSelectGroup(grp.name);
                      onCloseMobile();
                    }}
                    className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm transition-colors ${
                      isSelected
                        ? 'bg-[#171D28] font-medium text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{grp.name}</span>
                    <span className="ml-2 font-mono text-xs tabular-nums text-slate-500 shrink-0">
                      {grp.count.toLocaleString('tr-TR')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden w-[264px] shrink-0 border-r border-white/[0.07] lg:block">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-[280px] border-r border-white/[0.08] shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
