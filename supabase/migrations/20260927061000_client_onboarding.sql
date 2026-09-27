-- Client onboarding foundation.
-- Existing clients are marked complete so the current portal keeps working.
-- New portal signups create one client and resume from the business step.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address_line text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS market_summary text,
  ADD COLUMN IF NOT EXISTS industry_detail text,
  ADD COLUMN IF NOT EXISTS interest_note text,
  ADD COLUMN IF NOT EXISTS onboarding_step smallint NOT NULL DEFAULT 5;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_onboarding_step_range;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_onboarding_step_range CHECK (onboarding_step BETWEEN 1 AND 5);

CREATE UNIQUE INDEX IF NOT EXISTS client_members_one_profile_idx
  ON public.client_members (profile_id);

CREATE TABLE IF NOT EXISTS public.client_market_focus (
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  slug text NOT NULL,
  PRIMARY KEY (client_id, slug),
  CONSTRAINT client_market_focus_slug_chk CHECK (slug IN (
    'local', 'regional', 'national', 'ecommerce', 'b2b', 'b2c',
    'professional-services', 'retail', 'manufacturing', 'other'
  ))
);

CREATE TABLE IF NOT EXISTS public.client_service_interests (
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  slug text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (client_id, slug),
  CONSTRAINT client_service_interests_slug_chk CHECK (slug IN (
    'web-design', 'seo', 'local-seo', 'technical-seo', 'social-media', 'google-ads',
    'meta-advertising', 'tiktok-advertising', 'analytics-reporting', 'branding',
    'ecommerce', 'content-marketing', 'ai-marketing', 'other'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS client_service_interests_one_primary
  ON public.client_service_interests (client_id)
  WHERE is_primary;

ALTER TABLE public.client_market_focus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_service_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_market_focus_select ON public.client_market_focus;
CREATE POLICY client_market_focus_select ON public.client_market_focus
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access_client(client_id)));

DROP POLICY IF EXISTS client_service_interests_select ON public.client_service_interests;
CREATE POLICY client_service_interests_select ON public.client_service_interests
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access_client(client_id)));

REVOKE ALL ON public.client_market_focus FROM anon, PUBLIC;
REVOKE ALL ON public.client_service_interests FROM anon, PUBLIC;
GRANT SELECT ON public.client_market_focus TO authenticated;
GRANT SELECT ON public.client_service_interests TO authenticated;

GRANT SELECT (
  phone,
  address_line,
  city,
  region,
  postal_code,
  market_summary,
  industry_detail,
  interest_note,
  onboarding_step
) ON TABLE public.clients TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_client_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    'client'
  )
  ON CONFLICT (id) DO NOTHING;

  IF COALESCE(NEW.raw_user_meta_data ->> 'signup_intent', '') = 'portal_client'
     AND NOT EXISTS (
       SELECT 1 FROM public.client_members cm WHERE cm.profile_id = NEW.id
     ) THEN
    INSERT INTO public.clients (name, status, onboarding_step, billing_email)
    VALUES (
      COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), 'New client'),
      'onboarding',
      2,
      COALESCE(NEW.email, '')
    )
    RETURNING id INTO new_client_id;

    INSERT INTO public.client_members (client_id, profile_id, member_role)
    VALUES (new_client_id, NEW.id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.save_client_onboarding(p_step integer, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SET full_name = save_client_onboarding.full_name
    WHERE id = uid;
    IF rec.onboarding_step = 2 THEN
      UPDATE public.clients
      SET name = save_client_onboarding.full_name
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
      name = save_client_onboarding.business_name,
      legal_name = save_client_onboarding.business_name,
      address_line = save_client_onboarding.address_line,
      city = save_client_onboarding.city,
      region = save_client_onboarding.region,
      postal_code = save_client_onboarding.postal_code,
      phone = save_client_onboarding.phone
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
      industry = save_client_onboarding.industry,
      industry_detail = NULLIF(save_client_onboarding.industry_detail, ''),
      market_summary = save_client_onboarding.market_summary
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
    SET interest_note = NULLIF(save_client_onboarding.interest_note, '')
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
    next_status := 'active';
  END IF;

  UPDATE public.clients
  SET onboarding_step = next_step, status = next_status
  WHERE id = rec.id;

  RETURN jsonb_build_object('step', next_step, 'complete', next_step = 5);
END;
$$;

CREATE OR REPLACE FUNCTION private.client_onboarding()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  rec public.clients%ROWTYPE;
  markets jsonb;
  interests jsonb;
  primary_interest text;
BEGIN
  IF uid IS NULL OR public.is_staff() THEN
    RETURN NULL;
  END IF;

  SELECT c.*
  INTO rec
  FROM public.clients c
  JOIN public.client_members cm ON cm.client_id = c.id
  WHERE cm.profile_id = uid
  ORDER BY cm.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(slug ORDER BY slug), '[]'::jsonb)
  INTO markets
  FROM public.client_market_focus
  WHERE client_id = rec.id;

  SELECT COALESCE(jsonb_agg(slug ORDER BY slug), '[]'::jsonb)
  INTO interests
  FROM public.client_service_interests
  WHERE client_id = rec.id;

  SELECT slug
  INTO primary_interest
  FROM public.client_service_interests
  WHERE client_id = rec.id AND is_primary
  LIMIT 1;

  RETURN jsonb_build_object(
    'step', rec.onboarding_step,
    'full_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = uid),
    'email', (SELECT p.email FROM public.profiles p WHERE p.id = uid),
    'business_name', CASE WHEN rec.onboarding_step > 2 THEN rec.name ELSE '' END,
    'address_line', COALESCE(rec.address_line, ''),
    'city', COALESCE(rec.city, ''),
    'region', COALESCE(rec.region, ''),
    'postal_code', COALESCE(rec.postal_code, ''),
    'phone', COALESCE(rec.phone, ''),
    'industry', COALESCE(rec.industry, ''),
    'industry_detail', COALESCE(rec.industry_detail, ''),
    'market_summary', COALESCE(rec.market_summary, ''),
    'markets', markets,
    'interests', interests,
    'primary_interest', COALESCE(primary_interest, ''),
    'interest_note', COALESCE(rec.interest_note, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.save_client_onboarding(integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.client_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.save_client_onboarding(integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.client_onboarding() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_client_onboarding(p_step integer, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.save_client_onboarding(p_step, p_payload);
$$;

CREATE OR REPLACE FUNCTION public.client_onboarding()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.client_onboarding();
$$;

REVOKE ALL ON FUNCTION public.save_client_onboarding(integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_onboarding(integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_onboarding() TO authenticated;
