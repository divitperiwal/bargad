-- +goose Up
CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dissolved_at timestamptz
);

-- relationship is relative to the head, and NULL after a handover until re-declared.
CREATE TABLE family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families,
  user_id uuid NOT NULL REFERENCES users,
  role text NOT NULL CHECK (role IN ('head', 'member')),
  relationship text CHECK (relationship IN ('self', 'spouse', 'dependent_child', 'dependent_parent', 'other')),
  can_trade boolean GENERATED ALWAYS AS (coalesce(relationship <> 'other', false)) STORED,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  left_reason text CHECK (left_reason IN ('left', 'removed', 'dissolved')),
  CHECK (role <> 'head' OR relationship = 'self'),
  CHECK ((left_at IS NULL) = (left_reason IS NULL))
);
CREATE UNIQUE INDEX family_members_one_family ON family_members (user_id) WHERE left_at IS NULL;
-- Can't be deferred, so a handover demotes the old head before promoting the new one.
CREATE UNIQUE INDEX family_members_one_head ON family_members (family_id) WHERE role = 'head' AND left_at IS NULL;
CREATE INDEX family_members_active ON family_members (family_id) WHERE left_at IS NULL;

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families,
  invited_by uuid NOT NULL REFERENCES users,
  email text NOT NULL CHECK (email = lower(email)),
  relationship text NOT NULL CHECK (relationship IN ('spouse', 'dependent_child', 'dependent_parent', 'other')),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users,
  revoked_at timestamptz,
  CHECK (expires_at <= created_at + interval '7 days'),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
-- Expired invites still count, so re-inviting revokes the old one first.
CREATE UNIQUE INDEX invites_one_pending ON invites (family_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The only history table. One row per member an event touches; that member's
-- rows are also their notification feed.
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL DEFAULT now(),
  family_id uuid REFERENCES families,
  actor_user_id uuid REFERENCES users, -- NULL when the engine acted
  subject_user_id uuid NOT NULL REFERENCES users,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  trace_id text,
  PRIMARY KEY (at, id)
);
CREATE INDEX audit_log_subject ON audit_log (subject_user_id, at DESC);
CREATE INDEX audit_log_target ON audit_log (target_type, target_id);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();

-- +goose Down
DROP TABLE audit_log;
DROP TABLE invites;
DROP TABLE family_members;
DROP TABLE families;
