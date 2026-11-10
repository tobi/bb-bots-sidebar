import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { threadListRpcContract } from "../components/chat-thread-list/upstream/server";
import { PREFERENCES_CHANGED_CHANNEL } from "../components/chat-thread-list/upstream/shared/preferences";
import { z } from "zod";

export function registerChatThreadList(bb: BbPluginApi) {
  bb.rpc.register(threadListRpcContract, {
    listPreferences: () => bb.sdk.plugins.callRpc({
      pluginId: "thread-list", method: "listPreferences", input: null,
      outputSchema: threadListRpcContract.listPreferences.output,
    }),
    async setPreference(input) {
      const result = await bb.sdk.plugins.callRpc({
        pluginId: "thread-list", method: "setPreference", input: z.json().parse(input),
        outputSchema: threadListRpcContract.setPreference.output,
      });
      bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { ...result, origin: input.origin ?? null });
      return result;
    },
    async resetPreference(input) {
      const result = await bb.sdk.plugins.callRpc({
        pluginId: "thread-list", method: "resetPreference", input,
        outputSchema: threadListRpcContract.resetPreference.output,
      });
      bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { ...result, origin: null });
      return result;
    },
  });
}
