import { useEffect, useRef, type KeyboardEvent } from "react";

export function readSidebarWidth() {
  try {
    const width = Number(localStorage.getItem("moxie.sidebar-width.v1"));
    return width >= 180 && width <= 480 ? width : 260;
  } catch {
    return 260;
  }
}

export function SidebarResizeHandle({
  width,
  change,
}: {
  width: number;
  change: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const commit = (next: number) => change(Math.min(480, Math.max(180, next)));
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current)
        commit(drag.current.width + event.clientX - drag.current.x);
    };
    const finish = () => {
      drag.current = null;
      document.body.classList.remove("resizing-sidebar");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      finish();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [change]);
  const navigate = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const next =
      event.key === "ArrowLeft"
        ? width - 10
        : event.key === "ArrowRight"
          ? width + 10
          : event.key === "Home"
            ? 180
            : event.key === "End"
              ? 480
              : null;
    if (next !== null) {
      event.preventDefault();
      commit(next);
    }
  };
  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={navigate}
      onDoubleClick={() => commit(260)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add("resizing-sidebar");
      }}
    />
  );
}
