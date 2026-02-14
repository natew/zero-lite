#!/usr/bin/env bun
/**
 * analyze orez logs
 *
 * usage:
 *   bun scripts/analyze-logs.ts [options]
 *
 * options:
 *   --dir <path>     log directory (default: .orez/logs)
 *   --source <name>  filter by source (zero, proxy, pglite, orez, s3)
 *   --level <level>  min level: error, warn, info, debug (default: warn)
 *   --last <n>       show last n lines (default: 50)
 *   --errors         shortcut for --level error
 *   --follow         follow mode (like tail -f)
 *   --grep <pattern> filter lines matching pattern
 */

import { readdirSync, readFileSync, statSync, watchFile } from 'fs'
import { join, basename } from 'path'

const args = process.argv.slice(2)

function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  return defaultVal
}

const hasFlag = (name: string) => args.includes(`--${name}`)

const logDir = getArg('dir', '.orez/logs')
const sourceFilter = getArg('source', '')
const levelFilter = hasFlag('errors') ? 'error' : getArg('level', 'warn')
const lastN = parseInt(getArg('last', '50'), 10)
const follow = hasFlag('follow')
const grepPattern = getArg('grep', '')

const LEVEL_PRIORITY: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const minPriority = LEVEL_PRIORITY[levelFilter] ?? 1

interface LogLine {
  ts: Date
  level: string
  source: string
  msg: string
  raw: string
}

function parseLogLine(line: string, source: string): LogLine | null {
  // format: [2026-02-14T00:39:33.123Z] [level] message
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s*\[(\w+)\]\s*(.*)$/)
  if (!match) return null
  return {
    ts: new Date(match[1]),
    level: match[2],
    source,
    msg: match[3],
    raw: line,
  }
}

function readLogs(): LogLine[] {
  const lines: LogLine[] = []

  try {
    const files = readdirSync(logDir).filter((f) => f.endsWith('.log') && !f.endsWith('.log.1'))

    for (const file of files) {
      const source = basename(file, '.log')
      if (sourceFilter && source !== sourceFilter) continue

      const content = readFileSync(join(logDir, file), 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        const parsed = parseLogLine(line, source)
        if (parsed) {
          if ((LEVEL_PRIORITY[parsed.level] ?? 3) <= minPriority) {
            if (!grepPattern || parsed.msg.includes(grepPattern)) {
              lines.push(parsed)
            }
          }
        }
      }
    }
  } catch (e) {
    console.error(`error reading logs from ${logDir}:`, e)
  }

  // sort by timestamp
  lines.sort((a, b) => a.ts.getTime() - b.ts.getTime())
  return lines
}

function formatLine(line: LogLine): string {
  const ts = line.ts.toISOString().slice(11, 23) // HH:MM:SS.mmm
  const levelColor =
    line.level === 'error' ? '\x1b[31m' : line.level === 'warn' ? '\x1b[33m' : '\x1b[2m'
  const reset = '\x1b[0m'
  return `${ts} ${levelColor}[${line.level.padEnd(5)}]${reset} \x1b[36m${line.source.padEnd(6)}${reset} ${line.msg}`
}

function showLogs() {
  const lines = readLogs()
  const toShow = lines.slice(-lastN)

  if (toShow.length === 0) {
    console.log(`no logs found in ${logDir} (level: ${levelFilter}, source: ${sourceFilter || 'all'})`)
    return
  }

  console.log(`\x1b[1m--- last ${toShow.length} logs (level: ${levelFilter}, source: ${sourceFilter || 'all'}) ---\x1b[0m\n`)

  for (const line of toShow) {
    console.log(formatLine(line))
  }
}

// summary mode
function showSummary() {
  const lines = readLogs()
  const bySource: Record<string, { errors: number; warns: number; total: number }> = {}

  for (const line of lines) {
    if (!bySource[line.source]) {
      bySource[line.source] = { errors: 0, warns: 0, total: 0 }
    }
    bySource[line.source].total++
    if (line.level === 'error') bySource[line.source].errors++
    if (line.level === 'warn') bySource[line.source].warns++
  }

  console.log('\n\x1b[1m--- log summary ---\x1b[0m\n')
  console.log('source     errors   warns    total')
  console.log('------     ------   -----    -----')
  for (const [source, counts] of Object.entries(bySource)) {
    const errColor = counts.errors > 0 ? '\x1b[31m' : ''
    const warnColor = counts.warns > 0 ? '\x1b[33m' : ''
    const reset = '\x1b[0m'
    console.log(
      `${source.padEnd(10)} ${errColor}${String(counts.errors).padStart(6)}${reset}   ${warnColor}${String(counts.warns).padStart(5)}${reset}    ${String(counts.total).padStart(5)}`
    )
  }
}

if (hasFlag('summary')) {
  showSummary()
} else {
  showLogs()
}

if (follow) {
  console.log('\n\x1b[2m--- following (ctrl+c to stop) ---\x1b[0m\n')
  let lastSize: Record<string, number> = {}

  setInterval(() => {
    try {
      const files = readdirSync(logDir).filter((f) => f.endsWith('.log') && !f.endsWith('.log.1'))
      for (const file of files) {
        const source = basename(file, '.log')
        if (sourceFilter && source !== sourceFilter) continue

        const path = join(logDir, file)
        const stat = statSync(path)
        const prevSize = lastSize[file] || stat.size

        if (stat.size > prevSize) {
          const content = readFileSync(path, 'utf-8')
          const newContent = content.slice(prevSize)
          for (const line of newContent.split('\n')) {
            if (!line.trim()) continue
            const parsed = parseLogLine(line, source)
            if (parsed && (LEVEL_PRIORITY[parsed.level] ?? 3) <= minPriority) {
              if (!grepPattern || parsed.msg.includes(grepPattern)) {
                console.log(formatLine(parsed))
              }
            }
          }
        }
        lastSize[file] = stat.size
      }
    } catch {}
  }, 500)
}
