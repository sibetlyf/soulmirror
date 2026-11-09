import { readFileSync } from 'node:fs'

const text = readFileSync('G:/dsh-test/soulmirror/index.js', 'utf8')
const lines = text.split('\n')

// 粗略扫描大括号深度（忽略字符串/注释的误差，用于定位异常）
let depth = 0
const notes = []
let inBlockComment = false
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i]
  let s = raw
  if (inBlockComment) {
    const end = s.indexOf('*/')
    if (end < 0) continue
    s = s.slice(end + 2)
    inBlockComment = false
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  const bc = s.indexOf('/*')
  if (bc >= 0 && s.indexOf('*/', bc) < 0) { s = s.slice(0, bc); inBlockComment = true }
  s = s.replace(/\/\/.*$/, '')
  // 去掉字符串（含模板串简化处理）
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``')

  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) notes.push('第 ' + (i + 1) + ' 行深度变负')
    }
  }
  if (i === lines.length - 1) notes.push('结尾深度 = ' + depth)
}
console.log(notes.join('\n') || '括号平衡')
