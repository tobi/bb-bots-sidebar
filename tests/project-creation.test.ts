import { afterEach, describe, expect, it } from "vitest";
import type { BotMetadata } from "../contract";
import { normalizeHostPath, pathKindFromHome } from "../lib/project-creation";
import { backend, project } from "./backend-fixture";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST = "22222222-2222-4222-8222-222222222222";
const instances: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map((host) => host.harness.lifecycle.dispose())); });
async function setup(projects = [project()]) { const host = await backend(projects); instances.push(host); return host; }

function listed(id: string, name: string, hostId: string, path: string, createdAt = Date.now()) {
  return { id, name, kind: "standard" as const, gitRemoteUrl: null, createdAt, updatedAt: createdAt, sources: [{ id: `source-${id}`, projectId: id, hostId, path, type: "local_path" as const, isDefault: true, createdAt, updatedAt: createdAt }] };
}

function allowProjectApis(host: Awaited<ReturnType<typeof backend>>, options: { home?: string; existingDirs?: string[]; existingFiles?: string[]; entries?: { kind: "directory" | "file"; name: string; path: string }[] } = {}) {
  const home = options.home ?? "/home/me";
  const dirs = new Set(options.existingDirs ?? []);
  const files = new Set(options.existingFiles ?? []);
  const created: { mkdir: string[]; create: unknown[] } = { mkdir: [], create: [] };
  host.harness.inspection.sdk.stub("hosts.directory", async (...args: never[]) => {
    const { path } = args[0] as { hostId: string; path?: string };
    const directory = path ?? home;
    if (path && files.has(path)) throw new Error(`Path "${path}" is not a directory`);
    if (path && !dirs.has(path)) throw new Error(`ENOENT: ${path}`);
    return { directory, parent: directory === "/" ? null : directory.replace(/\/[^/]+$/, "") || "/", entries: options.entries ?? [] };
  });
  host.harness.inspection.sdk.stub("files.mkdir", async (...args: never[]) => {
    const { path } = args[0] as { path: string };
    created.mkdir.push(path); dirs.add(path); return { ok: true };
  });
  host.harness.inspection.sdk.stub("projects.create", async (...args: never[]) => {
    const { name, source } = args[0] as { name: string; source: { hostId: string; path: string } };
    created.create.push({ name, source });
    const value = listed(`created-${created.create.length}`, name, source.hostId, source.path);
    host.projects.push(value);
    return value;
  });
  return { created, dirs, setHome: (next: string) => { options.home = next; } };
}

describe("host path normalization", () => {
  it("uses posix/win32 semantics for dots, repeats, and trailing separators", () => {
    expect(pathKindFromHome("/home/me")).toBe("posix");
    expect(pathKindFromHome("C:\\Users\\me")).toBe("win32");
    expect(normalizeHostPath("/work//notes/./foo/../bar/", "posix")).toBe("/work/notes/bar");
    expect(normalizeHostPath("C:\\work\\notes\\..\\notes\\", "win32")).toBe("C:\\work\\notes");
    expect(normalizeHostPath("C:/work/notes/", "win32")).toBe("C:\\work\\notes");
  });

  it("rejects roots, NUL, and Windows paths under posix flavor", () => {
    expect(() => normalizeHostPath("/", "posix")).toThrow(/filesystem root/);
    expect(() => normalizeHostPath("/foo/../..", "posix")).toThrow(/filesystem root/);
    expect(() => normalizeHostPath("C:\\", "win32")).toThrow(/filesystem root/);
    expect(() => normalizeHostPath("/work/notes\0", "posix")).toThrow(/NUL/);
    expect(() => normalizeHostPath("C:\\work\\notes", "posix")).toThrow(/Native Windows paths/);
    expect(() => normalizeHostPath("relative", "posix")).toThrow(/absolute path/);
  });
});

describe("project_browse", () => {
  it("lists directories only, sorted and bounded, on the explicit host", async () => {
    const host = await setup();
    const entries = [
      { kind: "file" as const, name: "README.md", path: "/home/me/README.md" },
      { kind: "directory" as const, name: "zeta", path: "/home/me/zeta" },
      { kind: "directory" as const, name: "Alpha", path: "/home/me/Alpha" },
      ...Array.from({ length: 201 }, (_, index) => ({ kind: "directory" as const, name: `dir-${String(index).padStart(3, "0")}`, path: `/home/me/dir-${String(index).padStart(3, "0")}` })),
    ];
    allowProjectApis(host, { existingDirs: ["/home/me"], entries });
    const listing = await host.harness.behavior.callRpc("project_browse", { hostId: "host-home", path: "/home/me" }) as { directory: string; parent: string | null; entries: { name: string; path: string }[]; truncated: boolean };
    expect(listing.directory).toBe("/home/me");
    expect(listing.parent).toBe("/home");
    expect(listing.entries.some((entry) => entry.name === "README.md")).toBe(false);
    expect(listing.entries.map((entry) => entry.name).slice(0, 2)).toEqual(["Alpha", "dir-000"]);
    expect(listing.entries).toHaveLength(200);
    expect(listing.truncated).toBe(true);
    expect(listing.entries.every((entry) => !("kind" in entry))).toBe(true);
    expect(host.harness.inspection.sdk.callsTo("hosts.directory")).toEqual([[{ hostId: "host-home" }], [{ hostId: "host-home", path: "/home/me" }]]);
  });

  it("omits path so hosts.directory uses the host default home", async () => {
    const host = await setup();
    allowProjectApis(host, { home: "/remote/home" });
    const listing = await host.harness.behavior.callRpc("project_browse", { hostId: "host-home" }) as { directory: string };
    expect(listing.directory).toBe("/remote/home");
    expect(host.harness.inspection.sdk.callsTo("hosts.directory")).toEqual([[{ hostId: "host-home" }]]);
  });

  it("expands ~ using the target host home from hosts.directory", async () => {
    const host = await setup();
    allowProjectApis(host, { home: "/remote/home", existingDirs: ["/remote/home/src"] });
    await host.harness.behavior.callRpc("project_browse", { hostId: "host-home", path: "~/src" });
    expect(host.harness.inspection.sdk.callsTo("hosts.directory")).toEqual([
      [{ hostId: "host-home" }],
      [{ hostId: "host-home", path: "/remote/home/src" }],
    ]);
  });

  it("rejects relative paths and disconnected hosts", async () => {
    const host = await setup();
    allowProjectApis(host);
    await expect(host.harness.behavior.callRpc("project_browse", { hostId: "host-home", path: "relative" })).rejects.toThrow(/absolute path/);
    host.offline.add("host-home");
    await expect(host.harness.behavior.callRpc("project_browse", { hostId: "host-home" })).rejects.toThrow(/Connect this machine/);
    await expect(host.harness.behavior.callRpc("project_browse", { hostId: "missing-host" })).rejects.toThrow(/enrolled execution machine/);
  });
});

describe("project_create", () => {
  const input = { requestId: REQUEST, name: "Notes", hostId: "host-home", path: "/work/notes" };

  it("creates a work project from an existing folder without writing bot files or mutating bots", async () => {
    const host = await setup();
    const bot = await host.create("Atlas", []);
    const { created } = allowProjectApis(host, { existingDirs: ["/work/notes"] });
    const result = await host.harness.behavior.callRpc("project_create", input) as { id: string; name: string };
    expect(result).toEqual({ id: "created-1", name: "Notes" });
    expect(created.mkdir).toEqual([]);
    expect(created.create).toEqual([{ name: "Notes", source: { type: "local_path", hostId: "host-home", path: "/work/notes" } }]);
    expect(host.store.require(bot.id).linkedProjectIds).toEqual([]);
    expect(host.store.projectOwners()).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  });

  it("creates a missing selected folder via files.mkdir after confirming it is a directory", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host);
    await host.harness.behavior.callRpc("project_create", input);
    expect(created.mkdir).toEqual(["/work/notes"]);
    expect(host.harness.inspection.sdk.callsTo("files.mkdir")).toEqual([[{ hostId: "host-home", path: "/work/notes", recursive: true }]]);
    expect(host.harness.inspection.sdk.callsTo("hosts.directory")).toEqual([
      [{ hostId: "host-home" }],
      [{ hostId: "host-home", path: "/work/notes" }],
      [{ hostId: "host-home", path: "/work/notes" }],
    ]);
    expect(host.harness.inspection.sdk.callsTo("files.write")).toEqual([]);
  });

  it("normalizes the selected path before duplicate checks and create", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host, { existingDirs: ["/work/notes"] });
    await host.harness.behavior.callRpc("project_create", { ...input, path: "/work//notes/./foo/../" });
    expect(created.mkdir).toEqual([]);
    expect(created.create).toEqual([{ name: "Notes", source: { type: "local_path", hostId: "host-home", path: "/work/notes" } }]);
  });

  it("expands ~ on the target host and freezes that path if home later changes", async () => {
    const host = await setup();
    const apis = allowProjectApis(host, { home: "/remote/home" });
    host.harness.inspection.sdk.stub("files.mkdir", async (...args: never[]) => {
      const { path } = args[0] as { path: string };
      apis.created.mkdir.push(path);
      throw new Error("mkdir failed");
    });
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: "~/notes/" })).rejects.toThrow(/mkdir failed/);
    allowProjectApis(host, { home: "/other/home", existingDirs: ["/remote/home/notes"] });
    await host.harness.behavior.callRpc("project_create", { ...input, path: "~/notes/" });
    expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([
      [{ name: "Notes", source: { type: "local_path", hostId: "host-home", path: "/remote/home/notes" } }],
    ]);
  });

  it("rejects a file at the selected path and Windows paths on a POSIX host before mkdir", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host, { existingFiles: ["/work/notes"] });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/must be a directory/);
    await expect(host.harness.behavior.callRpc("project_create", { ...input, requestId: OTHER_REQUEST, path: "C:\\work\\notes" })).rejects.toThrow(/Native Windows paths/);
    expect(created.mkdir).toEqual([]);
    expect(created.create).toEqual([]);
  });

  it("rejects filesystem roots", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host, { existingDirs: ["/"] });
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: "/" })).rejects.toThrow(/filesystem root/);
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: "/work/.." })).rejects.toThrow(/filesystem root/);
    expect(created.create).toEqual([]);
  });

  it("rejects a folder already registered as another project without renaming it", async () => {
    const host = await setup([project("taken", "host-home", "/work/notes")]);
    const { created } = allowProjectApis(host, { existingDirs: ["/work/notes"] });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/already registered as “Project taken”/);
    expect(created.create).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  });

  it("re-checks duplicates after mkdir and refuses core reuse of an existing project", async () => {
    const host = await setup();
    const apis = allowProjectApis(host);
    host.harness.inspection.sdk.stub("files.mkdir", async (...args: never[]) => {
      const { path } = args[0] as { path: string };
      apis.created.mkdir.push(path);
      apis.dirs.add(path);
      host.projects.push(listed("sneak", "Sneak", "host-home", path, Date.now()));
      return { ok: true };
    });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/already registered as “Sneak”/);
    expect(apis.created.create).toEqual([]);

    const reuse = await setup([project("taken", "host-home", "/other")]);
    allowProjectApis(reuse, { existingDirs: ["/work/notes"] });
    reuse.harness.inspection.sdk.stub("projects.create", async () => reuse.projects[0]);
    await expect(reuse.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/already registered/);
    expect(reuse.harness.inspection.sdk.callsTo("projects.update")).toEqual([]);
  });

  it("replays a completed request while offline, and throws if the project was deleted or moved", async () => {
    const host = await setup();
    allowProjectApis(host, { existingDirs: ["/work/notes"] });
    const first = await host.harness.behavior.callRpc("project_create", input) as { id: string; name: string };
    await expect(host.harness.behavior.callRpc("project_create", { ...input, name: "Other" })).rejects.toThrow(/different project details/);
    host.offline.add("host-home");
    expect(await host.harness.behavior.callRpc("project_create", input)).toEqual(first);

    const created = host.projects.find((entry) => entry.id === first.id)!;
    created.sources[0]!.path = "/work/moved";
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/folder changed/);
    host.projects.splice(host.projects.findIndex((entry) => entry.id === first.id), 1);
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/no longer available/);
  });

  it("does not create twice when two identical requests overlap", async () => {
    const host = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let creates = 0;
    allowProjectApis(host, { existingDirs: ["/work/notes"] });
    host.harness.inspection.sdk.stub("projects.create", async (...args: never[]) => {
      const { name, source } = args[0] as { name: string; source: { hostId: string; path: string } };
      creates += 1;
      await gate;
      const value = listed("created-1", name, source.hostId, source.path);
      host.projects.push(value);
      return value;
    });
    const first = host.harness.behavior.callRpc("project_create", input);
    const second = host.harness.behavior.callRpc("project_create", input);
    await expect.poll(() => creates).toBe(1);
    release();
    expect(await Promise.all([first, second])).toEqual([{ id: "created-1", name: "Notes" }, { id: "created-1", name: "Notes" }]);
    expect(creates).toBe(1);
  });

  it("reconciles a lost create response only after create was attempted", async () => {
    const host = await setup([project("taken", "host-home", "/work/preexisting")]);
    allowProjectApis(host, { existingDirs: ["/work/notes", "/work/preexisting"] });
    host.harness.inspection.sdk.stub("projects.create", async (...args: never[]) => {
      const { name, source } = args[0] as { name: string; source: { hostId: string; path: string } };
      const value = listed("lost-create", name, source.hostId, source.path);
      host.projects.push(value);
      throw new Error("Connection lost after creation");
    });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/Connection lost/);
    host.harness.inspection.sdk.stub("projects.create", async () => { throw new Error("should not create again"); });
    const recovered = await host.harness.behavior.callRpc("project_create", input) as { id: string; name: string };
    expect(recovered).toEqual({ id: "lost-create", name: "Notes" });
    await expect(host.harness.behavior.callRpc("project_create", { ...input, requestId: OTHER_REQUEST, path: "/work/preexisting", name: "Project taken" })).rejects.toThrow(/already registered/);
  });

  it("does not claim another actor's project after a preflight or mkdir failure", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host);
    host.harness.inspection.sdk.stub("files.mkdir", async () => { throw new Error("mkdir failed"); });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/mkdir failed/);
    host.projects.push(listed("actor", "Notes", "host-home", "/work/notes", Date.now()));
    allowProjectApis(host, { existingDirs: ["/work/notes"] });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/already registered as “Notes”/);
    expect(created.create).toEqual([]);
  });

  it("uses the host's real directory to reject a symlink alias of an existing project", async () => {
    const host = await setup([project("taken", "host-home", "/work/notes")]);
    const { created } = allowProjectApis(host, { existingDirs: ["/alias", "/work/notes"] });
    host.harness.inspection.sdk.stub("hosts.directory", async ({ path }: { path?: string }) => ({ directory: path === "/alias" ? "/work/notes" : path ?? "/home/me", parent: "/", entries: [] }));
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: "/alias" })).rejects.toThrow(/already registered/);
    expect(created.create).toEqual([]); expect(created.mkdir).toEqual([]);
  });

  it("registers and freezes the canonical directory returned by the target host", async () => {
    const host = await setup(); const { created } = allowProjectApis(host, { existingDirs: ["/alias", "/work/notes"] });
    host.harness.inspection.sdk.stub("hosts.directory", async ({ path }: { path?: string }) => ({ directory: path === "/alias" ? "/work/notes" : path ?? "/home/me", parent: "/", entries: [] }));
    const first = await host.harness.behavior.callRpc("project_create", { ...input, path: "/alias" });
    expect(created.create).toEqual([{ name: "Notes", source: { type: "local_path", hostId: "host-home", path: "/work/notes" } }]);
    expect(await host.harness.behavior.callRpc("project_create", { ...input, path: "/alias" })).toEqual(first);
  });

  it("leaves the folder in place when project create fails", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host);
    host.harness.inspection.sdk.stub("projects.create", async () => { throw new Error("create failed"); });
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/create failed/);
    expect(created.mkdir).toEqual(["/work/notes"]);
    expect(host.harness.inspection.sdk.callsTo("files.remove")).toEqual([]);
    expect(host.projects.map((entry) => entry.id)).toEqual(["project"]);
  });

  it("rejects an invalid requestId, empty name, and overlong path before touching the host filesystem", async () => {
    const host = await setup();
    const { created } = allowProjectApis(host);
    await expect(host.harness.behavior.callRpc("project_create", { ...input, requestId: "not-a-uuid" })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("project_create", { ...input, name: "   " })).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: `/${"a".repeat(4096)}` })).rejects.toThrow();
    expect(created.mkdir).toEqual([]);
    expect(created.create).toEqual([]);
  });

  it("rejects relative paths and disconnected hosts, while bot_create stays offline", async () => {
    const host = await setup();
    allowProjectApis(host);
    await expect(host.harness.behavior.callRpc("project_create", { ...input, path: "notes" })).rejects.toThrow(/absolute path/);
    host.offline.add("host-home");
    await expect(host.harness.behavior.callRpc("project_create", input)).rejects.toThrow(/Connect this machine/);
    const bot = await host.create("Offline-ready", []) as BotMetadata;
    expect(bot.stateReady).toBe(true);
    expect(host.harness.inspection.sdk.callsTo("projects.create")).toEqual([]);
  });
});
