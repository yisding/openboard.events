import { SEEDED_HEADSHOT_KEYS } from "./seed/contacts";
import { OPEN_FORM_KEY } from "./seed/forms";
import { SEEDED_EVENT_ID } from "./seed/lib/helpers";
import { seedId } from "./seed/lib/ids";

/**
 * Prints the deploy smoke test's fixture ids, one NAME=value per line:
 *
 *   SMOKE_EVENT_ID=…
 *   SMOKE_FORM_ID=…
 *   SMOKE_HEADSHOT_FILE_ID=…
 *
 * Every seeded row's id is a deterministic uuidv5 over its seed key
 * (scripts/seed/lib/ids.ts), so the fixtures scripts/post-deploy-smoke.sh
 * asserts against are derivable from the seed source rather than hand-copied
 * into protected GitHub environment variables — copied ids go stale the moment
 * a seed key changes, and a stale id fails every deploy after it. The deploy
 * workflow uses these values for any id its environment does not set; a set
 * environment variable still wins.
 */
const headshotSpeakerKey = SEEDED_HEADSHOT_KEYS[0];
if (!headshotSpeakerKey) {
  throw new Error("no seeded speaker has a headshot; the smoke test needs one to assert the M07 file-serving contract");
}

console.log(
  [
    `SMOKE_EVENT_ID=${SEEDED_EVENT_ID}`,
    `SMOKE_FORM_ID=${seedId("form", OPEN_FORM_KEY)}`,
    `SMOKE_HEADSHOT_FILE_ID=${seedId("file", `headshot-${headshotSpeakerKey}`)}`,
  ].join("\n"),
);
