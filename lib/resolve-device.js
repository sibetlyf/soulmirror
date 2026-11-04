/**
 * 把"配置里记下的设备"解析成"现在真正存在的设备"。
 *
 * 真实事故：配置里存的是「耳机 (适用于 MIPI SoundWire® …)」，
 * 用户拔掉耳机后系统里只剩「扬声器 (适用于 MIPI SoundWire® …)」，
 * 桥接按名字精确匹配失败 → 每次启动都崩 → 采集进程 22 次重启、0 字节。
 *
 * 所以：名字只作线索，最终以端点 ID 交给桥接（重命名/插拔都不受影响）。
 */

/** 去掉 ® © 括号内容与空白，做保守比较 */
export function normalizeDeviceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[®©™]/g, '')
    .replace(/[()（）[\]【】]/g, ' ')
    .replace(/适用于|音频的|英特尔|智音技术/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {Array<{name:string, id?:string, index?:number}>} list
 * @param {string} wanted 配置里记的设备名或 ID
 * @returns {{ device: {name:string,id?:string,index?:number}, how: 'id'|'exact'|'normalized'|'contains'|'none' }}
 */
export function matchDevice(list, wanted) {
  const rows = Array.isArray(list) ? list.filter(Boolean) : []
  const want = String(wanted || '').trim()
  if (!rows.length) return { device: null, how: 'none' }
  if (!want) return { device: null, how: 'none' }

  // 1) 端点 ID（最稳）
  const byId = rows.find((d) => d.id && d.id === want)
  if (byId) return { device: byId, how: 'id' }

  // 2) 名字完全一致
  const exact = rows.find((d) => d.name === want)
  if (exact) return { device: exact, how: 'exact' }

  // 3) 规范化后一致（忽略 ® 与括号里的修饰词）
  const nw = normalizeDeviceName(want)
  if (nw) {
    const norm = rows.find((d) => normalizeDeviceName(d.name) === nw)
    if (norm) return { device: norm, how: 'normalized' }

    // 4) 互相包含（配置里是长名字，系统里是短名字，或反之）
    const contain = rows.find((d) => {
      const dn = normalizeDeviceName(d.name)
      return dn && (dn.includes(nw) || nw.includes(dn))
    })
    if (contain) return { device: contain, how: 'contains' }
  }

  return { device: null, how: 'none' }
}

/** 传给桥接的引用：优先端点 ID，其次名字 */
export function deviceRef(device) {
  if (!device) return ''
  return device.id || device.name || ''
}
