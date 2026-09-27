import { startAuthScene } from "./auth-scene.js";
import { INDUSTRIES, INTERESTS, MARKETS, ONBOARDING_PAGES, US_STATES } from "./onboarding-catalog.js";
import { validateOnboarding } from "./onboarding-rules.js";
import { getAuthState, getSupabase, initAuth, signOut, signUpClient } from "./pulse-auth.js";

const STEP = Number(document.body.dataset.onboardingStep || 0);
const statusEl = document.getElementById("onboard-status");
const bodyEl = document.getElementById("onboard-body");
const alertEl = document.getElementById("onboard-alert");
const form = document.querySelector("[data-onboarding-form]");

function reveal(message) {
  if (statusEl) {
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
  }
  if (bodyEl) bodyEl.hidden = Boolean(message);
}

function showAlert(message) {
  if (!alertEl) return;
  alertEl.textContent = message || "";
  alertEl.classList.toggle("is-visible", Boolean(message));
}

function friendly(error) {
  const message = String(error?.message || "");
  if (/jwt|session|sign in/i.test(message)) return "Your session expired. Sign in to continue.";
  if (/^[A-Z][^<>]{0,180}$/.test(message) && !/relation|syntax|function|column|policy/i.test(message)) return message;
  return "We could not save this step. Try again.";
}

function showErrors(errors) {
  document.querySelectorAll("[data-error-for]").forEach((el) => {
    const message = errors[el.dataset.errorFor] || "";
    el.textContent = message;
    el.hidden = !message;
  });
  Object.keys(errors).forEach((key) => {
    const field = form?.querySelector(`[name="${key}"]`);
    if (field) field.setAttribute("aria-invalid", "true");
  });
  form?.querySelectorAll("[aria-invalid='true']").forEach((field) => {
    if (!errors[field.name]) field.removeAttribute("aria-invalid");
  });
  const first = Object.keys(errors)[0];
  form?.querySelector(`[name="${first}"]`)?.focus();
}

function go(path, direction) {
  sessionStorage.setItem("pulse-onboarding-direction", direction);
  window.location.assign(path);
}

async function readOnboarding() {
  const { data, error } = await getSupabase().rpc("client_onboarding");
  if (error) throw new Error(friendly(error));
  return data;
}

async function saveOnboarding(step, payload) {
  const { data, error } = await getSupabase().rpc("save_client_onboarding", {
    p_step: step,
    p_payload: payload
  });
  if (error) throw new Error(friendly(error));
  return data;
}

function selectedValues(name) {
  return [...document.querySelectorAll(`[data-choice="${name}"][aria-pressed="true"]`)].map((el) => el.dataset.value);
}

function bindPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
      button.setAttribute("aria-pressed", showing ? "false" : "true");
    });
  });
}

function bindBack() {
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.back, "back"));
  });
}

function bindSignOut() {
  document.getElementById("onboard-signout")?.addEventListener("click", async () => {
    try {
      await signOut();
      window.location.replace("/client-login.html");
    } catch (error) {
      showAlert(error.message || "Sign-out failed.");
    }
  });
}

function fillStates(selected) {
  const select = form?.querySelector("[name='region']");
  if (!select) return;
  select.innerHTML = `<option value="">Choose a state</option>${US_STATES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("")}`;
  select.value = selected || "";
}

function renderIndustries(selected) {
  const list = document.getElementById("industry-list");
  const search = document.getElementById("industry-search");
  const detail = document.getElementById("industry-detail-wrap");
  if (!list) return;
  const draw = () => {
    const query = (search?.value || "").trim().toLowerCase();
    const items = INDUSTRIES.filter((item) => item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query));
    list.innerHTML = items.map((item) => `
      <button type="button" class="choice" data-choice="industry" data-value="${item.id}" aria-pressed="${item.id === selected ? "true" : "false"}">
        <strong>${item.label}</strong>
        <small>${item.detail}</small>
      </button>
    `).join("");
    if (detail) detail.hidden = selected !== "other";
  };
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-choice='industry']");
    if (!button) return;
    selected = button.dataset.value;
    draw();
  });
  search?.addEventListener("input", draw);
  draw();
}

function renderMarkets(selected) {
  const list = document.getElementById("market-list");
  if (!list) return;
  const chosen = new Set(selected || []);
  list.innerHTML = MARKETS.map((item) => `
    <button type="button" class="chip" data-choice="markets" data-value="${item.id}" aria-pressed="${chosen.has(item.id) ? "true" : "false"}">${item.label}</button>
  `).join("");
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-choice='markets']");
    if (!button) return;
    const pressed = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  });
}

function renderServices(record) {
  const list = document.getElementById("service-list");
  const note = document.getElementById("interest-note-wrap");
  if (!list) return;
  const chosen = new Set(record.interests || []);
  let primary = record.primary_interest || "";
  const sync = () => {
    list.querySelectorAll(".service-card").forEach((card) => {
      const selected = chosen.has(card.dataset.value);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
      card.dataset.primary = selected && card.dataset.value === primary ? "true" : "false";
      const toggle = card.querySelector(".primary-toggle");
      if (toggle) {
        toggle.hidden = !selected;
        toggle.setAttribute("aria-pressed", card.dataset.primary);
        toggle.textContent = card.dataset.primary === "true" ? "Primary service" : "Make primary";
      }
    });
    if (note) note.hidden = !chosen.has("other");
  };
  list.innerHTML = INTERESTS.map((item) => `
    <article class="service-card" data-choice="interests" data-value="${item.id}" role="button" tabindex="0" aria-pressed="false" data-primary="false">
      <span class="service-mark" aria-hidden="true">${item.label.slice(0, 1)}</span>
      <strong>${item.label}</strong>
      <small>${item.detail}</small>
      <button type="button" class="primary-toggle" hidden>Make primary</button>
    </article>
  `).join("");
  list.addEventListener("click", (event) => {
    const toggle = event.target.closest(".primary-toggle");
    const card = event.target.closest(".service-card");
    if (!card) return;
    if (toggle) {
      primary = card.dataset.value;
      sync();
      return;
    }
    if (chosen.has(card.dataset.value)) {
      chosen.delete(card.dataset.value);
      if (primary === card.dataset.value) primary = "";
    } else {
      chosen.add(card.dataset.value);
      if (chosen.size === 1) primary = card.dataset.value;
    }
    sync();
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(".primary-toggle")) return;
    const card = event.target.closest(".service-card");
    if (!card) return;
    event.preventDefault();
    card.click();
  });
  sync();
  return () => ({ interests: [...chosen], primary_interest: primary });
}

function valuesFor(step, serviceState) {
  if (step === 1) {
    return {
      existing: document.body.dataset.accountExists === "true",
      full_name: form.full_name.value,
      email: form.email.value,
      password: form.password?.value || "",
      confirm: form.confirm?.value || ""
    };
  }
  if (step === 2) {
    return {
      business_name: form.business_name.value,
      address_line: form.address_line.value,
      city: form.city.value,
      region: form.region.value,
      postal_code: form.postal_code.value,
      phone: form.phone.value
    };
  }
  if (step === 3) {
    return {
      industry: selectedValues("industry")[0] || "",
      industry_detail: form.industry_detail.value,
      markets: selectedValues("markets"),
      market_summary: form.market_summary.value
    };
  }
  const services = serviceState?.() || { interests: [], primary_interest: "" };
  return { ...services, interest_note: form.interest_note?.value || "" };
}

function fill(record) {
  if (!form || !record) return;
  if (STEP === 1) {
    form.full_name.value = record.full_name || "";
    form.email.value = record.email || "";
    form.email.readOnly = true;
    document.body.dataset.accountExists = "true";
    document.getElementById("password-fields").hidden = true;
    document.getElementById("create-copy").textContent = "Your sign-in is already saved. You can update your name, then continue.";
  }
  if (STEP === 2) {
    form.business_name.value = record.business_name || "";
    form.address_line.value = record.address_line || "";
    form.city.value = record.city || "";
    fillStates(record.region);
    form.postal_code.value = record.postal_code || "";
    form.phone.value = record.phone || "";
  }
  if (STEP === 3) {
    renderIndustries(record.industry || "");
    renderMarkets(record.markets || []);
    form.market_summary.value = record.market_summary || "";
    form.industry_detail.value = record.industry_detail || "";
  }
  if (STEP === 4) {
    form.interest_note.value = record.interest_note || "";
  }
}

async function guard(record) {
  const auth = getAuthState();
  if (auth.profile?.role === "admin") {
    window.location.replace("/admin-portal.html");
    return false;
  }
  if (auth.profile?.role === "employee") {
    window.location.replace("/staff-workspace.html");
    return false;
  }
  if (auth.profile?.is_active === false) {
    window.location.replace("/client-login.html");
    return false;
  }
  if (!auth.authenticated) {
    if (STEP !== 1) window.location.replace("/account/create");
    return STEP === 1;
  }
  const current = Number(record?.step || auth.client?.onboarding_step || 0);
  if (current === 5 && STEP !== 5) {
    window.location.replace("/client-portal.html");
    return false;
  }
  if (current && STEP > current) {
    window.location.replace(ONBOARDING_PAGES[current] || "/account/create");
    return false;
  }
  return true;
}

async function boot() {
  const direction = sessionStorage.getItem("pulse-onboarding-direction");
  sessionStorage.removeItem("pulse-onboarding-direction");
  document.body.classList.add(direction === "back" ? "enter-back" : "enter-forward");
  startAuthScene();
  bindBack();
  bindSignOut();
  bindPasswordToggles();
  if (STEP === 2) fillStates("");

  try {
    await initAuth();
  } catch (error) {
    reveal("");
    showAlert(error.message || "Unable to start account setup.");
    return;
  }

  const auth = getAuthState();
  if (auth.authenticated) document.getElementById("onboard-signout")?.removeAttribute("hidden");
  if (STEP === 1 && !auth.authenticated) {
    bindCreate(false);
    reveal("");
    return;
  }

  let record = null;
  if (auth.authenticated) {
    try {
      record = await readOnboarding();
    } catch (error) {
      reveal("");
      showAlert(error.message);
      return;
    }
  }

  if (!(await guard(record))) return;
  fill(record);
  let serviceState = null;
  if (STEP === 3) {
    /* rendered in fill */
  }
  if (STEP === 4) serviceState = renderServices(record || {});
  if (STEP === 1) bindCreate(true);
  if (STEP > 1 && STEP < 5) bindSave(serviceState);
  reveal("");
}

function bindCreate(existing) {
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert("");
    const button = form.querySelector("[type='submit']");
    const result = validateOnboarding(1, valuesFor(1));
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      if (existing || document.body.dataset.accountExists === "true") {
        await saveOnboarding(1, { full_name: result.value.full_name });
        go("/account/business", "forward");
        return;
      }
      const created = await signUpClient({
        fullName: result.value.full_name,
        email: result.value.email,
        password: result.value.password
      });
      if (created.needsEmailConfirmation) {
        document.getElementById("confirm-panel").hidden = false;
        document.getElementById("confirm-email").textContent = created.email;
        form.hidden = true;
        return;
      }
      go("/account/business", "forward");
    } catch (error) {
      showAlert(error.message || "We could not create the account. Try again.");
      button.disabled = false;
      button.textContent = "Continue";
    }
  });
}

function bindSave(serviceState) {
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert("");
    const button = form.querySelector("[type='submit']");
    const result = validateOnboarding(STEP, valuesFor(STEP, serviceState));
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const saved = await saveOnboarding(STEP, result.value);
      const next = Number(saved?.step || STEP + 1);
      go(ONBOARDING_PAGES[next] || "/account/complete", "forward");
    } catch (error) {
      showAlert(error.message || "We could not save this step. Try again.");
      button.disabled = false;
      button.textContent = "Continue";
    }
  });
}

boot();
