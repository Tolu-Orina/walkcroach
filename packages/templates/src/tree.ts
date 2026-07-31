/**
 * The file-tree shape templates produce.
 *
 * Structurally identical to WebContainer's `FileSystemTree`, and deliberately
 * declared here instead of imported from `@webcontainer/api`. The templates
 * only ever *described* a tree — the browser dependency was type-only, so the
 * runtime output was always plain nested objects. Keeping that type local is
 * what lets the same definitions feed the WebContainer preview in the browser
 * and `walkcroach create` writing to a real disk.
 *
 * It is a subset of WebContainer's type (no symlinks, no file permissions), so
 * a value of this type is still assignable where a `FileSystemTree` is wanted.
 */
export type FileNode = { file: { contents: string } };

export type DirectoryNode = { directory: FileTree };

export type FileTree = {
  [name: string]: FileNode | DirectoryNode;
};

export function isFileNode(node: FileNode | DirectoryNode): node is FileNode {
  return 'file' in node;
}

export type MaterialisedFile = {
  /** POSIX-style path relative to the project root, e.g. `src/App.tsx`. */
  path: string;
  contents: string;
};

/**
 * Flatten a tree into the files it represents, depth-first, parents first.
 *
 * `walkcroach create` needs a list it can write; the browser needs the nested
 * shape WebContainer mounts. One definition, two consumers, no second copy of
 * the templates to keep in step.
 *
 * Paths are joined with `/` regardless of platform: they are used to build
 * paths under a project root, and Node accepts forward slashes on Windows.
 */
export function materialise(tree: FileTree, prefix = ''): MaterialisedFile[] {
  const out: MaterialisedFile[] = [];
  for (const [name, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (isFileNode(node)) {
      out.push({ path, contents: node.file.contents });
    } else {
      out.push(...materialise(node.directory, path));
    }
  }
  return out;
}
