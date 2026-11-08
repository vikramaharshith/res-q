# Large Chaos integration — controlled handoff

This branch prepares the dashboard and import. **No production migration, Supabase import, approval, dispatch, or deployment was executed.** The live database still requires a separately approved controlled import. Do not interpret the local test database as a successful hosted Supabase import.

## Prepared artifact

| Item | Actual value |
| --- | --- |
| File | `resq-handoff/large-chaos-simulation.json` |
| Schema / engine | `resq.simulation.v1` / `0.1.0` |
| Seed | `b7-large-chaos-20261108-v1` |
| Engine run | `run_0c2b89ucqss0i` |
| New destination | `scn_chaos_large_flood_20261108_v1` |
| Import run | `cimp_run_0ff42bd5775c10eea0ef09898d033aa1` |
| Initial / final emergency reports | 7,000 / **7,864** |
| Operational observations | 718 |
| Public units / assignments | 80 / 80 |
| Source / compact staging payload | 11,038,954 / 13,778,509 bytes |
| SHA-256 | `0ff42bd5775c10eea0ef09898d033aa10a62870ac5e7266023be812b0072e586` |

The engine CLI's source scenario remains `cli-flood-v1`; the engine owns that identifier. Its unique run ID and the new destination above separate this import from the sample and `scn_demo_flood`. No generated values or validated engine behavior were edited.

Generate and check the exact export from the repository root:

```bash
cd chaos-engine
npm ci
node --import tsx src/cli/main.ts simulate --scenario flood --difficulty extreme --seed b7-large-chaos-20261108-v1 --reports 7000 --responders 80 --duration 259200000 --samples 0 --out ../resq-handoff/large-chaos-simulation.json
node --import tsx src/cli/main.ts validate --input ../resq-handoff/large-chaos-simulation.json
node --import tsx src/cli/main.ts replay --input ../resq-handoff/large-chaos-simulation.json
```

The file already exists on this branch. To deliberately regenerate it, add the engine CLI's `--overwrite` flag. The recorded engine execution was 1,473.47 ms, excluding process startup and export serialization. The public export passed validation and canonical byte-identical replay.

## Implementation

- The original schema/semantic validator and staging planner validate the large export. Existing 32 MiB payload, 10,000-record table and 40,001 source-ID limits remain. This command additionally requires 5,000–9,000 final emergencies and reserves serialization headroom for PostgreSQL JSONB size checks.
- `chaos:import:large` defaults to a local dry-run. It checks file size before reading, accepts only new `scn_chaos_large_*` destinations, binds apply approval to the exact SHA-256 and destination, and performs one atomic RPC with no retry. Credentials are read only for an explicitly approved apply. A transport failure has an unknown commit outcome: inspect the run before retrying.
- The additive SQL migration adds a destination registry, a guarded wrapper around the original staging RPC, a filtering index, a full-text GIN index, and service-role-only read RPCs. It retains RLS and the absence of public policies. Neither the existing staging function nor the human decision functions are replaced.
- The original two-report import command, strict sample loader, sample advisory binding, and Urban Flood loaders are preserved. Public simulation assignments remain in `chaos_public_assignments`; they cannot become human approvals or dispatches.
- `/?scenario=chaos` selects the newest imported run. The selector lists the latest 100 runs and always retains the original sample option. An explicit original-sample selection opens the existing complete sample dashboard.
- The large view counts actual rows, not stored header counts. PostgreSQL returns at most 50 report summaries and 400 aggregate grid cells, with search/category/urgency filters and stable ordinal pagination. Coordinates stay on the fictional local grid. The map covers all matching reports, not just the displayed page. Bounded pages avoid the need to virtualize thousands of DOM elements.
- Search is submitted explicitly; there is no polling or per-keystroke database query. Pagination disables speculative prefetch. Each large-page request makes one run-list call and one combined page/count/grid call.
- Replay manifest, source seed, digests and source-ID ledger remain import provenance. Read RPCs explicitly project public fields. Large-run data has **no Nemotron forwarding path**; advisory review remains limited to the original sample. Generalizing advisory review was deliberately left outside this change to preserve its security binding.

## Verification and actual measurements

- Engine: **220/220 tests, 49 suites**. `npm test` cannot start this environment's `tsx` CLI Unix socket (`EPERM`); the same entire test glob passed using `node --import tsx --test test/**/*.test.ts`.
- Engine TypeScript and compiled production output passed. The schema-copy build step passed through `node --import tsx scripts/copy-export-schema.ts`, avoiding the same CLI socket limitation.
- Existing RES-Q: **72/72 tests**.
- New large-integration database tests: **11/11**. They execute the original and additive SQL against a disposable PGlite PostgreSQL instance, use the real generated file, import the sample and large artifact, and verify counts, pages, filtering, private-field rejection, coordinates, duplicate/digest conflict rejection, destination separation, role permissions and no service-role overwrite.
- Web TypeScript, ESLint and production build passed.
- Production HTTP checks passed for 50-row pages, the 14-row final page, exact-ID/empty search, sample HTML, Urban Flood's existing local fallback, and fail-closed APIs (approval HTTP 403; large-run advisory HTTP 400). Existing AI tests cover the sample's approved public-observation projection.

Measurements below are from a production Next.js server over HTTPS to the local PostgreSQL adapter after `ANALYZE`. They include server rendering and complete streamed response receipt. They do **not** include browser rendering, user network latency, hosted PostgREST or hosted Supabase latency.

| Measurement | Actual result |
| --- | --- |
| Full large-page HTTP response, 5 requests | 156.43, 123.92, 107.58, 103.80, 90.98 ms |
| Median complete HTTP response | 107.58 ms |
| Exact report-ID search, complete HTTP response | 33.91 ms |
| Empty search, complete HTTP response | 29.03 ms |
| Last page, complete HTTP response | 86.29 ms |
| Initial response size | 314,527 bytes, uncompressed |
| Database calls / reports per page | 2 / at most 50 |

Raw measurements, SQL timings, validation/import timings and request counters are in `docs/large-chaos-benchmark.json`. PGlite runs real PostgreSQL SQL and constraints but is not the Supabase service. Its local import timing is not a hosted-import benchmark.

**Browser testing is blocked:** Chromium launch fails with `socket() failed: Operation not permitted` because this execution environment denies its Unix socket. Desktop/mobile rendering, hydration, scrolling frame gaps and browser freezes have not been verified. The supplied browser checks must be run on a supported host before claiming those results. No desktop/mobile screenshots or frame-rate measurements are claimed.

## Local verification commands

Use Node 22+ (this work used Node 24.22.1). From `web/`:

```bash
npm ci
npm test
npm run test:large
npx tsc --noEmit
npm run lint
npm run build
npm run test:large:http
# On a host permitting Chromium (Linux + openssl/curl/bash):
npm run test:large:browser
```

The local harness overrides the database URL/key and disables local approvals. It creates a temporary certificate and embedded database, applies both migrations only there, imports both artifacts only there, starts the production app, and stops both processes. It does not use live Supabase credentials. The browser runner defaults to `/usr/bin/chromium`; set `RESQ_TEST_CHROMIUM` to another Chromium executable if needed. The HTTP and browser measurements are written to `/tmp/resq-large-http-benchmark.json` and `/tmp/resq-large-benchmark.json`, respectively.

## Controlled hosted import — execute only after explicit approval

1. Review this PR and run the blocked browser checks. Do not merge automatically. Use this feature branch in a controlled environment.
2. Confirm the target Supabase project and existing sample import. Have an authorized database operator apply **only** `web/scripts/2026-11-08-large-chaos.sql` after approval. The original `2026-11-08-chaos-import-staging.sql` is a prerequisite already present in the working demonstration; do not rerun it over existing tables. The new migration is additive and transactional, not an automatic app startup migration. Then execute `NOTIFY pgrst, 'reload schema';` in that approved project.
3. From `web/`, run the offline dry-run (no database credentials or approval variable needed):

```bash
npm run chaos:import:large -- --file ../resq-handoff/large-chaos-simulation.json --destination scn_chaos_large_flood_20261108_v1 --dry-run
```

Check that its SHA-256 and all four counts match the artifact table above. `remoteChecked: false` is intentional. This dry-run does not check whether a remote destination is occupied.

4. Have the authorized operator inspect the destination and run using read-only SQL. If any rows exist, stop and investigate; do not delete or overwrite them to force a reimport.

```sql
SELECT id, run_id, digest_hex, emergency_count, operational_count, unit_count, assignment_count
FROM public.chaos_import_runs
WHERE id IN ('cimp_run_0ff42bd5775c10eea0ef09898d033aa1',
             'cimp_run_dd07bf2c2799731bd1ef2054766b605d')
   OR run_id = 'run_0c2b89ucqss0i';
SELECT * FROM public.chaos_run_destinations
WHERE destination_scenario_id = 'scn_chaos_large_flood_20261108_v1';
```

The sample row should remain; the large run and destination should not exist yet. Record the sample counts/digest for comparison.

5. Only after approval for this exact artifact and destination, use the already configured server-only credentials in `web/.env.local` (`SUPABASE_URL` and `SUPABASE_SECRET_KEY`). Do not paste keys into commands or commit environment files. The apply command deliberately does not auto-load environment files: the Node `--env-file` option below makes the selected file explicit.

Bash:

```bash
export RESQ_CHAOS_LARGE_IMPORT_APPROVED='0ff42bd5775c10eea0ef09898d033aa10a62870ac5e7266023be812b0072e586:scn_chaos_large_flood_20261108_v1'
node --env-file=.env.local --experimental-strip-types --import ./scripts/register-demo-import.mjs ./scripts/import-chaos-large.mts --file ../resq-handoff/large-chaos-simulation.json --destination scn_chaos_large_flood_20261108_v1 --apply --sha256 0ff42bd5775c10eea0ef09898d033aa10a62870ac5e7266023be812b0072e586
unset RESQ_CHAOS_LARGE_IMPORT_APPROVED
```

PowerShell:

```powershell
$env:RESQ_CHAOS_LARGE_IMPORT_APPROVED = '0ff42bd5775c10eea0ef09898d033aa10a62870ac5e7266023be812b0072e586:scn_chaos_large_flood_20261108_v1'
node --env-file=.env.local --experimental-strip-types --import ./scripts/register-demo-import.mjs ./scripts/import-chaos-large.mts --file ../resq-handoff/large-chaos-simulation.json --destination scn_chaos_large_flood_20261108_v1 --apply --sha256 0ff42bd5775c10eea0ef09898d033aa10a62870ac5e7266023be812b0072e586
Remove-Item Env:RESQ_CHAOS_LARGE_IMPORT_APPROVED
```

Expected result is `STAGED` with the exact import run above. There are no automatic retries. An HTTP timeout or lost response can occur after a transaction commits: inspect the exact import run/destination before doing anything further. Hosted request-size and timeout behavior remain unverified; no chunking fallback bypasses the atomic import.

6. The authorized operator should refresh planner statistics after import and verify actual rows:

```sql
ANALYZE public.chaos_emergency_observations;
ANALYZE public.chaos_import_runs;
SELECT count(*) AS emergencies FROM public.chaos_emergency_observations
WHERE import_run_id = 'cimp_run_0ff42bd5775c10eea0ef09898d033aa1';
SELECT public.chaos_dashboard_page('cimp_run_0ff42bd5775c10eea0ef09898d033aa1',0,'','','')->'counts';
```

Expected counts are emergency 7,864, operational 718, units 80, assignments 80. Recheck the original sample's count/digest and confirm `scn_demo_flood` and existing approval records are unchanged. The import touches only Chaos staging tables and its destination registry.

7. Run the branch's dashboard against that approved project. Open `/?scenario=chaos&run=cimp_run_0ff42bd5775c10eea0ef09898d033aa1`, verify 7,864, paginate/search, switch to the original sample, and open `/` for Urban Flood. Measure hosted response times and real desktop/mobile scrolling before accepting the remaining performance checks. Do not enable dispatch or approval flags for this import.
