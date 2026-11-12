-- name: EngagedKillSwitch :one
-- Read before every send, never cached, so a switch takes effect within one job.
SELECT scope, reason
FROM kill_switches
WHERE engaged
  AND (    (scope = 'global' AND scope_key = '')
        OR (scope = 'family' AND scope_key = @family_id::text)
        OR (scope = 'broker' AND scope_key = @broker::text))
LIMIT 1;
