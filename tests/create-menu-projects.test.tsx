// @vitest-environment jsdom
import { selectOption } from "./select-helper";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { rpcContract, type BotMetadata } from "../contract";
import { bot, personalProjectId } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);
async function mount({ projectFailures = 0, botFailures = 0, offline = false } = {}) {
  const bots: BotMetadata[] = [];
  const projects = [{ id: "existing", name: "Existing work" }];
  const sections: { id: string; name: string; order: number }[] = [];
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [], threads: [] }, rpc: {
      bots_list: () => ({ bots, projects, sections, hosts: [{ id: "host", name: "Local", connected: !offline }, { id: "remote", name: "Remote", connected: !offline }], personalProjectId, warnings: [], threadBindings: [], projectOwners: [] }),
      section_create: (raw) => { const { name } = rpcContract.section_create.input.parse(raw); const section = { id: "section", name, order: 0 }; sections.push(section); return section; },
      project_create: (raw) => { const input = rpcContract.project_create.input.parse(raw); if (projectFailures-- > 0) throw new Error("Temporary project failure"); const project = { id: "new-project", name: input.name }; if (!projects.some(entry => entry.id === project.id)) projects.push(project); return project; },
      project_browse: (raw) => { const input = rpcContract.project_browse.input.parse(raw); return { directory: input.path ?? `/home/${input.hostId}`, parent: "/", entries: [{ name: "work", path: "/work" }], truncated: false }; },
      bot_create: (raw) => { const input = rpcContract.bot_create.input.parse(raw); if (botFailures-- > 0) throw new Error("Ownership changed; review your draft"); const value = { ...bot, id: "created", name: input.name, role: input.role, soul: input.soul, hostId: input.hostId, mainThreadId: null, linkedProjectIds: input.linkedProjectIds }; bots.push(value); return value; },
      bot_prepare: () => bots[0],
    },
  });
  await waitFor(() => expect(slot.queryByText("Loading bots…")).toBeNull());
  return { slot, bots, projects, onNavigate };
}
type Slot = Awaited<ReturnType<typeof mount>>["slot"];
async function choose(slot: Slot, kind: "Bot" | "Section" | "Project") {
  fireEvent.keyDown(slot.getByRole("button", { name: "Create…" }), { key: "ArrowDown" });
  fireEvent.click(await slot.findByRole("menuitem", { name: kind }));
}
async function botProject(slot: Slot) {
  await choose(slot, "Bot"); const dialog = await slot.findByRole("dialog", { name: "Create bot" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot name" }), { target: { value: "Builder" } });
  fireEvent.click(within(dialog).getByRole("tab", { name: /^Projects/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "New project…" }));
  return dialog;
}
function fillProject(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Project name" }), { target: { value: "Client app" } });
  selectOption(within(dialog).getByRole("combobox", { name: "Project machine" }), "Remote");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Project folder" }), { target: { value: "/work/client-app" } });
}

it("uses one + menu with Bot, Section, and Project without creating anything on open", async () => {
  const { slot } = await mount();
  expect(slot.queryByText("+ Section")).toBeNull();
  expect(slot.queryByRole("button", { name: "Create bot" })).toBeNull();
  fireEvent.keyDown(slot.getByRole("button", { name: "Create…" }), { key: "ArrowDown" });
  const menu = await slot.findByRole("menu");
  expect(menu.hasAttribute("data-bb-plugin-root")).toBe(true);
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map(item => item.textContent)).toEqual(["Bot", "Section", "Project"]);
  expect(items.every(item => item.classList.contains("bot-menu-item"))).toBe(true);
  expect(slot.inspection.rpcCalls.map(call => call.method)).toEqual(["bots_list"]);
});

it("creates sections explicitly through the menu and lets their draft be cancelled", async () => {
  const { slot } = await mount(); await choose(slot, "Section");
  fireEvent.change(slot.getByRole("textbox", { name: "Section name" }), { target: { value: "Team" } });
  fireEvent.submit(slot.getByRole("textbox", { name: "Section name" }).closest("form")!);
  expect(slot.inspection.rpcCalls.some(call => call.method === "section_create")).toBe(false);
  fireEvent.click(slot.getByRole("button", { name: "Cancel section creation" }));
  expect(slot.queryByRole("textbox", { name: "Section name" })).toBeNull();
  await choose(slot, "Section"); fireEvent.click(slot.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(slot.queryByRole("textbox", { name: "Section name" })).toBeNull());
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "section_create", input: { name: "Team" } });
});

it("creates a standalone work project on the selected host without making a bot", async () => {
  const { slot, bots, onNavigate } = await mount(); await choose(slot, "Project");
  const dialog = await slot.findByRole("dialog", { name: "Create project" }); fillProject(dialog);
  expect(fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Project folder" }), { key: "Enter" })).toBe(false);
  expect(slot.inspection.rpcCalls.some(call => call.method === "project_create")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "project_create", input: { requestId: expect.any(String), name: "Client app", hostId: "remote", path: "/work/client-app" } });
  expect(bots).toEqual([]); expect(onNavigate).toHaveBeenCalledOnce();
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toProject", projectId: "new-project" });
});

it("only lists linked projects and offers a searchable explicit existing-project picker", async () => {
  const { slot } = await mount(); await choose(slot, "Bot"); const dialog = await slot.findByRole("dialog", { name: "Create bot" });
  fireEvent.click(within(dialog).getByRole("tab", { name: /^Projects/ }));
  expect(within(dialog).getByText("No projects linked")).toBeTruthy(); expect(within(dialog).queryByText("Existing work")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Add existing…" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Search projects" }), { target: { value: "missing" } });
  expect(within(dialog).getByText("No matching projects")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Search projects" }), { target: { value: "work" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Link Existing work" }));
  expect((within(dialog).getByRole("combobox", { name: "Existing work role" }) as HTMLSelectElement).value).toBe("member");
  fireEvent.click(within(dialog).getByRole("button", { name: "Unlink Existing work" }));
  expect(within(dialog).getByText("No projects linked")).toBeTruthy();
  expect(slot.inspection.rpcCalls.map(call => call.method)).toEqual(["bots_list"]);
});

it("retains the inline new-project draft across tabs and links it as Owner only on bot Save", async () => {
  const { slot } = await mount(); const dialog = await botProject(slot); fillProject(dialog);
  expect((within(dialog).getByRole("button", { name: "Create bot" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("tab", { name: "Instructions" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "SOUL.md" }), { target: { value: "Keep my bot draft" } });
  fireEvent.click(within(dialog).getByRole("tab", { name: /^Projects/ }));
  expect((within(dialog).getByRole("textbox", { name: "Project name" }) as HTMLInputElement).value).toBe("Client app");
  expect((within(dialog).getByRole("textbox", { name: "Project folder" }) as HTMLInputElement).value).toBe("/work/client-app");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await within(dialog).findByRole("combobox", { name: "Client app role" });
  expect((within(dialog).getByRole("combobox", { name: "Client app role" }) as HTMLSelectElement).value).toBe("owner");
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_create")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" }));
  await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === "bot_create")).toBe(true));
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_create", input: expect.objectContaining({ name: "Builder", soul: "Keep my bot draft", linkedProjectIds: ["new-project"], ownedProjectIds: ["new-project"] }) });
  expect(slot.inspection.rpcCalls.filter(call => call.method === "project_create")).toHaveLength(1);
});

it("does not create a project from an unsubmitted project draft", async () => {
  const { slot } = await mount(); const dialog = await botProject(slot); fillProject(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel project" }));
  expect((within(dialog).getByRole("button", { name: "Create bot" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(slot.inspection.rpcCalls.map(call => call.method)).toEqual(["bots_list"]);
});

it("keeps an explicitly created project if bot creation is cancelled, without linking it", async () => {
  const { slot, projects, bots } = await mount(); const dialog = await botProject(slot); fillProject(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await within(dialog).findByText(/cancelling the bot won’t delete/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(projects.some(project => project.id === "new-project")).toBe(true); expect(bots).toEqual([]);
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_create" || call.method === "project_delete" || call.method === "state_apply")).toBe(false);
});

it("reuses a request ID on retry and retains a created project through a failed bot save", async () => {
  const { slot } = await mount({ projectFailures: 1, botFailures: 1 }); const dialog = await botProject(slot); fillProject(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await within(dialog).findByRole("alert");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await within(dialog).findByRole("combobox", { name: "Client app role" });
  const calls = slot.inspection.rpcCalls.filter(call => call.method === "project_create"); expect(calls).toHaveLength(2); expect(calls[0]!.input).toEqual(calls[1]!.input);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" })); await within(dialog).findByText("Ownership changed; review your draft");
  expect((within(dialog).getByRole("combobox", { name: "Client app role" }) as HTMLSelectElement).value).toBe("owner");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create bot" }));
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "bot_create")).toHaveLength(2));
  expect(slot.inspection.rpcCalls.filter(call => call.method === "project_create")).toHaveLength(2);
});

it("browses folders on the chosen machine without creating anything", async () => {
  const { slot } = await mount(); await choose(slot, "Project"); const dialog = await slot.findByRole("dialog", { name: "Create project" });
  selectOption(within(dialog).getByRole("combobox", { name: "Project machine" }), "Remote");
  fireEvent.click(within(dialog).getByRole("button", { name: "Browse…" })); await within(dialog).findByText("/home/remote");
  fireEvent.click(within(dialog).getByRole("button", { name: "work" })); await within(dialog).findByText("/work");
  fireEvent.click(within(dialog).getByRole("button", { name: "Use this folder" }));
  expect((within(dialog).getByRole("textbox", { name: "Project folder" }) as HTMLInputElement).value).toBe("/work");
  expect(slot.inspection.rpcCalls.filter(call => call.method === "project_browse")).toEqual([{ method: "project_browse", input: { hostId: "remote" } }, { method: "project_browse", input: { hostId: "remote", path: "/work" } }]);
  expect(slot.inspection.rpcCalls.some(call => call.method === "project_create")).toBe(false);
});

it("disables project creation when no machine is connected", async () => {
  const { slot } = await mount({ offline: true }); await choose(slot, "Project"); const dialog = await slot.findByRole("dialog", { name: "Create project" });
  expect(within(dialog).getByText("Connect a machine to create a project.")).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: "Create project" }) as HTMLButtonElement).disabled).toBe(true);
});
