import 'dotenv/config';
import { randomInt } from 'node:crypto';

import { resolveDbConfig } from '../storage/config.js';
import { openStores } from '../storage/factory.js';
import { hashPassword } from './passwords.js';

const PASSWORD_CHARSET = ['23456789', 'abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ'].join(
  '',
);

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
    await stores.state.close().catch(() => {
      void 0;
    });
    await stores.siem.close().catch(() => {
      void 0;
    });
  }
}

process.exitCode = await main();
