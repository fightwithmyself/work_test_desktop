/**
 * 并发限制器:同一时刻最多运行 max 个任务,其余排队(先进先出)。
 *
 * 用途:一次导入几十个文件时,不要同时拉起几十个 ffprobe/ffmpeg 进程。
 * 任务抛异常不会影响队列里的其他任务,也不会占住名额。
 *
 * 实现要点:任务结束时,如果有人在排队,就把"名额"直接交给队首,active 保持不变;
 * 只有没人排队时才减少 active。若先减后加,中间到来的新任务可能抢先拿到名额,
 * 导致实际并发超过 max。
 */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`并发数必须是 >= 1 的整数,收到 ${max}`)
  }
  let active = 0
  const waiting: Array<() => void> = []

  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) {
      active += 1
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    try {
      return await task()
    } finally {
      release()
    }
  }
}
