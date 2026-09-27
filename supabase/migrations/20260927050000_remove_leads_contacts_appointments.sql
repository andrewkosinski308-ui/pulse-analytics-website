-- Salesforce owns leads, contacts, and appointments.
-- File access no longer has a lead path. The file rules for clients, projects, and reports stay.

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (client_id IS NOT NULL AND public.is_staff_for_client(client_id))
    OR (
      client_id IS NOT NULL
      AND delivery_status IN ('sent', 'received')
      AND public.is_client_member(client_id)
      AND (
        report_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.reports r
          WHERE r.id = report_id
            AND r.client_id = files.client_id
            AND r.status = 'published'
        )
      )
    )
  );

DROP POLICY IF EXISTS files_insert_staff ON public.files;
CREATE POLICY files_insert_staff ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND uploaded_by = auth.uid()
    AND direction = 'staff_to_client'
    AND delivery_status = 'internal'
    AND client_id IS NOT NULL
    AND (public.is_admin() OR public.is_staff_for_client(client_id))
  );

DROP POLICY IF EXISTS files_insert_client ON public.files;
CREATE POLICY files_insert_client ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_client_owner(client_id)
    AND uploaded_by = auth.uid()
    AND direction = 'client_to_staff'
    AND delivery_status = 'received'
    AND report_id IS NULL
    AND project_id IS NULL
  );

ALTER TABLE public.files DROP CONSTRAINT files_has_owner;
ALTER TABLE public.files DROP COLUMN lead_id;
ALTER TABLE public.files
  ADD CONSTRAINT files_has_owner CHECK (
    num_nonnulls(client_id, project_id, report_id) >= 1
  );

DROP TABLE IF EXISTS public.appointment_attendees;
DROP TABLE IF EXISTS public.appointments;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.leads;

DROP FUNCTION IF EXISTS public.is_appointment_attendee(uuid);

DROP TYPE IF EXISTS public.attendance_response;
DROP TYPE IF EXISTS public.attendance_role;
DROP TYPE IF EXISTS public.appointment_type;
DROP TYPE IF EXISTS public.appointment_status;
DROP TYPE IF EXISTS public.lead_status;
