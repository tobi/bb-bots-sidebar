import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  experimental_usePluginId,
  useRealtime,
  useRpc,
  useRealtimeConnectionState,
} from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import { PREFERENCES_CHANGED_CHANNEL } from "../../shared/preferences.js";
import {
  applyRemotePreferenceSignal,
  attachPreferencesStore,
  hydratePreferences,
  hydratePreferencesFromMirror,
  preferencesReadyAtom,
} from "./preferences-sync.js";

export function usePreferencesReady(): boolean {
  return useAtomValue(preferencesReadyAtom());
}

let syncOwnerCount = 0;

export function usePreferencesSync(): void {
  const rpc = useRpc<typeof threadListRpcContract>();
  const store = useStore();
  const pluginId = experimental_usePluginId();
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    attachPreferencesStore(store, pluginId);
    syncOwnerCount += 1;
    if (syncOwnerCount === 1) {
      hydratePreferencesFromMirror();
      void hydratePreferences(rpc).catch((error: unknown) => {
        console.warn(
          `${pluginId}: loading preferences failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    return () => {
      syncOwnerCount -= 1;
    };
  }, [pluginId, rpc, store]);
  useEffect(() => {
    if (connection !== "connected") return;
    const reconcile = () => {
      void hydratePreferences(rpc).catch(() => {});
    };
    window.addEventListener("focus", reconcile);
    reconcile();
    return () => window.removeEventListener("focus", reconcile);
  }, [connection, rpc]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, applyRemotePreferenceSignal);
}

export function PreferencesSync() {
  usePreferencesSync();
  return null;
}
