/**
 * Commercial lifecycle for a portal account.
 * Onboarding completion produces a lead. A lead becomes active only while a
 * qualifying paid engagement is open. The database function is the authority;
 * this module is the same rule set used by tests and webhook decisions.
 */

const PRESERVED = new Set(["onboarding", "paused", "churned"]);
const OPEN_ONE_TIME = new Set(["planned", "active", "on_hold"]);
const OPEN_RECURRING = new Set(["active", "trialing", "past_due"]);
const ENGAGEMENT_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted"
]);

export function nextClientStatus({
  status,
  oneTimeOpen = 0,
  recurringOpen = 0,
  recordedEngagements = 0
}) {
  if (PRESERVED.has(status)) return status;
  if (oneTimeOpen > 0 || recurringOpen > 0) {
    return status === "lead" || status === "active" ? "active" : status;
  }
  if (status === "active" && recordedEngagements > 0) return "lead";
  return status;
}

export function oneTimeEngagementOpen(projectStatus, billing) {
  return billing === "one_time" && OPEN_ONE_TIME.has(projectStatus);
}

export function recurringEngagementOpen(subscriptionStatus) {
  return OPEN_RECURRING.has(subscriptionStatus);
}

/** Checkout is fully paid only when Stripe says the session itself is paid. */
export function checkoutFullyPaid(session) {
  return Boolean(
    session
    && session.object === "checkout.session"
    && session.status === "complete"
    && session.payment_status === "paid"
  );
}

/** An invoice counts as full payment only when Stripe marks it paid for a positive amount. */
export function invoiceFullyPaid(invoice) {
  if (!invoice || invoice.object !== "invoice" || invoice.status !== "paid") return false;
  const due = Number(invoice.amount_due);
  const paid = Number(invoice.amount_paid);
  return Number.isFinite(due) && Number.isFinite(paid) && due > 0 && paid >= due;
}

export function shouldReconcileEngagement({ eventType, projectCreated = false, subscriptionRecorded = false }) {
  if (projectCreated || subscriptionRecorded) return true;
  return ENGAGEMENT_EVENTS.has(eventType);
}
