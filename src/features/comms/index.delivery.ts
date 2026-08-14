/** Server-only email layout and transport contract. */
export { emailLayout } from "./server/layout";
export { escapeHtml } from "./server/render";
export { sendViaResend, type EmailMessage } from "./server/resend";

