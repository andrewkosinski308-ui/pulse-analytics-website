-- Member visibility is decided inside a definer function so the policy does not
-- require table-level SELECT on projects. Clients are not staff, so they get no rows.

CREATE OR REPLACE FUNCTION private.staff_can_read_project_members(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_staff()
    AND (
      public.is_admin()
      OR public.is_project_member(p_project_id)
      OR EXISTS (
        SELECT 1
        FROM public.projects pr
        WHERE pr.id = p_project_id
          AND public.is_staff_for_client(pr.client_id)
      )
    );
$$;

REVOKE ALL ON FUNCTION private.staff_can_read_project_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.staff_can_read_project_members(uuid) TO authenticated;

DROP POLICY IF EXISTS project_members_select ON public.project_members;

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO authenticated
  USING (private.staff_can_read_project_members(project_id));
