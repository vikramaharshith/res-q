const UINT32_RANGE = 0x1_0000_0000;

export interface RandomStream {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
}

/**
 * Owns persistent, independently seeded random streams for one simulation seed.
 * Retrieving streams in a different order does not change their sequences.
 */
export class SeededRng {
  readonly #prefix: string;
  readonly #prefixHashes = new Map<number, number>();
  readonly #streams = new Map<string, RandomStream>();

  public constructor(seed: string | number) {
    this.#prefix = `${String(seed)}\u0000`;
  }

  public stream(name: string): RandomStream {
    if (name.length === 0) {
      throw new RangeError("Random stream names must not be empty.");
    }

    const existing = this.#streams.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const totalLength = this.#prefix.length + name.length;
    let prefixHash = this.#prefixHashes.get(totalLength);
    if (prefixHash === undefined) {
      prefixHash = xmur3Prefix(this.#prefix, totalLength);
      this.#prefixHashes.set(totalLength, prefixHash);
    }
    const stream = createStream(name, prefixHash);
    this.#streams.set(name, stream);
    return stream;
  }
}

function createStream(streamName: string, prefixHash: number): RandomStream {
  const hash = xmur3Suffix(prefixHash, streamName);
  let a = hash();
  let b = hash();
  let c = hash();
  let d = hash();

  const nextUint32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;

    const result = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + result) >>> 0;
    return result;
  };

  return {
    nextUint32,

    nextFloat(): number {
      return nextUint32() / UINT32_RANGE;
    },

    nextInt(minInclusive: number, maxExclusive: number): number {
      if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
        throw new RangeError("Random integer bounds must be safe integers.");
      }

      const span = maxExclusive - minInclusive;
      if (span <= 0 || span > UINT32_RANGE) {
        throw new RangeError("Random integer range must contain between 1 and 2^32 values.");
      }

      if (span === UINT32_RANGE) {
        return minInclusive + nextUint32();
      }

      const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % span);
      let value = nextUint32();
      while (value >= rejectionLimit) {
        value = nextUint32();
      }

      return minInclusive + (value % span);
    },
  };
}

function xmur3Prefix(input: string, totalLength: number): number {
  let hash = 1_779_033_703 ^ totalLength;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash;
}

function xmur3Suffix(prefixHash: number, suffix: string): () => number {
  let hash = prefixHash;
  for (let index = 0; index < suffix.length; index += 1) {
    hash = Math.imul(hash ^ suffix.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return (): number => {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
    hash ^= hash >>> 16;
    return hash >>> 0;
  };
}

