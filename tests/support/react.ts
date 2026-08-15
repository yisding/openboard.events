import { act } from "react";
import { vi } from "vitest";

/**
 * Wait for a component to reach its resting state after an interaction.
 *
 * Twenty-one suites each hand-rolled this as `for (let step = 0; step < N;
 * step += 1) await Promise.resolve()` with N somewhere between 5 and 10 — one
 * microtask per `await` in the handler under test, counted by hand when the
 * test was written. That number is not a property of the component, so adding
 * a single `await` inside a submit handler breaks every suite that chose 5
 * while the ones that chose 10 keep passing, and the failure looks unrelated
 * to the change that caused it. Over-provisioned counts fail the other way: a
 * component that regresses to needing more ticks still passes.
 *
 * Yielding to a macrotask drains the entire microtask queue first, whatever
 * its depth, so there is no number to keep in step with the code — except that
 * under `vi.useFakeTimers()` a `setTimeout` never fires on its own and the
 * wait would hang. The suites that freeze the clock to test a deadline passing
 * on screen do exactly that, so those get the fake-timer equivalent: advancing
 * by zero flushes pending microtasks and due timers without moving the clock
 * the test has deliberately set.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
