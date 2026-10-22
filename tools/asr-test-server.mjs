// 本地自检服务：托管 asr-test.html，收集页面回传的 Web Speech 事件。
// 用法：node asr-test-server.mjs  然后浏览器打开 http://127.0.0.1:8799
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'asr-test.html'), 'utf8')

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      console.log(body)
      res.writeHead(204).end()
    })
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page)
})

const port = Number(process.env.PORT || 8799)
server.listen(port, '127.0.0.1', () => {
  console.log(`asr-test on http://127.0.0.1:${port}`)
})
