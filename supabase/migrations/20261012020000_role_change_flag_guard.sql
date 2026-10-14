-- Prerequisite: 20261012010000_authorization_remediation_phase1.sql
--
-- pulse.role_change is transaction-local, but any SQL session can set it.
-- The phase 1 trigger already refuses the flag unless the caller is an
-- active administrator changing someone else between employee and client.
-- This migration also repeats the assignment check, so the flag cannot skip
-- the removal rule that admin_set_staff_role enforces.
-- Service-role updates still return before these checks.

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
  staff_still_assigned boolean;
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
  staff_still_assigned := OLD.role = 'employee' AND NEW.role = 'client' AND (
    EXISTS (
      SELECT 1 FROM public.employee_client_assignments a
      WHERE a.employee_id = OLD.id AND a.active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c WHERE c.account_manager_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects pr
      WHERE pr.owner_id = OLD.id
         OR EXISTS (
           SELECT 1 FROM public.project_members pm
           WHERE pm.project_id = pr.id AND pm.profile_id = OLD.id
         )
    )
  );

  IF role_change_requested THEN
    IF current_setting('pulse.role_change', true) IS DISTINCT FROM 'approved'
       OR NOT caller_is_admin
       OR self_update
       OR OLD.role = 'admin'
       OR NEW.role::text NOT IN ('employee', 'client')
       OR staff_still_assigned
    THEN
      IF staff_still_assigned AND caller_is_admin AND NOT self_update
         AND current_setting('pulse.role_change', true) = 'approved'
      THEN
        RAISE EXCEPTION 'Remove this employee from client assignments and project staff before changing them to a client.'
          USING ERRCODE = '42501';
      END IF;
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
