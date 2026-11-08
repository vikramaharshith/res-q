# Chaos Engine integration handoff

This document describes a recommended future integration boundary. It does not
implement an adapter, describe an existing RES-Q endpoint, assume a database
schema, or authorize access to Chaos Engine internals.

All generated incidents, people, responders, locations, and observations are
fictional. Chaos Engine is a training and evaluation simulator, not an emergency
dispatch system or a scientific forecast.

## 1. Architecture overview

Chaos Engine is a standalone deterministic TypeScript application. Its private
simulation contains the seeded random streams, virtual clock, stable event
queue, actual incident and infrastructure state, responder/task/travel state,
communication delivery state, resources, and private report evaluations. The
only supported integration surface is the allowlisted public JSON document.

Recommended architecture (the adapter does not yet exist):

```text
Chaos Engine
    ↓
Versioned public JSON
    ↓
RES-Q validation/import adapter
    ↓
RES-Q application state
    ↓
NVIDIA Nemotron investigation
```

The JSON file is a transfer artifact, not a live connection. Chaos Engine does
not need RES-Q, Nemotron, Supabase, a database, a web framework, an external AI
API, or internet access.

## 2. Data flow and trust boundary

1. Run Chaos Engine locally with an explicit scenario, difficulty, and seed.
2. Export the current virtual-time public view with `simulate --out`.
3. Treat the file as untrusted input at the future RES-Q boundary.
4. Validate the complete document and supported versions before importing it.
5. Convert only public contract fields into adapter-owned data-transfer objects.
6. Make imported observations available to the RES-Q application.
7. Give Nemotron only the information RES-Q intends it to investigate.

Never import `SimulationSnapshot`, events, incidents, private report
evaluations, infrastructure state, cascade rules, pending messages, or other
internal modules.

## 3. Contract and required metadata

The current contract is `resq.simulation.v1`. The root object requires:

- `schemaVersion` and `engineVersion`
- `runId`
- fictional `scenario` metadata (`scenarioId`, `seed`, `label`, `difficulty`)
- `simulationTime` (`startTime`, `exportTime`, `status`)
- `emergencyObservations`
- `operationalObservations`
- `units`
- `assignments`
- nullable `replayManifest`
- `summary`

The authoritative portable schema is
`src/export/public-simulation-export-v1.schema.json`. A consumer must not need
imports from private simulation modules to understand the JSON.

## 4. Emergency report structure

Each emergency observation has a public `reportId`, category, source type,
three timestamps, fictional local-grid location, narrative, structured claims,
received status, nullable urgency, and nullable source metadata. Claims carry a
code, statement, observation stage, assistance request, nullable value,
nullable confidence, and nullable detail status.

Every exported report was received by `simulationTime.exportTime` and satisfies:

```text
observedAt <= submittedAt <= receivedAt <= exportTime
```

Reports remain independent observations. A shared place, similar wording, or
close timestamp is not proof that two reports describe the same hidden event.

## 5. Operational observations and public responder knowledge

Operational observations contain a public observation ID, public unit ID,
nullable public assignment ID, message type, observation/submission/receipt
times, source, delivered status, and allowlisted content. Content can describe
known availability, task/travel/communication state, fictional location, route
version, fatigue, equipment condition, and inventory.

`units` is a delivered-knowledge summary reconstructed from received
operational observations with stale-update protection. It is not a view of the
responder's actual current state. `assignments` contains public references first
learned through delivered messages. Pending and failed messages are absent.

## 6. Identifier rules

- Treat every identifier as an opaque case-sensitive string.
- `runId` identifies one deterministic run configuration.
- Report and observation IDs are unique within their respective collections.
- Public unit IDs use the `unit_` namespace.
- Public assignment IDs use the `assignment_` namespace.
- Public IDs are deliberately different from internal responder, task, event,
  message, and incident IDs.
- Resolve every `unitId` and `assignmentId` reference before committing an
  import.
- Do not infer hidden incident correlation from IDs or array positions.

## 7. Timestamp and ordering semantics

Timestamps are canonical UTC ISO-8601 strings with millisecond precision and
represent virtual simulation time, not file creation or wall-clock time.
Emergency observations are ordered by `receivedAt`, then `reportId`.
Operational observations are ordered by `receivedAt`, then `observationId`.
Consumers should preserve this public order and the original timestamps.

An observation can be stale, delayed, incomplete, or contradicted without being
invalid. Receipt time controls visibility; observation time describes when the
fictional source observed the fact.

## 8. Fictional coordinates

Every exported location has `fictional: true` and
`coordinateSystem: "SIMULATED_LOCAL_GRID"`. `x` and `y` are bounded fictional
grid coordinates. Districts, references, and descriptions are fictional labels.
Do not geocode, reverse-geocode, map to real addresses, or represent them as
real-world latitude/longitude.

## 9. Duplicates, contradictions, and uncertainty

Natural-looking duplicates and conflicting witness claims stay as separate
public observations. Version 1 deliberately exports no hidden duplicate-family,
contradiction-classification, source-reliability, or incident-correlation data.
Missing values, explicit unknown details, confidence, approximation, delayed
receipt, and contradictory claims are evidence the future application may
display or investigate; they are not permission to recover private truth.

If RES-Q later derives correlation or confidence, store it as RES-Q-owned
analysis with provenance. Do not label it as Chaos Engine ground truth.

## 10. Validation requirements

Before import, a future adapter should:

1. Parse JSON with size and resource limits.
2. Require `schemaVersion === "resq.simulation.v1"`.
3. Apply the shipped JSON Schema with unknown-property rejection.
4. Enforce the same cross-record checks as the engine validator: unique IDs,
   resolvable references, ordering, canonical timestamps, bounds, summary
   consistency, and no future receipts.
5. Recursively reject private-field names rather than attempting to strip them.
6. Reject non-finite numbers and unsupported enum values.
7. Perform the import atomically or roll it back completely.
8. Record the source file digest and validation result for auditability.

The standalone command for producer-side validation is:

```powershell
npm.cmd run chaos -- validate --input .\simulation.json
```

Producer validation does not remove the consumer's obligation to validate
untrusted input independently.

## 11. Deterministic replay

CLI-generated exports include a replay manifest with preset, engine, schema,
scenario, difficulty, seed, report count, responder count, and duration. A
compatible local engine can reconstruct the run and compare canonical public
JSON byte-for-byte:

```powershell
npm.cmd run chaos -- replay --input .\simulation.json
```

Replay requires exact supported versions. A valid Phase 7A document may have a
null manifest and remain importable, but it is not CLI-replayable. Replay is a
verification feature, not a mechanism for exposing private state.

## 12. Export examples

```powershell
npm.cmd run chaos -- simulate --scenario flood --difficulty calm --seed training-001 --out .\simulation.json
npm.cmd run chaos -- validate --input .\simulation.json
npm.cmd run chaos -- replay --input .\simulation.json
```

Existing output files are refused. Replacement requires an explicit
`--overwrite` and should be avoided for immutable import artifacts.

## 13. Recommended RES-Q import process

The following is a proposed interface, not an existing implementation:

1. Receive a local JSON file through an explicitly authorized import action.
2. Compute a cryptographic file digest in the adapter.
3. Validate the envelope, schema version, engine version policy, and all data.
4. Create an idempotency key from `schemaVersion`, `runId`, and the digest.
5. Reject an already completed import with the same idempotency key.
6. Stage public observations and mappings in adapter-owned structures.
7. Commit all records in one transaction appropriate to the future RES-Q
   architecture.
8. Record import counts, warnings, versions, digest, and completion status.
9. Expose only imported public observations to downstream investigation.

Do not assume table names, REST routes, GraphQL operations, queues, or database
technology until RES-Q defines them.

## 14. Preventing duplicate imports

Use an adapter-owned import ledger keyed by the complete artifact identity, not
only a filename. A recommended identity is:

```text
schemaVersion + runId + canonical-file-digest
```

Within one import, enforce unique report, operation, unit, and assignment IDs.
Across imports, preserve source-run provenance and choose an explicit policy for
reimporting a changed artifact with the same `runId`; the safest default is to
reject it for manual review.

## 15. Preventing hidden-ground-truth exposure

- Deserialize into public DTOs defined from the versioned schema.
- Reject unknown fields at every object level.
- Never accept a raw engine object or private module type.
- Never add a debug or truth-dump import mode.
- Never forward seed-derived private reconstruction to Nemotron.
- Keep adapter logs free of rejected document bodies when they may contain
  attempted private fields.
- Give downstream systems only delivered observations and public summaries.

## 16. Version compatibility

The adapter should maintain an explicit allowlist of schema versions. Unknown
major or exact version strings must fail closed with a clear error. Do not
coerce an unknown document into v1. Engine-version policy may be broader for
ordinary imports than for replay, but replay must use the exact compatible
engine and preset versions declared by the manifest.

Any future incompatible contract requires a new schema version and a separate
adapter path. Do not silently change `resq.simulation.v1` semantics.

## 17. Security and error handling

Treat files as untrusted even though the producer is local. Bound file size,
nesting, arrays, strings, coordinates, quantities, and numeric values. Reject
path traversal and symbolic-link surprises in any future upload staging. Do not
fetch URLs found in text, execute narratives, or interpolate fields into code or
queries. Escape user-facing text and use parameterized persistence APIs.

Return errors by stage: read/parse, unsupported version, schema violation,
cross-reference violation, duplicate import, staging failure, or commit failure.
Include a safe JSON path and summary, not secrets or a full document dump.

## 18. Known limitations

- The simulator uses fictional local-grid routing, bounded training models, and
  deterministic templates; it is not real disaster physics or dispatch logic.
- Version 1 has no confirmed public incident-correlation object.
- Historical exports are unsupported; export at the desired current virtual
  time.
- Public unit summaries reflect delivered knowledge and may intentionally lag.
- Replay is unavailable when `replayManifest` is null.
- There is no transport, adapter, database connection, authentication model, or
  Nemotron integration in this repository.

## 19. Future integration checklist

- [ ] Define adapter ownership and threat model in the RES-Q project.
- [ ] Copy or package the exact public JSON Schema without private imports.
- [ ] Add an independent standards-compliant schema validator.
- [ ] Implement cross-record and recursive private-key validation.
- [ ] Define version and migration policy.
- [ ] Define atomic staging/commit and rollback behavior.
- [ ] Define the import-ledger/idempotency policy.
- [ ] Preserve source run, artifact digest, IDs, timestamps, and ordering.
- [ ] Keep fictional coordinate labels explicit in the UI.
- [ ] Verify delayed, duplicate, contradictory, and stale observations survive
      unchanged.
- [ ] Verify undelivered responder state and hidden truth cannot enter RES-Q.
- [ ] Add security, malformed-input, scale, rollback, and duplicate-import tests.
- [ ] Obtain explicit approval before connecting RES-Q or Nemotron.

