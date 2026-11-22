export type AudioDspPreset = 'direct' | 'vocal-boost' | 'cinema-bass' | 'night-leveler';

export interface AudioPresetMeta {
  id: AudioDspPreset;
  label: string;
  description: string;
  lowShelfDb: number;
  midPeakDb: number;
  highShelfDb: number;
  compressorActive: boolean;
  makeupGain: number;
}

export const AUDIO_DSP_PRESETS: Record<AudioDspPreset, AudioPresetMeta> = {
  direct: {
    id: 'direct',
    label: 'Linear Direct',
    description: 'Unverfälschter Referenz-Ton ohne Filterung',
    lowShelfDb: 0,
    midPeakDb: 0,
    highShelfDb: 0,
    compressorActive: false,
    makeupGain: 1.0,
  },
  'vocal-boost': {
    id: 'vocal-boost',
    label: 'Sprache & Kommentar',
    description: '+5.5 dB Präsenz bei 2.5 kHz für Sport-Kommentatoren & Dialoge',
    lowShelfDb: -2.5,
    midPeakDb: 5.5,
    highShelfDb: 1.5,
    compressorActive: false,
    makeupGain: 1.12,
  },
  'cinema-bass': {
    id: 'cinema-bass',
    label: 'Kino & Raumklang',
    description: 'Tiefe Sub-Wärme (110 Hz) und feine Höhenbrillanz (8.5 kHz)',
    lowShelfDb: 4.5,
    midPeakDb: 0.5,
    highShelfDb: 3.0,
    compressorActive: false,
    makeupGain: 1.05,
  },
  'night-leveler': {
    id: 'night-leveler',
    label: 'Nachtmodus (DRC)',
    description: 'Dynamik-Kompressor dämpft laute Effekte und hebt leise Stimmen an',
    lowShelfDb: -3.5,
    midPeakDb: 3.5,
    highShelfDb: 0,
    compressorActive: true,
    makeupGain: 1.35,
  },
};

export class LumaAudioProcessor {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private midPeak: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private preAmpGain: GainNode | null = null;
  private boundElement: HTMLMediaElement | null = null;
  private currentPreset: AudioDspPreset = 'direct';
  private boostFactor = 1.0;

  public attachAndConfigure(
    video: HTMLVideoElement,
    preset: AudioDspPreset,
    boostFactor = 1.0
  ): boolean {
    this.currentPreset = preset;
    this.boostFactor = Math.min(1.8, Math.max(0.5, boostFactor));

    // Avoid creating AudioContext until user selects a non-direct preset or >100% boost
    if (preset === 'direct' && Math.abs(this.boostFactor - 1.0) < 0.01 && !this.ctx) {
      return true;
    }

    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return false;
        this.ctx = new AudioCtx();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => undefined);
      }

      if (this.boundElement !== video) {
        this.disconnectNodes();
        this.source = this.ctx.createMediaElementSource(video);
        this.boundElement = video;

        this.lowShelf = this.ctx.createBiquadFilter();
        this.lowShelf.type = 'lowshelf';
        this.lowShelf.frequency.value = 110;

        this.midPeak = this.ctx.createBiquadFilter();
        this.midPeak.type = 'peaking';
        this.midPeak.frequency.value = 2500;
        this.midPeak.Q.value = 1.1;

        this.highShelf = this.ctx.createBiquadFilter();
        this.highShelf.type = 'highshelf';
        this.highShelf.frequency.value = 8500;

        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -28;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.005;
        this.compressor.release.value = 0.22;

        this.preAmpGain = this.ctx.createGain();
      }

      this.rewireChain();
      return true;
    } catch {
      // Cross-origin media elements without CORS audio headers fall back gracefully
      return false;
    }
  }

  private rewireChain() {
    if (
      !this.ctx ||
      !this.source ||
      !this.lowShelf ||
      !this.midPeak ||
      !this.highShelf ||
      !this.compressor ||
      !this.preAmpGain
    ) {
      return;
    }

    const meta = AUDIO_DSP_PRESETS[this.currentPreset];
    this.lowShelf.gain.value = meta.lowShelfDb;
    this.midPeak.gain.value = meta.midPeakDb;
    this.highShelf.gain.value = meta.highShelfDb;
    this.preAmpGain.gain.value = meta.makeupGain * this.boostFactor;

    this.source.disconnect();
    this.lowShelf.disconnect();
    this.midPeak.disconnect();
    this.highShelf.disconnect();
    this.compressor.disconnect();
    this.preAmpGain.disconnect();

    this.source.connect(this.lowShelf);
    this.lowShelf.connect(this.midPeak);
    this.midPeak.connect(this.highShelf);

    if (meta.compressorActive) {
      this.highShelf.connect(this.compressor);
      this.compressor.connect(this.preAmpGain);
    } else {
      this.highShelf.connect(this.preAmpGain);
    }

    this.preAmpGain.connect(this.ctx.destination);
  }

  private disconnectNodes() {
    this.source?.disconnect();
    this.lowShelf?.disconnect();
    this.midPeak?.disconnect();
    this.highShelf?.disconnect();
    this.compressor?.disconnect();
    this.preAmpGain?.disconnect();
  }

  public destroy() {
    this.disconnectNodes();
    if (this.ctx) {
      this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.boundElement = null;
  }
}
