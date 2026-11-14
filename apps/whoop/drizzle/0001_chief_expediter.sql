ALTER TABLE "members" ADD COLUMN "share_policy" jsonb;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "data_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE FUNCTION gallant_record_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE members SET data_revision = data_revision + 1 WHERE id = OLD.member_id;
    RETURN OLD;
  ELSE
    UPDATE members SET data_revision = data_revision + 1 WHERE id = NEW.member_id;
    RETURN NEW;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER records_revision AFTER INSERT OR UPDATE OR DELETE ON records
FOR EACH ROW EXECUTE FUNCTION gallant_record_revision();
