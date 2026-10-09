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
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "./Dialog";
import type { FolderNode, FolderTree } from "./bridge";

type FileAction =
  | "new-file"
  | "new-folder"
  | "copy"
  | "rename"
  | "move"
  | "trash"
  | "undo"
  | "copy-path"
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
type SortMode = "name" | "type";

function ordered(entries: FolderNode[], pinned: Set<string>, sort: SortMode) {
  return [...entries].sort((a, b) => {
    const pinOrder = Number(pinned.has(b.path)) - Number(pinned.has(a.path));
    if (pinOrder) return pinOrder;
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    if (sort === "type" && a.kind === "file" && b.kind === "file") {
      const typeOrder = a.name
        .split(".")
        .pop()!
        .localeCompare(b.name.split(".").pop()!, "zh-CN", {
          sensitivity: "base",
        });
      if (typeOrder) return typeOrder;
    }
    return a.name.localeCompare(b.name, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function Branch({
  node,
  depth,
  active,
  open,
  expandedPaths,
  toggle,
  operate,
  onDropFile,
  pinned,
  sort,
  togglePin,
  treeRef,
  onTreeKeyDown,
}: {
  node: FolderNode;
  depth: number;
  active?: string;
  open: (path: string) => void;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  operate: RunOperation;
  onDropFile: (target: string, directory: string) => void;
  pinned: Set<string>;
  sort: SortMode;
  togglePin: (path: string) => void;
  treeRef: RefObject<HTMLUListElement | null>;
  onTreeKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    node: FolderNode,
  ) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const expanded = expandedPaths.has(node.path);
  const directory = node.kind === "directory";
  return (
    <li
      onDragOver={(event) => {
        if (directory && event.dataTransfer.types.includes("text/plain"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (!directory) return;
        const target = event.dataTransfer.getData("text/plain");
        if (!target || target === node.path) return;
        event.preventDefault();
        onDropFile(target, node.path);
      }}
    >
      <div className="tree-entry-line">
        <button
          className={"tree-row " + (active === node.path ? "selected" : "")}
          title={node.path}
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={directory ? expanded : undefined}
          aria-label={directory ? "文件夹 " + node.name : "打开 " + node.name}
          onKeyDown={(event) => onTreeKeyDown(event, node)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.path);
          }}
          onClick={() => (directory ? toggle(node.path) : open(node.path))}
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
          {directory ? <Folder size={15} /> : <FileText size={15} />}
          <span>{node.name}</span>
        </button>
        <button
          className="tree-actions-trigger"
          aria-label={`文件操作：${node.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreVertical size={15} />
        </button>
      </div>
      {menuOpen && (
        <div
          className="tree-actions"
          role="group"
          aria-label={`${node.name} 的文件操作`}
        >
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
          ) : (
            <>
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
        </div>
      )}
      {directory && expanded && (
        <ul>
          {node.children?.length ? (
            ordered(node.children, pinned, sort).map((child) => (
              <Branch
                key={child.path}
                node={child}
                depth={depth + 1}
                active={active}
                open={open}
                expandedPaths={expandedPaths}
                toggle={toggle}
                operate={operate}
                onDropFile={onDropFile}
                pinned={pinned}
                sort={sort}
                togglePin={togglePin}
                treeRef={treeRef}
                onTreeKeyDown={onTreeKeyDown}
              />
            ))
          ) : (
            <li className="tree-empty" style={{ paddingLeft: 34 + depth * 14 }}>
              没有 Markdown 文档
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
  expandedPaths,
  toggle,
  error,
  operate,
}: {
  tree: FolderTree;
  active?: string;
  open: (path: string) => void;
  refresh: () => void;
  close: () => void;
  busy: boolean;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  error: string;
  operate: RunOperation;
}) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [name, setName] = useState("");
  const treeRef = useRef<HTMLUListElement>(null);
  const [sort, setSort] = useState<SortMode>(() => {
    try {
      return localStorage.getItem("moxie.folder-sort.v1") === "type"
        ? "type"
        : "name";
    } catch {
      return "name";
    }
  });
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
      setSort(event.newValue === "type" ? "type" : "name");
    };
    window.addEventListener("moxie:folder-pins-changed", syncPins);
    window.addEventListener("storage", syncPinsAcrossWindows);
    window.addEventListener("storage", syncSortAcrossWindows);
    return () => {
      window.removeEventListener("moxie:folder-pins-changed", syncPins);
      window.removeEventListener("storage", syncPinsAcrossWindows);
      window.removeEventListener("storage", syncSortAcrossWindows);
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
    if (!operation) return;
    void operate({
      action: operation.action,
      target: operation.target?.path || tree.path,
      directory: operation.directory,
      name,
    });
    setOperation(null);
  };
  const run: RunOperation = async ({ action, target, directory }) => {
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
    void operate({ action: "move", target, directory });
  };
  const onTreeKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: FolderNode,
  ) => {
    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>(".tree-row") || [],
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
    } else if (event.key === "ArrowLeft" && node.kind === "file") {
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
          if (event.dataTransfer.types.includes("text/plain"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          const target = event.dataTransfer.getData("text/plain");
          if (!target || target === tree.path) return;
          event.preventDefault();
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
        <button aria-label="关闭文件夹" onClick={close}>
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
          <option value="type">按类型</option>
        </select>
      </label>
      {error && (
        <p className="tree-empty" role="status">
          {error}
        </p>
      )}
      <p id="folder-tree-keyboard-help" className="sr-only">
        文件列表支持方向键导航：上下方向键切换项目，左右方向键展开或折叠文件夹，Home
        和 End 跳到列表首尾。
      </p>
      <ul
        ref={treeRef}
        aria-label="文件列表"
        aria-describedby="folder-tree-keyboard-help"
      >
        {ordered(tree.entries, pinned, sort).map((node) => (
          <Branch
            key={node.path}
            node={node}
            depth={0}
            active={active}
            open={open}
            expandedPaths={expandedPaths}
            toggle={toggle}
            operate={run}
            onDropFile={dropFile}
            pinned={pinned}
            sort={sort}
            togglePin={togglePin}
            treeRef={treeRef}
            onTreeKeyDown={onTreeKeyDown}
          />
        ))}
      </ul>
      {!tree.entries.length && <p className="tree-empty">没有 Markdown 文档</p>}
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
