import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { LeaveDialog } from "./LeaveDialog.tsx";

function setup(imagesOnly = false) {
  const onLeave = vi.fn<() => void>();
  const onStay = vi.fn<() => void>();
  render(<LeaveDialog imagesOnly={imagesOnly} onLeave={onLeave} onStay={onStay} />);
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", { name: "Leave this scene?" });
  return { dialog, onLeave, onStay };
}

describe("LeaveDialog", () => {
  test("opens as a modal dialog, focused on staying", () => {
    const { dialog } = setup();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("share a link or save a PNG");
    expect(screen.getByRole("button", { name: "Keep editing" }).hasAttribute("autofocus")).toBe(
      true,
    );
  });

  test("explains that a shared scene's link leaves out its images", () => {
    const { dialog } = setup(true);
    expect(dialog.textContent).toContain("Its link leaves out the images");
  });

  test("leaves or stays from its buttons", () => {
    const { onLeave, onStay } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onStay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Go to gallery" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  test("Escape stays, keeping the dialog for the app to close", () => {
    const { dialog, onLeave, onStay } = setup();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onStay).toHaveBeenCalledOnce();
    expect(onLeave).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  test("closing it some other way stays", () => {
    const { dialog, onStay } = setup();
    dialog.close();
    fireEvent(dialog, new Event("close"));
    expect(onStay).toHaveBeenCalled();
  });
});
