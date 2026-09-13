// File viewer — shared routing & safety contracts (no Node/Electron imports).

export type ViewerKind = 'pdf' | 'docx' | 'xlsx' | 'text' | 'image' | 'unsupported'

const PDF_EXT = ['.pdf'] as const
const DOCX_EXT = ['.docx'] as const
const XLSX_EXT = ['.xlsx', '.xls', '.csv'] as const
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'] as const
const TEXT_EXT = [
  '.txt', '.md', '.markdown', '.log', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg',
  '.properties', '.env', '.sh', '.bash', '.zsh', '.py', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less',
  '.html', '.htm', '.sql', '.c', '.h', '.cpp', '.hpp', '.cc', '.java', '.go', '.rs', '.rb', '.php', '.swift',
  '.kt', '.vim', '.lua', '.pl', '.r', '.dockerfile', '.gitignore', '.editorconfig', '.service', '.desktop'
] as const
/** Explicitly known-but-unsupported (message differs from unknown types). */
const KNOWN_UNSUPPORTED_EXT = ['.doc', '.ppt', '.pptx'] as const

export const VIEWER_LIMITS = {
  textMaxBytes: 10 * 1024 * 1024,
  textPreviewBytes: 2 * 1024 * 1024,
  imageMaxBytes: 100 * 1024 * 1024,
  officeMaxBytes: 50 * 1024 * 1024,
  xlsxMaxRows: 1000,
  textBinarySampleBytes: 8192,
  parseTimeoutMs: 30_000
} as const

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** Extension whitelist routing. Unknown and known-unsupported both map to 'unsupported'. */
export function viewerFor(name: string): ViewerKind {
  const ext = extOf(name)
  if (!ext) return isLikelyTextName(name) ? 'text' : 'unsupported'
  if ((PDF_EXT as readonly string[]).includes(ext)) return 'pdf'
  if ((DOCX_EXT as readonly string[]).includes(ext)) return 'docx'
  if ((XLSX_EXT as readonly string[]).includes(ext)) return 'xlsx'
  if ((IMAGE_EXT as readonly string[]).includes(ext)) return 'image'
  if ((TEXT_EXT as readonly string[]).includes(ext)) return 'text'
  return 'unsupported'
}

export function isKnownUnsupported(name: string): boolean {
  return (KNOWN_UNSUPPORTED_EXT as readonly string[]).includes(extOf(name))
}

/** Filenames vim users open without an extension: treat as text. */
export function isLikelyTextName(name: string): boolean {
  const ext = extOf(name)
  if (ext) return false
  const base = name.toLowerCase()
  return ['readme', 'license', 'licence', 'changelog', 'authors', 'contributors', 'makefile', 'dockerfile', 'gemfile', 'rakefile', 'vagrantfile', 'procfile'].includes(base)
}

// ---- Magic sniffing (pure, testable) ----

function startsWith(head: Uint8Array, bytes: number[]): boolean {
  if (head.length < bytes.length) return false
  return bytes.every((b, i) => head[i] === b)
}

/** Verify file head matches the claimed viewer kind. 'text' uses NUL sampling. */
export function sniffMatches(kind: ViewerKind, head: Uint8Array): boolean {
  switch (kind) {
    case 'pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    case 'docx':
    case 'xlsx':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]) // PK zip (incl. empty zip)
    case 'image':
      return (
        startsWith(head, [0x89, 0x50, 0x4e, 0x47]) || // PNG
        startsWith(head, [0xff, 0xd8, 0xff]) || // JPEG
        startsWith(head, [0x47, 0x49, 0x46, 0x38]) || // GIF8
        startsWith(head, [0x42, 0x4d]) || // BMP
        (head.length >= 12 && startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) // RIFF+WEBP
      )
    case 'text':
      return !looksBinary(head)
    default:
      return false
  }
}

/** Binary heuristic: NUL byte in the sample means not text. */
export function looksBinary(sample: Uint8Array): boolean {
  return sample.includes(0)
}

// ---- Text decoding (pure, testable) ----

export type DetectedEncoding = 'utf-8' | 'gb18030'

/** Strict UTF-8 first; GB18030 fallback for legacy Chinese text files. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: DetectedEncoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' }
  }
}

export interface ViewerContextPayload {
  title: string
  serverId?: string
  path: string
  kind: ViewerKind
}

export interface ViewerProgressReq {
  key: string
  page: number
}
