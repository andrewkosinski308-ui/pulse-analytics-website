-- Search & SEO collection: curated Google links plus two OpenAlex studies.
-- Research works stay research works. Google pages are external links only.

CREATE TABLE public.research_curated_resources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    description text NOT NULL,
    publisher text NOT NULL,
    external_url text NOT NULL UNIQUE,
    resource_type text NOT NULL DEFAULT 'official-guide',
    category_id uuid NOT NULL REFERENCES public.research_categories (id),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    access_tier text NOT NULL DEFAULT 'public' CHECK (access_tier IN ('public', 'premium', 'internal')),
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
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT research_curated_resources_https CHECK (external_url ~ '^https://'),
    CONSTRAINT research_curated_resources_text CHECK (
        length(trim(title)) > 0
        AND length(trim(description)) > 0
        AND length(trim(publisher)) > 0
    ),
    CONSTRAINT research_curated_resources_link_only CHECK (
        status <> 'published'
        OR rights_class = 'source_link'
    )
);

CREATE TABLE public.research_curated_resource_topics (
    resource_id uuid NOT NULL REFERENCES public.research_curated_resources (id) ON DELETE CASCADE,
    topic_id uuid NOT NULL REFERENCES public.research_topics (id) ON DELETE RESTRICT,
    PRIMARY KEY (resource_id, topic_id)
);

CREATE INDEX research_curated_resources_public_idx
    ON public.research_curated_resources (title)
    WHERE status = 'published' AND access_tier = 'public';

CREATE TRIGGER research_curated_resources_touch
    BEFORE UPDATE ON public.research_curated_resources
    FOR EACH ROW
    EXECUTE FUNCTION public.research_touch_updated_at();

CREATE TRIGGER research_curated_resource_topics_controlled
    BEFORE INSERT OR UPDATE OF topic_id ON public.research_curated_resource_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.research_reject_unassignable_topic();

CREATE OR REPLACE FUNCTION public.research_reject_topic_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.research_resource_topics rt WHERE rt.topic_id = OLD.id
    ) OR EXISTS (
        SELECT 1 FROM public.research_curated_resource_topics ct WHERE ct.topic_id = OLD.id
    ) OR EXISTS (
        SELECT 1 FROM public.research_topics t WHERE t.replacement_topic_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'topics with research records or replacements cannot be deleted'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.research_reject_topic_delete() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.research_curated_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_curated_resources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_curated_resource_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_curated_resource_topics FORCE ROW LEVEL SECURITY;

CREATE POLICY research_curated_resources_anon_select
    ON public.research_curated_resources
    FOR SELECT
    TO anon
    USING (status = 'published' AND access_tier = 'public');

CREATE POLICY research_curated_resources_authenticated_select
    ON public.research_curated_resources
    FOR SELECT
    TO authenticated
    USING (
        (status = 'published' AND access_tier = 'public')
        OR (SELECT public.is_admin())
    );

CREATE POLICY research_curated_resources_admin_write
    ON public.research_curated_resources
    FOR ALL
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY research_curated_resource_topics_anon_select
    ON public.research_curated_resource_topics
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_curated_resources r
            WHERE r.id = resource_id AND r.status = 'published' AND r.access_tier = 'public'
        )
    );

CREATE POLICY research_curated_resource_topics_authenticated_select
    ON public.research_curated_resource_topics
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_curated_resources r
            WHERE r.id = resource_id AND r.status = 'published' AND r.access_tier = 'public'
        )
    );

CREATE POLICY research_curated_resource_topics_admin_write
    ON public.research_curated_resource_topics
    FOR ALL
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

REVOKE ALL ON TABLE
    public.research_curated_resources,
    public.research_curated_resource_topics
FROM PUBLIC, anon;

GRANT SELECT ON TABLE
    public.research_curated_resources,
    public.research_curated_resource_topics
TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
    public.research_curated_resources,
    public.research_curated_resource_topics
TO authenticated;

INSERT INTO public.research_curated_resources (
    slug, title, description, publisher, external_url, resource_type,
    category_id, status, access_tier, rights_class
)
SELECT
    v.slug,
    v.title,
    v.description,
    v.publisher,
    v.external_url,
    'official-guide',
    c.id,
    'published',
    'public',
    'source_link'
FROM (
    VALUES
        (
            'seo-starter-guide',
            'SEO Starter Guide',
            'A practical introduction to SEO for website owners, covering the fundamentals of helping search engines understand and discover website content.',
            'Google Search Central',
            'https://developers.google.com/search/docs/fundamentals/seo-starter-guide'
        ),
        (
            'google-search-essentials',
            'Google Search Essentials',
            'Google''s core guidance covering the technical requirements, spam policies, and best practices that help make websites eligible to appear in Google Search.',
            'Google Search Central',
            'https://developers.google.com/search/docs/essentials'
        ),
        (
            'how-google-search-works',
            'How Google Search Works',
            'An explanation of how Google discovers, crawls, indexes, and serves web pages in Search.',
            'Google Search Central',
            'https://developers.google.com/search/docs/fundamentals/how-search-works'
        ),
        (
            'search-console-performance-report',
            'Performance Report (Search results)',
            'Explains how to use Search Console performance data, including clicks, impressions, CTR, average position, queries, pages, countries, devices, and search appearance.',
            'Google Search Console',
            'https://support.google.com/webmasters/answer/7576553'
        ),
        (
            'search-console-performance-tasks',
            'Performance Report: Common Tasks & Use Cases',
            'Practical guidance for using Search Console performance data to investigate queries, pages, traffic, and changes in search visibility.',
            'Google Search Console',
            'https://support.google.com/webmasters/answer/17010961'
        ),
        (
            'url-inspection-tool',
            'URL Inspection Tool',
            'Shows what Google knows about a specific page, including indexing information, and provides tools for testing the live URL.',
            'Google Search Console',
            'https://support.google.com/webmasters/answer/9012289'
        ),
        (
            'page-indexing-report',
            'Page Indexing Report',
            'Helps website owners understand which pages Google has indexed and identify pages with indexing problems.',
            'Google Search Console',
            'https://support.google.com/webmasters/answer/7440203'
        ),
        (
            'sitemaps-report',
            'Sitemaps Report',
            'Explains how to submit and manage sitemaps in Search Console and when sitemap submission can be useful.',
            'Google Search Console',
            'https://support.google.com/webmasters/answer/7451001'
        )
) AS v(slug, title, description, publisher, external_url)
JOIN public.research_categories c ON c.slug = 'search-seo'
ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    publisher = EXCLUDED.publisher,
    external_url = EXCLUDED.external_url,
    category_id = EXCLUDED.category_id,
    status = EXCLUDED.status,
    access_tier = EXCLUDED.access_tier,
    rights_class = EXCLUDED.rights_class;

INSERT INTO public.research_curated_resource_topics (resource_id, topic_id)
SELECT r.id, t.id
FROM (
    VALUES
        ('seo-starter-guide', 'seo'),
        ('seo-starter-guide', 'search-engines'),
        ('google-search-essentials', 'seo'),
        ('google-search-essentials', 'search-engines'),
        ('how-google-search-works', 'search-engines'),
        ('how-google-search-works', 'information-retrieval'),
        ('search-console-performance-report', 'seo'),
        ('search-console-performance-report', 'search-behavior'),
        ('search-console-performance-tasks', 'seo'),
        ('search-console-performance-tasks', 'search-behavior'),
        ('url-inspection-tool', 'search-engines'),
        ('url-inspection-tool', 'seo'),
        ('page-indexing-report', 'search-engines'),
        ('page-indexing-report', 'seo'),
        ('sitemaps-report', 'search-engines'),
        ('sitemaps-report', 'seo')
) AS v(resource_slug, topic_slug)
JOIN public.research_curated_resources r ON r.slug = v.resource_slug
JOIN public.research_topics t ON t.slug = v.topic_slug AND t.status = 'active' AND t.category_id IS NOT NULL
ON CONFLICT (resource_id, topic_id) DO NOTHING;

-- OpenAlex identity fields come from the existing normalizer.
-- Public summaries are Pulse wording so the university study is not presented as a general rule.
INSERT INTO public.research_works (
    title, resource_type, publication_date, slug, status, access_tier,
    provider_id, source_url, external_id, retrieved_at, rights_class, summary,
    open_access, doi, venue, limitations_unknown
)
SELECT
    v.title,
    'article',
    v.publication_date::date,
    v.slug,
    'published',
    'public',
    p.id,
    v.source_url,
    v.external_id,
    timestamptz '2026-09-25T04:40:00Z',
    'pulse_summary',
    v.summary,
    true,
    v.doi,
    v.venue,
    true
FROM (
    VALUES
        (
            'Deciphering the Visibility of Higher Education Institutions: A Statistical Analysis of Google Search Console Data',
            '2023-04-30',
            'deciphering-higher-education-search-visibility',
            'https://doi.org/10.62527/ijasce.5.1.131',
            'W4393383960',
            'A 2023 study of Google Search Console data from one public university website, including clicks, impressions, CTR, average position, and search queries. The results describe that institution. They are not a general rule for every business.',
            '10.62527/ijasce.5.1.131',
            'International Journal of Advanced Science Computing and Engineering'
        ),
        (
            'Query sampler: generating query sets for analyzing search engines using keyword research tools',
            '2023-06-07',
            'query-sampler',
            'https://doi.org/10.7717/peerj-cs.1421',
            'W4379794770',
            'A 2023 methods paper on using keyword research tools to build sets of search queries for studying search engines. It is about how those query sets are created, not a ranking formula for a specific business.',
            '10.7717/peerj-cs.1421',
            'PeerJ Computer Science'
        )
) AS v(title, publication_date, slug, source_url, external_id, summary, doi, venue)
JOIN public.research_providers p ON p.key = 'openalex'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.research_works existing
    WHERE existing.provider_id = p.id
      AND existing.external_id = v.external_id
);

INSERT INTO public.research_work_identifiers (work_id, scheme, value)
SELECT w.id, v.scheme, v.value
FROM (
    VALUES
        ('W4393383960', 'openalex', 'W4393383960'),
        ('W4393383960', 'doi', '10.62527/ijasce.5.1.131'),
        ('W4379794770', 'openalex', 'W4379794770'),
        ('W4379794770', 'doi', '10.7717/peerj-cs.1421')
) AS v(external_id, scheme, value)
JOIN public.research_providers p ON p.key = 'openalex'
JOIN public.research_works w ON w.provider_id = p.id AND w.external_id = v.external_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.research_work_identifiers i
    WHERE i.scheme = v.scheme AND i.value = v.value
);

INSERT INTO public.research_provider_claims (
    work_id, provider_id, external_id, source_url, retrieved_at, rights_class, is_primary
)
SELECT w.id, w.provider_id, w.external_id, w.source_url, w.retrieved_at, 'metadata', true
FROM public.research_works w
JOIN public.research_providers p ON p.id = w.provider_id
WHERE p.key = 'openalex'
  AND w.external_id IN ('W4393383960', 'W4379794770')
  AND NOT EXISTS (
      SELECT 1 FROM public.research_provider_claims c
      WHERE c.provider_id = w.provider_id AND c.external_id = w.external_id
  );

INSERT INTO public.research_contributors (full_name)
SELECT v.full_name
FROM (
    VALUES
        ('Ikhwan Arief'),
        ('Sebastian Schultheiß'),
        ('Dirk Lewandowski'),
        ('Sonja von Mach'),
        ('Nurce Yagci')
) AS v(full_name)
WHERE NOT EXISTS (
    SELECT 1 FROM public.research_contributors c WHERE c.full_name = v.full_name
);

INSERT INTO public.research_resource_contributors (work_id, contributor_id, role)
SELECT w.id, c.id, 'author'
FROM (
    VALUES
        ('W4393383960', 'Ikhwan Arief'),
        ('W4379794770', 'Sebastian Schultheiß'),
        ('W4379794770', 'Dirk Lewandowski'),
        ('W4379794770', 'Sonja von Mach'),
        ('W4379794770', 'Nurce Yagci')
) AS v(external_id, full_name)
JOIN public.research_providers p ON p.key = 'openalex'
JOIN public.research_works w ON w.provider_id = p.id AND w.external_id = v.external_id
JOIN public.research_contributors c ON c.full_name = v.full_name
ON CONFLICT (work_id, contributor_id, role) DO NOTHING;

INSERT INTO public.research_resource_topics (work_id, topic_id)
SELECT w.id, t.id
FROM (
    VALUES
        ('W4393383960', 'seo'),
        ('W4393383960', 'search-engines'),
        ('W4379794770', 'seo'),
        ('W4379794770', 'search-behavior')
) AS v(external_id, topic_slug)
JOIN public.research_providers p ON p.key = 'openalex'
JOIN public.research_works w ON w.provider_id = p.id AND w.external_id = v.external_id
JOIN public.research_topics t ON t.slug = v.topic_slug AND t.status = 'active' AND t.category_id IS NOT NULL
ON CONFLICT (work_id, topic_id) DO NOTHING;

INSERT INTO public.research_licenses (work_id, name, url, notes)
SELECT w.id, 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/',
    'OpenAlex metadata is CC0. This record stores metadata and a source link only.'
FROM public.research_works w
JOIN public.research_providers p ON p.id = w.provider_id
WHERE p.key = 'openalex'
  AND w.external_id IN ('W4393383960', 'W4379794770')
  AND NOT EXISTS (
      SELECT 1 FROM public.research_licenses l WHERE l.work_id = w.id
  );
