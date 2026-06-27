import { DatabaseService } from './src/database/database.service';
import * as bcrypt from 'bcrypt';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';

async function run() {
  console.log('Starting Nest application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const db = app.get(DatabaseService);

  const oldEmail = 'manoranjini.periysamy@c1exchange.com';
  const newEmail = 'manoranjini.periyasamy@c1exchange.com';
  const newPassword = 'Admin@123';
  
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Check if new email already exists
  const existing = await db.queryOne('SELECT id FROM accounts WHERE email = $1', [newEmail]);
  if (existing) {
    console.log(`Email ${newEmail} already exists. Updating password.`);
    await db.query('UPDATE accounts SET password_hash = $1, role = $2 WHERE email = $3', [passwordHash, 'ADMIN', newEmail]);
  } else {
    // If old email exists, just update its email and password
    const oldAccount = await db.queryOne('SELECT id FROM accounts WHERE email = $1', [oldEmail]);
    if (oldAccount) {
      console.log(`Found old account. Updating email and password.`);
      await db.query('UPDATE accounts SET email = $1, password_hash = $2, role = $3 WHERE email = $4', [newEmail, passwordHash, 'ADMIN', oldEmail]);
    } else {
      console.log(`Neither old nor new account found. Creating new admin.`);
      await db.query(`
        INSERT INTO accounts (email, display_name, password_hash, role, status, email_verified, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [newEmail, 'Admin User', passwordHash, 'ADMIN', 'ACTIVE', true, true]);
    }
  }

  // Delete the old one if it still exists
  await db.query('DELETE FROM accounts WHERE email = $1', [oldEmail]);

  console.log('Done!');
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
