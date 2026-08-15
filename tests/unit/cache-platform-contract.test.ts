import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type WranglerConfig = {
  durable_objects?: { bindings?: Array<{ class_name?: string; name?: string }> };
  env?: Record<string, { durable_objects?: { bindings?: Array<{ class_name?: string; name?: string }> } }>;
  migrations?: Array<{ new_sqlite_classes?: string[]; tag?: string }>;
};

function wranglerConfig(): WranglerConfig {
  const source = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  return parsed.config as WranglerConfig;
}

function cacheBindings(config: WranglerConfig | NonNullable<WranglerConfig["env"]>[string]) {
  return config.durable_objects?.bindings?.map(({ class_name: className, name }) => ({ className, name })) ?? [];
}

type OpenNextCacheComponent = {
  name?: string;
  opts?: { baseShardSize?: number };
};

type OpenNextConfig = {
  default?: {
    override?: {
      incrementalCache?: () => OpenNextCacheComponent;
      queue?: () => OpenNextCacheComponent;
      tagCache?: () => OpenNextCacheComponent;
    };
  };
};

async function openNextCacheConfig() {
  const { default: config } = await import("../../open-next.config");
  const override = (config as OpenNextConfig).default?.override;
  return {
    incrementalCache: override?.incrementalCache?.(),
    queue: override?.queue?.(),
    tagCache: override?.tagCache?.(),
  };
}

describe("distributed public-cache platform", () => {
  it("loads durable OpenNext queue and tag-cache implementations", async () => {
    const config = await openNextCacheConfig();

    expect(config.incrementalCache?.name).toBe("cf-r2-incremental-cache");
    expect(config.queue?.name).toBe("durable-queue");
    expect(config.tagCache).toMatchObject({
      name: "do-sharded-tag-cache",
      opts: { baseShardSize: 1 },
    });
  });

  it("binds both SQLite Durable Objects in every deploy environment", () => {
    const config = wranglerConfig();
    const expected = [
      { className: "DOQueueHandler", name: "NEXT_CACHE_DO_QUEUE" },
      { className: "DOShardedTagCache", name: "NEXT_TAG_CACHE_DO_SHARDED" },
    ];

    expect(cacheBindings(config)).toEqual(expected);
    expect(cacheBindings(config.env?.preview ?? {})).toEqual(expected);
    expect(cacheBindings(config.env?.production ?? {})).toEqual(expected);
    expect(config.migrations).toContainEqual({
      tag: "cache-v1",
      new_sqlite_classes: ["DOQueueHandler", "DOShardedTagCache"],
    });
  });
});
