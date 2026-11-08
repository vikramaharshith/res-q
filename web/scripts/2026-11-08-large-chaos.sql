-- REVIEW / APPLY ONLY WITH SEPARATE APPROVAL. Requires chaos-import-staging.sql.
-- Additive only. No changes to sample, demo, approvals, or original staging RPC.
BEGIN;
CREATE TABLE public.chaos_run_destinations (
  destination_scenario_id text PRIMARY KEY CHECK (destination_scenario_id ~ '^scn_chaos_large_[a-z0-9_]{1,64}$'),
  import_run_id text UNIQUE NOT NULL REFERENCES public.chaos_import_runs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chaos_run_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chaos_run_destinations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.chaos_run_destinations TO service_role;

CREATE FUNCTION public.stage_large_chaos_import(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE destination text := payload->>'destinationScenarioId'; result jsonb;
BEGIN
  IF destination IS NULL OR destination !~ '^scn_chaos_large_[a-z0-9_]{1,64}$' THEN
    RETURN jsonb_build_object('ok',false,'code','DESTINATION_FORBIDDEN');
  END IF;
  IF jsonb_typeof(payload->'emergencyObservations') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok',false,'code','PAYLOAD_REJECTED');
  END IF;
  IF jsonb_array_length(payload->'emergencyObservations') NOT BETWEEN 5000 AND 9000 THEN
    RETURN jsonb_build_object('ok',false,'code','EMERGENCY_LIMIT');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('large-chaos-destination:' || destination, 0));
  IF EXISTS(SELECT 1 FROM public.chaos_run_destinations WHERE destination_scenario_id = destination) THEN
    RETURN jsonb_build_object('ok',false,'code','DESTINATION_EXISTS');
  END IF;
  result := public.stage_chaos_import(payload);
  IF result->>'code' = 'STAGED' AND result->>'ok' = 'true' THEN
    INSERT INTO public.chaos_run_destinations(destination_scenario_id,import_run_id)
    VALUES(destination,result->>'import_run_id');
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.stage_large_chaos_import(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_large_chaos_import(jsonb) TO service_role;

-- The existing PK (import_run_id,ordinal) supports stable bounded page reads.
CREATE INDEX chaos_emergency_filter_idx ON public.chaos_emergency_observations(import_run_id,category,urgency,ordinal);
CREATE INDEX chaos_emergency_search_idx ON public.chaos_emergency_observations
USING gin (to_tsvector('simple', narrative || ' ' || report_id || ' ' || coalesce(district,'')));

-- Explicit allowlist: no seed, digest, replay manifest, or source-id ledger.
CREATE FUNCTION public.chaos_dashboard_runs() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'label',r.source_label,'runId',r.run_id,
    'destination',d.destination_scenario_id) ORDER BY r.created_at DESC,r.id),'[]'::jsonb)
  FROM (SELECT id,source_label,run_id,created_at FROM public.chaos_import_runs
        WHERE fictional AND schema_version='resq.simulation.v1' AND engine_version='0.1.0'
        ORDER BY created_at DESC,id LIMIT 100) r
  LEFT JOIN public.chaos_run_destinations d ON d.import_run_id=r.id;
$$;

-- Counts and map aggregation run inside PostgreSQL. At most 50 report summaries + 400 cells.
CREATE FUNCTION public.chaos_dashboard_page(
  p_run text, p_page integer DEFAULT 0, p_search text DEFAULT '',
  p_category text DEFAULT '', p_urgency text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_run !~ '^cimp_run_[a-f0-9]{32}$' OR p_run IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 199
     OR p_search IS NULL OR length(p_search)>120 OR p_category IS NULL OR length(p_category)>64
     OR p_urgency IS NULL OR length(p_urgency)>32 THEN
    RAISE EXCEPTION 'Invalid Chaos page request' USING ERRCODE='22023';
  END IF;
  WITH run AS (
    SELECT id,source_label,run_id FROM public.chaos_import_runs
    WHERE id=p_run AND fictional AND schema_version='resq.simulation.v1' AND engine_version='0.1.0'
  ), filtered AS MATERIALIZED (
    -- Separate branches keep the GIN search path usable after generic plan caching.
    SELECT e.ordinal,e.report_id,e.category,e.urgency,e.narrative,e.received_at,e.grid_x,e.grid_y,e.district
    FROM public.chaos_emergency_observations e JOIN run r ON r.id=e.import_run_id
    WHERE p_search='' AND (p_category='' OR e.category=p_category) AND (p_urgency='' OR e.urgency=p_urgency)
    UNION ALL
    SELECT e.ordinal,e.report_id,e.category,e.urgency,e.narrative,e.received_at,e.grid_x,e.grid_y,e.district
    FROM public.chaos_emergency_observations e JOIN run r ON r.id=e.import_run_id
    WHERE p_search<>'' AND (p_category='' OR e.category=p_category) AND (p_urgency='' OR e.urgency=p_urgency)
      AND to_tsvector('simple',e.narrative || ' ' || e.report_id || ' ' || coalesce(e.district,'')) @@ plainto_tsquery('simple',p_search)
  ), bounds AS (
    SELECT min(grid_x) xmin,max(grid_x) xmax,min(grid_y) ymin,max(grid_y) ymax FROM filtered
  ), cells AS (
    SELECT least(19,floor((e.grid_x-b.xmin)/greatest(b.xmax-b.xmin,1)*20))::int cx,
           least(19,floor((e.grid_y-b.ymin)/greatest(b.ymax-b.ymin,1)*20))::int cy,
           count(*) n FROM filtered e CROSS JOIN bounds b GROUP BY 1,2
  ), page AS (
    SELECT ordinal,report_id,category,urgency,narrative,received_at,grid_x,grid_y,district
    FROM filtered ORDER BY ordinal LIMIT 50 OFFSET p_page*50
  )
  SELECT jsonb_build_object('run',jsonb_build_object('id',r.id,'label',r.source_label,'runId',r.run_id),
    'counts',jsonb_build_object(
      'emergency',(SELECT count(*) FROM public.chaos_emergency_observations WHERE import_run_id=p_run),
      'operational',(SELECT count(*) FROM public.chaos_operational_observations WHERE import_run_id=p_run),
      'units',(SELECT count(*) FROM public.chaos_units WHERE import_run_id=p_run),
      'assignments',(SELECT count(*) FROM public.chaos_public_assignments WHERE import_run_id=p_run)),
    'matched',(SELECT count(*) FROM filtered),'page',p_page,'pageSize',50,
    'reports',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ordinal) FROM page p),'[]'::jsonb),
    'bounds',(SELECT to_jsonb(b) FROM bounds b),
    'cells',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.cy,c.cx) FROM cells c),'[]'::jsonb))
  INTO result FROM run r;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.chaos_dashboard_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chaos_dashboard_page(text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chaos_dashboard_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.chaos_dashboard_page(text,integer,text,text,text) TO service_role;
COMMIT;
-- After an approved execution: NOTIFY pgrst, 'reload schema';
