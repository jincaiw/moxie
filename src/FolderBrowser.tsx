import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  RefreshCw,
  X,
} from "lucide-react";
import type { FolderNode, FolderTree } from "./bridge";
function Branch({
  node,
  depth,
  active,
  open,
  expandedPaths,
  toggle,
}: {
  node: FolderNode;
  depth: number;
  active?: string;
  open: (path: string) => void;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
}) {
  const expanded = expandedPaths.has(node.path);
  const directory = node.kind === "directory";
  return (
    <li>
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
}) {
  return (
    <section className="folder-browser" aria-label="文件夹浏览">
      <header title={tree.path}>
        <Folder size={14} />
        <strong>{tree.name}</strong>
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
          />
        ))}
      </ul>
      {!tree.entries.length && <p className="tree-empty">没有 Markdown 文档</p>}
      {tree.truncated && (
        <p className="tree-empty">列表已达上限，请打开较小的文件夹。</p>
      )}
    </section>
  );
}
