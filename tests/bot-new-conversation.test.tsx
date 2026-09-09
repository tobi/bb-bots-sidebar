// @vitest-environment jsdom
import { createElement } from "react";
import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { rpcContract, type BotMetadata, type ProjectOwner } from "../contract";
import { bot, personalProjectId, request, thread } from "./fixtures";

const composer = vi.hoisted(() => ({ props: null as NewThreadComposerProps | null }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...sdk, experimental_NewThreadComposer: (props: NewThreadComposerProps) => {
    composer.props = props; return createElement(sdk.experimental_NewThreadComposer, props);
  } };
});
const app = await loadPluginApp(() => import("../app"));
afterEach(async () => {
  cleanup(); composer.props = null;
  // Radix defers focus restoration; drain it before JSDOM's Event realm closes.
  await new Promise(resolve => setTimeout(resolve, 0));
});
const props = () => { if (!composer.props) throw new Error("Missing composer"); return composer.props; };

async function mount({ bots = [bot], owners = [], rows = [thread("main", 100), thread("child", 90, { parentThreadId: "main" })], prepare, beforeList }: {
  bots?: BotMetadata[]; owners?: ProjectOwner[]; rows?: ReturnType<typeof thread>[];
  prepare?: () => Promise<void>; beforeList?: () => void;
} = {}) {
  const state = { bots, owners, personalId: personalProjectId };
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "main", activeProjectId: "project", isCompactViewport: false, onNavigate, searchQuery: "", Original: () => null }, {
    sidebarThreads: { projects: [{ id: "project", name: "Member project", isPersonal: false }, { id: "owned", name: "Owned project", isPersonal: false }], threads: rows },
    rpc: {
      bots_list: () => { beforeList?.(); return rpcContract.bots_list.output.parse({ bots: state.bots, hosts: [{ id: "host", name: "Local", connected: true }], sections: [], projects: [{ id: "project", name: "Member project" }, { id: "owned", name: "Owned project" }], threadBindings: rows.map(row => ({ botId: bot.id, threadId: row.id })), warnings: [], personalProjectId: state.personalId, projectOwners: state.owners }); },
      bot_prepare: async (raw) => { await prepare?.(); const { botId } = rpcContract.bot_prepare.input.parse(raw); return state.bots.find(entry => entry.id === botId) ?? bot; },
      conversation_create: () => ({ threadId: "created" }),
    },
  });
  await waitFor(() => expect(slot.queryByText("Loading bots…")).toBeNull());
  return { slot, state, onNavigate, plus: () => slot.getByRole("button", { name: `New conversation with ${bots[0]!.name}` }) };
}

it("gives every row one inline + before its disclosure without opening main or expanding children", async () => {
  const { slot, plus, onNavigate } = await mount({ bots: [bot, { ...bot, id: "other", name: "Other bot", mainThreadId: null }] });
  expect(slot.getByRole("button", { name: "New conversation with Other bot" })).toBeTruthy();
  const row = plus().closest(".project-row")!;
  const disclosure = within(row as HTMLElement).getByRole("button", { name: "Expand children of Test bot" });
  expect(plus().nextElementSibling).toBe(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(plus());
  await slot.findByRole("dialog", { name: "New conversation" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(slot.inspection.sidebarActionCalls).toEqual([]); expect(slot.inspection.navigateCalls).toEqual([]); expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(slot.getByRole("button", { name: "Close" }));
  expect(slot.inspection.rpcCalls.every(call => ["bots_list", "bot_prepare"].includes(call.method))).toBe(true);
});

it("keeps mouse button gestures out of native row dragging without blocking touch scrolling", async () => {
  const { plus, slot } = await mount(); const button = plus();
  const mouse = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(mouse, "pointerType", { value: "mouse" });
  expect(fireEvent(button, mouse)).toBe(false);
  expect(document.activeElement).toBe(button);
  const touch = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(touch, "pointerType", { value: "touch" });
  expect(fireEvent(button, touch)).toBe(true);
  expect(fireEvent.dragStart(button)).toBe(false);
  expect(button.closest(".project-row")?.getAttribute("data-dragging")).toBe("false");
  expect(slot.inspection.rpcCalls.some(call => call.method === "bot_prepare")).toBe(false);
});

it.each(["plus", "menu"])("defaults the %s action to an owned project on the bot's configured machine", async (action) => {
  const { slot, plus } = await mount({ bots: [{ ...bot, linkedProjectIds: ["project", "owned"] }], owners: [{ botId: bot.id, projectId: "owned" }], rows: [thread("main", 100, { host: { id: "remote", name: "Main machine" } })] });
  if (action === "plus") fireEvent.click(plus());
  else { fireEvent.contextMenu(slot.getByText("Test bot")); fireEvent.click(await slot.findByRole("menuitem", { name: "New conversation…" })); }
  await slot.findByRole("dialog", { name: "New conversation in project" });
  expect(props().defaultProjectId).toBe("owned");
  expect(props().defaultEnvironment).toEqual({ type: "host", hostId: "host", workspace: { type: "unmanaged", path: null } });
  expect(props().draftKey).toBe("bots:bot:project:owned:new");
  expect(slot.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_create")).toBe(false);
});

it("keeps member-only bots personal rather than borrowing the project owner's default", async () => {
  const { slot, plus } = await mount({ owners: [{ botId: "other", projectId: "project" }] });
  fireEvent.click(plus()); await slot.findByRole("dialog", { name: "New conversation" });
  expect(props().defaultProjectId).toBe(personalProjectId);
  expect(props().defaultEnvironment).toEqual({ type: "host", hostId: "host", workspace: { type: "personal" } });
});

it("can seed an owned project without a main conversation", async () => {
  const { slot, plus } = await mount({ bots: [{ ...bot, mainThreadId: null, linkedProjectIds: ["owned"] }], owners: [{ botId: bot.id, projectId: "owned" }], rows: [] });
  fireEvent.click(plus()); await slot.findByRole("dialog", { name: "New conversation in project" });
  expect(props().defaultProjectId).toBe("owned");
});

it("refreshes ownership on click but never reseeds an open composer", async () => {
  const { slot, state, plus } = await mount();
  state.owners = [{ botId: bot.id, projectId: "owned" }];
  fireEvent.click(plus()); await slot.findByRole("dialog", { name: "New conversation in project" });
  const originalEnvironment = props().defaultEnvironment;
  state.owners = [];
  await slot.behavior.emitRealtime("project-bots-changed", {});
  expect(props().defaultProjectId).toBe("owned"); expect(props().defaultEnvironment).toBe(originalEnvironment);
  const chosen = { ...request, projectId: "project", environment: { type: "host" as const, hostId: "chosen-machine", workspace: { type: "personal" as const } } };
  await act(() => props().onSubmit(chosen));
  expect(slot.inspection.rpcCalls).toContainEqual({ method: "conversation_create", input: { botId: bot.id, request: chosen, makeMain: false } });
});

it("does not use a stale ownership claim after it is released", async () => {
  const { slot, state, plus } = await mount({ owners: [{ botId: bot.id, projectId: "owned" }] });
  state.owners = [];
  fireEvent.click(plus()); await slot.findByRole("dialog", { name: "New conversation" });
  expect(props().defaultProjectId).toBe(personalProjectId);
});

it("guards duplicate clicks while preparation is pending", async () => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const { slot, plus } = await mount({ prepare: () => pending });
  fireEvent.click(plus()); fireEvent.click(plus());
  expect(slot.inspection.rpcCalls.filter(call => call.method === "bot_prepare")).toHaveLength(1);
  await act(async () => { release(); await pending; });
  await slot.findByRole("dialog", { name: "New conversation" });
});

it("allows retry after preparation fails", async () => {
  let fail = true;
  const { slot, plus } = await mount({ prepare: async () => { if (fail) throw new Error("Private state unavailable"); } });
  fireEvent.click(plus()); await slot.findByText("Private state unavailable");
  expect(slot.queryByRole("dialog")).toBeNull();
  fail = false; fireEvent.click(plus()); await slot.findByRole("dialog", { name: "New conversation" });
});

it("refuses to open from stale metadata if the ownership refresh fails", async () => {
  let fail = false;
  const { slot, plus } = await mount({ owners: [{ botId: bot.id, projectId: "owned" }], beforeList: () => { if (fail) throw new Error("Disconnected"); } });
  fail = true; fireEvent.click(plus()); await slot.findByText("Could not read current project roles. Try again.");
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(slot.inspection.rpcCalls.some(call => call.method === "conversation_create")).toBe(false);
});
