-- Client workspace: file delivery, support, billing sync, notification and task hardening.
-- Tenant remains public.clients. Upload is not the same action as Send to Client.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS clients_stripe_customer_id_key
  ON public.clients (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'staff_to_client',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS client_message text,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_client boolean NOT NULL DEFAULT false;

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_direction_check;
ALTER TABLE public.files
  ADD CONSTRAINT files_direction_check
  CHECK (direction IN ('staff_to_client', 'client_to_staff'));

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_delivery_check;
ALTER TABLE public.files
  ADD CONSTRAINT files_delivery_check
  CHECK (delivery_status IN ('internal', 'sent', 'received'));

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_category_check;
ALTER TABLE public.files
  ADD CONSTRAINT files_category_check
  CHECK (
    category IS NULL
    OR category IN (
      'SEO', 'Website', 'Analytics', 'Marketing', 'Social Media', 'Campaigns', 'Contracts', 'Other'
    )
  );

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_name_safe;
ALTER TABLE public.files
  ADD CONSTRAINT files_name_safe
  CHECK (
    char_length(file_name) BETWEEN 1 AND 180
    AND file_name !~ '[\\/]'
    AND file_name !~ '[[:cntrl:]]'
  );

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_mime_allowed;
ALTER TABLE public.files
  ADD CONSTRAINT files_mime_allowed
  CHECK (
    mime_type IS NULL
    OR mime_type IN (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'text/plain',
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-zip-compressed'
    )
  );

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_size_limit;
ALTER TABLE public.files
  ADD CONSTRAINT files_size_limit
  CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 52428800));

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_text_length;
ALTER TABLE public.files
  ADD CONSTRAINT files_text_length
  CHECK (
    (description IS NULL OR char_length(description) <= 2000)
    AND (client_message IS NULL OR char_length(client_message) <= 2000)
  );

CREATE INDEX IF NOT EXISTS files_client_delivery_idx
  ON public.files (client_id, delivery_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.is_client_member(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = p_client_id
      AND cm.profile_id = auth.uid()
      AND p.role = 'client'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_client_owner(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = p_client_id
      AND cm.profile_id = auth.uid()
      AND cm.member_role = 'owner'
      AND p.role = 'client'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(p_client_id uuid)
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
      AND p.is_active = true
  )
  AND (
    public.is_admin()
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
    )
  );
$$;

REVOKE ALL ON FUNCTION public.is_client_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_client_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_client_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_client_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_client_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_owner(uuid) TO authenticated;

-- Clients do not read internal tasks. There is no client-visible task flag.
DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    AND (
      assignee_id = auth.uid()
      OR public.is_admin()
      OR public.is_project_member(project_id)
      OR EXISTS (
        SELECT 1
        FROM public.projects pr
        WHERE pr.id = project_id
          AND public.is_staff_for_client(pr.client_id)
      )
    )
  );

-- Published reports stay client-readable only through membership, not another client's project seat.
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR (
      status = 'published'
      AND public.is_client_member(client_id)
    )
  );

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

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert_staff ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND uploaded_by = auth.uid()
    AND direction = 'staff_to_client'
    AND delivery_status = 'internal'
    AND client_id IS NOT NULL
    AND (public.is_admin() OR public.is_staff_for_client(client_id))
    AND lead_id IS NULL
  );

CREATE POLICY files_insert_client ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_client_owner(client_id)
    AND uploaded_by = auth.uid()
    AND direction = 'client_to_staff'
    AND delivery_status = 'received'
    AND lead_id IS NULL
    AND report_id IS NULL
    AND project_id IS NULL
  );

DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update_staff ON public.files
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(client_id))
  WITH CHECK (public.is_admin() OR public.is_staff_for_client(client_id));

DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete_staff ON public.files
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(client_id));

CREATE POLICY files_delete_own_client_upload ON public.files
  FOR DELETE TO authenticated
  USING (
    public.is_client_owner(client_id)
    AND uploaded_by = auth.uid()
    AND direction = 'client_to_staff'
    AND delivery_status = 'received'
  );

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_staff_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_staff()
      AND EXISTS (
        SELECT 1
        FROM public.client_members cm
        WHERE cm.profile_id = recipient_id
          AND public.is_staff_for_client(cm.client_id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.record_own_security_event(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  title text;
  body text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_kind = 'password_changed' THEN
    title := 'Password updated';
    body := 'Your Client Portal password was changed.';
  ELSIF p_kind = 'profile_updated' THEN
    title := 'Profile updated';
    body := 'Your name or phone number was updated.';
  ELSE
    RAISE EXCEPTION 'Unsupported security event';
  END IF;

  INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
  VALUES (auth.uid(), title, body, 'system', 'client-portal.html#account', 'account', auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.record_own_security_event(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_own_security_event(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_own_security_event(text) TO authenticated;

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
      'info',
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
      'info',
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

DROP TRIGGER IF EXISTS files_side_effects ON public.files;
CREATE TRIGGER files_side_effects
  AFTER INSERT OR UPDATE ON public.files
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_file_side_effects();

REVOKE ALL ON FUNCTION public.handle_file_side_effects() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_file_side_effects() FROM anon;
REVOKE ALL ON FUNCTION public.handle_file_side_effects() FROM authenticated;

CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT support_requests_subject_len CHECK (char_length(subject) BETWEEN 1 AND 200),
  CONSTRAINT support_requests_status_check CHECK (status IN ('open', 'waiting_on_client', 'resolved'))
);

CREATE INDEX IF NOT EXISTS support_requests_client_idx
  ON public.support_requests (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.support_requests (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT support_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS support_messages_request_idx
  ON public.support_messages (request_id, created_at);

DROP TRIGGER IF EXISTS support_requests_set_updated_at ON public.support_requests;
CREATE TRIGGER support_requests_set_updated_at
  BEFORE UPDATE ON public.support_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_requests_select ON public.support_requests;
CREATE POLICY support_requests_select ON public.support_requests
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(client_id) OR public.is_client_member(client_id));

DROP POLICY IF EXISTS support_requests_insert ON public.support_requests;
CREATE POLICY support_requests_insert ON public.support_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_client_owner(client_id)
    AND created_by = auth.uid()
    AND status = 'open'
  );

DROP POLICY IF EXISTS support_requests_update ON public.support_requests;
CREATE POLICY support_requests_update ON public.support_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(client_id))
  WITH CHECK (public.is_admin() OR public.is_staff_for_client(client_id));

DROP POLICY IF EXISTS support_messages_select ON public.support_messages;
CREATE POLICY support_messages_select ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.support_requests r
      WHERE r.id = request_id
        AND (
          public.is_admin()
          OR public.is_staff_for_client(r.client_id)
          OR public.is_client_member(r.client_id)
        )
    )
  );

DROP POLICY IF EXISTS support_messages_insert ON public.support_messages;
CREATE POLICY support_messages_insert ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.support_requests r
      WHERE r.id = request_id
        AND (
          public.is_client_owner(r.client_id)
          OR public.is_admin()
          OR public.is_staff_for_client(r.client_id)
        )
    )
  );

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
    SELECT DISTINCT p.id, 'Support request', req.subject, 'info', 'staff-workspace.html#support', 'support', req.id
    FROM public.profiles p
    WHERE p.is_active = true
      AND p.role IN ('admin', 'employee')
      AND (
        p.id = (SELECT c.account_manager_id FROM public.clients c WHERE c.id = req.client_id)
        OR p.role = 'admin'
      );
  ELSE
    INSERT INTO public.notifications (recipient_id, title, body, type, link_path, entity_type, entity_id)
    SELECT cm.profile_id, 'Support reply', req.subject, 'info', 'client-portal.html#support', 'support', req.id
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = req.client_id
      AND p.is_active = true
      AND p.role = 'client';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_messages_notify ON public.support_messages;
CREATE TRIGGER support_messages_notify
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_support_message();

REVOKE ALL ON FUNCTION public.handle_support_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_support_message() FROM anon;
REVOKE ALL ON FUNCTION public.handle_support_message() FROM authenticated;

CREATE TABLE IF NOT EXISTS public.client_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  status text NOT NULL,
  product_name text,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT client_subscriptions_stripe_id_key UNIQUE (stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS client_subscriptions_client_idx
  ON public.client_subscriptions (client_id);

CREATE TABLE IF NOT EXISTS public.client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL,
  status text,
  amount_due integer,
  amount_paid integer,
  currency text,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT client_invoices_stripe_id_key UNIQUE (stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS client_invoices_client_idx
  ON public.client_invoices (client_id, created_at DESC);

ALTER TABLE public.client_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_subscriptions_select ON public.client_subscriptions;
CREATE POLICY client_subscriptions_select ON public.client_subscriptions
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_staff_for_client(client_id)
    OR public.is_client_member(client_id)
  );

DROP POLICY IF EXISTS client_invoices_select ON public.client_invoices;
CREATE POLICY client_invoices_select ON public.client_invoices
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_staff_for_client(client_id)
    OR public.is_client_member(client_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT SELECT ON public.client_subscriptions TO authenticated;
GRANT SELECT ON public.client_invoices TO authenticated;
REVOKE ALL ON public.support_requests FROM anon;
REVOKE ALL ON public.support_messages FROM anon;
REVOKE ALL ON public.client_subscriptions FROM anon;
REVOKE ALL ON public.client_invoices FROM anon;

-- Table-level SELECT includes every column, so a column REVOKE does not hide notes.
-- Grant the readable columns instead. The dashboard role can still read notes.
REVOKE SELECT ON TABLE public.clients FROM authenticated;
GRANT SELECT (
  id, name, legal_name, website, industry, status, account_manager_id,
  billing_email, created_at, updated_at, stripe_customer_id
) ON TABLE public.clients TO authenticated;

REVOKE SELECT ON TABLE public.appointments FROM authenticated;
GRANT SELECT (
  id, title, appointment_type, status, starts_at, ends_at, timezone,
  location_or_url, host_id, client_id, lead_id, created_at, updated_at
) ON TABLE public.appointments TO authenticated;

REVOKE SELECT (notes) ON public.clients FROM anon;
REVOKE SELECT (notes) ON public.appointments FROM anon;

DROP POLICY IF EXISTS storage_client_files_select ON storage.objects;
DROP POLICY IF EXISTS storage_client_files_insert ON storage.objects;
DROP POLICY IF EXISTS storage_client_files_update ON storage.objects;
DROP POLICY IF EXISTS storage_client_files_delete ON storage.objects;

CREATE POLICY storage_client_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_admin()
      OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid)
      OR (
        (storage.foldername(name))[2] = 'shared'
        AND public.is_client_member(((storage.foldername(name))[1])::uuid)
        AND EXISTS (
          SELECT 1
          FROM public.files f
          WHERE f.bucket = 'client-files'
            AND f.storage_path = name
            AND f.client_id = ((storage.foldername(name))[1])::uuid
            AND f.delivery_status IN ('sent', 'received')
        )
      )
    )
  );

CREATE POLICY storage_client_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (storage.foldername(name))[2] IN ('internal', 'shared')
    AND (
      (
        (storage.foldername(name))[2] = 'internal'
        AND (public.is_admin() OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid))
      )
      OR (
        (storage.foldername(name))[2] = 'shared'
        AND (
          public.is_admin()
          OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid)
          OR (
            public.is_client_owner(((storage.foldername(name))[1])::uuid)
            AND EXISTS (
              SELECT 1
              FROM public.files f
              WHERE f.bucket = 'client-files'
                AND f.storage_path = name
                AND f.client_id = ((storage.foldername(name))[1])::uuid
                AND f.uploaded_by = auth.uid()
                AND f.direction = 'client_to_staff'
                AND f.delivery_status = 'received'
            )
          )
        )
      )
    )
  );

CREATE POLICY storage_client_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (public.is_admin() OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid))
  )
  WITH CHECK (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (public.is_admin() OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid))
  );

CREATE POLICY storage_client_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.is_admin()
      OR public.is_staff_for_client(((storage.foldername(name))[1])::uuid)
      OR (
        (storage.foldername(name))[2] = 'shared'
        AND public.is_client_owner(((storage.foldername(name))[1])::uuid)
        AND EXISTS (
          SELECT 1
          FROM public.files f
          WHERE f.storage_path = name
            AND f.uploaded_by = auth.uid()
            AND f.direction = 'client_to_staff'
        )
      )
    )
  );

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed'
  ]
WHERE id = 'client-files';

-- Clients may update their own name and phone. Role, active flag, and email stay staff-controlled.
CREATE OR REPLACE FUNCTION public.protect_profile_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Those account fields cannot be changed here';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_security_columns ON public.profiles;
CREATE TRIGGER profiles_protect_security_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_security_columns();

REVOKE ALL ON FUNCTION public.protect_profile_security_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_security_columns() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_security_columns() FROM authenticated;

-- Recipients may mark a notification read. They cannot rewrite its contents.
CREATE OR REPLACE FUNCTION public.protect_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.link_path IS DISTINCT FROM OLD.link_path
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Only read state can be updated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_protect_update ON public.notifications;
CREATE TRIGGER notifications_protect_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_notification_update();

REVOKE ALL ON FUNCTION public.protect_notification_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_notification_update() FROM anon;
REVOKE ALL ON FUNCTION public.protect_notification_update() FROM authenticated;

-- Attendee checks must not re-enter appointment RLS. The two policies reference each other.
CREATE OR REPLACE FUNCTION public.is_appointment_attendee(p_appointment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.appointment_attendees aa
    WHERE aa.appointment_id = p_appointment_id
      AND aa.profile_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_appointment_attendee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_appointment_attendee(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_appointment_attendee(uuid) TO authenticated;

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
    OR public.is_appointment_attendee(id)
  );
