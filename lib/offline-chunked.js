/**
 * 超长录音的分段文件识别。
 *
 * 为什么需要：百炼「录音文件识别」要整份上传，超过单次上限就会失败。
 * 以前遇到 412MB 的录音直接 throw「录音过大，跳过文件识别」→ 整场会后整理失败，
 * 用户只能手动点「用录音重新整理」，再失败一次。长会议（2.5 小时以上）等于永远出不了纪要。
 *
 * 现在的做法：
 *   1. 按 chunkBytes（默认 80MB ≈ 40 分钟）把音频切成若干段写成临时 WAV；
 *   2. 每段单独走文件识别（带说话人分离）；
 *   3. 把每段的 begin/end 按段起始时间**加偏移**后合并；
 *   4. 某段失败不放弃整场：插一条可见的“第 N 段识别失败”并继续；
 *   5. 临时分段文件在 finally 里清理（v1.5.3 起）。
 *
 * 单一职责：只做“切段 + 识别 + 合并”，不做 UI/日志美化；进度通过 onProgress 回调。
 */
import { join } from 'node:path'
import { readWavHeader } from './offline-asr.js'
import { extractRangeToWav } from './offline-audio.js'
import { transcribeFileWithSpeakers } from './dashscope-file.js'
import { removeFile } from './asr.js'

/** 每段字节上限（默认 80MB，约 40 分钟 16k/16bit 单声道） */
export const DEFAULT_CHUNK_BYTES = 80 * 1024 * 1024

/**
 * @param {{wav:string, dir:string, key:string, chunkBytes?:number, logger?:any,
 *   onProgress?:(p:{index:number,total:number,detail:string,fraction:number})=>void,
 *   transcribe?:Function, extract?:Function, remove?:Function}} o
 * @returns {Promise<{lines:any[], segs:number, failed:number}>}
 */
export async function transcribeInChunks(o = {}) {
  const {
    wav, dir, key, chunkBytes = DEFAULT_CHUNK_BYTES, logger,
    onProgress,
  } = o
  const extract = o.extract || extractRangeToWav
  const transcribe = o.transcribe || transcribeFileWithSpeakers
  const remove = o.remove || removeFile

  const { seconds: totalSec } = readWavHeader(wav)
  // 16k/16bit/单声道 = 32000 字节/秒；按上限换算成秒，并留 5% 余量避免刚好超限
  const bytesPerSec = 32000
  const segSec = Math.max(60, Math.floor((chunkBytes * 0.95) / bytesPerSec))
  const segs = Math.max(1, Math.ceil(totalSec / segSec))
  logger?.info?.('[soulmirror] 分段识别：' + Math.round(totalSec) + ' 秒 → ' + segs + ' 段，每段约 ' + segSec + ' 秒')

  const merged = []
  let failed = 0
  for (let i = 0; i < segs; i++) {
    const startSec = i * segSec
    const endSec = Math.min(totalSec, (i + 1) * segSec)
    if (endSec - startSec < 1) continue
    const part = join(dir, '_asr-part-' + i + '.wav')
    try {
      await extract({ src: wav, dst: part, startSec, endSec })
      onProgress?.({ index: i + 1, total: segs, detail: '分段识别 ' + (i + 1) + '/' + segs, fraction: (i + 1) / segs })
      const { openAsBlob } = await import('node:fs')
      const r = await transcribe({
        apiKey: key,
        file: await openAsBlob(part, { type: 'audio/wav' }),
        fileName: 'meeting-part-' + i + '.wav',
        languageHints: ['zh', 'en'],
      })
      const got = (r.sentences || []).filter((x) => x && x.text)
      for (const x of got) {
        merged.push(x.begin != null
          ? { ...x, begin: x.begin + startSec * 1000, end: x.end != null ? x.end + startSec * 1000 : x.end }
          : x)
      }
      logger?.info?.('[soulmirror] 第 ' + (i + 1) + '/' + segs + ' 段完成：' + got.length + ' 句')
    } catch (e) {
      failed += 1
      const msg = e && e.message ? e.message : String(e)
      logger?.warn?.('[soulmirror] 第 ' + (i + 1) + '/' + segs + ' 段识别失败：' + msg)
      // 可见断点：纪要生成时能看出这几分钟没识别成功，而不是凭空少一段
      merged.push({
        text: '（第 ' + (i + 1) + ' 段识别失败：' + msg + '）',
        begin: startSec * 1000, end: endSec * 1000, speaker: '', gap: true,
      })
    } finally {
      try { await remove(part) } catch { /* 临时文件删不掉不影响结果 */ }
    }
  }
  return { lines: merged, segs, failed }
}
