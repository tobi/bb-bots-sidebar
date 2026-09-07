import { useEffect, useId, useRef, useState } from "react";
import type { BotMetadata } from "../contract";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function AssignConversationDialog({ bots, title, onAssign, onClose }: {
  bots: BotMetadata[];
  title: string;
  onAssign: (botId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [botId, setBotId] = useState(bots.length === 1 ? bots[0]!.id : "");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  useEffect(() => {
    if (!bots.some((bot) => bot.id === botId)) setBotId(bots.length === 1 ? bots[0]!.id : "");
  }, [bots, botId]);
  return <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>Assign conversation to bot</DialogTitle><DialogDescription>Associate “{title}” with a bot. Its unassigned descendants will follow it; its project and history stay unchanged. The bot joins its work project as a member if needed.</DialogDescription></DialogHeader>
    {bots.length ? <div className="space-y-1.5"><label htmlFor={selectId} className="block text-xs font-medium text-muted-foreground">Bot</label><Select value={botId} onValueChange={setBotId} disabled={pending}><SelectTrigger id={selectId}><SelectValue placeholder="Choose a bot" /></SelectTrigger><SelectContent>{bots.map((bot) => <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>)}</SelectContent></Select></div> : <p className="text-sm text-muted-foreground">No bots yet. Create a bot first.</p>}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={() => { if (!saving.current) onClose(); }}>Cancel</Button><Button type="button" disabled={pending || !bots.some((bot) => bot.id === botId)} onClick={async () => {
      if (saving.current || !bots.some((bot) => bot.id === botId)) return;
      saving.current = true; setPending(true); setError(null);
      try { await onAssign(botId); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { saving.current = false; setPending(false); }
    }}>{pending ? "Assigning…" : "Assign"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
