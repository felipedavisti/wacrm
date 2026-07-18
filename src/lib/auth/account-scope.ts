/**
 * Guard for `service_role` code paths (which bypass RLS).
 *
 * The service-role client ignores Row-Level Security, so isolation
 * between accounts on those paths depends entirely on the code filtering
 * by `account_id`. This guard makes "an account_id must be present" an
 * explicit, testable precondition: call it at the top of any service_role
 * operation whose tenant isolation rests on an account_id filter, then use
 * the returned (narrowed) value in the query.
 *
 * Fails closed — a null/blank account_id throws rather than running an
 * unscoped query. See Constitution Principle II and
 * `docs/service-role-inventory.md`.
 */
export function requireAccountScope(
  accountId: string | null | undefined,
): string {
  if (typeof accountId !== 'string' || accountId.trim() === '') {
    throw new Error(
      'account scope required: refusing an unscoped service_role operation',
    )
  }
  return accountId
}
