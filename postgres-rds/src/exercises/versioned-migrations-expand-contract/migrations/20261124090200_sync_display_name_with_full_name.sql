-- migrate:up
SET LOCAL lock_timeout = '5s';

-- Dual write: keeps both columns equal while app v1 (writes full_name) and app v2 (writes display_name)
-- run side by side during the rolling deploy.
CREATE FUNCTION people_sync_names() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_name := coalesce(NEW.display_name, NEW.full_name);
    NEW.full_name := coalesce(NEW.full_name, NEW.display_name);
  ELSIF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    NEW.display_name := NEW.full_name;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    NEW.full_name := NEW.display_name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER people_sync_names
BEFORE INSERT OR UPDATE ON people
FOR EACH ROW EXECUTE FUNCTION people_sync_names();

-- migrate:down
SET LOCAL lock_timeout = '5s';
DROP TRIGGER people_sync_names ON people;
DROP FUNCTION people_sync_names();
