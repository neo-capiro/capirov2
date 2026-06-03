-- Permanent fix for stale Program Element detail pages.
--
-- program_element_detail_mv is a materialized view owned by the Aurora master
-- role (migrations run as master, so the MV inherits master ownership). The API
-- and all sync jobs connect as `capiro_app`, which is NOT the owner and cannot
-- run `REFRESH MATERIALIZED VIEW` (Postgres requires the owner). As a result the
-- writer's refresh call silently failed with "must be owner of materialized
-- view", the MV went stale, and PE profile pages showed no budget years/marks.
--
-- Fix mirrors the working refresh_lobby_intel_mv() pattern but makes it callable
-- by capiro_app: a SECURITY DEFINER function owned by master (created here in a
-- master-run migration) executes the REFRESH with the owner's privileges, and we
-- GRANT EXECUTE to capiro_app so the runtime role can invoke it.

CREATE OR REPLACE FUNCTION refresh_program_element_detail_mv()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  -- Pin search_path for SECURITY DEFINER safety (prevents search_path hijacking).
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- CONCURRENTLY avoids locking readers; requires a unique index on the MV
  -- (program_element_detail_mv has a unique index on pe_code). Falls back to a
  -- plain refresh if a concurrent refresh is not possible.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY program_element_detail_mv;
  EXCEPTION
    WHEN feature_not_supported OR object_not_in_prerequisite_state THEN
      REFRESH MATERIALIZED VIEW program_element_detail_mv;
  END;
END;
$$;

-- The function runs as its owner (master); capiro_app just needs to call it.
GRANT EXECUTE ON FUNCTION refresh_program_element_detail_mv() TO capiro_app;

COMMENT ON FUNCTION refresh_program_element_detail_mv() IS
  'Refreshes program_element_detail_mv with owner privileges (SECURITY DEFINER) so capiro_app can trigger it after PE/year/mark loads. Call: SELECT refresh_program_element_detail_mv();';
