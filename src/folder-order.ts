import type { FolderNode } from "./bridge";
export type SortMode = "name" | "alphabet" | "type" | "modified" | "created";
export type FolderLayout = {
  descending: boolean;
  foldersFirst: boolean;
  view: "tree" | "list";
};
export const defaultLayout: FolderLayout = {
  descending: false,
  foldersFirst: true,
  view: "tree",
};
export const validSort = (value: string | null): SortMode =>
  ["name", "alphabet", "type", "modified", "created"].includes(value || "")
    ? (value as SortMode)
    : "name";
export function ordered(
  entries: FolderNode[],
  pinned: Set<string>,
  sort: SortMode,
  layout: FolderLayout,
) {
  return [...entries].sort((a, b) => {
    const pinOrder = Number(pinned.has(b.path)) - Number(pinned.has(a.path));
    if (pinOrder) return pinOrder;
    const folderOrder =
      Number(b.kind === "directory") - Number(a.kind === "directory");
    if (layout.foldersFirst && folderOrder) return folderOrder;
    const direction = layout.descending ? -1 : 1;
    if (sort === "modified" || sort === "created") {
      const left = a[sort],
        right = b[sort];
      if (!left && right) return 1;
      if (left && !right) return -1;
      if (left && right && left !== right) return (left - right) * direction;
    } else if (sort === "type") {
      const extension = (node: FolderNode) =>
        node.kind === "directory" ? "" : node.name.split(".").pop() || "";
      const types = extension(a).localeCompare(extension(b), "zh-CN", {
        sensitivity: "base",
      });
      if (types) return types * direction;
    }
    return (
      direction *
      (a.name.localeCompare(b.name, "zh-CN", {
        numeric: sort !== "alphabet",
        sensitivity: "base",
      }) || a.path.localeCompare(b.path))
    );
  });
}
export function listedFiles(entries: FolderNode[]): FolderNode[] {
  return entries.flatMap((node) =>
    node.kind === "directory" ? listedFiles(node.children || []) : [node],
  );
}
