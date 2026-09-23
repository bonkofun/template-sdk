import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectSilentMp4 } from './media.js';
const fixture = readFileSync(new URL('./fixtures/silent.mp4', import.meta.url));
describe('silent cinematic media boundary', () => {
  it('accepts a real silent H.264 movie', () => {
    expect(inspectSilentMp4(fixture)).toMatchObject({ width:32,height:48,seconds:1,codec:'avc1' });
  });
  it('rejects truncated boxes, unsupported codecs, audio and external data', () => {
    expect(()=>inspectSilentMp4(fixture.subarray(0,fixture.length-4))).toThrow();
    for (const [from,to] of [['avc1','hvc1'],['vide','soun']]) {
      const bad=Buffer.from(fixture); const at=bad.indexOf(from,40); expect(at).toBeGreaterThan(0); bad.write(to,at);
      expect(()=>inspectSilentMp4(bad)).toThrow();
    }
    const external=Buffer.from(fixture); external.writeUInt32BE(0,external.indexOf('url ')+4);
    expect(()=>inspectSilentMp4(external)).toThrow();
  });
  it('rejects excessive duration and frame size', () => {
    const long=Buffer.from(fixture), mdhd=long.indexOf('mdhd')+4;
    long.writeUInt32BE(long.readUInt32BE(mdhd+12)*31,mdhd+16);
    expect(()=>inspectSilentMp4(long)).toThrow();
    const huge=Buffer.from(fixture), avc=huge.indexOf('avc1',40)+4;
    huge.writeUInt16BE(4096,avc+24); expect(()=>inspectSilentMp4(huge)).toThrow();
  });
});
