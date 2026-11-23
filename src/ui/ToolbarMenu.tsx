import type { RefObject } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

type MenuItem = {
  label: string;
  /** The item opens a dialog. */
  dialog?: boolean;
  onSelect: () => void;
};

type Props = {
  label: string;
  items: MenuItem[];
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

/** A toolbar button that opens a menu of further actions. */
export function ToolbarMenu({ label, items, buttonRef }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = buttonRef ?? ownTrigger;
  const menuId = useId();

  const entries = (): HTMLButtonElement[] =>
    Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) {
      trigger.current?.focus();
    }
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    entries()[0]?.focus();
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent): void => {
    const all = entries();
    const focused = document.activeElement;
    const at = focused instanceof HTMLButtonElement ? all.indexOf(focused) : -1;
    let next: number | undefined;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        setOpen(false);
        return;
      case "ArrowDown":
        next = (at + 1) % all.length;
        break;
      case "ArrowUp":
        next = (at - 1 + all.length) % all.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = all.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    all[next]?.focus();
  };

  return (
    <div class="toolbar-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        class="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          class="toolbar-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              class="toolbar-menu-item"
              tabIndex={-1}
              aria-haspopup={item.dialog === true ? "dialog" : undefined}
              onClick={() => {
                close(item.dialog !== true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
