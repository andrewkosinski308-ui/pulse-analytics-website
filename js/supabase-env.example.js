/**
 * Local Supabase browser config template.
 *
 * Local development:
 *   1. Copy this file to js/supabase-env.js (gitignored)
 *   2. Set url + anonKey (publishable/anon only — never service-role)
 *   3. Leave siteUrl empty to use window.location.origin
 *
 * Cloudflare production (Approach A — preferred):
 *   Do NOT commit js/supabase-env.js.
 *   Before `npx wrangler deploy`, run:
 *     npm run generate:supabase-env
 *   Configure these Cloudflare build/deploy environment variables:
 *     SUPABASE_URL          — https://<project-ref>.supabase.co
 *     SUPABASE_ANON_KEY     — publishable/anon key
 *     PULSE_SITE_URL        — optional; e.g. https://pulseanalyticsgroupllc.com
 *
 * Suggested Cloudflare build command (runs before wrangler deploy):
 *   npm run build
 * Deploy command remains:
 *   npx wrangler deploy
 */
window.PULSE_SUPABASE = {
  url: 'https://gultqhsccxuqvibymwdg.supabase.co',
  anonKey: 'REPLACE_WITH_ANON_OR_PUBLISHABLE_KEY',
  /**
   * Optional override for Auth email redirect base (no trailing slash).
   * Leave empty to use window.location.origin (recommended for local Live Server).
   * Production example: 'https://pulseanalyticsgroupllc.com'
   */
  siteUrl: ''
};
