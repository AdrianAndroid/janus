import { promises as fs } from 'fs'
import path from 'path'
import { app } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { ServerProfile } from '@shared/types'
import type { SSHManager } from '../ssh-manager'
import { DiskError } from '@shared/disk-usage'

/**
 * Remote execution adapter: runs the packaged Python helper through a fixed,
 * trusted bootstrap over a dedicated SSH exec channel. The helper source is
 * delivered base64-encoded in the stdin envelope; paths and options travel as
 * JSON data — never interpolated into shell or code.
 */

// Fixed bootstrap. Double quotes only (wrapped in single quotes for the shell).
// Reads the envelope from stdin, spawns a control thread for cancel/EOF,
// decodes and runs the helper's run(request, should_stop, emit).
const BOOTSTRAP = [
  'import sys, json, base64, threading',
  'def main():',
  '    env = json.loads(sys.stdin.buffer.readline().decode("utf-8"))',
  '    src = base64.b64decode(env["codeB64"]).decode("utf-8")',
  '    stop = threading.Event()',
  '    lock = threading.Lock()',
  '    def emit(obj):',
  '        with lock:',
  '            sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\\n")',
  '            sys.stdout.flush()',
  '    def control():',
  '        while True:',
  '            raw = sys.stdin.buffer.readline()',
  '            if not raw:',
  '                stop.set()',
  '                return',
  '            try:',
  '                msg = json.loads(raw.decode("utf-8"))',
  '                if msg.get("action") == "cancel":',
  '                    stop.set()',
  '            except Exception:',
  '                pass',
  '    threading.Thread(target=control, daemon=True).start()',
  '    ns = {}',
  '    exec(compile(src, "remote.py", "exec"), ns)',
  '    try:',
  '        ns["run"](env["request"], stop.is_set, emit)',
  '    except Exception as e:',
  '        emit({"type": "terminal", "state": "failed", "errorCode": "HELPER_ERROR", "error": str(e)})',
  'main()'
].join('\n')

const COMMAND = `python3 -u -c '${BOOTSTRAP}'`

export interface ExecHandle {
  stream: ClientChannel
  close: () => void
}

let helperSource: string | null = null

export async function loadHelperSource(): Promise<string> {
  if (helperSource) return helperSource
  const devPath = path.join(app.getAppPath(), 'resources', 'disk-usage', 'remote.py')
  const prodPath = path.join(process.resourcesPath ?? '', 'disk-usage', 'remote.py')
  try {
    helperSource = await fs.readFile(app.isPackaged ? prodPath : devPath, 'utf8')
  } catch (e) {
    throw new DiskError('PROTOCOL_ERROR', `Cannot load remote helper: ${(e as Error).message}`)
  }
  return helperSource
}

const pythonChecked = new Map<string, boolean>()

/** Verify Python 3.8+ on the server (cached per server id). Never installs. */
export async function ensurePython(ssh: SSHManager, profile: ServerProfile, jump: ServerProfile | null): Promise<void> {
  if (pythonChecked.get(profile.id)) return
  let stdout = ''
  try {
    const res = await ssh.exec(profile, 'python3 --version 2>&1', jump)
    stdout = res.stdout || res.stderr || ''
  } catch {
    throw new DiskError('PYTHON_UNAVAILABLE', 'Python 3.8 or later is required on this server')
  }
  const m = /Python (\d+)\.(\d+)/.exec(stdout)
  if (!m || Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 8)) {
    throw new DiskError('PYTHON_UNAVAILABLE', 'Python 3.8 or later is required on this server')
  }
  pythonChecked.set(profile.id, true)
}

/** Forget cached capability when a server profile is edited. */
export function forgetServer(serverId: string): void {
  pythonChecked.delete(serverId)
}

export async function openHelperChannel(
  ssh: SSHManager,
  profile: ServerProfile,
  jump: ServerProfile | null
): Promise<ExecHandle> {
  return ssh.openExecChannel(profile, COMMAND, jump)
}

export async function writeEnvelope(stream: ClientChannel, request: Record<string, unknown>): Promise<void> {
  const src = await loadHelperSource()
  const envelope = JSON.stringify({ version: 1, codeB64: Buffer.from(src, 'utf8').toString('base64'), request })
  stream.write(envelope + '\n')
}

export function writeCancel(stream: ClientChannel): void {
  try {
    stream.write(JSON.stringify({ action: 'cancel' }) + '\n')
  } catch {
    /* channel already gone */
  }
}
