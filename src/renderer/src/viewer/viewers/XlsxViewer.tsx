import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import type { ViewerContextPayload } from '@shared/viewer'
import { extOf, sniffMatches, VIEWER_LIMITS } from '@shared/viewer'
import { fetchAll, fmtBytes, mediaUrl, ViewError, withTimeout } from '../lib'
import { LoadGuard } from '../main'

type Row = (string | number | boolean | null)[]

interface SheetData {
  name: string
  rows: Row[]
  totalRows: number
}

export default function XlsxViewer({ ctx }: { ctx: ViewerContextPayload }): JSX.Element {
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(0)
  const isCsv = extOf(ctx.path) === '.csv'

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const url = mediaUrl(ctx.serverId, ctx.path)
        const { bytes, totalSize, truncated } = await fetchAll(url, VIEWER_LIMITS.officeMaxBytes, 0)
        if (disposed) return
        if (truncated) {
          throw new ViewError(`File is too large to preview (${fmtBytes(totalSize)}, limit ${fmtBytes(VIEWER_LIMITS.officeMaxBytes)}). Download and open it locally instead.`, 'TOO_BIG')
        }
        if (!isCsv && !sniffMatches('xlsx', bytes.subarray(0, 16))) {
          throw new ViewError('Not a valid Excel (zip) package — the file may be corrupted or mis-named.')
        }
        const wb = (await withTimeout(
          Promise.resolve(XLSX.read(bytes, { type: 'array' })),
          VIEWER_LIMITS.parseTimeoutMs,
          'Spreadsheet parsing'
        )) as XLSX.WorkBook
        const out: SheetData[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name]
          const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: false, defval: '' })
          return { name, rows: rows.slice(0, VIEWER_LIMITS.xlsxMaxRows), totalRows: rows.length }
        })
        if (!disposed) {
          setSheets(out)
          setSize(totalSize)
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
    }
  }, [ctx.serverId, ctx.path, isCsv])

  const sheet = sheets?.[active]

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-ink-700 px-3 py-1 text-[11px] text-slate-500">
        {sheets ? `${fmtBytes(size)} · ${sheets.length} sheet(s)` : ''}
        {sheet && sheet.totalRows > VIEWER_LIMITS.xlsxMaxRows ? ` · showing first ${VIEWER_LIMITS.xlsxMaxRows} of ${sheet.totalRows} rows` : ''}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <LoadGuard checking={!sheets && !error} error={error}>
          {sheet && (
            <table className="w-full border-collapse text-xs">
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? 'sticky top-0 bg-ink-800 font-medium text-slate-300' : ri % 2 ? 'bg-ink-800/40' : ''}>
                    <td className="w-10 border border-ink-700/50 px-1.5 py-0.5 text-right font-mono text-[10px] text-slate-600">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="max-w-[260px] truncate border border-ink-700/50 px-2 py-0.5 text-slate-300" title={String(cell ?? '')}>
                        {cell === null ? '' : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sheet && sheet.rows.length === 0 && <div className="py-10 text-center text-xs text-slate-500">Empty sheet.</div>}
        </LoadGuard>
      </div>
      {sheets && sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-ink-700 bg-ink-800 px-2 py-1">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${i === active ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
