/**
 * One-shot task that rotates the `capiro_app` runtime role's password to
 * match what's in Secrets Manager. Run after migration 0005 creates the
 * role, and any time the app secret rotates.
 *
 * Connects as the Aurora master (env: MASTER_USER / MASTER_PASSWORD), runs
 * `ALTER ROLE capiro_app PASSWORD '<from app secret>'`. The new password
 * comes from APP_PASSWORD env var injected by ECS from the app secret.
 *
 * Identifier and password are quoted via pg-format-style escaping. The
 * password contains only generated characters from the secret's
 * `excludePunctuation` set so the only required escape is single-quote
 * doubling — defensive in case CDK config changes.
 */
import { config as dotenvConfig } from 'dotenv';
import { Client } from 'pg';

dotenvConfig();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function escapeSqlIdent(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Refusing to use unusual role identifier: ${s}`);
  }
  return s;
}

async function main() {
  const host = required('DB_HOST');
  const port = parseInt(required('DB_PORT'), 10);
  const database = required('DB_NAME');
  const masterUser = required('MASTER_USER');
  const masterPassword = required('MASTER_PASSWORD');
  const appUser = required('APP_USER');
  const appPassword = required('APP_PASSWORD');

  // eslint-disable-next-line no-console
  console.log(`Rotating ${appUser} password (db=${database} host=${host})`);

  const client = new Client({
    host,
    port,
    database,
    user: masterUser,
    password: masterPassword,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const role = escapeSqlIdent(appUser);
    const pw = escapeSqlLiteral(appPassword);
    await client.query(`ALTER ROLE "${role}" PASSWORD '${pw}'`);
    // Verify the role can authenticate by re-connecting under it.
    const verify = new Client({
      host,
      port,
      database,
      user: appUser,
      password: appPassword,
      ssl: { rejectUnauthorized: false },
    });
    await verify.connect();
    const r = await verify.query('SELECT current_user, current_database()');
    // eslint-disable-next-line no-console
    console.log(`Verified login as ${r.rows[0].current_user} on ${r.rows[0].current_database}`);
    await verify.end();
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
