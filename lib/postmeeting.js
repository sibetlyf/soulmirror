/** Disk-driven, serial, resumable post-meeting runner.
 * Steps must cooperate with cancellation: pass ctx.signal to abortable operations,
 * call ctx.assertActive() after awaits, and use ctx.commit(fn) before side effects.
 * An already dispatched external request cannot be undone by JavaScript; its
 * durable receipt / idempotency key must be reconciled by the step on recovery.
 */
import { PIPELINE_STEPS, nextStep, stepLabel } from './journal.js'

export function createPostMeeting({ journal, steps, logger, timeouts = {} } = {}) {
  if (!journal) throw new Error('postmeeting 需要 journal')
  const queue = []
  let current = null
  let pumping = null
  const stateOf = (dir) => journal.projection().runs[dir] || null

  function enqueue(dir, opts = {}) {
    if (!dir) return { ok: false, error: '没有会议目录' }
    if (opts.from && !PIPELINE_STEPS.includes(opts.from)) return { ok: false, error: '未知整理步骤：' + opts.from }
    if (current?.dir === dir) return { ok: false, error: '这场会正在整理中', busy: true }
    const existing = queue.findIndex((q) => q.dir === dir)
    if (existing >= 0) return { ok: true, queued: true, position: existing + 1 }
    const run = stateOf(dir)
    if (run?.phase === 'done' && !opts.restart) return { ok: false, done: true, error: '这场会已经整理完成（要重来请用「重新整理」）' }
    // Explicit from never repeats a confirmed done/skipped step unless restart=true.
    const from = opts.restart ? PIPELINE_STEPS[0] : (opts.from || (run ? nextStep(run) : PIPELINE_STEPS[0]))
    const position = queue.length + (current ? 1 : 0)
    // Queue membership is durable before it becomes observable or executable.
    journal.append('pipeline.queued', { run: dir, reason: opts.reason || '', from, restart: !!opts.restart })
    queue.push({ dir, reason: opts.reason || '', from, restart: !!opts.restart })
    pump()
    return { ok: true, queued: position > 0, position }
  }

  function pump() {
    if (pumping) return pumping
    // Schedule drain after assigning pumping: synchronous/reentrant steps cannot
    // leave a resolved promise installed forever or run two drains concurrently.
    pumping = Promise.resolve().then(async () => {
      while (queue.length) {
        const job = queue.shift()
        try { await runJob(job) }
        catch (e) { logger?.warn?.('[soulmirror] 会后整理异常：' + e.message) }
      }
    }).finally(() => {
      pumping = null
      if (queue.length) pump()
    })
    return pumping
  }

  async function runJob({ dir, reason, from, restart }) {
    const previous = stateOf(dir)
    const job = { dir, step: '', controller: new AbortController(), finished: false }
    current = job
    const outputs = {}
    if (!restart && previous) {
      for (const s of PIPELINE_STEPS) outputs[s] = previous.steps[s]?.output || {}
    }
    const assertActive = () => {
      if (job.controller.signal.aborted) throw job.controller.signal.reason || new Error('整理已取消')
      if (job.finished) throw new Error('整理任务已结束')
    }
    const abort = (error) => { if (!job.controller.signal.aborted) job.controller.abort(error) }
    try {
      if (restart || !previous) journal.append('pipeline.start', { run: dir, reason })
      else journal.append('pipeline.resume', { run: dir, from, reason })
      const startIdx = from ? PIPELINE_STEPS.indexOf(from) : PIPELINE_STEPS.length
      for (let i = startIdx; i < PIPELINE_STEPS.length; i++) {
        assertActive()
        const step = PIPELINE_STEPS[i]
        if (!restart && ['done', 'skipped'].includes(previous?.steps[step]?.state)) continue
        job.step = step
        const fn = steps?.[step]
        if (typeof fn !== 'function') {
          journal.append('pipeline.stepSkip', { run: dir, step, reason: '未实现' })
          continue
        }
        journal.append('pipeline.step', { run: dir, step, percent: 0 })
        let lastProgressAt = 0
        let stepActive = true
        const assertStepActive = () => { assertActive(); if (!stepActive) throw new Error('整理步骤已结束') }
        const ctx = {
          dir, reason, outputs,
          signal: job.controller.signal,
          isCancelled: () => job.controller.signal.aborted || job.finished || !stepActive,
          assertActive: assertStepActive,
          // fn must itself check signal after awaits before committing its writes.
          commit: (fn) => { assertStepActive(); return fn() },
          progress: (detail, percent) => {
            if (job.controller.signal.aborted || job.finished || !stepActive) return
            const t = Date.now()
            if (t - lastProgressAt < 1000 && percent !== 100) return
            lastProgressAt = t
            journal.append('pipeline.progress', { run: dir, step, detail: String(detail || ''), percent: typeof percent === 'number' ? Math.round(percent) : undefined })
          },
        }
        let timer
        let onAbort
        try {
          const aborted = new Promise((_, reject) => {
            onAbort = () => reject(job.controller.signal.reason || new Error('整理已取消'))
            job.controller.signal.addEventListener('abort', onAbort, { once: true })
          })
          const ms = Number(timeouts[step]) || 0
          if (ms > 0) timer = setTimeout(() => abort(new Error(stepLabel(step) + '超时（' + ms + 'ms）')), ms)
          const result = await Promise.race([Promise.resolve().then(() => { assertStepActive(); return fn(ctx) }), aborted])
          assertStepActive()
          outputs[step] = result || {}
          if (result?.status === 'skip') journal.append('pipeline.stepSkip', { run: dir, step, reason: result.reason || '' })
          else journal.append('pipeline.stepDone', { run: dir, step, result: result?.result || '', output: outputs[step] })
        } finally {
          stepActive = false
          clearTimeout(timer)
          job.controller.signal.removeEventListener('abort', onAbort)
        }
      }
      assertActive()
      const m = outputs.minutes || {}, o = outputs.offline || {}
      const prior = previous?.result || {}
      journal.append('pipeline.done', {
        run: dir,
        minutesPath: m.path || prior.minutesPath || '',
        minutesSource: m.source || prior.minutesSource || '',
        knowledge: outputs.knowledge?.result || prior.knowledge || '',
        sentences: o.sentences || m.sentences || prior.sentences || 0,
        speakers: o.speakers || prior.speakers || 0,
      })
      return { ok: true }
    } catch (e) {
      abort(e)
      journal.append('pipeline.error', { run: dir, step: job.step, error: e.message || String(e) })
      logger?.warn?.('[soulmirror] 会后整理失败：' + e.message)
      return { ok: false, error: e.message }
    } finally {
      job.finished = true
      if (current === job) current = null
    }
  }

  return {
    enqueue,
    resume(runs) {
      return (runs || []).filter((r) => r.phase !== 'done').map((r) => {
        // Use the durable projection, not a stale caller-provided step snapshot.
        const durable = stateOf(r.run) || r
        const from = durable.restart ? PIPELINE_STEPS[0] : (durable.queuedFrom || nextStep(durable))
        return { dir: r.run, from, ...enqueue(r.run, { reason: '宿主重启后继续', from, restart: !!durable.restart }) }
      })
    },
    cancelCurrent() {
      if (!current) return false
      current.controller.abort(new Error('整理已取消'))
      return true
    },
    status() { return { current: current ? { dir: current.dir, step: current.step } : null, queue: queue.map(({ dir, from }) => ({ dir, from })) } },
    async idle() { while (pumping) await pumping },
  }
}
