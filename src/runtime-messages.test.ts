import { describe, expect, it } from "vitest";
import {
  parseFrameEnvelope,
  RuntimeMessageGate,
  validateRuntimeContent,
} from "./runtime-messages.js";
const channel = "a".repeat(32);
const message = { protocol: 3, channel, sequence: 0, type: "ready" };
describe("untrusted frame message boundary", () => {
  it.each([
    null,
    [],
    {},
    { ...message, protocol: 2 },
    { ...message, channel: "wrong" },
    { ...message, type: "navigate", url: "https://example.invalid" },
    { ...message, type: "complete", userId: "forged" },
    { ...message, sequence: -1 },
    { ...message, sequence: Infinity },
    {
      ...message,
      type: "audio-play",
      asset: "https://example.invalid/audio.mp3",
    },
    { ...message, type: "audio-tone", frequency: 5000, durationMs: 2001 },
    { ...message, type: "mode", mode: "published" },
  ])("rejects malformed message %j", (input) => {
    expect(parseFrameEnvelope(input)).toBeUndefined();
  });
  it("binds a run, rejects replay and closes permanently on teardown", () => {
    const gate = new RuntimeMessageGate(channel);
    expect(
      gate.accept({ ...message, channel: "b".repeat(32) }),
    ).toBeUndefined();
    expect(gate.accept(message)).toEqual(message);
    expect(gate.accept(message)).toBeUndefined();
    expect(
      gate.accept({ ...message, type: "complete", sequence: 1 })?.type,
    ).toBe("complete");
    gate.close();
    expect(gate.accept({ ...message, sequence: 2 })).toBeUndefined();
  });
  it("fails closed when a frame floods even invalid messages", () => {
    const gate = new RuntimeMessageGate(channel, () => 0);
    for (let i = 0; i < 61; i++) gate.accept(null);
    expect(gate.isClosed).toBe(true);
    expect(gate.accept(message)).toBeUndefined();
  });
  it("resets the bounded message window for normal playback", () => {
    let time = 0;
    const gate = new RuntimeMessageGate(channel, () => time);
    for (let i = 0; i < 120; i++) {
      time = i * 100;
      expect(gate.accept({ ...message, sequence: i })).toBeDefined();
    }
  });
  it("transfers bounded photo bytes rather than private URLs", () => {
    const content = {
      recipientName: "Alex",
      message: "Hello",
      senderName: "",
      photoTransform: "translate(0px, 0px) scale(1)",
      photo: { bytes: new ArrayBuffer(10), mime: "image/png" as const },
    };
    expect(validateRuntimeContent(content)).toBe(content);
    expect(() =>
      validateRuntimeContent({
        ...content,
        photoTransform: "url(https://example.invalid)",
      }),
    ).toThrow();
    expect(() =>
      validateRuntimeContent({
        ...content,
        photo: {
          ...content.photo,
          bytes: new ArrayBuffer(10 * 1024 * 1024 + 1),
        },
      }),
    ).toThrow();
  });
});
