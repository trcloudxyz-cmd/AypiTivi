import {Clapperboard, Film, Tv} from 'lucide-react';
import {useState} from 'react';
import type {MediaCategory} from '../types/iptv';

interface ChannelThumbnailProps {
  src?: string;
  name: string;
  mediaType: MediaCategory;
  fit?: 'cover' | 'contain';
  className?: string;
  iconSize?: number;
}

export function ChannelThumbnail({
  src,
  name,
  mediaType,
  fit = 'cover',
  className = '',
  iconSize = 22,
}: ChannelThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  const initials = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  if (src && !hasError) {
    return (
      <div
        className={`relative overflow-hidden bg-[#121620] ${
          fit === 'contain' ? 'flex items-center justify-center p-2.5' : ''
        } ${className}`}
      >
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setHasError(true)}
          className={
            fit === 'contain' ? 'max-h-full max-w-full object-contain' : 'h-full w-full object-cover'
          }
        />
      </div>
    );
  }

  const FallbackIcon = mediaType === 'movie' ? Film : mediaType === 'series' ? Clapperboard : Tv;

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#161B26] via-[#11151E] to-[#0C0F16] text-slate-400 ${className}`}
    >
      <FallbackIcon size={iconSize} strokeWidth={1.6} className="text-slate-500" />
      {initials && (
        <span className="mt-1 font-display text-[11px] font-semibold tracking-wider text-slate-500">
          {initials}
        </span>
      )}
    </div>
  );
}
