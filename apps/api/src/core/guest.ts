/**
 * 访客留言（guest reply）核心规则 —— 与登录用户回帖完全分开的一条路。
 *
 * 锁定方案（2026-11-02）：
 *  1. 访客回帖必须填昵称；昵称不得冒用已注册用户名与 admin 类名字，展示时带游客标识（见 PostItem.isGuest）。
 *  2. 访客只能回帖，不能发新主题（createThread 仍走 requireLogin，不动）。
 *  3. 同一 IP 每天最多 3 条（北京时间自然日重置），超限提示注册/登录；计数在后端做（bbs_guest_daily）。
 *  4. 每次访客提交都过 Turnstile（复用 verifyTurnstile；未配 TURNSTILE_SECRET 时按既有铁律直通）。
 *  5. 访客留言一律先审后放（ok=0），但留言人自己能看到自己的待审留言。
 *  6. 后台游客组 allowpost 仍是第二道关：关掉时访客也不能留言。
 *
 * 作者归属设计：
 *  访客帖写入 bbs_post 时 uid 恒为 0，但同时写 guest_name / guest_token_hash 两列，
 *  与登录用户的 uid/username 字段严格区分：uid=0 在此不再代表「系统账号」，
 *  而是「无账号访客」，是否访客帖以 guest_name 非空为准。访客帖不进 bbs_mypost、
 *  不计 user.posts、不发积分、不发通知、不挂附件。
 *
 * 访客令牌与「自己可见」：
 *  前端在 localStorage 生成并保存一个随机令牌（freeidx_guest_token），提交时随正文
 *  一起发给后端；后端只存它的 SHA-256 哈希，绝不存原文、绝不下发给任何人。
 *  帖子详情返回待审留言时，只有请求方带来的令牌哈希与该楼层哈希一致，
 *  才把这条待审留言返回给访客。已知限制：令牌只存在一台浏览器的 localStorage 里，
 *  换设备或清数据后就认不出自己的待审留言——这是访客无账号的固有限制，不是 bug。
 *  令牌本身没有任何账号权限：它只能「认领自己的待审留言」，不能编辑、删除、
 *  不能绕过登录关，也不能冒充任何用户。
 *
 * IP 计数口径：
 *  以 reqIp() 的原始字符串为键（cf-connecting-ip 优先，其次 X-Forwarded-For 首项），
 *  不走 ipToLong：IPv6 转 long 会塌成 0，导致所有 IPv6 访客共用一个计数桶。
 *  同一出口 IP 下的多人（家庭/学校/公司 NAT）会共享当日 3 条额度，这是按「同一 IP」
 *  计数必然带来的代价，方案已确认接受。
 */

/** 同一 IP 每天最多访客留言条数 */
export const GUEST_DAILY_LIMIT = 3;

/** 北京时间相对 UTC 的秒偏移（自然日重置按北京时间算） */
const BEIJING_OFFSET_SECONDS = 8 * 3600;

/** 北京时间自然日的起始秒（Unix 秒）。例如 2026-11-02 00:00 北京时间。 */
export function beijingDayStart(ts: number): number {
  // ts 是 UTC 秒：先 +8 小时按北京时间取整到日，再 -8 小时还原为 UTC 秒起点。
  return Math.floor((ts + BEIJING_OFFSET_SECONDS) / 86400) * 86400 - BEIJING_OFFSET_SECONDS;
}

/** 访客令牌哈希：SHA-256 十六进制。Worker / Node 均有全局 crypto.subtle。 */
export async function hashGuestToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 访客令牌格式：前端 crypto.randomUUID() 产物（36 字符）或同类随机串，限 8~128 字符。 */
export function isValidGuestToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(token);
}

/** 昵称归一：去首尾空白、折叠内部空白，1~20 码点。 */
export function normalizeGuestName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const name = raw.replace(/\s+/g, ' ').trim();
  return [...name].length > 20 ? '' : name;
}

/**
 * 保留字（精确匹配，不区分大小写）：冒用站方/管理身份的名字一律拒绝。
 * 注意：已注册用户名的冒用另由写路径查库（lower(username) 等值）拦截，此处只拦保留字。
 */
const RESERVED_GUEST_NAMES = new Set([
  'admin',
  'administrator',
  'admins',
  'moderator',
  'mod',
  'system',
  'official',
  'support',
  '管理员',
  '版主',
  '超级版主',
  '站长',
  '官方',
  '系统',
  '客服',
  'freeidx',
]);

export function isReservedGuestName(name: string): boolean {
  return RESERVED_GUEST_NAMES.has(name.toLowerCase());
}

/** 访客帖判定：uid=0 且 guest_name 非空。登录用户的 uid 恒 >0，绝不会误判。 */
export function isGuestPost(row: { uid: number; guest_name?: string | null }): boolean {
  return Number(row.uid) === 0 && String(row.guest_name ?? '').length > 0;
}
