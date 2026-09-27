import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  checkoutFullyPaid,
  invoiceFullyPaid,
  nextClientStatus,
  oneTimeEngagementOpen,
  recurringEngagementOpen,
  shouldReconcileEngagement
} from "./client-lifecycle.js";

const lifecycleSql = readFileSync(
  new URL("../../supabase/migrations/20260927070000_client_lifecycle.sql", import.meta.url),
  "utf8"
);
const authSource = readFileSync(new URL("../../js/pulse-auth.js", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../../js/client-portal.js", import.meta.url), "utf8");
const onboardingSource = readFileSync(new URL("../../js/account-onboarding.js", import.meta.url), "utf8");

test("a new account stays in onboarding and completion makes a lead, not an active client", () => {
  assert.equal(nextClientStatus({ status: "onboarding", oneTimeOpen: 0, recordedEngagements: 0 }), "onboarding");
  assert.equal(nextClientStatus({ status: "onboarding", oneTimeOpen: 1, recordedEngagements: 1 }), "onboarding");
  assert.equal(lifecycleSql.includes("next_status := 'lead';"), true);
  assert.equal(lifecycleSql.includes("IF next_step = 5 AND rec.status = 'onboarding' THEN"), true);
  assert.equal(lifecycleSql.includes("next_status := 'active';"), false);
});

test("unpaid, failed, and partial payments are not full payment", () => {
  assert.equal(checkoutFullyPaid({ object: "checkout.session", status: "open", payment_status: "unpaid" }), false);
  assert.equal(checkoutFullyPaid({ object: "checkout.session", status: "complete", payment_status: "unpaid" }), false);
  assert.equal(checkoutFullyPaid({ object: "checkout.session", status: "complete", payment_status: "no_payment_required" }), false);
  assert.equal(checkoutFullyPaid({ object: "checkout.session", status: "complete", payment_status: "paid" }), true);
  assert.equal(invoiceFullyPaid({ object: "invoice", status: "open", amount_due: 100, amount_paid: 40 }), false);
  assert.equal(invoiceFullyPaid({ object: "invoice", status: "paid", amount_due: 0, amount_paid: 0 }), false);
  assert.equal(invoiceFullyPaid({ object: "invoice", status: "paid", amount_due: 100, amount_paid: 100 }), true);
  assert.equal(shouldReconcileEngagement({ eventType: "checkout.session.completed" }), false);
});

test("confirmed full payment activates a lead and a duplicate engagement does not add another state", () => {
  assert.equal(nextClientStatus({ status: "lead", oneTimeOpen: 1, recordedEngagements: 1 }), "active");
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 1, recordedEngagements: 1 }), "active");
  assert.equal(nextClientStatus({ status: "lead", recurringOpen: 1, recordedEngagements: 1 }), "active");
});

test("one-time fulfillment returns a lead only after every paid engagement is closed", () => {
  assert.equal(oneTimeEngagementOpen("planned", "one_time"), true);
  assert.equal(oneTimeEngagementOpen("active", "one_time"), true);
  assert.equal(oneTimeEngagementOpen("completed", "one_time"), false);
  assert.equal(oneTimeEngagementOpen("cancelled", "one_time"), false);
  assert.equal(oneTimeEngagementOpen("planned", "recurring"), false);
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 1, recordedEngagements: 1 }), "active");
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 0, recordedEngagements: 1 }), "lead");
  assert.equal(nextClientStatus({ status: "lead", oneTimeOpen: 1, recordedEngagements: 2 }), "active");
});

test("one completed service does not end the account while another engagement is open", () => {
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 1, recurringOpen: 0, recordedEngagements: 2 }), "active");
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 0, recurringOpen: 1, recordedEngagements: 2 }), "active");
  assert.equal(nextClientStatus({ status: "active", oneTimeOpen: 0, recurringOpen: 0, recordedEngagements: 2 }), "lead");
});

test("a recurring engagement stays active through billing and ends only when the subscription ends", () => {
  assert.equal(recurringEngagementOpen("active"), true);
  assert.equal(recurringEngagementOpen("trialing"), true);
  assert.equal(recurringEngagementOpen("past_due"), true);
  assert.equal(recurringEngagementOpen("canceled"), false);
  assert.equal(recurringEngagementOpen("unpaid"), false);
  assert.equal(recurringEngagementOpen("incomplete"), false);
  assert.equal(nextClientStatus({ status: "active", recurringOpen: 1, recordedEngagements: 1 }), "active");
  assert.equal(shouldReconcileEngagement({ eventType: "invoice.paid" }), true);
  assert.equal(nextClientStatus({ status: "active", recurringOpen: 0, recordedEngagements: 1 }), "lead");
});

test("existing active, lead, and onboarding accounts are not rewritten without a recorded engagement", () => {
  assert.equal(nextClientStatus({ status: "active", recordedEngagements: 0 }), "active");
  assert.equal(nextClientStatus({ status: "lead", recordedEngagements: 0 }), "lead");
  assert.equal(nextClientStatus({ status: "onboarding", recordedEngagements: 0 }), "onboarding");
  assert.equal(nextClientStatus({ status: "paused", oneTimeOpen: 1, recordedEngagements: 1 }), "paused");
  assert.equal(nextClientStatus({ status: "churned", recurringOpen: 1, recordedEngagements: 1 }), "churned");
});

test("portal access stays tied to finished onboarding, and the browser cannot assign active", () => {
  assert.equal(authSource.includes("Number(authState.client?.onboarding_step) === 5"), true);
  assert.equal(authSource.includes("client?.status === 'active'"), false);
  assert.equal(portalSource.includes(".from('clients').update"), false);
  assert.equal(onboardingSource.includes(".from('clients').update"), false);
  assert.equal(lifecycleSql.includes("Client status is assigned by the server."), true);
  assert.equal(lifecycleSql.includes("coalesce(auth.role(), '') IN ('anon', 'authenticated')"), true);
  assert.equal(lifecycleSql.includes("NOT public.is_staff()"), true);
});

test("the lifecycle migration reuses purchases and subscriptions and does not rewrite existing clients", () => {
  assert.equal(lifecycleSql.includes("UPDATE public.clients"), true);
  assert.equal(lifecycleSql.includes("ADD COLUMN IF NOT EXISTS onboarding_completed_at"), true);
  assert.equal(lifecycleSql.includes("pp.billing = 'one_time'"), true);
  assert.equal(lifecycleSql.includes("cs.status IN ('active', 'trialing', 'past_due')"), true);
  assert.equal(lifecycleSql.includes("A legacy active account with no recorded payment engagement stays active."), true);
  assert.equal(lifecycleSql.includes("DELETE FROM public.clients"), false);
  assert.equal(lifecycleSql.includes("CREATE TABLE public.leads"), false);
});
