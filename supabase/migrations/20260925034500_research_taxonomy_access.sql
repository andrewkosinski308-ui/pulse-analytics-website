-- Phase 1.5: Pulse-owned categories and topics, topic governance, and the
-- public/premium/internal access boundary.
--
-- access_tier answers who may see a Pulse catalog record.
-- rights_class answers what Pulse may store or display from the source.
-- A premium tier does not grant rights to copyrighted full text.
--
-- OpenAlex labels must not create or rename these rows. Slugs are stable.
-- Display names can change. A material scope change is a new topic, not a
-- slug rewrite. Merges are manual: move relationships, then deprecate the
-- old topic and set replacement_topic_id. Do not fuzzy-merge.
--
-- audit_logs already records entity_type, entity_id, and metadata, so
-- taxonomy writes reuse it. A separate taxonomy log is not required.

ALTER TABLE public.research_works
    ADD COLUMN access_tier text NOT NULL DEFAULT 'public'
        CHECK (access_tier IN ('public', 'premium', 'internal'));

COMMENT ON COLUMN public.research_works.access_tier IS
    'Who may access this Pulse catalog record: public, premium, or internal. Independent of rights_class.';

CREATE INDEX research_works_public_catalog_idx
    ON public.research_works (publication_date DESC NULLS LAST, title)
    WHERE status = 'published' AND access_tier = 'public';

CREATE TABLE public.research_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    display_name text NOT NULL,
    description text NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT research_categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT research_categories_sort_positive CHECK (sort_order > 0)
);

ALTER TABLE public.research_topics
    ADD COLUMN category_id uuid REFERENCES public.research_categories (id) ON DELETE RESTRICT,
    ADD COLUMN display_name text,
    ADD COLUMN description text,
    ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
    ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN deprecated_at timestamptz,
    ADD COLUMN deprecated_reason text,
    ADD COLUMN replacement_topic_id uuid REFERENCES public.research_topics (id) ON DELETE RESTRICT;

UPDATE public.research_topics
SET display_name = name
WHERE display_name IS NULL;

ALTER TABLE public.research_topics
    ALTER COLUMN display_name SET NOT NULL;

ALTER TABLE public.research_topics
    ADD CONSTRAINT research_topics_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT research_topics_sort_nonnegative CHECK (sort_order >= 0),
    ADD CONSTRAINT research_topics_not_own_replacement CHECK (
        replacement_topic_id IS NULL OR replacement_topic_id <> id
    ),
    ADD CONSTRAINT research_topics_deprecation_fields CHECK (
        (
            status = 'active'
            AND deprecated_at IS NULL
            AND deprecated_reason IS NULL
        )
        OR (
            status = 'deprecated'
            AND deprecated_at IS NOT NULL
            AND deprecated_reason IS NOT NULL
            AND length(trim(deprecated_reason)) > 0
        )
    );

CREATE INDEX research_topics_category_sort_idx
    ON public.research_topics (category_id, sort_order);

CREATE INDEX research_topics_replacement_idx
    ON public.research_topics (replacement_topic_id);

CREATE TABLE public.research_topic_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id uuid NOT NULL REFERENCES public.research_topics (id) ON DELETE CASCADE,
    alias text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT research_topic_aliases_unique UNIQUE (alias),
    CONSTRAINT research_topic_aliases_present CHECK (length(trim(alias)) > 0)
);

CREATE INDEX research_topic_aliases_topic_idx
    ON public.research_topic_aliases (topic_id);

CREATE OR REPLACE FUNCTION public.research_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER research_categories_touch
    BEFORE UPDATE ON public.research_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.research_touch_updated_at();

CREATE TRIGGER research_topics_touch
    BEFORE UPDATE ON public.research_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.research_touch_updated_at();

CREATE OR REPLACE FUNCTION public.research_reject_unassignable_topic()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.research_topics t
        WHERE t.id = NEW.topic_id
          AND t.status = 'active'
          AND t.category_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'only active controlled topics can be assigned'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER research_resource_topics_controlled
    BEFORE INSERT OR UPDATE OF topic_id ON public.research_resource_topics
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
        SELECT 1 FROM public.research_topics t WHERE t.replacement_topic_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'topics with research records or replacements cannot be deleted'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER research_topics_no_dependent_delete
    BEFORE DELETE ON public.research_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.research_reject_topic_delete();

CREATE OR REPLACE FUNCTION public.research_audit_taxonomy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (
            auth.uid(),
            lower(TG_OP),
            TG_TABLE_NAME,
            NEW.id,
            jsonb_build_object('slug', NEW.slug)
        );
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.research_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.research_reject_unassignable_topic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.research_reject_topic_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.research_audit_taxonomy() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER research_categories_audit
    AFTER INSERT OR UPDATE ON public.research_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.research_audit_taxonomy();

CREATE TRIGGER research_topics_audit
    AFTER INSERT OR UPDATE ON public.research_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.research_audit_taxonomy();

INSERT INTO public.research_categories (slug, display_name, description, sort_order)
VALUES
    ('search-seo', 'Search & SEO', 'Research on search engines, search behavior, organic visibility, SEO practices, and how people discover information online.', 1),
    ('analytics-measurement', 'Analytics & Measurement', 'Research on marketing measurement, web analytics, attribution, experimentation, data quality, and methods for evaluating performance.', 2),
    ('ai-marketing-technology', 'AI & Marketing Technology', 'Research on artificial intelligence, generative AI, marketing automation, martech systems, personalization, and human use of marketing technology.', 3),
    ('websites-ux-conversion', 'Websites, UX & Conversion', 'Research on website usability, user experience, conversion behavior, accessibility, landing pages, and digital performance.', 4)
ON CONFLICT (slug) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

INSERT INTO public.research_topics (slug, name, display_name, description, status, sort_order, category_id)
SELECT v.slug, v.display_name, v.display_name, v.description, 'active', v.sort_order, c.id
FROM (
    VALUES
        ('seo', 'SEO', 'Research on search engine optimization, organic visibility, ranking systems, and search-oriented website practices.', 1, 'search-seo'),
        ('search-behavior', 'Search Behavior', 'Research on how people search, choose results, refine queries, and interact with search systems.', 2, 'search-seo'),
        ('local-search', 'Local Search', 'Research on local discovery, location-based search behavior, and how people find nearby businesses and services.', 3, 'search-seo'),
        ('search-engines', 'Search Engines', 'Research concerning search engines, retrieval systems, indexing, ranking, and search result presentation.', 4, 'search-seo'),
        ('information-retrieval', 'Information Retrieval', 'Research on methods for finding, organizing, ranking, and retrieving relevant information from large collections.', 5, 'search-seo'),
        ('web-analytics', 'Web Analytics', 'Research on measuring website behavior, traffic, engagement, conversions, and digital interactions.', 1, 'analytics-measurement'),
        ('marketing-measurement', 'Marketing Measurement', 'Research on evaluating marketing activity, outcomes, effectiveness, and performance.', 2, 'analytics-measurement'),
        ('attribution', 'Attribution', 'Research on methods for connecting marketing activity with customer actions and business outcomes.', 3, 'analytics-measurement'),
        ('experimentation', 'Experimentation', 'Research on controlled testing, A/B testing, causal inference, and methods for evaluating changes.', 4, 'analytics-measurement'),
        ('data-quality', 'Data Quality', 'Research on the accuracy, completeness, consistency, reliability, and usability of marketing and business data.', 5, 'analytics-measurement'),
        ('ai-in-marketing', 'AI in Marketing', 'Research examining how artificial intelligence is used in marketing activities, workflows, and decision support.', 1, 'ai-marketing-technology'),
        ('generative-ai', 'Generative AI', 'Research on systems that generate text, images, audio, video, code, or other marketing-related content.', 2, 'ai-marketing-technology'),
        ('marketing-automation', 'Marketing Automation', 'Research on automated marketing workflows, lead processes, customer communication, and campaign operations.', 3, 'ai-marketing-technology'),
        ('martech', 'Marketing Technology', 'Research on technologies and systems used to plan, execute, measure, and manage marketing activity.', 4, 'ai-marketing-technology'),
        ('personalization', 'Personalization', 'Research on tailoring digital experiences, content, recommendations, and communications to individuals or segments.', 5, 'ai-marketing-technology'),
        ('user-experience', 'User Experience', 'Research on how people experience, understand, navigate, and interact with digital products and websites.', 1, 'websites-ux-conversion'),
        ('usability', 'Usability', 'Research on ease of use, learnability, efficiency, error prevention, and user interaction with websites and software.', 2, 'websites-ux-conversion'),
        ('conversion-optimization', 'Conversion Optimization', 'Research on factors that influence desired actions such as inquiries, registrations, purchases, and sign-ups.', 3, 'websites-ux-conversion'),
        ('landing-pages', 'Landing Pages', 'Research on the design, messaging, structure, and performance of pages built around specific user actions.', 4, 'websites-ux-conversion'),
        ('accessibility', 'Accessibility', 'Research on making websites and digital experiences usable by people with disabilities and different access needs.', 5, 'websites-ux-conversion'),
        ('website-performance', 'Website Performance', 'Research on page speed, responsiveness, technical performance, and their relationship to digital experiences and outcomes.', 6, 'websites-ux-conversion')
) AS v(slug, display_name, description, sort_order, category_slug)
JOIN public.research_categories c ON c.slug = v.category_slug
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    category_id = EXCLUDED.category_id,
    updated_at = now()
WHERE public.research_topics.status IS DISTINCT FROM 'deprecated';

ALTER TABLE public.research_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.research_topic_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_topic_aliases FORCE ROW LEVEL SECURITY;

DROP POLICY research_works_anon_select ON public.research_works;
CREATE POLICY research_works_anon_select
    ON public.research_works
    FOR SELECT
    TO anon
    USING (status = 'published' AND access_tier = 'public');

DROP POLICY research_works_authenticated_select ON public.research_works;
CREATE POLICY research_works_authenticated_select
    ON public.research_works
    FOR SELECT
    TO authenticated
    USING (
        (status = 'published' AND access_tier = 'public')
        OR (SELECT public.is_admin())
    );

DROP POLICY research_identifiers_anon_select ON public.research_work_identifiers;
CREATE POLICY research_identifiers_anon_select
    ON public.research_work_identifiers
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_identifiers_authenticated_select ON public.research_work_identifiers;
CREATE POLICY research_identifiers_authenticated_select
    ON public.research_work_identifiers
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_claims_anon_select ON public.research_provider_claims;
CREATE POLICY research_claims_anon_select
    ON public.research_provider_claims
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_claims_authenticated_select ON public.research_provider_claims;
CREATE POLICY research_claims_authenticated_select
    ON public.research_provider_claims
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_contributors_anon_select ON public.research_contributors;
CREATE POLICY research_contributors_anon_select
    ON public.research_contributors
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1
            FROM public.research_resource_contributors rc
            JOIN public.research_works w ON w.id = rc.work_id
            WHERE rc.contributor_id = research_contributors.id
              AND w.status = 'published'
              AND w.access_tier = 'public'
        )
    );

DROP POLICY research_contributors_authenticated_select ON public.research_contributors;
CREATE POLICY research_contributors_authenticated_select
    ON public.research_contributors
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1
            FROM public.research_resource_contributors rc
            JOIN public.research_works w ON w.id = rc.work_id
            WHERE rc.contributor_id = research_contributors.id
              AND w.status = 'published'
              AND w.access_tier = 'public'
        )
    );

DROP POLICY research_resource_contributors_anon_select ON public.research_resource_contributors;
CREATE POLICY research_resource_contributors_anon_select
    ON public.research_resource_contributors
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_resource_contributors_authenticated_select ON public.research_resource_contributors;
CREATE POLICY research_resource_contributors_authenticated_select
    ON public.research_resource_contributors
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_topics_anon_select ON public.research_topics;
CREATE POLICY research_topics_anon_select
    ON public.research_topics
    FOR SELECT
    TO anon
    USING (
        (status = 'active' AND category_id IS NOT NULL)
        OR EXISTS (
            SELECT 1
            FROM public.research_resource_topics rt
            JOIN public.research_works w ON w.id = rt.work_id
            WHERE rt.topic_id = research_topics.id
              AND w.status = 'published'
              AND w.access_tier = 'public'
        )
    );

DROP POLICY research_topics_authenticated_select ON public.research_topics;
CREATE POLICY research_topics_authenticated_select
    ON public.research_topics
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR (status = 'active' AND category_id IS NOT NULL)
        OR EXISTS (
            SELECT 1
            FROM public.research_resource_topics rt
            JOIN public.research_works w ON w.id = rt.work_id
            WHERE rt.topic_id = research_topics.id
              AND w.status = 'published'
              AND w.access_tier = 'public'
        )
    );

DROP POLICY research_resource_topics_anon_select ON public.research_resource_topics;
CREATE POLICY research_resource_topics_anon_select
    ON public.research_resource_topics
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_resource_topics_authenticated_select ON public.research_resource_topics;
CREATE POLICY research_resource_topics_authenticated_select
    ON public.research_resource_topics
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_licenses_anon_select ON public.research_licenses;
CREATE POLICY research_licenses_anon_select
    ON public.research_licenses
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

DROP POLICY research_licenses_authenticated_select ON public.research_licenses;
CREATE POLICY research_licenses_authenticated_select
    ON public.research_licenses
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published' AND w.access_tier = 'public'
        )
    );

CREATE POLICY research_categories_select
    ON public.research_categories
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY research_categories_admin_write
    ON public.research_categories
    FOR ALL
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY research_topic_aliases_admin
    ON public.research_topic_aliases
    FOR ALL
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.research_categories, public.research_topic_aliases FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.research_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.research_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.research_topic_aliases TO authenticated;
