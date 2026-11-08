import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventPriorityQueue, SeededRng, runCliSimulation, serializePublicSimulationExport } from "../src/index.js";

describe("Phase 7C deterministic optimization hardening", () => {
  it("preserves legacy named-stream output byte-for-byte", () => {
    const rng = new SeededRng("phase7c-golden-seed");
    const actual = ["reports:0", "noise:alpha", "travel"].map((name) => [
      name,
      Array.from({ length: 5 }, () => rng.stream(name).nextUint32()),
    ]);

    assert.deepEqual(actual, [
      ["reports:0", [4115311553, 1436254694, 2828526135, 100540518, 2274853655]],
      ["noise:alpha", [1413498768, 2695666385, 2426186267, 945383555, 1665079512]],
      ["travel", [2543107574, 1330904825, 1536324048, 2561766695, 2271735514]],
    ]);
  });

  it("handles a large stable event queue without changing timestamp/priority/insertion ordering", () => {
    const queue = new EventPriorityQueue<number>();
    for (let index = 0; index < 50_000; index += 1) {
      queue.enqueue({ timestampMs: index % 97, priority: index % 7, value: index });
    }

    let prior: readonly [number, number, number] | undefined;
    while (!queue.isEmpty) {
      const item = queue.dequeue()!;
      const key = [item.timestampMs, item.priority, item.sequence] as const;
      if (prior !== undefined) {
        assert.ok(
          prior[0] < key[0] ||
            (prior[0] === key[0] &&
              (prior[1] < key[1] || (prior[1] === key[1] && prior[2] < key[2]))),
        );
      }
      prior = key;
    }
  });

  it("replays an optimized execution to byte-identical public JSON", () => {
    const options = {
      scenario: "flood" as const,
      difficulty: "CALM" as const,
      seed: "phase7c-replay",
      reportCount: 40,
      responderCount: 6,
      durationMs: 600_000,
    };
    const first = runCliSimulation(options);
    const second = runCliSimulation(options);

    assert.equal(
      serializePublicSimulationExport(second.document),
      serializePublicSimulationExport(first.document),
    );
    assert.deepEqual(second.metrics, first.metrics);
  });
});
