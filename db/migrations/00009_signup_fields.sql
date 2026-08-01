-- +goose Up
ALTER TABLE users
  ADD COLUMN mobile text CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  ADD COLUMN date_of_birth date;

ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
    CHECK (purpose IN ('register', 'login', 'approve', 'credentials', 'grant', 'password_reset')),
  ADD CONSTRAINT auth_challenges_check
    CHECK (purpose NOT IN ('approve', 'credentials', 'grant') OR target_id IS NOT NULL);

-- +goose Down
DELETE FROM auth_challenges WHERE purpose IN ('grant', 'password_reset');
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
    CHECK (purpose IN ('register', 'login', 'approve', 'credentials')),
  ADD CONSTRAINT auth_challenges_check
    CHECK (purpose NOT IN ('approve', 'credentials') OR target_id IS NOT NULL);

ALTER TABLE users DROP COLUMN date_of_birth, DROP COLUMN mobile;
