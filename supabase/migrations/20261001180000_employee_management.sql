-- Administrator employee directory and a safer employee-to-client role change.
-- Invitation state is read from Supabase Auth. The application does not store passwords.

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

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_profile_id
    AND role = current_role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_employee_list(p_query text DEFAULT '', p_filter text DEFAULT 'employees')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  filter_key text := lower(btrim(coalesce(p_filter, 'employees')));
  needle text := btrim(coalesce(p_query, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF filter_key NOT IN ('all', 'active', 'inactive', 'employees', 'clients') THEN
    RAISE EXCEPTION 'Choose an employee filter.' USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(directory)::jsonb ORDER BY directory.sort_name)
    FROM (
      SELECT
        p.id,
        p.full_name,
        p.first_name,
        p.last_name,
        p.email,
        p.phone,
        p.avatar_url,
        p.job_title,
        p.department,
        p.started_on,
        p.role,
        p.is_active,
        lower(coalesce(p.full_name, p.email, '')) AS sort_name,
        (
          SELECT count(*)::integer
          FROM public.employee_client_assignments a
          WHERE a.employee_id = p.id AND a.active = true
        ) AS assignment_count,
        (p.role = 'employee' AND p.is_active) AS portal_access,
        CASE
          WHEN p.is_active IS NOT TRUE THEN 'inactive'
          WHEN p.role = 'client' THEN 'client'
          WHEN u.last_sign_in_at IS NULL THEN 'invited'
          ELSE 'active'
        END AS account_state
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.id
      WHERE p.role IN ('employee', 'client')
        AND (
          filter_key = 'all'
          OR (filter_key = 'employees' AND p.role = 'employee')
          OR (filter_key = 'clients' AND p.role = 'client')
          OR (filter_key = 'active' AND p.role = 'employee' AND p.is_active)
          OR (filter_key = 'inactive' AND p.role = 'employee' AND p.is_active IS NOT TRUE)
        )
        AND (
          needle = ''
          OR p.email ILIKE '%' || needle || '%'
          OR coalesce(p.full_name, '') ILIKE '%' || needle || '%'
          OR coalesce(p.first_name, '') ILIKE '%' || needle || '%'
          OR coalesce(p.last_name, '') ILIKE '%' || needle || '%'
          OR coalesce(p.job_title, '') ILIKE '%' || needle || '%'
          OR coalesce(p.department, '') ILIKE '%' || needle || '%'
        )
    ) directory
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_employee_detail(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Choose an employee account.' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'email', p.email,
    'phone', p.phone,
    'avatar_url', p.avatar_url,
    'job_title', p.job_title,
    'department', p.department,
    'started_on', p.started_on,
    'role', p.role,
    'is_active', p.is_active,
    'portal_access', (p.role = 'employee' AND p.is_active),
    'account_state', CASE
      WHEN p.is_active IS NOT TRUE THEN 'inactive'
      WHEN p.role = 'client' THEN 'client'
      WHEN u.last_sign_in_at IS NULL THEN 'invited'
      ELSE 'active'
    END,
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'client_id', a.client_id,
        'client_name', c.name,
        'assignment_type', a.assignment_type,
        'active', a.active,
        'assigned_at', a.assigned_at
      ) ORDER BY c.name)
      FROM public.employee_client_assignments a
      JOIN public.clients c ON c.id = a.client_id
      WHERE a.employee_id = p.id AND a.active = true
    ), '[]'::jsonb),
    'blockers', jsonb_build_object(
      'assignments', (
        SELECT count(*) FROM public.employee_client_assignments a
        WHERE a.employee_id = p.id AND a.active = true
      ),
      'account_manager', (
        SELECT count(*) FROM public.clients c WHERE c.account_manager_id = p.id
      ),
      'projects', (
        SELECT count(*) FROM public.projects pr
        WHERE pr.owner_id = p.id
           OR EXISTS (
             SELECT 1 FROM public.project_members pm
             WHERE pm.project_id = pr.id AND pm.profile_id = p.id
           )
      )
    ),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'action', log.action,
        'created_at', log.created_at,
        'metadata', log.metadata
      ) ORDER BY log.created_at DESC)
      FROM (
        SELECT action, created_at, metadata
        FROM public.audit_logs
        WHERE entity_id = p.id
           OR metadata ->> 'employee_id' = p.id::text
        ORDER BY created_at DESC
        LIMIT 20
      ) log
    ), '[]'::jsonb)
  )
  INTO result
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_profile_id
    AND p.role IN ('employee', 'client');

  IF result IS NULL THEN
    RAISE EXCEPTION 'That employee account was not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_employee_list(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_employee_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_employee_list(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_employee_detail(uuid) TO authenticated;
