/**
 * Local Supabase browser config (DO NOT COMMIT real keys in shared repos if policy requires).
 * Copy from supabase-env.example.js and fill in values from .env.local / Supabase Dashboard.
 *
 * Publishable anon key only — never the service-role key.
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
