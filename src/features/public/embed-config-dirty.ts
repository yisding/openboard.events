import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";
import type { EmbedFilters, EmbedStyle } from "./embed-config-types";

function normalizedIds(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])].sort();
}

function sameIds(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = normalizedIds(left);
  const normalizedRight = normalizedIds(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

/** Compare the settings users can observe, independent of object insertion order. */
export function embedStylesEqual(left: EmbedStyle, right: EmbedStyle): boolean {
  return (left.accent ?? DEFAULT_BRAND_COLOR).trim() === (right.accent ?? DEFAULT_BRAND_COLOR).trim()
    && (left.theme ?? "light") === (right.theme ?? "light")
    && (left.showHeader ?? true) === (right.showHeader ?? true);
}

/** Empty/absent filters and absent/true visibility flags are equivalent at render time. */
export function embedFiltersEqual(left: EmbedFilters, right: EmbedFilters): boolean {
  return sameIds(left.trackIds, right.trackIds)
    && sameIds(left.formatIds, right.formatIds)
    && sameIds(left.roomIds, right.roomIds)
    && (left.fields?.description ?? true) === (right.fields?.description ?? true)
    && (left.fields?.speakerCompany ?? true) === (right.fields?.speakerCompany ?? true)
    && (left.fields?.speakerBio ?? true) === (right.fields?.speakerBio ?? true);
}
