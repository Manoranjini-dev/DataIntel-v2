/**
 * One-shot script: reset the password for an account by email.
 * Usage: npx ts-node scripts/reset-admin-password.ts <email> <newPassword>
 *
 * Example:
 *   npx ts-node scripts/reset-admin-password.ts manoranjini.periyasamy@c1exchange.com Admin@1234
 */
import * as bcrypt from 'bcrypt';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_vI4C1bWBzFXo@ep-proud-pond-ap17gyib-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error('Usage: npx ts-node scripts/reset-admin-password.ts <email> <newPassword>');
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Check account exists
    const { rows } = await client.query(
      'SELECT id, email, status, role FROM accounts WHERE email = $1 AND is_deleted = false',
      [email.toLowerCase()],
    );

    if (rows.length === 0) {
      console.error(`❌ No account found for email: ${email}`);
      process.exit(1);
    }

    const account = rows[0];
    console.log(`✅ Found account: ${account.email} | role=${account.role} | status=${account.status}`);

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update the password and ensure account is ACTIVE
    await client.query(
      `UPDATE accounts
         SET password_hash = $2,
             status = 'ACTIVE',
             is_active = true,
             email_verified = true,
             reset_password_token = NULL,
             reset_password_expires_at = NULL,
             updated_at = NOW()
       WHERE id = $1`,
      [account.id, passwordHash],
    );

    // Invalidate all sessions so old sessions don't linger
    const sessionRes = await client.query(
      'DELETE FROM sessions WHERE account_id = $1',
      [account.id],
    );

    console.log(`✅ Password updated successfully for ${account.email}`);
    console.log(`✅ Invalidated ${sessionRes.rowCount} existing session(s)`);
    console.log(`\n🔑 You can now log in with:`);
    console.log(`   Email:    ${account.email}`);
    console.log(`   Password: ${newPassword}`);
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error('❌ Script failed:', e.message);
  process.exit(1);
});
