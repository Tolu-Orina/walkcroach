/**
 * Re-export shim (C3.1).
 *
 * The template definitions moved to `@walkcroach/templates` so the CLI's
 * `walkcroach create` can produce exactly what the browser builder produces,
 * from one source. This file stays so that every Web call site — and every
 * existing test — keeps importing the same paths it always did.
 *
 * The package declares its own structural `FileTree` rather than importing
 * `FileSystemTree` from `@webcontainer/api`: that import was type-only, so the
 * runtime output never had a browser dependency. `FileTree` is a subset of
 * WebContainer's type (no symlinks, no permissions), so it remains assignable
 * wherever a `FileSystemTree` is expected.
 */
export { safeProjectSlug, viteScaffold } from '@walkcroach/templates';
export type { TemplateDefinition } from '@walkcroach/templates';
