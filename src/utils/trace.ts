/* eslint-disable no-console */
import { broadcastLog, captureException, exceptionFromContext, getSentryLogger, logEvent } from './log'

export class Trace {
  private children: Trace[] = []
  private finished = false
  private startTime: Date
  private steps: { error?: true; msg: string; time: Date }[] = []
  private timeoutTimer: null | ReturnType<typeof setTimeout> = null

  constructor(
    public readonly traceId: string,
    public readonly label: string,
    private readonly noPrint = false,
    private readonly noBroadcast = false,
    private readonly depth = 0
  ) {
    this.startTime = new Date()
    logEvent({
      category: 'trace',
      context: { label: this.label, traceId: this.traceId },
      level: 'info',
      message: `Trace started: ${this.label}`,
    })
    getSentryLogger()?.info('Trace started', { label: this.label, traceId: this.traceId })
    this.timeoutTimer = setTimeout(() => {
      if (this.finished) return
      const lastStep = this.steps[this.steps.length - 1]
      this.fail('Trace exceeded 120s without completion', {
        elapsedMs: Date.now() - this.startTime.getTime(),
        label: this.label,
        lastStep: lastStep?.msg,
        lastStepAt: lastStep ? Trace.formatTime(lastStep.time) : undefined,
        stepCount: this.steps.length,
        traceId: this.traceId,
      })
    }, 120_000)
  }

  static formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const millis = date.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${millis}`
  }

  static readonly start = (label: string, noPrint = false, noBroadcast = false) => new Trace(Math.random().toString(16).slice(2, 6), label, noPrint, noBroadcast)

  caughtError(msg: string): false {
    this.steps.push({ error: true, msg, time: new Date() })
    logEvent({
      category: 'trace',
      context: { label: this.label, traceId: this.traceId },
      level: 'error',
      message: msg,
    })
    getSentryLogger()?.error(msg, { label: this.label, traceId: this.traceId })
    captureException(exceptionFromContext(msg, { label: this.label, traceId: this.traceId }))
    return false
  }

  child(label: string): Trace {
    const childTrace = new Trace(this.traceId, label, this.noPrint, this.noBroadcast, this.depth + 1)
    this.children.push(childTrace)
    return childTrace
  }

  fail(reason: string, context?: unknown): false {
    if (this.isRoot()) this.print(false, reason)
    this.finished = true
    if (context) console.log(context)
    logEvent({
      category: 'trace',
      context: { detail: context, label: this.label, traceId: this.traceId },
      level: 'error',
      message: reason,
    })
    getSentryLogger()?.error(reason, {
      context: context && typeof context === 'object' ? (context as Record<string, unknown>) : { context },
      label: this.label,
      traceId: this.traceId,
    })
    captureException(exceptionFromContext(reason, context))
    this.clearTimeoutTimer()
    if (!this.noBroadcast && this.isRoot()) broadcastLog('ERROR', reason, this.getFullTrace())
    return false
  }

  getFullTrace(indent = 0): string {
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000
    const symbol = this.finished ? '✓' : '✗'
    const prefix = indent === 0 ? '' : `${'│   '.repeat(indent - 1)  }┌ `
    const lines: string[] = []
    
    lines.push(`${prefix}${symbol} [${this.traceId}] ${this.label} (${elapsed.toFixed(1)}s)`)
    
    const stepPrefix = indent === 0 ? '    ' : '│   '.repeat(indent)
    let prevTime = this.startTime
    for (const step of this.steps) {
      const timeStr = Trace.formatTime(step.time)
      const marker = 'error' in step ? '[ERROR]' : '[DEBUG]'
      const deltaMs = step.time.getTime() - prevTime.getTime()
      lines.push(`${stepPrefix}${timeStr} +${deltaMs}ms ${marker} ${step.msg}`)
      prevTime = step.time
    }
    
    for (const child of this.children) {
      lines.push(child.getFullTrace(indent + 1))
    }
    
    return lines.join('\n')
  }

  silentFail(reason: string, context?: unknown): false {
    logEvent({
      category: 'trace',
      context: { detail: context, label: this.label, traceId: this.traceId },
      level: 'warning',
      message: reason,
    })
    this.finished = true
    this.clearTimeoutTimer()
    return false
  }

  softFail(reason: string, context?: unknown): false {
    if (this.isRoot()) this.print(false, reason)
    this.finished = true
    this.clearTimeoutTimer()
    if (context) console.log(context)
    logEvent({
      category: 'trace',
      context: { detail: context, label: this.label, traceId: this.traceId },
      level: 'warning',
      message: reason,
    })
    getSentryLogger()?.error(reason, {
      context: context && typeof context === 'object' ? (context as Record<string, unknown>) : { context },
      label: this.label,
      traceId: this.traceId,
    })
    return false
  }

  step(msg: string): void {
    this.steps.push({ msg, time: new Date() })
    logEvent({
      category: 'trace-step',
      context: { label: this.label, traceId: this.traceId },
      level: 'debug',
      message: msg,
    })
    getSentryLogger()?.debug(msg, { label: this.label, traceId: this.traceId })
  }

  success(): void {
    if (this.finished) console.error('Timed out trace completed')
    else this.finished = true
    this.clearTimeoutTimer()
    logEvent({
      category: 'trace',
      context: { label: this.label, traceId: this.traceId },
      level: 'info',
      message: `Trace succeeded: ${this.label}`,
    })
    getSentryLogger()?.info('Trace succeeded', { label: this.label, traceId: this.traceId })
    if (!this.noBroadcast && this.isRoot()) broadcastLog('INFO', this.label, this.getFullTrace())
    if (this.isRoot()) this.print(true)
  }

  private clearTimeoutTimer(): void {
    if (!this.timeoutTimer) return
    clearTimeout(this.timeoutTimer)
    this.timeoutTimer = null
  }

  private isRoot(): boolean {
    return this.depth === 0
  }

  private print(isSuccess: boolean, failReason?: string, indent = 0): void {
    if (this.noPrint) return
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000
    const symbol = isSuccess ? '✓' : '✗'
    const red = '\x1b[31m'
    const color = isSuccess ? '\x1b[32m' : red
    const reset = '\x1b[0m'
    const grey = '\x1b[90m'

    const prefix = indent === 0 ? '' : `${'│   '.repeat(indent - 1)  }┌ `
    const header = `${color}${symbol} [${this.traceId}] ${this.label} (${elapsed.toFixed(1)}s)${reset}`
    console.log(prefix + header)

    const stepPrefix = indent === 0 ? '    ' : '│   '.repeat(indent)
    let prevTime = this.startTime
    for (const step of this.steps) {
      const timeStr = Trace.formatTime(step.time)
      const deltaMs = step.time.getTime() - prevTime.getTime()
      console.log(`${'error' in step ? red : grey}${stepPrefix}${timeStr} +${deltaMs}ms ${step.msg}${reset}`)
      prevTime = step.time
    }

    for (const child of this.children) {
      const childSuccess = isSuccess && !failReason
      child.print(childSuccess, failReason, indent + 1)
    }

    if (indent > 0) {
      const closePrefix = `${'│   '.repeat(indent - 1)  }└ `
      if (!isSuccess && failReason) {
        console.log(`${closePrefix}${color}✗ Failed: ${failReason}${reset}`)
      }
    } else if (!isSuccess && failReason) console.log(`${grey}    ${color}✗ Failed: ${failReason}${reset}`)
  }
}
