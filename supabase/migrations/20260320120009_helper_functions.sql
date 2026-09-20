-- Pulse Analytics: RLS helper functions (after all tables exist)
CREATE OR REPLACE FUNCTION public.is_admin()
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
      AND p.role = 'admin'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
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
      AND p.role IN ('admin', 'employee')
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cm.client_id
  FROM public.client_members cm
  WHERE cm.profile_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = p_project_id AND pr.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = p_project_id AND pm.profile_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
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
    );
$$;

-- Staff write helper for assigned client (excludes pure client-portal membership)
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
      )
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
REVOKE ALL ON FUNCTION public.user_client_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_client_ids() FROM anon;
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_staff_for_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff_for_client(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_client_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_for_client(uuid) TO authenticated;

-- Trigger-only functions must not be callable via PostgREST RPC
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM authenticated;
