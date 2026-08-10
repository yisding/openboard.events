/**
 * The seeded world's ids, from the seed's own id function.
 *
 * M10's guardrail is that specs address seeded artifacts by their stable ids
 * (M09's `seedId`), never by "the first row in the table". Re-implementing uuid
 * v5 here would be a second definition of what a seeded id is, and it is the one
 * that drifts — so this imports the seed's module directly. `scripts/seed/lib/
 * ids.ts` depends on nothing but `node:crypto`, which is why it can be imported
 * from outside the app graph.
 */
export { OPENBOARD_NS, seedId, uuidv5 } from "../../scripts/seed/lib/ids";
