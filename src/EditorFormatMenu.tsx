import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Format } from "./Editor";
export function EditorFormatMenu({
  point,
  formats,
  shortcutLabel,
  onClose,
  onFormat,
}: {
  point: { left: number; top: number };
  formats: { kind: Format; label: string; shortcut?: string }[];
  shortcutLabel: (value: string) => string;
  onClose: (restoreFocus: boolean) => void;
  onFormat: (kind: Format) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const reposition = () => {
      const rect = element.getBoundingClientRect();
      const next = {
        left: Math.max(
          8,
          Math.min(
            Number.isFinite(point.left) ? point.left : 8,
            window.innerWidth - rect.width - 8,
          ),
        ),
        top: Math.max(
          8,
          Math.min(
            Number.isFinite(point.top) ? point.top : 8,
            window.innerHeight - rect.height - 8,
          ),
        ),
      };
      setPosition((current) =>
        current.left === next.left && current.top === next.top ? current : next,
      );
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(element);
    element
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [point]);
  useEffect(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close.current(false);
    };
    const dismiss = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !menu.current?.contains(event.target)
      )
        close.current(false);
    };
    const resize = () => {
      // A queued resize may arrive after a menu was opened in the new viewport.
      if (
        window.innerWidth !== viewport.width ||
        window.innerHeight !== viewport.height
      )
        close.current(false);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);
  return createPortal(
    <div
      className="editor-context-menu"
      role="menu"
      aria-label="编辑区格式菜单"
      ref={menu}
      style={position}
      onKeyDown={(event) => {
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>("button") || [],
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus({ preventScroll: true });
          buttons[next]?.scrollIntoView({ block: "nearest" });
        }
      }}
    >
      {formats.map((format) => (
        <button
          key={format.kind}
          role="menuitem"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFormat(format.kind)}
        >
          <span>{format.label}</span>
          {format.shortcut && <kbd>{shortcutLabel(format.shortcut)}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
