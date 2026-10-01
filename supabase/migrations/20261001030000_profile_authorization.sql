-- Profile and authorization foundation.
-- Reuses profiles.role, profiles.is_active, client_members, and is_staff_for_client.
-- Portal access is role plus is_active. There is no second role table and no password storage.
-- Assignment adds a direct employee-to-client grant. Account manager and project membership stay in force.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS started_on date;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_notification_preferences_object;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_notification_preferences_object
  CHECK (jsonb_typeof(notification_preferences) = 'object');

COMMENT ON COLUMN public.profiles.full_name IS 'Display name. first_name and last_name are optional parts.';
COMMENT ON COLUMN public.profiles.role IS 'Portal role. Not self-service. admin, employee, or client.';
COMMENT ON COLUMN public.profiles.is_active IS 'Account status. Not self-service. Inactive profiles lose portal and staff access.';

CREATE TABLE IF NOT EXISTS public.employee_client_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  assignment_type text NOT NULL DEFAULT 'staff',
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  assigned_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT employee_client_assignments_unique UNIQUE (employee_id, client_id),
  CONSTRAINT employee_client_assignments_type_chk CHECK (assignment_type = 'staff')
);

CREATE INDEX IF NOT EXISTS employee_client_assignments_employee_idx
  ON public.employee_client_assignments (employee_id, active);

CREATE INDEX IF NOT EXISTS employee_client_assignments_client_idx
  ON public.employee_client_assignments (client_id, active);

DROP TRIGGER IF EXISTS employee_client_assignments_set_updated_at ON public.employee_client_assignments;
CREATE TRIGGER employee_client_assignments_set_updated_at
  BEFORE UPDATE ON public.employee_client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_client_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_client_assignments_select ON public.employee_client_assignments;
CREATE POLICY employee_client_assignments_select ON public.employee_client_assignments
  FOR SELECT TO authenticated
  USING (public.is_admin() OR employee_id = auth.uid());

REVOKE ALL ON public.employee_client_assignments FROM PUBLIC, anon;
GRANT SELECT ON public.employee_client_assignments TO authenticated;

-- Authenticated sessions cannot write assignments directly. Admin functions do.
REVOKE INSERT, UPDATE, DELETE ON public.employee_client_assignments FROM authenticated;

CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_employee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'employee'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_client()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'client'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_client_for_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_client_member(p_client_id);
$$;

CREATE OR REPLACE FUNCTION public.is_staff_for_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR (
      public.is_staff()
      AND (
        EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = p_client_id AND c.account_manager_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.projects pr
          WHERE pr.client_id = p_client_id
            AND (
              pr.owner_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.project_members pm
                WHERE pm.project_id = pr.id AND pm.profile_id = auth.uid()
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.employee_client_assignments a
          JOIN public.profiles ep ON ep.id = a.employee_id
          WHERE a.client_id = p_client_id
            AND a.employee_id = auth.uid()
            AND a.active = true
            AND ep.role = 'employee'
            AND ep.is_active = true
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
  )
  AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = p_client_id AND c.account_manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.client_members cm
      WHERE cm.client_id = p_client_id AND cm.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects pr
      WHERE pr.client_id = p_client_id
        AND (
          pr.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = pr.id AND pm.profile_id = auth.uid()
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.employee_client_assignments a
      JOIN public.profiles ep ON ep.id = a.employee_id
      WHERE a.client_id = p_client_id
        AND a.employee_id = auth.uid()
        AND a.active = true
        AND ep.role = 'employee'
        AND ep.is_active = true
    )
  );
$$;

REVOKE ALL ON FUNCTION public.is_authenticated() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_employee() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_client() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_client_for_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authenticated() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_employee() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_for_client(uuid) TO authenticated;

-- Authenticated users cannot change their own role or account status.
-- An administrator can change an employee or client, not their own row and not another administrator.
-- Service role and table owners are not blocked, so operations outside the browser still work.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean;
  self_update boolean;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
  ) INTO caller_is_admin;

  self_update := NEW.id = auth.uid();

  IF self_update OR NOT caller_is_admin OR OLD.role = 'admin' THEN
    NEW.role := OLD.role;
    NEW.is_active := OLD.is_active;
    NEW.job_title := OLD.job_title;
    NEW.department := OLD.department;
    NEW.started_on := OLD.started_on;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email AND NOT caller_is_admin THEN
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

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- Owners may edit their business profile. Server-owned columns are restored below.
DROP POLICY IF EXISTS clients_update ON public.clients;
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_staff_for_client(id)
    OR public.is_client_owner(id)
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_staff_for_client(id)
    OR public.is_client_owner(id)
  );

CREATE OR REPLACE FUNCTION private.guard_client_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() OR public.is_staff_for_client(OLD.id) THEN
    RETURN NEW;
  END IF;
  NEW.status := OLD.status;
  NEW.account_manager_id := OLD.account_manager_id;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.onboarding_step := OLD.onboarding_step;
  NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  NEW.billing_email := OLD.billing_email;
  NEW.notes := OLD.notes;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_client_owner_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_guard_owner_fields ON public.clients;
CREATE TRIGGER clients_guard_owner_fields
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_client_owner_fields();

-- Reports follow the same client boundary as files. Any employee is not enough.
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_staff() AND public.is_staff_for_client(client_id))
    OR (
      status = 'published'
      AND public.is_client_member(client_id)
    )
  );

DROP POLICY IF EXISTS reports_staff_write ON public.reports;
CREATE POLICY reports_staff_write ON public.reports
  FOR ALL TO authenticated
  USING (public.is_admin() OR (public.is_staff() AND public.is_staff_for_client(client_id)))
  WITH CHECK (public.is_admin() OR (public.is_staff() AND public.is_staff_for_client(client_id)));

-- Employees do not receive billing visibility with the staff role.
DROP POLICY IF EXISTS client_subscriptions_select ON public.client_subscriptions;
CREATE POLICY client_subscriptions_select ON public.client_subscriptions
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_client_member(client_id));

DROP POLICY IF EXISTS client_invoices_select ON public.client_invoices;
CREATE POLICY client_invoices_select ON public.client_invoices
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_client_member(client_id));

DROP POLICY IF EXISTS audit_logs_staff_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_staff_select ON public.audit_logs;
CREATE POLICY audit_logs_admin_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_assign_employee_client(p_employee_id uuid, p_client_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assignment_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id = auth.uid() THEN
    RAISE EXCEPTION 'An administrator cannot assign their own profile.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_employee_id AND p.role = 'employee' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Choose an active employee.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_client_assignments (employee_id, client_id, assigned_by, active)
  VALUES (p_employee_id, p_client_id, auth.uid(), true)
  ON CONFLICT (employee_id, client_id)
  DO UPDATE SET active = true, assigned_by = auth.uid(), assigned_at = timezone('utc', now())
  RETURNING id INTO assignment_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'ADMIN_ASSIGNED_EMPLOYEE_TO_CLIENT',
    'employee_client_assignments',
    assignment_id,
    jsonb_build_object('employee_id', p_employee_id, 'client_id', p_client_id)
  );

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unassign_employee_client(p_employee_id uuid, p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assignment_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.employee_client_assignments
  SET active = false
  WHERE employee_id = p_employee_id
    AND client_id = p_client_id
    AND active = true
  RETURNING id INTO assignment_id;

  IF assignment_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'ADMIN_REMOVED_EMPLOYEE_FROM_CLIENT',
    'employee_client_assignments',
    assignment_id,
    jsonb_build_object('employee_id', p_employee_id, 'client_id', p_client_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_employee_active(p_profile_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'An administrator cannot change their own account status.' USING ERRCODE = '42501';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Choose an account status.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET is_active = p_active
  WHERE id = p_profile_id
    AND role = 'employee';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an employee account.' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_role(p_profile_id uuid, p_role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_profile_id
    AND role IN ('employee', 'client');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an employee or client account.' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_employee_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unassign_employee_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_employee_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_employee_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unassign_employee_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) TO authenticated;
