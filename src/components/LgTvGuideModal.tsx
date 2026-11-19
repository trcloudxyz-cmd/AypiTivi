import {Check, Copy, Globe, Monitor, Smartphone, Tv, X} from 'lucide-react';
import {useState} from 'react';

interface LgTvGuideModalProps {
  tvMode: boolean;
  onToggleTvMode: () => void;
  onClose: () => void;
}

export function LgTvGuideModal({tvMode, onToggleTvMode, onClose}: LgTvGuideModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);

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
                LG Smart TV (webOS) Kullanımı
              </h2>
              <p className="text-xs text-slate-400">
                Kumanda desteği, tam ekran uyumu ve TV&apos;den bağlantı seçenekleri
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
              <span>1. Ev Ağından Açma (TR IP Kilidi Olan Hesaplar İçin)</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Evdeki bilgisayarda <code className="font-mono text-slate-200">npm run dev</code> veya{' '}
              <code className="font-mono text-slate-200">npm start</code> çalıştırıp LG TV
              tarayıcısından <code className="font-mono text-slate-200">http://BILGISAYAR-IP:3000</code>{' '}
              adresini açın. Yayınlar kendi ev IP&apos;nizden çekilir.
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-[#10131A] px-3 py-2">
              <span className="truncate font-mono text-xs text-slate-300">
                {isLocalHttp ? currentOrigin : 'Örnek: http://192.168.1.35:3000'}
              </span>
              {isLocalHttp && (
                <button
                  type="button"
                  onClick={handleCopyOrigin}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/[0.12] shrink-0"
                >
                  {copiedUrl ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedUrl ? 'Kopyalandı' : 'Adresi Kopyala'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-[#090B0F] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Smartphone size={16} className="text-emerald-400 shrink-0" />
              <span>2. Bilgisayar Olmadan LG TV&apos;de Açma Yolları</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-400">
              <li>
                <strong className="text-slate-200">Telefondan Yansıtma:</strong> Android/iPhone&apos;da{' '}
                <em>Web Video Caster</em> veya DLNA uygulaması ile M3U/Xtream akışını telefonun ev
                IP&apos;sinden açıp doğrudan LG TV&apos;ye aktarabilirsiniz.
              </li>
              <li>
                <strong className="text-slate-200">LG Store Uygulamaları:</strong> LG Content
                Store&apos;da <em>SS IPTV</em>, <em>OttPlayer</em>, <em>IPTV Smarters</em> veya{' '}
                <em>SmartOne IPTV</em> aratın (görünmüyorsa TV Ayarları &rarr; Konum &rarr; LG
                Hizmet Ülkesi üzerinden mağaza yenilenebilir).
              </li>
              <li>
                <strong className="text-slate-200">Türkiye Lokasyonlu Sunucu / Sağlayıcı İzni:</strong>{' '}
                IPTV sağlayıcınızdan yurt dışı/proxy kilidini açtırırsanız bu web uygulamasını
                doğrudan LG TV tarayıcısından bilgisayarsız açabilirsiniz.
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#090B0F] px-4 py-3 text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-slate-500 shrink-0" />
              <span>LG webOS Tarayıcıda tam ekran için oynatıcıdaki Tam Ekran butonunu kullanın.</span>
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
