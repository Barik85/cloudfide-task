// Pure decision logic of the PreToolUse guard. Returns a reason string to block, or null to allow.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { ALLOWED_PATCH_PATHS } from './lib.mjs'

const RUN_TESTS = /^bash \.github\/test-agent\/scripts\/run-tests\.sh (test|typecheck|format) (frontend|backend)((?: [A-Za-z0-9_./-]+)*)$/
const READ_DENY = [/^\.env(\..*)?$/, /(^|\/)\.env(\..*)?$/, /^\.git\/config$/, /^\.git\/.*credentials/]

/** Resolve a path (following symlinks where it exists) and return it relative to root, or null if outside. */
function relativeInside(file, root) {
  let resolved = path.resolve(root, file)
  try { resolved = realpathSync(resolved) } catch {
    try { resolved = path.join(realpathSync(path.dirname(resolved)), path.basename(resolved)) } catch { /* new dir */ }
  }
  const relative = path.relative(root, resolved)
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : relative.split(path.sep).join('/')
}

export function decideToolUse(tool, input, root) {
  switch (tool) {
    case 'Bash': {
      const command = String(input.command ?? '').trim()
      const match = RUN_TESTS.exec(command)
      if (!match) return 'the only permitted command is `bash .github/test-agent/scripts/run-tests.sh <test|typecheck|format> <frontend|backend> [test files]`. Use Read/Glob/Grep to inspect files.'
      const files = match[3].trim().split(' ').filter(Boolean)
      if (files.some((f) => f.includes('..') || !f.startsWith(`${match[2]}/`))) return 'test file arguments must be repo-relative paths inside the selected project.'
      return null
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const relative = relativeInside(String(input.file_path ?? input.notebook_path ?? ''), root)
      if (!relative || !ALLOWED_PATCH_PATHS.some((re) => re.test(relative))) {
        return `only test files may be written (backend/tests/**, frontend/src/**/*.test.ts(x), frontend/src/test/**); got ${relative ?? 'a path outside the repository'}.`
      }
      return null
    }
    case 'Read':
    case 'Glob':
    case 'Grep': {
      const target = input.file_path ?? input.path
      if (target === undefined || target === '') return null // defaults to the working directory
      const relative = relativeInside(String(target), root)
      if (relative === null) return 'reading outside the repository is not allowed.'
      if (READ_DENY.some((re) => re.test(relative))) return 'this file may contain credentials.'
      return null
    }
    case 'Skill':
    case 'TodoWrite':
    case 'StructuredOutput':
      return null
    default:
      return `tool ${tool} is not available to unit-test-agent.`
  }
}
