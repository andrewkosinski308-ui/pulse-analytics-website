-- Clients share the authenticated role with staff, so row policies cannot hide columns.
-- Readable project columns stay on the table. owner_id and source are readable only
-- through a private staff function. project_members stays staff-only.

REVOKE SELECT ON TABLE public.projects FROM authenticated, anon;

GRANT SELECT (
  id,
  client_id,
  name,
  status,
  starts_on,
  ends_on,
  summary,
  created_at,
  updated_at
) ON TABLE public.projects TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.project_staff_fields()
RETURNS TABLE (id uuid, owner_id uuid, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.owner_id, pr.source
  FROM public.projects pr
  WHERE public.is_admin()
    OR public.is_project_member(pr.id)
    OR public.is_staff_for_client(pr.client_id);
END;
$$;

REVOKE ALL ON FUNCTION private.project_staff_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.project_staff_fields() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.project_staff_fields()
RETURNS TABLE (id uuid, owner_id uuid, source text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT id, owner_id, source FROM private.project_staff_fields();
$$;

REVOKE ALL ON FUNCTION public.project_staff_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_staff_fields() TO authenticated;

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
