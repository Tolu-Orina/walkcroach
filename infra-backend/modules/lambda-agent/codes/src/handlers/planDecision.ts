import { createDbClient } from '@walkcroach/db';
import {
  continueAfterPlanDecision,
  type PlanDecisionInput,
} from '@walkcroach/agent-harness';
import { writeNdjson } from '../http.js';

export type PlanDecisionBody = PlanDecisionInput & {
  projectId: string;
};

export async function runPlanDecisionStream(
  sessionId: string,
  body: PlanDecisionBody,
  write: (chunk: string) => void,
): Promise<void> {
  const db = createDbClient();
  try {
    await writeNdjson(
      write,
      continueAfterPlanDecision({
        db,
        sessionId,
        projectId: body.projectId,
        decision: {
          planId: body.planId,
          decision: body.decision,
          adjustment: body.adjustment,
        },
      }),
    );
  } finally {
    await db.close();
  }
}
