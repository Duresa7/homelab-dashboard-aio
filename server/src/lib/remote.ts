import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface RunRemoteOpts {
  mode: string;
  host?: string;
  user?: string;
  port?: number | string;
  keyPath?: string;

  jumpHost?: string;
  jumpUser?: string;
  jumpPort?: number | string;
  localCmd: string;
  localArgs?: string[];
  remoteCmd: string;
  timeoutMs?: number;
}

export async function runRemote({
  mode,
  host,
  user,
  port,
  keyPath,
  jumpHost,
  jumpUser,
  jumpPort,
  localCmd,
  localArgs,
  remoteCmd,
  timeoutMs = 8000,
}: RunRemoteOpts): Promise<string> {
  if (mode === 'local') {
    const { stdout } = await execFileP(localCmd, localArgs ?? [], { timeout: timeoutMs });
    return stdout;
  }
  const sshArgs = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=5',
    '-p',
    String(port),
  ];
  if (keyPath) sshArgs.push('-i', keyPath);
  if (jumpHost) {
    const jUser = jumpUser || user;
    const jPort = jumpPort != null && jumpPort !== '' ? `:${jumpPort}` : '';
    sshArgs.push('-J', `${jUser}@${jumpHost}${jPort}`);
  }
  sshArgs.push(`${user}@${host}`, remoteCmd);
  const { stdout } = await execFileP('ssh', sshArgs, { timeout: timeoutMs });
  return stdout;
}
