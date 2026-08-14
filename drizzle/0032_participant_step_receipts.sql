ALTER TABLE "form_versions"
  ADD COLUMN "participant_operation_id" uuid,
  ADD COLUMN "participant_operation_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "form_versions"
  ADD CONSTRAINT "form_versions_participant_operation_pair_ck"
  CHECK (("participant_operation_id" IS NULL) = ("participant_operation_fingerprint" IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_participant_operation_uq"
  ON "form_versions" USING btree ("event_id", "form_id", "participant_operation_id")
  WHERE "participant_operation_id" IS NOT NULL;
