import xss, { type IFilterXSSOptions } from "xss";
import { WIDE_IFRAME_HOSTS } from "./embed-hosts";

export { WIDE_IFRAME_HOSTS } from "./embed-hosts";

const defaultWhiteList: NonNullable<IFilterXSSOptions["whiteList"]> = {
  p: [],
  h1: [],
  h2: [],
  h3: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  ul: [],
  ol: [],
  li: [],
  a: ["href"],
  br: [],
  blockquote: [],
  code: [],
  pre: [],
};

const wideWhiteList: NonNullable<IFilterXSSOptions["whiteList"]> = {
  ...defaultWhiteList,
  iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "title"],
  img: ["src", "alt"],
  hr: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: [],
  td: [],
};

export type SanitizeOptions = { profile?: "default" | "wide" };

export function isAllowedEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (WIDE_IFRAME_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

function removeUnsafeIframes(html: string): string {
  return html.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>/gi, (full, attributes: string) => {
    if (/\bsrcdoc\s*=/i.test(attributes)) return "";
    const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
    const src = match?.[1] ?? match?.[2] ?? match?.[3];
    return src && isAllowedEmbedUrl(src) ? full : "";
  });
}

export function sanitize(html: string, options: SanitizeOptions = {}): string {
  const profile = options.profile ?? "default";
  const prepared = profile === "wide" ? removeUnsafeIframes(html) : html;
  return xss(prepared, {
    whiteList: profile === "wide" ? wideWhiteList : defaultWhiteList,
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style", ...(profile === "default" ? ["iframe"] : [])],
    onTagAttr(tag, name, value) {
      if (name.startsWith("on")) return "";
      if (tag === "iframe" && name === "src" && !isAllowedEmbedUrl(value)) return "";
      if (tag === "img" && name === "src" && !value.toLowerCase().startsWith("https:")) return "";
      if (tag === "a" && name === "href" && !/^(https?:|mailto:)/i.test(value)) return "";
      return undefined;
    },
  });
}
