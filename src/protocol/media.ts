import { LIMITS } from './protocol.js';

type Box = { type: string; start: number; data: number; end: number };
/** Bounded ISO-BMFF inspection usable in Workers and Node. Cinematic assets must
 * be self-contained, non-fragmented H.264 with exactly one silent video track.
 * This validates container/sample metadata; CLI additionally decodes in Chromium. */
export function inspectSilentMp4(bytes: Uint8Array) {
  if (bytes.byteLength < 32 || bytes.byteLength > LIMITS.compressed) throw new Error('Invalid video size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  let count = 0;
  function boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    while (start < end) {
      if (++count > 10000 || end - start < 8) throw new Error('Invalid MP4 box');
      const size = view.getUint32(start);
      if (size < 8 || start + size > end) throw new Error('Invalid MP4 bounds');
      result.push({ type: text(start + 4, 4), start, data: start + 8, end: start + size });
      start += size;
    }
    return result;
  }
  function one(list: Box[], type: string) {
    const matches = list.filter(box => box.type === type);
    if (matches.length !== 1) throw new Error(`Expected one ${type}`);
    return matches[0];
  }
  function child(box: Box, type: string) { return one(boxes(box.data, box.end), type); }
  function need(box: Box, size: number) { if (box.end - box.data < size) throw new Error('Truncated MP4 metadata'); }
  const top = boxes(0, bytes.length);
  const ftyp = one(top, 'ftyp'); need(ftyp, 8);
  if (!['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(text(ftyp.data, 4)) || top.some(b => ['moof', 'sidx'].includes(b.type))) throw new Error('Unsupported MP4 format');
  const mdat = one(top, 'mdat');
  const moov = one(top, 'moov');
  const tracks = boxes(moov.data, moov.end).filter(b => b.type === 'trak');
  if (tracks.length !== 1) throw new Error('Video must contain one silent track');
  const mdia = child(tracks[0], 'mdia');
  const handler = child(mdia, 'hdlr'); need(handler, 12);
  if (text(handler.data + 8, 4) !== 'vide') throw new Error('Video must not contain audio');
  const mdhd = child(mdia, 'mdhd'); need(mdhd, 20);
  if (view.getUint8(mdhd.data) !== 0) throw new Error('Unsupported MP4 timescale');
  const scale = view.getUint32(mdhd.data + 12), duration = view.getUint32(mdhd.data + 16);
  const seconds = duration / scale;
  if (!scale || !Number.isFinite(seconds) || seconds <= 0 || seconds > LIMITS.cinematicSeconds) throw new Error('Video exceeds duration limit');
  const minf = child(mdia, 'minf');
  const dref = child(child(minf, 'dinf'), 'dref'); need(dref, 8);
  const references = boxes(dref.data + 8, dref.end);
  if (view.getUint32(dref.data + 4) !== 1 || references.length !== 1 || references[0].type !== 'url ' || references[0].end - references[0].data !== 4 || view.getUint32(references[0].data) !== 1) throw new Error('External video references forbidden');
  const stbl = child(minf, 'stbl');
  const stsd = child(stbl, 'stsd'); need(stsd, 8);
  const descriptions = boxes(stsd.data + 8, stsd.end);
  if (view.getUint32(stsd.data + 4) !== 1 || descriptions.length !== 1 || descriptions[0].type !== 'avc1') throw new Error('Only H.264 video is supported');
  const avc = descriptions[0]; need(avc, 78);
  if (view.getUint16(avc.data + 6) !== 1) throw new Error('Invalid video data reference');
  const width = view.getUint16(avc.data + 24), height = view.getUint16(avc.data + 26);
  if (!width || !height || width > LIMITS.videoDimension || height > LIMITS.videoDimension || width * height > LIMITS.videoPixels) throw new Error('Video dimensions exceed limit');
  const avcc = one(boxes(avc.data + 78, avc.end), 'avcC'); need(avcc, 7);
  if (view.getUint8(avcc.data) !== 1) throw new Error('Invalid AVC configuration');
  const stsz = child(stbl, 'stsz'); need(stsz, 12);
  const sampleSize = view.getUint32(stsz.data + 4), samples = view.getUint32(stsz.data + 8);
  if (!samples || samples > 1800 || samples / seconds > 60.1) throw new Error('Video frame budget exceeded');
  if (!sampleSize && stsz.end - stsz.data !== 12 + samples * 4) throw new Error('Invalid sample table');
  let sampleBytes = sampleSize * samples;
  if (!sampleSize) for (let i = 0; i < samples; i++) sampleBytes += view.getUint32(stsz.data + 12 + i * 4);
  if (!sampleBytes || sampleBytes > mdat.end - mdat.data) throw new Error('Video samples exceed media data');
  const stco = child(stbl, 'stco'); need(stco, 8);
  const chunks = view.getUint32(stco.data + 4);
  if (!chunks || chunks > samples || stco.end - stco.data !== 8 + chunks * 4) throw new Error('Invalid chunk table');
  for (let i = 0; i < chunks; i++) {
    const offset = view.getUint32(stco.data + 8 + i * 4);
    if (offset < mdat.data || offset >= mdat.end) throw new Error('Video chunk outside media data');
  }
  return { width, height, seconds, samples, codec: 'avc1' as const };
}
