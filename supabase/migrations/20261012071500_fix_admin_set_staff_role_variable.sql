-- Prerequisite: 20261012010000_authorization_remediation_phase1.sql
--
-- The phase 1 function stored the target account's role in a variable named
-- current_role. That name is also the SQL keyword CURRENT_ROLE, whose type is
-- name. The UPDATE therefore compared profiles.role (app_role) with name.
-- Rename the variable so both sides of the comparison are app_role.

CREATE OR REPLACE FUNCTION public.admin_set_staff_role(p_profile_id uuid, p_role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role public.app_role;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'An administrator cannot change their own role.' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('employee', 'client') THEN
    RAISE EXCEPTION 'Choose the employee or client role.' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO existing_role
  FROM public.profiles
  WHERE id = p_profile_id
    AND role IN ('employee', 'client');

  IF existing_role IS NULL THEN
    RAISE EXCEPTION 'Choose an employee or client account.' USING ERRCODE = '22023';
  END IF;

  IF existing_role = 'employee' AND p_role = 'client' AND (
    EXISTS (
      SELECT 1 FROM public.employee_client_assignments a
      WHERE a.employee_id = p_profile_id AND a.active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c WHERE c.account_manager_id = p_profile_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects pr
      WHERE pr.owner_id = p_profile_id
         OR EXISTS (
           SELECT 1 FROM public.project_members pm
           WHERE pm.project_id = pr.id AND pm.profile_id = p_profile_id
         )
    )
  ) THEN
    RAISE EXCEPTION 'Remove this employee from client assignments and project staff before changing them to a client.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('pulse.role_change', 'approved', true);

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_profile_id
    AND role = existing_role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) TO authenticated;
