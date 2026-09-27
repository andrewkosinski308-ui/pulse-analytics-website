-- Report documents stay invisible to the client until the parent report is published.
-- Publishing notifies client members through the existing notifications table.

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
    OR (
      lead_id IS NOT NULL
      AND public.is_staff()
      AND EXISTS (
        SELECT 1
        FROM public.leads l
        WHERE l.id = lead_id
          AND (public.is_admin() OR l.assigned_to = auth.uid())
      )
    )
  );

CREATE OR REPLACE FUNCTION public.handle_report_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT cm.profile_id,
      'New report from Pulse Analytics',
      NEW.title,
      'info'::public.notification_type,
      'client-portal.html#reports',
      'report',
      NEW.id
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = NEW.client_id
      AND p.is_active = true
      AND p.role = 'client';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_publication_notify ON public.reports;
CREATE TRIGGER reports_publication_notify
  AFTER UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_report_publication();

REVOKE ALL ON FUNCTION public.handle_report_publication() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_report_publication() FROM anon;
REVOKE ALL ON FUNCTION public.handle_report_publication() FROM authenticated;
