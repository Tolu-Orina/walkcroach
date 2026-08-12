/** Derive Cloud project number from an OAuth web client id when possible. */
export function projectNumberFromClientId(clientId: string): string | null {
  const prefix = clientId.trim().split('-')[0] ?? '';
  return /^\d{6,}$/.test(prefix) ? prefix : null;
}
