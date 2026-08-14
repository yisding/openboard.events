/** Narrow server authentication contract for pages and feature guards. */
export type { AdminIdentity, AdminSession, OrganizationSession } from "./server/admin";
export {
  authorizeAdmin,
  authorizeOrganization,
  getAdminSession,
  requireAdmin,
  requireOrganizationAdmin,
  requiredRoleForEventPath,
  roleSatisfies,
} from "./server/admin";
