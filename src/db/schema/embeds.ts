import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./core";
import { embedContentTypeEnum } from "./enums";

export const embeds = pgTable("embeds", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), contentType: embedContentTypeEnum("content_type").notNull(), enabled: boolean("enabled").notNull().default(true),
  style: jsonb("style").notNull().default({}), filters: jsonb("filters").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
