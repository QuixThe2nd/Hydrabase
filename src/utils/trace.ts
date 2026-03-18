/* eslint-disable no-console */
export class Trace {
  private children: Trace[] = []
  private finished = false
  private startTime: Date
  private steps: { error?: true; msg: string; time: Date; }[] = []

  constructor(
    public readonly traceId: string,
    public readonly label: string,
    private readonly noPrint = false
  ) {
    this.startTime = new Date()
    setTimeout(() => {
      if (!this.finished) this.fail('Trace took over 5m')
    }, 120_000)
  }

  static formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const millis = date.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${millis}`
  }

  static start(label: string, noPrint = false): Trace {
    const traceId = Math.random().toString(16).slice(2, 6)
    return new Trace(traceId, label, noPrint)
  }

  caughtError(msg: string): false {
    this.steps.push({ error: true, msg, time: new Date() })
    return false
  }

  child(label: string): Trace {
    const childTrace = new Trace(this.traceId, label)
    this.children.push(childTrace)
    return childTrace
  }

  fail(reason: string, context?: unknown): false {
    this.print(false, reason)
    this.finished = true
    if (context) console.log(context)
    return false
  }

  step(msg: string): void {
    this.steps.push({ msg, time: new Date() })
  }

  success(): void {
    if (this.finished) console.error('Timed out trace completed')
    else this.finished = true
    this.print(true)
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
    for (const step of this.steps) {
      const timeStr = Trace.formatTime(step.time)
      console.log(`${'error' in step ? red : grey}${stepPrefix}${timeStr} ${step.msg}${reset}`)
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
    } else if (!isSuccess && failReason) {
      console.log(`${grey}    ${color}✗ Failed: ${failReason}${reset}`)
    }
  }
}
