import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderTree } from "./bridge";
const key = "moxie.folder.v1";
function restored() {
  if (!window.desktop)
    return { path: null as string | null, expanded: [] as string[] };
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value?.version === 1 &&
      typeof value.path === "string" &&
      Array.isArray(value.expanded)
    )
      return {
        path: value.path,
        expanded: value.expanded
          .filter((path: unknown) => typeof path === "string")
          .slice(0, 1000) as string[],
      };
  } catch {}
  return { path: null as string | null, expanded: [] as string[] };
}
export function useFolder() {
  const [session] = useState(restored);
  const [root, setRoot] = useState<string | null>(session.path);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(session.expanded),
  );
  const [tree, setTree] = useState<FolderTree | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(root);
  rootRef.current = root;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const generation = useRef(0),
    inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    try {
      if (root)
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            path: root,
            expanded: [...expanded].slice(0, 1000),
          }),
        );
      else localStorage.removeItem(key);
    } catch {
      setError("文件夹会话无法保存，下次启动可能需要重新选择。");
    }
  }, [root, expanded]);
  const refresh = useCallback(async () => {
    const path = rootRef.current;
    if (!path || !window.desktop?.refreshFolder || inFlight.current) return;
    const token = generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await window.desktop.refreshFolder(
        path,
        treeRef.current?.version,
      );
      if (
        !mounted.current ||
        token !== generation.current ||
        path !== rootRef.current
      )
        return;
      if (result) setTree(result);
      setError("");
    } catch {
      if (mounted.current && token === generation.current)
        setError(
          "文件夹暂时无法读取。当前文档已保留，可重试或重新选择文件夹。",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current && token === generation.current) setBusy(false);
      else if (mounted.current && rootRef.current)
        queueMicrotask(() => void refresh());
    }
  }, []);
  useEffect(() => {
    if (!root) return;
    void refresh();
    const check = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(check, 3000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [root, refresh]);
  const open = useCallback(async () => {
    if (!window.desktop || inFlight.current) return false;
    const token = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await window.desktop.folder();
      if (!mounted.current || token !== generation.current || !result)
        return false;
      rootRef.current = result.path;
      treeRef.current = result;
      setRoot(result.path);
      setTree(result);
      setExpanded(new Set());
      setError("");
      return true;
    } catch (error) {
      if (mounted.current && token === generation.current)
        setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current && token === generation.current) setBusy(false);
    }
  }, []);
  const close = useCallback(() => {
    generation.current++;
    rootRef.current = null;
    treeRef.current = null;
    setRoot(null);
    setTree(null);
    setExpanded(new Set());
    setBusy(false);
    setError("");
  }, []);
  const toggle = useCallback(
    (path: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  return { tree, root, expanded, busy, error, open, refresh, close, toggle };
}
