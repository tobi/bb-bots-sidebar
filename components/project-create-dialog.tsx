import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ProjectCreateForm, type ProjectChoice, type ProjectCreationActions, type ProjectHost } from "./project-create-form";

export function ProjectCreateDialog({ hosts, onCreateProject, onBrowseProjects, onCreated, onClose }: ProjectCreationActions & { hosts: ProjectHost[]; onCreated: (project: ProjectChoice) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Create project</DialogTitle><DialogDescription>A work folder on one of your machines. No bot is required.</DialogDescription></DialogHeader>
      <ProjectCreateForm hosts={hosts} onCreateProject={onCreateProject} onBrowseProjects={onBrowseProjects} onBusyChange={setBusy} onCancel={onClose} onCreated={onCreated} />
    </DialogContent>
  </Dialog>;
}
