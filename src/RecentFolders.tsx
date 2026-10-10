import { useState } from "react";
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
  changed: () => void;
}) {
  const [error, setError] = useState("");
  const update = async (
    action: "pin" | "unpin" | "remove" | "clear",
    path?: string,
  ) => {
    try {
      await window.desktop?.updateFolderHistory?.({ action, path });
      setError("");
      changed();
    } catch {
      setError("最近文件夹无法更新，请重试。");
    }
  };
  if (!folders.length && !error) return null;
  return (
    <details className="recent-folders" aria-label="最近文件夹" role="region">
      <summary>最近文件夹</summary>
      <div className="recent-folders-heading">
        <button onClick={() => void update("clear")}>清除最近</button>
      </div>
      {folders.map((folder) => (
        <div className="recent-folder-row" key={folder.path}>
          <button
            className="recent-folder-open"
            disabled={busy}
            aria-current={active === folder.path ? "location" : undefined}
            title={folder.path}
            onClick={() => open(folder.path)}
          >
            <span>{folder.name}</span>
            <small>{folder.path}</small>
          </button>
          <button
            aria-label={`${folder.pinned ? "取消固定" : "固定"}文件夹 ${folder.name}`}
            aria-pressed={folder.pinned}
            onClick={() =>
              void update(folder.pinned ? "unpin" : "pin", folder.path)
            }
          >
            {folder.pinned ? "取消固定" : "固定"}
          </button>
          <button
            aria-label={`移除最近文件夹 ${folder.name}`}
            onClick={() => void update("remove", folder.path)}
          >
            移除
          </button>
        </div>
      ))}
      <small>清除最近保留固定项；移除记录不会删除文件。</small>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
