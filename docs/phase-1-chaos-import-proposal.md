# Phase 1 proposal: persistent Chaos import staging

Status: **review only**. This document is not a migration. Do not run the SQL, do not connect to Supabase, and do not treat it as approved.

Phase 0 remains the gate. A document must already pass `importSimulationText` before any later persistence code may write it. The digest is the SHA-256 of the original UTF-8 bytes, and the idempotency key is `schemaVersion:runId:digestHex`.

## 1. Schema evaluator audit

The evaluator in `web/lib/simulation-import/schema-validator.ts` was compared with every keyword in `resq-handoff/public-schema.json`.

| Keyword | Role in the public schema | Result |
| --- | --- | --- |
| `$schema`, `title` | Annotations | Ignored during instance checks |
| `$id` | Document identity | Checked once at load against the adapter allowlist |
| `$defs` | Named fragments | Reached only through `$ref` |
| `$ref` | Identifiers, timestamps, counts, nested objects | Resolved for local `#/` pointers |
| `type`, including nullable unions | Strings, numbers, integers, objects, arrays, booleans, null | Enforced |
| `const` | Versions, `fictional`, grid name, `RECEIVED`, `DELIVERED`, preset | Enforced |
| `enum` | Categories, statuses, difficulties, channels, manifest scenario | Enforced |
| `anyOf` | Null manifest, null timestamps, null assignment ids, null metadata and locations | Enforced. A failed branch now reports the closest branch's errors, so a manifest bound is visible as a minimum or maximum failure |
| `required`, `properties` | Every closed object | Enforced |
| `additionalProperties: false` | Every object except inventory quantities | Enforced, including a `latitude` or `longitude` key on a location |
| `additionalProperties` schema | Inventory quantities | Integer range 0 through 10,000 |
| `propertyNames` | Inventory names | Length 1 through 2,000 |
| `minLength`, `maxLength` | Identifiers' containers and narratives | Counted in Unicode code points |
| `pattern` | Identifiers and canonical timestamps | Enforced |
| `format: date-time` | Timestamps | Must also be the exact UTC form `Date#toISOString` emits |
| `minimum`, `maximum` | Counts, grid coordinates, fatigue, manifest bounds | Inclusive bounds enforced |
| `maxItems`, `items` | Observation, claim, unit, and assignment arrays | Limit is 100,000 |

No schema keyword accepts a value the contract forbids. Cross-record rules are outside JSON Schema and stay in the Phase 0 importer: unique ids, resolvable unit and assignment references, receipt order, summary consistency, and no receipt after export time. Those already have tests.

The new regression test `schema evaluator enforces every constraint in the public schema` locks the bounds, patterns, enums, required fields, closed objects, inventory names, and the 100,001-item array limit. A boundary document with grid coordinates `1000000` and `-1000000` imports with those numbers unchanged and without latitude or longitude fields.

`npm test` after the audit: **38 passed, 0 failed**.

## 2. Persistent duplicate protection

`MemoryImportLedger` has three operations:

- `findByKey` matches `schemaVersion:runId:digestHex`.
- `findByRun` matches `schemaVersion` plus `runId`, regardless of digest.
- `commit` appends only after both lookups miss. A thrown commit does not become a successful import.

The persistent equivalent is one transaction:

1. Lock any existing `chaos_import_runs` row for that `schema_version` and `run_id`.
2. If the stored digest matches, return `duplicate` and write nothing.
3. If a row exists with a different digest, return `review` and write nothing. Do not overwrite the stored artifact.
4. Otherwise insert the run, its observations, units, public assignments, and source-id rows.
5. Unique constraints are the race backstop. A unique violation rolls the transaction back. The caller reads the committed row and classifies it as `duplicate` or `review`.

The digest is not recomputed from a database row. It is the Phase 0 byte digest.

## 3. Proposed tables

These tables are additive. They do not reference `scenarios`, `incidents`, `reports`, `responders`, `assignments`, `agent_runs`, or `approval_actions`.

`public.assignments` remains the human-approval table (`scenario_baseline`, `human_approval`, `human_override`, ids such as `asn_h_...`). Chaos assignments live only in `chaos_public_assignments`.

The dashboard loader reads `scenarios.id = scn_demo_flood` and that scenario's incidents, reports, responders, and assignments. It does not read `chaos_*`. Phase 1 must leave that loader unchanged.

### `chaos_import_runs`

One committed artifact.

- `id text primary key` — RES-Q id prefixed `cimp_run_`
- `schema_version text not null` — check `resq.simulation.v1`
- `engine_version text not null` — check `0.1.0`
- `run_id text not null`
- `digest_algorithm text not null` — check `SHA-256`
- `digest_hex text not null` — check 64 lowercase hex characters
- `idempotency_key text not null` — check equal to `schema_version || ':' || run_id || ':' || digest_hex`
- `byte_length integer not null`
- `source_scenario_id text not null` — Chaos `scenarioId`, not a RES-Q scenario foreign key
- `source_seed text not null`
- `source_label text not null`
- `fictional boolean not null` — check true
- `difficulty text` — null or `CALM`, `BUSY`, `CHAOS`, `EXTREME`
- `simulation_start text not null`
- `simulation_export text not null`
- `simulation_status text not null`
- summary counts and `first_received_at` / `last_received_at` as text
- `replay_manifest jsonb` — null when the export has no manifest
- `created_at timestamptz not null default now()` — wall time of the RES-Q commit, separate from virtual simulation time

Unique: `(idempotency_key)` and `(schema_version, run_id)`.

### `chaos_emergency_observations`

Public report fields, plus `import_run_id`, `ordinal`, and `local_id`.

Preserve `report_id`, `category`, `source_type`, `observed_at`, `submitted_at`, `received_at`, `narrative`, `claims` jsonb, `status`, `urgency`, and `source_metadata` jsonb.

Location columns: `fictional`, `coordinate_system`, `grid_x numeric`, `grid_y numeric`, `district`, `primary_reference`, `secondary_reference`, `description`, `precision`.

Checks: `fictional`, `coordinate_system = 'SIMULATED_LOCAL_GRID'`, both grid values inside -1,000,000 through 1,000,000, `status = 'RECEIVED'`. No latitude or longitude column.

Unique: `(import_run_id, report_id)` and `(import_run_id, ordinal)`.

### `chaos_operational_observations`

Public message fields: `observation_id`, `unit_id`, nullable `assignment_id`, `message_type`, the three timestamps, `source`, `delivery_status` check `DELIVERED`, and the content fields. Nullable grid columns use the same fictional-grid checks. `inventory` stays jsonb. `route_version` and `fatigue` use the public bounds.

Unique: `(import_run_id, observation_id)` and `(import_run_id, ordinal)`.

### `chaos_units`

Public unit summary: `unit_id`, `callsign`, `latest_observed_at`, `latest_received_at`, availability, nullable `assignment_id`, task, travel, communication, and nullable grid location.

Unique: `(import_run_id, unit_id)`.

### `chaos_public_assignments`

Public assignment only: `assignment_id`, `unit_id`, `first_received_at`, `ordinal`, `local_id`.

Foreign key `(import_run_id, unit_id)` to `chaos_units`. Unique `(import_run_id, assignment_id)`. No incident id, responder id, origin, or status column, so these rows cannot satisfy `public.assignments`.

### `chaos_source_ids`

Maps one public id to one RES-Q local id inside a run.

- `entity_kind text` — `run`, `emergency_observation`, `operational_observation`, `unit`, `public_assignment`
- `source_id text`
- `local_id text` — check prefix `cimp_` and forbid prefix `asn_`

Unique: `(import_run_id, entity_kind, source_id)` and `(local_id)`.

## 4. Transaction and safety rules

Proposed function: `public.stage_chaos_import(payload jsonb)`, executable only by `service_role`. It is not part of this review and must not be created until the SQL file is approved.

- The function is the whole transaction. Any raise rolls back the run and every child insert.
- Enable RLS on all six tables. Add no anon or authenticated policies.
- `REVOKE ALL` from `PUBLIC`, `anon`, and `authenticated`. `GRANT` select/insert to `service_role` only. Do not grant update or delete in Phase 1.
- Refuse the call when the payload names `scn_demo_flood` as a destination.
- Do not insert into `scenarios`, `incidents`, `reports`, `responders`, or `assignments`.
- Do not call `apply_human_decision`.
- Do not update `scn_demo_flood` or its 67 incidents, 100 reports, 12 responders, or 9 baseline assignments.
- Store virtual timestamps as the original text. Do not cast them to `timestamptz`.
- Store `grid_x`, `grid_y`, and `fatigue` as `numeric` so the JSON numbers are not rewritten through binary float.

## 5. Migration risks

| Risk | Why it matters | Proposed control |
| --- | --- | --- |
| PostgREST exposes new tables | A schema reload publishes every granted table | Grants stay on `service_role`; no anon policies; reload only after grants are reviewed |
| Demo data changes | Approval depends on the current flood scenario and assignment uniqueness | No `ALTER` of existing tables and no writes to them |
| Chaos assignments merge into human assignments | `assignments_one_per_incident` and the open-responder index would start rejecting or replacing demo work | Separate table, `cimp_` ids, no foreign key to `public.assignments` |
| Grid coordinates become map coordinates | The demo map uses latitude and longitude | No lat/long columns; check `SIMULATED_LOCAL_GRID` |
| Timestamp or number rewrite | `timestamptz` and `double precision` can change the public text | `text` timestamps and `numeric` coordinates |
| Same `run_id`, new file | Overwrite would hide the reviewed artifact | Unique run key; different digest returns `review` |
| Concurrent commits | Two requests can pass the read before either inserts | Unique indexes and full rollback |
| Large exports | The schema allows 100,000 rows per array | First implementation rejects an import above 10,000 emergency observations before opening a transaction |
| Seed is stored | The public contract includes it | Store it on the run row and do not send it to Nemotron |

## 6. Missing prerequisites

- Explicit approval of this proposal.
- A named SQL file under `web/scripts/` that a person can read before anyone opens the Supabase SQL editor.
- Connection-free tests for the row mapper: duplicate key, changed digest, `scn_demo_flood` refusal, grid values unchanged, and no `public.assignments` rows in the plan.
- Confirmation that the service-role key remains server-only.
- A row cap of 10,000 emergency observations for the first persistent writer.
- No dashboard, Nemotron, or approval-function changes in that implementation step.

## 7. Implementation plan

1. Add the unexecuted SQL file from this proposal. Do not run it.
2. Add a pure TypeScript staging plan that turns a Phase 0 `SimulationImport` into the six row sets and the duplicate decision. Test it with the sample export and the in-memory ledger rules.
3. Review grants, checks, and the absence of demo-table writes again.
4. Only after a separate approval, a person runs the SQL once in the Supabase SQL editor and reloads the API schema.
5. A later phase can teach the dashboard to read `chaos_*` beside `scn_demo_flood`. That is not Phase 1.

## 8. Next step

Stop here. The next implementation step, after approval, is to add `web/scripts/2026-11-08-chaos-import-staging.sql` and the connection-free staging-plan tests. Do not execute the SQL and do not connect to Supabase in that step.
