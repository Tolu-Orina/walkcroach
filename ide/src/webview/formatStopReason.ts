/** Human-readable stop reason for the chat footer. */
export function formatStopReason(reason: string): string {
  switch (reason) {
    case 'end_turn':
    case 'complete':
      return 'Complete';
    case 'incomplete':
      return 'Incomplete · needs writes';
    case 'max_tokens':
      return 'Truncated · output limit';
    case 'max_iterations':
      return 'Paused · tool-round limit';
    case 'cancelled':
      return 'Stopped';
    case 'error':
      return 'Error';
    case 'tool_use':
      return 'Stopped mid-tools';
    default:
      return reason.replace(/_/g, ' ');
  }
}
