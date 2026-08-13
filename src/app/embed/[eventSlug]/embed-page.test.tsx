import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedConfigDTO } from "@/features/public/embed-config-types";
import { embedIdSchema, eventIdSchema } from "@/shared/contracts";
import { renderEmbedSurface } from "./embed-page";

Object.assign(globalThis, { React });

const { getEventBySlugMock, notFoundMock } = vi.hoisted(() => ({
  getEventBySlugMock: vi.fn(),
  notFoundMock: vi.fn((): never => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/features/events", () => ({ getEventBySlug: getEventBySlugMock }));

const eventId = eventIdSchema.parse("00000000-0000-4000-8000-000000000001");
const embedId = embedIdSchema.parse("00000000-0000-4000-8000-000000000002");

const config = (enabled: boolean): EmbedConfigDTO => ({
  id: embedId,
  eventId,
  contentType: "agenda",
  enabled,
  style: { accent: "#123abc", theme: "dark", showHeader: false },
  filters: { trackIds: ["track-1"] },
});

describe("renderEmbedSurface", () => {
  beforeEach(() => {
    getEventBySlugMock.mockReset().mockResolvedValue({
      id: eventId,
      name: "Demo event",
      timezone: "America/Los_Angeles",
      theme: "#456789",
    });
    notFoundMock.mockClear();
  });

  it("stops at the config gate when the embed is disabled", async () => {
    const getConfig = vi.fn().mockResolvedValue(config(false));
    const getContent = vi.fn().mockResolvedValue({ sessions: [] });
    const renderContent = vi.fn();

    const result = await renderEmbedSurface({
      eventSlug: "demo",
      active: "agenda",
      disabledLabel: "agenda",
      getConfig,
      getContent,
      renderContent,
    });

    expect(getConfig).toHaveBeenCalledWith(eventId);
    expect(getContent).not.toHaveBeenCalled();
    expect(renderContent).not.toHaveBeenCalled();
    expect(React.isValidElement(result)).toBe(true);
  });

  it("passes resolved config state to an enabled surface", async () => {
    const content = { sessions: [] };
    const getConfig = vi.fn().mockResolvedValue(config(true));
    const getContent = vi.fn().mockResolvedValue(content);
    const rendered = <div>Agenda</div>;
    const renderContent = vi.fn(() => rendered);

    await expect(renderEmbedSurface({
      eventSlug: "demo",
      active: "agenda",
      disabledLabel: "agenda",
      getConfig,
      getContent,
      renderContent,
    })).resolves.toBe(rendered);

    expect(getContent).toHaveBeenCalledWith("demo");
    expect(renderContent).toHaveBeenCalledWith(content, {
      eventSlug: "demo",
      embedOptions: { accent: "#123abc", theme: "dark", header: false },
      filters: { trackIds: ["track-1"] },
    });
  });

  it("returns not found without querying config for an unknown event", async () => {
    getEventBySlugMock.mockResolvedValue(null);
    const getConfig = vi.fn().mockResolvedValue(config(true));

    await expect(renderEmbedSurface({
      eventSlug: "missing",
      active: "agenda",
      disabledLabel: "agenda",
      getConfig,
      getContent: vi.fn(),
      renderContent: vi.fn(),
    })).rejects.toThrow("not-found");

    expect(getConfig).not.toHaveBeenCalled();
  });

  it("returns not found when an enabled embed has no published content", async () => {
    await expect(renderEmbedSurface({
      eventSlug: "demo",
      active: "agenda",
      disabledLabel: "agenda",
      getConfig: vi.fn().mockResolvedValue(config(true)),
      getContent: vi.fn().mockResolvedValue(null),
      renderContent: vi.fn(),
    })).rejects.toThrow("not-found");

    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
