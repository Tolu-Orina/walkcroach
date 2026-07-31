/** Shared free-grant default for Chrome credit meter (matches lambda-agent). */
export const FREE_MONTHLY_CREDITS = Number(
  process.env.FREE_MONTHLY_CREDITS ?? 100,
);
