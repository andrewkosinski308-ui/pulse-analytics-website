-- Client self-service profile, business, interests, and market focus.
-- Employment end date stays administrator-controlled. Billing tables are not writable here.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ended_on date;

COMMENT ON COLUMN public.profiles.ended_on IS
  'Administrator-controlled employment end date. Account owners do not set this.';

-- Authenticated updates cannot change privileged employment fields.
-- Email follows Supabase Auth. A direct profile email write is kept only when it already matches auth.users.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean;
  self_update boolean;
  auth_email text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
  ) INTO caller_is_admin;

  self_update := NEW.id = auth.uid();

  IF self_update OR NOT caller_is_admin OR OLD.role = 'admin' THEN
    NEW.role := OLD.role;
    NEW.is_active := OLD.is_active;
    NEW.job_title := OLD.job_title;
    NEW.department := OLD.department;
    NEW.started_on := OLD.started_on;
    NEW.ended_on := OLD.ended_on;
  END IF;

  SELECT email INTO auth_email FROM auth.users WHERE id = NEW.id;
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS DISTINCT FROM auth_email THEN
    NEW.email := OLD.email;
  END IF;

  IF caller_is_admin AND NOT self_update AND OLD.role <> 'admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        auth.uid(),
        'ADMIN_CHANGED_EMPLOYEE_ROLE',
        'profiles',
        NEW.id,
        jsonb_build_object('from', OLD.role, 'to', NEW.role)
      );
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        auth.uid(),
        'ADMIN_CHANGED_EMPLOYEE_STATUS',
        'profiles',
        NEW.id,
        jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_email text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT email INTO auth_email FROM auth.users WHERE id = NEW.id;
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS DISTINCT FROM auth_email THEN
    RAISE EXCEPTION 'Those account fields cannot be changed here' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.job_title IS DISTINCT FROM OLD.job_title
     OR NEW.department IS DISTINCT FROM OLD.department
     OR NEW.started_on IS DISTINCT FROM OLD.started_on
     OR NEW.ended_on IS DISTINCT FROM OLD.ended_on
  THEN
    RAISE EXCEPTION 'Those account fields cannot be changed here' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id
    AND email IS DISTINCT FROM NEW.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_from_auth ON auth.users;
CREATE TRIGGER sync_profile_email_from_auth
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

-- Employees can read a client they are assigned to. They cannot write the business profile.
DROP POLICY IF EXISTS clients_update ON public.clients;
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_client_owner(id))
  WITH CHECK (public.is_admin() OR public.is_client_owner(id));

CREATE OR REPLACE FUNCTION private.guard_client_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  NEW.status := OLD.status;
  NEW.account_manager_id := OLD.account_manager_id;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.onboarding_step := OLD.onboarding_step;
  NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  NEW.billing_email := OLD.billing_email;
  NEW.notes := OLD.notes;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS client_service_interests_write ON public.client_service_interests;
CREATE POLICY client_service_interests_write ON public.client_service_interests
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_client_owner(client_id))
  WITH CHECK (public.is_admin() OR public.is_client_owner(client_id));

DROP POLICY IF EXISTS client_market_focus_write ON public.client_market_focus;
CREATE POLICY client_market_focus_write ON public.client_market_focus
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_client_owner(client_id))
  WITH CHECK (public.is_admin() OR public.is_client_owner(client_id));

GRANT INSERT, UPDATE, DELETE ON public.client_service_interests TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.client_market_focus TO authenticated;

CREATE OR REPLACE FUNCTION public.save_client_service_interests(p_client_id uuid, p_interests jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  slug text;
  primary_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.is_client_owner(p_client_id)) THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;
  IF p_interests IS NULL OR jsonb_typeof(p_interests) <> 'array' THEN
    RAISE EXCEPTION 'Choose service interests.' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_interests)
  LOOP
    slug := item ->> 'slug';
    IF slug IS NULL OR slug NOT IN (
      'web-design', 'seo', 'local-seo', 'technical-seo', 'social-media', 'google-ads',
      'meta-advertising', 'tiktok-advertising', 'analytics-reporting', 'branding',
      'ecommerce', 'content-marketing', 'ai-marketing', 'other'
    ) THEN
      RAISE EXCEPTION 'Choose a listed service interest.' USING ERRCODE = '22023';
    END IF;
    IF coalesce((item ->> 'is_primary')::boolean, false) THEN
      primary_count := primary_count + 1;
    END IF;
  END LOOP;
  IF primary_count > 1 THEN
    RAISE EXCEPTION 'Choose one primary service interest.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.client_service_interests WHERE client_id = p_client_id;
  INSERT INTO public.client_service_interests (client_id, slug, is_primary)
  SELECT p_client_id, entry.slug, entry.is_primary
  FROM (
    SELECT DISTINCT ON (item ->> 'slug')
      item ->> 'slug' AS slug,
      coalesce((item ->> 'is_primary')::boolean, false) AS is_primary
    FROM jsonb_array_elements(p_interests) item
  ) entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_client_market_focus(p_client_id uuid, p_markets jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slug text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.is_client_owner(p_client_id)) THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;
  IF p_markets IS NULL OR jsonb_typeof(p_markets) <> 'array' THEN
    RAISE EXCEPTION 'Choose a market focus.' USING ERRCODE = '22023';
  END IF;

  FOR slug IN SELECT value FROM jsonb_array_elements_text(p_markets)
  LOOP
    IF slug NOT IN (
      'local', 'regional', 'national', 'ecommerce', 'b2b', 'b2c',
      'professional-services', 'retail', 'manufacturing', 'other'
    ) THEN
      RAISE EXCEPTION 'Choose a listed market.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM public.client_market_focus WHERE client_id = p_client_id;
  INSERT INTO public.client_market_focus (client_id, slug)
  SELECT DISTINCT p_client_id, value
  FROM jsonb_array_elements_text(p_markets);
END;
$$;

REVOKE ALL ON FUNCTION public.save_client_service_interests(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_client_market_focus(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_service_interests(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_market_focus(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_client_business(p_client_id uuid, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_fields ->> 'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the business name.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.clients
  SET
    name = btrim(p_fields ->> 'name'),
    legal_name = NULLIF(btrim(p_fields ->> 'legal_name'), ''),
    website = NULLIF(btrim(p_fields ->> 'website'), ''),
    industry = NULLIF(btrim(p_fields ->> 'industry'), ''),
    phone = NULLIF(btrim(p_fields ->> 'phone'), ''),
    address_line = NULLIF(btrim(p_fields ->> 'address_line'), ''),
    city = NULLIF(btrim(p_fields ->> 'city'), ''),
    region = NULLIF(btrim(p_fields ->> 'region'), ''),
    postal_code = NULLIF(btrim(p_fields ->> 'postal_code'), ''),
    market_summary = NULLIF(btrim(p_fields ->> 'market_summary'), ''),
    industry_detail = NULLIF(btrim(p_fields ->> 'industry_detail'), ''),
    interest_note = NULLIF(btrim(p_fields ->> 'interest_note'), '')
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_client_business(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_client_business(uuid, jsonb) TO authenticated;
