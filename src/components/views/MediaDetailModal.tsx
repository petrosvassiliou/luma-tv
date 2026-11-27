import React from 'react';
import {
  Award,
  Clapperboard,
  Clock,
  Film,
  Play,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { PlatformDesignMode, SeriesItem, VodItem } from '../../types/luma';

export interface MediaInspectTarget {
  kind: 'vod' | 'series';
  vod?: VodItem;
  series?: SeriesItem;
}

interface MediaDetailModalProps {
  designMode: PlatformDesignMode;
  target: MediaInspectTarget;
  onClose: () => void;
  onPlayPrimary: () => void;
  onPlayTrailer: () => void;
}

const CAST_BY_GENRE: Record<string, { director: string; cast: string[]; languages: string }> = {
  default: {
    director: 'Ton Roosendaal & Hubert',
    cast: ['Derek de Lint', 'Sergio Hasselbaink', 'Rogier Schippers', 'Denise Rebergen'],
    languages: 'Deutsch (EAC3 5.1), English (Dolby Atmos), Untertitel DE/EN',
  },
  space: {
    director: 'Elena Vance',
    cast: ['Mina Lin', 'Jonas Lindqvist', 'David K. Osei', 'Clara Moreau'],
    languages: 'Deutsch (Dolby Atmos), English (TrueHD), Untertitel DE/EN/FR',
  },
};

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  designMode,
  target,
  onClose,
  onPlayPrimary,
  onPlayTrailer,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const vod = target.vod;
  const ser = target.series;

  const title = vod?.title ?? ser?.title ?? '';
  const year = vod?.year ?? ser?.year ?? 2026;
  const genre = vod?.genre ?? ser?.genre ?? '';
  const rating = vod?.rating ?? ser?.rating ?? '8.8';
  const badge = vod ? `${vod.resolution} · ${vod.codec}` : (ser?.badge ?? '4K HDR');
  const synopsis = vod?.synopsis ?? ser?.synopsis ?? '';
  const accentFrom = vod?.accentFrom ?? ser?.accentFrom ?? '#38BDF8';
  const accentTo = vod?.accentTo ?? ser?.accentTo ?? '#0F172A';
  const runtimeLabel = vod
    ? `${vod.durationMin} Min.`
    : `${ser?.seasons.length ?? 1} Staffeln · ${
        ser?.seasons.reduce((a, s) => a + s.episodes.length, 0) ?? 0
      } Episoden`;

  const meta =
    genre.toLowerCase().includes('raum') || genre.toLowerCase().includes('sci')
      ? CAST_BY_GENRE.space
      : CAST_BY_GENRE.default;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
    >
      <div
        data-tv-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl overflow-hidden ${
          isM3
            ? 'rounded-[32px] bg-[#1A202E] shadow-2xl ring-1 ring-white/10'
            : 'lg-modal rounded-[28px]'
        }`}
      >
        {/* Cinematic Backdrop Header */}
        <div
          className="relative flex h-52 flex-col justify-between p-6"
          style={{
            background: `linear-gradient(140deg, ${accentFrom}66 0%, ${accentTo}EE 100%)`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 font-semibold text-sky-200">
                {target.kind === 'vod' ? (
                  <Film className="h-3.5 w-3.5" />
                ) : (
                  <Clapperboard className="h-3.5 w-3.5" />
                )}
                {badge}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 font-semibold text-amber-300 luma-tabular">
                <Award className="h-3.5 w-3.5" />
                TMDB ★ {rating}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-slate-200 hover:bg-black/80 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <div className="flex items-center gap-2 text-xs text-sky-200/90 luma-tabular">
              <span>{genre}</span>
              <span>·</span>
              <span>{year}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {runtimeLabel}
              </span>
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">{title}</h2>
          </div>
        </div>

        {/* Metadata Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs leading-relaxed text-slate-200 sm:text-sm">{synopsis}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div
              className={`p-3.5 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300">
                <Users className="h-3.5 w-3.5" />
                <span>Besetzung &amp; Regie</span>
              </div>
              <div className="mt-1 text-slate-200">
                <strong>Regie:</strong> {meta.director}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 pt-1">
                {meta.cast.map((actor) => (
                  <span
                    key={actor}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-slate-200"
                  >
                    {actor}
                  </span>
                ))}
              </div>
            </div>

            <div
              className={`p-3.5 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="text-[11px] font-semibold text-sky-300">
                Audio- &amp; Untertitel-Spuren
              </div>
              <p className="mt-1.5 leading-relaxed text-slate-300">{meta.languages}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onPlayTrailer}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <Sparkles className="h-4 w-4 text-sky-300" />
              <span>Trailer-Stream abspielen</span>
            </button>

            <button
              type="button"
              onClick={onPlayPrimary}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold shadow-lg ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <Play className="h-4 w-4 fill-current" />
              <span>{target.kind === 'vod' ? 'Film starten' : 'Staffel 1 starten'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
