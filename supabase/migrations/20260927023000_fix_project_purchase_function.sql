-- The first purchase function used a variable named service_id, which Postgres
-- treats as ambiguous with project_services.service_id.

CREATE OR REPLACE FUNCTION public.create_project_from_stripe_checkout(
  p_client_id uuid,
  p_session_id text,
  p_service_ids uuid[],
  p_price_ids text[],
  p_project_name text,
  p_summary text
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

  INSERT INTO public.project_purchases (project_id, stripe_checkout_session_id, stripe_price_ids)
  VALUES (new_id, p_session_id, p_price_ids);

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

REVOKE ALL ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text) TO service_role;
