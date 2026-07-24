/**
 * Per-run policy derived from `.walkcroach/settings.json` + built-in sensitive paths.
 */

import { isSensitivePath } from './approvals.js';
import {
  defaultSettings,
  isBackgroundAllowed,
  matchesDenyPattern,
  type VerifyConfig,
  type WalkcroachSettings,
} from './workspace-config.js';

/** Extra verify re-prompts after soft maxNudges (hard gate before end_turn). */
export const HARD_VERIFY_EXTRA = 3;

export class WorkspacePolicy {
  readonly settings: WalkcroachSettings;
  readonly verify: VerifyConfig;
  private verifyPassed = false;

  constructor(
    settings: WalkcroachSettings = defaultSettings(),
    verify: VerifyConfig = { commands: [], cwd: '.' },
  ) {
    this.settings = settings;
    this.verify = verify;
  }

  get defaultTimeoutMs(): number {
    return this.settings.terminal.defaultTimeoutMs;
  }

  get hasVerifyRecipes(): boolean {
    return this.verify.commands.length > 0;
  }

  get verifyRequired(): boolean {
    return this.settings.verify.required && this.hasVerifyRecipes;
  }

  get maxVerifyNudges(): number {
    return this.settings.verify.maxNudges;
  }

  /**
   * Soft nudges + hard extras before allowing end_turn while unverified.
   * Total verify re-prompts = maxNudges + HARD_VERIFY_EXTRA.
   */
  get verifyPromptCap(): number {
    return this.maxVerifyNudges + HARD_VERIFY_EXTRA;
  }

  markVerified(): void {
    this.verifyPassed = true;
  }

  get didVerify(): boolean {
    return this.verifyPassed;
  }

  /** Hard deny for writes (built-in sensitive + settings.denyPaths). */
  isDeniedPath(path: string): boolean {
    if (isSensitivePath(path)) return true;
    return this.settings.denyPaths.some((pat) => matchesDenyPattern(path, pat));
  }

  allowBackground(cmd: string): boolean {
    return isBackgroundAllowed(
      cmd,
      this.settings.terminal.backgroundAllowlist,
    );
  }
}
