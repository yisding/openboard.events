import { isTransactionalTemplate, type TemplateKey } from "@/shared/contracts";

export type EmailLayoutMeta = {
  eventName: string;
  logoUrl?: string;
  unsubscribeUrl?: string;
  /** CAN-SPAM's required physical postal address. Already escaped by the caller, like the other metadata. */
  physicalAddress?: string;
};

/** Product-wide email chrome shared by event communications and platform auth mail. */
export function emailLayout(bodyHtml: string, key: TemplateKey, meta: EmailLayoutMeta): string {
  const brand = meta.logoUrl
    ? `<img src="${meta.logoUrl}" alt="${meta.eventName}" style="display:block;max-height:56px;max-width:220px">`
    : `<strong style="font-size:20px;color:#102a2a">${meta.eventName}</strong>`;
  const unsubscribe = !isTransactionalTemplate(key) && meta.unsubscribeUrl
    ? ` · <a href="${meta.unsubscribeUrl}" style="color:#5c706b">Unsubscribe</a>`
    : "";
  const address = meta.physicalAddress ? `<br>${meta.physicalAddress}` : "";
  return `<!doctype html><html><body style="margin:0;background:#eff5f2;font-family:Arial,sans-serif;color:#102a2a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td style="padding:0 0 18px">${brand}</td></tr><tr><td style="background:#ffffff;border-radius:12px;padding:32px;font-size:16px;line-height:1.6">${bodyHtml}</td></tr><tr><td style="padding:18px 8px;color:#5c706b;font-size:12px">${meta.eventName}${unsubscribe}${address}</td></tr></table></td></tr></table></body></html>`;
}

