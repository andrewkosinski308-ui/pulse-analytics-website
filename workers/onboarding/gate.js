const PAGES = [
  { id: "create", step: 1, paths: ["/account/create", "/account/create.html"], asset: "/account/create" },
  { id: "business", step: 2, paths: ["/account/business", "/account/business.html"], asset: "/account/business" },
  { id: "discovery", step: 3, paths: ["/account/discovery", "/account/discovery.html"], asset: "/account/discovery" },
  { id: "services", step: 4, paths: ["/account/services", "/account/services.html"], asset: "/account/services" },
  { id: "complete", step: 5, paths: ["/account/complete", "/account/complete.html"], asset: "/account/complete" }
];

const STEP_PATH = {
  1: "/account/create",
  2: "/account/business",
  3: "/account/discovery",
  4: "/account/services",
  5: "/account/complete"
};

function pageFor(pathname) {
  return PAGES.find((page) => page.paths.includes(pathname)) || null;
}

/**
 * Decide whether an onboarding URL can be served.
 * Future steps redirect to the current step. Completed accounts leave the form pages.
 */
export function onboardingDecision({ pathname, authenticated, role, active, step }) {
  const page = pageFor(pathname);
  if (!page) return null;

  if (!authenticated) {
    return page.step === 1
      ? { type: "serve", asset: page.asset }
      : { type: "redirect", location: "/account/create" };
  }

  if (role === "admin") return { type: "redirect", location: "/admin-portal.html" };
  if (role === "employee") return { type: "redirect", location: "/staff-workspace.html" };
  if (active === false) return { type: "redirect", location: "/client-login.html" };

  const current = Number(step);
  if (!Number.isInteger(current) || current < 1 || current > 5) {
    return { type: "redirect", location: "/account/create" };
  }

  if (current === 5) {
    return page.step === 5
      ? { type: "serve", asset: page.asset }
      : { type: "redirect", location: "/client-portal.html" };
  }

  if (page.step > current) return { type: "redirect", location: STEP_PATH[current] };
  return { type: "serve", asset: page.asset };
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const split = part.indexOf("=");
    if (split === -1) continue;
    if (part.slice(0, split) === name) return decodeURIComponent(part.slice(split + 1));
  }
  return "";
}

function applyDecision(request, env, decision) {
  if (decision.type === "redirect") {
    return Response.redirect(new URL(decision.location, request.url), 302);
  }
  const url = new URL(request.url);
  url.pathname = decision.asset;
  return env.ASSETS.fetch(new Request(url, request));
}

async function accountContext(token, env, fetchImpl) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) return null;
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`
  };
  const userRes = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
  const user = await userRes.json().catch(() => null);
  if (!userRes.ok || !/^[0-9a-f-]{36}$/i.test(user?.id || "")) return null;

  const profileUrl = new URL(`${env.SUPABASE_URL}/rest/v1/profiles`);
  profileUrl.searchParams.set("id", `eq.${user.id}`);
  profileUrl.searchParams.set("select", "role,is_active");
  const profileRes = await fetchImpl(profileUrl, { headers });
  const profiles = await profileRes.json().catch(() => null);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profileRes.ok || !profile) return null;

  const onboardRes = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/client_onboarding`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}"
  });
  const onboard = await onboardRes.json().catch(() => null);
  const step = onboardRes.ok && onboard && Number.isInteger(onboard.step) ? onboard.step : 1;
  return { role: profile.role, active: profile.is_active !== false, step };
}

export async function handleOnboardingRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (!pageFor(url.pathname)) return null;

  const token = readCookie(request, "pulse-access");
  if (!token) {
    return applyDecision(request, env, onboardingDecision({
      pathname: url.pathname,
      authenticated: false,
      role: null,
      active: true,
      step: 1
    }));
  }

  const context = await accountContext(token, env, fetchImpl);
  if (!context) {
    return applyDecision(request, env, onboardingDecision({
      pathname: url.pathname,
      authenticated: false,
      role: null,
      active: true,
      step: 1
    }));
  }

  return applyDecision(request, env, onboardingDecision({
    pathname: url.pathname,
    authenticated: true,
    role: context.role,
    active: context.active,
    step: context.step
  }));
}
