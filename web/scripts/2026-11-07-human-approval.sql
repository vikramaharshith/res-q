-- RES-Q human approval migration.
-- Review this file, then run it once in the Supabase SQL editor as the table owner.
-- The application does not run it.
--
-- What it changes:
-- 1. Enables RLS on agent_runs and approval_actions and does not add anon policies.
-- 2. Revokes anon, authenticated, and PUBLIC access to those tables and to the new functions.
-- 3. Grants the server role the table rights the decision function uses.
--    approval_actions needs UPDATE because the function locks a row with
--    SELECT ... FOR UPDATE. SELECT and INSERT alone make that lock fail
--    before any decision is written.
-- 4. Adds audit columns on approval_actions. Existing rows are left in place.
-- 5. Adds uniqueness for one decision per investigation and one idempotency key.
-- 6. Adds one assignment per incident, and one open assignment per responder.
-- 7. Creates apply_human_decision(jsonb), executable only by service_role.
--
-- It does not update incidents, responders, assignments, or reports by itself.
-- It does not grant write access to anon or authenticated.
-- After it succeeds, the SQL editor should show "Success". Then run:
--   NOTIFY pgrst, 'reload schema';
-- Restart the Next.js server so it retries the new function.

BEGIN;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_runs FROM anon;
REVOKE ALL ON TABLE public.agent_runs FROM authenticated;
REVOKE ALL ON TABLE public.approval_actions FROM PUBLIC;
REVOKE ALL ON TABLE public.approval_actions FROM anon;
REVOKE ALL ON TABLE public.approval_actions FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.agent_runs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.approval_actions TO service_role;
GRANT SELECT, UPDATE ON TABLE public.incidents TO service_role;
GRANT SELECT, UPDATE ON TABLE public.responders TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.assignments TO service_role;

ALTER TABLE public.approval_actions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS operator_label text,
  ADD COLUMN IF NOT EXISTS selected_priority text,
  ADD COLUMN IF NOT EXISTS selected_responder_id text,
  ADD COLUMN IF NOT EXISTS original_recommendation jsonb,
  ADD COLUMN IF NOT EXISTS previous_state jsonb,
  ADD COLUMN IF NOT EXISTS resulting_state jsonb,
  ADD COLUMN IF NOT EXISTS assignment_id text,
  ADD COLUMN IF NOT EXISTS result jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS approval_actions_idempotency_key_uidx
  ON public.approval_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS approval_actions_agent_run_uidx
  ON public.approval_actions (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_per_incident
  ON public.assignments (incident_id);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_open_responder
  ON public.assignments (responder_id)
  WHERE status IN ('ASSIGNED', 'IN_PROGRESS');

CREATE OR REPLACE FUNCTION public.resq_required_capabilities(category text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE category
    WHEN 'structure_flood' THEN ARRAY['water rescue', 'evacuation', 'flood control', 'high-water vehicle']
    WHEN 'stranded_vehicle' THEN ARRAY['high-water vehicle', 'evacuation', 'water rescue']
    WHEN 'evacuation_assistance' THEN ARRAY['evacuation', 'shelter transport', 'high-water vehicle']
    WHEN 'welfare_check' THEN ARRAY['search', 'welfare check']
    WHEN 'utility_hazard' THEN ARRAY['utilities', 'power isolation']
    WHEN 'water_rescue' THEN ARRAY['water rescue', 'boat']
    WHEN 'supply_request' THEN ARRAY['supplies', 'evacuation']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.resq_capability_fits(category text, capabilities text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(capabilities, ARRAY[]::text[])) AS owned
    JOIN unnest(public.resq_required_capabilities(category)) AS needed ON true
    WHERE lower(owned) = needed
       OR (char_length(needed) >= 4 AND position(needed in lower(owned)) > 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.resq_decision_error(status integer, code text, message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'ok', false,
    'http_status', status,
    'code', code,
    'message', message,
    'assignment_created', false,
    'replay', false,
    'decision', NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_human_decision(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_operator text := payload->>'operator_label';
  v_scenario text := payload->>'scenario_id';
  v_incident_id text := payload->>'incident_id';
  v_run_id text := payload->>'agent_run_id';
  v_action text := payload->>'action';
  v_reason text := btrim(COALESCE(payload->>'reason', ''));
  v_key text := payload->>'idempotency_key';
  v_requested_priority text := NULLIF(upper(btrim(COALESCE(payload->>'selected_priority', ''))), '');
  v_requested_responder text := NULLIF(btrim(COALESCE(payload->>'selected_responder_id', '')), '');
  v_priority text;
  v_responder_id text;
  v_fingerprint text;
  v_run public.agent_runs%ROWTYPE;
  v_incident public.incidents%ROWTYPE;
  v_responder public.responders%ROWTYPE;
  v_existing_id text;
  v_existing_origin text;
  v_existing_status text;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_open_responder_assignment text;
  v_decision_id text;
  v_assignment_id text;
  v_now timestamptz := now();
  v_note text;
  v_origin text;
  v_next_status text;
  v_next_priority text;
  v_previous jsonb;
  v_resulting jsonb;
  v_decision jsonb;
  v_count integer;
BEGIN
  IF v_operator IS DISTINCT FROM 'local_demo_operator' THEN
    RETURN public.resq_decision_error(403, 'UNAUTHORIZED', 'The decision was not made by the local demonstration operator. Nothing was assigned.');
  END IF;
  IF v_scenario IS DISTINCT FROM 'scn_demo_flood' THEN
    RETURN public.resq_decision_error(403, 'SCENARIO_MISMATCH', 'This decision is bound to the standard demo scenario. Nothing was assigned.');
  END IF;
  IF v_action NOT IN ('approve', 'reject', 'override') THEN
    RETURN public.resq_decision_error(400, 'INVALID_REQUEST', 'action must be approve, reject, or override. Nothing was assigned.');
  END IF;
  IF jsonb_typeof(payload->'confirmed') IS DISTINCT FROM 'boolean' OR (payload->>'confirmed')::boolean IS NOT TRUE THEN
    RETURN public.resq_decision_error(400, 'CONFIRMATION_REQUIRED', 'Confirm the decision explicitly. Nothing was assigned.');
  END IF;
  IF v_key IS NULL OR v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN public.resq_decision_error(400, 'INVALID_REQUEST', 'The decision needs a new idempotency key. Nothing was assigned.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN public.resq_decision_error(400, 'INVALID_REQUEST', 'The reason must be 500 characters or fewer. Nothing was assigned.');
  END IF;
  IF v_incident_id !~ '^inc_[0-9]{4,8}$' OR v_run_id !~* '^run_[0-9a-f-]{36}$' THEN
    RETURN public.resq_decision_error(400, 'INVALID_REQUEST', 'The incident or investigation id is not valid. Nothing was assigned.');
  END IF;

  SELECT * INTO v_run
  FROM public.agent_runs
  WHERE id = v_run_id;

  IF NOT FOUND THEN
    RETURN public.resq_decision_error(404, 'RUN_NOT_FOUND', 'That investigation is not stored. Nothing was assigned.');
  END IF;
  IF v_run.scenario_id IS DISTINCT FROM v_scenario OR v_run.incident_id IS DISTINCT FROM v_incident_id THEN
    RETURN public.resq_decision_error(403, 'SCENARIO_MISMATCH', 'The investigation does not belong to this incident. Nothing was assigned.');
  END IF;
  IF v_run.status IS DISTINCT FROM 'COMPLETED' OR v_run.recommendation IS NULL THEN
    RETURN public.resq_decision_error(409, 'RECOMMENDATION_MISSING', 'This investigation has no accepted recommendation to review. Nothing was assigned.');
  END IF;
  IF COALESCE(v_run.recommendation->>'advisory', '') IS DISTINCT FROM 'true'
     OR v_run.recommendation->>'incident_id' IS DISTINCT FROM v_incident_id THEN
    RETURN public.resq_decision_error(409, 'RECOMMENDATION_MISSING', 'The stored recommendation is not an advisory result for this incident. Nothing was assigned.');
  END IF;

  IF v_action = 'approve' THEN
    v_priority := v_run.recommendation->>'proposed_priority';
    v_responder_id := NULLIF(v_run.recommendation->>'recommended_responder_id', '');
    IF v_responder_id IS NULL THEN
      RETURN public.resq_decision_error(409, 'RECOMMENDATION_HAS_NO_UNIT', 'Nemotron did not suggest a unit. Approve cannot create an assignment.');
    END IF;
  ELSIF v_action = 'reject' THEN
    IF char_length(v_reason) = 0 THEN
      RETURN public.resq_decision_error(400, 'REASON_REQUIRED', 'A reason is required to reject a recommendation. Nothing was assigned.');
    END IF;
    v_priority := NULL;
    v_responder_id := NULL;
  ELSE
    IF char_length(v_reason) = 0 THEN
      RETURN public.resq_decision_error(400, 'REASON_REQUIRED', 'A reason is required to override a recommendation. Nothing was assigned.');
    END IF;
    v_priority := v_requested_priority;
    v_responder_id := v_requested_responder;
    IF v_priority IS NULL AND v_responder_id IS NULL THEN
      RETURN public.resq_decision_error(400, 'OVERRIDE_UNCHANGED', 'An override needs a different priority, a responder, or both. Nothing was assigned.');
    END IF;
    IF v_priority IS NOT NULL AND v_priority NOT IN ('UNASSESSED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') THEN
      RETURN public.resq_decision_error(400, 'INVALID_REQUEST', 'selected_priority is not a review priority. Nothing was assigned.');
    END IF;
    IF (v_priority IS NULL OR v_priority = v_run.recommendation->>'proposed_priority')
       AND (v_responder_id IS NULL OR v_responder_id IS NOT DISTINCT FROM NULLIF(v_run.recommendation->>'recommended_responder_id', '')) THEN
      RETURN public.resq_decision_error(400, 'OVERRIDE_UNCHANGED', 'That selection matches the Nemotron draft. Approve it, or change the priority or the unit.');
    END IF;
  END IF;

  v_fingerprint := concat_ws(
    '|',
    v_action,
    v_scenario,
    v_incident_id,
    v_run_id,
    COALESCE(v_priority, ''),
    COALESCE(v_responder_id, ''),
    v_reason
  );

  PERFORM pg_advisory_xact_lock(41, hashtext(v_key));
  PERFORM pg_advisory_xact_lock(42, hashtext(v_incident_id));
  PERFORM pg_advisory_xact_lock(43, hashtext(v_run_id));
  IF v_responder_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(44, hashtext(v_responder_id));
  END IF;

  -- FOR UPDATE needs UPDATE on approval_actions, granted to service_role above.
  SELECT fingerprint, result
  INTO v_existing_fingerprint, v_existing_result
  FROM public.approval_actions
  WHERE idempotency_key = v_key OR agent_run_id = v_run_id
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN public.resq_decision_error(409, 'DECISION_CONFLICT', 'This investigation already has a different human decision. The earlier decision was kept.');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'http_status', 200,
      'code', 'IDEMPOTENT_REPLAY',
      'message', 'This decision was already recorded. No second assignment was created.',
      'assignment_created', COALESCE((v_existing_result->>'assignmentCreated')::boolean, false),
      'replay', true,
      'decision', v_existing_result
    );
  END IF;

  SELECT * INTO v_incident
  FROM public.incidents
  WHERE id = v_incident_id AND scenario_id = v_scenario
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.resq_decision_error(404, 'INCIDENT_NOT_FOUND', 'That incident is not in the standard demo. Nothing was assigned.');
  END IF;

  SELECT id, origin, status
  INTO v_existing_id, v_existing_origin, v_existing_status
  FROM public.assignments
  WHERE incident_id = v_incident_id
  FOR UPDATE;

  IF v_responder_id IS NOT NULL THEN
    IF v_existing_id IS NOT NULL THEN
      RETURN public.resq_decision_error(409, 'ALREADY_ASSIGNED', 'This incident already has a simulated assignment. Nothing was replaced.');
    END IF;
    IF v_incident.status = 'RESOLVED' THEN
      RETURN public.resq_decision_error(409, 'INCIDENT_NOT_ELIGIBLE', 'This incident is resolved. The simulation will not reopen it.');
    END IF;
    IF v_incident.status NOT IN ('NEW', 'NEEDS_REVIEW') THEN
      RETURN public.resq_decision_error(409, 'INCIDENT_NOT_ELIGIBLE', 'Only a new or needs-review incident can receive a simulated assignment. Nothing was assigned.');
    END IF;

    SELECT * INTO v_responder
    FROM public.responders
    WHERE id = v_responder_id AND scenario_id = v_scenario
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.resq_decision_error(404, 'RESPONDER_NOT_FOUND', 'That simulated unit is not in this scenario. Nothing was assigned.');
    END IF;
    IF v_responder.availability = 'OFFLINE' THEN
      RETURN public.resq_decision_error(409, 'RESPONDER_OFFLINE', v_responder.callsign || ' is offline in the simulation. Nothing was assigned.');
    END IF;
    IF v_responder.availability IS DISTINCT FROM 'AVAILABLE' THEN
      RETURN public.resq_decision_error(409, 'RESPONDER_BUSY', v_responder.callsign || ' is not available and cannot be double-booked. Nothing was assigned.');
    END IF;

    SELECT id INTO v_open_responder_assignment
    FROM public.assignments
    WHERE responder_id = v_responder_id
      AND status IN ('ASSIGNED', 'IN_PROGRESS')
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      RETURN public.resq_decision_error(409, 'RESPONDER_BUSY', v_responder.callsign || ' already has open assignment ' || v_open_responder_assignment || '. Nothing was assigned.');
    END IF;
    IF NOT public.resq_capability_fits(v_incident.category, v_responder.capabilities) THEN
      RETURN public.resq_decision_error(409, 'RESPONDER_INCOMPATIBLE', v_responder.callsign || ' does not have a capability required for this case. Nothing was assigned.');
    END IF;
  ELSIF v_action = 'override' THEN
    IF v_incident.status = 'RESOLVED' THEN
      RETURN public.resq_decision_error(409, 'INCIDENT_NOT_ELIGIBLE', 'This incident is resolved. The simulation will not reopen it or change its priority.');
    END IF;
    IF v_incident.status NOT IN ('NEW', 'NEEDS_REVIEW', 'ASSIGNED', 'IN_PROGRESS') THEN
      RETURN public.resq_decision_error(409, 'INCIDENT_NOT_ELIGIBLE', 'This incident cannot take a priority change. Nothing was assigned.');
    END IF;
    IF v_priority IS NULL OR v_priority = v_incident.priority THEN
      RETURN public.resq_decision_error(400, 'OVERRIDE_UNCHANGED', 'Choose a different priority or a responder. Nothing was assigned.');
    END IF;
  END IF;

  v_decision_id := 'appr_' || replace(gen_random_uuid()::text, '-', '');
  v_assignment_id := NULL;
  v_next_status := v_incident.status;
  v_next_priority := v_incident.priority;
  v_origin := CASE WHEN v_action = 'override' THEN 'human_override' ELSE 'human_approval' END;

  v_previous := jsonb_build_object(
    'incidentStatus', v_incident.status,
    'incidentPriority', v_incident.priority,
    'responderId', CASE WHEN v_responder_id IS NULL THEN NULL ELSE v_responder.id END,
    'responderAvailability', CASE WHEN v_responder_id IS NULL THEN NULL ELSE v_responder.availability END,
    'assignmentId', v_existing_id,
    'assignmentStatus', v_existing_status,
    'assignmentOrigin', v_existing_origin
  );

  IF v_responder_id IS NOT NULL THEN
    v_assignment_id := 'asn_h_' || replace(gen_random_uuid()::text, '-', '');
    v_next_status := 'ASSIGNED';
    v_next_priority := COALESCE(v_priority, v_incident.priority);
    v_note := left(
      CASE
        WHEN v_action = 'override' THEN 'Human override in the local simulation. Not a real dispatch.'
        ELSE 'Human approval of a Nemotron draft in the local simulation. Not a real dispatch.'
      END || CASE WHEN v_reason = '' THEN '' ELSE ' Reason: ' || v_reason END,
      2000
    );

    UPDATE public.incidents
    SET status = 'ASSIGNED',
        priority = v_next_priority,
        updated_at = v_now
    WHERE id = v_incident_id
      AND scenario_id = v_scenario
      AND status IN ('NEW', 'NEEDS_REVIEW');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'RESQ_ABORT:INCIDENT_UPDATE';
    END IF;

    UPDATE public.responders
    SET availability = 'BUSY',
        status = 'BUSY',
        updated_at = v_now
    WHERE id = v_responder_id
      AND scenario_id = v_scenario
      AND availability = 'AVAILABLE';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'RESQ_ABORT:RESPONDER_UPDATE';
    END IF;

    INSERT INTO public.assignments (
      id, incident_id, responder_id, status, assigned_at, origin, note
    ) VALUES (
      v_assignment_id, v_incident_id, v_responder_id, 'ASSIGNED', v_now, v_origin, v_note
    );
  ELSIF v_action = 'override' THEN
    v_next_priority := v_priority;
    UPDATE public.incidents
    SET priority = v_next_priority,
        updated_at = v_now
    WHERE id = v_incident_id
      AND scenario_id = v_scenario
      AND status = v_incident.status
      AND status <> 'RESOLVED';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'RESQ_ABORT:PRIORITY_UPDATE';
    END IF;
  END IF;

  v_resulting := jsonb_build_object(
    'incidentStatus', v_next_status,
    'incidentPriority', v_next_priority,
    'responderId', CASE WHEN v_responder_id IS NULL THEN NULL ELSE v_responder.id END,
    'responderAvailability', CASE WHEN v_responder_id IS NULL THEN NULL ELSE 'BUSY' END,
    'assignmentId', COALESCE(v_assignment_id, v_existing_id),
    'assignmentStatus', CASE WHEN v_assignment_id IS NULL THEN v_existing_status ELSE 'ASSIGNED' END,
    'assignmentOrigin', CASE WHEN v_assignment_id IS NULL THEN v_existing_origin ELSE v_origin END
  );

  v_decision := jsonb_build_object(
    'id', v_decision_id,
    'idempotencyKey', v_key,
    'fingerprint', v_fingerprint,
    'agentRunId', v_run_id,
    'incidentId', v_incident_id,
    'scenarioId', v_scenario,
    'action', v_action,
    'reason', v_reason,
    'operatorLabel', 'local_demo_operator',
    'selectedPriority', v_priority,
    'selectedResponderId', v_responder_id,
    'originalRecommendation', v_run.recommendation,
    'previousState', v_previous,
    'resultingState', v_resulting,
    'assignmentId', v_assignment_id,
    'assignmentCreated', v_assignment_id IS NOT NULL,
    'createdAt', v_now,
    'simulation', true,
    'humanDecision', true
  );

  INSERT INTO public.approval_actions (
    id,
    agent_run_id,
    incident_id,
    action,
    reason,
    created_at,
    scenario_id,
    idempotency_key,
    fingerprint,
    operator_label,
    selected_priority,
    selected_responder_id,
    original_recommendation,
    previous_state,
    resulting_state,
    assignment_id,
    result
  ) VALUES (
    v_decision_id,
    v_run_id,
    v_incident_id,
    v_action,
    NULLIF(v_reason, ''),
    v_now,
    v_scenario,
    v_key,
    v_fingerprint,
    'local_demo_operator',
    v_priority,
    v_responder_id,
    v_run.recommendation,
    v_previous,
    v_resulting,
    v_assignment_id,
    v_decision
  );

  RETURN jsonb_build_object(
    'ok', true,
    'http_status', 200,
    'code', CASE v_action
      WHEN 'approve' THEN 'APPROVED'
      WHEN 'reject' THEN 'REJECTED'
      ELSE 'OVERRIDDEN'
    END,
    'message', CASE
      WHEN v_assignment_id IS NOT NULL THEN 'The simulated assignment was recorded. This is not a real dispatch.'
      WHEN v_action = 'reject' THEN 'The recommendation was rejected. Assignments and availability were left unchanged.'
      ELSE 'The priority override was recorded. No assignment was created.'
    END,
    'assignment_created', v_assignment_id IS NOT NULL,
    'replay', false,
    'decision', v_decision
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN public.resq_decision_error(409, 'DECISION_CONFLICT', 'Another decision committed first. Refresh the case. No duplicate assignment was kept.');
END;
$$;

REVOKE ALL ON FUNCTION public.resq_required_capabilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resq_required_capabilities(text) FROM anon;
REVOKE ALL ON FUNCTION public.resq_required_capabilities(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.resq_capability_fits(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resq_capability_fits(text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.resq_capability_fits(text, text[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.resq_decision_error(integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resq_decision_error(integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.resq_decision_error(integer, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.apply_human_decision(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_human_decision(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_human_decision(jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.resq_required_capabilities(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resq_capability_fits(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.resq_decision_error(integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_human_decision(jsonb) TO service_role;

ALTER FUNCTION public.apply_human_decision(jsonb) SET search_path = public, pg_temp;

COMMIT;

NOTIFY pgrst, 'reload schema';
