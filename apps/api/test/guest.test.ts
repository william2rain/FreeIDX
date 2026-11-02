/** 访客留言纯函数（core/guest.ts）：北京时间自然日、昵称归一/保留字、令牌哈希与格式 */
import { describe, it, expect } from 'vitest';
import {
  GUEST_DAILY_LIMIT,
  beijingDayStart,
  hashGuestToken,
  isGuestPost,
  isReservedGuestName,
  isValidGuestToken,
  normalizeGuestName,
} from '../src/core/guest';

describe('beijingDayStart', () => {
  it('北京时间 2026-11-02 00:00 对应的 UTC 秒为当日起点', () => {
    // 2026-11-02 00:00 北京时间 = 2026-11-01 16:00 UTC = 1793548800
    expect(beijingDayStart(1793548800)).toBe(1793548800);
  });
  it('同一北京时间自然日内任意时刻落在同一起点，次日 00:00 起点 +86400', () => {
    expect(beijingDayStart(1793548800 + 86399)).toBe(1793548800);
    expect(beijingDayStart(1793548800 + 86400)).toBe(1793548800 + 86400);
  });
});

describe('normalizeGuestName / reserved', () => {
  it('折叠空白并去首尾空白；超 20 码点返回空串（调用方据此报 guestNameInvalid）', () => {
    expect(normalizeGuestName('  小  明  ')).toBe('小 明');
    expect(normalizeGuestName('x'.repeat(21))).toBe('');
    expect(normalizeGuestName('x'.repeat(20))).toBe('x'.repeat(20));
    expect(normalizeGuestName('')).toBe('');
  });
  it('保留字不区分大小写；普通昵称不命中', () => {
    expect(isReservedGuestName('Admin')).toBe(true);
    expect(isReservedGuestName('管理员')).toBe(true);
    expect(isReservedGuestName('路人甲')).toBe(false);
  });
});

describe('guest token', () => {
  it('令牌格式：UUID 产物通过，空串/过短/非法字符不通过', () => {
    expect(isValidGuestToken('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidGuestToken('')).toBe(false);
    expect(isValidGuestToken('short')).toBe(false);
    expect(isValidGuestToken('a b c d e f g h')).toBe(false);
  });
  it('哈希确定且不等于原文（后端只存哈希）', async () => {
    const h1 = await hashGuestToken('some-token');
    const h2 = await hashGuestToken('some-token');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe('some-token');
  });
});

describe('isGuestPost', () => {
  it('uid=0 且 guest_name 非空才是访客帖；登录帖与空昵称的 uid=0 行都不是', () => {
    expect(isGuestPost({ uid: 0, guest_name: '小明' })).toBe(true);
    expect(isGuestPost({ uid: 5, guest_name: '' })).toBe(false);
    expect(isGuestPost({ uid: 0, guest_name: '' })).toBe(false);
    expect(GUEST_DAILY_LIMIT).toBe(3);
  });
});
