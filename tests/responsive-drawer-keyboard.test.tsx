// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bot, personalProjectId } from "./fixtures";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_NewThreadComposer: () =>
    createElement(
      "form",
      { "aria-label": "New thread composer" },
      createElement("input", { "aria-label": "Title" }),
      createElement("input", { "aria-label": "Description" }),
      createElement("textarea", { "aria-label": "Prompt", autoFocus: true }),
      createElement("button", { type: "submit" }, "Send"),
    ),
}));

const { ConversationDialog } = await import("../components/conversation-dialog");

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

describe("compact drawer keyboard avoidance", () => {
  let visualViewport: FakeVisualViewport;

  beforeEach(() => {
    visualViewport = new FakeVisualViewport();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderConversation(isCompactViewport: boolean) {
    return render(
      <CompactViewportOverrideProvider
        isCompactViewport={isCompactViewport}
      >
        <ConversationDialog
          target={{
            bot,
            kind: "bot",
            projectId: personalProjectId,
            environment: {
              type: "host",
              hostId: "host",
              workspace: { type: "personal" },
            },
            makeMain: false,
          }}
          onClose={() => {}}
          onCreate={async () => {}}
        />
      </CompactViewportOverrideProvider>,
    );
  }

  it("lifts the compact New conversation drawer above the keyboard and resets when it hides", async () => {
    const view = renderConversation(true);
    await view.findByRole("dialog", { name: "New conversation" });
    expect(view.getByRole("textbox", { name: "Prompt" })).toBe(
      document.activeElement,
    );

    const panel = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-content]",
    );
    expect(panel).not.toBeNull();

    visualViewport.height = 500;
    visualViewport.dispatchEvent(new Event("resize"));
    await waitFor(() => {
      expect(panel?.style.bottom).toBe("300px");
      expect(panel?.style.height).toBe("500px");
    });

    visualViewport.offsetTop = 40;
    visualViewport.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(panel?.style.bottom).toBe("260px"));

    visualViewport.height = 800;
    visualViewport.offsetTop = 0;
    visualViewport.dispatchEvent(new Event("resize"));
    await waitFor(() => {
      expect(panel?.style.bottom).toBe("");
      expect(panel?.style.height).toBe("");
    });
  });

  it("keeps the desktop New conversation dialog on its centered Radix path", async () => {
    const view = renderConversation(false);
    const dialog = await view.findByRole("dialog", {
      name: "New conversation",
    });

    expect(document.querySelector("[data-persistent-drawer-content]")).toBeNull();
    expect(dialog.className).toContain("sm:max-w-3xl");
    expect(dialog.style.bottom).toBe("");
    expect(dialog.style.height).toBe("");
  });
});
