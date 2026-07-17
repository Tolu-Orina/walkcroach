export type WcElementSelection = {
  path: string;
  text: string;
  tagName: string;
};

export type WcBridgeMessage =
  | { type: 'wc:element-selected'; path: string; text: string; tagName: string }
  | { type: 'wc:set-edit-mode'; enabled: boolean }
  | { type: 'wc:highlight'; path: string };

export function filePathFromWcPath(wcPath: string): string {
  const hash = wcPath.indexOf('#');
  return hash === -1 ? wcPath : wcPath.slice(0, hash);
}
