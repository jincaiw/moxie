import { useRef, useState, type FormEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "./Dialog";
import type { FolderNode, FolderTree } from "./bridge";

type FileAction =
  "new-file" | "new-folder" | "copy" | "rename" | "move" | "trash" | "undo";
type Operation = { action: FileAction; target?: FolderNode };
type OperationRequest = { action: FileAction; target?: string; name?: string };
type RunOperation = (request: OperationRequest) => Promise<void>;

function Branch({
  node,
  depth,
  active,
  open,
  expandedPaths,
  toggle,
  operate,
}: {
  node: FolderNode;
  depth: number;
  active?: string;
  open: (path: string) => void;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  operate: RunOperation;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const expanded = expandedPaths.has(node.path);
  const directory = node.kind === "directory";
  return (
    <li>
      <div className="tree-entry-line">
        <button
          className={"tree-row " + (active === node.path ? "selected" : "")}
          title={node.path}
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={directory ? expanded : undefined}
          aria-label={directory ? "文件夹 " + node.name : "打开 " + node.name}
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
            node.children.map((child) => (
              <Branch
                key={child.path}
                node={child}
                depth={depth + 1}
                active={active}
                open={open}
                expandedPaths={expandedPaths}
                toggle={toggle}
                operate={operate}
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
              ? `${target.name.replace(/\.(md|markdown|txt)$/i, "")} 副本${target.name.match(/\.(md|markdown|txt)$/i)?.[0] || ".md"}`
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
      name,
    });
    setOperation(null);
  };
  const run: RunOperation = async ({ action, target }) => {
    if (["new-file", "new-folder", "copy", "rename"].includes(action)) {
      const node = target ? findNode(tree.entries, target) : undefined;
      openOperation(action, node);
    } else if (action === "trash") {
      setOperation({
        action,
        target: target ? findNode(tree.entries, target) : undefined,
      });
    } else await operate({ action, target });
  };
  return (
    <section className="folder-browser" aria-label="文件夹浏览">
      <header title={tree.path}>
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
        <button aria-label="刷新文件夹" disabled={busy} onClick={refresh}>
          <RefreshCw size={13} />
        </button>
        <button aria-label="关闭文件夹" onClick={close}>
          <X size={13} />
        </button>
      </header>
      {error && (
        <p className="tree-empty" role="status">
          {error}
        </p>
      )}
      <ul>
        {tree.entries.map((node) => (
          <Branch
            key={node.path}
            node={node}
            depth={0}
            active={active}
            open={open}
            expandedPaths={expandedPaths}
            toggle={toggle}
            operate={run}
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
                ? "将文档移入废纸篓？"
                : operation.action === "rename"
                  ? "重命名文档"
                  : operation.action === "copy"
                    ? "复制文档"
                    : operation.action === "new-folder"
                      ? "新建文件夹"
                      : "新建 Markdown 文档"}
            </h2>
          </header>
          {operation.action === "trash" ? (
            <p className="close-description">
              “{operation.target?.name}”会移入系统废纸篓，可从废纸篓恢复。
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
