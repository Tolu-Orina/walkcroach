/**
 * Empty states that teach (plan C6).
 *
 * An empty list in this panel is almost always the *expected* first state, not a
 * failure — so each one names the action that fills it rather than reporting
 * absence. "No captures yet." tells the user nothing they did not know.
 */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="wc-empty">
      <span className="wc-empty__title">{title}</span>
      {children}
    </div>
  );
}
