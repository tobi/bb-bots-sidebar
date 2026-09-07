import { posix, win32 } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProjectCreateInput } from "../contract";
import type { BotStore } from "./bot-store";

const DIRECTORY_LIMIT = 200;
const PATH_MAX = 4096;
const requestKey = (requestId: string) => `project-create:${requestId}`;

type PathKind = "posix" | "win32";
type ProjectCreateRecord = {
  name: string;
  hostId: string;
  path: string;
  resolvedPath: string;
  startedAt: number;
  knownProjectIds: string[];
  createAttempted: boolean;
  projectId: string | null;
};

type ListedProject = Awaited<ReturnType<BbPluginApi["sdk"]["projects"]["list"]>>[number];

const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]?$/u;
const WINDOWS_UNC = /^\\\\[^\\]+(?:\\[^\\]+)?/u;

export function pathKindFromHome(home: string): PathKind {
  return WINDOWS_DRIVE_ABSOLUTE.test(home) || home.startsWith("\\\\") ? "win32" : "posix";
}

function api(kind: PathKind) {
  return kind === "win32" ? win32 : posix;
}

function isWindowsNativePath(path: string) {
  return WINDOWS_DRIVE_ABSOLUTE.test(path) || WINDOWS_DRIVE_ROOT.test(path) || WINDOWS_UNC.test(path);
}

function isFilesystemRoot(path: string, kind: PathKind) {
  if (kind === "posix") return path === "/";
  if (WINDOWS_DRIVE_ROOT.test(path)) return true;
  return /^\\\\[^\\]+\\[^\\]+$/u.test(path);
}

export function normalizeHostPath(path: string, kind: PathKind, options: { allowRoot?: boolean } = {}) {
  if (path.includes("\0")) throw new Error("Path must not contain NUL");
  if (path.length > PATH_MAX) throw new Error("Project path is too long.");
  if (kind === "posix" && isWindowsNativePath(path)) {
    throw new Error("Native Windows paths are not supported. Use a POSIX path like /home/me/repo or /mnt/c/Users/me/repo.");
  }
  const impl = api(kind);
  if (kind === "win32" && !WINDOWS_DRIVE_ABSOLUTE.test(path) && !WINDOWS_UNC.test(path.replaceAll("/", "\\"))) throw new Error("Use a full drive or network path for this Windows machine.");
  if (!impl.isAbsolute(path)) throw new Error("Project path must be an absolute path.");
  const normalized = impl.normalize(path);
  const stripped = isFilesystemRoot(normalized, kind) ? normalized : normalized.replace(/[\\/]+$/u, "") || normalized;
  if (stripped.length > PATH_MAX) throw new Error("Project path is too long.");
  if (!options.allowRoot && isFilesystemRoot(stripped, kind)) throw new Error("Project path must point to a project directory, not the filesystem root.");
  return stripped;
}

async function hostHome(bb: BbPluginApi, hostId: string) {
  const { directory } = await bb.sdk.hosts.directory({ hostId });
  return { home: directory, kind: pathKindFromHome(directory) };
}

export async function requireConnectedHost(bb: BbPluginApi, hostId: string, action: "browse folders" | "create a project") {
  const host = (await bb.sdk.hosts.list()).find((entry) => entry.id === hostId);
  if (!host) throw new Error("Choose an enrolled execution machine");
  if (host.status !== "connected") throw new Error(`Connect this machine before you ${action}`);
  return host;
}

export async function resolveHostPath(bb: BbPluginApi, hostId: string, path: string, options: { allowRoot?: boolean } = {}) {
  const trimmed = path.trim();
  const { home, kind } = await hostHome(bb, hostId);
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const rest = trimmed === "~" ? "" : trimmed.slice(2);
    const joined = rest ? api(kind).join(home, rest) : home;
    return normalizeHostPath(joined, kind, options);
  }
  return normalizeHostPath(trimmed, kind, options);
}

function localPathSources(project: ListedProject) {
  return ("sources" in project ? project.sources : []) ?? [];
}

function sourceMatches(project: ListedProject, hostId: string, path: string, kind: PathKind) {
  return localPathSources(project).some((source) => {
    if (source.type !== "local_path" || source.hostId !== hostId) return false;
    try { return normalizeHostPath(source.path, kind, { allowRoot: true }) === path; } catch { return source.path === path; }
  });
}

function projectForSource(projects: ListedProject[], hostId: string, path: string, kind: PathKind) {
  return projects.find((project) => sourceMatches(project, hostId, path, kind));
}

function duplicateFolderError(project: { name: string }) {
  return new Error(`This folder is already registered as “${project.name}”. Choose a different folder.`);
}

function samePayload(record: ProjectCreateRecord, input: ProjectCreateInput) {
  return record.name === input.name && record.hostId === input.hostId && record.path === input.path;
}

function isMissingPathError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /enoent|no such file|not found|does not exist/i.test(message) && !/not a directory/i.test(message);
}

function isNotDirectoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not a directory/i.test(message);
}

async function requireDirectory(bb: BbPluginApi, hostId: string, path: string) {
  try {
    return (await bb.sdk.hosts.directory({ hostId, path })).directory;
  } catch (error) {
    if (isNotDirectoryError(error)) throw new Error("Project path must be a directory.");
    throw error;
  }
}

async function ensureDirectory(bb: BbPluginApi, hostId: string, path: string) {
  try {
    return await requireDirectory(bb, hostId, path);
  } catch (error) {
    if (isNotDirectoryError(error) || !isMissingPathError(error)) throw error;
  }
  await bb.sdk.files.mkdir({ hostId, path, recursive: true });
  return await requireDirectory(bb, hostId, path);
}

function claimableLostCreate(record: ProjectCreateRecord, project: ListedProject, kind: PathKind) {
  return record.createAttempted && project.name === record.name && !record.knownProjectIds.includes(project.id)
    && project.createdAt >= record.startedAt && sourceMatches(project, record.hostId, record.resolvedPath, kind);
}

export async function browseProjectDirectory(bb: BbPluginApi, input: { hostId: string; path?: string }) {
  await requireConnectedHost(bb, input.hostId, "browse folders");
  const trimmed = input.path?.trim();
  const path = trimmed ? await resolveHostPath(bb, input.hostId, trimmed, { allowRoot: true }) : undefined;
  const listing = await bb.sdk.hosts.directory({ hostId: input.hostId, ...(path ? { path } : {}) });
  const directories = listing.entries
    .filter((entry) => entry.kind === "directory")
    .map(({ name, path: entryPath }) => ({ name, path: entryPath }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    directory: listing.directory,
    parent: listing.parent,
    entries: directories.slice(0, DIRECTORY_LIMIT),
    truncated: directories.length > DIRECTORY_LIMIT,
  };
}

export async function createWorkProject(bb: BbPluginApi, store: BotStore, input: ProjectCreateInput) {
  const key = requestKey(input.requestId);
  const stored = store.state<ProjectCreateRecord>(key);
  if (stored && !samePayload(stored, input)) throw new Error("This create request already used different project details. Use a new requestId.");

  if (stored?.projectId) {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    const found = projects.find((project) => project.id === stored.projectId);
    if (!found) throw new Error("This project is no longer available. Use a new requestId.");
    const kind = pathKindFromHome(stored.resolvedPath);
    if (!sourceMatches(found, stored.hostId, stored.resolvedPath, kind)) throw new Error("This project's folder changed. Use a new requestId.");
    return { id: found.id, name: found.name };
  }

  await requireConnectedHost(bb, input.hostId, "create a project");
  const resolvedPath = stored?.resolvedPath ?? await resolveHostPath(bb, input.hostId, input.path);
  const pathKind = pathKindFromHome(resolvedPath);

  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const existing = projectForSource(projects, input.hostId, resolvedPath, pathKind);
  if (stored && existing && claimableLostCreate(stored, existing, pathKind)) {
    store.setState(key, { ...stored, projectId: existing.id });
    return { id: existing.id, name: existing.name };
  }
  if (existing) throw duplicateFolderError(existing);

  let record: ProjectCreateRecord = stored ?? {
    name: input.name, hostId: input.hostId, path: input.path, resolvedPath,
    startedAt: Date.now(), knownProjectIds: projects.map((project) => project.id), createAttempted: false, projectId: null,
  };
  if (!stored) store.setState(key, record);

  const canonicalPath = normalizeHostPath(await ensureDirectory(bb, input.hostId, record.resolvedPath), pathKind);
  if (canonicalPath !== record.resolvedPath) {
    if (record.createAttempted) throw new Error("This project's folder changed. Use a new requestId.");
    record = { ...record, resolvedPath: canonicalPath };
    store.setState(key, record);
  }

  const latest = await bb.sdk.projects.list({ includePersonal: true });
  const afterFolder = projectForSource(latest, input.hostId, record.resolvedPath, pathKind);
  if (record.createAttempted && afterFolder && claimableLostCreate(record, afterFolder, pathKind)) {
    store.setState(key, { ...record, projectId: afterFolder.id });
    return { id: afterFolder.id, name: afterFolder.name };
  }
  if (afterFolder) throw duplicateFolderError(afterFolder);

  const attempted: ProjectCreateRecord = { ...record, knownProjectIds: [...new Set([...record.knownProjectIds, ...latest.map((project) => project.id)])], createAttempted: true };
  store.setState(key, attempted);
  const created = await bb.sdk.projects.create({
    name: input.name,
    source: { type: "local_path", hostId: input.hostId, path: record.resolvedPath },
  });
  if (attempted.knownProjectIds.includes(created.id)) throw duplicateFolderError(created);
  if (created.kind !== "standard" || created.name !== input.name || !sourceMatches(created, input.hostId, record.resolvedPath, pathKind)) throw new Error("Project creation returned an unexpected project. Review it before retrying.");
  store.setState(key, { ...attempted, projectId: created.id });
  return { id: created.id, name: created.name };
}
