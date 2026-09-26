/**
 * Pulse Analytics Group LLC - edge router (Cloudflare Workers + Static Assets)
 *
 * Responsibilities:
 * 1. Redirect HTTP and www requests for the production domain to the canonical HTTPS host (301).
 * 2. Redirect legacy Pulse domains to the production host (301).
 * 3. Redirect known obsolete/incorrect paths to current production paths (301).
 * 4. Serve the Industry Research Library API from the Pulse catalog.
 * 5. Serve the Market Intelligence API. Census requests stay on the Worker.
 * 6. Serve the Marketing Benchmarks catalog.
 * 7. Create and confirm Stripe Embedded Checkout sessions.
 * 8. Pass all other requests to static assets (custom 404.html via not_found_handling).
 *
 * Does not redirect unknown URLs to the homepage.
 * Does not redirect the canonical HTTPS host to itself.
 */

import { handleBenchmarksRequest } from "./benchmarks/api.js";
import { handleCheckoutRequest } from "./checkout/api.js";
import { handleMarketIntelligenceRequest } from "./market-intelligence/api.js";
import { handleResearchRequest } from "./research/api.js";

const PRODUCTION_HOST = "pulseanalyticsgroupllc.com";
const WWW_HOST = `www.${PRODUCTION_HOST}`;

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

/**
 * Original visitor scheme. Cloudflare may present an HTTPS URL while CF-Visitor
 * still records that the visitor used HTTP.
 * @param {URL} url
 * @param {Request} request
 * @returns {"http" | "https"}
 */
function requestScheme(url, request) {
  const visitor = request.headers.get("CF-Visitor");
  if (visitor) {
    try {
      const parsed = JSON.parse(visitor);
      if (parsed?.scheme === "http" || parsed?.scheme === "https") return parsed.scheme;
    } catch {
      // Ignore a malformed visitor header and use the request URL.
    }
  }
  const forwarded = request.headers.get("X-Forwarded-Proto");
  const forwardedScheme = forwarded?.split(",")[0].trim().toLowerCase();
  if (forwardedScheme === "http" || forwardedScheme === "https") return forwardedScheme;
  return url.protocol === "http:" ? "http" : "https";
}

/**
 * One permanent redirect to the canonical HTTPS host, or null when the request
 * is already canonical and the path does not need rewriting.
 * @param {URL} url
 * @param {Request} request
 * @returns {string | null}
 */
function canonicalLocation(url, request) {
  const host = url.hostname.toLowerCase();
  const rewrittenPath = rewritePathname(url.pathname);
  const scheme = requestScheme(url, request);
  const onProductionDomain = host === PRODUCTION_HOST || host === WWW_HOST || LEGACY_HOSTS.has(host);
  const hostNeedsCanonical = host === WWW_HOST || LEGACY_HOSTS.has(host);
  const schemeNeedsHttps = onProductionDomain && scheme === "http";
  const pathChanged = rewrittenPath !== url.pathname;
  if (!hostNeedsCanonical && !schemeNeedsHttps && !pathChanged) return null;

  const dest = new URL(url.href);
  dest.protocol = "https:";
  dest.port = "";
  if (hostNeedsCanonical) dest.hostname = PRODUCTION_HOST;
  dest.pathname = rewrittenPath;
  const location = dest.toString();
  if (scheme === "https" && location === url.toString()) return null;
  return location;
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const location = canonicalLocation(url, request);
    if (location) return Response.redirect(location, 301);

    if (url.pathname.startsWith("/api/research/")) {
      return handleResearchRequest(request, env);
    }

    if (url.pathname.startsWith("/api/market-intelligence/")) {
      return handleMarketIntelligenceRequest(request, env);
    }

    if (url.pathname.startsWith("/api/benchmarks")) {
      return handleBenchmarksRequest(request);
    }

    if (url.pathname.startsWith("/api/checkout/")) {
      return handleCheckoutRequest(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
