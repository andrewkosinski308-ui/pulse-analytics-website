import { INDUSTRIES, INTERESTS, MARKETS, US_STATES } from "./onboarding-catalog.js";

const INDUSTRY_IDS = new Set(INDUSTRIES.map((item) => item.id));
const MARKET_IDS = new Set(MARKETS.map((item) => item.id));
const INTEREST_IDS = new Set(INTERESTS.map((item) => item.id));
const STATE_IDS = new Set(US_STATES.map(([code]) => code));

function clean(value) {
  return String(value ?? "").trim();
}

function lengthError(value, min, max, message) {
  const text = clean(value);
  if (text.length < min || text.length > max) return message;
  return "";
}

/**
 * Browser-side checks. The database function enforces the same rules again.
 * @returns {{ ok: boolean, errors: Record<string, string>, value: object }}
 */
export function validateOnboarding(step, input) {
  const errors = {};
  const value = {};

  if (step === 1) {
    value.full_name = clean(input.full_name);
    value.email = clean(input.email).toLowerCase();
    value.password = String(input.password ?? "");
    value.confirm = String(input.confirm ?? "");
    value.existing = Boolean(input.existing);
    if (lengthError(value.full_name, 2, 120, "Enter your full name.")) errors.full_name = "Enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254) {
      errors.email = "Enter a valid email address.";
    }
    if (!value.existing) {
      if (value.password.length < 8 || !/[A-Za-z]/.test(value.password) || !/\d/.test(value.password)) {
        errors.password = "Use at least 8 characters with a letter and a number.";
      }
      if (value.password !== value.confirm) errors.confirm = "Passwords do not match.";
    }
  }

  if (step === 2) {
    value.business_name = clean(input.business_name);
    value.address_line = clean(input.address_line);
    value.city = clean(input.city);
    value.region = clean(input.region).toUpperCase();
    value.postal_code = clean(input.postal_code);
    value.phone = clean(input.phone);
    if (lengthError(value.business_name, 2, 160, "name")) errors.business_name = "Enter the full business name.";
    if (lengthError(value.address_line, 4, 160, "address")) errors.address_line = "Enter the business street address.";
    if (lengthError(value.city, 2, 80, "city")) errors.city = "Enter the city.";
    if (!STATE_IDS.has(value.region)) errors.region = "Choose a state.";
    if (!/^\d{5}(-\d{4})?$/.test(value.postal_code)) errors.postal_code = "Enter a 5-digit ZIP code.";
    const digits = value.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15 || value.phone.length > 30) {
      errors.phone = "Enter a business phone number.";
    }
  }

  if (step === 3) {
    value.industry = clean(input.industry);
    value.industry_detail = clean(input.industry_detail);
    value.market_summary = clean(input.market_summary);
    value.markets = [...new Set((Array.isArray(input.markets) ? input.markets : []).map(clean))].filter(Boolean);
    if (!INDUSTRY_IDS.has(value.industry)) errors.industry = "Choose the industry that best fits the business.";
    if (value.industry === "other" && lengthError(value.industry_detail, 2, 120, "detail")) {
      errors.industry_detail = "Describe the industry.";
    }
    if (!value.markets.length || value.markets.some((item) => !MARKET_IDS.has(item))) {
      errors.markets = "Choose at least one market.";
    }
    if (lengthError(value.market_summary, 10, 400, "market")) {
      errors.market_summary = "Describe the market this business operates in.";
    }
  }

  if (step === 4) {
    value.interests = [...new Set((Array.isArray(input.interests) ? input.interests : []).map(clean))].filter(Boolean);
    value.primary_interest = clean(input.primary_interest);
    value.interest_note = clean(input.interest_note);
    if (!value.interests.length || value.interests.some((item) => !INTEREST_IDS.has(item))) {
      errors.interests = "Choose at least one service.";
    }
    if (!value.interests.includes(value.primary_interest)) {
      errors.primary_interest = "Choose one primary service from the services you selected.";
    }
    if (value.interests.includes("other") && lengthError(value.interest_note, 2, 160, "note")) {
      errors.interest_note = "Describe the other service interest.";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}
