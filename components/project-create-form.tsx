import { useEffect, useRef, useState } from "react";
import type { ProjectCreateInput } from "../contract";
import { Button } from "./ui/button";
import { MachineSelect } from "./machine-select";
import { Input } from "./ui/input";

export type ProjectChoice = { id: string; name: string };
export type ProjectHost = { id: string; name: string; connected: boolean };
export type ProjectDirectory = { directory: string; parent: string | null; entries: { name: string; path: string }[]; truncated: boolean };
export type ProjectCreationActions = {
  onCreateProject: (input: ProjectCreateInput) => Promise<ProjectChoice>;
  onBrowseProjects: (input: { hostId: string; path?: string }) => Promise<ProjectDirectory>;
};

export function ProjectCreateForm({ hosts, defaultHostId, defaultName = "", onCreateProject, onBrowseProjects, onCreated, onCancel, onBusyChange, forBot = false }: ProjectCreationActions & {
  hosts: ProjectHost[]; defaultHostId?: string; defaultName?: string; onCreated: (project: ProjectChoice) => void; onCancel: () => void; onBusyChange: (busy: boolean) => void; forBot?: boolean;
}) {
  const preferredHost = hosts.find((host) => host.id === defaultHostId && host.connected) ?? hosts.find((host) => host.connected);
  const [hostId, setHostId] = useState(preferredHost?.id ?? "");
  const [name, setName] = useState(defaultName);
  const [path, setPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [directory, setDirectory] = useState<ProjectDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const busy = useRef(false);
  const browseSequence = useRef(0);
  const mounted = useRef(true);
  const online = hosts.some((host) => host.id === hostId && host.connected);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; browseSequence.current++; }; }, []);
  useEffect(() => { if (!hostId && preferredHost) { setHostId(preferredHost.id); requestId.current = crypto.randomUUID(); } }, [hostId, preferredHost]);
  function changed() { requestId.current = crypto.randomUUID(); setError(null); }
  async function browse(nextPath?: string) {
    const sequence = ++browseSequence.current;
    setBrowsing(true); setLoading(true); setError(null);
    try {
      const value = await onBrowseProjects({ hostId, ...(nextPath ? { path: nextPath } : {}) });
      if (mounted.current && browseSequence.current === sequence) setDirectory(value);
    } catch (cause) { if (mounted.current && browseSequence.current === sequence) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current && browseSequence.current === sequence) setLoading(false); }
  }
  function closeBrowser() { browseSequence.current++; setBrowsing(false); setLoading(false); setError(null); }
  async function create() {
    if (busy.current || !name.trim() || !path.trim() || !online) return;
    busy.current = true; setCreating(true); setError(null); onBusyChange(true);
    try { onCreated(await onCreateProject({ requestId: requestId.current, name: name.trim(), hostId, path: path.trim() })); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busy.current = false; onBusyChange(false); if (mounted.current) setCreating(false); }
  }
  return <div className="project-create-form space-y-2" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); } }}>
    {browsing ? <>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Choose a folder</span><button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={closeBrowser}>Back to project</button></div>
      <div className="flex items-center gap-2"><button type="button" className="text-xs underline" disabled={loading} onClick={() => void browse()}>Home</button><button type="button" className="text-xs underline disabled:opacity-40" disabled={loading || !directory?.parent} onClick={() => void browse(directory!.parent!)}>Up</button><span className="min-w-0 truncate text-[11px] text-muted-foreground" title={directory?.directory}>{directory?.directory ?? "Select a folder"}</span></div>
      <div className="max-h-28 min-h-12 overflow-y-auto rounded-md border border-border p-1" aria-label="Folders">
        {loading ? <p role="status" className="p-2 text-xs text-muted-foreground">Loading folders…</p> : directory?.entries.map((entry) => <button key={entry.path} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-state-hover" title={entry.path} onClick={() => void browse(entry.path)}>{entry.name}</button>)}
        {!loading && directory && !directory.entries.length ? <p className="p-2 text-xs text-muted-foreground">No subfolders</p> : null}
      </div>
      {directory?.truncated ? <p className="text-[10px] text-muted-foreground">First 200 folders shown. You can also enter a path directly.</p> : null}
      <Button type="button" size="sm" disabled={loading || !directory || Boolean(error)} onClick={() => { changed(); setPath(directory!.directory); closeBrowser(); }}>Use this folder</Button>
    </> : <>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">Project name<Input autoFocus className="h-8" value={name} maxLength={120} disabled={creating} onChange={(event) => { changed(); setName(event.target.value); }} placeholder="My project" /></label>
        <MachineSelect label="Project machine" hosts={hosts} value={hostId} connectedOnly disabled={creating} onValueChange={(value) => { changed(); browseSequence.current++; setDirectory(null); setPath(""); setHostId(value); }} />
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">Project folder<span className="flex gap-2"><Input aria-label="Project folder" className="h-8 min-w-0 flex-1 font-mono text-xs" maxLength={4096} value={path} disabled={creating} onChange={(event) => { changed(); setPath(event.target.value); }} placeholder="~/projects/my-project" /><Button type="button" size="sm" variant="outline" className="h-8" disabled={creating || !online} onClick={() => void browse(path.trim() || undefined)}>Browse…</Button></span></label>
      <p className="text-[11px] leading-4 text-muted-foreground">Missing folders are created; existing files stay untouched.{forBot ? " Creates the project now; save the bot to make it owner. The project remains if you cancel the bot." : ""}</p>
      {!online ? <p role="status" className="text-xs text-muted-foreground">Connect a machine to create a project.</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" disabled={creating} onClick={onCancel}>{forBot ? "Cancel project" : "Cancel"}</Button><Button type="button" size="sm" disabled={creating || !online || !name.trim() || !path.trim()} onClick={() => void create()}>{creating ? "Creating…" : "Create project"}</Button></div>
    </>}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}
