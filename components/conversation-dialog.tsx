import { useRef, useState } from "react";
import { experimental_NewThreadComposer as NewThreadComposer } from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import type { BotMetadata } from "../contract";
import { conversationDraftKey } from "../lib/worktree-launch";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export type ConversationTarget = {
  bot: BotMetadata;
  kind: "bot" | "project" | "worktree";
  projectId: string;
  environment: NewThreadRequest["environment"];
  makeMain: boolean;
};

export function ConversationDialog({ target, onClose, onCreate }: {
  target: ConversationTarget;
  onClose: () => void;
  onCreate: (request: NewThreadRequest) => Promise<void>;
}) {
  // The target is captured when the popup opens. Let the host's own project
  // picker handle changes without re-seeding and resetting the user's choices.
  const projectId = target.projectId;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const movingMain = target.makeMain && target.bot.mainThreadId !== null;
  const title = target.makeMain ? (movingMain ? "Move main conversation" : "New main conversation") : target.kind === "bot" ? "New conversation" : target.kind === "worktree" ? "New conversation in worktree" : "New conversation in project";
  const description = target.kind === "bot"
    ? `Chat with ${target.bot.name} without a project. ${movingMain ? "The existing main stays in place until you send; its history is kept." : "Choose the machine and harness before sending."}`
    : target.kind === "worktree"
      ? "Start in a fresh worktree. Choose the branch and harness before sending."
      : "Start in the project checkout. Change the project, machine, or harness here before sending.";
  return <Dialog open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" onOpenAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <NewThreadComposer defaultProjectId={projectId} defaultEnvironment={target.environment} layout="document" focusRequest={1} draftKey={conversationDraftKey({ botId: target.bot.id, kind: target.kind, makeMain: target.makeMain, projectId, environment: target.environment })} onSubmit={async (request) => {
        if (submitting.current) throw new Error("A conversation is already being created.");
        submitting.current = true; setPending(true); setError(null);
        try { await onCreate(request); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
        finally { submitting.current = false; setPending(false); }
      }} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {pending ? <p role="status" className="text-xs text-muted-foreground">Creating conversation…</p> : null}
      {movingMain ? <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancel moving main</Button></DialogFooter> : null}
    </DialogContent>
  </Dialog>;
}
