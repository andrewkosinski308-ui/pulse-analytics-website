-- Fix onboarding saves so field variables are not parsed as table columns.

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
    next_status := 'active';
  END IF;

  UPDATE public.clients
  SET onboarding_step = next_step, status = next_status
  WHERE id = rec.id;

  RETURN jsonb_build_object('step', next_step, 'complete', next_step = 5);
END;
$$;

