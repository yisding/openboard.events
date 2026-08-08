// The only reader of process.env in src/**.
export function getEnv() {
  return {
    CRON_SECRET: process.env.CRON_SECRET ?? "",
    OPENBOARD_API_KEY: process.env.OPENBOARD_API_KEY ?? "",
  };
}
