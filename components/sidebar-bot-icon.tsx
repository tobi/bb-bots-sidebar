import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BotAvatar } from "../lib/appearance";
import { useIdleExpression } from "../hooks/use-idle-expression";
import { isWorking } from "../lib/conversations";
import { BotIcon } from "./bot-icon";

export function SidebarBotIcon({ botId, avatar, threads, idleVariant, selected }: {
  botId: string; avatar: BotAvatar; threads: readonly PluginSidebarThread[]; idleVariant: number; selected: boolean;
}) {
  const current = threads.filter(thread => !thread.isArchived);
  const working = current.some(isWorking);
  const needsAttention = current.some(thread => thread.hasPendingInteraction || thread.indicator === "waiting-for-input" || (thread.isUnread && thread.indicator === "unread-error"));
  const lastActivityAt = current.length ? current.reduce((latest, thread) => Math.max(latest, thread.updatedAt, thread.latestAttentionAt), 0) : null;
  const expression = useIdleExpression({ botId, expression: avatar.expression, motion: avatar.motion, awake: working || needsAttention, lastActivityAt });
  return <BotIcon avatar={expression === avatar.expression ? avatar : { ...avatar, expression }} size={30} working={working} idleVariant={idleVariant} selected={selected} />;
}
