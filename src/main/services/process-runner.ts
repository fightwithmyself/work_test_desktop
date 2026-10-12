import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { createLineSplitter } from '../../core/line-splitter'

/**
 * 子进程运行器。所有对 ffmpeg / ffprobe 的调用都经过这里。
 *
 * 安全约束:
 * - 只接受"可执行文件 + 参数数组",内部固定 shell:false,参数不会被 shell 解释,
 *   所以文件名里的空格、引号、& | > $ 等字符不会造成命令注入
 * - windowsHide:true,不会弹出黑色控制台窗口
 */

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 超过这个时间还没结束就杀掉整棵进程树,结果里 timedOut 为 true */
  timeoutMs?: number
  /** 外部取消信号,效果等同于调用 cancel() */
  signal?: AbortSignal
  /** 'pipe' 时才能调用 writeStdin(例如向 ffmpeg 发送 q 让它优雅退出)。默认 'ignore' */
  stdin?: 'ignore' | 'pipe'
  /** 'text' 收集为字符串;'buffer' 收集为二进制(取缩略图);'discard' 不收集。默认 'text' */
  stdout?: 'text' | 'buffer' | 'discard'
  /** stdout / 二进制收集的上限,超出部分丢弃。默认 16 MB */
  maxStdoutBytes?: number
  /** stderr 只保留末尾这么多字符(ffmpeg 的报错在最后)。默认 64 KB */
  stderrTailChars?: number
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface RunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stdoutBuffer: Buffer | null
  stderr: string
  timedOut: boolean
  canceled: boolean
  elapsedMs: number
}

export interface RunningProcess {
  pid: number | undefined
  result: Promise<RunResult>
  /** 杀掉整棵进程树。进程已结束时什么都不做。 */
  cancel(): Promise<void>
  /** 需要 stdin: 'pipe'。返回是否写入成功。 */
  writeStdin(data: string): boolean
}

/** 进程根本没能启动(可执行文件不存在、没有执行权限等)。 */
export class SpawnError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'SpawnError'
    this.code = code
  }
}

const DEFAULT_MAX_STDOUT = 16 * 1024 * 1024
const DEFAULT_STDERR_TAIL = 64 * 1024

/** 当前所有存活的子进程,用于应用退出时统一清理。 */
const live = new Set<ChildProcess>()

export function runningProcessCount(): number {
  return live.size
}

/**
 * 杀掉进程树。Windows 上 child.kill() 只会杀直接子进程,孙进程会变成孤儿继续占 CPU,
 * 所以必须用 taskkill /T 连同后代一起结束。进程已不存在时静默返回。
 */
export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.once('error', () => resolve())
      killer.once('close', () => resolve())
    } else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 进程已经不存在
      }
      resolve()
    }
  })
}

/** 应用退出前调用:结束所有还在运行的子进程。 */
export async function killAllRunning(): Promise<void> {
  const pids = [...live].map((c) => c.pid).filter((p): p is number => p !== undefined)
  await Promise.all(pids.map((pid) => killProcessTree(pid)))
}

export function runProcess(
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): RunningProcess {
  const startedAt = Date.now()
  const stdoutMode = options.stdout ?? 'text'
  const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT
  const stderrTail = options.stderrTailChars ?? DEFAULT_STDERR_TAIL

  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false, // 明确写出来:永远不经过 shell
    windowsHide: true,
    stdio: [options.stdin ?? 'ignore', 'pipe', 'pipe']
  })
  live.add(child)

  let timedOut = false
  let canceled = false
  let timer: NodeJS.Timeout | undefined

  const cancel = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
    canceled = true
    await killProcessTree(child.pid)
  }

  if (options.timeoutMs !== undefined) {
    timer = setTimeout(() => {
      if (child.pid === undefined) return
      timedOut = true
      void killProcessTree(child.pid)
    }, options.timeoutMs)
  }

  const onAbort = (): void => void cancel()
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  // ---- 输出收集 ----
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  const stdoutLines = createLineSplitter((l) => options.onStdoutLine?.(l))
  const stderrLines = createLineSplitter((l) => options.onStderrLine?.(l))
  let stdoutText = ''
  const stdoutChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrText = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutMode === 'buffer') {
      if (stdoutBytes < maxStdout) {
        stdoutChunks.push(chunk)
        stdoutBytes += chunk.length
      }
      return
    }
    const text = stdoutDecoder.write(chunk)
    stdoutLines.push(text)
    if (stdoutMode === 'text' && stdoutText.length < maxStdout) stdoutText += text
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = stderrDecoder.write(chunk)
    stderrLines.push(text)
    stderrText += text
    if (stderrText.length > stderrTail * 2) stderrText = stderrText.slice(-stderrTail)
  })

  // 对端提前退出时写 stdin 会触发 EPIPE,不应该让它变成未捕获异常
  child.stdin?.on('error', () => {})

  const result = new Promise<RunResult>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      live.delete(child)
    }

    child.once('error', (err: NodeJS.ErrnoException) => {
      // 没有 pid 说明根本没启动成功
      if (child.pid !== undefined || settled) return
      settled = true
      cleanup()
      reject(new SpawnError(`无法启动 ${file}: ${err.message}`, err.code ?? 'UNKNOWN'))
    })

    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      cleanup()
      // 冲刷解码器里残留的半个多字节字符,再冲刷最后一行(没有换行符结尾的那行)
      const stdoutRest = stdoutDecoder.end()
      if (stdoutRest !== '' && stdoutMode !== 'buffer') {
        stdoutLines.push(stdoutRest)
        if (stdoutMode === 'text') stdoutText += stdoutRest
      }
      const stderrRest = stderrDecoder.end()
      if (stderrRest !== '') {
        stderrLines.push(stderrRest)
        stderrText += stderrRest
      }
      stdoutLines.flush()
      stderrLines.flush()
      resolve({
        exitCode,
        signal,
        stdout: stdoutText,
        stdoutBuffer: stdoutMode === 'buffer' ? Buffer.concat(stdoutChunks) : null,
        stderr: stderrText.slice(-stderrTail),
        timedOut,
        canceled,
        elapsedMs: Date.now() - startedAt
      })
    })
  })

  return {
    pid: child.pid,
    result,
    cancel,
    writeStdin(data: string): boolean {
      if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) return false
      return child.stdin.write(data)
    }
  }
}
