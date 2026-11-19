import {Check, Copy, Globe, Monitor, Server, Smartphone, Tv, X} from 'lucide-react';
import {useState} from 'react';
import {getApiBaseUrl, isPackagedWebOsApp, setApiBaseUrl} from '../utils/apiConfig';

interface LgTvGuideModalProps {
  tvMode: boolean;
  onToggleTvMode: () => void;
  onClose: () => void;
}

export function LgTvGuideModal({tvMode, onToggleTvMode, onClose}: LgTvGuideModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const packagedWebOs = isPackagedWebOsApp();
  const [apiBaseInput, setApiBaseInput] = useState(() => getApiBaseUrl());
  const [savedApiBase, setSavedApiBase] = useState(false);

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://192.168.1.35:3000';
  const isLocalHttp =
    currentOrigin.startsWith('http://') && !currentOrigin.includes('localhost');

  const handleCopyOrigin = () => {
    void navigator.clipboard?.writeText(currentOrigin).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleSaveApiBase = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = setApiBaseUrl(apiBaseInput);
    setApiBaseInput(updated);
    setSavedApiBase(true);
    window.setTimeout(() => setSavedApiBase(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="LG TV Kullanım ve Kurulum Rehberi"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/15 text-blue-400 shrink-0">
              <Tv size={20} />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                LG Smart TV (webOS 5.0) Kullanımı
              </h2>
              <p className="text-xs text-slate-400">
                Kumanda desteği, .ipk uygulama paketi ve TV&apos;den bağlantı seçenekleri
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-[#090B0F] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* TV Mode Toggle Card */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#090B0F] p-4">
          <div>
            <p className="text-sm font-medium text-white">TV Kumanda Modu</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Yön tuşları (D-Pad) ile gezinme, büyük odak çerçevesi ve uzaktan okunaklı yazı boyutu.
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleTvMode}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tvMode
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'border border-white/[0.1] bg-[#141923] text-slate-200 hover:bg-white/[0.08]'
            }`}
          >
            <Tv size={14} />
            <span>{tvMode ? 'TV Modu Açık' : 'TV Modunu Aç'}</span>
          </button>
        </div>

        {/* Packaged webOS API Origin Setting */}
        {packagedWebOs && (
          <form
            onSubmit={handleSaveApiBase}
            className="mt-4 rounded-xl border border-blue-500/30 bg-[#090B0F] p-4"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Server size={15} className="text-blue-400 shrink-0" />
              <span>Uzak Liste API Sunucusu (webOS .ipk Modu)</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Server Girişi ve M3U Link çekme işlemleri için kullanılır. Yayın videoları yine
              doğrudan TV&apos;nin kendi ev IP&apos;sinden oynatılır.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <input
                type="url"
                value={apiBaseInput}
                onChange={(e) => setApiBaseInput(e.target.value)}
                placeholder="https://uygulamaniz.vercel.app"
                className="h-9 min-w-[200px] flex-1 rounded-lg border border-white/[0.1] bg-[#10131A] px-3 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-500 shrink-0"
              >
                {savedApiBase && <Check size={13} />}
                <span>{savedApiBase ? 'Kaydedildi' : 'Kaydet'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Remote Keys Reference */}
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#090B0F] p-4">
          <p className="text-xs font-medium text-slate-300">LG TV Kumanda Kısayolları</p>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-2">
              <span className="text-slate-400">Kanal / Kart Gezme</span>
              <span className="font-mono text-slate-200">Yön Tuşları + OK</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-2">
              <span className="text-slate-400">Önceki / Sonraki Kanal</span>
              <span className="font-mono text-slate-200">CH- / CH+</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-2">
              <span className="text-slate-400">Geri / Oynatıcıyı Kapat</span>
              <span className="font-mono text-slate-200">Geri (Back)</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-2">
              <span className="text-slate-400">Oynat / Duraklat / Tam Ekran</span>
              <span className="font-mono text-slate-200">Play / Pause / F</span>
            </div>
          </div>
        </div>

        {/* Connection Options for LG TV */}
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-[#090B0F] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Monitor size={16} className="text-blue-400 shrink-0" />
              <span>1. LG webOS 5.0 Uygulaması (.ipk) Olarak Kurulum</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Proje kökünde <code className="font-mono text-slate-200">npm run build:webos</code>{' '}
              komutunu çalıştırdığınızda{' '}
              <code className="font-mono text-slate-200">
                webos-out/com.aypitivi.iptv_1.0.0_all.ipk
              </code>{' '}
              oluşur. TV&apos;deki resmi <strong>Developer Mode</strong> uygulamasını açıp{' '}
              <strong>webOS Dev Manager</strong> ile Wi-Fi üzerinden tek seferde TV&apos;ye
              yükleyebilirsiniz; izlerken PC gerekmez.
            </p>
            {!packagedWebOs && (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-[#10131A] px-3 py-2">
                <span className="truncate font-mono text-xs text-slate-300">
                  {isLocalHttp ? currentOrigin : 'Yerel Ağ Örneği: http://192.168.1.35:3000'}
                </span>
                {isLocalHttp && (
                  <button
                    type="button"
                    onClick={handleCopyOrigin}
                    className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/[0.12] shrink-0"
                  >
                    {copiedUrl ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                    <span>{copiedUrl ? 'Kopyalandı' : 'Adresi Kopyala'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-[#090B0F] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Smartphone size={16} className="text-emerald-400 shrink-0" />
              <span>2. Developer Mode Olmadan Diğer Seçenekler</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-400">
              <li>
                <strong className="text-slate-200">Telefondan Yansıtma:</strong> Android/iPhone&apos;da{' '}
                <em>Web Video Caster</em> ile M3U/Xtream yayınını telefonun ev IP&apos;sinden açıp
                LG TV&apos;ye aktarabilirsiniz.
              </li>
              <li>
                <strong className="text-slate-200">LG Store Uygulamaları:</strong> LG Content
                Store&apos;da <em>SS IPTV</em>, <em>OttPlayer</em> veya <em>SmartOne IPTV</em>{' '}
                uygulamalarını kontrol edebilirsiniz.
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#090B0F] px-4 py-3 text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-slate-500 shrink-0" />
              <span>LG webOS oynatıcıda tam ekran için Tam Ekran butonunu veya F tuşunu kullanın.</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-500 shrink-0"
            >
              Tamam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
