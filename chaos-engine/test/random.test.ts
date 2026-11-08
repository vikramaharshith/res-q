import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SeededRng } from "../src/core/random.js";

function take(stream: ReturnType<SeededRng["stream"]>, count: number): number[] {
  return Array.from({ length: count }, () => stream.nextUint32());
}

describe("SeededRng", () => {
  it("reproduces the same sequence for the same seed and stream name", () => {
    const first = take(new SeededRng("training-042").stream("incident-spread"), 20);
    const second = take(new SeededRng("training-042").stream("incident-spread"), 20);

    assert.deepEqual(first, second);
  });

  it("keeps named streams independent of access and consumption order", () => {
    const baseline = new SeededRng("shared-seed");
    const expectedCommunications = take(baseline.stream("communications"), 12);

    const interleaved = new SeededRng("shared-seed");
    take(interleaved.stream("hazards"), 100);
    const actualCommunications = take(interleaved.stream("communications"), 12);

    assert.deepEqual(actualCommunications, expectedCommunications);
    assert.notDeepEqual(
      take(new SeededRng("shared-seed").stream("hazards"), 12),
      expectedCommunications,
    );
  });

  it("returns the persistent stream when a name is requested again", () => {
    const rng = new SeededRng(12345);
    const stream = rng.stream("reports");
    const first = stream.nextUint32();
    const second = rng.stream("reports").nextUint32();

    const reference = new SeededRng(12345).stream("reports");
    assert.equal(first, reference.nextUint32());
    assert.equal(second, reference.nextUint32());
  });

  it("produces bounded integer and floating-point values", () => {
    const stream = new SeededRng("bounds").stream("sample");

    for (let index = 0; index < 1_000; index += 1) {
      const float = stream.nextFloat();
      const integer = stream.nextInt(-4, 7);
      assert.ok(float >= 0 && float < 1);
      assert.ok(integer >= -4 && integer < 7);
    }
  });
});

