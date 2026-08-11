import { describe, expect, it } from "vitest";
import { taskMutation } from "./task-mutation";

describe("taskMutation", () => {
  it("turns a rejected fetch into an actionable result", async () => {
    const result = await taskMutation("/tasks/1", { method: "DELETE" }, "Could not delete task", async () => {
      throw new TypeError("offline");
    });

    expect(result).toEqual({ ok: false, payload: null, message: "Could not delete task" });
  });

  it("preserves a server-provided mutation error", async () => {
    const result = await taskMutation("/file-requests/1", { method: "DELETE" }, "Could not delete request", async () => (
      new Response(JSON.stringify({ error: { message: "Request is used by a task" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      })
    ));

    expect(result).toMatchObject({ ok: false, message: "Request is used by a task" });
  });
});
