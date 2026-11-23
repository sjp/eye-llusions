import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { ToolbarMenu } from "./ToolbarMenu.tsx";

function setup() {
  const open = vi.fn<() => void>();
  const save = vi.fn<() => void>();
  render(
    <ToolbarMenu
      label="More"
      items={[
        { label: "Open", onSelect: open },
        { label: "Save", dialog: true, onSelect: save },
      ]}
    />,
  );
  const button = screen.getByRole("button", { name: "More" });
  return { open, save, button };
}

function item(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

describe("ToolbarMenu", () => {
  test("opens a menu and focuses its first item", () => {
    const { button } = setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "More" }).id).toBe(
      button.getAttribute("aria-controls"),
    );
    expect(document.activeElement).toBe(item("Open"));
    expect(item("Save").getAttribute("aria-haspopup")).toBe("dialog");
  });

  test("choosing an item runs it and closes the menu", () => {
    const { open, button } = setup();
    fireEvent.click(button);
    fireEvent.click(item("Open"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("arrow keys move between items and Escape closes", () => {
    const { button } = setup();
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Save"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Open"));
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Save"));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(item("Open"));
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(item("Save"));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("pressing outside closes the menu", () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
