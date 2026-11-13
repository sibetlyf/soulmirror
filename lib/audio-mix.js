/**
 * 双路采集的混音核心：把「环回」和「麦克风」两路 PCM 按字节偏移对齐后相加。
 *
 * 为什么需要这个模块：会议客户端**不会**把自己的麦克风声音再输出到扬声器
 * （否则参会的人会听到自己的回声），所以只采环回时转写里只有"别人的声音"，
 * 用户自己的发言根本不在里面。要补上它，只能同时采麦克风，再把两路混成一路送识别。
 *
 * 设计约束（见 AGENTS.md）：
 *   - 纯函数 / 纯状态：没有 IO、没有 timer、没有 spawn，单测可以直接调用；
 *   - 两路格式统一为 16k / 单声道 / 16bit（mbridge capture-stream 已重采样成这样）；
 *   - 任何"丢数据 / 一路中断"都留下计数，不能静默。
 */

export const SAMPLE_BYTES = 2
/** 16k 单声道 16bit ≈ 32 字节/毫秒（session.js 的静音累计也用它） */
export const BYTES_PER_MS = 32

/**
 * 归一化为 Buffer。null/undefined 当作"这一路没有数据"（空数组），
 * 其它类型直接抛错：形状错了必须炸出来，不能当静音混过去。
 */
function asPcm(x, label) {
  if (x == null) return Buffer.alloc(0)
  if (Buffer.isBuffer(x)) return x
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength)
  throw new TypeError(label + ' 必须是 Buffer 或 Uint8Array，实际是 ' + typeof x)
}

/** 不做饱和、按 int16 回绕（只在 clip=false 的诊断/测试路径用） */
function wrapInt16(v) {
  return ((v + 32768) & 0xffff) - 32768
}

/**
 * 两路 16bit PCM 逐样本相加。
 *
 * 长度策略：**取较长的一路 + 较短的一路补零**（不截短）。
 * 理由：两路是各自独立启动的进程，设备打开耗时不同，尾巴长短不齐；
 * 截短会把后说话那一路的尾部发言直接切掉，补零只是多出几个静音样本，
 * 对识别无害。反过来，开头也按"字节 0"对齐（能力范围内最好的近似）。
 *
 * clip=true（默认）按 int16 饱和裁剪：两路都有人说话时相加会超过满量程，
 * 不裁剪就是数值回绕，听起来是刺耳的爆音，识别质量比"变响一点"差得多。
 */
export function mixPcm16(a, b, { clip = true } = {}) {
  const A = asPcm(a, 'mixPcm16 的第一路')
  const B = asPcm(b, 'mixPcm16 的第二路')
  const samples = Math.max(Math.floor(A.length / SAMPLE_BYTES), Math.floor(B.length / SAMPLE_BYTES))
  const out = Buffer.alloc(samples * SAMPLE_BYTES)
  for (let i = 0; i < samples; i++) {
    const off = i * SAMPLE_BYTES
    const va = off + SAMPLE_BYTES <= A.length ? A.readInt16LE(off) : 0
    const vb = off + SAMPLE_BYTES <= B.length ? B.readInt16LE(off) : 0
    let v = va + vb
    if (clip) v = v > 32767 ? 32767 : (v < -32768 ? -32768 : v)
    else v = wrapInt16(v)
    out.writeInt16LE(v, off)
  }
  return out
}

/**
 * 把裸 PCM 封装成 16k/单声道/16bit WAV（44 字节标准头，与 mbridge 的 WriteWav16 同一格式）。
 * 纯函数：只算字节，不写盘。
 */
export function wavFromPcm(pcm, { sampleRate = 16000, channels = 1, bits = 16 } = {}) {
  const data = asPcm(pcm, 'wavFromPcm 的 PCM')
  const blockAlign = channels * (bits / 8)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)                       // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * 从 WAV 里取出 data 块的 PCM。空输入返回空 Buffer（"这一路没录到"就是空，不是异常）；
 * 不是 WAV 或没有 data 块则抛错并带原因 —— 混音拿不到数据必须说出来。
 */
export function pcmFromWav(wav) {
  const buf = asPcm(wav, 'pcmFromWav 的 WAV')
  if (!buf.length) return Buffer.alloc(0)
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 RIFF/WAVE 文件（前 4 字节=' + JSON.stringify(buf.toString('ascii', 0, Math.min(4, buf.length))) + '）')
  }
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'data') return buf.subarray(body, Math.min(body + size, buf.length))
    off = body + size + (size % 2)
  }
  throw new Error('WAV 里没有 data 块（可能是空录音）')
}

/**
 * 流式混音器：两路各推各的，按"字节偏移"对齐后拉取。
 *
 * 对齐模型（唯一正确的做法）：两路都是 16k/单声道/16bit 的连续流，
 * 各自从 0 字节开始累计偏移。`pull(n)` 只在**两路都至少有 n 字节**时才混，
 * 混完两边偏移同时前进 n —— 这样偏移始终相等，不会把 A 的第 2 秒混到 B 的第 1 秒
 * （错位混音听起来是"重影/回声"，比少一路更难用）。
 *
 * 两路各自还有"落后容差"和"缓冲上限"，都在下面有明确策略和计数：
 *   - 落后 ≤ maxSkewBytes：等它（正常抖动，别错位）；
 *   - 落后 > maxSkewBytes：判定这一路停了/明显过慢 → 清掉它的积压（计入 dropped），
 *     用还有数据的那一路按静音补位继续出流，并把两边偏移同步推进；
 *   - 缓冲超过 maxBufferedBytes：丢**最旧的**（旧音频只会让识别更滞后），计入 dropped。
 *
 * 全部无 IO、无 timer；`reset()` 可重复调用。
 */
export class PcmMixer {
  constructor({ clip = true, maxBufferedBytes = BYTES_PER_MS * 5000, maxSkewBytes = BYTES_PER_MS * 1000 } = {}) {
    this.clip = clip !== false
    this.maxBufferedBytes = Math.max(BYTES_PER_MS, Math.floor(Number(maxBufferedBytes) || BYTES_PER_MS * 5000))
    this.maxSkewBytes = Math.max(BYTES_PER_MS, Math.floor(Number(maxSkewBytes) || BYTES_PER_MS * 1000))
    this._q = { a: [], b: [] }
    this._buffered = { a: 0, b: 0 }
    this._active = { a: true, b: true }
    this._pos = { a: 0, b: 0 }
    this._counters = { aBytes: 0, bBytes: 0, droppedA: 0, droppedB: 0, pulledBytes: 0, paddedPulls: 0, paddedBytes: 0, singleSidePulls: 0 }
  }

  _side(side) {
    if (side !== 'a' && side !== 'b') {
      throw new TypeError('PcmMixer 的 side 只能是 "a"（环回）或 "b"（麦克风），实际是 ' + String(side))
    }
    return side
  }

  _countDrop(side, bytes) {
    if (!(bytes > 0)) return
    if (side === 'a') this._counters.droppedA += bytes
    else this._counters.droppedB += bytes
  }

  /** 推入一路音频；返回本次真的进缓冲/被丢的字节数（便于调用方记账） */
  push(side, chunk) {
    const s = this._side(side)
    const buf = asPcm(chunk, 'PcmMixer.push 的音频')
    if (!buf.length) return { pushed: 0, dropped: 0 }
    this._counters[s + 'Bytes'] += buf.length
    this._q[s].push(buf)
    this._buffered[s] += buf.length
    let dropped = 0
    while (this._buffered[s] > this.maxBufferedBytes && this._q[s].length > 1) {
      const head = this._q[s][0]
      const over = this._buffered[s] - this.maxBufferedBytes
      if (head.length <= over) {
        this._q[s].shift()
        this._buffered[s] -= head.length
        dropped += head.length
      } else {
        this._q[s][0] = head.subarray(over)
        this._buffered[s] -= over
        dropped += over
      }
    }
    this._countDrop(s, dropped)
    return { pushed: buf.length, dropped }
  }

  /** 从缓冲头部取 n 字节（调用前必须已确认够），并把这一路的偏移推进 n */
  _take(s, n) {
    const parts = []
    let need = n
    while (need > 0) {
      const head = this._q[s][0]
      if (!head) break
      const take = Math.min(need, head.length)
      parts.push(head.subarray(0, take))
      if (take === head.length) this._q[s].shift()
      else this._q[s][0] = head.subarray(take)
      this._buffered[s] -= take
      need -= take
    }
    this._pos[s] += n
    return Buffer.concat(parts, n)
  }

  /** 清空这一路的积压并计入 dropped（不推进偏移：调用方负责同步） */
  _clearSide(s) {
    const bytes = this._buffered[s]
    if (bytes > 0) {
      this._q[s].length = 0
      this._buffered[s] = 0
      this._countDrop(s, bytes)
    }
    return bytes
  }

  /**
   * 拉取 n 字节的混音结果。
   * - 两路都在、都够 n：严格对齐混音；
   * - 只有一路在（另一路中断）：只用这一路的音频（保持单路听感，不做增益）；
   * - 一路落后超过容差：清掉它的积压、按静音补位；
   * - 数据不够一块：返回 null，让调用方等下一块（不硬凑）。
   */
  pull(nBytes) {
    const n = Math.max(0, Math.floor(Number(nBytes) || 0) & ~1) // 必须按整样本（2 字节）对齐
    if (!n) return null
    const sides = ['a', 'b'].filter((s) => this._active[s])
    if (!sides.length) return null
    if (sides.length === 1) {
      const s = sides[0]
      if (this._buffered[s] < n) return null
      this._counters.singleSidePulls += 1
      const out = this._take(s, n)
      this._counters.pulledBytes += n
      return out
    }
    const ba = this._buffered.a
    const bb = this._buffered.b
    if (Math.max(ba, bb) < n) return null
    if (ba >= n && bb >= n) {
      const a = this._take('a', n)
      const b = this._take('b', n)
      this._counters.pulledBytes += n
      return mixPcm16(a, b, { clip: this.clip })
    }
    const ahead = ba >= bb ? 'a' : 'b'
    const behind = ahead === 'a' ? 'b' : 'a'
    const skew = this._buffered[ahead] - this._buffered[behind]
    if (skew <= this.maxSkewBytes) return null // 只是短暂滞后：等它，别错位混
    // 落后超过容差：这一路停了/明显过慢。清积压 + 静音补位 + 偏移同步推进，
    // 保证识别不中断，也不会越拖越远（补出来的那段里只有环回的声音）。
    this._counters.paddedPulls += 1
    this._counters.paddedBytes += n
    this._clearSide(behind)
    this._pos[behind] += n
    const out = this._take(ahead, n)
    this._counters.pulledBytes += n
    return out
  }

  /** 某一路中断/恢复。中断时把它积压的音频丢掉并计数（那段时间没有可配对的数据） */
  setActive(side, on) {
    const s = this._side(side)
    const next = on !== false
    if (this._active[s] === next) return next
    this._active[s] = next
    if (!next) this._clearSide(s)
    return next
  }

  /** 重新对齐（两路重启后相对偏移不可知时用）；累计计数保留 */
  reset() {
    for (const s of ['a', 'b']) {
      this._q[s].length = 0
      this._buffered[s] = 0
      this._pos[s] = 0
    }
    return this
  }

  stats() {
    const c = this._counters
    return {
      aBytes: c.aBytes,
      bBytes: c.bBytes,
      droppedA: c.droppedA,
      droppedB: c.droppedB,
      dropped: c.droppedA + c.droppedB,
      pulledBytes: c.pulledBytes,
      paddedPulls: c.paddedPulls,
      paddedBytes: c.paddedBytes,
      singleSidePulls: c.singleSidePulls,
      bufferedA: this._buffered.a,
      bufferedB: this._buffered.b,
      activeA: this._active.a,
      activeB: this._active.b,
    }
  }
}
