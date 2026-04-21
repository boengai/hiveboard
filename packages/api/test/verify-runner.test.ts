import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVerificationCommand } from '../src/orchestrator/verify'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'hb-verify-ws-'))
}

describe('runVerificationCommand', () => {
  it('captures exit_code=0 and the command output on success', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      { label: 'echo', run: "echo 'hello-stdout'", timeout_ms: 10_000 },
      ws,
    )
    expect(rec.exit_code).toBe(0)
    expect(rec.output).toContain('hello-stdout')
    expect(rec.label).toBe('echo')
    expect(rec.command).toBe("echo 'hello-stdout'")
    expect(rec.started_at).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(rec.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}/)
    rmSync(ws, { force: true, recursive: true })
  })

  it('captures non-zero exit code', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      { label: 'fail', run: 'exit 17', timeout_ms: 10_000 },
      ws,
    )
    expect(rec.exit_code).toBe(17)
    rmSync(ws, { force: true, recursive: true })
  })

  it('merges stdout and stderr into output', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      {
        label: 'both',
        run: "printf 'OUT\\n' && printf 'ERR\\n' 1>&2",
        timeout_ms: 10_000,
      },
      ws,
    )
    expect(rec.output).toContain('OUT')
    expect(rec.output).toContain('ERR')
    rmSync(ws, { force: true, recursive: true })
  })

  it('truncates to last 200 lines', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      {
        label: 'many',
        run: 'seq 1 300',
        timeout_ms: 10_000,
      },
      ws,
    )
    const lines = rec.output.split('\n').filter((l) => l.length > 0)
    expect(lines.length).toBeLessThanOrEqual(200)
    expect(lines[lines.length - 1]).toBe('300')
    rmSync(ws, { force: true, recursive: true })
  })

  it('kills on timeout and records exit_code=-1', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      { label: 'sleepy', run: 'sleep 5', timeout_ms: 200 },
      ws,
    )
    expect(rec.exit_code).toBe(-1)
    rmSync(ws, { force: true, recursive: true })
  })

  it('uses the provided workspace as cwd', async () => {
    const ws = workspace()
    const rec = await runVerificationCommand(
      { label: 'pwd', run: 'pwd', timeout_ms: 10_000 },
      ws,
    )
    const base = ws.split('/').pop()!
    expect(rec.output).toContain(base)
    rmSync(ws, { force: true, recursive: true })
  })

  it('propagates HIVEBOARD_* vars are NOT leaked into the command', async () => {
    const ws = workspace()
    process.env.HIVEBOARD_SCRATCHPAD = '/should/not/appear'
    const rec = await runVerificationCommand(
      {
        label: 'env',
        run: 'echo "SP=${HIVEBOARD_SCRATCHPAD:-unset}"',
        timeout_ms: 10_000,
      },
      ws,
    )
    expect(rec.output).toContain('SP=unset')
    delete process.env.HIVEBOARD_SCRATCHPAD
    rmSync(ws, { force: true, recursive: true })
  })
})
