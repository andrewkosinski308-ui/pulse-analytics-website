-- The interest row was aliased as item, which is also a PL/pgSQL variable.
-- PostgreSQL treats that as an ambiguous column reference and rejects the save.

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
    SELECT DISTINCT ON (interest ->> 'slug')
      interest ->> 'slug' AS slug,
      coalesce((interest ->> 'is_primary')::boolean, false) AS is_primary
    FROM jsonb_array_elements(p_interests) interest
  ) entry;
END;
$$;

REVOKE ALL ON FUNCTION public.save_client_service_interests(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_service_interests(uuid, jsonb) TO authenticated;
