/**
 * 把字节流按行切开的小工具。进程输出是按任意大小的块到达的,一行可能被切成两半,
 * 也可能一个块里有好几行,所以不能直接按 chunk 当行用。
 *
 * - 行结束符支持 \n、\r\n、单独的 \r(ffmpeg 的统计行用 \r 刷新)
 * - 块边界落在 "\r" 与 "\n" 之间时,按一个 \r\n 处理,不会多出一个空行
 */
export interface LineSplitter {
  push(chunk: string): void
  /** 输出末尾没有换行符的最后一行。流结束时必须调用。 */
  flush(): void
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let pending = ''

  return {
    push(chunk: string): void {
      const text = pending + chunk
      // 末尾的 \r 可能是 \r\n 的前半截,先留着等下一块
      const endsWithCR = text.endsWith('\r')
      const body = endsWithCR ? text.slice(0, -1) : text
      const parts = body.split(/\r\n|\n|\r/)
      const last = parts.pop() ?? ''
      for (const line of parts) onLine(line)
      pending = endsWithCR ? last + '\r' : last
    },
    flush(): void {
      const rest = pending.endsWith('\r') ? pending.slice(0, -1) : pending
      pending = ''
      if (rest !== '') onLine(rest)
    }
  }
}
