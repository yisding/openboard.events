export type StableCreateRequestId = {
  begin: () => string;
  payload: <T extends object>(existingId: string | undefined, input: T) => T | (T & { id: string });
  reset: () => void;
};

/**
 * A collection POST's client-generated row id doubles as its idempotency key.
 * `begin` is called when a create editor opens; every retry then gets the same
 * id until a definite success or cancel resets the controller.
 */
export function createStableCreateRequestId(
  generate: () => string = () => crypto.randomUUID(),
): StableCreateRequestId {
  let id: string | null = null;
  const begin = () => {
    id ??= generate();
    return id;
  };
  return {
    begin,
    payload: (existingId, input) => existingId ? input : { ...input, id: begin() },
    reset: () => { id = null; },
  };
}
