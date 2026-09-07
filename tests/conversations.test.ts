import { describe, expect, it } from "vitest";
import { conversationOwners, conversationTree } from "../lib/conversations";
import { thread } from "./fixtures";

const rows = () => Array.from({ length: 10 }, (_, i) => thread(String(i), 100 - i));
const ids = (threads: ReturnType<typeof rows>) => threads.map((thread) => thread.id);

describe("explicit conversation ownership", () => {
  it("inherits the nearest binding across projects and honors an explicit child override", () => {
    const owners = conversationOwners([
      thread("root", 1), thread("child", 2, { parentThreadId: "root", projectId: "other-project" }),
      thread("override", 3, { parentThreadId: "child" }), thread("grandchild", 4, { parentThreadId: "override" }),
      thread("unassigned", 5),
    ], [{ threadId: "root", botId: "one" }, { threadId: "override", botId: "two" }]);
    expect([...owners]).toEqual([["root", "one"], ["child", "one"], ["override", "two"], ["grandchild", "two"]]);
  });
  it("uses a known ancestor binding even when that ancestor is not loaded", () => {
    expect(conversationOwners([thread("child", 1, { parentThreadId: "missing" })], [{ threadId: "missing", botId: "one" }]).get("child")).toBe("one");
  });
  it("does not infer ownership from a project or loop on malformed parent cycles", () => {
    const owners = conversationOwners([
      thread("one", 1, { parentThreadId: "two" }), thread("two", 1, { parentThreadId: "one" }), thread("unassigned", 1),
    ], []);
    expect(owners.size).toBe(0);
  });
});

describe("conversation folding", () => {
  it("counts only direct main children and keeps their descendants in the main branch", () => {
    const result = conversationTree([
      thread("main", 500), thread("main-child", 10, { parentThreadId: "main" }),
      thread("main-grandchild", 400, { parentThreadId: "main-child" }), thread("other-child", 20, { parentThreadId: "main" }),
      thread("topic", 200), thread("topic-child", 300, { parentThreadId: "topic" }),
    ], "main", "main-grandchild");
    expect(ids(result.roots)).toEqual(["topic"]);
    expect(ids(result.mainChildren)).toEqual(["main-child", "other-child"]);
    expect([...result.activePath]).toEqual(["main-grandchild", "main-child", "main"]);
    expect(ids(result.childrenByParent.get("topic")!)).toEqual(["topic-child"]);
  });
  it("handles a missing main row and a promoted child main without duplicating topics", () => {
    const result = conversationTree([
      thread("old-parent", 200), thread("promoted", 100, { parentThreadId: "old-parent" }),
      thread("child", 300, { parentThreadId: "promoted" }),
    ], "promoted", "child");
    expect(ids(result.roots)).toEqual(["old-parent"]);
    expect(ids(result.mainChildren)).toEqual(["child"]);
    const missing = conversationTree([thread("child", 1, { parentThreadId: "missing-main" })], "missing-main", "child");
    expect(missing.roots).toEqual([]);
    expect(ids(missing.mainChildren)).toEqual(["child"]);
    expect(missing.activePath.has("missing-main")).toBe(true);
  });
  it("keeps four recent trees and groups six older trees", () => {
    const data = rows();
    const result = conversationTree([thread("main", 500), ...data], "main", "main");
    expect(ids(result.recent)).toEqual(["0", "1", "2", "3"]);
    expect(ids(result.other)).toEqual(["4", "5", "6", "7", "8", "9"]);
    expect(ids(data)).toEqual(ids(rows()));
  });
  it.each([0, 1, 4])("does not fold a list of %i", (count) => {
    const result = conversationTree(rows().slice(0, count), null, null);
    expect(result.recent).toHaveLength(count);
    expect(result.other).toEqual([]);
  });
  it.each([
    { isUnread: true }, { isPinned: true }, { hasPendingInteraction: true },
    { indicator: "runtime" as const }, { indicator: "waiting-for-input" as const },
    { activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 } },
  ])("never hides a conversation needing attention: %j", (overrides) => {
    const result = conversationTree([...rows(), thread("important", 1, overrides)], null, null);
    expect(ids(result.recent)).toContain("important");
    expect(ids(result.other)).not.toContain("important");
  });
  it("keeps the active conversation and active descendants visible", () => {
    const result = conversationTree([...rows(), thread("child", 1, { parentThreadId: "9" })], null, "child");
    expect(ids(result.recent)).toContain("9");
    expect(ids(result.childrenByParent.get("9")!)).toEqual(["child"]);
  });
  it("sorts by activity of descendants and promotes revived trees", () => {
    const data = [...rows(), thread("child", 1000, { parentThreadId: "9" })];
    const result = conversationTree(data, null, null);
    expect(ids(result.recent)).toEqual(["9", "0", "1", "2"]);
    expect(result.other).toHaveLength(6);
    data[8] = { ...data[8]!, latestAttentionAt: 2000 };
    expect(conversationTree(data, null, null).recent[0]?.id).toBe("8");
  });
  it("separates main children from roots while keeping archived-parent orphans visible", () => {
    const result = conversationTree([
      thread("main", 100), thread("archived", 90, { isArchived: true }),
      thread("main-child", 80, { parentThreadId: "main" }), thread("orphan", 70, { parentThreadId: "archived" }),
    ], "main", "main");
    expect(ids(result.roots)).toEqual(["orphan"]);
    expect(ids(result.mainChildren)).toEqual(["main-child"]);
    expect(ids(result.childrenByParent.get("main")!)).toEqual(["main-child"]);
  });
});
