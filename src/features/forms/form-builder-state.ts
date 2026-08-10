import type { BuilderForm, BuilderStep } from "./builder-types";

export type BuilderDirtyTarget = `step:${BuilderStep}` | `section:${string}` | `field:${string}`;

function mergeStep(server: BuilderForm, local: BuilderForm, step: BuilderStep): BuilderForm {
  switch (step) {
    case "setup":
      return { ...server, internalName: local.internalName, kind: local.kind, collectParticipants: local.collectParticipants };
    case "welcome":
      return {
        ...server,
        internalName: local.internalName,
        externalTitle: local.externalTitle,
        pageHeading: local.pageHeading,
        showWelcome: local.showWelcome,
        welcomeHtml: local.welcomeHtml,
      };
    case "participant":
      return { ...server, participantRoles: local.participantRoles };
    case "settings":
      return {
        ...server,
        status: local.status,
        opensAt: local.opensAt,
        closesAt: local.closesAt,
        submissionLimit: local.submissionLimit,
        successHtml: local.successHtml,
        autoRedirectToPortal: local.autoRedirectToPortal,
      };
    case "notifications":
      return {
        ...server,
        sendConfirmation: local.sendConfirmation,
        confirmationSubject: local.confirmationSubject,
        confirmationBodyHtml: local.confirmationBodyHtml,
      };
    case "abstract":
      return server;
  }
}

/** Overlay only still-dirty editor targets onto a fresh server response. */
export function mergeUnsavedBuilderEdits(
  server: BuilderForm,
  local: BuilderForm,
  dirtyTargets: ReadonlySet<BuilderDirtyTarget>,
): BuilderForm {
  let merged = server;
  for (const target of dirtyTargets) {
    if (target.startsWith("step:")) {
      merged = mergeStep(merged, local, target.slice("step:".length) as BuilderStep);
      continue;
    }
    if (target.startsWith("section:")) {
      const sectionId = target.slice("section:".length);
      const localSection = local.sections.find((section) => section.id === sectionId);
      if (!localSection) continue;
      merged = {
        ...merged,
        sections: merged.sections.map((section) => section.id === sectionId ? {
          ...section,
          title: localSection.title,
          pageHeading: localSection.pageHeading,
          descriptionHtml: localSection.descriptionHtml,
        } : section),
      };
      continue;
    }
    const fieldId = target.slice("field:".length);
    const localField = local.sections.flatMap((section) => section.fields).find((field) => field.id === fieldId);
    if (!localField) continue;
    merged = {
      ...merged,
      sections: merged.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => field.id === fieldId
          ? { ...localField, sectionId: field.sectionId, sortOrder: field.sortOrder }
          : field),
      })),
    };
  }
  return merged;
}
