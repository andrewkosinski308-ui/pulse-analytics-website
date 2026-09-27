-- Stripe Checkout purchases create one project, keyed by Checkout Session id.
-- Manual projects stay source = manual. Clients cannot read purchase identifiers.

ALTER TABLE public.projects
  ADD COLUMN source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_source_check
  CHECK (source IN ('manual', 'stripe_checkout'));

CREATE TABLE public.project_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects (id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL,
  stripe_price_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT project_purchases_session_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT project_purchases_session_format CHECK (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  CONSTRAINT project_purchases_prices_present CHECK (cardinality(stripe_price_ids) > 0)
);

ALTER TABLE public.project_purchases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.project_purchases FROM PUBLIC;
REVOKE ALL ON public.project_purchases FROM anon;
REVOKE ALL ON public.project_purchases FROM authenticated;
GRANT SELECT ON public.project_purchases TO authenticated;

CREATE POLICY project_purchases_select ON public.project_purchases
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    AND EXISTS (
      SELECT 1
      FROM public.projects pr
      WHERE pr.id = project_id
        AND (
          public.is_admin()
          OR public.is_project_member(pr.id)
          OR public.is_staff_for_client(pr.client_id)
        )
    )
  );

-- One transaction: project, services, and the unique purchase key.
-- A repeated session id returns the existing project and does not insert another.
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

GRANT SELECT, INSERT ON public.projects TO service_role;
GRANT SELECT, INSERT ON public.project_services TO service_role;
GRANT SELECT, INSERT ON public.project_purchases TO service_role;
GRANT SELECT ON public.services TO service_role;
GRANT UPDATE (stripe_customer_id) ON public.clients TO service_role;
