import type { BotStateMutation } from "../contract";

type DocumentChange = Exclude<Extract<BotStateMutation, { target: "memory" | "settings" }>, { action: "overwrite" }>;
export function memoryFacts(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.startsWith("- ") && line.length > 2).map((line) => line.slice(2));
}
export function mutateStateDocument(content: string, change: DocumentChange): string {
  if (change.target === "memory") {
    const line = `- ${change.fact}`;
    if (change.action === "append") {
      if (memoryFacts(content).includes(change.fact)) return content;
      return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
    }
    // Remove exact recorded bullet lines only. Preserve surrounding notes,
    // headings, line endings, and substrings of other facts byte-for-byte.
    return content.split(/(?<=\n)/).filter((part) => part.replace(/\r?\n$/, "") !== line).join("");
  }
  const current = JSON.parse(content);
  if (!current || Array.isArray(current) || typeof current !== "object") throw new Error("settings.json must contain a JSON object");
  const entries = Object.entries(current);
  const next = change.action === "set"
    ? Object.fromEntries([...entries, ...Object.entries(change.values)])
    : Object.fromEntries(entries.filter(([key]) => !change.keys.includes(key)));
  if (JSON.stringify(next) === JSON.stringify(current)) return content;
  return `${JSON.stringify(next, null, 2)}\n`;
}
