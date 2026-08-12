import { z } from "zod";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";

export const onboardingStepSchema = z.enum(["vocabulary", "form"]);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingProgressUpdateSchema = z.object({
  eventId: eventIdSchema,
  step: z.union([onboardingStepSchema, z.literal("complete")]),
  formId: formIdSchema.optional(),
}).superRefine((input, context) => {
  if (input.step === "vocabulary" && input.formId) {
    context.addIssue({ code: "custom", path: ["formId"], message: "Vocabulary progress cannot have a form" });
  }
  if (input.step === "complete" && !input.formId) {
    context.addIssue({ code: "custom", path: ["formId"], message: "The onboarding form is required to finish setup" });
  }
});
export type OnboardingProgressUpdate = z.infer<typeof onboardingProgressUpdateSchema>;
