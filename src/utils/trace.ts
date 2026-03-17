export class Trace {
  private steps: { time: Date; msg: string }[] = []
  private children: Trace[] = []
  private startTime: Date

  constructor(
    public readonly traceId: string,
    public readonly label: string,
  ) {
    this.startTime = new Date()
  }

  step(msg: string): void {
    this.steps.push({ time: new Date(), msg })
  }

  child(label: string): Trace {
    const childTrace = new Trace(this.traceId, label)
    this.children.push(childTrace)
    return childTrace
  }

  success(): void {
    this.print(true)
  }

  fail(reason: string): void {
    this.print(false, reason)
  }

  private print(isSuccess: boolean, failReason?: string, indent = 0): void {
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000
    const symbol = isSuccess ? '✓' : '✗'
    const color = isSuccess ? '\x1b[32m' : '\x1b[31m'
    const reset = '\x1b[0m'
    const grey = '\x1b[90m'

    const prefix = indent === 0 ? '' : '│   '.repeat(indent - 1) + '┌ '
    const header = `${color}${symbol} [${this.traceId}] ${this.label} (${elapsed.toFixed(1)}s)${reset}`
    console.log(prefix + header)

    const stepPrefix = indent === 0 ? '    ' : '│   '.repeat(indent)
    for (const step of this.steps) {
      const timeStr = this.formatTime(step.time)
      console.log(`${grey}${stepPrefix}${timeStr} ${step.msg}${reset}`)
    }

    for (const child of this.children) {
      const childSuccess = isSuccess && !failReason
      child.print(childSuccess, failReason, indent + 1)
    }

    if (indent > 0) {
      const closePrefix = '│   '.repeat(indent - 1) + '└ '
      if (!isSuccess && failReason) {
        console.log(`${closePrefix}${color}✗ Failed: ${failReason}${reset}`)
      }
    } else if (!isSuccess && failReason) {
      console.log(`${grey}    ${color}✗ Failed: ${failReason}${reset}`)
    }
  }

  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const millis = date.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${millis}`
  }

  static start(label: string): Trace {
    const traceId = Math.random().toString(16).slice(2, 6)
    return new Trace(traceId, label)
  }
}
