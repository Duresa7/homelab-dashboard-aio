// Offline account rescue/seeding CLI — talks straight to the configured
// database, no HTTP. Used to bootstrap an existing install without the wizard
// and to recover a locked-out admin:
//
//   npm run user:seed-admin            create "admin" with a random password
//   npm run user:reset-password -- <username>   set a new random password
//
// Passwords are generated, printed exactly once, and never stored in plaintext.
import 'dotenv/config';
import { randomInt } from 'node:crypto';

import { resolveDbConfig } from '../storage/config.js';
import { openStores } from '../storage/factory.js';
import { hashPassword } from './passwords.js';

// Unambiguous charset (no 0/O/1/l/I) — 24 chars ≈ 117 bits of entropy.
// Not a secret, just an alphabet; the scanner's entropy rule can't tell.
const PASSWORD_CHARSET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'; // gitleaks:allow

function generatePassword(length = 24): string {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARSET[randomInt(PASSWORD_CHARSET.length)];
  return out;
}

async function main(): Promise<number> {
  const [, , command, arg] = process.argv;

  if (command !== 'seed-admin' && command !== 'reset-password') {
    console.error('Usage:');
    console.error('  npm run user:seed-admin');
    console.error('  npm run user:reset-password -- <username>');
    return 2;
  }

  const config = resolveDbConfig();
  const stores = await openStores(config);

  try {
    if (command === 'seed-admin') {
      if ((await stores.auth.countUsers()) > 0) {
        console.error('Users already exist — refusing to seed. Use user:reset-password instead.');
        return 1;
      }
      const password = generatePassword();
      await stores.auth.createUser({
        username: 'admin',
        displayName: 'Admin',
        email: null,
        passwordHash: await hashPassword(password),
        role: 'admin',
      });
      console.log('Created admin account:');
      console.log('  username: admin');
      console.log(`  password: ${password}`);
      console.log('This password is shown once — change it after logging in (Settings → Account).');
      return 0;
    }

    // reset-password
    const username = (arg ?? '').trim().toLowerCase();
    if (!username) {
      console.error('Usage: npm run user:reset-password -- <username>');
      return 2;
    }
    const user = await stores.auth.getUserByUsername(username);
    if (!user) {
      console.error(`No user named "${username}".`);
      return 1;
    }
    const password = generatePassword();
    await stores.auth.updateUser(user.id, { passwordHash: await hashPassword(password) });
    await stores.auth.deleteSessionsForUser(user.id);
    console.log(`Reset password for "${username}" (all sessions revoked):`);
    console.log(`  password: ${password}`);
    console.log('This password is shown once — change it after logging in (Settings → Account).');
    return 0;
  } finally {
    await stores.state.close().catch(() => {});
    await stores.siem.close().catch(() => {});
  }
}

process.exitCode = await main();
