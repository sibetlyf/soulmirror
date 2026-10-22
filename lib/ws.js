/**
 * 极简 WebSocket 客户端（RFC6455），只依赖 node:net / tls / crypto。
 * 需要它是因为：Node 内置 WebSocket 不支持自定义请求头，而 DashScope 要求 Authorization。
 */
import { EventEmitter } from 'node:events'
import net from 'node:net'
import tls from 'node:tls'
import { randomBytes, createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export class WsClient extends EventEmitter {
  constructor({ timeoutMs = 15000 } = {}) {
    super()
    this.sock = null
    this.buf = Buffer.alloc(0)
    this.open = false
    this.timeoutMs = timeoutMs
    this.fragOp = 0
    this.fragParts = []
  }

  connect(rawUrl, headers = {}) {
    const u = new URL(rawUrl)
    const isTls = u.protocol === 'wss:'
    const port = Number(u.port || (isTls ? 443 : 80))
    const key = randomBytes(16).toString('base64')
    const accept = createHash('sha1').update(key + GUID).digest('base64')

    return new Promise((resolve, reject) => {
      const sock = isTls
        ? tls.connect({ host: u.hostname, port, servername: u.hostname })
        : net.connect({ host: u.hostname, port })
      this.sock = sock

      let handshakeDone = false
      let head = ''
      const timer = setTimeout(() => {
        try { sock.destroy() } catch { /* ignore */ }
        reject(new Error('ws handshake timeout'))
      }, this.timeoutMs)

      sock.on('data', (d) => {
        if (!handshakeDone) {
          head += d.toString('latin1')
          const idx = head.indexOf('\r\n\r\n')
          if (idx < 0) return
          handshakeDone = true
          clearTimeout(timer)
          const lines = head.split('\r\n')
          const status = lines[0] || ''
          const hdrs = {}
          for (const line of lines.slice(1)) {
            const i = line.indexOf(':')
            if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
          }
          if (!/ 101 /.test(status + ' ')) {
            this.emit('handshake-failed', { status, headers: hdrs, raw: head.slice(0, 500) })
            return reject(new Error(`ws handshake failed: ${status}`))
          }
          if (hdrs['sec-websocket-accept'] !== accept) {
            return reject(new Error('ws handshake failed: bad accept'))
          }
          this.open = true
          this.emit('open')
          resolve()
          const rest = Buffer.from(head.slice(idx + 4), 'latin1')
          if (rest.length) this._feed(rest)
          return
        }
        this._feed(d)
      })

      sock.on('error', (e) => { if (!handshakeDone) reject(e); else this.emit('error', e) })
      sock.on('close', () => {
        clearTimeout(timer)
        this.open = false
        this.emit('close')
      })

      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
      const path = (u.pathname || '/') + (u.search || '')
      const req = [
        `GET ${path} HTTP/1.1`,
        `Host: ${u.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        extra,
        '',
        '',
      ].join('\r\n')
      sock.write(req)
    })
  }

  sendText(text) { this._send(0x1, Buffer.from(text, 'utf8')) }
  sendBinary(buf) { this._send(0x2, Buffer.isBuffer(buf) ? buf : Buffer.from(buf)) }

  close(code = 1000, reason = '') {
    if (!this.open) return
    const p = Buffer.alloc(2 + Buffer.byteLength(reason))
    p.writeUInt16BE(code, 0)
    p.write(reason, 2)
    this._send(0x8, p)
    this.open = false
    setTimeout(() => { try { this.sock.end() } catch { /* ignore */ } }, 50)
  }

  _send(opcode, payload) {
    if (!this.sock || !this.open) throw new Error('ws not open')
    const len = payload.length
    const mask = randomBytes(4)
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    this.sock.write(Buffer.concat([header, mask, masked]))
  }

  _feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    while (this.buf.length >= 2) {
      const b0 = this.buf[0]
      const b1 = this.buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        off = 10
      }
      let maskKey = null
      if (masked) {
        if (this.buf.length < off + 4) return
        maskKey = this.buf.subarray(off, off + 4)
        off += 4
      }
      if (this.buf.length < off + len) return
      let payload = this.buf.subarray(off, off + len)
      this.buf = this.buf.subarray(off + len)
      if (maskKey) {
        const un = Buffer.allocUnsafe(len)
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ maskKey[i & 3]
        payload = un
      } else {
        payload = Buffer.from(payload)
      }

      if (opcode === 0x8) { this.emit('close'); return }
      if (opcode === 0x9) { this._send(0xA, payload); continue }
      if (opcode === 0xA) { this.emit('pong'); continue }

      if (opcode === 0x0) {
        this.fragParts.push(payload)
        if (fin) {
          const all = Buffer.concat(this.fragParts)
          const op = this.fragOp
          this.fragParts = []
          this.fragOp = 0
          this.emit(op === 0x2 ? 'binary' : 'message', op === 0x2 ? all : all.toString('utf8'))
        }
        continue
      }
      if (!fin) {
        this.fragOp = opcode
        this.fragParts = [payload]
        continue
      }
      this.emit(opcode === 0x2 ? 'binary' : 'message', opcode === 0x2 ? payload : payload.toString('utf8'))
    }
  }
}
