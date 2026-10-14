-- Prerequisite: 20261012010000_authorization_remediation_phase1.sql
--
-- Authenticated project creation is administrator-only. The earlier insert
-- policy allowed an employee who already served a client to add a project.
-- That exception is removed. Updates, membership, and delivery policies are
-- unchanged. Service-role Stripe provisioning is not an authenticated session,
-- so the trigger still lets create_project_from_stripe_checkout insert.

DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION private.guard_project_staff_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;

  IF NEW.client_id IS DISTINCT FROM OLD.client_id AND NOT public.is_staff_for_client(NEW.client_id) THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_project_staff_grant() FROM PUBLIC, anon, authenticated;
