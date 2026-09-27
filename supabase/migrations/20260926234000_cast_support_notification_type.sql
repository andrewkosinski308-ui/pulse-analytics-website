-- A SELECT list types a bare string as text. notifications.type is an enum,
-- so the support trigger aborted the message insert after the request row was saved.

CREATE OR REPLACE FUNCTION public.handle_support_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.support_requests%ROWTYPE;
  author_role public.app_role;
BEGIN
  SELECT * INTO req FROM public.support_requests WHERE id = NEW.request_id;
  SELECT role INTO author_role FROM public.profiles WHERE id = NEW.author_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.author_id,
    'support_message',
    'support_requests',
    req.id,
    jsonb_build_object('client_id', req.client_id)
  );

  IF author_role = 'client' THEN
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT DISTINCT p.id,
      'Support request',
      req.subject,
      'info'::public.notification_type,
      'staff-workspace.html#support',
      'support',
      req.id
    FROM public.profiles p
    WHERE p.is_active = true
      AND p.role IN ('admin', 'employee')
      AND (
        p.id = (SELECT c.account_manager_id FROM public.clients c WHERE c.id = req.client_id)
        OR p.role = 'admin'
      );
  ELSE
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT cm.profile_id,
      'Support reply',
      req.subject,
      'info'::public.notification_type,
      'client-portal.html#support',
      'support',
      req.id
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = req.client_id
      AND p.is_active = true
      AND p.role = 'client';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_support_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_support_message() FROM anon;
REVOKE ALL ON FUNCTION public.handle_support_message() FROM authenticated;
