// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AvatarAppearance } from "../components/avatar-appearance";
import { BotIcon, Eyes } from "../components/bot-icon";
import {
  AVATAR_COLORS,
  AVATAR_EXPRESSIONS,
  AVATAR_MOTIONS,
  AVATAR_SHAPES,
  shapePath,
  type BotAvatar,
} from "../lib/appearance";
import { bot, personalProjectId, thread } from "./fixtures";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);

const base: BotAvatar = { color: "#168b75", shape: "round", expression: "curious", motion: "still" };

function mountPanel(avatar = base, onChange = vi.fn()) {
  return { ...render(<TooltipProvider><AvatarAppearance avatar={avatar} onChange={onChange} /></TooltipProvider>), onChange };
}

async function mountSidebar() {
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: "main", activeProjectId: "project", isCompactViewport: false,
    onNavigate: vi.fn(), searchQuery: "", Original: () => null,
  }, {
    sidebarThreads: {
      projects: [{ id: "project", name: "Test bot", isPersonal: false }],
      threads: [thread("main", 1000)],
    },
    rpc: {
      bots_list: () => ({
        personalProjectId, bots: [bot], hosts: [{ id: "host", name: "Local", connected: true }],
        sections: [], projects: [{ id: "project", name: "Project" }],
        threadBindings: [{ threadId: "main", botId: bot.id }], warnings: [],
      }),
      bot_create: (input: unknown) => {
        const value = input as { name: string; avatar: BotAvatar };
        return { ...bot, id: "created", name: value.name, avatar: value.avatar, mainThreadId: null };
      },
      bot_update: () => bot,
      bot_prepare: () => bot,
    },
  });
  await slot.findByText("Test bot");
  return slot;
}

it("renders every shape and expression as SVG", () => {
  for (const shape of AVATAR_SHAPES) {
    const { container, unmount } = render(<BotIcon avatar={{ ...base, shape: shape.id }} size={40} label={shape.label} />);
    const svg = container.querySelector("svg.bot-avatar")!;
    expect(svg.getAttribute("data-shape")).toBe(shape.id);
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(shapePath(shape.id));
    expect(svg.querySelector(".bot-eyes")).toBeTruthy();
    unmount();
  }
  for (const expression of AVATAR_EXPRESSIONS) {
    const { container, unmount } = render(<BotIcon avatar={{ ...base, expression: expression.id }} size={40} label={expression.label} selected />);
    const svg = container.querySelector("svg.bot-avatar")!;
    expect(svg.getAttribute("data-expression")).toBe(expression.id);
    expect(svg.querySelector(".bot-eyes")).toBeTruthy();
    unmount();
  }
});

it("keeps the original four expression drawings", () => {
  const { container: happy } = render(<svg><Eyes expression="happy" /></svg>);
  expect(happy.querySelectorAll("path")).toHaveLength(2);
  expect(happy.querySelector("path")?.getAttribute("d")).toBe("M25 46Q35 35 45 46");
  const { container: focused } = render(<svg><Eyes expression="focused" /></svg>);
  expect(focused.querySelector("path")?.getAttribute("d")).toBe("M24 35L45 39L44 48L25 46Z");
  const { container: sleepy } = render(<svg><Eyes expression="sleepy" /></svg>);
  expect(sleepy.querySelector("path")?.getAttribute("d")).toBe("M27 45H44");
  const { container: curious } = render(<svg><Eyes expression="curious" /></svg>);
  expect(curious.querySelectorAll("rect")).toHaveLength(2);
});

it("offers compact category choosers instead of a 16-row expression list", () => {
  const { getByRole, queryByRole, getByLabelText } = mountPanel({ ...base, motion: "playful" });
  expect(getByRole("group", { name: "Appearance category" })).toBeTruthy();
  expect(getByRole("button", { name: "Randomize appearance" })).toBeTruthy();
  const expressions = getByRole("group", { name: "Expression" });
  expect(expressions.querySelectorAll("button")).toHaveLength(16);
  for (const svg of Array.from(expressions.querySelectorAll("svg"))) expect(svg.getAttribute("data-motion")).toBe("still");
  expect(queryByRole("group", { name: "Shape" })).toBeNull();
  fireEvent.click(getByRole("button", { name: "Shape" }));
  const shapes = getByRole("group", { name: "Shape" });
  expect(shapes.querySelectorAll("button")).toHaveLength(8);
  for (const svg of Array.from(shapes.querySelectorAll("svg"))) expect(svg.getAttribute("data-motion")).toBe("still");
  fireEvent.click(getByRole("button", { name: "Color" }));
  for (const color of AVATAR_COLORS) expect(getByRole("button", { name: color })).toBeTruthy();
  expect(getByLabelText("Custom color")).toBeTruthy();
  fireEvent.click(getByRole("button", { name: "Motion" }));
  for (const motion of AVATAR_MOTIONS) expect(getByRole("button", { name: motion.label })).toBeTruthy();
});

it("randomizes a full appearance without touching category chrome", () => {
  const { getByRole, onChange } = mountPanel();
  fireEvent.click(getByRole("button", { name: "Randomize appearance" }));
  expect(onChange).toHaveBeenCalledTimes(1);
  const next = onChange.mock.calls[0]![0] as BotAvatar;
  expect(AVATAR_COLORS).toContain(next.color);
  expect(AVATAR_SHAPES.map((shape) => shape.id)).toContain(next.shape);
  expect(AVATAR_EXPRESSIONS.map((expression) => expression.id)).toContain(next.expression);
  expect(AVATAR_MOTIONS.map((motion) => motion.id)).toContain(next.motion);
});

it("does not reroll an existing bot when opening edit or switching tabs", async () => {
  const slot = await mountSidebar();
  fireEvent.contextMenu(slot.getByText("Test bot"));
  fireEvent.click(await slot.findByRole("menuitem", { name: "Edit bot…" }));
  const dialog = await slot.findByRole("dialog", { name: "Edit bot" });
  const preview = () => within(dialog).getByRole("img", { name: "Bot preview" });
  expect(preview().getAttribute("data-color")).toBe(bot.avatar.color);
  expect(preview().getAttribute("data-shape")).toBe(bot.avatar.shape);
  expect(preview().getAttribute("data-expression")).toBe(bot.avatar.expression);
  expect(preview().getAttribute("data-motion")).toBe(bot.avatar.motion);
  fireEvent.click(within(dialog).getByRole("tab", { name: "Appearance" }));
  expect(preview().getAttribute("data-expression")).toBe("curious");
  fireEvent.click(within(dialog).getByRole("button", { name: "Happy" }));
  expect(preview().getAttribute("data-expression")).toBe("happy");
  fireEvent.click(within(dialog).getByRole("tab", { name: "Setup" }));
  fireEvent.click(within(dialog).getByRole("tab", { name: "Appearance" }));
  expect(preview().getAttribute("data-expression")).toBe("happy");
  expect(preview().getAttribute("data-shape")).toBe(bot.avatar.shape);
});

it("rolls a draft once and keeps it while switching editor tabs", async () => {
  const slot = await mountSidebar();
  fireEvent.keyDown(slot.getByRole("button", { name: "Create…" }), { key: "ArrowDown" });
  fireEvent.click(await slot.findByRole("menuitem", { name: "Bot" }));
  const dialog = await slot.findByRole("dialog", { name: "Create bot" });
  const preview = () => within(dialog).getByRole("img", { name: "Bot preview" });
  const first = {
    shape: preview().getAttribute("data-shape"),
    expression: preview().getAttribute("data-expression"),
    motion: preview().getAttribute("data-motion"),
    fill: preview().getAttribute("data-color"),
  };
  expect(AVATAR_SHAPES.map((shape) => shape.id)).toContain(first.shape);
  expect(AVATAR_EXPRESSIONS.map((expression) => expression.id)).toContain(first.expression);
  expect(AVATAR_MOTIONS.map((motion) => motion.id)).toContain(first.motion);
  expect(AVATAR_COLORS).toContain(first.fill);
  expect(preview().querySelector("path[mask]")?.getAttribute("fill")).toBe(first.fill);
  fireEvent.click(within(dialog).getByRole("tab", { name: "Appearance" }));
  fireEvent.click(within(dialog).getByRole("tab", { name: "Setup" }));
  fireEvent.click(within(dialog).getByRole("tab", { name: "Instructions" }));
  expect(preview().getAttribute("data-shape")).toBe(first.shape);
  expect(preview().getAttribute("data-expression")).toBe(first.expression);
  expect(preview().getAttribute("data-motion")).toBe(first.motion);
  expect(preview().getAttribute("data-color")).toBe(first.fill);
});
