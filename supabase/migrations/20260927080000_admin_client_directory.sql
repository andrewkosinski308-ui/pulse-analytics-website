-- Read-only admin directory for the existing clients account record.
-- Does not change lifecycle status, engagements, or payment records.

CREATE OR REPLACE FUNCTION public.admin_client_list(
  p_query text DEFAULT '',
  p_status text DEFAULT 'all',
  p_sort text DEFAULT 'activity',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  query_text text := left(btrim(COALESCE(p_query, '')), 80);
  digits text;
  pattern text;
  filter_status public.client_status;
  sort_key text := COALESCE(p_sort, 'activity');
  page_num integer := GREATEST(COALESCE(p_page, 1), 1);
  page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 25);
  total_count integer;
  rows_json jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;

  query_text := replace(replace(query_text, '%', ''), '_', '');
  digits := regexp_replace(query_text, '\D', '', 'g');
  pattern := '%' || query_text || '%';

  IF p_status IS NULL OR btrim(p_status) = '' OR btrim(p_status) = 'all' THEN
    filter_status := NULL;
  ELSIF btrim(p_status) IN ('onboarding', 'lead', 'active', 'paused', 'churned') THEN
    filter_status := btrim(p_status)::public.client_status;
  ELSE
    RAISE EXCEPTION 'Choose a client status filter.' USING ERRCODE = '22023';
  END IF;

  IF sort_key NOT IN ('name', 'contact', 'status', 'created', 'activity') THEN
    RAISE EXCEPTION 'Choose a client sort.' USING ERRCODE = '22023';
  END IF;

  WITH directory AS (
    SELECT
      c.id,
      c.name,
      c.status::text AS status,
      c.phone,
      c.onboarding_step,
      c.onboarding_completed_at,
      c.created_at,
      contact.full_name AS contact_name,
      COALESCE(NULLIF(btrim(contact.email), ''), NULLIF(btrim(c.billing_email), '')) AS email,
      primary_service.service_name AS primary_service,
      GREATEST(
        c.updated_at,
        COALESCE(activity.project_at, c.updated_at),
        COALESCE(activity.subscription_at, c.updated_at),
        COALESCE(activity.invoice_at, c.updated_at),
        COALESCE(activity.purchase_at, c.updated_at)
      ) AS last_activity,
      COALESCE(open_items.labels, '[]'::jsonb) AS open_labels
    FROM public.clients c
    LEFT JOIN LATERAL (
      SELECT p.full_name, p.email
      FROM public.client_members cm
      JOIN public.profiles p ON p.id = cm.profile_id
      WHERE cm.client_id = c.id
      ORDER BY CASE WHEN cm.member_role = 'owner' THEN 0 ELSE 1 END, cm.created_at
      LIMIT 1
    ) contact ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sv.name, interest.slug) AS service_name
      FROM public.client_service_interests interest
      LEFT JOIN public.services sv ON sv.slug = interest.slug
      WHERE interest.client_id = c.id AND interest.is_primary
      LIMIT 1
    ) primary_service ON true
    LEFT JOIN LATERAL (
      SELECT
        (SELECT max(pr.updated_at) FROM public.projects pr WHERE pr.client_id = c.id) AS project_at,
        (SELECT max(cs.updated_at) FROM public.client_subscriptions cs WHERE cs.client_id = c.id) AS subscription_at,
        (SELECT max(inv.created_at) FROM public.client_invoices inv WHERE inv.client_id = c.id) AS invoice_at,
        (
          SELECT max(pp.created_at)
          FROM public.project_purchases pp
          JOIN public.projects pr ON pr.id = pp.project_id
          WHERE pr.client_id = c.id
        ) AS purchase_at
    ) activity ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(label ORDER BY label) AS labels
      FROM (
        SELECT pr.name AS label
        FROM public.projects pr
        JOIN public.project_purchases pp ON pp.project_id = pr.id
        WHERE pr.client_id = c.id
          AND pp.billing = 'one_time'
          AND pr.status IN ('planned', 'active', 'on_hold')
        UNION ALL
        SELECT COALESCE(cs.product_name, 'Recurring service') AS label
        FROM public.client_subscriptions cs
        WHERE cs.client_id = c.id
          AND cs.status IN ('active', 'trialing', 'past_due')
      ) open_names
    ) open_items ON true
    WHERE (filter_status IS NULL OR c.status = filter_status)
      AND (
        query_text = ''
        OR c.name ILIKE pattern
        OR c.legal_name ILIKE pattern
        OR c.billing_email ILIKE pattern
        OR c.phone ILIKE pattern
        OR contact.full_name ILIKE pattern
        OR contact.email ILIKE pattern
        OR (char_length(digits) >= 3 AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE '%' || digits || '%')
      )
  ),
  ranked AS (
    SELECT
      directory.*,
      count(*) OVER () AS total_count,
      row_number() OVER (
        ORDER BY
          CASE WHEN sort_key = 'name' THEN lower(directory.name) END ASC,
          CASE WHEN sort_key = 'contact' THEN lower(COALESCE(directory.contact_name, '')) END ASC,
          CASE WHEN sort_key = 'status' THEN directory.status END ASC,
          CASE WHEN sort_key = 'created' THEN directory.created_at END DESC,
          CASE WHEN sort_key = 'activity' THEN directory.last_activity END DESC NULLS LAST,
          lower(directory.name) ASC
      ) AS sort_pos
    FROM directory
  )
  SELECT
    COALESCE(max(ranked.total_count), 0)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ranked.id,
      'name', ranked.name,
      'contact_name', ranked.contact_name,
      'email', ranked.email,
      'phone', ranked.phone,
      'status', ranked.status,
      'primary_service', ranked.primary_service,
      'open_labels', ranked.open_labels,
      'onboarding_step', ranked.onboarding_step,
      'onboarding_completed_at', ranked.onboarding_completed_at,
      'created_at', ranked.created_at,
      'last_activity', ranked.last_activity
    ) ORDER BY ranked.sort_pos) FILTER (
      WHERE ranked.sort_pos > (page_num - 1) * page_size
        AND ranked.sort_pos <= page_num * page_size
    ), '[]'::jsonb)
  INTO total_count, rows_json
  FROM ranked;

  RETURN jsonb_build_object(
    'clients', COALESCE(rows_json, '[]'::jsonb),
    'page', page_num,
    'page_size', page_size,
    'total', COALESCE(total_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_client_list(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_client_list(text, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_client_detail(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Choose a client account.' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'legal_name', c.legal_name,
    'status', c.status,
    'phone', c.phone,
    'email', COALESCE(NULLIF(btrim(contact.email), ''), NULLIF(btrim(c.billing_email), '')),
    'contact_name', contact.full_name,
    'website', c.website,
    'address_line', c.address_line,
    'city', c.city,
    'region', c.region,
    'postal_code', c.postal_code,
    'industry', c.industry,
    'industry_detail', c.industry_detail,
    'market_summary', c.market_summary,
    'interest_note', c.interest_note,
    'onboarding_step', c.onboarding_step,
    'onboarding_completed_at', c.onboarding_completed_at,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'stripe_customer_id', c.stripe_customer_id,
    'markets', COALESCE((
      SELECT jsonb_agg(mf.slug ORDER BY mf.slug)
      FROM public.client_market_focus mf
      WHERE mf.client_id = c.id
    ), '[]'::jsonb),
    'interests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', interest.slug,
        'is_primary', interest.is_primary,
        'name', COALESCE(sv.name, interest.slug)
      ) ORDER BY interest.is_primary DESC, interest.slug)
      FROM public.client_service_interests interest
      LEFT JOIN public.services sv ON sv.slug = interest.slug
      WHERE interest.client_id = c.id
    ), '[]'::jsonb),
    'engagements', jsonb_build_object(
      'one_time', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'project_id', pr.id,
          'project_name', pr.name,
          'project_status', pr.status,
          'billing', pp.billing,
          'services', COALESCE((
            SELECT jsonb_agg(sv.name ORDER BY sv.name)
            FROM public.project_services ps
            JOIN public.services sv ON sv.id = ps.service_id
            WHERE ps.project_id = pr.id
          ), '[]'::jsonb),
          'purchased_at', pp.created_at,
          'starts_on', pr.starts_on,
          'ends_on', pr.ends_on,
          'checkout_session_id', pp.stripe_checkout_session_id
        ) ORDER BY pp.created_at DESC)
        FROM public.projects pr
        JOIN public.project_purchases pp ON pp.project_id = pr.id
        WHERE pr.client_id = c.id AND pp.billing = 'one_time'
      ), '[]'::jsonb),
      'recurring', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subscription_id', cs.stripe_subscription_id,
          'product_name', COALESCE(cs.product_name, 'Recurring service'),
          'status', cs.status,
          'cancel_at_period_end', cs.cancel_at_period_end,
          'current_period_end', cs.current_period_end,
          'updated_at', cs.updated_at
        ) ORDER BY cs.updated_at DESC)
        FROM public.client_subscriptions cs
        WHERE cs.client_id = c.id
      ), '[]'::jsonb),
      'recurring_projects', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'project_id', pr.id,
          'project_name', pr.name,
          'project_status', pr.status,
          'billing', pp.billing,
          'services', COALESCE((
            SELECT jsonb_agg(sv.name ORDER BY sv.name)
            FROM public.project_services ps
            JOIN public.services sv ON sv.id = ps.service_id
            WHERE ps.project_id = pr.id
          ), '[]'::jsonb),
          'purchased_at', pp.created_at,
          'starts_on', pr.starts_on,
          'ends_on', pr.ends_on,
          'checkout_session_id', pp.stripe_checkout_session_id
        ) ORDER BY pp.created_at DESC)
        FROM public.projects pr
        JOIN public.project_purchases pp ON pp.project_id = pr.id
        WHERE pr.client_id = c.id AND pp.billing = 'recurring'
      ), '[]'::jsonb)
    ),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'status', pr.status,
        'starts_on', pr.starts_on,
        'ends_on', pr.ends_on,
        'updated_at', pr.updated_at,
        'source', pr.source,
        'billing', pp.billing,
        'services', COALESCE((
          SELECT jsonb_agg(sv.name ORDER BY sv.name)
          FROM public.project_services ps
          JOIN public.services sv ON sv.id = ps.service_id
          WHERE ps.project_id = pr.id
        ), '[]'::jsonb)
      ) ORDER BY pr.updated_at DESC)
      FROM (
        SELECT *
        FROM public.projects
        WHERE client_id = c.id
        ORDER BY updated_at DESC
        LIMIT 100
      ) pr
      LEFT JOIN public.project_purchases pp ON pp.project_id = pr.id
    ), '[]'::jsonb),
    'files', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'file_name', f.file_name,
        'mime_type', f.mime_type,
        'size_bytes', f.size_bytes,
        'category', f.category,
        'delivery_status', f.delivery_status,
        'direction', f.direction,
        'created_at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (
        SELECT *
        FROM public.files
        WHERE client_id = c.id
           OR project_id IN (SELECT id FROM public.projects WHERE client_id = c.id)
           OR report_id IN (SELECT id FROM public.reports WHERE client_id = c.id)
        ORDER BY created_at DESC
        LIMIT 50
      ) f
    ), '[]'::jsonb),
    'reports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', r.title,
        'report_type', r.report_type,
        'status', r.status,
        'period_start', r.period_start,
        'period_end', r.period_end,
        'published_at', r.published_at,
        'summary', r.summary
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT *
        FROM public.reports
        WHERE client_id = c.id
        ORDER BY created_at DESC
        LIMIT 50
      ) r
    ), '[]'::jsonb),
    'billing', jsonb_build_object(
      'customer_on_file', c.stripe_customer_id IS NOT NULL,
      'stripe_customer_id', c.stripe_customer_id,
      'invoices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'invoice_id', inv.stripe_invoice_id,
          'status', inv.status,
          'amount_due', inv.amount_due,
          'amount_paid', inv.amount_paid,
          'currency', inv.currency,
          'period_start', inv.period_start,
          'period_end', inv.period_end,
          'created_at', inv.created_at
        ) ORDER BY inv.created_at DESC)
        FROM (
          SELECT *
          FROM public.client_invoices
          WHERE client_id = c.id
          ORDER BY created_at DESC
          LIMIT 50
        ) inv
      ), '[]'::jsonb)
    )
  )
  INTO result
  FROM public.clients c
  LEFT JOIN LATERAL (
    SELECT p.full_name, p.email
    FROM public.client_members cm
    JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.client_id = c.id
    ORDER BY CASE WHEN cm.member_role = 'owner' THEN 0 ELSE 1 END, cm.created_at
    LIMIT 1
  ) contact ON true
  WHERE c.id = p_client_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'That client account was not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_client_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_client_detail(uuid) TO authenticated;
