-- Pulse Analytics: post-deploy security hardening (mirrors live project)
-- Revoke RPC on trigger-only SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM authenticated;

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

DROP POLICY IF EXISTS storage_client_files_select ON storage.objects;
CREATE POLICY storage_client_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_admin()
      OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid)
      OR public.can_access_client(((storage.foldername(name))[1])::uuid)
    )
  );

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (client_id IS NOT NULL AND public.is_staff_for_client(client_id))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
    OR (
      project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.id = project_id
          AND (
            public.is_project_member(pr.id)
            OR public.is_staff_for_client(pr.client_id)
            OR public.can_access_client(pr.client_id)
          )
      )
    )
    OR (
      lead_id IS NOT NULL AND public.is_staff()
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_id
          AND (public.is_admin() OR l.assigned_to = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS appointments_select ON public.appointments;
CREATE POLICY appointments_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR host_id = auth.uid()
    OR (client_id IS NOT NULL AND public.is_staff_for_client(client_id))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
    OR (
      lead_id IS NOT NULL AND public.is_staff()
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_id AND (l.assigned_to = auth.uid() OR public.is_admin())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.appointment_attendees aa
      WHERE aa.appointment_id = id AND aa.profile_id = auth.uid()
    )
  );
