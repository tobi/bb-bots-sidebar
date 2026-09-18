import { describe, expect, it } from "vitest";
import { newThreadRequestSchema } from "../lib/new-thread-request";
import { request } from "./fixtures";

describe("provider environment request validation", () => {
  it("defaults omitted provider inputs to null like the host contract", () => {
    const environment = { type: "provider", environmentProviderId: "workspace", machine: { type: "new", machineProviderId: "machines" } };
    expect(newThreadRequestSchema.parse({ ...request, environment }).environment).toEqual({
      ...environment, inputs: null, machine: { ...environment.machine, inputs: null },
    });
  });

  it.each([
    { type: "existing" },
    { type: "existing", hostId: "" },
    { type: "new", inputs: null },
    { type: "unexpected", hostId: "host" },
  ])("still rejects malformed machine selections (%j)", (machine) => {
    expect(newThreadRequestSchema.safeParse({ ...request, environment: {
      type: "provider", environmentProviderId: "workspace", inputs: null, machine,
    } }).success).toBe(false);
  });
});
