#!/usr/bin/env node
// Viewer unit tests: extension routing, magic sniffing, binary detection,
// GB18030 fallback decoding — the "never open what we can't handle" guards.
// Run: node scripts/test-viewer.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = mkdtempSync(path.join(tmpdir(), 'janus-viewer-test-'))
let passed = 0
let failed = 0
function ok(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

execFileSync(
  path.join(root, 'node_modules', '.bin', 'esbuild'),
  [
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--alias:@shared=${path.join(root, 'src/shared')}`,
    `--outfile=${path.join(outDir, 'viewer.mjs')}`,
    path.join(root, 'src/shared/viewer.ts')
  ],
  { stdio: 'pipe' }
)
const { viewerFor, sniffMatches, looksBinary, decodeText, extOf } = await import(path.join(outDir, 'viewer.mjs'))

const bytes = (arr) => new Uint8Array(arr)
const str = (s) => new TextEncoder().encode(s)

console.log('[viewer] extension routing (whitelist)')
{
  ok('pdf/docx/xlsx route', viewerFor('a.pdf') === 'pdf' && viewerFor('b.docx') === 'docx' && viewerFor('c.xlsx') === 'xlsx')
  ok('xls/csv route to xlsx', viewerFor('a.xls') === 'xlsx' && viewerFor('b.csv') === 'xlsx')
  ok('images route', viewerFor('a.JPG') === 'image' && viewerFor('b.svg') === 'image')
  ok('text route incl. logs/conf/code', viewerFor('a.log') === 'text' && viewerFor('b.conf') === 'text' && viewerFor('c.py') === 'text')
  ok('extensionless README/Makefile route to text', viewerFor('README') === 'text' && viewerFor('Makefile') === 'text')
  ok('legacy office unsupported', viewerFor('a.doc') === 'unsupported' && viewerFor('b.pptx') === 'unsupported')
  ok('unknown types unsupported', viewerFor('a.xyz123') === 'unsupported' && viewerFor('noext') === 'unsupported')
  ok('extOf lowercase', extOf('A.PDF') === '.pdf')
}

console.log('[viewer] magic sniffing (fake-extension rejection)')
{
  ok('real pdf head accepted', sniffMatches('pdf', str('%PDF-1.7 junk')))
  ok('fake pdf (text bytes) rejected', !sniffMatches('pdf', str('hello world this is not pdf')))
  ok('zip container accepted for docx/xlsx', sniffMatches('docx', bytes([0x50, 0x4b, 0x03, 0x04, 1, 2])) && sniffMatches('xlsx', bytes([0x50, 0x4b, 0x03, 0x04])))
  ok('non-zip docx rejected', !sniffMatches('docx', str('not a zip file at all')))
  ok('png/jpeg/gif/webp/bmp heads', sniffMatches('image', bytes([0x89, 0x50, 0x4e, 0x47])) && sniffMatches('image', bytes([0xff, 0xd8, 0xff, 0xe0])) && sniffMatches('image', str('GIF89a')) && sniffMatches('image', str('RIFF') && bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])) && sniffMatches('image', str('BM')))
  ok('random bytes rejected as image', !sniffMatches('image', str('%PDF-1.4')))
}

console.log('[viewer] binary / text detection')
{
  ok('NUL byte means binary', looksBinary(bytes([0x41, 0x00, 0x42])))
  ok('plain utf-8 text not binary', !looksBinary(str('hello 你好 world\nline2')))
  ok('empty sample not binary', !looksBinary(bytes([])))
  ok('text kind sniff rejects binary', !sniffMatches('text', bytes([0x7f, 0x45, 0x4c, 0x46, 0x00])))
  ok('text kind sniff accepts text', sniffMatches('text', str('#!/bin/bash\necho hi')))
}

console.log('[viewer] encoding fallback (GBK legacy files)')
{
  const utf = decodeText(str('hello 你好'))
  ok('utf-8 fast path', utf.encoding === 'utf-8' && utf.text.includes('你好'))
  // GBK-encoded "你好中文" bytes (gb2312/gb18030 encoding of 你好 = C4E3 BAC3, 中文 = D6D0 CEC4)
  const gbkBytes = bytes([0xc4, 0xe3, 0xba, 0xc3, 0xd6, 0xd0, 0xce, 0xc4])
  const gbk = decodeText(gbkBytes)
  ok('gb18030 fallback on invalid utf-8', gbk.encoding === 'gb18030' && gbk.text === '你好中文', gbk.text)
}

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
