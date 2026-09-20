-- Pulse Analytics: private storage bucket + storage RLS
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-files',
  'client-files',
  false,
  52428800,
  NULL
)
ON CONFLICT (id) DO UPDATE
SET public = false;

-- Path convention: client-files/{client_id}/...
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

CREATE POLICY storage_client_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-files'
    AND public.is_staff()
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_admin()
      OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid)
      OR public.can_access_client(((storage.foldername(name))[1])::uuid)
    )
  );

CREATE POLICY storage_client_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND public.is_staff()
  )
  WITH CHECK (
    bucket_id = 'client-files'
    AND public.is_staff()
  );

CREATE POLICY storage_client_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (public.is_admin() OR public.is_staff())
  );
