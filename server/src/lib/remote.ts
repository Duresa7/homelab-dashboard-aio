import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface RunRemoteOpts {
  /** 'local' runs via execFile; any other value runs over SSH. */
  mode: string;
  host?: string;
  user?: string;
  port?: number | string;
  keyPath?: string;
  localCmd: string;
  localArgs?: string[];
  remoteCmd: string;
  timeoutMs?: number;
}

/**
 * Run a command either locally (execFile) or over SSH, returning stdout.
 *
 * Shared by integrations that read metrics off a host box — the GPU
 * integration (`nvidia-smi`) and the sensors integration (`sensors -j`,
 * `lsblk -J`). Pulled out of index.js so both can share one primitive.
 */
export async function runRemote({
  mode,
  host,
  user,
  port,
  keyPath,
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
  sshArgs.push(`${user}@${host}`, remoteCmd);
  const { stdout } = await execFileP('ssh', sshArgs, { timeout: timeoutMs });
  return stdout;
}
