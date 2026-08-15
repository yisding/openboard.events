import { describe, expect, it } from "vitest";
import { WIDE_IFRAME_HOSTS } from "./embed-hosts";
import { contentSecurityPolicy, headersConfig } from "./security-headers";

function rule(source: string) {
  const found = headersConfig.find((entry) => entry.source === source);
  if (!found) throw new Error(`no headers() rule for source ${source}`);
  return found;
}

function value(headers: { key: string; value: string }[], key: string) {
  return headers.find((header) => header.key === key)?.value;
}

describe("security-headers", () => {
  it("keeps the embed exception framable with no X-Frame-Options", () => {
    const embed = rule("/embed/:path*");
    expect(value(embed.headers, "Content-Security-Policy")).toContain("frame-ancestors *");
    expect(value(embed.headers, "X-Frame-Options")).toBeUndefined();
    // nosniff and HSTS are orthogonal to framing and still apply.
    expect(value(embed.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(embed.headers, "Strict-Transport-Security")).toContain("max-age=");
  });

  it("relaxes only framing for embeds, keeping every other directive", () => {
    // The exception is about being iframeable by other sites, not about opting
    // the surface out of the rest of the policy. `frame-ancestors *` used to be
    // the *whole* embed CSP, so those pages shipped no default-src, script-src,
    // object-src, base-uri or form-action at all.
    const embed = value(rule("/embed/:path*").headers, "Content-Security-Policy") ?? "";
    const strict = value(rule("/((?!embed/).*)").headers, "Content-Security-Policy") ?? "";

    expect(embed).toContain("frame-ancestors *");
    expect(embed).not.toContain("frame-ancestors 'none'");
    // Every directive except the framing one is identical to the strict policy.
    const directives = (policy: string) => policy.split("; ").filter((part) => !part.startsWith("frame-ancestors"));
    expect(directives(embed)).toEqual(directives(strict));
    expect(embed).toContain("object-src 'none'");
    expect(embed).toContain("base-uri 'self'");
    expect(embed).toContain("form-action 'self'");
  });

  it("denies framing and locks down the CSP everywhere else", () => {
    const rest = rule("/((?!embed/).*)");
    expect(value(rest.headers, "X-Frame-Options")).toBe("DENY");
    const csp = value(rest.headers, "Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(value(rest.headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(rest.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(rest.headers, "Strict-Transport-Security")).toContain("includeSubDomains");
  });

  it("allows the direct-to-R2 presigned upload the browser makes on connect-src", () => {
    const rest = rule("/((?!embed/).*)");
    const csp = value(rest.headers, "Content-Security-Policy") ?? "";
    expect(csp).toContain("connect-src 'self' https://*.r2.cloudflarestorage.com");
  });

  it("lets every sanitized rich-content iframe host render", () => {
    const rest = rule("/((?!embed/).*)");
    const csp = value(rest.headers, "Content-Security-Policy") ?? "";

    expect(csp).toContain("frame-src 'self'");
    for (const host of WIDE_IFRAME_HOSTS) expect(csp).toContain(`https://${host}`);
    expect(csp).not.toContain("https://evil.example");
  });

  it("allows Next development hydration without weakening deployed script policy", () => {
    expect(contentSecurityPolicy(true)).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(contentSecurityPolicy()).toContain("script-src 'self' 'unsafe-inline'");
    expect(contentSecurityPolicy()).not.toContain("'unsafe-eval'");
  });

  it("the non-embed rule's negative-lookahead source excludes only embed paths", () => {
    // Matches the `path-to-regexp`-flavoured source Next.js's headers() consumes:
    // a literal exclusion of the /embed/ prefix, nothing narrower or broader.
    expect(rule("/((?!embed/).*)").source).toBe("/((?!embed/).*)");
  });
});
