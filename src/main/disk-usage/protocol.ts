import { StringDecoder } from 'string_decoder'
import { DISK_LIMITS } from '@shared/disk-usage'

/**
 * Streaming NDJSON parser for the remote helper protocol. Handles arbitrary
 * SSH chunk boundaries (incl. multi-byte UTF-8 splits), enforces a per-line
 * size cap and rejects malformed JSON immediately.
 */
export class NdjsonParser {
  private decoder = new StringDecoder('utf8')
  private buf = ''

  constructor(
    private onLine: (msg: Record<string, unknown>) => void,
    private onError: (err: Error) => void,
    private maxLineBytes: number = DISK_LIMITS.maxLineBytes
  ) {}

  push(chunk: Uint8Array): void {
    const text = this.decoder.write(chunk as Buffer)
    this.buf += text
    if (Buffer.byteLength(this.buf, 'utf8') > this.maxLineBytes && !this.buf.includes('\n')) {
      this.onError(new Error('PROTOCOL_ERROR: line too long'))
      return
    }
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      if (!line.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        this.onError(new Error('PROTOCOL_ERROR: malformed JSON line'))
        return
      }
      this.onLine(msg)
    }
  }

  /** Flush at EOF. A non-empty remainder means a truncated final line. */
  end(): void {
    this.buf += this.decoder.end()
    if (this.buf.trim()) {
      try {
        this.onLine(JSON.parse(this.buf) as Record<string, unknown>)
        this.buf = ''
      } catch {
        this.onError(new Error('PROTOCOL_ERROR: truncated final line'))
      }
    }
  }
}
