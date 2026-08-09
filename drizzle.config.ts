import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? "",
  },
  strict: true,
  verbose: true,
});
