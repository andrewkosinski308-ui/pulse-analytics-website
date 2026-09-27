-- A SELECT list types a bare string as text. notifications.type is an enum,
-- so the file trigger aborted client uploads and client notifications.

CREATE OR REPLACE FUNCTION public.handle_file_side_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'file_upload' ELSE 'file_update' END,
    'files',
    NEW.id,
    jsonb_build_object(
      'client_id', NEW.client_id,
      'direction', NEW.direction,
      'delivery_status', NEW.delivery_status,
      'previous_delivery_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.delivery_status ELSE NULL END
    )
  );

  IF TG_OP = 'INSERT' AND NEW.direction = 'client_to_staff' THEN
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT DISTINCT p.id,
      'Client file received',
      COALESCE(NEW.file_name, 'A file') || ' was uploaded by the client.',
      'info'::public.notification_type,
      'staff-workspace.html#files',
      'file',
      NEW.id
    FROM public.profiles p
    WHERE p.is_active = true
      AND p.role IN ('admin', 'employee')
      AND (
        p.id = (SELECT c.account_manager_id FROM public.clients c WHERE c.id = NEW.client_id)
        OR EXISTS (
          SELECT 1
          FROM public.projects pr
          WHERE pr.client_id = NEW.client_id
            AND (
              pr.owner_id = p.id
              OR EXISTS (
                SELECT 1 FROM public.project_members pm
                WHERE pm.project_id = pr.id AND pm.profile_id = p.id
              )
            )
        )
        OR (
          p.role = 'admin'
          AND (SELECT c.account_manager_id FROM public.clients c WHERE c.id = NEW.client_id) IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.client_id = NEW.client_id)
        )
      );
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.delivery_status = 'sent'
     AND OLD.delivery_status IS DISTINCT FROM 'sent'
     AND NEW.notify_client = true
  THEN
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT cm.profile_id,
      'New file from Pulse Analytics',
      COALESCE(NEW.client_message, NEW.file_name, 'A file is ready to download.'),
      'info'::public.notification_type,
      'client-portal.html#files',
      'file',
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
