export const SPEAKERS_DEEPLINK_PARAMS = {
  missing: ["bio", "headshot", "either"],
  accepted: ["1"],
  confirmation: ["unconfirmed", "confirmed", "declined"],
  sort: ["name", "openTasks", "confirmation"],
  dir: ["asc", "desc"],
} as const;
