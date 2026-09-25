-- Anon catalog reads must not call is_admin().
-- That helper is executable by authenticated users only, and a draft row
-- would otherwise make a public read fail while the policy is evaluated.

DROP POLICY research_works_public_select ON public.research_works;
CREATE POLICY research_works_anon_select
    ON public.research_works
    FOR SELECT
    TO anon
    USING (status = 'published');
CREATE POLICY research_works_authenticated_select
    ON public.research_works
    FOR SELECT
    TO authenticated
    USING (status = 'published' OR public.is_admin());

DROP POLICY research_identifiers_public_select ON public.research_work_identifiers;
CREATE POLICY research_identifiers_anon_select
    ON public.research_work_identifiers
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
CREATE POLICY research_identifiers_authenticated_select
    ON public.research_work_identifiers
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

DROP POLICY research_claims_public_select ON public.research_provider_claims;
CREATE POLICY research_claims_anon_select
    ON public.research_provider_claims
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
CREATE POLICY research_claims_authenticated_select
    ON public.research_provider_claims
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

DROP POLICY research_contributors_public_select ON public.research_contributors;
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
        )
    );
CREATE POLICY research_contributors_authenticated_select
    ON public.research_contributors
    FOR SELECT
    TO authenticated
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

DROP POLICY research_resource_contributors_public_select ON public.research_resource_contributors;
CREATE POLICY research_resource_contributors_anon_select
    ON public.research_resource_contributors
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
CREATE POLICY research_resource_contributors_authenticated_select
    ON public.research_resource_contributors
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

DROP POLICY research_topics_public_select ON public.research_topics;
CREATE POLICY research_topics_anon_select
    ON public.research_topics
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1
            FROM public.research_resource_topics rt
            JOIN public.research_works w ON w.id = rt.work_id
            WHERE rt.topic_id = research_topics.id
              AND w.status = 'published'
        )
    );
CREATE POLICY research_topics_authenticated_select
    ON public.research_topics
    FOR SELECT
    TO authenticated
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

DROP POLICY research_resource_topics_public_select ON public.research_resource_topics;
CREATE POLICY research_resource_topics_anon_select
    ON public.research_resource_topics
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
CREATE POLICY research_resource_topics_authenticated_select
    ON public.research_resource_topics
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );

DROP POLICY research_licenses_public_select ON public.research_licenses;
CREATE POLICY research_licenses_anon_select
    ON public.research_licenses
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
CREATE POLICY research_licenses_authenticated_select
    ON public.research_licenses
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.research_works w
            WHERE w.id = work_id AND w.status = 'published'
        )
    );
