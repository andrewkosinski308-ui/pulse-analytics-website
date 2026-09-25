-- Industry Research Library catalog.
-- Pulse Analytics owns these records. Provider payloads are not stored here.

CREATE TABLE public.research_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    domain text NOT NULL CHECK (domain IN ('research', 'market_intelligence', 'benchmarks')),
    is_enabled boolean NOT NULL DEFAULT false,
    attribution_text text NOT NULL,
    base_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT research_providers_base_url_https
        CHECK (base_url IS NULL OR base_url ~ '^https://')
);

CREATE TABLE public.research_works (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    resource_type text NOT NULL,
    publication_date date,
    slug text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    provider_id uuid NOT NULL REFERENCES public.research_providers (id),
    source_url text NOT NULL,
    external_id text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    rights_class text NOT NULL CHECK (rights_class IN (
        'metadata',
        'source_link',
        'permitted_description',
        'open_access_link',
        'copyrighted_full_text_prohibited',
        'dataset_values_permitted',
        'pulse_summary',
        'provider_analysis'
    )),
    summary text,
    open_access boolean,
    doi text,
    venue text,
    methodology text,
    limitations text,
    limitations_unknown boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT research_works_provenance_present CHECK (
        length(trim(title)) > 0
        AND length(trim(external_id)) > 0
        AND source_url ~ '^https://'
    ),
    CONSTRAINT research_works_limitations_explicit CHECK (
        limitations_unknown
        OR (limitations IS NOT NULL AND length(trim(limitations)) > 0)
    ),
    CONSTRAINT research_works_publishable_rights CHECK (
        status <> 'published'
        OR rights_class IN (
            'metadata',
            'source_link',
            'permitted_description',
            'open_access_link',
            'dataset_values_permitted',
            'pulse_summary',
            'provider_analysis'
        )
    ),
    CONSTRAINT research_works_provider_identity UNIQUE (provider_id, external_id)
);

CREATE TABLE public.research_work_identifiers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id uuid NOT NULL REFERENCES public.research_works (id) ON DELETE CASCADE,
    scheme text NOT NULL CHECK (scheme IN ('doi', 'openalex')),
    value text NOT NULL,
    CONSTRAINT research_work_identifiers_unique UNIQUE (scheme, value)
);

CREATE TABLE public.research_provider_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id uuid NOT NULL REFERENCES public.research_works (id) ON DELETE CASCADE,
    provider_id uuid NOT NULL REFERENCES public.research_providers (id),
    external_id text NOT NULL,
    source_url text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    rights_class text NOT NULL CHECK (rights_class IN (
        'metadata',
        'source_link',
        'permitted_description',
        'open_access_link',
        'copyrighted_full_text_prohibited',
        'dataset_values_permitted',
        'pulse_summary',
        'provider_analysis'
    )),
    is_primary boolean NOT NULL DEFAULT false,
    CONSTRAINT research_provider_claims_identity UNIQUE (provider_id, external_id),
    CONSTRAINT research_provider_claims_source_https CHECK (source_url ~ '^https://'),
    CONSTRAINT research_provider_claims_external_id CHECK (length(trim(external_id)) > 0)
);

CREATE UNIQUE INDEX research_provider_claims_one_primary
    ON public.research_provider_claims (work_id)
    WHERE is_primary;

CREATE TABLE public.research_contributors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name text NOT NULL,
    CONSTRAINT research_contributors_name_unique UNIQUE (full_name)
);

CREATE TABLE public.research_resource_contributors (
    work_id uuid NOT NULL REFERENCES public.research_works (id) ON DELETE CASCADE,
    contributor_id uuid NOT NULL REFERENCES public.research_contributors (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('author', 'publisher')),
    PRIMARY KEY (work_id, contributor_id, role)
);

CREATE TABLE public.research_topics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL UNIQUE
);

CREATE TABLE public.research_resource_topics (
    work_id uuid NOT NULL REFERENCES public.research_works (id) ON DELETE CASCADE,
    topic_id uuid NOT NULL REFERENCES public.research_topics (id) ON DELETE CASCADE,
    PRIMARY KEY (work_id, topic_id)
);

CREATE TABLE public.research_licenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id uuid NOT NULL REFERENCES public.research_works (id) ON DELETE CASCADE,
    name text NOT NULL,
    url text,
    notes text,
    CONSTRAINT research_licenses_url_https CHECK (url IS NULL OR url ~ '^https://')
);

CREATE TABLE public.research_ingest_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id uuid REFERENCES public.research_providers (id),
    action text NOT NULL,
    status text NOT NULL,
    message text,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.research_providers (key, domain, is_enabled, attribution_text, base_url)
VALUES
    (
        'openalex',
        'research',
        true,
        'Work metadata is from OpenAlex (CC0). Pulse Analytics Group LLC is not the publisher of these works.',
        'https://api.openalex.org'
    ),
    (
        'manual',
        'research',
        true,
        'Curated by Pulse Analytics Group LLC.',
        NULL
    );

ALTER TABLE public.research_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_work_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_provider_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_resource_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_resource_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_ingest_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.research_providers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_works FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_work_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_provider_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_contributors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_resource_contributors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_resource_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_licenses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_ingest_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY research_providers_public_select
    ON public.research_providers
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY research_providers_admin_write
    ON public.research_providers
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_works_public_select
    ON public.research_works
    FOR SELECT
    TO anon, authenticated
    USING (status = 'published' OR public.is_admin());

CREATE POLICY research_works_admin_write
    ON public.research_works
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_identifiers_public_select
    ON public.research_work_identifiers
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

CREATE POLICY research_identifiers_admin_write
    ON public.research_work_identifiers
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_claims_public_select
    ON public.research_provider_claims
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

CREATE POLICY research_claims_admin_write
    ON public.research_provider_claims
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_contributors_public_select
    ON public.research_contributors
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.research_resource_contributors rc
            JOIN public.research_works w ON w.id = rc.work_id
            WHERE rc.contributor_id = research_contributors.id
              AND w.status = 'published'
        )
    );

CREATE POLICY research_contributors_admin_write
    ON public.research_contributors
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_resource_contributors_public_select
    ON public.research_resource_contributors
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

CREATE POLICY research_resource_contributors_admin_write
    ON public.research_resource_contributors
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_topics_public_select
    ON public.research_topics
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.research_resource_topics rt
            JOIN public.research_works w ON w.id = rt.work_id
            WHERE rt.topic_id = research_topics.id
              AND w.status = 'published'
        )
    );

CREATE POLICY research_topics_admin_write
    ON public.research_topics
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_resource_topics_public_select
    ON public.research_resource_topics
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

CREATE POLICY research_resource_topics_admin_write
    ON public.research_resource_topics
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_licenses_public_select
    ON public.research_licenses
    FOR SELECT
    TO anon, authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

CREATE POLICY research_licenses_admin_write
    ON public.research_licenses
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY research_ingest_runs_admin
    ON public.research_ingest_runs
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE
    public.research_providers,
    public.research_works,
    public.research_work_identifiers,
    public.research_provider_claims,
    public.research_contributors,
    public.research_resource_contributors,
    public.research_topics,
    public.research_resource_topics,
    public.research_licenses,
    public.research_ingest_runs
FROM PUBLIC, anon;

GRANT SELECT ON TABLE
    public.research_providers,
    public.research_works,
    public.research_work_identifiers,
    public.research_provider_claims,
    public.research_contributors,
    public.research_resource_contributors,
    public.research_topics,
    public.research_resource_topics,
    public.research_licenses
TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
    public.research_providers,
    public.research_works,
    public.research_work_identifiers,
    public.research_provider_claims,
    public.research_contributors,
    public.research_resource_contributors,
    public.research_topics,
    public.research_resource_topics,
    public.research_licenses
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.research_ingest_runs TO authenticated;
