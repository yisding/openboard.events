import type { AnswerValue, FormSnapshot } from "./forms";
import type { FieldId } from "./ids";

export type FormFieldRendererProps = {
  snapshot: FormSnapshot;
  answers: Record<FieldId, AnswerValue | undefined>;
  onChange: (fieldId: FieldId, value: AnswerValue | undefined) => void;
  mode: "edit" | "review" | "readonly";
  sectionKeys?: string[];
  participantId?: string | null;
  errors?: Record<string, string>;
};
