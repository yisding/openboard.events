import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const CHECKER = resolve("node_modules/.bin/tsx");
const SCRIPT = resolve("scripts/check-source-invariants.ts");
const CACHE_ROOT = resolve("node_modules/.cache");
const fixtures: string[] = [];

function fixture(files: Record<string, string>): string {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const root = mkdtempSync(resolve(CACHE_ROOT, "source-invariants-"));
  fixtures.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = resolve(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

function check(root: string) {
  return spawnSync(CHECKER, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, SOURCE_INVARIANT_ROOT: root },
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AST source invariants", () => {
  it("accepts each explicitly owned source seam", () => {
    const root = fixture({
      "src/app/api/internal/evaluation/event/queue/route.ts": 'adminAuth({ other: true, role: "reviewer" });',
      "src/app/page.tsx": "export const configured = process.env.NODE_ENV;",
      "src/features/comms/server/send.ts": 'import("resend");',
      "src/shared/lib/env.ts": 'export const value = process["env"].VALUE;',
      "src/shared/lib/query-client.ts": 'import { QueryClient } from "@tanstack/react-query"; export const client = new QueryClient();',
      "src/shared/lib/time.ts": 'export { format } from "date-fns";',
      "src/shared/server/r2.ts": 'import { AwsClient } from "aws4fetch"; export const FILES = AwsClient;',
      "src/shared/ui/app/query-boundary.tsx": 'import { QueryClientProvider } from "@tanstack/react-query"; export const Boundary = QueryClientProvider;',
      "src/shared/ui/app/rich-text-view.tsx": "export const View = () => <div dangerouslySetInnerHTML={{ __html: '' }} />;",
      "src/shared/ui/ui-kit.tsx": 'export const Kit = () => <select role={"switch"} />;',
    });

    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects restricted modules, environment access, edge runtime, and R2 access", () => {
    const root = fixture({
      "src/features/example/server.ts": `
        import "date-fns/addDays";
        import Resend = require("resend");
        require("aws4fetch");
        const runtime = ("edge"); export { runtime };
        export const env = globalThis.process["env"];
        export const { env: inheritedEnv } = process;
        export const bucket = getCloudflareContext().env["FILES"];
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    for (const rule of ["time-import", "resend-import", "r2-import", "edge-runtime", "process-env", "r2-binding"]) {
      expect(result.stderr).toContain(`[${rule}]`);
    }
  });

  it("rejects syntax-aware JSX and inline style variants without matching strings", () => {
    const root = fixture({
      "src/features/example/view.tsx": `
        const harmless = '<select role="switch" type="date">';
        const htmlProps = { dangerouslySetInnerHTML: { __html: "unsafe" } };
        export const View = ({ flag }) => <>
          <select />
          <button role={flag ? "switch" : "button"} />
          <input {...{ ...{ type: flag ? "datetime-local" : "text" } }} />
          <div {...htmlProps} />
          <span style={{ fontSize: -1 }}>Tiny</span>
        </>;
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    for (const rule of ["raw-select", "raw-switch", "native-date", "raw-html", "inline-type-floor"]) {
      expect(result.stderr).toContain(`[${rule}]`);
    }
    expect(result.stderr.match(/\[raw-select\]/gu)).toHaveLength(1);
  });

  it("finds reviewer access regardless of object-property order", () => {
    const root = fixture({
      "src/app/api/internal/speakers/event/route.ts": `
        export const handler = adminAuth({ csrf: true, ...{ role: condition ? "reviewer" : "organizer" } });
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[reviewer-route]");
  });

  it("rejects an event-row lock on either final-submit owner", () => {
    const root = fixture({
      "src/features/forms/server/submit.ts": `
        export async function submit(tx, eventId) {
          return tx.execute(sql\`SELECT id FROM events WHERE id = \${eventId} FOR UPDATE\`);
        }
      `,
      "src/features/submissions/server/mutations.ts": "export const safe = sql`SELECT id FROM events`;",
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[submission-event-lock]");
  });

  it("rejects split query ownership and mixed route refreshes", () => {
    const root = fixture({
      "src/features/example/view.tsx": `
        import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
        export function View() {
          const router = useRouter();
          const queryClient = useQueryClient();
          useQuery({ queryKey: (["example", "list"] as const), queryFn: load, initialData: [] });
          queryClient.invalidateQueries({ queryKey: ["example", "list"] });
          router.refresh();
          return <QueryClientProvider client={new QueryClient()} />;
        }
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    for (const rule of ["query-client-owner", "query-key-literal", "query-initial-data", "mixed-cache-refresh"]) {
      expect(result.stderr).toContain(`[${rule}]`);
    }
  });

  it("rejects shorthand local query keys and initial data", () => {
    const root = fixture({
      "src/features/example/view.tsx": `
        import { useQuery } from "@tanstack/react-query";
        export function View({ initialData }) {
          const queryKey = (["example", "list"] as const);
          useQuery({ queryKey, queryFn: load, initialData });
          return null;
        }
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[query-key-literal\]/gu)).toHaveLength(1);
    expect(result.stderr.match(/\[query-initial-data\]/gu)).toHaveLength(1);
  });

  it("confines cross-identity email comparisons to the identity resolver", () => {
    const root = fixture({
      "src/features/event-contacts/server/identity-links.ts": `
        export const candidate = sql\`SELECT 1 FROM users u JOIN contacts c ON lower(c.email) = lower(u.email)\`;
      `,
      "src/features/example/server.ts": `
        export const sqlJoin = sql\`SELECT 1 FROM users u JOIN contacts c ON lower(c.email) = lower(u.email)\`;
        export const drizzleJoin = eq(users.email, contacts.email);
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[identity-email-join\]/gu)).toHaveLength(2);
    expect(result.stderr).not.toContain("event-contacts/server/identity-links.ts");
  });
});
