/**
 * One bound shared by the page expansion and transition request. An
 * all-matching selection must never make a request the transition route will
 * reject, or silently turn an organizer's whole filter into only its first
 * page.
 */
export const BULK_DECISION_LIMIT = 200;
