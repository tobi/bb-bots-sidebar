import { renderSlot as renderSdkSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { defaultPreferences } from "../components/chat-thread-list/upstream/shared/preferences";
import { resetPreferencesSyncForTest } from "../components/chat-thread-list/upstream/app/preferences/preferences-sync";
import { resetSidebarDataCacheForTest } from "../components/chat-thread-list/upstream/app/model/use-sidebar-data";

// The SDK deliberately doesn't emulate BB's registered thread actions. Supply
// explicit test doubles; lifecycle tests control the resulting sidebar snapshot.
export function renderSlot<Props extends object>(registration: { component: React.ComponentType<Props> }, props: Props, options: RenderSlotOptions = {}) {
  resetPreferencesSyncForTest();
  resetSidebarDataCacheForTest();
  const nativeActionCalls: Array<{ key: string; threadId: string }> = [];
  const slot = renderSdkSlot(registration, props, {
    ...options,
    rpc: { listPreferences: () => ({ preferences: defaultPreferences() }), ...options.rpc },
    sdk: { ...options.sdk, threads: {
      update: async ({ threadId, title }) => makeThreadResponse({ id: threadId, title }),
      ...options.sdk?.threads,
    } },
    threadActions: options.threadActions ?? ((thread, { requestRename }) => [
      { key: "bb--core/rename", pluginId: "bb--core", group: "settings", action: { label: "Rename…", icon: "Pencil", run: async () => requestRename(thread.id) } },
      ...[
        ["open-in-split", "Open in split"],
        [thread.isUnread ? "mark-read" : "mark-unread", thread.isUnread ? "Mark as read" : "Mark as unread"],
        ["archive", "Archive conversation"],
      ].map(([id, label]) => ({
        key: `bb--core/${id}`, pluginId: "bb--core", group: "lifecycle",
        action: { label: label!, icon: "Archive" as const, run: async () => { nativeActionCalls.push({ key: `bb--core/${id}`, threadId: thread.id }); } },
      })),
    ]),
  });
  return Object.assign(slot, { nativeActionCalls });
}
