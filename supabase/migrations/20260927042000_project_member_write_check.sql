-- The member write policy also applies to SELECT and reads projects.owner_id.
-- Column privileges then reject the query for every authenticated user.
-- Keep the same write rule, and read owner_id inside a definer function.

CREATE OR REPLACE FUNCTION private.staff_can_write_project_members(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_staff()
    AND EXISTS (
      SELECT 1
      FROM public.projects pr
      WHERE pr.id = p_project_id
        AND (
          public.is_admin()
          OR public.is_staff_for_client(pr.client_id)
          OR pr.owner_id = auth.uid()
        )
    );
$$;

REVOKE ALL ON FUNCTION private.staff_can_write_project_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.staff_can_write_project_members(uuid) TO authenticated;

DROP POLICY IF EXISTS project_members_staff_write ON public.project_members;

CREATE POLICY project_members_staff_write ON public.project_members
  FOR ALL TO authenticated
  USING (private.staff_can_write_project_members(project_id))
  WITH CHECK (private.staff_can_write_project_members(project_id));
