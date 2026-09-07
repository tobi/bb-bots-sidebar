import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function RenameConversationDialog({ title, onSave, onClose, heading = "Rename conversation", description = "Choose the name shown in the sidebar." }: {
  title: string;
  heading?: string;
  description?: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  async function save() {
    const next = name.trim();
    if (!next || saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        Name
        <Input autoFocus value={name} disabled={pending} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); } }} />
      </label>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={pending || !name.trim()} onClick={() => void save()}>{pending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
