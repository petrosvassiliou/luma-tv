export function selectSupportedRecorderMimeType(): {
  mimeType: string;
  extension: 'mp4' | 'webm';
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'webm' };
  }

  const candidates: { mimeType: string; extension: 'mp4' | 'webm' }[] = [
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: '', extension: 'webm' };
}

interface CaptureCapableElement extends HTMLElement {
  captureStream?: (frameRate?: number) => MediaStream;
  mozCaptureStream?: (frameRate?: number) => MediaStream;
}

export class LumaDvrRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private extension: 'mp4' | 'webm' = 'webm';
  private channelShortCode = 'LUMA';

  public startRecording(
    sourceEl: HTMLVideoElement | HTMLCanvasElement,
    channelShortCode: string
  ): boolean {
    if (typeof MediaRecorder === 'undefined') return false;

    const capEl = sourceEl as unknown as CaptureCapableElement;
    const stream = capEl.captureStream
      ? capEl.captureStream(30)
      : capEl.mozCaptureStream
        ? capEl.mozCaptureStream(30)
        : null;

    if (!stream || stream.getTracks().length === 0) {
      return false;
    }

    const { mimeType, extension } = selectSupportedRecorderMimeType();
    this.extension = extension;
    this.channelShortCode = channelShortCode;
    this.chunks = [];

    try {
      this.recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 })
        : new MediaRecorder(stream);

      this.recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          this.chunks.push(ev.data);
        }
      };

      this.recorder.onstop = () => {
        if (this.chunks.length === 0) return;
        const blob = new Blob(this.chunks, {
          type: mimeType || `video/${this.extension}`,
        });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `LumaTV-DVR-${this.channelShortCode}-${stamp}.${this.extension}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        this.chunks = [];
      };

      this.recorder.start(1000);
      return true;
    } catch {
      this.recorder = null;
      return false;
    }
  }

  public stopAndDownload(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;
  }

  public isRecording(): boolean {
    return Boolean(this.recorder && this.recorder.state === 'recording');
  }
}
