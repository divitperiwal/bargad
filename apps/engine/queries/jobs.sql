-- name: ClaimJob :one
-- A second worker racing for the same lane trips jobs_one_running_per_lane
-- (23505); treat that as nothing to claim.
UPDATE jobs
SET status = 'running',
    attempts = attempts + 1,
    locked_by = @worker::text,
    locked_until = now() + make_interval(secs => @lease_seconds::int)
WHERE id = (
  SELECT j.id
  FROM jobs j
  WHERE j.status = 'queued'
    AND j.run_at <= now()
    AND (j.lane IS NULL OR NOT EXISTS (
      SELECT 1 FROM jobs r WHERE r.lane = j.lane AND r.status = 'running'
    ))
  ORDER BY j.run_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: CompleteJob :execrows
UPDATE jobs
SET status = 'done', locked_by = NULL, locked_until = NULL, finished_at = now()
WHERE id = @id AND locked_by = @worker::text AND status = 'running';

-- name: FailJob :execrows
UPDATE jobs
SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
    run_at = now() + make_interval(secs => @retry_in_seconds::int),
    last_error = @error::text,
    locked_by = NULL,
    locked_until = NULL,
    finished_at = CASE WHEN attempts >= max_attempts THEN now() END
WHERE id = @id AND locked_by = @worker::text AND status = 'running';

-- name: RequeueExpiredJobs :execrows
-- The worker died mid-job. Retrying is safe because every broker call carries
-- an idempotency key, and the reconciler settles what was in flight.
UPDATE jobs
SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
    last_error = 'lease expired',
    locked_by = NULL,
    locked_until = NULL,
    finished_at = CASE WHEN attempts >= max_attempts THEN now() END
WHERE status = 'running' AND locked_until < now();

-- name: DeferJob :execrows
-- Not a failure: the market is shut, a kill switch is on or there's no broker
-- session yet. The attempt the claim added is given back.
UPDATE jobs
SET status = 'queued',
    attempts = attempts - 1,
    run_at = @run_at,
    last_error = @reason::text,
    locked_by = NULL,
    locked_until = NULL
WHERE id = @id AND locked_by = @worker::text AND status = 'running';

-- name: KillJob :execrows
-- Retrying can't help, e.g. a payload that doesn't parse.
UPDATE jobs
SET status = 'dead',
    last_error = @error::text,
    locked_by = NULL,
    locked_until = NULL,
    finished_at = now()
WHERE id = @id AND locked_by = @worker::text AND status = 'running';
