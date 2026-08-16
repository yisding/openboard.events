/** Runtime-neutral speaker CSV parser and row-normalization contract. */
export type { SpeakerCsvRowResult } from "./server/speaker-csv";
export { applyCsvCellEdits, parseCsv, readSpeakerCsvRows } from "./server/speaker-csv";
