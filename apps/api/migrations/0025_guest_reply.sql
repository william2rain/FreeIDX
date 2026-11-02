/**
 * 0025_guest_reply：访客留言（2026-11-02 锁定方案）。
 *
 *  bbs_post.guest_name：访客帖昵称（登录帖恒空串）。uid=0 + guest_name 非空 = 访客帖，
 *    与登录用户的 uid/username 字段严格区分，uid=0 不再被当作「系统账号」。
 *  bbs_post.guest_token_hash：访客令牌的 SHA-256 哈希（只存哈希、不存原文、不下发），
 *    用于帖子详情页「留言人自己可见自己的待审留言」的认领匹配。
 *  bbs_guest_daily：同一 IP 当日访客留言计数（北京时间自然日，day_start 为当日 00:00 北京时间
 *    对应的 UTC 秒）。键用原始 IP 字符串而不用 ipToLong：IPv6 转 long 会塌成 0，
 *    导致所有 IPv6 访客共用一个计数桶。
 *  访客帖一律 ok=0（先审后放），不进 bbs_mypost、不计 user.posts、不发积分与通知。
 */
ALTER TABLE bbs_post ADD COLUMN guest_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bbs_post ADD COLUMN guest_token_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE bbs_guest_daily (
  ip TEXT NOT NULL,
  day_start INTEGER NOT NULL,
  cnt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day_start)
);
