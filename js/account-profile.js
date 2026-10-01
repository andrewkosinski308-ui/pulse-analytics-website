import { INDUSTRIES, INTERESTS, MARKETS } from "./onboarding-catalog.js";

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "UTC"
];

const NOTIFICATION_KEYS = ["email_reports", "email_billing", "email_support"];

export function personalPayload(input = {}) {
  const first = String(input.first_name || "").trim();
  const last = String(input.last_name || "").trim();
  const full = String(input.full_name || "").trim() || `${first} ${last}`.trim();
  const requested = String(input.timezone || "").trim();
  const timezone = TIMEZONES.includes(requested) || /^[A-Za-z]+(?:\/[A-Za-z_+-]+)+$/.test(requested)
    ? requested
    : null;
  const current = input.notification_preferences && typeof input.notification_preferences === "object"
    ? input.notification_preferences
    : {};
  const preferences = {};
  for (const key of NOTIFICATION_KEYS) {
    if (input[key] === true || input[key] === "on") preferences[key] = true;
    else if (input[key] === false || input[key] === "off") preferences[key] = false;
    else preferences[key] = Boolean(current[key]);
  }
  return {
    first_name: first || null,
    last_name: last || null,
    full_name: full || null,
    phone: String(input.phone || "").trim() || null,
    timezone: timezone || null,
    notification_preferences: preferences
  };
}

export function emailChangeRequest(email) {
  const next = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return { error: "Enter a valid email address." };
  return { email: next };
}

export function businessPayload(input = {}) {
  const text = (key, max) => {
    const value = String(input[key] || "").trim();
    return value ? value.slice(0, max) : null;
  };
  return {
    name: text("name", 200),
    legal_name: text("legal_name", 200),
    website: text("website", 300),
    industry: text("industry", 80),
    phone: text("phone", 40),
    address_line: text("address_line", 200),
    city: text("city", 80),
    region: text("region", 80),
    postal_code: text("postal_code", 20),
    market_summary: text("market_summary", 2000),
    industry_detail: text("industry_detail", 2000),
    interest_note: text("interest_note", 2000)
  };
}

export function readPersonalForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of ["email_reports", "email_billing", "email_support"]) {
    data[key] = form.elements[key]?.checked ? "on" : "off";
  }
  return data;
}

export function readInterestForm(form) {
  const selected = [...form.querySelectorAll('input[name="interest"]:checked')].map((input) => input.value);
  const primary = form.querySelector('input[name="primary_interest"]:checked')?.value || "";
  return interestSelection(selected, selected.includes(primary) ? primary : "");
}

export function readMarketForm(form) {
  return [...form.querySelectorAll('input[name="market"]:checked')].map((input) => input.value);
}

export function interestSelection(selected = [], primary = "") {
  const slugs = [...new Set(selected.map((slug) => String(slug || "").trim()).filter(Boolean))];
  return slugs.map((slug) => ({ slug, is_primary: slug === primary }));
}

export function serviceChangeRequest({ action, catalogId, subscriptionId }) {
  if (!["add", "upgrade", "downgrade", "remove"].includes(action)) {
    return { error: "That service change is not available." };
  }
  if (action !== "remove" && !catalogId) return { error: "Choose a service." };
  if (action !== "add" && !subscriptionId) return { error: "Choose an active service." };
  return {
    action,
    catalogId: action === "remove" ? undefined : catalogId,
    subscriptionId: action === "add" ? undefined : subscriptionId
  };
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function personalFieldsHtml(profile = {}) {
  const prefs = profile.notification_preferences || {};
  const zones = TIMEZONES.includes(profile.timezone) || !profile.timezone
    ? TIMEZONES
    : [profile.timezone, ...TIMEZONES];
  const box = (key, label) => `<label><input type="checkbox" name="${key}"${prefs[key] ? " checked" : ""}> ${esc(label)}</label>`;
  return `<label>First name<input name="first_name" value="${esc(profile.first_name)}" maxlength="80" autocomplete="given-name"></label>
    <label>Last name<input name="last_name" value="${esc(profile.last_name)}" maxlength="80" autocomplete="family-name"></label>
    <label>Display name<input name="full_name" value="${esc(profile.full_name)}" maxlength="200" autocomplete="name"></label>
    <label>Phone<input name="phone" value="${esc(profile.phone)}" maxlength="40" autocomplete="tel"></label>
    <label>Timezone<select name="timezone">${zones.map((zone) => `<option value="${esc(zone)}"${profile.timezone === zone ? " selected" : ""}>${esc(zone)}</option>`).join("")}</select></label>
    <fieldset>
      <legend>Notification preferences</legend>
      ${box("email_reports", "Email me about reports")}
      ${box("email_billing", "Email me about billing")}
      ${box("email_support", "Email me about support")}
    </fieldset>`;
}

export function businessFieldsHtml(client = {}) {
  const field = (name, label, value, max = 200) => `<label>${label}<input name="${name}" value="${esc(value)}" maxlength="${max}"></label>`;
  const industries = [`<option value="">Select an industry</option>`].concat(INDUSTRIES.map((item) => `<option value="${esc(item.id)}"${client.industry === item.id ? " selected" : ""}>${esc(item.label)}</option>`));
  if (client.industry && !INDUSTRIES.some((item) => item.id === client.industry)) {
    industries.push(`<option value="${esc(client.industry)}" selected>${esc(client.industry)}</option>`);
  }
  return `${field("name", "Business name", client.name)}
    ${field("legal_name", "Legal name", client.legal_name)}
    ${field("phone", "Business phone", client.phone, 40)}
    ${field("website", "Website", client.website, 300)}
    <label>Industry<select name="industry">${industries.join("")}</select></label>
    <label>Industry detail<textarea name="industry_detail" maxlength="2000">${esc(client.industry_detail)}</textarea></label>
    ${field("address_line", "Address", client.address_line)}
    ${field("city", "City", client.city, 80)}
    ${field("region", "State", client.region, 80)}
    ${field("postal_code", "ZIP", client.postal_code, 20)}
    <label>Market description<textarea name="market_summary" maxlength="2000">${esc(client.market_summary)}</textarea></label>
    <label>Other service note<textarea name="interest_note" maxlength="2000">${esc(client.interest_note)}</textarea></label>`;
}

export function interestFieldsHtml(selected = []) {
  const chosen = new Map(selected.map((item) => [item.slug, Boolean(item.is_primary)]));
  return INTERESTS.map((item) => `<label><input type="checkbox" name="interest" value="${esc(item.id)}"${chosen.has(item.id) ? " checked" : ""}> ${esc(item.label)}</label>
    <label><input type="radio" name="primary_interest" value="${esc(item.id)}"${chosen.get(item.id) ? " checked" : ""}> Primary</label>`).join("");
}

export function marketFieldsHtml(selected = []) {
  const chosen = new Set(selected);
    return MARKETS.map((item) => `<label><input type="checkbox" name="market" value="${esc(item.id)}"${chosen.has(item.id) ? " checked" : ""}> ${esc(item.label)}</label>`).join("");
}
