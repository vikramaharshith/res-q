-- RES-Q Chaos import staging.
-- Offline authoring is approved. Do not run this file until a separate execution approval.
-- The application does not run it, and this step does not connect to Supabase.
--
-- What it creates:
-- 1. Six new tables for one public Chaos export.
-- 2. stage_chaos_import(jsonb), executable only by service_role.
-- 3. RLS with no anon or authenticated policies.
--
-- What it does not do:
-- It does not ALTER, UPDATE, DELETE, or INSERT existing RES-Q tables.
-- It does not modify apply_human_decision or scn_demo_flood.
-- It does not store map coordinates, and it does not store human-approval assignments.
-- Chaos public assignments go only to chaos_public_assignments.
--
-- Locking tradeoff:
-- SELECT FOR UPDATE would require UPDATE on chaos_import_runs, and that grant would
-- also let service_role rewrite a stored digest. The function does not take that grant.
-- It serializes one schema_version and run_id with a transaction advisory lock.
-- A 64-bit hash collision can make two unrelated runs wait. It cannot merge their rows.
-- Unique indexes still reject a conflicting write. The function is SECURITY INVOKER.
-- After a future approved execution, run:
--   NOTIFY pgrst, 'reload schema';

BEGIN;

CREATE TABLE public.chaos_import_runs (
  id text PRIMARY KEY,
  schema_version text NOT NULL,
  engine_version text NOT NULL,
  run_id text NOT NULL,
  digest_algorithm text NOT NULL,
  digest_hex text NOT NULL,
  idempotency_key text NOT NULL,
  byte_length integer NOT NULL,
  source_scenario_id text NOT NULL,
  source_seed text NOT NULL,
  source_label text NOT NULL,
  fictional boolean NOT NULL,
  difficulty text,
  simulation_start text NOT NULL,
  simulation_export text NOT NULL,
  simulation_status text NOT NULL,
  emergency_count integer NOT NULL,
  operational_count integer NOT NULL,
  unit_count integer NOT NULL,
  assignment_count integer NOT NULL,
  first_received_at text,
  last_received_at text,
  replay_manifest jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chaos_import_runs_id_chk CHECK (id ~ '^cimp_' AND id !~ '^asn_'),
  CONSTRAINT chaos_import_runs_version_chk CHECK (schema_version = 'resq.simulation.v1'),
  CONSTRAINT chaos_import_runs_engine_chk CHECK (engine_version = '0.1.0'),
  CONSTRAINT chaos_import_runs_digest_alg_chk CHECK (digest_algorithm = 'SHA-256'),
  CONSTRAINT chaos_import_runs_digest_chk CHECK (digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chaos_import_runs_key_chk CHECK (idempotency_key = schema_version || ':' || run_id || ':' || digest_hex),
  CONSTRAINT chaos_import_runs_bytes_chk CHECK (byte_length BETWEEN 0 AND 33554432),
  CONSTRAINT chaos_import_runs_fictional_chk CHECK (fictional),
  CONSTRAINT chaos_import_runs_difficulty_chk CHECK (difficulty IS NULL OR difficulty IN ('CALM', 'BUSY', 'CHAOS', 'EXTREME')),
  CONSTRAINT chaos_import_runs_status_chk CHECK (simulation_status IN ('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED')),
  CONSTRAINT chaos_import_runs_emergency_cap_chk CHECK (emergency_count BETWEEN 0 AND 10000),
  CONSTRAINT chaos_import_runs_counts_chk CHECK (
    operational_count BETWEEN 0 AND 10000
    AND unit_count BETWEEN 0 AND 10000
    AND assignment_count BETWEEN 0 AND 10000
  ),
  CONSTRAINT chaos_import_runs_time_chk CHECK (
    simulation_start ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND simulation_export ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND (first_received_at IS NULL OR first_received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
    AND (last_received_at IS NULL OR last_received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
  ),
  CONSTRAINT chaos_import_runs_idempotency_uidx UNIQUE (idempotency_key),
  CONSTRAINT chaos_import_runs_run_uidx UNIQUE (schema_version, run_id)
);

CREATE TABLE public.chaos_emergency_observations (
  import_run_id text NOT NULL REFERENCES public.chaos_import_runs (id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  local_id text NOT NULL,
  report_id text NOT NULL,
  category text NOT NULL,
  source_type text NOT NULL,
  observed_at text NOT NULL,
  submitted_at text NOT NULL,
  received_at text NOT NULL,
  narrative text NOT NULL,
  claims jsonb NOT NULL,
  status text NOT NULL,
  urgency text,
  source_metadata jsonb,
  fictional boolean NOT NULL,
  coordinate_system text NOT NULL,
  grid_x numeric NOT NULL,
  grid_y numeric NOT NULL,
  district text,
  primary_reference text,
  secondary_reference text,
  description text NOT NULL,
  precision text,
  PRIMARY KEY (import_run_id, ordinal),
  CONSTRAINT chaos_emergency_report_uidx UNIQUE (import_run_id, report_id),
  CONSTRAINT chaos_emergency_local_uidx UNIQUE (local_id),
  CONSTRAINT chaos_emergency_local_chk CHECK (local_id ~ '^cimp_' AND local_id !~ '^asn_'),
  CONSTRAINT chaos_emergency_ordinal_chk CHECK (ordinal >= 0 AND ordinal < 10000),
  CONSTRAINT chaos_emergency_status_chk CHECK (status = 'RECEIVED'),
  CONSTRAINT chaos_emergency_grid_chk CHECK (
    fictional
    AND coordinate_system = 'SIMULATED_LOCAL_GRID'
    AND grid_x BETWEEN -1000000 AND 1000000
    AND grid_y BETWEEN -1000000 AND 1000000
  ),
  CONSTRAINT chaos_emergency_time_chk CHECK (
    observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND submitted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  )
);

CREATE TABLE public.chaos_units (
  import_run_id text NOT NULL REFERENCES public.chaos_import_runs (id) ON DELETE CASCADE,
  unit_id text NOT NULL,
  local_id text NOT NULL,
  callsign text NOT NULL,
  latest_observed_at text NOT NULL,
  latest_received_at text NOT NULL,
  availability_state text,
  assignment_id text,
  task_status text,
  travel_status text,
  communication_state text,
  fictional boolean,
  coordinate_system text,
  grid_x numeric,
  grid_y numeric,
  district text,
  primary_reference text,
  secondary_reference text,
  description text,
  precision text,
  PRIMARY KEY (import_run_id, unit_id),
  CONSTRAINT chaos_units_local_uidx UNIQUE (local_id),
  CONSTRAINT chaos_units_local_chk CHECK (local_id ~ '^cimp_' AND local_id !~ '^asn_'),
  CONSTRAINT chaos_units_grid_chk CHECK (
    (
      fictional IS NULL
      AND coordinate_system IS NULL
      AND grid_x IS NULL
      AND grid_y IS NULL
      AND description IS NULL
    )
    OR (
      fictional
      AND coordinate_system = 'SIMULATED_LOCAL_GRID'
      AND grid_x BETWEEN -1000000 AND 1000000
      AND grid_y BETWEEN -1000000 AND 1000000
      AND description IS NOT NULL
    )
  ),
  CONSTRAINT chaos_units_time_chk CHECK (
    latest_observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND latest_received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  )
);

CREATE TABLE public.chaos_public_assignments (
  import_run_id text NOT NULL,
  ordinal integer NOT NULL,
  local_id text NOT NULL,
  assignment_id text NOT NULL,
  unit_id text NOT NULL,
  first_received_at text NOT NULL,
  PRIMARY KEY (import_run_id, assignment_id),
  CONSTRAINT chaos_public_assignments_ordinal_uidx UNIQUE (import_run_id, ordinal),
  CONSTRAINT chaos_public_assignments_local_uidx UNIQUE (local_id),
  CONSTRAINT chaos_public_assignments_local_chk CHECK (local_id ~ '^cimp_' AND local_id !~ '^asn_'),
  CONSTRAINT chaos_public_assignments_ordinal_chk CHECK (ordinal >= 0 AND ordinal < 10000),
  CONSTRAINT chaos_public_assignments_unit_fk
    FOREIGN KEY (import_run_id, unit_id)
    REFERENCES public.chaos_units (import_run_id, unit_id)
    ON DELETE CASCADE,
  CONSTRAINT chaos_public_assignments_run_fk
    FOREIGN KEY (import_run_id)
    REFERENCES public.chaos_import_runs (id)
    ON DELETE CASCADE,
  CONSTRAINT chaos_public_assignments_time_chk CHECK (
    first_received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  )
);

CREATE TABLE public.chaos_operational_observations (
  import_run_id text NOT NULL REFERENCES public.chaos_import_runs (id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  local_id text NOT NULL,
  observation_id text NOT NULL,
  unit_id text NOT NULL,
  assignment_id text,
  message_type text NOT NULL,
  observed_at text NOT NULL,
  submitted_at text NOT NULL,
  received_at text NOT NULL,
  source text NOT NULL,
  delivery_status text NOT NULL,
  availability_state text,
  task_status text,
  travel_status text,
  communication_state text,
  fictional boolean,
  coordinate_system text,
  grid_x numeric,
  grid_y numeric,
  district text,
  primary_reference text,
  secondary_reference text,
  description text,
  precision text,
  route_version integer,
  fatigue numeric,
  equipment_item text,
  equipment_condition text,
  inventory jsonb,
  PRIMARY KEY (import_run_id, ordinal),
  CONSTRAINT chaos_operational_id_uidx UNIQUE (import_run_id, observation_id),
  CONSTRAINT chaos_operational_local_uidx UNIQUE (local_id),
  CONSTRAINT chaos_operational_local_chk CHECK (local_id ~ '^cimp_' AND local_id !~ '^asn_'),
  CONSTRAINT chaos_operational_ordinal_chk CHECK (ordinal >= 0 AND ordinal < 10000),
  CONSTRAINT chaos_operational_delivery_chk CHECK (delivery_status = 'DELIVERED'),
  CONSTRAINT chaos_operational_fatigue_chk CHECK (fatigue IS NULL OR (fatigue >= 0 AND fatigue <= 100)),
  CONSTRAINT chaos_operational_route_chk CHECK (route_version IS NULL OR (route_version >= 0 AND route_version <= 1000000)),
  CONSTRAINT chaos_operational_grid_chk CHECK (
    (
      fictional IS NULL
      AND coordinate_system IS NULL
      AND grid_x IS NULL
      AND grid_y IS NULL
      AND description IS NULL
    )
    OR (
      fictional
      AND coordinate_system = 'SIMULATED_LOCAL_GRID'
      AND grid_x BETWEEN -1000000 AND 1000000
      AND grid_y BETWEEN -1000000 AND 1000000
      AND description IS NOT NULL
    )
  ),
  CONSTRAINT chaos_operational_time_chk CHECK (
    observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND submitted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND received_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  ),
  CONSTRAINT chaos_operational_unit_fk
    FOREIGN KEY (import_run_id, unit_id)
    REFERENCES public.chaos_units (import_run_id, unit_id)
    ON DELETE CASCADE
);

CREATE TABLE public.chaos_source_ids (
  import_run_id text NOT NULL REFERENCES public.chaos_import_runs (id) ON DELETE CASCADE,
  entity_kind text NOT NULL,
  source_id text NOT NULL,
  local_id text NOT NULL,
  PRIMARY KEY (import_run_id, entity_kind, source_id),
  CONSTRAINT chaos_source_ids_local_uidx UNIQUE (local_id),
  CONSTRAINT chaos_source_ids_kind_chk CHECK (
    entity_kind IN ('run', 'emergency_observation', 'operational_observation', 'unit', 'public_assignment')
  ),
  CONSTRAINT chaos_source_ids_local_chk CHECK (local_id ~ '^cimp_' AND local_id !~ '^asn_')
);

CREATE OR REPLACE FUNCTION public.stage_chaos_import(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_destination text := payload->>'destinationScenarioId';
  v_run jsonb := payload->'run';
  v_emergency jsonb := COALESCE(payload->'emergencyObservations', '[]'::jsonb);
  v_operational jsonb := COALESCE(payload->'operationalObservations', '[]'::jsonb);
  v_units jsonb := COALESCE(payload->'units', '[]'::jsonb);
  v_assignments jsonb := COALESCE(payload->'chaosPublicAssignments', '[]'::jsonb);
  v_source_ids jsonb := COALESCE(payload->'sourceIds', '[]'::jsonb);
  v_schema text := v_run->>'schema_version';
  v_run_id text := v_run->>'run_id';
  v_digest text := v_run->>'digest_hex';
  v_key text := v_run->>'idempotency_key';
  v_import_id text := v_run->>'id';
  v_emergency_text text := v_run->>'emergency_count';
  v_operational_text text := v_run->>'operational_count';
  v_unit_text text := v_run->>'unit_count';
  v_assignment_text text := v_run->>'assignment_count';
  v_bytes_text text := v_run->>'byte_length';
  v_emergency_count integer;
  v_operational_count integer;
  v_unit_count integer;
  v_assignment_count integer;
  v_bytes integer;
  v_existing_digest text;
  v_existing_key text;
  v_constraint text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR jsonb_typeof(v_run) <> 'object' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_REJECTED',
      'message', 'The staging payload does not match the public import identity.'
    );
  END IF;

  IF octet_length(payload::text) > 33554432 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_LIMIT',
      'message', 'The staging payload exceeds 33554432 bytes.'
    );
  END IF;

  IF v_destination IS NOT DISTINCT FROM 'scn_demo_flood' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'DESTINATION_FORBIDDEN',
      'message', 'scn_demo_flood cannot be an import destination.'
    );
  END IF;

  IF jsonb_typeof(v_emergency) <> 'array'
     OR jsonb_typeof(v_operational) <> 'array'
     OR jsonb_typeof(v_units) <> 'array'
     OR jsonb_typeof(v_assignments) <> 'array'
     OR jsonb_typeof(v_source_ids) <> 'array'
     OR v_emergency_text !~ '^[0-9]{1,8}$'
     OR v_operational_text !~ '^[0-9]{1,8}$'
     OR v_unit_text !~ '^[0-9]{1,8}$'
     OR v_assignment_text !~ '^[0-9]{1,8}$'
     OR v_bytes_text !~ '^[0-9]{1,8}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_REJECTED',
      'message', 'The staging payload does not match the public import identity.'
    );
  END IF;

  v_emergency_count := v_emergency_text::integer;
  v_operational_count := v_operational_text::integer;
  v_unit_count := v_unit_text::integer;
  v_assignment_count := v_assignment_text::integer;
  v_bytes := v_bytes_text::integer;

  IF v_bytes > 33554432 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_LIMIT',
      'message', 'The staging payload exceeds 33554432 bytes.'
    );
  END IF;

  IF jsonb_array_length(v_emergency) > 10000 OR v_emergency_count > 10000 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'EMERGENCY_LIMIT',
      'message', 'The first staging writer accepts at most 10000 emergency observations.'
    );
  END IF;

  IF jsonb_array_length(v_operational) > 10000 OR v_operational_count > 10000 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'OPERATIONAL_LIMIT',
      'message', 'The staging writer accepts at most 10000 operational observations.'
    );
  END IF;

  IF jsonb_array_length(v_units) > 10000 OR v_unit_count > 10000 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'UNIT_LIMIT',
      'message', 'The staging writer accepts at most 10000 units.'
    );
  END IF;

  IF jsonb_array_length(v_assignments) > 10000 OR v_assignment_count > 10000 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'ASSIGNMENT_LIMIT',
      'message', 'The staging writer accepts at most 10000 public assignments.'
    );
  END IF;

  IF jsonb_array_length(v_source_ids) > 40001 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'SOURCE_LIMIT',
      'message', 'The staging writer accepts at most 40001 source-id rows.'
    );
  END IF;

  IF v_emergency_count <> jsonb_array_length(v_emergency)
     OR v_operational_count <> jsonb_array_length(v_operational)
     OR v_unit_count <> jsonb_array_length(v_units)
     OR v_assignment_count <> jsonb_array_length(v_assignments)
     OR v_schema IS DISTINCT FROM 'resq.simulation.v1'
     OR COALESCE(v_run->>'engine_version', '') <> '0.1.0'
     OR COALESCE(v_run->>'digest_algorithm', '') <> 'SHA-256'
     OR v_digest !~ '^[0-9a-f]{64}$'
     OR v_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
     OR v_key IS DISTINCT FROM v_schema || ':' || v_run_id || ':' || v_digest
     OR COALESCE(v_run->>'fictional', '') <> 'true'
     OR v_import_id IS DISTINCT FROM 'cimp_run_' || left(v_digest, 32) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_REJECTED',
      'message', 'The staging payload does not match the public import identity.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT item FROM jsonb_array_elements(v_emergency) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_operational) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_units) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_assignments) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_source_ids) AS src(item)
    ) AS rows (item)
    WHERE item->>'import_run_id' IS DISTINCT FROM v_import_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'CROSS_RUN_REJECTED',
      'message', 'Staging rows must belong to this import run.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT item FROM jsonb_array_elements(v_emergency) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_operational) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_units) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_assignments) AS src(item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(v_source_ids) AS src(item)
    ) AS rows (item)
    WHERE COALESCE(item->>'local_id', '') !~ '^cimp_'
       OR item->>'local_id' ~ '^asn_'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'PAYLOAD_REJECTED',
      'message', 'The staging payload does not match the public import identity.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_emergency) AS src(item) GROUP BY item->>'local_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_emergency) AS src(item) GROUP BY item->>'report_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_operational) AS src(item) GROUP BY item->>'local_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_operational) AS src(item) GROUP BY item->>'observation_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_units) AS src(item) GROUP BY item->>'local_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_units) AS src(item) GROUP BY item->>'unit_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_assignments) AS src(item) GROUP BY item->>'local_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_assignments) AS src(item) GROUP BY item->>'assignment_id' HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_source_ids) AS src(item) GROUP BY item->>'local_id' HAVING COUNT(*) > 1
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'CHILD_ID_CONFLICT',
      'message', 'A staging identifier collided with an existing row. Nothing was written.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_schema || ':' || v_run_id, 0));

  SELECT digest_hex, idempotency_key
  INTO v_existing_digest, v_existing_key
  FROM public.chaos_import_runs
  WHERE schema_version = v_schema
    AND run_id = v_run_id;

  IF FOUND AND v_existing_digest = v_digest AND v_existing_key = v_key THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'duplicate',
      'code', 'DUPLICATE_IMPORT',
      'message', 'This artifact was already imported.'
    );
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'review',
      'code', 'RUN_DIGEST_CONFLICT',
      'message', 'A different artifact for this run was already imported and requires manual review.'
    );
  END IF;

  INSERT INTO public.chaos_import_runs (
    id, schema_version, engine_version, run_id, digest_algorithm, digest_hex, idempotency_key,
    byte_length, source_scenario_id, source_seed, source_label, fictional, difficulty,
    simulation_start, simulation_export, simulation_status, emergency_count, operational_count,
    unit_count, assignment_count, first_received_at, last_received_at, replay_manifest
  )
  SELECT
    id, schema_version, engine_version, run_id, digest_algorithm, digest_hex, idempotency_key,
    byte_length, source_scenario_id, source_seed, source_label, fictional, difficulty,
    simulation_start, simulation_export, simulation_status, emergency_count, operational_count,
    unit_count, assignment_count, first_received_at, last_received_at, replay_manifest
  FROM jsonb_populate_record(NULL::public.chaos_import_runs, v_run);

  INSERT INTO public.chaos_units
  SELECT (jsonb_populate_record(NULL::public.chaos_units, item)).*
  FROM jsonb_array_elements(v_units) AS src(item);

  INSERT INTO public.chaos_public_assignments
  SELECT (jsonb_populate_record(NULL::public.chaos_public_assignments, item)).*
  FROM jsonb_array_elements(v_assignments) AS src(item);

  INSERT INTO public.chaos_emergency_observations
  SELECT (jsonb_populate_record(NULL::public.chaos_emergency_observations, item)).*
  FROM jsonb_array_elements(v_emergency) AS src(item);

  INSERT INTO public.chaos_operational_observations
  SELECT (jsonb_populate_record(NULL::public.chaos_operational_observations, item)).*
  FROM jsonb_array_elements(v_operational) AS src(item);

  INSERT INTO public.chaos_source_ids
  SELECT (jsonb_populate_record(NULL::public.chaos_source_ids, item)).*
  FROM jsonb_array_elements(v_source_ids) AS src(item);

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'staged',
    'code', 'STAGED',
    'import_run_id', v_import_id
  );
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IN ('chaos_import_runs_run_uidx', 'chaos_import_runs_idempotency_uidx') THEN
      SELECT digest_hex, idempotency_key
      INTO v_existing_digest, v_existing_key
      FROM public.chaos_import_runs
      WHERE schema_version = v_schema
        AND run_id = v_run_id;
      IF FOUND AND v_existing_digest = v_digest AND v_existing_key = v_key THEN
        RETURN jsonb_build_object(
          'ok', false,
          'outcome', 'duplicate',
          'code', 'DUPLICATE_IMPORT',
          'message', 'This artifact was already imported.'
        );
      END IF;
      IF v_constraint = 'chaos_import_runs_run_uidx' AND FOUND THEN
        RETURN jsonb_build_object(
          'ok', false,
          'outcome', 'review',
          'code', 'RUN_DIGEST_CONFLICT',
          'message', 'A different artifact for this run was already imported and requires manual review.'
        );
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'outcome', 'rejected',
      'code', 'CHILD_ID_CONFLICT',
      'message', 'A staging identifier collided with an existing row. Nothing was written.'
    );
END;
$fn$;

REVOKE ALL ON TABLE public.chaos_import_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_import_runs FROM anon;
REVOKE ALL ON TABLE public.chaos_import_runs FROM authenticated;
REVOKE ALL ON TABLE public.chaos_emergency_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_emergency_observations FROM anon;
REVOKE ALL ON TABLE public.chaos_emergency_observations FROM authenticated;
REVOKE ALL ON TABLE public.chaos_operational_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_operational_observations FROM anon;
REVOKE ALL ON TABLE public.chaos_operational_observations FROM authenticated;
REVOKE ALL ON TABLE public.chaos_units FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_units FROM anon;
REVOKE ALL ON TABLE public.chaos_units FROM authenticated;
REVOKE ALL ON TABLE public.chaos_public_assignments FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_public_assignments FROM anon;
REVOKE ALL ON TABLE public.chaos_public_assignments FROM authenticated;
REVOKE ALL ON TABLE public.chaos_source_ids FROM PUBLIC;
REVOKE ALL ON TABLE public.chaos_source_ids FROM anon;
REVOKE ALL ON TABLE public.chaos_source_ids FROM authenticated;

REVOKE ALL ON TABLE public.chaos_import_runs FROM service_role;
REVOKE ALL ON TABLE public.chaos_emergency_observations FROM service_role;
REVOKE ALL ON TABLE public.chaos_operational_observations FROM service_role;
REVOKE ALL ON TABLE public.chaos_units FROM service_role;
REVOKE ALL ON TABLE public.chaos_public_assignments FROM service_role;
REVOKE ALL ON TABLE public.chaos_source_ids FROM service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_import_runs TO service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_emergency_observations TO service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_operational_observations TO service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_units TO service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_public_assignments TO service_role;
GRANT SELECT, INSERT ON TABLE public.chaos_source_ids TO service_role;

ALTER TABLE public.chaos_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_emergency_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_operational_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_public_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_source_ids ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.stage_chaos_import(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_chaos_import(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.stage_chaos_import(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.stage_chaos_import(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.stage_chaos_import(jsonb) TO service_role;
ALTER FUNCTION public.stage_chaos_import(jsonb) SECURITY INVOKER;
ALTER FUNCTION public.stage_chaos_import(jsonb) SET search_path = pg_catalog, public, pg_temp;

COMMIT;
