-- Authorization remediation phase 1.
-- Does not rewrite earlier migrations. Authenticated table grants stay in place;
-- these policies and triggers are the write gate for browser sessions.
--
-- Signup still creates a client from handle_new_user, which is security definer
-- and bypasses RLS. Stripe project creation runs as service_role through
-- create_project_from_stripe_checkout and also bypasses RLS. Neither path is an
-- employee session. employee_client_assignments remains insert-revoked for
-- authenticated users from 20261001030000_profile_authorization.sql.

-- Client rows and account-manager assignment stay administrator-controlled.
DROP POLICY IF EXISTS clients_insert ON public.clients;
CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- A project insert is visible to is_staff_for_client only after it commits.
-- Requiring that check here means the caller already has an assignment,
-- project seat, or account-manager relationship. Setting owner_id to the
-- caller is rejected so the new row cannot become that relationship.
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_staff()
      AND public.is_staff_for_client(client_id)
      AND owner_id IS DISTINCT FROM auth.uid()
    )
  );

-- Moving a project uses the new client_id. is_staff_for_client reads the
-- stored row, so membership on the project being moved does not count as
-- access to the destination client. Administrators are unchanged.
DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_project_member(id)
    OR public.is_staff_for_client(client_id)
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_staff_for_client(client_id)
  );

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
    IF NOT public.is_staff() OR NOT public.is_staff_for_client(NEW.client_id) OR NEW.owner_id = auth.uid() THEN
      RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
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

DROP TRIGGER IF EXISTS projects_guard_staff_grant ON public.projects;
CREATE TRIGGER projects_guard_staff_grant
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_project_staff_grant();

-- Direct profile updates cannot change role. admin_set_staff_role sets a
-- transaction-local flag before its update. The flag still cannot create an
-- administrator. Service-role invitation updates are not authenticated
-- sessions, so they keep the existing employee provisioning path.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean;
  self_update boolean;
  auth_email text;
  role_change_requested boolean;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
  ) INTO caller_is_admin;

  self_update := NEW.id = auth.uid();
  role_change_requested := NEW.role IS DISTINCT FROM OLD.role;

  IF role_change_requested THEN
    IF current_setting('pulse.role_change', true) IS DISTINCT FROM 'approved'
       OR NOT caller_is_admin
       OR self_update
       OR OLD.role = 'admin'
       OR NEW.role::text NOT IN ('employee', 'client')
    THEN
      RAISE EXCEPTION 'Those account fields cannot be changed here' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF self_update OR NOT caller_is_admin OR OLD.role = 'admin' THEN
    NEW.is_active := OLD.is_active;
    NEW.job_title := OLD.job_title;
    NEW.department := OLD.department;
    NEW.started_on := OLD.started_on;
    NEW.ended_on := OLD.ended_on;
  END IF;

  SELECT email INTO auth_email FROM auth.users WHERE id = NEW.id;
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS DISTINCT FROM auth_email THEN
    NEW.email := OLD.email;
  END IF;

  IF caller_is_admin AND NOT self_update AND OLD.role <> 'admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        auth.uid(),
        'ADMIN_CHANGED_EMPLOYEE_ROLE',
        'profiles',
        NEW.id,
        jsonb_build_object('from', OLD.role, 'to', NEW.role)
      );
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        auth.uid(),
        'ADMIN_CHANGED_EMPLOYEE_STATUS',
        'profiles',
        NEW.id,
        jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_profile_role_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'admin' THEN
    RAISE EXCEPTION 'Those account fields cannot be changed here' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_profile_role_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_role_insert ON public.profiles;
CREATE TRIGGER profiles_guard_role_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_profile_role_insert();

CREATE OR REPLACE FUNCTION public.admin_set_staff_role(p_profile_id uuid, p_role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_role public.app_role;
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

  SELECT role INTO current_role
  FROM public.profiles
  WHERE id = p_profile_id
    AND role IN ('employee', 'client');

  IF current_role IS NULL THEN
    RAISE EXCEPTION 'Choose an employee or client account.' USING ERRCODE = '22023';
  END IF;

  IF current_role = 'employee' AND p_role = 'client' AND (
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
    AND role = current_role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) TO authenticated;

-- Catalog reads stay available to staff. Writes are administrator-only.
DROP POLICY IF EXISTS services_staff_write ON public.services;
CREATE POLICY services_admin_write ON public.services
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
