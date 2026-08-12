import { z } from "zod";
import { eventIdSchema } from "@/shared/contracts";

export const onboardingStepSchema = z.enum(["vocabulary", "form"]);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingProgressUpdateSchema = z.object({
  eventId: eventIdSchema,
  step: z.union([onboardingStepSchema, z.literal("complete")]),
});
export type OnboardingProgressUpdate = z.infer<typeof onboardingProgressUpdateSchema>;
