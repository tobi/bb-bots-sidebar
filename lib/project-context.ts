import type { BotMetadata } from "../contract";
import type { BotStore } from "./bot-store";

type Project = { id: string; name: string; kind: "personal" | "standard" };
export type BotProjectContext = {
  id: string; name: string;
  role: "owner" | "member" | "unjoined" | "personal" | "legacy-home";
  ownerBotId: string | null; ownerName: string | null;
};

/** Read-only: membership and durable thread bindings are independent. */
export function botProjectContext(bot: BotMetadata, project: Project, store: BotStore): BotProjectContext {
  const base = { id: project.id, name: project.name, ownerBotId: null, ownerName: null };
  if (project.kind === "personal") return { ...base, role: "personal" };
  if (store.list().some((entry) => entry.legacyHomeProjectId === project.id)) return { ...base, role: "legacy-home" };
  const owner = store.projectOwner(project.id);
  return {
    ...base,
    role: owner?.botId === bot.id ? "owner" : bot.linkedProjectIds.includes(project.id) ? "member" : "unjoined",
    ownerBotId: owner?.botId ?? null,
    ownerName: owner ? store.get(owner.botId)?.name ?? "Unavailable bot" : null,
  };
}

const label = (value: string, limit: number) => JSON.stringify(value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, limit));
export function projectContextInstructions(project: BotProjectContext): string {
  if (project.role === "personal") return "No work project: this is a personal conversation. Your linked projects do not make this chat part of them.";
  if (project.role === "legacy-home") return "This conversation is in a legacy bot-home project, retained for history. It is not an owned work project; your state is private in BB.";
  const location = `Current project: ${label(project.name, 60)} (ID: ${label(project.id, 80)}).`;
  if (project.role === "owner") return `${location}\nYou are the owner of this project (and a member).`;
  const membership = project.role === "member" ? "You joined this project as a member." : "You have not joined this project. This conversation's bot identity does not imply membership.";
  const ownership = project.ownerBotId ? `The project owner is bot ${label(project.ownerName!, 60)} (ID: ${label(project.ownerBotId, 80)}).` : "This project currently has no bot owner.";
  return `${location}\n${membership} ${ownership}`;
}
