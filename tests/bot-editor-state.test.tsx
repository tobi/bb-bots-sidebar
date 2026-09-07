// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { z } from "zod";
import { rpcContract, type BotMetadata } from "../contract";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const hash = "a".repeat(64);
const hashes = { "SOUL.md": hash, "AGENTS.md": hash, "MEMORY.md": hash, "settings.json": hash };
type Update = z.infer<typeof rpcContract.bot_update.input>;
async function mount({ update, prepareFailures = 0, expectFailure = false }: { update?: (input: Update) => BotMetadata | Promise<BotMetadata>; prepareFailures?: number; expectFailure?: boolean } = {}) {
  let current: BotMetadata = { ...bot, id: "remote-bot", name: "Remote bot", hostId: "remote", stateReady: false, soul: "Stale cached identity" };
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "main", activeProjectId: "project", isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [{ id: "project", name: "Unrelated checkout", isPersonal: false }], threads: [thread("main", 100)] },
    rpc: {
      bots_list: () => ({ bots: [{ ...current }], hosts: [], sections: [], projects: [], warnings: [], personalProjectId, threadBindings: [{ botId: current.id, threadId: "main" }] }),
      bot_prepare: () => {
        if (prepareFailures-- > 0) throw new Error("Private state unavailable");
        if (!current.stateReady) current = { ...current, stateReady: true, soul: "Fresh private identity", agents: "Private instructions", memory: "- A private fact.\n", settings: { style: "concise" }, updatedAt: 10, stateHashes: hashes };
        return current;
      },
      bot_update: async (raw) => {
        const input = rpcContract.bot_update.input.parse(raw);
        if (update) return await update(input);
        current = { ...current, name: input.name, role: input.role, avatar: input.avatar, soul: input.soul, memory: input.memory ?? current.memory, settings: input.settings ?? current.settings, updatedAt: 11 };
        return current;
      },
    },
  });
  async function open() { fireEvent.contextMenu(await slot.findByText(current.name)); expect(slot.queryByRole("menuitem", { name: "View bot state…" })).toBeNull(); fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" })); }
  await open();
  const dialog = expectFailure ? null : await slot.findByRole("dialog", { name: "Edit bot" });
  return { slot, dialog: dialog!, onNavigate, open, getCurrent: () => current, changeCurrent: (patch: Partial<BotMetadata>) => { current = { ...current, ...patch }; } };
}
function file(dialog: HTMLElement, name: "SOUL.md" | "MEMORY.md" | "settings.json") {
  fireEvent.click(within(dialog).getByRole("tab", { name: name === "SOUL.md" ? "Instructions" : "State" }));
  if (name !== "SOUL.md") fireEvent.click(within(dialog).getByRole("button", { name }));
  return within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name });
}

it("puts the three active logical files in Edit bot with one Save and no separate state action", async () => {
  const { slot, dialog, onNavigate } = await mount();
  expect(within(dialog).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Setup", "Instructions", "State", "Projects · 1", "Appearance"]);
  expect(file(dialog, "SOUL.md").value).toBe("Fresh private identity");
  expect(file(dialog, "MEMORY.md").value).toBe("- A private fact.\n");
  expect(JSON.parse(file(dialog, "settings.json").value)).toEqual({ style: "concise" });
  expect(dialog.querySelectorAll("textarea")).toHaveLength(1);
  expect(within(dialog).queryByRole("button", { name: "Save file" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Save bot" }).closest('[role="tabpanel"]')).toBeNull();
  expect(slot.inspection.rpcCalls.every(call => ["bots_list", "bot_prepare"].includes(call.method))).toBe(true);
  expect(onNavigate).not.toHaveBeenCalled(); expect(slot.inspection.navigateCalls).toEqual([]);
  expect(dialog.textContent).not.toMatch(/\/home\/|Home folder|Unrelated checkout/);
});

it("retains every draft across tabs and atomically submits all files with original hashes", async () => {
  const { slot, dialog } = await mount();
  fireEvent.change(file(dialog, "SOUL.md"), { target: { value: "New soul\nSecond line" } });
  const memory = file(dialog, "MEMORY.md"); expect(fireEvent.keyDown(memory, { key: "Enter" })).toBe(true);
  fireEvent.change(memory, { target: { value: "- New memory.\n" } });
  fireEvent.change(file(dialog, "settings.json"), { target: { value: '{"style":"detailed","nested":{"enabled":true}}' } });
  fireEvent.click(within(dialog).getByRole("tab", { name: "Appearance" }));
  expect(file(dialog, "MEMORY.md").value).toBe("- New memory.\n");
  expect(file(dialog, "SOUL.md").value).toBe("New soul\nSecond line");
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_update")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.rpcCalls.filter(call => call.method === "bot_update")).toEqual([{ method: "bot_update", input: expect.objectContaining({ botId: "remote-bot", soul: "New soul\nSecond line", memory: "- New memory.\n", settings: { style: "detailed", nested: { enabled: true } }, expectedUpdatedAt: 10, expectedStateHashes: hashes }) }]);
  expect(slot.inspection.rpcCalls.some(call => call.method === "state_update")).toBe(false);
});

it("keeps state drafts and their original revisions on conflicts and realtime refresh", async () => {
  const { slot, dialog, changeCurrent } = await mount({ update: () => { throw new Error("MEMORY.md changed while editing"); } });
  fireEvent.change(file(dialog, "MEMORY.md"), { target: { value: "Keep my memory draft" } });
  fireEvent.change(file(dialog, "settings.json"), { target: { value: '{"keep":"settings draft"}' } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("MEMORY.md changed");
  changeCurrent({ memory: "Changed elsewhere", updatedAt: 20 }); await slot.behavior.emitRealtime("project-bots-changed", {});
  expect(file(dialog, "MEMORY.md").value).toBe("Keep my memory draft");
  expect(file(dialog, "settings.json").value).toBe('{"keep":"settings draft"}');
  expect(slot.inspection.rpcCalls.filter(call => call.method === "bot_update")).toHaveLength(1);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(confirm).toHaveBeenCalledWith("Discard unsaved bot state changes?"); expect(slot.getByRole("dialog")).toBe(dialog);
});

it.each(["{", "[]", "null", "4", '{"limit":1e400}'])("retains invalid settings %s without partially saving other fields", async (invalid) => {
  const { slot, dialog } = await mount();
  fireEvent.change(file(dialog, "MEMORY.md"), { target: { value: "Unsaved memory" } });
  fireEvent.change(file(dialog, "settings.json"), { target: { value: invalid } });
  fireEvent.click(within(dialog).getByRole("tab", { name: "Setup" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await within(dialog).findByRole("alert");
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "settings.json" }).value).toBe(invalid);
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_update")).toBe(false);
  fireEvent.change(file(dialog, "settings.json"), { target: { value: '{"fixed":true}' } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ memory: "Unsaved memory", settings: { fixed: true } }) });
});

it("rejects oversized canonical settings before any mutation", async () => {
  const { slot, dialog } = await mount(); const value = Object.fromEntries(Array.from({ length: 1500 }, (_, index) => [`k${index}`, 0]));
  expect(JSON.stringify(value).length).toBeLessThan(16384); expect(JSON.stringify(value, null, 2).length).toBeGreaterThan(16384);
  fireEvent.change(file(dialog, "settings.json"), { target: { value: JSON.stringify(value) } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("too large");
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_update")).toBe(false);
});

it("does not expose stale cached state when preparation fails and allows reopening", async () => {
  const { slot, open } = await mount({ prepareFailures: 1, expectFailure: true });
  expect((await slot.findByRole("alert")).textContent).toContain("Private state unavailable"); expect(slot.queryByRole("dialog")).toBeNull();
  await open(); const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  expect(file(dialog, "SOUL.md").value).toBe("Fresh private identity");
});

it("blocks duplicate writes and closing while a unified save is pending", async () => {
  let resolve!: (value: BotMetadata) => void; const response = new Promise<BotMetadata>(done => { resolve = done; });
  const { slot, dialog, getCurrent } = await mount({ update: () => response });
  fireEvent.change(file(dialog, "MEMORY.md"), { target: { value: "Save once" } });
  const save = within(dialog).getByRole("button", { name: "Save bot" }); fireEvent.click(save); fireEvent.click(save);
  expect(slot.inspection.rpcCalls.filter(call => call.method === "bot_update")).toHaveLength(1);
  fireEvent.keyDown(dialog, { key: "Escape" }); expect(slot.getByRole("dialog")).toBe(dialog);
  expect(file(dialog, "settings.json").disabled).toBe(true);
  await act(async () => { resolve({ ...getCurrent(), memory: "Save once" }); });
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
});

it("removes bot AGENTS controls and retains an oversized memory draft without partial submission", async () => {
  const { slot, dialog } = await mount();
  file(dialog, "SOUL.md");
  expect(within(dialog).queryByText("AGENTS.md")).toBeNull();
  const memory = file(dialog, "MEMORY.md");
  fireEvent.change(memory, { target: { value: "x".repeat(3001) } });
  expect(memory.value).toHaveLength(3001);
  expect(within(dialog).getByText("3001/3000")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("3000 characters");
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_update")).toBe(false);
  expect(file(dialog, "MEMORY.md").value).toHaveLength(3001);
  fireEvent.change(file(dialog, "MEMORY.md"), { target: { value: "x".repeat(3000) } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.rpcCalls.find(call => call.method === "bot_update")?.input).toMatchObject({ memory: "x".repeat(3000) });
  expect(slot.inspection.rpcCalls.find(call => call.method === "bot_update")?.input).not.toHaveProperty("agents");
});

it("reads legacy oversized memory and saves unrelated edits without rewriting it", async () => {
  const { slot, dialog, open, changeCurrent } = await mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  changeCurrent({ memory: "L".repeat(8000) });
  await open();
  const reopened = await slot.findByRole("dialog", { name: "Edit bot" });
  expect(file(reopened, "MEMORY.md").value).toHaveLength(8000);
  fireEvent.change(within(reopened).getByRole("textbox", { name: "Bot name" }), { target: { value: "Renamed safely" } });
  fireEvent.click(within(reopened).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const saved = slot.inspection.rpcCalls.find(call => call.method === "bot_update")!.input;
  expect(saved).toMatchObject({ name: "Renamed safely" });
  expect(saved).not.toHaveProperty("memory");
});
