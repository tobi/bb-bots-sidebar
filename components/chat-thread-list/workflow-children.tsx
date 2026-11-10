import { useEffect, useMemo, useRef } from "react";
import { useBbNavigate, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useWorkflowRuns, WorkflowRunRow } from "../workflow-runs";
import type { WorkflowRun } from "../../lib/workflow-runs";
import { useChatScope } from "./chat-scope";
import { getSidebarThreadRowPaddingLeft } from "./upstream/ui/components/ui/sidebar-row-classes";

const NO_RUNS: readonly WorkflowRun[] = [];
const NOOP = () => {};

/** Workflow runs remain virtual children, outside native thread actions and DnD. */
export function useChatWorkflowChildren(
  thread: PluginSidebarThread,
  isCollapsed: boolean,
  onToggleCollapsed: (threadId: string) => void,
): readonly WorkflowRun[] {
  const scope = useChatScope();
  const { byOwner } = useWorkflowRuns();
  const runs = scope && !thread.isArchived ? byOwner.get(thread.id) ?? NO_RUNS : NO_RUNS;
  const activeAgentId = runs.some(run => run.agents.some(agent => agent.threadId === scope?.activeThreadId))
    ? scope?.activeThreadId ?? null : null;
  const seenRuns = useRef(new Set<string>());
  const previousAgentId = useRef<string | null>(null);
  useEffect(() => {
    const fresh = runs.filter(run => run.status !== "idle" && !seenRuns.current.has(run.key));
    for (const run of fresh) seenRuns.current.add(run.key);
    const navigatedToAgent = activeAgentId !== null && activeAgentId !== previousAgentId.current;
    previousAgentId.current = activeAgentId;
    // Reveal on a new run or navigation. A later manual fold must stick.
    if (isCollapsed && (fresh.length > 0 || navigatedToAgent)) onToggleCollapsed(thread.id);
  }, [runs, activeAgentId, isCollapsed, onToggleCollapsed, thread.id]);
  return runs;
}

export function useChatWorkflowParents(threads: readonly PluginSidebarThread[]): ReadonlySet<string> {
  const enabled = useChatScope() !== null;
  const { byOwner } = useWorkflowRuns();
  return useMemo(() => new Set(threads.filter(thread =>
    enabled && !thread.isArchived && (byOwner.get(thread.id)?.length ?? 0) > 0,
  ).map(thread => thread.id)), [enabled, threads, byOwner]);
}

export function ChatWorkflowChildren({ runs, depth, onNavigate = NOOP }: {
  runs: readonly WorkflowRun[];
  depth: number;
  onNavigate?: () => void;
}) {
  const scope = useChatScope();
  const navigate = useBbNavigate();
  if (!runs.length) return null;
  return <ul className="chat-workflow-children" style={{ paddingLeft: getSidebarThreadRowPaddingLeft(depth) }}>
    {runs.map(run => <WorkflowRunRow key={run.key} run={run} activeThreadId={scope?.activeThreadId ?? null} navigate={navigate} onNavigate={onNavigate} />)}
  </ul>;
}
