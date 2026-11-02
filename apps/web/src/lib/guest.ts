/**
 * 访客令牌（guest token）——仅用于「认领自己的待审留言」，不是账号凭证。
 *
 * 令牌只存在本浏览器的 localStorage（freeidx_guest_token）里，提交访客留言时
 * 随正文发给后端；后端只存它的 SHA-256 哈希，绝不存原文、绝不下发。
 * 已知限制：换设备或清除浏览器数据后，令牌丢失，之前待审留言就认不出来了
 * （访客无账号的固有限制）。令牌没有任何账号权限：不能编辑、删除、发帖，
 * 也不能冒充任何用户；真正的登录关、权限关、审核关都在后端。
 */
const KEY = 'freeidx_guest_token';

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 取出现有令牌，没有则生成并保存一个。SSR/无 localStorage 环境返回空串（调用方不得以此提交）。 */
export function getGuestToken(): string {
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
    const token = randomToken();
    window.localStorage.setItem(KEY, token);
    return token;
  } catch {
    return '';
  }
}

/** 仅读取，不生成：用于详情页拉取时附带认领（无令牌 = 不认领任何待审帖）。 */
export function readGuestToken(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
