import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EventPriorityQueue } from "../src/core/event-priority-queue.js";

describe("EventPriorityQueue", () => {
  it("orders events by timestamp, priority, and insertion sequence", () => {
    const queue = new EventPriorityQueue<string>();

    queue.enqueue({ timestampMs: 200, priority: 0, value: "later" });
    queue.enqueue({ timestampMs: 100, priority: 5, value: "low-priority" });
    queue.enqueue({ timestampMs: 100, priority: 1, value: "first-tie" });
    queue.enqueue({ timestampMs: 100, priority: 1, value: "second-tie" });
    queue.enqueue({ timestampMs: 50, priority: 99, value: "earliest" });

    const values: string[] = [];
    while (!queue.isEmpty) {
      const event = queue.dequeue();
      assert.ok(event);
      values.push(event.value);
    }

    assert.deepEqual(values, [
      "earliest",
      "first-tie",
      "second-tie",
      "low-priority",
      "later",
    ]);
  });

  it("assigns monotonic insertion sequences and peeks without removal", () => {
    const queue = new EventPriorityQueue<string>();
    const first = queue.enqueue({ timestampMs: 10, priority: 0, value: "first" });
    const second = queue.enqueue({ timestampMs: 10, priority: 0, value: "second" });

    assert.equal(first.sequence, 0);
    assert.equal(second.sequence, 1);
    assert.equal(queue.peek()?.value, "first");
    assert.equal(queue.size, 2);
    assert.equal(queue.dequeue()?.value, "first");
    assert.equal(queue.dequeue()?.value, "second");
    assert.equal(queue.dequeue(), undefined);
  });

  it("rejects non-integer ordering fields", () => {
    const queue = new EventPriorityQueue<string>();

    assert.throws(
      () => queue.enqueue({ timestampMs: 1.5, priority: 0, value: "invalid" }),
      RangeError,
    );
    assert.throws(
      () => queue.enqueue({ timestampMs: 1, priority: Number.NaN, value: "invalid" }),
      RangeError,
    );
  });
});

