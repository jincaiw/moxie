import { useEffect, type RefObject } from "react";

/** Reveal within this list only, after browser layout and scroll anchoring settle. */
export function useRevealSelection(
  ref: RefObject<HTMLElement | null>,
  key: string,
  axis: "vertical" | "horizontal",
  enabled: boolean,
) {
  useEffect(() => {
    const list = ref.current;
    if (!enabled || !list) return;
    const selected = list.querySelector<HTMLElement>(".selected");
    if (!selected) return;
    let frame = 0;
    const reveal = () => {
      const bounds = list.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (axis === "vertical") {
        if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
        else if (item.bottom > bounds.bottom)
          list.scrollTop += item.bottom - bounds.bottom;
      } else {
        if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
        else if (item.right > bounds.right)
          list.scrollLeft += item.right - bounds.right;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        reveal();
        frame = requestAnimationFrame(reveal);
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(list);
    observer.observe(selected);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [ref, key, axis, enabled]);
}
