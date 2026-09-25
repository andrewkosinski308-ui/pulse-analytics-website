-- Analytics, AI, and UX starter collections.
-- Curated external links only. No article bodies and no new research works.

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
            'analytics-for-beginners',
            'Analytics for beginners and small businesses',
            'A beginner-friendly guide to setting up Google Analytics, finding reports, understanding basic data, measuring important business actions, managing access, and connecting Analytics with Google Ads.',
            'Google Analytics',
            'https://developers.google.com/analytics/learn/beginners',
            'analytics-measurement'
        ),
        (
            'overview-of-google-analytics-reports',
            'Overview of Google Analytics reports',
            'An introduction to Google Analytics reports and how businesses can use them to monitor traffic, investigate data, and understand users and their activity.',
            'Google Analytics',
            'https://support.google.com/analytics/answer/9212670',
            'analytics-measurement'
        ),
        (
            'about-key-events',
            'About key events',
            'Explains key events in Google Analytics and how businesses can use important user actions to understand performance and improve their marketing.',
            'Google Analytics',
            'https://support.google.com/analytics/answer/9267568',
            'analytics-measurement'
        ),
        (
            'conversions-vs-key-events',
            'Conversions vs. key events in Google Analytics',
            'Explains the current difference between key events in Google Analytics and conversions used for advertising measurement and optimization.',
            'Google Analytics',
            'https://support.google.com/analytics/answer/13965727',
            'analytics-measurement'
        ),
        (
            'get-started-with-attribution',
            'Get started with attribution',
            'Explains how Google Analytics assigns credit to different marketing touchpoints and how attribution can be used to understand the paths users take before important actions.',
            'Google Analytics',
            'https://support.google.com/analytics/answer/10596866',
            'analytics-measurement'
        ),
        (
            'introduction-to-audiences',
            'Introduction to audiences in Google Analytics',
            'Explains what audiences are in Google Analytics, how they are created from user characteristics and behavior, and how they can be used for reporting and marketing.',
            'Google Analytics',
            'https://support.google.com/analytics/answer/12799087',
            'analytics-measurement'
        ),
        (
            'identifying-and-scaling-ai-use-cases',
            'Identifying and scaling AI use cases',
            'A practical guide for organizations looking for useful ways to apply AI, identify business use cases, prioritize opportunities, and move from experimentation toward broader use.',
            'OpenAI',
            'https://openai.com/business/guides-and-resources/identifying-and-scaling-ai-use-cases/',
            'ai-marketing-technology'
        ),
        (
            'guide-to-ai-in-marketing',
            'A guide to AI in marketing',
            'An overview of AI in marketing covering common concepts, applications, customer insights, automation, data analysis, and ways businesses can incorporate AI into marketing activities.',
            'IBM',
            'https://www.ibm.com/think/topics/ai-in-marketing',
            'ai-marketing-technology'
        ),
        (
            'utilizing-ai-in-marketing-automation',
            'Utilizing AI in Marketing Automation',
            'Explains how AI can be used within marketing automation for data analysis, audience segmentation, personalization, campaign optimization, and automated decision-making.',
            'IBM',
            'https://www.ibm.com/think/topics/ai-marketing-automation',
            'ai-marketing-technology'
        ),
        (
            'what-is-ai-marketing',
            'What is AI Marketing?',
            'A plain-language introduction to AI in marketing, including predictive AI, generative AI, analytics, personalization, automation, and common marketing applications.',
            'Salesforce',
            'https://www.salesforce.com/marketing/ai/',
            'ai-marketing-technology'
        ),
        (
            'marketing-automation-guide',
            'Your guide to marketing automation',
            'A practical introduction to marketing automation, including how automation works, common business uses, lead nurturing, customer interactions, and workflow automation.',
            'Zapier',
            'https://zapier.com/blog/marketing-automation-use-cases/',
            'ai-marketing-technology'
        ),
        (
            'ten-usability-heuristics',
            '10 Usability Heuristics for User Interface Design',
            'Ten broad usability principles that can be used to identify common problems in website and interface design.',
            'Nielsen Norman Group',
            'https://www.nngroup.com/articles/ten-usability-heuristics/',
            'websites-ux-conversion'
        ),
        (
            'usability-testing-101',
            'Usability (User) Testing 101',
            'An introduction to usability testing and how observing people use a website or product can reveal problems, opportunities, and user behavior.',
            'Nielsen Norman Group',
            'https://www.nngroup.com/articles/usability-testing-101/',
            'websites-ux-conversion'
        ),
        (
            'learn-responsive-design',
            'Learn Responsive Design',
            'A practical course covering responsive layouts, media queries, responsive images, typography, accessibility, interaction, and designing websites for different devices and screen sizes.',
            'web.dev',
            'https://web.dev/learn/design',
            'websites-ux-conversion'
        ),
        (
            'learn-accessibility',
            'Learn Accessibility',
            'An evergreen introduction to digital accessibility covering how to design and build websites that people with disabilities can use effectively.',
            'web.dev',
            'https://web.dev/learn/accessibility',
            'websites-ux-conversion'
        ),
        (
            'accessibility-fundamentals-overview',
            'Accessibility Fundamentals Overview',
            'An introduction to web accessibility, why accessibility matters, how people with disabilities use the web, and where to begin learning about accessible websites.',
            'W3C Web Accessibility Initiative',
            'https://www.w3.org/WAI/fundamentals/',
            'websites-ux-conversion'
        ),
        (
            'wcag-2-overview',
            'WCAG 2 Overview',
            'An overview of the Web Content Accessibility Guidelines and the relationship between WCAG 2.0, 2.1, and 2.2.',
            'W3C Web Accessibility Initiative',
            'https://www.w3.org/WAI/standards-guidelines/wcag/',
            'websites-ux-conversion'
        ),
        (
            'learn-performance',
            'Learn Performance',
            'A practical course introducing web performance and explaining how website speed and performance affect the experience of people using a site.',
            'web.dev',
            'https://web.dev/learn/performance',
            'websites-ux-conversion'
        ),
        (
            'understanding-page-experience',
            'Understanding page experience in Google Search results',
            'Explains page experience considerations in Google Search, including Core Web Vitals, mobile usability, HTTPS, intrusive interstitials, and overall page experience.',
            'Google Search Central',
            'https://developers.google.com/search/docs/appearance/page-experience',
            'websites-ux-conversion'
        ),
        (
            'how-to-conduct-a-heuristic-evaluation',
            'How to Conduct a Heuristic Evaluation',
            'A practical guide to systematically reviewing a website or product for potential usability and experience problems using recognized usability heuristics.',
            'Nielsen Norman Group',
            'https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/',
            'websites-ux-conversion'
        )
) AS v(slug, title, description, publisher, external_url, category_slug)
JOIN public.research_categories c ON c.slug = v.category_slug
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
        ('analytics-for-beginners', 'web-analytics'),
        ('overview-of-google-analytics-reports', 'web-analytics'),
        ('overview-of-google-analytics-reports', 'marketing-measurement'),
        ('about-key-events', 'web-analytics'),
        ('about-key-events', 'marketing-measurement'),
        ('conversions-vs-key-events', 'marketing-measurement'),
        ('conversions-vs-key-events', 'attribution'),
        ('get-started-with-attribution', 'attribution'),
        ('get-started-with-attribution', 'marketing-measurement'),
        ('introduction-to-audiences', 'web-analytics'),
        ('introduction-to-audiences', 'marketing-measurement'),
        ('identifying-and-scaling-ai-use-cases', 'ai-in-marketing'),
        ('identifying-and-scaling-ai-use-cases', 'martech'),
        ('guide-to-ai-in-marketing', 'ai-in-marketing'),
        ('guide-to-ai-in-marketing', 'marketing-automation'),
        ('utilizing-ai-in-marketing-automation', 'marketing-automation'),
        ('utilizing-ai-in-marketing-automation', 'ai-in-marketing'),
        ('what-is-ai-marketing', 'ai-in-marketing'),
        ('what-is-ai-marketing', 'personalization'),
        ('marketing-automation-guide', 'marketing-automation'),
        ('marketing-automation-guide', 'martech'),
        ('ten-usability-heuristics', 'user-experience'),
        ('ten-usability-heuristics', 'usability'),
        ('usability-testing-101', 'user-experience'),
        ('usability-testing-101', 'usability'),
        ('learn-responsive-design', 'user-experience'),
        ('learn-responsive-design', 'website-performance'),
        ('learn-accessibility', 'accessibility'),
        ('learn-accessibility', 'user-experience'),
        ('accessibility-fundamentals-overview', 'accessibility'),
        ('accessibility-fundamentals-overview', 'user-experience'),
        ('wcag-2-overview', 'accessibility'),
        ('learn-performance', 'website-performance'),
        ('learn-performance', 'user-experience'),
        ('understanding-page-experience', 'website-performance'),
        ('understanding-page-experience', 'user-experience'),
        ('how-to-conduct-a-heuristic-evaluation', 'usability'),
        ('how-to-conduct-a-heuristic-evaluation', 'user-experience')
) AS v(resource_slug, topic_slug)
JOIN public.research_curated_resources r ON r.slug = v.resource_slug
JOIN public.research_topics t ON t.slug = v.topic_slug AND t.status = 'active' AND t.category_id IS NOT NULL
ON CONFLICT (resource_id, topic_id) DO NOTHING;
