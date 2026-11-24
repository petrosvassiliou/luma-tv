import React, { useEffect, useRef } from 'react';
import type { Channel } from '../../types/luma';

interface BroadcastSynthCanvasProps {
  channel: Channel;
  programTitle: string;
  badgeCodeOverride?: string;
  paused?: boolean;
  compact?: boolean;
  externalCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export const BroadcastSynthCanvas: React.FC<BroadcastSynthCanvasProps> = ({
  channel,
  programTitle,
  badgeCodeOverride,
  paused = false,
  compact = false,
  externalCanvasRef,
}) => {
  const internalRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = externalCanvasRef ?? internalRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const seed = channel.number * 37;

    const hexToRgb = (hex: string): [number, number, number] => {
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      if (Number.isNaN(num)) return [56, 189, 248];
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    };

    const [ar, ag, ab] = hexToRgb(channel.accentColor);

    const render = (timeMs: number) => {
      const t = paused ? 1.5 : timeMs * 0.001;
      const w = (canvas.width = canvas.clientWidth || 640);
      const h = (canvas.height = canvas.clientHeight || 360);

      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#070B14');
      bg.addColorStop(
        0.55,
        `rgba(${Math.round(ar * 0.22)}, ${Math.round(ag * 0.24)}, ${Math.round(ab * 0.34)}, 1)`
      );
      bg.addColorStop(1, '#05070D');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const amp = h * (0.08 + layer * 0.035);
        const yBase = h * (0.38 + layer * 0.14);
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 18) {
          const y =
            yBase +
            Math.sin(x * 0.0045 + t * (0.9 + layer * 0.35) + seed + layer) * amp +
            Math.cos(x * 0.009 - t * 0.6 + layer * 2) * (amp * 0.45);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();

        const waveGrad = ctx.createLinearGradient(0, yBase - amp, w, h);
        waveGrad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${0.22 - layer * 0.05})`);
        waveGrad.addColorStop(0.6, `rgba(96, 165, 250, ${0.14 - layer * 0.03})`);
        waveGrad.addColorStop(1, 'rgba(9, 10, 15, 0.02)');
        ctx.fillStyle = waveGrad;
        ctx.fill();
      }

      const cx = w * 0.72;
      const cy = h * 0.44;
      const radius = Math.min(w, h) * 0.24;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.28);
      ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, 0.32)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.rotate(-t * 0.52);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.68, 0, Math.PI * 1.35);
      ctx.stroke();
      ctx.restore();

      if (!compact) {
        const badgeLabel = badgeCodeOverride || channel.shortCode;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        ctx.fillText(`${badgeLabel} · LUMA HDR STUDIO FEED`, w * 0.055, h * 0.26);

        ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, 0.95)`;
        ctx.font = '700 22px Inter, system-ui, sans-serif';
        ctx.fillText(programTitle.slice(0, 44), w * 0.055, h * 0.35);

        const now = new Date();
        const tc =
          now.toTimeString().slice(0, 8) +
          ':' +
          String(Math.floor((now.getMilliseconds() / 1000) * 60)).padStart(2, '0');
        ctx.fillStyle = 'rgba(203, 213, 225, 0.68)';
        ctx.font = '500 12px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText(`SMPTE ${tc} · 60.00 FPS · ${channel.resolution}`, w * 0.055, h * 0.42);
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [
    badgeCodeOverride,
    canvasRef,
    channel.accentColor,
    channel.number,
    channel.resolution,
    channel.shortCode,
    compact,
    paused,
    programTitle,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};
