import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerChatThreadList } from "../lib/chat-thread-list-server";
import threadListPlugin from "../components/chat-thread-list/upstream/server";
import { defaultPreferences } from "../components/chat-thread-list/upstream/shared/preferences";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of dispose.splice(0).reverse()) await close(); });

async function fixture() {
  const native = createFakePluginHost({ pluginId: "thread-list" });
  dispose.push(() => native.harness.lifecycle.dispose());
  await threadListPlugin(native.bb);
  const proxy = createFakePluginHost({ pluginId: "bots-sidebar", sdk: { plugins: {
    callRpc: async ({ pluginId, method, input }) => {
      expect(pluginId).toBe("thread-list");
      return native.harness.behavior.callRpc(method, input);
    },
  } } });
  dispose.push(() => proxy.harness.lifecycle.dispose());
  registerChatThreadList(proxy.bb);
  return { native, proxy };
}

it("reads native preferences and forwards writes and resets to the same store", async () => {
  const { native, proxy } = await fixture();
  expect(await proxy.harness.behavior.callRpc("listPreferences", null)).toEqual({ preferences: defaultPreferences() });
  expect(await proxy.harness.behavior.callRpc("setPreference", { key: "organizationMode", value: "chronological", origin: "test" })).toEqual({ key: "organizationMode", value: "chronological" });
  expect(proxy.harness.inspection.realtimeSignals).toEqual([{ channel: "preferences", payload: { key: "organizationMode", value: "chronological", origin: "test" } }]);
  expect(await native.harness.behavior.callRpc("listPreferences", null)).toMatchObject({ preferences: { organizationMode: "chronological" } });
  expect(await proxy.harness.behavior.callRpc("resetPreference", { key: "organizationMode" })).toEqual({ key: "organizationMode", value: defaultPreferences().organizationMode });
  expect(proxy.harness.inspection.realtimeSignals.at(-1)).toEqual({ channel: "preferences", payload: { key: "organizationMode", value: defaultPreferences().organizationMode, origin: null } });
});

it("rejects invalid values without changing the native store", async () => {
  const { native, proxy } = await fixture();
  await expect(proxy.harness.behavior.callRpc("setPreference", { key: "organizationMode", value: "invalid" })).rejects.toThrow();
  await expect(proxy.harness.behavior.callRpc("setPreference", { key: "unknown", value: true })).rejects.toThrow();
  expect(await native.harness.behavior.callRpc("listPreferences", null)).toEqual({ preferences: defaultPreferences() });
  expect(proxy.harness.inspection.realtimeSignals).toEqual([]);
});
