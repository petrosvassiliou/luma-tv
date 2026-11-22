import React from 'react';

interface LumaLogoProps {
  size?: number;
  showWordmark?: boolean;
  compact?: boolean;
}

export const LumaLogo: React.FC<LumaLogoProps> = ({
  size = 28,
  showWordmark = true,
  compact = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_2px_10px_rgba(56,189,248,0.28)]"
        aria-label="Luma TV Icon"
      >
        <defs>
          <linearGradient id="lumaLogoBg" x1="64" y1="32" x2="448" y2="480" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#171B29" />
            <stop offset="55%" stopColor="#0C0E16" />
            <stop offset="100%" stopColor="#07080D" />
          </linearGradient>
          <linearGradient id="lumaLogoRim" x1="96" y1="24" x2="416" y2="488" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.34" />
            <stop offset="40%" stopColor="#38BDF8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#818CF8" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="lumaLogoBeam" x1="136" y1="128" x2="396" y2="376" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="52%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#818CF8" />
          </linearGradient>
          <linearGradient id="lumaLogoPrism" x1="168" y1="124" x2="332" y2="388" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E0F2FE" />
            <stop offset="48%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#818CF8" />
          </linearGradient>
        </defs>
        <rect x="20" y="20" width="472" height="472" rx="116" fill="url(#lumaLogoBg)" />
        <rect
          x="24"
          y="24"
          width="464"
          height="464"
          rx="112"
          stroke="url(#lumaLogoRim)"
          strokeWidth="8"
        />
        <path d="M240 194L408 152V360L240 318Z" fill="url(#lumaLogoBeam)" opacity="0.26" />
        <path
          d="M156 132C156 120.954 164.954 112 176 112H208C219.046 112 228 120.954 228 132V316C228 322.627 233.373 328 240 328H352C363.046 328 372 336.954 372 348V380C372 391.046 363.046 400 352 400H188C170.327 400 156 385.673 156 368V132Z"
          fill="url(#lumaLogoPrism)"
        />
        <path
          d="M256 162C256 151.505 267.792 145.34 276.422 151.314L378.898 222.259C386.418 227.465 386.418 238.535 378.898 243.741L276.422 314.686C267.792 320.66 256 314.495 256 304V162Z"
          fill="url(#lumaLogoBeam)"
        />
      </svg>

      {showWordmark && (
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">Luma</span>
          {!compact && (
            <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-sky-300/85">
              TV
            </span>
          )}
        </div>
      )}
    </div>
  );
};
