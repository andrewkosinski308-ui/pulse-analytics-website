-- Account lifecycle: onboarding stays onboarding, completion becomes lead,
-- and active is reserved for a current paid engagement.
-- Existing rows are not rewritten.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

GRANT SELECT (onboarding_completed_at) ON TABLE public.clients TO authenticated;

ALTER TABLE public.project_purchases
  ADD COLUMN IF NOT EXISTS billing text NOT NULL DEFAULT 'one_time';

ALTER TABLE public.project_purchases
  DROP CONSTRAINT IF EXISTS project_purchases_billing_check;

ALTER TABLE public.project_purchases
  ADD CONSTRAINT project_purchases_billing_check
  CHECK (billing IN ('one_time', 'recurring'));

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT stripe_events_id_format CHECK (id ~ '^evt_[A-Za-z0-9_]+$')
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.stripe_events TO service_role;

CREATE OR REPLACE FUNCTION private.sync_client_engagement_status(p_client_id uuid)
RETURNS public.client_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status public.client_status;
  one_time_open integer;
  recurring_open integer;
  recorded integer;
  next_status public.client_status;
BEGIN
  SELECT status
  INTO current_status
  FROM public.clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Onboarding, paused, and churned are not commercial engagement states.
  IF current_status IN ('onboarding', 'paused', 'churned') THEN
    RETURN current_status;
  END IF;

  SELECT count(*)
  INTO one_time_open
  FROM public.projects pr
  JOIN public.project_purchases pp ON pp.project_id = pr.id
  WHERE pr.client_id = p_client_id
    AND pp.billing = 'one_time'
    AND pr.status IN ('planned', 'active', 'on_hold');

  SELECT count(*)
  INTO recurring_open
  FROM public.client_subscriptions cs
  WHERE cs.client_id = p_client_id
    AND cs.status IN ('active', 'trialing', 'past_due');

  IF one_time_open > 0 OR recurring_open > 0 THEN
    next_status := CASE
      WHEN current_status IN ('lead', 'active') THEN 'active'::public.client_status
      ELSE current_status
    END;
  ELSE
    SELECT
      (SELECT count(*)
       FROM public.project_purchases pp
       JOIN public.projects pr ON pr.id = pp.project_id
       WHERE pr.client_id = p_client_id)
      + (SELECT count(*)
         FROM public.client_subscriptions cs
         WHERE cs.client_id = p_client_id)
    INTO recorded;

    -- A legacy active account with no recorded payment engagement stays active.
    IF current_status = 'active' AND recorded > 0 THEN
      next_status := 'lead';
    ELSE
      next_status := current_status;
    END IF;
  END IF;

  IF next_status IS DISTINCT FROM current_status THEN
    PERFORM set_config('pulse.lifecycle_write', 'allowed', true);
    UPDATE public.clients
    SET status = next_status
    WHERE id = p_client_id;
  END IF;

  RETURN next_status;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_client_engagement_status(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_client_engagement_status(p_client_id uuid)
RETURNS public.client_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Client status is assigned by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN private.sync_client_engagement_status(p_client_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_client_engagement_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_client_engagement_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(p_event_id text, p_event_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'invalid stripe event' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stripe_events (id, event_type)
  VALUES (p_event_id, COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown'));
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text) TO service_role;

CREATE OR REPLACE FUNCTION private.guard_client_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_setting('pulse.lifecycle_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Client status is assigned by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_guard_status ON public.clients;
CREATE TRIGGER clients_guard_status
  BEFORE UPDATE OF status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_client_status();

REVOKE ALL ON FUNCTION private.guard_client_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_project_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(auth.role(), '') = 'authenticated'
     AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_status ON public.projects;
CREATE TRIGGER projects_guard_status
  BEFORE UPDATE OF status ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_project_status_change();

CREATE OR REPLACE FUNCTION private.project_status_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM private.sync_client_engagement_status(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS projects_sync_client_lifecycle ON public.projects;
CREATE TRIGGER projects_sync_client_lifecycle
  AFTER UPDATE OF status ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION private.project_status_lifecycle();

REVOKE ALL ON FUNCTION private.guard_project_status_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.project_status_lifecycle() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text);

CREATE FUNCTION public.create_project_from_stripe_checkout(
  p_client_id uuid,
  p_session_id text,
  p_service_ids uuid[],
  p_price_ids text[],
  p_project_name text,
  p_summary text,
  p_billing text DEFAULT 'one_time'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  existing uuid;
  new_id uuid;
  svc_id uuid;
  billing text := COALESCE(NULLIF(btrim(p_billing), ''), 'one_time');
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'invalid checkout session';
  END IF;
  IF p_service_ids IS NULL OR cardinality(p_service_ids) < 1 THEN
    RAISE EXCEPTION 'missing services';
  END IF;
  IF p_price_ids IS NULL OR cardinality(p_price_ids) < 1 THEN
    RAISE EXCEPTION 'missing prices';
  END IF;
  IF billing NOT IN ('one_time', 'recurring') THEN
    RAISE EXCEPTION 'invalid billing';
  END IF;

  SELECT project_id
  INTO existing
  FROM public.project_purchases
  WHERE stripe_checkout_session_id = p_session_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO public.projects (client_id, name, status, summary, source)
  VALUES (p_client_id, p_project_name, 'planned', p_summary, 'stripe_checkout')
  RETURNING id INTO new_id;

  FOREACH svc_id IN ARRAY p_service_ids LOOP
    INSERT INTO public.project_services (project_id, service_id)
    VALUES (new_id, svc_id)
    ON CONFLICT (project_id, service_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.project_purchases (project_id, stripe_checkout_session_id, stripe_price_ids, billing)
  VALUES (new_id, p_session_id, p_price_ids, billing);

  RETURN new_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT project_id
    INTO existing
    FROM public.project_purchases
    WHERE stripe_checkout_session_id = p_session_id;
    IF existing IS NOT NULL THEN
      RETURN existing;
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION private.save_client_onboarding(p_step integer, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
  uid uuid := auth.uid();
  rec public.clients%ROWTYPE;
  next_step smallint;
  next_status public.client_status;
  business_name text;
  address_line text;
  city text;
  region text;
  postal_code text;
  phone text;
  industry text;
  industry_detail text;
  market_summary text;
  primary_interest text;
  interest_note text;
  full_name text;
  markets text[];
  interests text[];
  market_slug text;
  interest_slug text;
  allowed_states text[] := ARRAY[
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
    'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
    'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ];
  allowed_industries text[] := ARRAY[
    'professional-services','healthcare','home-services','legal','real-estate','financial-services',
    'retail','ecommerce','hospitality','manufacturing','construction','automotive','education',
    'nonprofit','technology','beauty-wellness','other'
  ];
  allowed_markets text[] := ARRAY[
    'local','regional','national','ecommerce','b2b','b2c','professional-services','retail','manufacturing','other'
  ];
  allowed_interests text[] := ARRAY[
    'web-design','seo','local-seo','technical-seo','social-media','google-ads','meta-advertising',
    'tiktok-advertising','analytics-reporting','branding','ecommerce','content-marketing','ai-marketing','other'
  ];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE = '42501';
  END IF;

  IF public.is_staff() THEN
    RAISE EXCEPTION 'This account cannot use client onboarding.' USING ERRCODE = '42501';
  END IF;

  SELECT c.*
  INTO rec
  FROM public.clients c
  JOIN public.client_members cm ON cm.client_id = c.id
  WHERE cm.profile_id = uid
  ORDER BY cm.created_at
  LIMIT 1
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No client account is linked to this login.' USING ERRCODE = '42501';
  END IF;

  IF rec.onboarding_step = 5 THEN
    RAISE EXCEPTION 'Onboarding is already complete.' USING ERRCODE = '22023';
  END IF;

  IF p_step IS NULL OR p_step < 1 OR p_step > 4 OR p_step > rec.onboarding_step THEN
    RAISE EXCEPTION 'Finish the current step before continuing.' USING ERRCODE = '22023';
  END IF;

  IF p_step = 1 THEN
    full_name := btrim(COALESCE(p_payload ->> 'full_name', ''));
    IF char_length(full_name) < 2 OR char_length(full_name) > 120 THEN
      RAISE EXCEPTION 'Enter your full name.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles
    SET full_name = full_name
    WHERE id = uid;
    IF rec.onboarding_step = 2 THEN
      UPDATE public.clients
      SET name = full_name
      WHERE id = rec.id;
    END IF;
    RETURN jsonb_build_object('step', rec.onboarding_step, 'complete', false);
  END IF;

  next_step := rec.onboarding_step;
  next_status := rec.status;

  IF p_step = 2 THEN
    business_name := btrim(COALESCE(p_payload ->> 'business_name', ''));
    address_line := btrim(COALESCE(p_payload ->> 'address_line', ''));
    city := btrim(COALESCE(p_payload ->> 'city', ''));
    region := upper(btrim(COALESCE(p_payload ->> 'region', '')));
    postal_code := btrim(COALESCE(p_payload ->> 'postal_code', ''));
    phone := btrim(COALESCE(p_payload ->> 'phone', ''));
    IF char_length(business_name) < 2 OR char_length(business_name) > 160 THEN
      RAISE EXCEPTION 'Enter the full business name.' USING ERRCODE = '22023';
    END IF;
    IF char_length(address_line) < 4 OR char_length(address_line) > 160 THEN
      RAISE EXCEPTION 'Enter the business street address.' USING ERRCODE = '22023';
    END IF;
    IF char_length(city) < 2 OR char_length(city) > 80 THEN
      RAISE EXCEPTION 'Enter the city.' USING ERRCODE = '22023';
    END IF;
    IF NOT region = ANY(allowed_states) THEN
      RAISE EXCEPTION 'Choose a state.' USING ERRCODE = '22023';
    END IF;
    IF postal_code !~ '^[0-9]{5}(-[0-9]{4})?$' THEN
      RAISE EXCEPTION 'Enter a 5-digit ZIP code.' USING ERRCODE = '22023';
    END IF;
    IF char_length(phone) > 30
       OR char_length(regexp_replace(phone, '\D', '', 'g')) < 10
       OR char_length(regexp_replace(phone, '\D', '', 'g')) > 15 THEN
      RAISE EXCEPTION 'Enter a business phone number.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.clients
    SET
      name = business_name,
      legal_name = business_name,
      address_line = address_line,
      city = city,
      region = region,
      postal_code = postal_code,
      phone = phone
    WHERE id = rec.id;
  ELSIF p_step = 3 THEN
    industry := btrim(COALESCE(p_payload ->> 'industry', ''));
    industry_detail := btrim(COALESCE(p_payload ->> 'industry_detail', ''));
    market_summary := btrim(COALESCE(p_payload ->> 'market_summary', ''));
    IF NOT industry = ANY(allowed_industries) THEN
      RAISE EXCEPTION 'Choose the industry that best fits the business.' USING ERRCODE = '22023';
    END IF;
    IF industry = 'other' AND (char_length(industry_detail) < 2 OR char_length(industry_detail) > 120) THEN
      RAISE EXCEPTION 'Describe the industry.' USING ERRCODE = '22023';
    END IF;
    IF industry <> 'other' THEN
      industry_detail := '';
    END IF;
    IF jsonb_typeof(p_payload -> 'markets') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Choose at least one market.' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT item), ARRAY[]::text[])
    INTO markets
    FROM jsonb_array_elements_text(p_payload -> 'markets') AS item
    WHERE btrim(item) <> '';
    IF markets IS NULL OR cardinality(markets) = 0 OR EXISTS (
      SELECT 1 FROM unnest(markets) AS item WHERE NOT item = ANY(allowed_markets)
    ) THEN
      RAISE EXCEPTION 'Choose at least one market.' USING ERRCODE = '22023';
    END IF;
    IF char_length(market_summary) < 10 OR char_length(market_summary) > 400 THEN
      RAISE EXCEPTION 'Describe the market this business operates in.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.clients
    SET
      industry = industry,
      industry_detail = NULLIF(industry_detail, ''),
      market_summary = market_summary
    WHERE id = rec.id;
    DELETE FROM public.client_market_focus WHERE client_id = rec.id;
    FOREACH market_slug IN ARRAY markets LOOP
      INSERT INTO public.client_market_focus (client_id, slug)
      VALUES (rec.id, market_slug);
    END LOOP;
  ELSIF p_step = 4 THEN
    primary_interest := btrim(COALESCE(p_payload ->> 'primary_interest', ''));
    interest_note := btrim(COALESCE(p_payload ->> 'interest_note', ''));
    IF jsonb_typeof(p_payload -> 'interests') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Choose at least one service.' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT item), ARRAY[]::text[])
    INTO interests
    FROM jsonb_array_elements_text(p_payload -> 'interests') AS item
    WHERE btrim(item) <> '';
    IF interests IS NULL OR cardinality(interests) = 0 OR EXISTS (
      SELECT 1 FROM unnest(interests) AS item WHERE NOT item = ANY(allowed_interests)
    ) THEN
      RAISE EXCEPTION 'Choose at least one service.' USING ERRCODE = '22023';
    END IF;
    IF NOT primary_interest = ANY(interests) THEN
      RAISE EXCEPTION 'Choose one primary service from the services you selected.' USING ERRCODE = '22023';
    END IF;
    IF 'other' = ANY(interests) AND (char_length(interest_note) < 2 OR char_length(interest_note) > 160) THEN
      RAISE EXCEPTION 'Describe the other service interest.' USING ERRCODE = '22023';
    END IF;
    IF NOT ('other' = ANY(interests)) THEN
      interest_note := '';
    END IF;
    UPDATE public.clients
    SET interest_note = NULLIF(interest_note, '')
    WHERE id = rec.id;
    DELETE FROM public.client_service_interests WHERE client_id = rec.id;
    FOREACH interest_slug IN ARRAY interests LOOP
      INSERT INTO public.client_service_interests (client_id, slug, is_primary)
      VALUES (rec.id, interest_slug, interest_slug = primary_interest);
    END LOOP;
  END IF;

  IF p_step = rec.onboarding_step THEN
    next_step := rec.onboarding_step + 1;
  END IF;

  IF next_step = 5 AND rec.status = 'onboarding' THEN
    next_status := 'lead';
  END IF;

  PERFORM set_config('pulse.lifecycle_write', 'allowed', true);
  UPDATE public.clients
  SET onboarding_step = next_step,
      status = next_status,
      onboarding_completed_at = CASE
        WHEN next_step = 5 AND onboarding_completed_at IS NULL THEN timezone('utc', now())
        ELSE onboarding_completed_at
      END
  WHERE id = rec.id;

  RETURN jsonb_build_object('step', next_step, 'complete', next_step = 5);
END;
$$;

