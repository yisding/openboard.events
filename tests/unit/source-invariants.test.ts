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
      "src/shared/lib/log.ts": 'export const log = (entry) => { console["error"](JSON.stringify(entry)); };',
      "src/shared/lib/query-client.ts": 'import { QueryClient } from "@tanstack/react-query"; export const client = new QueryClient();',
      "src/shared/lib/time.ts": 'export { format } from "date-fns"; export const count = (total: number) => total.toLocaleString();',
      "src/shared/ui/console-greeting.tsx": 'export const Greeting = () => { console.info("hello"); return null; };',
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
        export const expires = new Date(row.expiresAt).toLocaleString();
        export const day = instant.toLocaleDateString();
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    for (const rule of ["time-import", "resend-import", "r2-import", "edge-runtime", "process-env", "r2-binding", "viewer-local-time"]) {
      expect(result.stderr).toContain(`[${rule}]`);
    }
  });

  it("keeps console writes in the logging module and out of product code", () => {
    const root = fixture({
      "src/app/api/health/route.ts": 'export const GET = () => { console.error("health check failed"); };',
      // A computed method is the shape `log.ts` itself uses, and a bare
      // reference handed to `.catch` writes to the console without ever
      // appearing as a `console.x(...)` call.
      "src/features/example/boundary.tsx": `
        export const report = (level, error) => console[level](error);
        export const forward = (promise) => promise.catch(console.error);
        export const viaGlobal = () => globalThis.console.warn("indirect");
      `,
      "src/features/example/boundary.test.ts": 'it("spies", () => { console.log("allowed in tests"); });',
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[console-owner\]/gu)).toHaveLength(4);
    expect(result.stderr).not.toContain("boundary.test.ts");
  });

  it("requires an explicit kind on a toast raised from a catch block", () => {
    const root = fixture({
      "src/features/example/panel.tsx": `
        export function Panel() {
          const { toast } = useToast();
          async function save() {
            try {
              await write();
              toast("Saved");
            } catch (caught) {
              toast("That did not save");
              toast("Also broken", { durationMs: 5 });
              void Promise.resolve().then(() => toast("late failure"));
            }
          }
          async function ok() {
            try { await write(); } catch (caught) {
              toast("That did not save", { kind: "error" });
              toast("Computed is left to review", resultToastOptions(caught));
            }
          }
          return null;
        }
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    // The success toast in the try block, the two correct ones, and the
    // computed-options call are all left alone.
    expect(result.stderr.match(/\[error-toast-kind\]/gu)).toHaveLength(3);
  });

  it("keeps instant formatting in the time module and out of product code", () => {
    const root = fixture({
      "src/features/example/audit.tsx": `
        export const when = (row) => new Date(row.createdAt).toLocaleString();
        export const day = (row) => new Date(row.at).toLocaleDateString();
        export const clock = (row) => new Date(row.at).toLocaleTimeString();
        export const label = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(d);
        export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
      `,
      // The owning module is the one place all of this is allowed.
      "src/shared/lib/time.ts": `
        export const f = (d, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(d);
        export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
        export const loose = (d) => d.toLocaleString();
      `,
      // The picker owns its own explicit-zone construction, but not toLocale*.
      "src/shared/ui/app/datetime-picker.tsx": `
        export const shown = (d, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(d);
        export const sloppy = (d) => d.toLocaleDateString();
      `,
      "src/features/example/audit.test.ts": 'it("formats", () => { new Date().toLocaleString(); });',
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[viewer-time\]/gu)).toHaveLength(6);
    // The message names the owning module, so match the reported path instead.
    expect(result.stderr).not.toMatch(/^src\/shared\/lib\/time\.ts:/mu);
    expect(result.stderr).not.toMatch(/^src\/features\/example\/audit\.test\.ts:/mu);
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
          <input type="file" accept=".csv" />
          <div {...htmlProps} />
          <span style={{ fontSize: -1 }}>Tiny</span>
        </>;
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    for (const rule of ["raw-select", "raw-switch", "native-date", "raw-file-input", "raw-html", "inline-type-floor"]) {
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
        import { contacts, users as accounts } from "@/db/schema";
        import * as schema from "@/db/schema";
        const reviewerAccounts = aliasedTable(accounts, "reviewer_accounts");
        export const sqlJoin = sql\`SELECT 1 FROM users u JOIN contacts c ON lower(c.email) = lower(u.email)\`;
        export const importedAliasJoin = eq(accounts.email, contacts.email);
        export const assignedAliasJoin = eq(reviewerAccounts.email, contacts.email);
        export const namespaceJoin = eq(schema.users.email, schema.contacts.email);
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[identity-email-join\]/gu)).toHaveLength(4);
    expect(result.stderr).not.toContain("event-contacts/server/identity-links.ts");
  });

  /**
   * First Fair — the demo-event mail barrier. A `buildContext` that no longer
   * carries the guard is the one refactor that would silently arm real mail to
   * fabricated speakers, so the checker asserts the three fragments by text.
   */
  it("rejects a buildContext that has lost the demo mail guard", () => {
    const root = fixture({
      "src/features/comms/server/context.ts": `
        export async function buildContext(row, dbOrTx) {
          const [base] = await dbOrTx.select({ email: contacts.email }).from(events).limit(1);
          if (!base) throw new SkipEmail("contact no longer exists");
          return base;
        }
      `,
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/\[demo-mail-guard\]/gu)).toHaveLength(3);
  });

  it("accepts a buildContext that still selects is_demo and skips on it", () => {
    const root = fixture({
      "src/features/comms/server/context.ts": `
        export const DEMO_MAIL_SKIP_REASON = "demo event — mail is never delivered";
        export async function buildContext(row, dbOrTx) {
          const [base] = await dbOrTx.select({ isDemo: events.isDemo }).from(events).limit(1);
          if (!base) throw new SkipEmail("contact no longer exists");
          if (base.isDemo) throw new SkipEmail(DEMO_MAIL_SKIP_REASON);
          return base;
        }
      `,
    });

    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
  });
});
