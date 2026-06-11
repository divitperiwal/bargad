-- +goose Up
-- +goose StatementBegin
CREATE FUNCTION notify_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(TG_TABLE_NAME, NEW.id::text);
  RETURN NULL;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION reject_change();
DROP FUNCTION notify_change();
