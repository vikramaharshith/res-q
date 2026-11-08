# Phase 8 release readiness

Audit date: 2026-11-08  
Component: standalone RES-Q by B7 Chaos Engine  
Engine version: `0.1.0`  
Public schema: `resq.simulation.v1`

Status meanings: **PASS** is supported by executed tests or direct inspection;
**PARTIAL** has useful evidence but a stated gap; **FAIL** is a confirmed defect;
**NOT TESTED** has no Phase 8 evidence.

## Overall assessment

**PASS — integration-ready at the versioned public-file boundary.** The
standalone engine is suitable for producing validated fictional simulation JSON
for a future, separately designed RES-Q adapter. No adapter, service connection,
real emergency capability, or B7 Chaos Lab work is included.

One genuine Phase 8 defect was fixed: the shipped JSON Schema was less strict
than the TypeScript contract and runtime validator. The v1 schema and validator
now reject unsupported root engine versions, unreplayable manifest durations,
unsupported enums, unknown nested operational/source fields, and out-of-contract
string values. Generated valid documents and deterministic simulation outputs
were not changed.

## Verification summary

| Area | Status | Evidence |
| --- | --- | --- |
| TypeScript typecheck | PASS | `npm.cmd run typecheck` exited 0 |
| Automated tests | PASS | 220 tests, 49 suites, 220 pass, 0 fail |
| Combined check | PASS | `npm.cmd run check` final run recorded below |
| Production build | PASS | `npm.cmd run build` final run recorded below |
| CLI commands | PASS | All seven commands executed; validate/replay succeeded |
| Determinism and reset | PASS | Golden RNG, stream independence, queue order, reset, and byte-identical replay tests |
| Hidden-ground-truth isolation | PASS | Allowlisted projection plus recursive forbidden-key tests |
| Public JSON contract | PASS | Runtime validation, synchronized strict schema, canonical serialization, cross-reference tests |
| Safety limits | PASS | Limits and invalid/superseded event behavior covered across engine subsystems |
| Four scenarios | PASS | Flood, earthquake aftermath, severe storm, and urban fire executed/tested |
| Four difficulty levels | PASS | CALM/BUSY/CHAOS/EXTREME benchmarked at full load |
| Performance | PASS | One evidence-complete Phase 7C pass; EXTREME 12.67 s on this machine |
| External integration | NOT TESTED | Deliberately absent and outside Phase 8 scope |

## Architecture audit

| Component | Status | Result |
| --- | --- | --- |
| Seeded RNG | PASS | Named persistent streams; cached prefix preserves legacy xmur3 bytes |
| Virtual clock | PASS | Caller-driven; no host-time dependency |
| Event queue | PASS | Binary heap ordered by timestamp, priority, insertion sequence |
| Simulation engine | PASS | Central bounded event processing with terminal failure semantics |
| Configuration | PASS | Required values, references, bounds, IDs, geography, resources, roads, and communications validated |
| Incident lifecycle | PASS | Controlled transitions, terminal resolution, bounded severity |
| Report generation | PASS | 16 categories, six source types, 10,000-report stress coverage |
| Fictional geography | PASS | Explicit simulated local grid; bounded deterministic clustering |
| Information noise | PASS | Bounded duplicates, contradictions, delay, omission, staleness, and location error |
| Hidden truth | PASS | Private evaluation and actual state are not public DTO inputs |
| Evolution/cascades/infrastructure | PASS | Bounded deterministic plans, causal histories, secondary incidents, and observable consequences |
| Responders/tasks/capability policy | PASS | Eight unit types, best-fit observable-only baseline policy, duplicate-assignment protection |
| Travel/routing | PASS | Fictional deterministic Dijkstra routing, reroute versions, stale-event suppression |
| Communications/known state | PASS | Delivered-only command knowledge, retries, delay, outage, stale-update protection |
| Fatigue/equipment/inventory | PASS | Bounded state, one-time consumption, recovery, equipment conditions |
| Replenishment | PASS | Source stockpile required; reservation and conservation checks |
| Public export | PASS | Explicit allowlist, public IDs, stable sorting, deep freeze, current-time-only export |
| CLI | PASS | Safe parsing, writes, no-overwrite default, explicit overwrite, clear failures |
| Replay | PASS | Complete safe manifest and canonical byte comparison |
| Performance optimization | PASS | Golden legacy streams and deterministic workload counts preserved |

No unnecessary subsystem coupling or exposed mutable public references was found.
Internal engine state remains intentionally cohesive in `SimulationEngine`; its
size is a maintainability risk, but a Phase 8 rewrite would be higher risk than
the existing tested boundary.

## Hidden-ground-truth security results

**PASS.** Public documents are assembled from explicit fields rather than by
serializing or sanitizing internal snapshots. Recursive validation rejects
internal incident/responder/task/message IDs, severity, environment and
infrastructure truth, causal rules, cascade depth, duplicate-family links,
contradiction links, reliability data, failure/retry internals, actual state,
and private evaluations.

Executed tests cover delayed and future reports, actual arrival during a
communication outage, duplicate and contradictory witness reports, hidden
evolution before public observation, road closure/rerouting with delayed
communication, and physical task/recovery progress while operational messages
remain pending. Public unit state is reconstructed from delivered observations,
not actual responder state.

## Determinism results

**PASS.** Source search found no `Math.random()`, `Date.now()`, `randomUUID()`,
locale-sensitive simulation sort, host-time decision, or external concurrency in
simulation logic. `performance.now()` is limited to non-deterministic benchmark
metrics. Tests prove:

- identical seed/configuration yields identical state and public JSON;
- different seeds produce meaningful variation;
- named RNG streams do not depend on access order;
- equal-time events use stable priority and insertion order;
- IDs are deterministic and unique;
- reset/replay restores state;
- Phase 7C preserves legacy stream bytes; and
- CLI replay of `audit-simulation.json` is byte-identical.

## JSON contract results

**PASS.** The TypeScript public DTO, `resq.simulation.v1` JSON Schema, and
dependency-free runtime validator agree on the root version, required objects,
nested allowlists, enums, bounds, and manifest requirements. Runtime validation
also checks constraints that JSON Schema cannot conveniently express alone:
unique identifiers, references, chronological and canonical timestamp rules,
receipt visibility, summary consistency, stable ordering, and recursively
forbidden private keys. Export does not mutate or advance the engine.

The contract can be consumed from JSON and its schema without importing private
simulation modules. A future adapter must still validate independently.

## CLI results

| Command/behavior | Status | Result |
| --- | --- | --- |
| `help` | PASS | Usage, commands, ranges, example |
| `presets` | PASS | Four scenarios and four difficulties |
| `version` | PASS | Engine and schema versions |
| `preview` | PASS | Fictional label, public-only counts/timeline |
| `simulate` | PASS | Safe local file output |
| `validate` | PASS | Valid file accepted; malformed/missing/invalid files rejected |
| `replay` | PASS | Canonical byte-identical match |
| No overwrite by default | PASS | Existing audit file refused |
| Explicit overwrite | PASS | Automated CLI/file tests cover replacement |
| Exit handling | PASS | Raw CLI returns 2 for usage and 1 for data/runtime errors |

Native built, direct `tsx`, and `npm.cmd run chaos` invocations were checked with
PowerShell's `$LASTEXITCODE`; each preserved usage exit code 2. Data, validation,
replay, simulation, and file-system failures return 1.

The Phase 8 smoke artifact `audit-simulation.json` is intentionally retained in
the repository workspace; it was not overwritten or deleted.

## Performance results

Command: `npm.cmd run benchmark:phase7c`  
Scenario/seed: flood / `phase7c-benchmark`  
Runtime: Node.js 26.13.0  
Memory values are sequential process observations, not isolated workload peaks.

| Difficulty | Simulation ms | Base/final/duplicate reports | Responders | Tasks assigned/completed/failed/pending | Shortages | Cascades | Events / peak queue | RSS before/after MB | Export / validate / serialize ms |
| --- | ---: | --- | ---: | --- | ---: | ---: | --- | --- | --- |
| CALM | 60.20 | 100 / 101 / 1 | 10 | 8 / 8 / 0 / 0 | 0 | 3 | 439 / 112 | 85.4 / 98.3 | 9.23 / 4.43 / 7.15 |
| BUSY | 366.95 | 1,000 / 1,043 / 43 | 50 | 25 / 23 / 2 / 3 | 3 | 6 | 2,118 / 1,076 | 98.5 / 168.7 | 40.33 / 28.58 / 43.62 |
| CHAOS | 2,755.29 | 5,000 / 5,376 / 376 | 100 | 50 / 46 / 4 / 8 | 8 | 24 | 7,509 / 5,442 | 170.3 / 272.3 | 309.51 / 153.66 / 267.46 |
| EXTREME | 12,672.13 | 10,000 / 11,264 / 1,264 | 200 | 100 / 91 / 9 / 20 | 20 | 28 | 15,511 / 11,394 | 279.9 / 465.8 | 633.97 / 352.59 / 596.74 |

EXTREME serialized 15,801,856 UTF-8 bytes. Process high-water RSS after the
sequential pass was 470,392 KiB. A preceding Phase 8 pass measured EXTREME at
9,492.54 ms with identical report/task/event/queue/JSON counts. The 9.49–12.67
second spread demonstrates expected host scheduling, JIT, garbage collection,
and sequential-memory variability; deterministic workload complexity did not
change. The evidence-complete result remains close to, but not guaranteed to
match, the earlier Phase 7C 10–11 second development measurement.

## Supported selections

- Scenarios: `flood`, `earthquake`, `storm`, `fire`.
- Difficulties: `CALM`, `BUSY`, `CHAOS`, `EXTREME`.
- Phase 8 CLI smoke runs covered flood/CALM at normal size plus
  earthquake/BUSY, storm/CHAOS, and fire/EXTREME with bounded overrides.
- The full benchmark covered all four difficulty workloads at their exact report
  and responder sizes.
- Integration tests execute flood, earthquake aftermath, severe storm, and
  urban fire behavior through assignment, travel, work, recovery, communication,
  resources, evolution, export, and replay invariants.

## Known limitations and remaining risks

| Item | Status | Assessment |
| --- | --- | --- |
| Real emergency use | NOT TESTED | Explicitly unsupported and prohibited |
| Real geography/routing | NOT TESTED | Fictional local-grid abstraction only |
| Scientific disaster/physiology/radio fidelity | NOT TESTED | Bounded training abstractions |
| Historical export | PARTIAL | Current-time export works; historical knowledge index intentionally absent |
| Public incident correlation | PARTIAL | Version 1 intentionally provides no confirmed correlation object |
| External standards-validator run | PARTIAL | Schema was structurally synchronized/tested; no new validator dependency was installed |
| `SimulationEngine` maintainability | PARTIAL | Large central file; correctness coverage is strong, refactor deferred |
| RES-Q/Nemotron adapter | NOT TESTED | Does not exist in this repository by design |
| Performance guarantee | PARTIAL | Current evidence is machine-specific, not an SLA |

## Final verification commands

```powershell
node --version
npm.cmd --version
npm.cmd run typecheck
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run chaos -- help
npm.cmd run chaos -- presets
npm.cmd run chaos -- version
npm.cmd run chaos -- preview --scenario flood --difficulty calm --seed audit-calm
npm.cmd run chaos -- simulate --scenario flood --difficulty calm --seed audit-calm --out audit-simulation.json
npm.cmd run chaos -- validate --input audit-simulation.json
npm.cmd run chaos -- replay --input audit-simulation.json
npm.cmd run benchmark:phase7c
```

## Change-control confirmation

- Work stayed inside the standalone Chaos Engine repository.
- RES-Q and all external services remained untouched and unconnected.
- No Git operations, branches, commits, pushes, resets, or stashes were used.
- No destructive commands were used.
- Phase 8 stops at audit, hardening, documentation, and integration readiness.

