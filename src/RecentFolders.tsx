import { useLayoutEffect, useRef, useState } from "react";
import { Folder, Pin, Trash2 } from "lucide-react";
import type { RecentFolder } from "./bridge";

export function RecentFolders({
  folders,
  active,
  busy,
  open,
  changed,
}: {
  folders: RecentFolder[];
  active: string | null;
  busy: boolean;
  open: (path: string) => void;
  changed: (folders: RecentFolder[]) => void;
}) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const region = useRef<HTMLDetailsElement>(null);
  const focusRequest = useRef<{
    origin: HTMLElement | null;
    nextPaths: string[];
  } | null>(null);
  useLayoutEffect(() => {
    if (pending || !focusRequest.current) return;
    const request = focusRequest.current;
    focusRequest.current = null;
    // Preserve a user's move to another control while the request is pending.
    if (
      document.activeElement !== document.body &&
      document.activeElement !== request.origin
    )
      return;
    if (request.origin?.isConnected && !request.origin.matches(":disabled")) {
      request.origin.focus({ preventScroll: true });
      return;
    }
    const rows = Array.from(
      region.current?.querySelectorAll<HTMLElement>(".recent-folder-row") || [],
    );
    const next = request.nextPaths
      .map((path) => rows.find((row) => row.dataset.path === path))
      .find(Boolean);
    (
      next?.querySelector<HTMLButtonElement>(".recent-folder-open") ||
      region.current?.querySelector<HTMLElement>(":scope > summary")
    )?.focus({ preventScroll: true });
  }, [folders, pending]);
  const update = async (
    action: "pin" | "unpin" | "remove" | "clear",
    path?: string,
  ) => {
    if (busy || inFlight.current || !window.desktop?.updateFolderHistory)
      return;
    const index = folders.findIndex((folder) => folder.path === path);
    focusRequest.current = {
      origin:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      nextPaths: [
        ...folders.slice(index + 1),
        ...folders.slice(0, Math.max(0, index)).reverse(),
      ].map((folder) => folder.path),
    };
    inFlight.current = true;
    setPending(true);
    setError("");
    setStatus("正在更新最近文件夹…");
    try {
      const result = await window.desktop.updateFolderHistory({ action, path });
      changed(result);
      setStatus(
        action === "remove"
          ? "已移除最近记录，文件未删除。"
          : action === "clear"
            ? "已清除最近记录，固定项已保留。"
            : action === "pin"
              ? "文件夹已固定。"
              : "已取消固定文件夹。",
      );
    } catch (error) {
      setStatus("");
      setError(
        "最近文件夹无法更新，请重试：" +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  if (!folders.length && !error && !status) return null;
  return (
    <details
      ref={region}
      className="recent-folders"
      aria-label="最近文件夹"
      role="region"
      aria-busy={pending}
    >
      <summary>最近文件夹</summary>
      <div className="recent-folders-heading">
        <button
          disabled={busy || pending || !folders.length}
          onClick={() => void update("clear")}
        >
          清除最近
        </button>
      </div>
      {folders.map((folder) => (
        <div
          className="recent-folder-row"
          key={folder.path}
          data-path={folder.path}
        >
          <button
            className="recent-folder-open"
            disabled={busy || pending}
            aria-current={active === folder.path ? "location" : undefined}
            title={folder.path}
            onClick={() => open(folder.path)}
          >
            <Folder size={15} />
            <span>{folder.name}</span>
            <small>{folder.path}</small>
          </button>
          <button
            disabled={busy || pending}
            aria-label={`${folder.pinned ? "取消固定" : "固定"}文件夹 ${folder.name}`}
            aria-pressed={folder.pinned}
            onClick={() =>
              void update(folder.pinned ? "unpin" : "pin", folder.path)
            }
          >
            <Pin size={13} fill={folder.pinned ? "currentColor" : "none"} />
          </button>
          <button
            disabled={busy || pending}
            aria-label={`移除最近文件夹 ${folder.name}`}
            onClick={() => void update("remove", folder.path)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <small>清除最近保留固定项；移除记录不会删除文件。</small>
      {!folders.length && (
        <p className="recent-folders-empty">暂无最近文件夹。</p>
      )}
      <p className="recent-folders-status" role="status">
        {status}
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
