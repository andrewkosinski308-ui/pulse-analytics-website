/**
 * Pulse Analytics Group LLC - edge router (Cloudflare Workers + Static Assets)
 *
 * Responsibilities:
 * 1. Redirect legacy Pulse domains to the production host (301).
 * 2. Redirect known obsolete/incorrect paths to current production paths (301).
 * 3. Pass all other requests to static assets (custom 404.html via not_found_handling).
 *
 * Does not redirect unknown URLs to the homepage.
 */

const PRODUCTION_HOST = "pulseanalyticsgroupllc.com";

const LEGACY_HOSTS = new Set([
  "www.pulseanalyticsgroup.com",
  "pulseanalyticsgroup.com",
]);

/** Exact obsolete paths -> current sitemap/canonical paths. */
const EXACT_PATH_REDIRECTS = new Map([
  ["/blog.html", "/resources/blog.html"],
]);

/**
 * Rewrite known obsolete pathnames. Preserve path otherwise.
 * @param {string} pathname
 * @returns {string}
 */
function rewritePathname(pathname) {
  const exact = EXACT_PATH_REDIRECTS.get(pathname);
  if (exact) return exact;

  // Established case-sensitive directory mismatches (Linux/Cloudflare static assets)
  if (pathname.startsWith("/Solutions/")) {
    return "/solutions/" + pathname.slice("/Solutions/".length);
  }
  if (pathname.startsWith("/Resources/")) {
    return "/resources/" + pathname.slice("/Resources/".length);
  }

  return pathname;
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;
    const rewrittenPath = rewritePathname(pathname);

    const hostIsLegacy = LEGACY_HOSTS.has(host);
    const pathChanged = rewrittenPath !== pathname;

    if (hostIsLegacy || pathChanged) {
      const dest = new URL(url.href);
      if (hostIsLegacy) {
        dest.protocol = "https:";
        dest.hostname = PRODUCTION_HOST;
      }
      dest.pathname = rewrittenPath;
      return Response.redirect(dest.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
