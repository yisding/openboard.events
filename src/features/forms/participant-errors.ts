const PARTICIPANT_ERROR_PREFIX = "participant:";

export function scopedParticipantFieldErrorKey(clientId: string, fieldId: string): string {
  return `${PARTICIPANT_ERROR_PREFIX}${encodeURIComponent(clientId)}:${fieldId}`;
}

export function scopeParticipantFieldErrors(clientId: string, fieldErrors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldErrors).map(([fieldId, message]) => [scopedParticipantFieldErrorKey(clientId, fieldId), message]));
}

export function splitParticipantFieldErrors(fieldErrors: Record<string, string>): {
  unscoped: Record<string, string>;
  byParticipant: Record<string, Record<string, string>>;
} {
  const unscoped = Object.create(null) as Record<string, string>;
  const byParticipant = Object.create(null) as Record<string, Record<string, string>>;
  for (const [key, message] of Object.entries(fieldErrors)) {
    if (!key.startsWith(PARTICIPANT_ERROR_PREFIX)) {
      unscoped[key] = message;
      continue;
    }
    const separator = key.indexOf(":", PARTICIPANT_ERROR_PREFIX.length);
    if (separator < 0) {
      unscoped[key] = message;
      continue;
    }
    const encodedClientId = key.slice(PARTICIPANT_ERROR_PREFIX.length, separator);
    const fieldId = key.slice(separator + 1);
    let clientId: string;
    try {
      clientId = decodeURIComponent(encodedClientId);
    } catch {
      unscoped[key] = message;
      continue;
    }
    const participantErrors = byParticipant[clientId] ?? Object.create(null) as Record<string, string>;
    participantErrors[fieldId] = message;
    byParticipant[clientId] = participantErrors;
  }
  return { unscoped, byParticipant };
}
