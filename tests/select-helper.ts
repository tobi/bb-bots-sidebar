import { fireEvent, within } from "@testing-library/react";

export function selectOption(trigger: HTMLElement, name: string) {
  // jsdom has no layout/scroll implementation; Radix focuses real options.
  HTMLElement.prototype.scrollIntoView ??= () => {};
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(within(document.body).getByRole("option", { name }));
}
