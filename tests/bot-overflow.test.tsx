import { expect, it } from "vitest";
import { orderedBotConversationTree } from "../lib/conversations";
import { thread } from "./fixtures";

it("keeps every root accessible in creation order regardless of activity or selection", () => {
  const rows = Array.from({ length: 20 }, (_, index) => thread(String(index), 100 - index));
  const initial = orderedBotConversationTree(rows).roots.map(row => row.id);
  rows[19] = { ...rows[19]!, updatedAt: 2000, indicator: "runtime", isPinned: true };
  expect(orderedBotConversationTree(rows, [], "19").roots.map(row => row.id)).toEqual(initial); expect(initial).toHaveLength(20);
});

it("preserves manual sibling order, includes the legacy main, and skips archived roots", () => {
  const rows = [thread("main", 100), thread("first", 1), thread("archived", 200, { isArchived: true }),
    thread("child1", 10, { parentThreadId: "main" }), thread("child2", 20, { parentThreadId: "main" })];
  const tree = orderedBotConversationTree(rows, ["archived", "first", "child1", "main", "child2"]);
  expect(tree.roots.map(row => row.id)).toEqual(["first", "main"]);
  expect(tree.childrenByParent.get("main")?.map(row => row.id)).toEqual(["child1", "child2"]);
});

it("appends new unplaced conversations without disturbing manual order", () => {
  expect(orderedBotConversationTree([thread("old", 1), thread("new", 200), thread("other", 100)], ["old"]).roots.map(row => row.id)).toEqual(["old", "new", "other"]);
});
