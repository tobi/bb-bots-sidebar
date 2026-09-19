// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);

async function mount() {
  const bots = [
    { ...bot, id: "one", name: "Bot one", sectionId: "first", mainThreadId: "main-one" },
    { ...bot, id: "two", name: "Bot two", sectionId: "first", mainThreadId: "main-two", order: 1 },
    { ...bot, id: "three", name: "Bot three", sectionId: "second", mainThreadId: "main-three", order: 2 },
  ];
  const sections = [{ id: "first", name: "First", order: 0 }, { id: "second", name: "Second", order: 1 }];
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: "main-one", activeProjectId: "one", isCompactViewport: false,
    onNavigate: vi.fn(), searchQuery: "", Original: () => null,
  }, {
    sidebarThreads: {
      projects: [{ id: "project", name: "Shared project", isPersonal: false }],
      threads: bots.map((bot) => thread(bot.mainThreadId, 100)),
    },
    rpc: {
      bots_list: () => ({ bots, sections, personalProjectId, hosts: [{ id: "host", name: "Local", connected: true }], projects: [{ id: "project", name: "Shared project" }], warnings: [], threadBindings: bots.map((bot) => ({ botId: bot.id, threadId: bot.mainThreadId })) }),
      bots_reorder: () => ({ ok: true }),
      bot_update: () => bots[0],
      bot_prepare: () => bots[0],
      section_update: () => sections[0],
      section_create: () => { const section = { id: "new", name: "New section", order: 2 }; sections.push(section); return section; },
    },
  });
  await slot.findByText("Bot one");
  return slot;
}

it("keeps one open-main button and one inline new-chat button; settings remain in the menu/editor", async () => {
  const slot = await mount();
  const row = slot.getByText("Bot one").closest<HTMLElement>(".project-row")!;
  fireEvent.mouseEnter(row);
  fireEvent.focus(within(row).getByRole("button", { name: /^Bot one/ }));
  expect(within(row).getAllByRole("button")).toHaveLength(3);
  expect(within(row).getByRole("button", { name: "New conversation with Bot one" })).toBeTruthy();
  expect(row.draggable).toBe(true);
  expect(slot.container.querySelector(".project-row-actions")).toBeNull();
  expect(slot.queryByRole("menu")).toBeNull();
  expect(slot.queryByRole("button", { name: /Move .* up|Edit bot|Hide until activity/ })).toBeNull();
  fireEvent.contextMenu(row);
  expect(await slot.findByRole("menuitem", { name: "Edit bot…" })).toBeTruthy();
  expect(slot.queryByRole("menuitem", { name: "Move up" })).toBeNull();
});

it("keeps Enter from saving the bot editor and lets SOUL use newlines", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("Bot one"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" }));
  const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  const name = within(dialog).getByRole("textbox", { name: "Bot name" });
  fireEvent.change(name, { target: { value: "Updated bot" } });
  expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(false);
  fireEvent.click(within(dialog).getByRole("tab", { name: "Instructions" }));
  const soul = within(dialog).getByRole("textbox", { name: "SOUL.md" });
  expect(fireEvent.keyDown(soul, { key: "Enter" })).toBe(true);
  fireEvent.change(soul, { target: { value: "First line\nSecond line" } });
  fireEvent.submit(dialog.querySelector("form")!);
  expect(slot.inspection.rpcCalls.some((call) => call.method === "bot_update")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ botId: "one", name: "Updated bot", soul: "First line\nSecond line", expectedUpdatedAt: bot.updatedAt, expectedStateHashes: bot.stateHashes }) }));
});

it("keeps the editor compact with one panel, retained drafts, and an outside-panel footer", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("Bot one"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" }));
  const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  expect(within(dialog).getAllByRole("tab")).toHaveLength(5);
  expect(within(dialog).getAllByRole("tabpanel")).toHaveLength(1);
  expect(dialog.querySelector("textarea")).toBeNull();
  expect(within(dialog).getByRole("img", { name: "Bot preview" }).getAttribute("width")).toBe("48");
  expect(within(dialog).getByRole("button", { name: "Save bot" }).closest('[role="tabpanel"]')).toBeNull();
  const setup = within(dialog).getByRole("tab", { name: "Setup" });
  setup.focus(); fireEvent.keyDown(setup, { key: "ArrowRight" });
  expect(within(dialog).getByRole("tab", { name: "Instructions" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "SOUL.md" }), { target: { value: "Soul draft" } });
  expect(dialog.querySelectorAll("textarea")).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Customize avatar" }));
  expect(within(dialog).getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Happy" }));
  fireEvent.click(within(dialog).getByRole("tab", { name: "Instructions" }));
  expect((within(dialog).getByRole("textbox", { name: "SOUL.md" }) as HTMLTextAreaElement).value).toBe("Soul draft");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "bot_update", input: expect.objectContaining({ soul: "Soul draft", avatar: expect.objectContaining({ expression: "happy" }) }) }));
});

it.each(["reorder", "section"])("restores drag-to-%s without arrow controls", async (kind) => {
  const slot = await mount();
  const dragged = slot.getByText("Bot two").closest<HTMLElement>(".project-row")!;
  const dataTransfer = { effectAllowed: "", setData: vi.fn() };
  fireEvent.dragStart(dragged, { dataTransfer });
  expect(dragged.dataset.dragging).toBe("true");
  const target = kind === "reorder" ? slot.getByText("Bot one").closest(".project-group")! : slot.container.querySelector('[data-section-id="second"]')!;
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  const placements = kind === "reorder" ? [
    { botId: "two", sectionId: "first" }, { botId: "one", sectionId: "first" }, { botId: "three", sectionId: "second" },
  ] : [
    { botId: "one", sectionId: "first" }, { botId: "three", sectionId: "second" }, { botId: "two", sectionId: "second" },
  ];
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "bots_reorder", input: { bots: placements } }));
});

it("renames sections through the section context menu", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("First"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Rename section…" }));
  const dialog = await slot.findByRole("dialog", { name: "Rename section" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Projects" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "section_update", input: { sectionId: "first", name: "Projects" } }));
});

it("can create a section inside Edit without saving or closing the bot", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("Bot one"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" }));
  const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  expect(within(dialog).queryByRole("button", { name: "New section…" })).toBeNull();
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Section" }), { target: { value: "__create_section__" } });
  expect((within(dialog).getByRole("button", { name: "Save bot" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "New section name" }), { target: { value: "New section" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add section" }));
  await waitFor(() => expect((within(dialog).getByRole("combobox", { name: "Section" }) as HTMLSelectElement).value).toBe("new"));
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "section_create", input: { name: "New section" } });
  expect(slot.inspection.rpcCalls.some((call) => call.method === "bot_update")).toBe(false);
});

it("cancels Create New without changing the selected section", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("Bot one"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" }));
  const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  const select = within(dialog).getByRole("combobox", { name: "Section" }) as HTMLSelectElement;
  expect(select.value).toBe("first");
  fireEvent.change(select, { target: { value: "__create_section__" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "New section name" }), { target: { value: "Not saved" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel section creation" }));
  expect(select.value).toBe("first");
  expect(slot.inspection.rpcCalls.some((call) => call.method === "section_create")).toBe(false);
});

it("offers an empty Main drop target only during a drag", async () => {
  const slot = await mount();
  expect(slot.queryByText("Move to Main")).toBeNull();
  const dragged = slot.getByText("Bot two").closest<HTMLElement>(".project-row")!;
  const dataTransfer = { effectAllowed: "", setData: vi.fn() };
  fireEvent.dragStart(dragged, { dataTransfer });
  const target = slot.getByText("Move to Main");
  fireEvent.drop(target, { dataTransfer });
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({ method: "bots_reorder", input: { bots: [
    { botId: "two", sectionId: null }, { botId: "one", sectionId: "first" }, { botId: "three", sectionId: "second" },
  ] } }));
  expect(slot.queryByText("Move to Main")).toBeNull();
});

it("removes Move main and keeps ordinary new conversations cancellable", async () => {
  const slot = await mount();
  fireEvent.contextMenu(slot.getByText("Bot one"));
  expect(slot.queryByRole("menuitem", { name: "Move main…" })).toBeNull();
  fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation…" }));
  const dialog = await slot.findByRole("dialog", { name: "New conversation" });
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
  expect(slot.getByTestId("bb-new-thread-composer").getAttribute("data-default-project-id")).toBe(personalProjectId);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.rpcCalls.some((call) => call.method === "main_set" || call.method === "conversation_create")).toBe(false);
});
