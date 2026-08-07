import { describe, expect, it } from 'vitest';
import {
  permissionModeFromAutonomy,
  resolvePermissionMode,
} from './permission-mode.js';

describe('permission modes (Pre-P6)', () => {
  it('maps plan → readOnly + strict', () => {
    expect(resolvePermissionMode('plan')).toMatchObject({
      readOnly: true,
      autonomy: 'strict',
    });
  });

  it('maps acceptEdits → low_friction', () => {
    expect(resolvePermissionMode('acceptEdits').autonomy).toBe('low_friction');
  });

  it('maps bypassPermissions with skipInteractiveConfirm but low_friction only', () => {
    const r = resolvePermissionMode('bypassPermissions');
    expect(r.autonomy).toBe('low_friction');
    expect(r.skipInteractiveConfirm).toBe(true);
    expect(r.readOnly).toBe(false);
  });

  it('round-trips autonomy helpers', () => {
    expect(permissionModeFromAutonomy('strict')).toBe('default');
    expect(permissionModeFromAutonomy('low_friction')).toBe('acceptEdits');
    expect(permissionModeFromAutonomy('strict', true)).toBe('plan');
  });
});
