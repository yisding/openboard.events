import { describe, expect, it } from "vitest";
import { mergeDemoSnapshot } from "./demo-provider";
import { initialDemoState } from "./seed";

describe("demo snapshot migration", () => {
  it("restores seeded headshot flags in snapshots created before the field existed", () => {
    const legacy = structuredClone(initialDemoState);
    for (const speaker of legacy.speakers) delete speaker.hasHeadshot;

    const migrated = mergeDemoSnapshot(legacy);

    expect(migrated?.speakers.map(({ id, hasHeadshot }) => ({ id, hasHeadshot })))
      .toEqual(initialDemoState.speakers.map(({ id, hasHeadshot }) => ({ id, hasHeadshot })));
  });

  it("defaults unknown legacy speakers to having a headshot", () => {
    const legacy = structuredClone(initialDemoState);
    const firstSpeaker = legacy.speakers[0];
    if (!firstSpeaker) throw new Error("demo speaker fixture is required");
    const oldSpeaker = { ...firstSpeaker, id: "legacy-speaker" };
    delete oldSpeaker.hasHeadshot;
    legacy.speakers.push(oldSpeaker);

    expect(mergeDemoSnapshot(legacy)?.speakers.at(-1)?.hasHeadshot).toBe(true);
  });
});
