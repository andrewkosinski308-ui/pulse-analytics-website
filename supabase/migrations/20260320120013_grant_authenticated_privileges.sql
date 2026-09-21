-- Pulse Analytics: grant table privileges so RLS policies can apply.
-- apply_migration-created tables did not receive default Supabase GRANTs.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO anon;
