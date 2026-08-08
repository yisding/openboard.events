import xss, { type IFilterXSSOptions } from "xss";

const defaultWhiteList: NonNullable<IFilterXSSOptions["whiteList"]> = {
  p: [], h1: [], h2: [], h3: [], strong: [], b: [], em: [], i: [], u: [], ul: [], ol: [], li: [],
  a: ["href", "target", "rel"], br: [], blockquote: [], code: [], pre: [],
};

const wideWhiteList: NonNullable<IFilterXSSOptions["whiteList"]> = {
  ...defaultWhiteList,
  iframe: ["src", "allowfullscreen", "width", "height", "title"],
};

// The only hosts the wide (resources) profile will embed in an iframe.
export const ALLOWED_EMBED_HOSTS = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com", "www.google.com", "maps.google.com"];

export function isAllowedEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_EMBED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export function sanitize(html: string, profile: "default" | "wide" = "default") {
  return xss(html, {
    whiteList: profile === "wide" ? wideWhiteList : defaultWhiteList,
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
    onTagAttr(tag, name, value) {
      if (name.startsWith("on")) return "";
      if (tag === "iframe" && name === "src" && !isAllowedEmbedUrl(value)) return "";
      if ((name === "href" || name === "src") && !/^(https?:|mailto:|\/)/i.test(value)) return "";
      if (tag === "a" && name === "rel") return "";
      if (tag === "a" && name === "target") return 'target="_blank" rel="noopener noreferrer"';
      return undefined;
    },
  });
}
