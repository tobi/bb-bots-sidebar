// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RenameConversationDialog } from "../components/rename-conversation-dialog";

afterEach(cleanup);

it("rejects empty names and cancels without saving", () => {
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();
  const view = render(<RenameConversationDialog title="Old name" onSave={onSave} onClose={onClose} />);
  fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
  expect((view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps the name after an error and supports retry", async () => {
  const onSave = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("Could not rename")).mockResolvedValueOnce();
  const onClose = vi.fn();
  const view = render(<RenameConversationDialog title="Old name" onSave={onSave} onClose={onClose} />);
  fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "New name" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  expect((await view.findByRole("alert")).textContent).toBe("Could not rename");
  expect((view.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("New name");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledTimes(2);
});

it("prevents duplicate saves and dismissal while saving", async () => {
  let resolve!: () => void;
  const onSave = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const onClose = vi.fn();
  const view = render(<RenameConversationDialog title="Old name" onSave={onSave} onClose={onClose} />);
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  fireEvent.click(view.getByRole("button", { name: "Saving…" }));
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledOnce();
  await act(async () => resolve());
  expect(onClose).toHaveBeenCalledOnce();
});
