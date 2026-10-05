export interface Mailbox {
  from: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

export function configuredMailboxes(
  env: Record<string, string | undefined> = process.env,
): Mailbox[] {
  const accounts: Mailbox[] = [];
  // Existing single-mailbox setup remains supported. Founder-specific credentials take precedence.
  for (const prefix of ["OUTREACH_SMTP", "OUTREACH_SMTP_AKSHIT", "OUTREACH_SMTP_CHINMAY"]) {
    const from = env[`${prefix}_FROM`]?.trim().toLowerCase();
    const host = env[`${prefix}_HOST`];
    const user = env[`${prefix}_USER`];
    const password = env[`${prefix}_PASSWORD`];
    if (!from || !host || !user || !password) continue;
    const port = Number(env[`${prefix}_PORT`] || 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP port");
    const existing = accounts.findIndex((a) => a.from === from);
    if (existing >= 0) accounts.splice(existing, 1);
    accounts.push({ from, host, port, user, password });
  }
  return accounts;
}
