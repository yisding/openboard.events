export type { AdminIdentity, AdminSession } from "./server/admin";
export { authorizeAdmin, getAdminSession, requireAdmin, requiredRoleForEventPath, roleSatisfies } from "./server/admin";
export { clearAdminLoginThrottle, revokeAdminSessions, throttleAdminLogin } from "./server/admin";
export { hashAdminPassword, needsRehash, verifyAdminPassword } from "./server/admin-password";
export { upsertAdminCredentialAccount } from "./server/credential-account";
export { withCredentialVerificationBudget } from "./server/credential-capacity";
export type { PortalLoginVerification, PortalSession } from "./server/portal";
export { PORTAL_LOGIN_NEUTRAL_MESSAGE, PORTAL_LOGIN_THROTTLE, PORTAL_LOGIN_THROTTLE_MESSAGE } from "./server/portal";
export { getPortalImpersonator, logoutPortal, portalCookieName, requestPortalLogin, requestPortalLoginIn, requirePortal, verifyPortalLogin, verifyPortalLoginIn } from "./server/portal";
export { consumeToken, issuePortalToken, verifyPortalToken } from "./server/tokens";
export { openPortalLoginPayload, sealPortalLoginPayload } from "./server/secret-payload";
export type { AdminLinkPayload } from "./server/secret-payload";
export { openAdminLinkPayload } from "./server/secret-payload";
export { openPlatformAdminLinkPayload, sealPlatformAdminLinkPayload } from "./server/secret-payload";
export type { AdminAuthTemplateKey, AuthOutboxFilter, AuthOutboxRequeueResult, AuthOutboxRequeueRow } from "./server/admin-mail";
export {
  dispatchAdminAuthEmailOutbox,
  dispatchAdminAuthEmailOutboxIn,
  getAdminAuthFallbackLink,
  getAdminAuthFallbackLinkIn,
  listFailedAdminAuthEmailsIn,
  nudgeAdminAuthEmailOutbox,
  recordAdminAuthEmailSuppression,
  recordAdminAuthEmailSuppressionIn,
  requeueFailedAdminAuthEmails,
  requeueFailedAdminAuthEmailsIn,
  sendAdminAuthEmail,
  sendAdminAuthEmailIn,
} from "./server/admin-mail";
export { adminAuth, apiKeyAuth, authenticatedAuth, organizationAuth, portalAuth, publicAuth } from "./server/guards";
// M43 — organization-scoped guards. `requireAdmin`/`authorizeAdmin` above are
// unchanged; these compose the same identity, the same role ladder and the
// same UNAUTHORIZED/FORBIDDEN split over `organization_members`.
export type { OrganizationSession } from "./server/admin";
export { authorizeOrganization, requireOrganizationAdmin } from "./server/admin";
// M44 — self-service admin session views over M42's revocable session store.
export type { AdminSessionSummary } from "./server/sessions";
export { listAdminSessions, listAdminSessionsIn, revokeAdminSessionById, revokeAdminSessionByIdIn } from "./server/sessions";
