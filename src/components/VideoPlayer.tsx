import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings,
  ShieldCheck,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {ChannelItem} from '../types/iptv';

interface QualityLevel {
  index: number;
  label: string;
  height: number;
}

interface AudioOption {
  id: number;
  name: string;
}

interface VideoPlayerProps {
  channel: ChannelItem | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  isTheatreMode: boolean;
  onToggleTheatreMode: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface StreamCandidate {
  url: string;
  mode: 'hls' | 'mpegts' | 'flv' | 'native';
}

function buildStreamCandidates(channel: ChannelItem): StreamCandidate[] {
  const rawUrl = channel.url.trim();
  const [pathOnly] = rawUrl.split('?');
  const lowerPath = pathOnly.toLowerCase();

  if (
    channel.streamFormat === 'native' ||
    lowerPath.endsWith('.mp4') ||
    lowerPath.endsWith('.webm') ||
    lowerPath.endsWith('.m4v') ||
    lowerPath.endsWith('.mov') ||
    lowerPath.endsWith('.ogg') ||
    lowerPath.endsWith('.mkv')
  ) {
    return [{url: rawUrl, mode: 'native'}];
  }

  if (channel.streamFormat === 'mpegts' || lowerPath.endsWith('.ts')) {
    const candidates: StreamCandidate[] = [{url: rawUrl, mode: 'mpegts'}];
    if (lowerPath.endsWith('.ts')) {
      candidates.push({
        url: rawUrl.replace(/\.ts(\?.*)?$/i, '.m3u8$1'),
        mode: 'hls',
      });
    }
    return candidates;
  }

  if (lowerPath.endsWith('.flv')) {
    return [
      {url: rawUrl, mode: 'flv'},
      {url: rawUrl.replace(/\.flv(\?.*)?$/i, '.m3u8$1'), mode: 'hls'},
    ];
  }

  if (lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.m3u') || channel.streamFormat === 'hls') {
    const candidates: StreamCandidate[] = [{url: rawUrl, mode: 'hls'}];
    if (lowerPath.endsWith('.m3u8') && channel.mediaType === 'live') {
      candidates.push({
        url: rawUrl.replace(/\.m3u8(\?.*)?$/i, '.ts$1'),
        mode: 'mpegts',
      });
    }
    return candidates;
  }

  // Extensionless IPTV stream URL (common with output=ts panels like /user/pass/12345)
  if (channel.mediaType === 'live') {
    return [
      {url: rawUrl, mode: 'mpegts'},
      {url: rawUrl, mode: 'hls'},
      {url: `${rawUrl}.m3u8`, mode: 'hls'},
    ];
  }

  return [
    {url: rawUrl, mode: 'hls'},
    {url: rawUrl, mode: 'native'},
  ];
}

function describeUpstreamStatus(status: number | null, usingProxy: boolean): string {
  if (status === 401) {
    return 'IPTV sunucusu hesap bilgilerini reddetti (HTTP 401). Kullanıcı adı veya şifre süresi dolmuş olabilir.';
  }
  if (status === 403) {
    return usingProxy
      ? 'Sunucu erişimi engelledi (HTTP 403). IPTV sağlayıcısı bulut/proxy IP adreslerini veya eşzamanlı bağlantıyı kısıtlıyor olabilir.'
      : 'Yayın erişimi reddedildi (HTTP 403). Proxy ile oynatmayı deneyebilirsiniz.';
  }
  if (status === 404) {
    return 'Yayın kanalı sunucuda bulunamadı (HTTP 404). Kanal çevrimdışı veya bağlantısı değişmiş olabilir.';
  }
  if (status === 429 || status === 503) {
    return `IPTV sunucusu şu anda yoğun veya bağlantı limitine ulaşıldı (HTTP ${status}).`;
  }
  if (status && status >= 500) {
    return `Yayın kaynağı yanıt vermiyor (HTTP ${status}). Sunucu geçici olarak çevrimdışı olabilir.`;
  }
  return usingProxy
    ? 'Yayın kaynağına proxy üzerinden de ulaşılamadı. Bağlantı çevrimdışı veya sunucu proxy IP adresini engelliyor olabilir.'
    : 'Yayın yüklenemedi (CORS veya ağ hatası). Proxy ile oynatmayı deneyebilirsiniz.';
}

function defaultNeedsProxy(url?: string): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    Boolean(url?.trim().toLowerCase().startsWith('http://'))
  );
}

export function VideoPlayer({
  channel,
  isFavorite,
  onToggleFavorite,
  onPrevChannel,
  onNextChannel,
  hasPrev,
  hasNext,
  isTheatreMode,
  onToggleTheatreMode,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const hideControlsTimer = useRef<number | null>(null);

  const currentChannelKey = channel ? `${channel.id}|${channel.url}` : null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState(() => ({
    channelKey: currentChannelKey,
    useProxy: defaultNeedsProxy(channel?.url),
    attemptIndex: 0,
    reloadNonce: 0,
  }));

  const useProxy = playback.useProxy;
  const attemptIndex = playback.attemptIndex;
  const reloadNonce = playback.reloadNonce;

  const setUseProxy = useCallback((next: boolean) => {
    setPlayback((prev) => ({...prev, useProxy: next}));
  }, []);

  const setAttemptIndex = useCallback((next: number | ((prev: number) => number)) => {
    setPlayback((prev) => ({
      ...prev,
      attemptIndex: typeof next === 'function' ? next(prev.attemptIndex) : next,
    }));
  }, []);

  const setReloadNonce = useCallback((next: number | ((prev: number) => number)) => {
    setPlayback((prev) => ({
      ...prev,
      reloadNonce: typeof next === 'function' ? next(prev.reloadNonce) : next,
    }));
  }, []);

  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [audioTracks, setAudioTracks] = useState<AudioOption[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<number>(0);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  // Sync playback state when switching channels (race-free)
  useEffect(() => {
    setPlayback({
      channelKey: currentChannelKey,
      useProxy: defaultNeedsProxy(channel?.url),
      attemptIndex: 0,
      reloadNonce: 0,
    });
    setErrorMessage(null);
    setQualities([]);
    setSelectedQuality(-1);
    setAudioTracks([]);
    setShowSettingsMenu(false);
    setCurrentTime(0);
    setDuration(0);
  }, [currentChannelKey, channel?.url]);

  // Attach HLS / MPEG-TS / Native stream with automatic format fallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel || playback.channelKey !== currentChannelKey) return;

    const candidates = buildStreamCandidates(channel);
    const activeCandidate = candidates[Math.min(attemptIndex, candidates.length - 1)];
    if (!activeCandidate) return;

    let cancelled = false;
    let handledFailure = false;
    setIsBuffering(true);
    setErrorMessage(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const effectiveUrl = useProxy
      ? `/api/proxy-stream?url=${encodeURIComponent(activeCandidate.url)}`
      : activeCandidate.url;

    const handleAttemptFailure = (statusFromPlayer?: number | null) => {
      if (cancelled || handledFailure) return;
      handledFailure = true;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }

      // 1. Try next stream candidate format (.m3u8 <-> .ts)
      if (attemptIndex + 1 < candidates.length) {
        setPlayback((prev) => ({
          ...prev,
          attemptIndex: prev.attemptIndex + 1,
        }));
        return;
      }

      // 2. If direct HTTPS stream failed (likely CORS), auto-switch to proxy
      if (!useProxy) {
        setPlayback((prev) => ({
          ...prev,
          useProxy: true,
          attemptIndex: 0,
        }));
        return;
      }

      setIsBuffering(false);
      setErrorMessage(describeUpstreamStatus(statusFromPlayer ?? null, useProxy));
    };

    const tryNativePlayback = () => {
      video.src = effectiveUrl;
      video.load();
      video
        .play()
        .then(() => {
          if (!cancelled) setIsBuffering(false);
        })
        .catch(() => {
          // Wait for playing or onError
        });
    };

    if (
      (activeCandidate.mode === 'mpegts' || activeCandidate.mode === 'flv') &&
      mpegts.isSupported()
    ) {
      const player = mpegts.createPlayer(
        {
          type: activeCandidate.mode === 'flv' ? 'flv' : 'mpegts',
          isLive: channel.mediaType === 'live',
          url: effectiveUrl,
          withCredentials: useProxy,
        },
        {
          enableStashBuffer: true,
          autoCleanupSourceBuffer: true,
          liveBufferLatencyChasing: channel.mediaType === 'live',
        },
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play())
        .then(() => {
          if (!cancelled) setIsBuffering(false);
        })
        .catch(() => {
          // Wait for playing or error event
        });

      player.on(mpegts.Events.ERROR, (_errType, _errDetail, info) => {
        const httpCode =
          info && typeof info === 'object' && 'code' in info && typeof info.code === 'number'
            ? info.code
            : null;
        handleAttemptFailure(httpCode);
      });
    } else if (activeCandidate.mode === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: channel.mediaType === 'live',
        backBufferLength: 60,
        xhrSetup: useProxy
          ? (xhr) => {
              xhr.withCredentials = true;
            }
          : undefined,
      });
      hlsRef.current = hls;

      hls.loadSource(effectiveUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        if (cancelled) return;
        const levels: QualityLevel[] = data.levels
          .map((lvl, idx) => ({
            index: idx,
            height: lvl.height || 0,
            label: lvl.height ? `${lvl.height}p` : `${Math.round((lvl.bitrate || 0) / 1000)} kbps`,
          }))
          .sort((a, b) => b.height - a.height);
        setQualities(levels);
        setSelectedQuality(-1);

        video.play().catch(() => {
          setIsBuffering(false);
        });
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_evt, data) => {
        if (cancelled) return;
        const tracks = data.audioTracks.map((t, idx) => ({
          id: idx,
          name: t.name || t.lang || `Ses ${idx + 1}`,
        }));
        setAudioTracks(tracks);
        setSelectedAudio(hls.audioTrack);
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled) return;
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            const statusCode =
              typeof data.response?.code === 'number' && data.response.code > 0
                ? data.response.code
                : null;
            handleAttemptFailure(statusCode);
          }
        }
      });
    } else {
      tryNativePlayback();
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, currentChannelKey, playback.channelKey, useProxy, attemptIndex, reloadNonce]);

  // Keep volume synced
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted]);

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) {
      window.clearTimeout(hideControlsTimer.current);
    }
    hideControlsTimer.current = window.setTimeout(() => {
      if (isPlaying && !showSettingsMenu) {
        setControlsVisible(false);
      }
    }, 3000);
  }, [isPlaying, showSettingsMenu]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // Ignore PiP unsupported errors
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
  }, []);

  const handleQualityChange = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setSelectedQuality(levelIndex);
    }
    setShowSettingsMenu(false);
  };

  const handleAudioChange = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setSelectedAudio(trackId);
    }
    setShowSettingsMenu(false);
  };

  // Keyboard shortcuts when video is active and focus isn't inside an input
  useEffect(() => {
    if (!channel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowLeft') {
        seekBy(-10);
      } else if (e.key === 'ArrowRight') {
        seekBy(10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [channel, togglePlay, toggleFullscreen, toggleMute, seekBy]);

  if (!channel) {
    return null;
  }

  const isVodSeekable = Number.isFinite(duration) && duration > 0 && channel.mediaType !== 'live';
  const mediaTypeLabel =
    channel.mediaType === 'live' ? 'Canlı TV' : channel.mediaType === 'movie' ? 'Film' : 'Dizi';

  return (
    <section aria-label="Video Oynatıcı" className="w-full">
      <div
        ref={containerRef}
        onMouseMove={revealControls}
        onMouseLeave={() => {
          if (isPlaying && !showSettingsMenu) setControlsVisible(false);
        }}
        className="group relative aspect-video w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black"
      >
        <video
          ref={videoRef}
          playsInline
          onClick={togglePlay}
          onPlay={() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => {
            setIsPlaying(false);
            setControlsVisible(true);
          }}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsBuffering(false);
            setErrorMessage(null);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onError={(e) => {
            if (!hlsRef.current && !mpegtsRef.current && e.currentTarget.getAttribute('src')) {
              if (!useProxy) {
                setPlayback((prev) => ({
                  ...prev,
                  useProxy: true,
                  attemptIndex: 0,
                }));
                return;
              }
              setIsBuffering(false);
              const lowerUrl = channel.url.split('?')[0].toLowerCase();
              const isNonNativeContainer =
                lowerUrl.endsWith('.mkv') || lowerUrl.endsWith('.avi') || lowerUrl.endsWith('.flv');
              setErrorMessage(
                isNonNativeContainer
                  ? 'Bu video dosyası (.mkv/.avi) tarayıcının doğrudan oynatamadığı bir ses/görüntü kodeği (ör. AC3/HEVC) içeriyor olabilir.'
                  : 'Yayın formatı tarayıcı tarafından desteklenmiyor veya kaynak yanıt vermiyor.',
              );
            }
          }}
          className="h-full w-full cursor-pointer object-contain"
        />

        {/* Buffering Spinner */}
        {isBuffering && !errorMessage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
            <div className="flex flex-col items-center gap-3">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-blue-500" />
              <span className="text-xs font-medium text-slate-200">Yayın yükleniyor...</span>
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {errorMessage && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#090B0F]/92 p-6">
            <div className="max-w-md text-center">
              <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-400" />
              <h3 className="font-display text-base font-semibold text-white">
                Yayın Açılamadı
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{errorMessage}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAttemptIndex(0);
                    setReloadNonce((n) => n + 1);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
                >
                  <RefreshCw size={14} />
                  <span>Tekrar Dene</span>
                </button>
                {!useProxy ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAttemptIndex(0);
                      setUseProxy(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
                  >
                    <ShieldCheck size={14} />
                    <span>Proxy ile Oynat</span>
                  </button>
                ) : channel.url.toLowerCase().startsWith('https://') ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAttemptIndex(0);
                      setUseProxy(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
                  >
                    <span>Proxysiz Dene</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Top & Bottom Overlay Scrim + Controls */}
        <div
          className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-200 ${
            controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Top gradient */}
          <div className="bg-gradient-to-b from-black/80 via-black/35 to-transparent px-4 pt-3.5 pb-8">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-white sm:text-base">
                  {channel.name}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-300">
                  <span>{mediaTypeLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{channel.group}</span>
                  {channel.qualityLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{channel.qualityLabel}</span>
                    </>
                  )}
                </p>
              </div>
              {channel.mediaType === 'live' && isPlaying && (
                <div className="pointer-events-auto flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap shrink-0">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span>CANLI</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom gradient & interactive controls */}
          <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-10 pb-3.5">
            {/* Seek Bar for VOD */}
            {isVodSeekable && (
              <div className="mb-3 flex items-center gap-3">
                <span className="font-mono text-xs tabular-nums text-slate-300">
                  {formatTime(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={1}
                  value={currentTime}
                  onChange={(e) => {
                    const video = videoRef.current;
                    if (video) video.currentTime = Number(e.target.value);
                  }}
                  aria-label="İlerleme çubuğu"
                  className="h-1.5 w-full cursor-pointer accent-blue-500"
                />
                <span className="font-mono text-xs tabular-nums text-slate-400">
                  {formatTime(duration)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              {/* Left Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Duraklat' : 'Oynat'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>

                {isVodSeekable && (
                  <>
                    <button
                      type="button"
                      onClick={() => seekBy(-10)}
                      aria-label="10 saniye geri"
                      className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 sm:flex"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => seekBy(10)}
                      aria-label="10 saniye ileri"
                      className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 sm:flex"
                    >
                      <RotateCw size={16} />
                    </button>
                  </>
                )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Sesi aç' : 'Sessize al'}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setVolume(next);
                      if (next > 0 && isMuted) setIsMuted(false);
                    }}
                    aria-label="Ses düzeyi"
                    className="hidden h-1 w-20 cursor-pointer accent-blue-500 sm:block"
                  />
                </div>
              </div>

              {/* Right Controls */}
              <div className="relative flex items-center gap-1 sm:gap-1.5">
                {(qualities.length > 0 || audioTracks.length > 1) && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSettingsMenu((prev) => !prev)}
                      aria-label="Kalite ve Ses Ayarları"
                      className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
                    >
                      <Settings size={15} />
                      <span className="hidden sm:inline">
                        {selectedQuality === -1
                          ? 'Otomatik'
                          : qualities.find((q) => q.index === selectedQuality)?.label || 'Kalite'}
                      </span>
                    </button>

                    {showSettingsMenu && (
                      <div className="absolute right-0 bottom-11 z-30 w-48 rounded-lg border border-white/10 bg-[#121620] p-2 shadow-xl">
                        {qualities.length > 0 && (
                          <div>
                            <p className="px-2 py-1 text-[11px] font-medium text-slate-400">
                              Görüntü Kalitesi
                            </p>
                            <button
                              type="button"
                              onClick={() => handleQualityChange(-1)}
                              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                                selectedQuality === -1
                                  ? 'bg-blue-600/20 text-blue-400'
                                  : 'text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              <span>Otomatik</span>
                            </button>
                            {qualities.map((q) => (
                              <button
                                key={q.index}
                                type="button"
                                onClick={() => handleQualityChange(q.index)}
                                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                                  selectedQuality === q.index
                                    ? 'bg-blue-600/20 text-blue-400'
                                    : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <span>{q.label}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {audioTracks.length > 1 && (
                          <div className="mt-2 border-t border-white/10 pt-2">
                            <p className="px-2 py-1 text-[11px] font-medium text-slate-400">
                              Ses Kanalı
                            </p>
                            {audioTracks.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleAudioChange(t.id)}
                                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                                  selectedAudio === t.id
                                    ? 'bg-blue-600/20 text-blue-400'
                                    : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">{t.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={togglePiP}
                  aria-label="Resim içinde resim"
                  className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 sm:flex"
                >
                  <PictureInPicture2 size={17} />
                </button>

                <button
                  type="button"
                  onClick={onToggleTheatreMode}
                  aria-label={isTheatreMode ? 'Normal görünüm' : 'Sinema modu'}
                  className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 lg:flex"
                >
                  <Monitor size={17} />
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-white/10"
                >
                  {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Now Playing Action Strip below video */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-[#10131A] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs tabular-nums text-slate-400">
              #{String(channel.index).padStart(2, '0')}
            </span>
            <h2 className="truncate font-display text-base font-semibold text-white">
              {channel.name}
            </h2>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{mediaTypeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{channel.group}</span>
            {channel.qualityLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{channel.qualityLabel}</span>
              </>
            )}
            {useProxy && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-blue-400">Proxy aktif</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onPrevChannel}
            disabled={!hasPrev}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <ChevronLeft size={15} />
            <span>Önceki</span>
          </button>
          <button
            type="button"
            onClick={onNextChannel}
            disabled={!hasNext}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <span>Sonraki</span>
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(channel.id)}
            aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              isFavorite
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-white/[0.08] bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]'
            }`}
          >
            <Star size={14} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} />
            <span>{isFavorite ? 'Favori' : 'Favorile'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
