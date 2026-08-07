/**
 * P3.2 — session-scoped approvals; critical commands never auto-approve.
 */
import { describe, expect, it } from 'vitest';
import {
  ApprovalController,
  FleetApprovalRouter,
} from './approval-controller.js';
import type { ApprovalRequest } from './host.js';

describe('ApprovalController critical gate (P3.2)', () => {
  it('never auto-approves critical commands even in low_friction', async () => {
    const emitted: ApprovalRequest[] = [];
    const gate = new ApprovalController((req) => emitted.push(req));
    gate.setAutonomy('low_friction');

    const pending = gate.requestCommand({
      cmd: 'rm -rf /tmp/danger',
      toolName: 'run_terminal',
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.cmd).toContain('rm -rf');
    gate.resolveApproval(emitted[0]!.stepId, 'reject');
    await expect(pending).resolves.toBe('reject');
  });

  it('auto-approves routine shell in low_friction', async () => {
    const gate = new ApprovalController(() => {
      throw new Error('must not emit approval for routine cmd');
    });
    gate.setAutonomy('low_friction');
    await expect(
      gate.requestCommand({ cmd: 'npm test', toolName: 'run_terminal' }),
    ).resolves.toBe('approve');
  });
});

describe('FleetApprovalRouter session scoping (P3.2)', () => {
  it('ignores cross-session resolveApproval', async () => {
    const aReqs: ApprovalRequest[] = [];
    const bReqs: ApprovalRequest[] = [];
    const gateA = new ApprovalController((req) => aReqs.push(req), {
      sessionId: 'fleet-a',
    });
    const gateB = new ApprovalController((req) => bReqs.push(req), {
      sessionId: 'fleet-b',
    });
    const router = new FleetApprovalRouter();
    router.register('fleet-a', gateA);
    router.register('fleet-b', gateB);

    const pendingA = gateA.requestCommand({
      cmd: 'sudo reboot',
      toolName: 'run_terminal',
    });
    expect(aReqs).toHaveLength(1);
    const stepA = aReqs[0]!.stepId;
    expect(aReqs[0]!.sessionId).toBe('fleet-a');

    // Spoof: B's UI tries to approve A's step with B's session id.
    router.resolveApproval(stepA, 'approve', 'fleet-b');
    gateA.resolveApproval(stepA, 'approve', 'fleet-b');

    // Still pending — resolve with correct session.
    router.resolveApproval(stepA, 'reject', 'fleet-a');
    await expect(pendingA).resolves.toBe('reject');
  });

  it('refuses ambiguous resolve when multiple sessions and no sessionId', () => {
    const gateA = new ApprovalController(() => undefined, {
      sessionId: 'a',
    });
    const gateB = new ApprovalController(() => undefined, {
      sessionId: 'b',
    });
    const router = new FleetApprovalRouter();
    router.register('a', gateA);
    router.register('b', gateB);
    expect(router.resolveApproval('any', 'approve')).toBe(false);
  });
});
