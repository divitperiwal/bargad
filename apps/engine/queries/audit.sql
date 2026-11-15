-- name: InsertAudit :exec
-- actor_user_id stays NULL: the engine acted.
INSERT INTO audit_log (family_id, subject_user_id, action, target_type, target_id, detail)
VALUES (@family_id, @subject_user_id, @action, @target_type, @target_id, @detail);
