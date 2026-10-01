import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const client = read("client-login.html");
const admin = read("admin-login.html");
const create = read("account/create.html");
const scene = read("js/auth-scene.js");
const onboarding = read("js/account-onboarding.js");
const lifecycle = read("supabase/migrations/20260927070000_client_lifecycle.sql");

test("client sign-in uses the account creation scene and keeps sign-in behavior", () => {
  assert.match(client, /class="onboard-scene"/);
  assert.match(client, /Welcome back\./);
  assert.match(client, /Sign in to your Pulse Analytics client account\./);
  assert.match(client, /Client Portal/);
  assert.match(client, /href="\/account\/create"/);
  assert.match(client, /client-forgot-password\.html/);
  assert.match(client, /id="client-login-form"/);
  assert.match(client, /id="toggle-password"/);
  assert.match(client, /aria-label="Show password"/);
  assert.match(client, /autocomplete="username"/);
  assert.match(client, /autocomplete="current-password"/);
  assert.match(client, /signIn\(email, password\)/);
  assert.match(client, /clientEntryPath\(authState\)/);
  assert.match(client, /redirectAuthenticatedClientAwayFromLogin/);
  assert.doesNotMatch(client, /service_role|SERVICE_ROLE/);
  assert.doesNotMatch(client, /clients\.status/);
});

test("admin sign-in uses the same scene and the shared portal login", () => {
  assert.match(admin, /class="onboard-scene"/);
  assert.match(admin, /Welcome back\./);
  assert.match(admin, /Sign in to the Pulse Analytics Admin \/ Staff Portal\./);
  assert.match(admin, /Pulse Analytics administrators and staff/);
  assert.match(admin, /Keep me signed in on this browser/);
  assert.match(admin, /id="admin-login-form" class="onboard-form" hidden/);
  assert.match(admin, /id="toggle-password"/);
  assert.match(admin, /signIn\(email, password, 'portal'\)/);
  assert.match(admin, /loginRedirectDestination\(authState\)/);
  assert.match(admin, /setAdminPersistPreference\(remember\.checked\)/);
  assert.match(admin, /window\.location\.replace\(destination\)/);
  assert.doesNotMatch(admin, /signIn\(email, password, 'admin'\)/);
  assert.doesNotMatch(admin, /service_role|SERVICE_ROLE/);
  assert.doesNotMatch(admin, /href="\/account\/create"/);
});

test("password reset pages keep the existing reset calls", () => {
  const clientReset = read("client-forgot-password.html");
  const adminReset = read("admin-forgot-password.html");
  assert.match(clientReset, /class="onboard-scene"/);
  assert.match(clientReset, /await resetPassword\(email\)/);
  assert.match(clientReset, /href="\/client-login\.html"/);
  assert.match(adminReset, /class="onboard-scene"/);
  assert.match(adminReset, /await resetPassword\(email, 'admin-update-password\.html'\)/);
  assert.match(adminReset, /Pulse Analytics administrators and staff/);
});

test("account creation stays the visual source and shares the background field", () => {
  assert.match(create, /Create your account/);
  assert.match(create, /class="onboard-scene"/);
  assert.match(create, /css\/account-onboarding\.css/);
  assert.doesNotMatch(create, /auth-shell\.css/);
  assert.match(onboarding, /startAuthScene\(\)/);
  assert.doesNotMatch(onboarding, /getElementById\("onboard-field"\)/);
  assert.match(read("css/auth-shell.css"), /max-width: 860px[\s\S]*\.auth-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(scene, /prefers-reduced-motion: reduce/);
  assert.match(scene, /max-width: 860px/);
  assert.doesNotMatch(scene, /supabase|signIn|service_role/);
});

test("lifecycle engine is unchanged by the sign-in shell", () => {
  assert.match(lifecycle, /Client status is assigned by the server/);
  assert.match(lifecycle, /sync_client_engagement_status/);
});
