import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Link,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "./Dialog";
import type { FolderNode, FolderTree, DroppedCopyProgress } from "./bridge";
import {
  ordered,
  validSort,
  listedFiles,
  defaultLayout,
  type SortMode,
  type FolderLayout,
} from "./folder-order";

type FileAction =
  | "new-file"
  | "new-folder"
  | "copy"
  | "rename"
  | "move"
  | "trash"
  | "undo"
  | "copy-path"
  | "new-window"
  | "insert-link"
  | "reveal";
type Operation = {
  action: FileAction;
  target?: FolderNode;
  directory?: string;
};
type OperationRequest = {
  action: FileAction;
  target?: string;
  directory?: string;
  name?: string;
};
type RunOperation = (request: OperationRequest) => Promise<void>;
function readLayout(): FolderLayout {
  try {
    const saved = JSON.parse(
      localStorage.getItem("moxie.folder-layout.v1") || "{}",
    );
    return {
      descending: saved.descending === true,
      foldersFirst: saved.foldersFirst !== false,
      view: saved.view === "list" ? "list" : "tree",
    };
  } catch {
    return defaultLayout;
  }
}

function Branch({
  node,
  busy,
  copying,
  depth,
  active,
  open,
  expandedPaths,
  toggle,
  operate,
  onDropFile,
  onDropExternal,
  pinned,
  sort,
  layout,
  listRoot,
  togglePin,
  treeRef,
  onTreeKeyDown,
}: {
  node: FolderNode;
  busy: boolean;
  copying: boolean;
  depth: number;
  active?: string;
  open: (path: string) => void;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  operate: RunOperation;
  onDropFile: (target: string, directory: string) => void;
  onDropExternal?: (files: File[], directory: string) => void;
  pinned: Set<string>;
  sort: SortMode;
  layout: FolderLayout;
  listRoot?: string;
  togglePin: (path: string) => void;
  treeRef: RefObject<HTMLUListElement | null>;
  onTreeKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    node: FolderNode,
  ) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (menuOpen)
      actionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menuOpen]);
  const expanded = expandedPaths.has(node.path);
  const directory = node.kind === "directory";
  return (
    <li
      onDragOver={(event) => {
        if (
          !busy &&
          directory &&
          (event.dataTransfer.types.includes("application/x-moxie-path") ||
            event.dataTransfer.types.includes("Files"))
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
            "Files",
          )
            ? "copy"
            : "move";
        }
      }}
      onDrop={(event) => {
        if (!directory) return;
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        if (event.dataTransfer.files.length) {
          onDropExternal?.(Array.from(event.dataTransfer.files), node.path);
          return;
        }
        const target = event.dataTransfer.getData("application/x-moxie-path");
        if (!target || target === node.path) return;
        onDropFile(target, node.path);
      }}
    >
      <div className="tree-entry-line">
        <button
          className={"tree-row " + (active === node.path ? "selected" : "")}
          disabled={copying && !directory}
          title={node.path}
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={directory ? expanded : undefined}
          aria-label={
            directory
              ? "文件夹 " + node.name
              : node.kind === "file"
                ? "打开 " + node.name
                : "显示 " + node.name
          }
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              setMenuOpen(true);
            } else onTreeKeyDown(event, node);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
          draggable={!busy && node.kind !== "other"}
          onDragStart={(event) => {
            if (event.altKey && window.desktop?.dragFileOut) {
              event.preventDefault();
              void window.desktop.dragFileOut(node.path).catch((error) =>
                window.dispatchEvent(
                  new CustomEvent("moxie:drag-error", {
                    detail:
                      error instanceof Error ? error.message : String(error),
                  }),
                ),
              );
              return;
            }
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.setData("application/x-moxie-path", node.path);
            event.dataTransfer.setData("text/plain", node.path);
          }}
          onClick={() =>
            directory
              ? toggle(node.path)
              : node.kind === "file"
                ? open(node.path)
                : void operate({ action: "reveal", target: node.path })
          }
        >
          {directory ? (
            expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : (
            <span className="tree-indent" />
          )}
          {directory ? (
            <Folder size={15} />
          ) : node.kind === "file" ? (
            <FileText size={15} />
          ) : (
            <File size={15} />
          )}
          <span>
            {node.name}
            {listRoot && (
              <small className="tree-path">
                {node.path
                  .slice(listRoot.length + 1)
                  .split(/[\\/]/)
                  .slice(0, -1)
                  .join("/") || "."}
              </small>
            )}
          </span>
        </button>
        <button
          className="tree-actions-trigger"
          aria-label={`文件操作：${node.name}`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreVertical size={15} />
        </button>
      </div>
      {menuOpen && (
        <fieldset
          className="tree-actions"
          disabled={busy}
          ref={actionsRef}
          role="group"
          aria-label={`${node.name} 的文件操作`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setMenuOpen(false);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(".tree-row")
                ?.focus();
            }
          }}
        >
          {node.kind !== "other" && (
            <button
              onClick={() => {
                setMenuOpen(false);
                void operate({ action: "insert-link", target: node.path });
              }}
            >
              <Link size={14} />
              插入相对链接到正文
            </button>
          )}
          {directory ? (
            <>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "new-file", target: node.path });
                }}
              >
                <FilePlus2 size={14} />
                新建文档
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "new-folder", target: node.path });
                }}
              >
                <FolderPlus size={14} />
                新建文件夹
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "copy", target: node.path });
                }}
              >
                <Copy size={14} />
                复制文件夹
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "rename", target: node.path });
                }}
              >
                重命名
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "move", target: node.path });
                }}
              >
                移动到…
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "reveal", target: node.path });
                }}
              >
                <ExternalLink size={14} />
                在文件管理器中显示
              </button>
              <button
                className="tree-action-danger"
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "trash", target: node.path });
                }}
              >
                <Trash2 size={14} />
                移入废纸篓
              </button>
            </>
          ) : node.kind === "other" ? (
            <>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "reveal", target: node.path });
                }}
              >
                <ExternalLink size={14} />
                在文件管理器中显示
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "new-window", target: node.path });
                }}
              >
                在新窗口打开
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "copy", target: node.path });
                }}
              >
                <Copy size={14} />
                复制
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  togglePin(node.path);
                }}
              >
                <Star
                  size={14}
                  fill={pinned.has(node.path) ? "currentColor" : "none"}
                />
                {pinned.has(node.path) ? "取消置顶" : "置顶"}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "rename", target: node.path });
                }}
              >
                重命名
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "move", target: node.path });
                }}
              >
                移动到…
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "reveal", target: node.path });
                }}
              >
                <ExternalLink size={14} />
                在文件管理器中显示
              </button>
              <button
                className="tree-action-danger"
                onClick={() => {
                  setMenuOpen(false);
                  void operate({ action: "trash", target: node.path });
                }}
              >
                <Trash2 size={14} />
                移入废纸篓
              </button>
            </>
          )}
        </fieldset>
      )}
      {directory && expanded && (
        <ul>
          {node.children?.length ? (
            ordered(node.children, pinned, sort, layout).map((child) => (
              <Branch
                key={child.path}
                node={child}
                busy={busy}
                copying={copying}
                depth={depth + 1}
                active={active}
                open={open}
                expandedPaths={expandedPaths}
                toggle={toggle}
                operate={operate}
                onDropExternal={onDropExternal}
                onDropFile={onDropFile}
                pinned={pinned}
                sort={sort}
                layout={layout}
                togglePin={togglePin}
                treeRef={treeRef}
                onTreeKeyDown={onTreeKeyDown}
              />
            ))
          ) : (
            <li className="tree-empty" style={{ paddingLeft: 34 + depth * 14 }}>
              没有符合筛选条件的文件
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function FolderBrowser({
  tree,
  active,
  open,
  refresh,
  close,
  busy,
  copying = false,
  copyProgress,
  copyCancelling = false,
  cancelCopy,
  expandedPaths,
  toggle,
  error,
  operate,
  showHiddenFiles,
  showOtherFiles,
  hasCustomFilter,
  dropExternal,
}: {
  dropExternal?: (files: File[], directory: string) => void;
  tree: FolderTree;
  active?: string;
  open: (path: string) => void;
  refresh: () => void;
  close: () => void;
  busy: boolean;
  copying?: boolean;
  copyProgress?: DroppedCopyProgress | null;
  copyCancelling?: boolean;
  cancelCopy?: () => void;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  error: string;
  operate: RunOperation;
  showHiddenFiles: boolean;
  showOtherFiles: boolean;
  hasCustomFilter?: boolean;
}) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [name, setName] = useState("");
  const treeRef = useRef<HTMLUListElement>(null);
  const [sort, setSort] = useState<SortMode>(() => {
    try {
      return validSort(localStorage.getItem("moxie.folder-sort.v1"));
    } catch {
      return "name";
    }
  });
  const [layout, setLayout] = useState(readLayout);
  const changeLayout = (changes: Partial<FolderLayout>) => {
    const next = { ...layout, ...changes };
    setLayout(next);
    try {
      localStorage.setItem("moxie.folder-layout.v1", JSON.stringify(next));
    } catch {}
  };
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const paths = JSON.parse(
        localStorage.getItem("moxie.folder-pinned.v1") || "[]",
      );
      return new Set(
        Array.isArray(paths)
          ? paths.filter((item) => typeof item === "string").slice(0, 200)
          : [],
      );
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    const syncPins = (event: Event) => {
      const paths = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(paths))
        setPinned(
          new Set(
            paths
              .filter((item): item is string => typeof item === "string")
              .slice(0, 200),
          ),
        );
    };
    const syncPinsAcrossWindows = (event: StorageEvent) => {
      if (event.key !== "moxie.folder-pinned.v1" && event.key !== null) return;
      try {
        const paths = JSON.parse(event.newValue || "[]");
        setPinned(
          new Set(
            Array.isArray(paths)
              ? paths
                  .filter((item): item is string => typeof item === "string")
                  .slice(0, 200)
              : [],
          ),
        );
      } catch {
        setPinned(new Set());
      }
    };
    const syncSortAcrossWindows = (event: StorageEvent) => {
      if (event.key !== "moxie.folder-sort.v1" && event.key !== null) return;
      setSort(validSort(event.newValue));
    };
    const syncLayout = (event: StorageEvent) => {
      if (event.key === "moxie.folder-layout.v1" || event.key === null)
        setLayout(readLayout());
    };
    window.addEventListener("moxie:folder-pins-changed", syncPins);
    window.addEventListener("storage", syncPinsAcrossWindows);
    window.addEventListener("storage", syncSortAcrossWindows);
    window.addEventListener("storage", syncLayout);
    return () => {
      window.removeEventListener("moxie:folder-pins-changed", syncPins);
      window.removeEventListener("storage", syncPinsAcrossWindows);
      window.removeEventListener("storage", syncSortAcrossWindows);
      window.removeEventListener("storage", syncLayout);
    };
  }, []);
  const togglePin = (path: string) =>
    setPinned((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else if (next.size < 200) next.add(path);
      try {
        localStorage.setItem(
          "moxie.folder-pinned.v1",
          JSON.stringify([...next]),
        );
      } catch {}
      return next;
    });
  const changeSort = (next: SortMode) => {
    setSort(next);
    try {
      localStorage.setItem("moxie.folder-sort.v1", next);
    } catch {}
  };
  const nameInput = useRef<HTMLInputElement>(null);
  const openOperation = (action: FileAction, target?: FolderNode) => {
    setName(
      action === "new-file"
        ? "未命名.md"
        : action === "new-folder"
          ? "新建文件夹"
          : action === "rename"
            ? target?.name || ""
            : target
              ? target.kind === "directory"
                ? `${target.name} 副本`
                : `${target.name.replace(/\.(md|markdown|txt)$/i, "")} 副本${target.name.match(/\.(md|markdown|txt)$/i)?.[0] || ".md"}`
              : "",
    );
    setOperation({ action, target });
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!operation || busy) return;
    void operate({
      action: operation.action,
      target: operation.target?.path || tree.path,
      directory: operation.directory,
      name,
    });
    setOperation(null);
  };
  const run: RunOperation = async ({ action, target, directory }) => {
    if (busy) return;
    if (["new-file", "new-folder", "copy", "rename"].includes(action)) {
      const node = target ? findNode(tree.entries, target) : undefined;
      openOperation(action, node);
    } else if (action === "trash") {
      setOperation({
        action,
        target: target ? findNode(tree.entries, target) : undefined,
      });
    } else await operate({ action, target, directory });
  };
  const dropFile = (target: string, directory: string) => {
    if (busy || target === directory) return;
    void operate({ action: "move", target, directory });
  };
  const onTreeKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: FolderNode,
  ) => {
    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>(
        ".tree-row:not(:disabled)",
      ) || [],
    );
    const index = rows.indexOf(event.currentTarget);
    const currentItem = event.currentTarget.closest("li");
    const focusRow = (row?: HTMLButtonElement | null) => {
      if (row) {
        event.preventDefault();
        row.focus();
      }
    };
    if (event.key === "ArrowDown") focusRow(rows[index + 1]);
    else if (event.key === "ArrowUp") focusRow(rows[index - 1]);
    else if (event.key === "Home") focusRow(rows[0]);
    else if (event.key === "End") focusRow(rows[rows.length - 1]);
    else if (event.key === "ArrowRight" && node.kind === "directory") {
      event.preventDefault();
      if (expandedPaths.has(node.path)) {
        currentItem
          ?.querySelector<HTMLButtonElement>(
            ":scope > ul > li > .tree-entry-line > .tree-row",
          )
          ?.focus();
      } else {
        toggle(node.path);
        requestAnimationFrame(() =>
          currentItem
            ?.querySelector<HTMLButtonElement>(
              ":scope > ul > li > .tree-entry-line > .tree-row",
            )
            ?.focus(),
        );
      }
    } else if (event.key === "ArrowLeft" && node.kind === "directory") {
      if (expandedPaths.has(node.path)) {
        event.preventDefault();
        toggle(node.path);
      } else {
        focusRow(
          currentItem?.parentElement
            ?.closest("li")
            ?.querySelector<HTMLButtonElement>(
              ":scope > .tree-entry-line > .tree-row",
            ),
        );
      }
    } else if (event.key === "ArrowLeft" && node.kind !== "directory") {
      focusRow(
        currentItem?.parentElement
          ?.closest("li")
          ?.querySelector<HTMLButtonElement>(
            ":scope > .tree-entry-line > .tree-row",
          ),
      );
    }
  };
  return (
    <section className="folder-browser" aria-label="文件夹浏览">
      <header
        title={tree.path}
        onDragOver={(event) => {
          if (
            !busy &&
            (event.dataTransfer.types.includes("application/x-moxie-path") ||
              event.dataTransfer.types.includes("Files"))
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
              "Files",
            )
              ? "copy"
              : "move";
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          if (event.dataTransfer.files.length) {
            dropExternal?.(Array.from(event.dataTransfer.files), tree.path);
            return;
          }
          const target = event.dataTransfer.getData("application/x-moxie-path");
          if (!target || target === tree.path) return;
          dropFile(target, tree.path);
        }}
      >
        <Folder size={14} />
        <strong>{tree.name}</strong>
        <button
          aria-label="新建文档"
          title="新建文档"
          disabled={busy}
          onClick={() => openOperation("new-file")}
        >
          <FilePlus2 size={14} />
        </button>
        <button
          aria-label="新建文件夹"
          title="新建文件夹"
          disabled={busy}
          onClick={() => openOperation("new-folder")}
        >
          <FolderPlus size={14} />
        </button>
        <button
          aria-label="撤销文件操作"
          title="撤销文件操作"
          disabled={busy}
          onClick={() => run({ action: "undo" })}
        >
          <RotateCcw size={14} />
        </button>
        <button
          aria-label="在文件管理器中显示文件夹"
          title="在文件管理器中显示文件夹"
          disabled={busy}
          onClick={() => void operate({ action: "reveal", target: tree.path })}
        >
          <ExternalLink size={14} />
        </button>
        <button
          aria-label="复制文件夹路径"
          title="复制文件夹路径"
          disabled={busy}
          onClick={() =>
            void operate({ action: "copy-path", target: tree.path })
          }
        >
          <Copy size={14} />
        </button>
        <button aria-label="刷新文件夹" disabled={busy} onClick={refresh}>
          <RefreshCw size={13} />
        </button>
        <button aria-label="关闭文件夹" disabled={copying} onClick={close}>
          <X size={13} />
        </button>
      </header>
      <label className="folder-sort-control">
        文件排序
        <select
          aria-label="文件排序"
          value={sort}
          onChange={(event) => changeSort(event.target.value as SortMode)}
        >
          <option value="name">按名称</option>
          <option value="alphabet">按字母</option>
          <option value="type">按类型</option>
          <option value="modified">按修改时间</option>
          <option value="created">按创建时间</option>
        </select>
      </label>
      <div className="folder-layout-controls">
        <label>
          显示方式
          <select
            aria-label="文件显示方式"
            value={layout.view}
            onChange={(event) =>
              changeLayout({ view: event.target.value as FolderLayout["view"] })
            }
          >
            <option value="tree">文件树</option>
            <option value="list">文件列表</option>
          </select>
        </label>
        <label>
          排序方向
          <select
            aria-label="排序方向"
            value={layout.descending ? "descending" : "ascending"}
            onChange={(event) =>
              changeLayout({ descending: event.target.value === "descending" })
            }
          >
            <option value="ascending">升序</option>
            <option value="descending">降序</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="按文件夹分组"
            checked={layout.foldersFirst}
            onChange={(event) =>
              changeLayout({ foldersFirst: event.target.checked })
            }
          />
          {layout.view === "tree" ? "文件夹优先" : "按文件夹分组"}
        </label>
      </div>
      <p className="folder-filter-summary">
        {showHiddenFiles ? "包含隐藏项" : "隐藏项已过滤"}
        {" · "}
        {showOtherFiles ? "显示其他文件" : "仅显示 Markdown/TXT"}
        {hasCustomFilter && " · 已应用自定义规则"}
        {" · 可在偏好设置中更改"}
      </p>
      {error && (
        <p className="tree-empty" role="status">
          {error}
        </p>
      )}
      <p className="folder-drag-help">
        拖入正文或使用文件操作菜单插入相对链接；系统文件拖到文件夹可复制。按住
        Alt/Option 可拖出到系统。
      </p>
      {copying && (
        <div className="folder-copy-progress">
          <p role="status">
            {copyCancelling
              ? "正在取消，请等待当前文件结束并清理…"
              : copyProgress?.phase === "checking"
                ? "正在检查拖入项目…"
                : copyProgress?.phase === "copying"
                  ? "正在复制…"
                  : copyProgress?.phase === "cleanup"
                    ? "正在清理本次创建的项目…"
                    : copyProgress?.phase === "finishing"
                      ? "复制已完成，正在更新目录…"
                      : "请在确认窗口选择复制或取消。"}
          </p>
          {copyProgress && (
            <>
              <progress
                aria-label="拖入项目处理进度"
                max={copyProgress.total || undefined}
                value={copyProgress.total ? copyProgress.completed : undefined}
              />
              <p>
                {copyProgress.total
                  ? `${copyProgress.completed} / ${copyProgress.total} 项`
                  : `已处理 ${copyProgress.completed} 项`}
                {copyProgress.name && (
                  <span className="folder-copy-name" title={copyProgress.name}>
                    {copyProgress.name}
                  </span>
                )}
              </p>
            </>
          )}
          {cancelCopy && copyProgress && (
            <button
              onClick={cancelCopy}
              disabled={
                copyCancelling ||
                copyProgress.phase === "cleanup" ||
                copyProgress.phase === "finishing"
              }
            >
              {copyCancelling ? "正在取消…" : "取消复制"}
            </button>
          )}
        </div>
      )}
      <p id="folder-tree-keyboard-help" className="sr-only">
        文件列表支持方向键导航：上下方向键切换项目，左右方向键展开或折叠文件夹，Home
        和 End 跳到列表首尾。Shift+F10 打开文件操作，Tab 切换操作，Enter
        执行；可选择插入相对链接到正文，Escape 关闭操作并返回文件行。
      </p>
      <ul
        ref={treeRef}
        aria-label="文件列表"
        aria-busy={copying}
        aria-describedby="folder-tree-keyboard-help"
      >
        {(layout.view === "list"
          ? (() => {
              const files = listedFiles(tree.entries);
              if (!layout.foldersFirst)
                return ordered(files, pinned, sort, layout);
              const groups = new Map<string, FolderNode[]>();
              for (const node of files) {
                const parent = node.path.slice(
                  0,
                  node.path.lastIndexOf(node.path.includes("\\") ? "\\" : "/"),
                );
                groups.set(parent, [...(groups.get(parent) || []), node]);
              }
              return [...groups]
                .sort(([a], [b]) =>
                  a.localeCompare(b, "zh-CN", { numeric: true }),
                )
                .flatMap(([, nodes]) => ordered(nodes, pinned, sort, layout));
            })()
          : ordered(tree.entries, pinned, sort, layout)
        ).map((node) => (
          <Branch
            key={node.path}
            node={node}
            busy={busy}
            copying={copying}
            depth={0}
            active={active}
            open={open}
            expandedPaths={expandedPaths}
            toggle={toggle}
            operate={run}
            onDropExternal={dropExternal}
            onDropFile={dropFile}
            pinned={pinned}
            sort={sort}
            layout={layout}
            listRoot={layout.view === "list" ? tree.path : undefined}
            togglePin={togglePin}
            treeRef={treeRef}
            onTreeKeyDown={onTreeKeyDown}
          />
        ))}
      </ul>
      {!(layout.view === "list"
        ? listedFiles(tree.entries).length
        : tree.entries.length) && (
        <p className="tree-empty" role="status">
          没有可显示的文件
        </p>
      )}
      {tree.truncated && (
        <p className="tree-empty">列表已达上限，请打开较小的文件夹。</p>
      )}
      {operation && (
        <Dialog
          title={operation.action === "trash" ? "移入系统废纸篓" : "文件操作"}
          onClose={() => setOperation(null)}
        >
          <header>
            <h2>
              {operation.action === "trash"
                ? operation.target?.kind === "directory"
                  ? "将文件夹移入废纸篓？"
                  : "将文档移入废纸篓？"
                : operation.action === "rename"
                  ? operation.target?.kind === "directory"
                    ? "重命名文件夹"
                    : "重命名文档"
                  : operation.action === "copy"
                    ? operation.target?.kind === "directory"
                      ? "复制文件夹"
                      : "复制文档"
                    : operation.action === "new-folder"
                      ? "新建文件夹"
                      : "新建 Markdown 文档"}
            </h2>
          </header>
          {operation.action === "trash" ? (
            <p className="close-description">
              “{operation.target?.name}
              ”及其内容会移入系统废纸篓，可从废纸篓恢复。
            </p>
          ) : (
            <form className="file-operation-form" onSubmit={submit}>
              <label htmlFor="file-operation-name">名称</label>
              <input
                id="file-operation-name"
                ref={nameInput}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={160}
              />
            </form>
          )}
          <div className="dialog-actions">
            <button onClick={() => setOperation(null)}>取消</button>
            <button
              disabled={busy}
              className={
                operation.action === "trash"
                  ? "danger-button"
                  : "primary-button"
              }
              onClick={() => {
                if (operation.action === "trash") {
                  void operate({
                    action: "trash",
                    target: operation.target?.path,
                  });
                  setOperation(null);
                } else submit();
              }}
            >
              {operation.action === "trash" ? "移入废纸篓" : "确定"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function findNode(nodes: FolderNode[], path: string): FolderNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = node.children && findNode(node.children, path);
    if (child) return child;
  }
}
