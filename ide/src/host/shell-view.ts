import * as vscode from 'vscode';

/**
 * One reusable WalkCroach terminal tab (extension PTY).
 * Agent I/O uses real child_process; this only mirrors what the user sees.
 * Avoids creating a new System terminal per command (and SI flakiness).
 */
export class WalkCroachShellView {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  private terminal: vscode.Terminal | undefined;
  private readonly closeSub: vscode.Disposable;

  constructor() {
    this.closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t === this.terminal) {
        this.terminal = undefined;
      }
    });
  }

  /** Ensure the tab exists and optionally reveal it (preserve focus). */
  ensureVisible(reveal = true): void {
    if (!this.terminal || this.terminal.exitStatus !== undefined) {
      const pty: vscode.Pseudoterminal = {
        onDidWrite: this.writeEmitter.event,
        onDidClose: this.closeEmitter.event,
        open: () => {
          this.write(
            '\x1b[2mWalkCroach shell — agent commands mirror here.\x1b[0m\r\n\r\n',
          );
        },
        close: () => {
          /* user closed tab; recreate on next command */
        },
      };
      this.terminal = vscode.window.createTerminal({
        name: 'WalkCroach',
        pty,
      });
    }
    if (reveal) {
      this.terminal.show(true);
    }
  }

  write(text: string): void {
    // PTY expects CRLF-ish; normalize newlines for Windows terminals.
    const normalized = text.replace(/\r?\n/g, '\r\n');
    this.writeEmitter.fire(normalized);
  }

  startCommand(cmd: string, cwd: string): void {
    this.ensureVisible(true);
    this.write(`\r\n\x1b[1m$ ${cmd}\x1b[0m\r\n`);
    this.write(`\x1b[2mcwd: ${cwd}\x1b[0m\r\n`);
  }

  endCommand(exitCode: number | null): void {
    const code = exitCode ?? 0;
    const color = code === 0 ? '32' : '31';
    this.write(`\r\n\x1b[${color}m[exit ${code}]\x1b[0m\r\n`);
  }

  note(message: string): void {
    this.ensureVisible(true);
    this.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
  }

  startSession(sessionId: string, cmd: string, cwd: string, backend: string): void {
    this.ensureVisible(true);
    this.write(
      `\r\n\x1b[1m[session ${sessionId}]\x1b[0m \x1b[2mbackend=${backend}\x1b[0m\r\n`,
    );
    this.write(`\x1b[1m$ ${cmd}\x1b[0m\r\n`);
    this.write(`\x1b[2mcwd: ${cwd}\x1b[0m\r\n`);
  }

  endSession(sessionId: string, status: string): void {
    this.write(
      `\r\n\x1b[33m[session ${sessionId} ${status}]\x1b[0m\r\n`,
    );
  }

  dispose(): void {
    try {
      this.terminal?.dispose();
    } catch {
      /* ignore */
    }
    this.terminal = undefined;
    this.closeSub.dispose();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
