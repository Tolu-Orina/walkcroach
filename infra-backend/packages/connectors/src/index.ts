/**
 * WalkCroach workflow connectors — the cross-surface platform.
 *
 * Web Chat, the Chrome side panel, the IDE and the CLI all consume this package.
 * No surface implements its own OAuth, its own token storage, or its own action
 * list: a connection made in Web is usable from Chrome, and an action added here
 * appears everywhere with the same scopes, the same validation, and the same
 * propose → confirm → execute contract.
 *
 * Layout:
 *   providers.ts  which services exist, and the exact scopes we ask for
 *   actions.ts    what can be done, and the validation gate in front of it
 *   oauth.ts      authorize URLs, PKCE, code exchange, refresh
 *   vault.ts      Secrets Manager token storage (tokens never leave the server)
 *   store.ts      connectors + workflow_runs persistence
 *   execute.ts    the single confirmed-write path
 */
export * from './providers.js';
export * from './actions.js';
export * from './oauth.js';
export * from './vault.js';
export * from './store.js';
export * from './execute.js';
