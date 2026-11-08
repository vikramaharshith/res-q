export interface ScheduledEvent<T> {
  timestampMs: number;
  priority: number;
  value: T;
}

export interface QueuedEvent<T> extends ScheduledEvent<T> {
  sequence: number;
}

/**
 * A min-priority queue ordered by timestamp, priority, then insertion sequence.
 * Lower numeric priorities run first when timestamps are equal.
 */
export class EventPriorityQueue<T> {
  readonly #heap: Array<QueuedEvent<T>> = [];
  #nextSequence = 0;

  public get size(): number {
    return this.#heap.length;
  }

  public get isEmpty(): boolean {
    return this.#heap.length === 0;
  }

  public enqueue(event: ScheduledEvent<T>): QueuedEvent<T> {
    assertSafeInteger(event.timestampMs, "Event timestamp");
    assertSafeInteger(event.priority, "Event priority");
    assertSafeInteger(this.#nextSequence, "Event insertion sequence");

    const queued: QueuedEvent<T> = {
      ...event,
      sequence: this.#nextSequence,
    };
    this.#nextSequence += 1;

    this.#heap.push(queued);
    this.#bubbleUp(this.#heap.length - 1);
    return queued;
  }

  public peek(): QueuedEvent<T> | undefined {
    return this.#heap[0];
  }

  public dequeue(): QueuedEvent<T> | undefined {
    const first = this.#heap[0];
    const last = this.#heap.pop();

    if (first === undefined || last === undefined) {
      return undefined;
    }

    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#sinkDown(0);
    }

    return first;
  }

  #bubbleUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const current = this.#heap[index];
      const parent = this.#heap[parentIndex];

      if (current === undefined || parent === undefined || compareEvents(parent, current) <= 0) {
        return;
      }

      this.#heap[parentIndex] = current;
      this.#heap[index] = parent;
      index = parentIndex;
    }
  }

  #sinkDown(startIndex: number): void {
    let index = startIndex;

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;

      const left = this.#heap[leftIndex];
      const smallest = this.#heap[smallestIndex];
      if (left !== undefined && smallest !== undefined && compareEvents(left, smallest) < 0) {
        smallestIndex = leftIndex;
      }

      const right = this.#heap[rightIndex];
      const updatedSmallest = this.#heap[smallestIndex];
      if (right !== undefined && updatedSmallest !== undefined && compareEvents(right, updatedSmallest) < 0) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) {
        return;
      }

      const current = this.#heap[index];
      const next = this.#heap[smallestIndex];
      if (current === undefined || next === undefined) {
        return;
      }

      this.#heap[index] = next;
      this.#heap[smallestIndex] = current;
      index = smallestIndex;
    }
  }
}

function compareEvents<T>(left: QueuedEvent<T>, right: QueuedEvent<T>): number {
  return (
    left.timestampMs - right.timestampMs ||
    left.priority - right.priority ||
    left.sequence - right.sequence
  );
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer.`);
  }
}

