import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowDown01,
  ArrowDownAZ,
  CalendarDays,
  Clock,
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
import { createPortal } from "react-dom";
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

export type FolderBrowserHandle = {
  newFile: () => void;
  toggleView: () => void;
};

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
type RunOperation = (
  request: OperationRequest,
) => Promise<void | { ok: boolean; error?: string }>;
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
  operating,
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
  actionPath,
  setActionPath,
}: {
  actionPath: string | null;
  setActionPath: Dispatch<SetStateAction<string | null>>;
  node: FolderNode;
  busy: boolean;
  copying: boolean;
  operating: boolean;
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
  const menuOpen = actionPath === node.path;
  const setMenuOpen = (value: boolean) => {
    if (value) setActionPath(node.path);
    else setActionPath((current) => (current === node.path ? null : current));
  };
  const actionsRef = useRef<HTMLFieldSetElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const menuPoint = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menuOpen || !actionsRef.current) return;
    const bounds = entryRef.current!.getBoundingClientRect();
    const point = menuPoint.current || {
      left: bounds.right,
      top: bounds.bottom,
    };
    const place = () => {
      if (!actionsRef.current) return;
      const menu = actionsRef.current.getBoundingClientRect();
      setMenuPosition({
        left: Math.max(
          8,
          Math.min(point.left, window.innerWidth - menu.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(point.top, window.innerHeight - menu.height - 8),
        ),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(actionsRef.current);
    const close = (event: Event) => {
      if (
        event.type === "scroll" &&
        event.target instanceof Node &&
        actionsRef.current?.contains(event.target)
      )
        return;
      setMenuOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);
  const entryRef = useRef<HTMLDivElement>(null);
  const closeActions = () => {
    entryRef.current?.querySelector<HTMLButtonElement>(".tree-row")?.focus();
    setMenuOpen(false);
  };
  useEffect(() => {
    if (!menuOpen) return;
    let pointerDown = false;
    const startPointer = () => {
      pointerDown = true;
    };
    const endPointer = () => {
      pointerDown = false;
    };
    const dismissOutside = (event: Event) => {
      if (
        !pointerDown &&
        event.target instanceof Node &&
        !actionsRef.current?.contains(event.target) &&
        !entryRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    // Close after the click, so collapsing this panel cannot move its target
    // between pointerdown and click. Keyboard focus changes close immediately.
    window.addEventListener("pointerdown", startPointer);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    window.addEventListener("click", dismissOutside);
    window.addEventListener("focusin", dismissOutside);
    actionsRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    return () => {
      window.removeEventListener("pointerdown", startPointer);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("click", dismissOutside);
      window.removeEventListener("focusin", dismissOutside);
    };
  }, [menuOpen]);
  const expanded = expandedPaths.has(node.path);
  const directory = node.kind === "directory";
  return (
    <li
      onDragOver={(event) => {
        if (
          directory &&
          ((!copying &&
            !operating &&
            event.dataTransfer.types.includes("Files")) ||
            (!busy &&
              event.dataTransfer.types.includes("application/x-moxie-path")))
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
        if (event.dataTransfer.files.length) {
          if (!copying && !operating)
            onDropExternal?.(Array.from(event.dataTransfer.files), node.path);
          return;
        }
        if (busy) return;
        const target = event.dataTransfer.getData("application/x-moxie-path");
        if (!target || target === node.path) return;
        onDropFile(target, node.path);
      }}
    >
      <div className="tree-entry-line" ref={entryRef}>
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
              menuPoint.current = null;
              setMenuOpen(true);
            } else onTreeKeyDown(event, node);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            menuPoint.current = { left: event.clientX, top: event.clientY };
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
          onClick={() => {
            setMenuOpen(false);
            directory
              ? toggle(node.path)
              : node.kind === "file"
                ? open(node.path)
                : void operate({ action: "reveal", target: node.path });
          }}
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
            <Folder size={15} fill="currentColor" strokeWidth={0} />
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
          onClick={() => {
            menuPoint.current = null;
            setMenuOpen(!menuOpen);
          }}
        >
          <MoreVertical size={15} />
        </button>
      </div>
      {menuOpen && (
        <fieldset
          className="tree-actions"
          style={menuPosition}
          disabled={busy}
          ref={actionsRef}
          role="group"
          aria-label={`${node.name} 的文件操作`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeActions();
              return;
            }
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            event.preventDefault();
            buttons[next].focus({ preventScroll: true });
            buttons[next].scrollIntoView({
              block: "nearest",
              inline: "nearest",
            });
          }}
        >
          {node.kind !== "other" && (
            <button
              onClick={() => {
                closeActions();
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
                  closeActions();
                  void operate({ action: "new-file", target: node.path });
                }}
              >
                <FilePlus2 size={14} />
                新建文档
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "new-folder", target: node.path });
                }}
              >
                <FolderPlus size={14} />
                新建文件夹
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "copy", target: node.path });
                }}
              >
                <Copy size={14} />
                复制文件夹
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "rename", target: node.path });
                }}
              >
                重命名
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "move", target: node.path });
                }}
              >
                移动到…
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "reveal", target: node.path });
                }}
              >
                <ExternalLink size={14} />
                在文件管理器中显示
              </button>
              <button
                className="tree-action-danger"
                onClick={() => {
                  closeActions();
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
                  closeActions();
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  closeActions();
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
                  closeActions();
                  void operate({ action: "new-window", target: node.path });
                }}
              >
                在新窗口打开
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "copy", target: node.path });
                }}
              >
                <Copy size={14} />
                复制
              </button>
              <button
                onClick={() => {
                  closeActions();
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
                  closeActions();
                  void operate({ action: "rename", target: node.path });
                }}
              >
                重命名
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "move", target: node.path });
                }}
              >
                移动到…
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "copy-path", target: node.path });
                }}
              >
                <Copy size={14} />
                复制路径
              </button>
              <button
                onClick={() => {
                  closeActions();
                  void operate({ action: "reveal", target: node.path });
                }}
              >
                <ExternalLink size={14} />
                在文件管理器中显示
              </button>
              <button
                className="tree-action-danger"
                onClick={() => {
                  closeActions();
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
                operating={operating}
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
                actionPath={actionPath}
                setActionPath={setActionPath}
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
  ref,
  controlsHost,
  onViewChange,
  tree,
  active,
  open,
  refresh,
  close,
  busy,
  copying = false,
  operating = false,
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
  ref?: Ref<FolderBrowserHandle>;
  controlsHost?: HTMLElement | null;
  onViewChange?: (view: "tree" | "list") => void;
  dropExternal?: (files: File[], directory: string) => void;
  tree: FolderTree;
  active?: string;
  open: (path: string) => void;
  refresh: () => void;
  close: () => void;
  busy: boolean;
  copying?: boolean;
  operating?: boolean;
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
  const [actionPath, setActionPath] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const operationOrigin = useRef<HTMLElement | null>(null);
  const [operationError, setOperationError] = useState("");
  const normalizedName = name.trim();
  const nameError =
    !operation || operation.action === "trash"
      ? ""
      : normalizedName.length > 160
        ? "名称不能超过 160 个字符。"
        : !normalizedName ||
            normalizedName === "." ||
            normalizedName === ".." ||
            /[<>:"|?*\\/\x00-\x1f]/.test(normalizedName)
          ? '名称不能为空，也不能包含路径分隔符或特殊字符 <>:"|?*。'
          : operation.action === "new-file" &&
              !/\.(md|markdown|txt)$/i.test(normalizedName)
            ? "文档名称需以 .md、.markdown 或 .txt 结尾。"
            : "";
  const closeOperation = () => {
    if (!submittingRef.current) {
      setOperation(null);
      requestAnimationFrame(() => {
        if (
          operationOrigin.current?.isConnected &&
          operationOrigin.current.checkVisibility()
        )
          operationOrigin.current.focus();
        else
          document
            .querySelector<HTMLButtonElement>(".sidebar-folder-trigger")
            ?.focus();
      });
    }
  };
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
    operationOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOperationError("");
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
  useImperativeHandle(ref, () => ({
    newFile: () => openOperation("new-file"),
    toggleView: () =>
      changeLayout({ view: layout.view === "tree" ? "list" : "tree" }),
  }));
  useEffect(() => onViewChange?.(layout.view), [layout.view, onViewChange]);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!operation || busy || submittingRef.current || nameError) return;
    submittingRef.current = true;
    setSubmitting(true);
    setOperationError("");
    try {
      const result = await operate({
        action: operation.action,
        target: operation.target?.path || tree.path,
        directory: operation.directory,
        name: operation.action === "trash" ? undefined : normalizedName,
      });
      if (result?.ok) setOperation(null);
      else {
        setOperationError(result?.error || "未能完成操作，请重试。");
        requestAnimationFrame(() => nameInput.current?.focus());
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      requestAnimationFrame(() => nameInput.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const run: RunOperation = async ({ action, target, directory }) => {
    if (busy) return;
    if (["new-file", "new-folder", "copy", "rename"].includes(action)) {
      const node = target ? findNode(tree.entries, target) : undefined;
      openOperation(action, node);
    } else if (action === "trash") {
      operationOrigin.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOperationError("");
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
    if (
      event.key === "F2" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      node.kind !== "other"
    ) {
      event.preventDefault();
      openOperation("rename", node);
      return;
    }
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
  const parentPath = (node: FolderNode) =>
    node.path.slice(
      0,
      node.path.lastIndexOf(node.path.includes("\\") ? "\\" : "/"),
    );
  const displayedNodes =
    layout.view === "list"
      ? (() => {
          const files = listedFiles(tree.entries);
          if (!layout.foldersFirst) return ordered(files, pinned, sort, layout);
          const groups = new Map<string, FolderNode[]>();
          for (const node of files) {
            const parent = parentPath(node);
            groups.set(parent, [...(groups.get(parent) || []), node]);
          }
          return [...groups]
            .sort(([a], [b]) => a.localeCompare(b, "zh-CN", { numeric: true }))
            .flatMap(([, nodes]) => ordered(nodes, pinned, sort, layout));
        })()
      : ordered(tree.entries, pinned, sort, layout);
  const groupCounts = new Map<string, number>();
  if (layout.view === "list" && layout.foldersFirst)
    for (const node of displayedNodes) {
      const parent = parentPath(node);
      groupCounts.set(parent, (groupCounts.get(parent) || 0) + 1);
    }
  return (
    <section className="folder-browser" aria-label="文件夹浏览">
      <header
        title={tree.path}
        onDragOver={(event) => {
          if (
            (!copying &&
              !operating &&
              event.dataTransfer.types.includes("Files")) ||
            (!busy &&
              event.dataTransfer.types.includes("application/x-moxie-path"))
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
          if (event.dataTransfer.files.length) {
            if (!copying && !operating)
              dropExternal?.(Array.from(event.dataTransfer.files), tree.path);
            return;
          }
          if (busy) return;
          const target = event.dataTransfer.getData("application/x-moxie-path");
          if (!target || target === tree.path) return;
          dropFile(target, tree.path);
        }}
      >
        <Folder size={14} />
        <strong>{tree.name}</strong>
      </header>
      {controlsHost &&
        createPortal(
          <>
            <div className="folder-primary-actions">
              <button
                aria-label="新建文档"
                title="新建文档"
                disabled={busy}
                onClick={() => openOperation("new-file")}
              >
                <FilePlus2 size={14} />
                新建文档
              </button>
              <button aria-label="刷新文件夹" disabled={busy} onClick={refresh}>
                <RefreshCw size={13} />
                刷新文件夹
              </button>
              <button
                aria-label="关闭文件夹"
                disabled={copying || operating}
                onClick={close}
              >
                <X size={13} />
                关闭文件夹
              </button>
            </div>
            <div
              className="folder-sort-bar"
              role="group"
              aria-label="排序快捷选项"
            >
              <button
                aria-label={
                  layout.view === "list" ? "切换文件夹分组" : "文件夹优先"
                }
                aria-pressed={layout.foldersFirst}
                title="文件夹优先 / 按文件夹分组"
                onClick={() =>
                  changeLayout({ foldersFirst: !layout.foldersFirst })
                }
              >
                <Folder size={15} />
              </button>
              {(
                [
                  ["name", "自然顺序", ArrowDown01],
                  ["alphabet", "字母顺序", ArrowDownAZ],
                  ["modified", "修改时间", Clock],
                  ["created", "创建时间", CalendarDays],
                ] as const
              ).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  aria-label={`按${label}排序`}
                  aria-pressed={sort === mode}
                  title={`按${label}排序${sort === mode ? (layout.descending ? " · 降序" : " · 升序") : ""}`}
                  onClick={() => {
                    if (sort === mode)
                      changeLayout({ descending: !layout.descending });
                    else changeSort(mode);
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <details className="folder-options">
              <summary>显示与操作</summary>
              <div className="folder-secondary-actions">
                <button
                  aria-label="新建文件夹"
                  title="新建文件夹"
                  disabled={busy}
                  onClick={() => openOperation("new-folder")}
                >
                  <FolderPlus size={14} />
                  新建文件夹
                </button>
                <button
                  aria-label="撤销文件操作"
                  title="撤销文件操作"
                  disabled={busy}
                  onClick={() => run({ action: "undo" })}
                >
                  <RotateCcw size={14} />
                  撤销操作
                </button>
                <button
                  aria-label="在文件管理器中显示文件夹"
                  title="在文件管理器中显示文件夹"
                  disabled={busy}
                  onClick={() =>
                    void operate({ action: "reveal", target: tree.path })
                  }
                >
                  <ExternalLink size={14} />
                  在系统中显示
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
                  复制路径
                </button>
              </div>
              <label className="folder-sort-control">
                文件排序
                <select
                  aria-label="文件排序"
                  value={sort}
                  onChange={(event) =>
                    changeSort(event.target.value as SortMode)
                  }
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
                      changeLayout({
                        view: event.target.value as FolderLayout["view"],
                      })
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
                      changeLayout({
                        descending: event.target.value === "descending",
                      })
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
              <p className="folder-drag-help">
                拖入正文或使用文件操作菜单插入相对链接；系统文件拖到文件夹可复制。按住
                Alt/Option 可拖出到系统。
              </p>
            </details>
          </>,
          controlsHost,
        )}
      {error && (
        <p className="tree-empty" role="status">
          {error}
        </p>
      )}
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
        和 End 跳到列表首尾。Shift+F10
        打开文件操作，上下方向键循环切换操作，Home/End 跳到首尾，Tab
        切换操作，Enter 执行；可选择插入相对链接到正文，Escape
        关闭操作并返回文件行。
      </p>
      <ul
        ref={treeRef}
        aria-label="文件列表"
        aria-busy={copying}
        aria-describedby="folder-tree-keyboard-help"
      >
        {displayedNodes.map((node, index) => (
          <Fragment key={node.path}>
            {layout.view === "list" &&
              layout.foldersFirst &&
              (index === 0 ||
                parentPath(displayedNodes[index - 1]) !== parentPath(node)) && (
                <li className="file-list-group" title={parentPath(node)}>
                  <Folder size={13} aria-hidden="true" />
                  <span>
                    {parentPath(node) === tree.path
                      ? tree.name
                      : parentPath(node).slice(tree.path.length + 1)}
                  </span>
                  <small
                    aria-label={`${groupCounts.get(parentPath(node))} 个文件`}
                  >
                    {groupCounts.get(parentPath(node))}
                  </small>
                </li>
              )}

            <Branch
              node={node}
              busy={busy}
              copying={copying}
              operating={operating}
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
              listRoot={
                layout.view === "list" && !layout.foldersFirst
                  ? tree.path
                  : undefined
              }
              togglePin={togglePin}
              treeRef={treeRef}
              onTreeKeyDown={onTreeKeyDown}
              actionPath={actionPath}
              setActionPath={setActionPath}
            />
          </Fragment>
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
          onClose={closeOperation}
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
            <form
              className="file-operation-form"
              onSubmit={(event) => void submit(event)}
              aria-busy={submitting}
            >
              <label htmlFor="file-operation-name">名称</label>
              <input
                id="file-operation-name"
                ref={nameInput}
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setOperationError("");
                }}
                disabled={submitting}
                aria-invalid={Boolean(nameError || operationError)}
                aria-describedby="file-operation-help"
                maxLength={160}
              />
            </form>
          )}
          <p
            id="file-operation-help"
            className={
              nameError || operationError
                ? "file-operation-error"
                : "file-operation-help"
            }
            role={nameError || operationError ? "alert" : undefined}
          >
            {nameError ||
              operationError ||
              (operation.action === "trash" ? "" : "同名项目不会被覆盖。")}
          </p>
          {submitting && <p role="status">正在处理，请稍候…</p>}
          <div className="dialog-actions">
            <button disabled={submitting} onClick={closeOperation}>
              取消
            </button>
            <button
              disabled={busy || submitting || Boolean(nameError)}
              className={
                operation.action === "trash"
                  ? "danger-button"
                  : "primary-button"
              }
              onClick={() => void submit()}
            >
              {submitting
                ? "处理中…"
                : operation.action === "trash"
                  ? "移入废纸篓"
                  : "确定"}
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
