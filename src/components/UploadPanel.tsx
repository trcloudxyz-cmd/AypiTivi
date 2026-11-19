import {CheckCircle2, FileText, Link2, Sparkles, Upload, X} from 'lucide-react';
import {useRef, useState} from 'react';
import type {Playlist} from '../types/iptv';
import {
  computePlaylistStats,
  createDirectStreamItem,
  createSamplePlaylist,
  isHlsStreamManifest,
  parseM3U,
} from '../utils/m3uParser';

interface UploadPanelProps {
  onImportPlaylist: (playlist: Playlist) => void;
  onClose?: () => void;
  isModal?: boolean;
}

type ImportTab = 'file' | 'url' | 'paste';

const LOCAL_VIDEO_EXTENSIONS = ['.ts', '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];

export function UploadPanel({onImportPlaylist, onClose, isModal = false}: UploadPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('file');
  const [isDragging, setIsDragging] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlaylist, setPendingPlaylist] = useState<Playlist | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildPendingPlaylist = (
    items: Playlist['items'],
    defaultName: string,
    sourceType: Playlist['sourceType'],
    sourceRef?: string,
  ) => {
    const finalName = playlistName.trim() || defaultName;
    const playlist: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: finalName,
      sourceType,
      sourceRef,
      createdAt: Date.now(),
      items,
    };
    setPendingPlaylist(playlist);
    if (!playlistName.trim()) {
      setPlaylistName(finalName);
    }
  };

  const processM3uContent = (
    rawContent: string,
    defaultName: string,
    sourceType: Playlist['sourceType'],
    sourceRef?: string,
  ) => {
    setError(null);
    const items = parseM3U(rawContent);
    if (items.length === 0) {
      setError(
        'Geçerli bir kanal veya yayın bağlantısı bulunamadı. M3U/M3U8 içeriği veya doğrudan yayın linki (.m3u, .m3u8, .ts) girin.',
      );
      return;
    }
    buildPendingPlaylist(items, defaultName, sourceType, sourceRef);
  };

  const fetchOrAddUrl = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      setError('Lütfen geçerli bir M3U, M3U8 veya TS bağlantısı girin.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch('/api/fetch-m3u', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: trimmed}),
      });
      const data = (await response.json()) as {
        isDirectStream?: boolean;
        content?: string;
        finalUrl?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || 'Bağlantı yüklenemedi.');
      }

      let derivedName = 'Yayın Bağlantısı';
      try {
        const parsedUrl = new URL(trimmed);
        derivedName = parsedUrl.hostname.replace(/^www\./, '');
      } catch {
        // Fallback name
      }

      if (data.isDirectStream) {
        const item = createDirectStreamItem(data.finalUrl || trimmed, playlistName.trim() || undefined);
        buildPendingPlaylist([item], item.name, 'url', trimmed);
        return;
      }

      const content = data.content || '';
      if (isHlsStreamManifest(content)) {
        const item = createDirectStreamItem(data.finalUrl || trimmed, playlistName.trim() || undefined);
        buildPendingPlaylist([item], item.name, 'url', trimmed);
        return;
      }

      processM3uContent(content, derivedName, 'url', trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantıdan içerik yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setIsLoading(true);
    try {
      const lowerName = file.name.toLowerCase();
      const baseName =
        file.name.replace(/\.(m3u8?|ts|mp4|mkv|webm|avi|mov|m4v|txt)$/i, '') || 'Yayın Listem';

      if (LOCAL_VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
        const objectUrl = URL.createObjectURL(file);
        const streamFormat = lowerName.endsWith('.ts') ? 'mpegts' : 'native';
        const item = createDirectStreamItem(objectUrl, baseName, 1, streamFormat);
        buildPendingPlaylist([item], baseName, 'file', file.name);
        return;
      }

      const text = await file.text();
      processM3uContent(text, baseName, 'file', file.name);
    } catch {
      setError('Dosya okunurken bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUrlFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchOrAddUrl(urlInput);
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pasteInput.trim();
    if (!trimmed) {
      setError('Lütfen M3U içeriğini veya yayın linkini (.m3u, .m3u8, .ts) yapıştırın.');
      return;
    }

    // If user pasted a single URL (e.g., https://.../playlist.m3u or https://.../stream.ts), handle it smartly
    const nonEmptyLines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (nonEmptyLines.length === 1 && /^https?:\/\/\S+$/i.test(nonEmptyLines[0])) {
      await fetchOrAddUrl(nonEmptyLines[0]);
      return;
    }

    processM3uContent(trimmed, 'Özel Yayın Listesi', 'paste');
  };

  const handleConfirmPending = () => {
    if (!pendingPlaylist) return;
    onImportPlaylist({
      ...pendingPlaylist,
      name: playlistName.trim() || pendingPlaylist.name,
    });
  };

  const handleLoadSample = () => {
    onImportPlaylist(createSamplePlaylist());
  };

  const pendingStats = pendingPlaylist ? computePlaylistStats(pendingPlaylist.items) : null;

  return (
    <div
      className={`w-full rounded-2xl border border-white/[0.08] bg-[#10131A] p-6 sm:p-8 ${
        isModal ? 'max-w-2xl shadow-2xl' : 'mx-auto max-w-3xl'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Yayın Listesi veya Link Ekle
          </h2>
          <p className="mt-1.5 text-sm text-slate-400">
            M3U/M3U8/TS dosyanızı yükleyin, doğrudan dosya/yayın bağlantısını yapıştırın ya da içerik listesini ekleyin.
          </p>
        </div>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white shrink-0"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Mode Tabs */}
      <div className="mt-6 flex items-center gap-1 rounded-xl border border-white/[0.06] bg-[#0B0D12] p-1">
        <button
          type="button"
          onClick={() => {
            setActiveTab('file');
            setError(null);
            setPendingPlaylist(null);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
            activeTab === 'file'
              ? 'bg-[#1A202C] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Upload size={15} />
          <span>Dosya Yükle</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('url');
            setError(null);
            setPendingPlaylist(null);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
            activeTab === 'url'
              ? 'bg-[#1A202C] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Link2 size={15} />
          <span>Link Yapıştır (.m3u / .ts)</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('paste');
            setError(null);
            setPendingPlaylist(null);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
            activeTab === 'paste'
              ? 'bg-[#1A202C] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText size={15} />
          <span>Çoklu Link / Metin</span>
        </button>
      </div>

      {/* Optional Playlist Name */}
      <div className="mt-5">
        <label htmlFor="playlist-name-input" className="block text-xs font-medium text-slate-300">
          Liste veya Yayın Adı (İsteğe Bağlı)
        </label>
        <input
          id="playlist-name-input"
          type="text"
          value={playlistName}
          onChange={(e) => setPlaylistName(e.target.value)}
          placeholder="Örn: Ev TV Listem veya Haber HD"
          className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Tab Content */}
      {!pendingPlaylist && activeTab === 'file' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-white/[0.15] bg-[#0B0D12] hover:border-white/[0.28] hover:bg-[#0E1118]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".m3u,.m3u8,.ts,.mp4,.mkv,.webm,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl,video/mp2t,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-[#141822] text-blue-400">
            <Upload size={22} />
          </div>
          <p className="mt-4 text-sm font-medium text-white">
            {isLoading ? 'Dosya ayrıştırılıyor...' : 'M3U, M3U8 veya TS dosyasını buraya sürükleyin veya seçin'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Desteklenen formatlar: .m3u, .m3u8, .ts, .mp4 (isteğe bağlı .txt)
          </p>
        </div>
      )}

      {!pendingPlaylist && activeTab === 'url' && (
        <form onSubmit={handleUrlFetch} className="mt-5 space-y-4">
          <div>
            <label htmlFor="m3u-url-input" className="block text-xs font-medium text-slate-300">
              M3U, M3U8 veya TS Dosya Linki
            </label>
            <input
              id="m3u-url-input"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://ornek.com/liste.m3u veya https://ornek.com/yayin.ts"
              required
              className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3.5 font-mono text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none sm:text-sm"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Hem .m3u / .m3u8 liste linklerini hem de doğrudan .ts / .mp4 yayın bağlantılarını destekler.
            </p>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isLoading ? 'Yükleniyor...' : 'Linkten Ekle'}
          </button>
        </form>
      )}

      {!pendingPlaylist && activeTab === 'paste' && (
        <form onSubmit={handlePasteSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="m3u-paste-input" className="block text-xs font-medium text-slate-300">
              M3U İçeriği veya Doğrudan Yayın Linkleri (.m3u / .m3u8 / .ts)
            </label>
            <textarea
              id="m3u-paste-input"
              rows={6}
              value={pasteInput}
              onChange={(e) => setPasteInput(e.target.value)}
              placeholder={
                'https://ornek.com/liste.m3u\nveya satır satır yayın linkleri:\nhttps://yayin.ornek.com/kanal1.ts\nhttps://yayin.ornek.com/kanal2.m3u8\nveya #EXTM3U liste içeriği'
              }
              className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#0B0D12] p-3.5 font-mono text-xs leading-relaxed text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isLoading ? 'İşleniyor...' : 'Listeye Ekle'}
          </button>
        </form>
      )}

      {/* Parsed Preview Confirmation */}
      {pendingPlaylist && pendingStats && (
        <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="mt-0.5 text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold text-white">
                Liste Hazır
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-slate-300">
                <span>Toplam {pendingStats.total.toLocaleString('tr-TR')} içerik</span>
                <span aria-hidden="true">·</span>
                <span>{pendingStats.live.toLocaleString('tr-TR')} Canlı TV</span>
                <span aria-hidden="true">·</span>
                <span>{pendingStats.movie.toLocaleString('tr-TR')} Film</span>
                <span aria-hidden="true">·</span>
                <span>{pendingStats.series.toLocaleString('tr-TR')} Dizi</span>
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConfirmPending}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
            >
              Oynatıcıyı Aç
            </button>
            <button
              type="button"
              onClick={() => setPendingPlaylist(null)}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-white/[0.1] px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.05] whitespace-nowrap shrink-0"
            >
              Başka Kaynak Seç
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* Sample Playlist Action */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
        <p className="text-xs text-slate-400">
          Henüz bir M3U listeniz yok mu? Açık test yayınlarıyla arayüzü deneyebilirsiniz.
        </p>
        <button
          type="button"
          onClick={handleLoadSample}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
        >
          <Sparkles size={14} className="text-blue-400" />
          <span>Örnek Yayın Listesini Yükle</span>
        </button>
      </div>
    </div>
  );
}
