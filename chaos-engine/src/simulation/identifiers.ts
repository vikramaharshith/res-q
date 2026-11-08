import { SeededRng } from "../core/random.js";
import type { ResponderType } from "./responder.js";

const FNV_OFFSET_64 = 14_695_981_039_346_656_037n;
const FNV_PRIME_64 = 1_099_511_628_211n;

export class DeterministicIds {
  public readonly runId: string;

  readonly #fingerprint: string;
  readonly #incidentStream;
  readonly #eventStream;
  readonly #responderStream;
  readonly #taskStream;
  readonly #travelStream;
  readonly #messageStream;
  readonly #replenishmentStream;
  #incidentSequence = 0;
  #eventSequence = 0;
  #responderSequence = 0;
  #taskSequence = 0;
  #travelSequence = 0;
  #messageSequence = 0;
  #replenishmentSequence = 0;
  readonly #callsignSequences = new Map<ResponderType, number>();

  public constructor(identityMaterial: string) {
    this.#fingerprint = hash64(identityMaterial).toString(36).padStart(13, "0");
    this.runId = `run_${this.#fingerprint}`;

    const rng = new SeededRng(identityMaterial);
    this.#incidentStream = rng.stream("identifiers:incident");
    this.#eventStream = rng.stream("identifiers:event");
    this.#responderStream = rng.stream("identifiers:responder");
    this.#taskStream = rng.stream("identifiers:task");
    this.#travelStream = rng.stream("identifiers:travel");
    this.#messageStream = rng.stream("identifiers:message");
    this.#replenishmentStream = rng.stream("identifiers:replenishment");
  }

  public nextIncidentId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#incidentSequence;
      this.#incidentSequence += 1;
      const randomPart = this.#incidentStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `inc_auto_${this.#fingerprint}_${sequence.toString(36).padStart(6, "0")}_${randomPart}`;
      if (!isUsed(candidate)) {
        return candidate;
      }
    }
  }

  public nextEventId(): string {
    const sequence = this.#eventSequence;
    this.#eventSequence += 1;
    const randomPart = this.#eventStream.nextUint32().toString(36).padStart(7, "0");
    return `evt_${this.#fingerprint}_${sequence.toString(36).padStart(7, "0")}_${randomPart}`;
  }

  public nextResponderId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#responderSequence;
      this.#responderSequence += 1;
      const randomPart = this.#responderStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `rsp_auto_${this.#fingerprint}_${sequence.toString(36).padStart(6, "0")}_${randomPart}`;
      if (!isUsed(candidate)) {
        return candidate;
      }
    }
  }

  public nextResponderCallsign(
    responderType: ResponderType,
    isUsed: (candidate: string) => boolean,
  ): string {
    const prefix = CALLSIGN_PREFIXES[responderType];
    while (true) {
      const next = (this.#callsignSequences.get(responderType) ?? 0) + 1;
      this.#callsignSequences.set(responderType, next);
      const candidate = `${prefix}-${next.toString().padStart(3, "0")}`;
      if (!isUsed(candidate)) {
        return candidate;
      }
    }
  }

  public nextTaskId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#taskSequence;
      this.#taskSequence += 1;
      const randomPart = this.#taskStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `task_auto_${this.#fingerprint}_${sequence.toString(36).padStart(6, "0")}_${randomPart}`;
      if (!isUsed(candidate)) {
        return candidate;
      }
    }
  }

  public nextTravelId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#travelSequence;
      this.#travelSequence += 1;
      const randomPart = this.#travelStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `travel_auto_${this.#fingerprint}_${sequence.toString(36).padStart(6, "0")}_${randomPart}`;
      if (!isUsed(candidate)) return candidate;
    }
  }

  public nextMessageId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#messageSequence;
      this.#messageSequence += 1;
      const randomPart = this.#messageStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `msg_auto_${this.#fingerprint}_${sequence.toString(36).padStart(7, "0")}_${randomPart}`;
      if (!isUsed(candidate)) return candidate;
    }
  }

  public nextReplenishmentId(isUsed: (candidate: string) => boolean): string {
    while (true) {
      const sequence = this.#replenishmentSequence;
      this.#replenishmentSequence += 1;
      const randomPart = this.#replenishmentStream.nextUint32().toString(36).padStart(7, "0");
      const candidate = `replenish_${this.#fingerprint}_${sequence.toString(36).padStart(7, "0")}_${randomPart}`;
      if (!isUsed(candidate)) return candidate;
    }
  }
}

const CALLSIGN_PREFIXES: Readonly<Record<ResponderType, string>> = Object.freeze({
  AMBULANCE: "MED",
  FIRE_ENGINE: "FIRE",
  WATER_RESCUE: "WATER",
  SEARCH_AND_RESCUE: "SAR",
  POLICE: "POLICE",
  UTILITY_REPAIR: "UTILITY",
  EVACUATION_TRANSPORT: "EVAC",
  SUPPLY_DELIVERY: "SUPPLY",
});

function hash64(input: string): bigint {
  let hash = FNV_OFFSET_64;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
  }
  return hash;
}

