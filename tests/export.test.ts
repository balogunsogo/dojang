import { describe, expect, it } from 'vitest';
import { exportName, webmWithDuration } from '../src/game/replay/exporter';

/** A minimal MediaRecorder-style WebM head: EBML header, Segment (unknown size), Info, then a Cluster. */
function webm(segmentSize?: number) {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x88, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x00]; // TimecodeScale 1,000,000
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x82, 0xe7, 0x80];
  const segSize = segmentSize === undefined ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [0x10, 0x00, 0x00, segmentSize];
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, ...segSize, ...info, ...cluster]);
}

describe('WebM duration', () => {
  it('writes a Duration (ms, float64) into Segment Info and grows Info by 11 bytes', () => {
    const u = webm();
    const out = webmWithDuration(u, 8130.5);
    expect(out.length).toBe(u.length + 11);
    const i = out.indexOf(0x15); // Info id start
    expect(Array.from(out.subarray(i, i + 4))).toEqual([0x15, 0x49, 0xa9, 0x66]);
    expect(out[i + 4]).toBe(0x80 | (8 + 11)); // new Info size
    const d = out.findIndex((b, k) => b === 0x44 && out[k + 1] === 0x89);
    expect(out[d + 2]).toBe(0x88);
    expect(new DataView(out.buffer, out.byteOffset + d + 3, 8).getFloat64(0)).toBe(8130.5);
    // The cluster follows intact.
    expect(Array.from(out.subarray(out.length - 7))).toEqual([0x1f, 0x43, 0xb6, 0x75, 0x82, 0xe7, 0x80]);
  });
  it('a known-size Segment grows by the same amount; an existing Duration is left alone', () => {
    const u = webm(20);
    const out = webmWithDuration(u, 1000);
    const s = out.findIndex((b, k) => b === 0x18 && out[k + 1] === 0x53);
    expect(out[s + 7]).toBe(31);
    expect(webmWithDuration(out, 5)).toBe(out);
  });
  it('leaves anything unexpected unchanged', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(webmWithDuration(junk, 10)).toBe(junk);
  });
  it('names files by moment, format and speed', () => {
    expect(exportName('Knockout · Roundhouse kick', '9:16', 'webm')).toBe('dojang-knockout-roundhouse-kick-portrait.webm');
    expect(exportName('Match-winning · Back kick · 4 points', '16:9', 'mp4', 0.5)).toBe('dojang-match-winning-back-kick-4-points-landscape-half-speed.mp4');
  });
});
