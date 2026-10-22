import { Zip, ZipPassThrough } from "fflate";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

// A job renders frame i into the given 2D context; the exporters own the canvas and the loop.
export interface ExportJob {
  width: number;
  height: number;
  fps: number;
  frames: number;
  renderFrame(ctx: OffscreenCanvasRenderingContext2D, index: number): void;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

// H.264 High → Main → Baseline, level 4.2 (1080p at up to 60 fps).
const AVC_CODECS = ["avc1.64002A", "avc1.4D002A", "avc1.42002A"];

export async function pickAvcCodec(width: number, height: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of AVC_CODECS) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 16e6 });
    if (supported) return codec;
  }
  return null;
}

// Encodes frame by frame, so the result is exact and doesn't depend on playback speed.
export async function encodeMp4(job: ExportJob): Promise<Blob> {
  const { width, height, fps, frames } = job;
  const codec = await pickAvcCodec(width, height, fps);
  if (!codec) throw new Error("This browser can't encode H.264 video. Use Chrome or Edge.");

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let failure: unknown;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure({ codec, width, height, framerate: fps, bitrate: 16e6, avc: { format: "avc" } });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const frameUs = 1e6 / fps;
  try {
    for (let i = 0; i < frames; i++) {
      checkAborted(job.signal);
      if (failure) throw failure;
      job.renderFrame(ctx, i);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // Keep the encoder queue short so memory stays flat on long games.
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 10 === 0) {
        job.onProgress?.(i, frames);
        await yieldToUi();
      }
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  muxer.finalize();
  job.onProgress?.(frames, frames);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

export const frameName = (index: number) => `frame_${String(index + 1).padStart(5, "0")}.png`;

async function eachPng(job: ExportJob, write: (name: string, png: Blob) => Promise<void>) {
  const canvas = new OffscreenCanvas(job.width, job.height);
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < job.frames; i++) {
    checkAborted(job.signal);
    job.renderFrame(ctx, i);
    await write(frameName(i), await canvas.convertToBlob({ type: "image/png" }));
    if (i % 5 === 0) job.onProgress?.(i, job.frames);
  }
  job.onProgress?.(job.frames, job.frames);
}

// Writes frame_00001.png … straight into a folder: the easiest import for After Effects and Premiere.
export async function writePngFolder(job: ExportJob, dir: FileSystemDirectoryHandle): Promise<void> {
  await eachPng(job, async (name, png) => {
    const file = await dir.getFileHandle(name, { create: true });
    const out = await file.createWritable();
    await out.write(png);
    await out.close();
  });
}

// Fallback for browsers without folder access: one zip, stored uncompressed (PNGs are already compressed).
export async function encodePngZip(job: ExportJob, folder: string): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) zipError = err;
    else parts.push(data);
  });
  await eachPng(job, async (name, png) => {
    const entry = new ZipPassThrough(`${folder}/${name}`);
    zip.add(entry);
    entry.push(new Uint8Array(await png.arrayBuffer()), true);
    if (zipError) throw zipError;
  });
  zip.end();
  // fflate hands back plain ArrayBuffer-backed chunks; TS just can't tell them from shared buffers.
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
