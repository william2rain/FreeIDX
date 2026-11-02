/**
 * 访客待审留言“本人可见”回归测试（2026-11-02 线上实测缺陷）：
 *
 * 线上表现：访客提交待审留言后，详情页回复列表一直为空、刷新后也看不到
 * 自己的待审帖，尽管服务端已入库（第 4 条触发每日限额可证明）。
 *
 * 本测试复现生产链路的关键一环：帖子详情接口 /api/threads/:tid 在边缘缓存
 * （edgeCache，TTL 60s）里。缓存键只有 URL（含 fi-ua/fi-lang），不含
 * X-Guest-Token 头；因此带令牌的“认领本人待审帖”请求会命中提交前缓存的
 * 通用副本（无待审帖），且刷新后仍在 TTL 内命中同一副本。
 *
 * 断言（修复后必须全部成立）：
 *  1. 不带令牌的游客详情请求：MISS 并落缓存，列表中没有待审访客帖。
 *  2. 带正确令牌的同一游客详情请求：必须绕开边缘缓存（x-edge-cache 为空），
 *     列表中出现自己的待审帖（username 为访客昵称、isGuest 为 true），且不
 *     产生新的缓存条目（个人化响应绝不能写进共享缓存键，否则会泄露给他人）。
 *  3. 带错误令牌的详情请求：同样绕开缓存，列表中没有他人的待审帖。
 *  4. 令牌请求之后，不带令牌的请求仍命中最初的通用缓存副本（无待审帖），
 *     证明个人化响应没有污染共享缓存。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { l0Clear } from '../src/core/cache';
import { hashGuestToken } from '../src/core/guest';
import { fakeAssets, fakeCaches, fakeD1Sql, fakeKv, fakeR2, type SqlRule } from './helpers/fake-d1';

const SETTING = JSON.stringify({
  runlevel: 5, sitename: 'FreeIDX', brief: 'b', url: 'http://localhost', kw: '', desc: '',
  user_create_on: 1, user_create_email_on: 0, user_resetpw_on: 1,
  forum_orderby: 0, update_views_on: 0, upload_max_size: 1048576, lang: 'zh-cn',
});
const GUEST_GROUP = {
  gid: 0, name: '游客组', creditsfrom: 0, creditsto: 0,
  allowread: 1, allowthread: 0, allowpost: 1, allowattach: 0, allowdown: 1,
  allowtop: 0, allowupdate: 0, allowdelete: 0, allowmove: 0, allowbanuser: 0, allowdeleteuser: 0, allowviewip: 0,
};
const FORUM_OPEN = {
  fid: 1, name: '默认版块', rank: 1, threads: 2, todayposts: 0, todaythreads: 0,
  brief: '介绍', announcement: '', accesson: 0, orderby: 0, icon: 0, moduids: '', seo_title: '', seo_keywords: '',
};
const THREAD = {
  tid: 2, fid: 1, top: 0, digest: 0, closed: 0, uid: 1, username: 'admin', avatar: 0,
  subject: '你好世界', posts: 1, views: 10, images: 0, files: 0, ok: 1,
  lastpid: 2, lastuid: 1, lastusername: 'admin', create_date: 1700000001, last_date: 1700000002,
  firstpid: 1, mods: 0, userip: 0,
};
const FIRST_POST = {
  pid: 1, tid: 2, uid: 1, isfirst: 1, ok: 1, create_date: 1700000001, userip: 0,
  images: 0, files: 0, doctype: 0, quotepid: 0, message: '原始首贴', message_fmt: '<p>首贴内容</p>',
};
const TOKEN = '123e4567-e89b-12d3-a456-426614174000';

function rules(tokenHash: string): SqlRule[] {
  const pending = {
    pid: 3, tid: 2, uid: 0, isfirst: 0, ok: 0, create_date: 1700000003, userip: 0,
    images: 0, files: 0, doctype: 0, quotepid: 0, message: '访客留言', message_fmt: '<p>访客留言</p>',
    guest_name: '测试访客',
  };
  return [
    { test: /FROM bbs_kv/, first: (params: readonly unknown[]) => (params[0] === 'extensions' ? null : { v: SETTING }) },
    { test: /FROM bbs_group/, rows: [GUEST_GROUP, { ...GUEST_GROUP, gid: 1 }] },
    { test: /FROM bbs_forum ORDER BY/, rows: [FORUM_OPEN] },
    { test: /bbs_forum_access/, rows: [] },
    { test: /bbs_thread_top/, rows: [] },
    { test: /FROM bbs_thread WHERE tid = \?/, first: THREAD },
    { test: /FROM bbs_thread WHERE fid = \? AND tid [<>] \?/, rows: [] },
    { test: /SELECT COUNT\(\*\) AS c FROM bbs_like WHERE tid = \?/, first: { c: 0 } },
    { test: /SELECT COUNT\(\*\) AS c FROM bbs_favorite WHERE tid = \?/, first: { c: 0 } },
    { test: /FROM bbs_post WHERE tid = \?/, rows: [FIRST_POST, pending] },
    { test: /guest_token_hash/, rows: [{ pid: 3, guest_token_hash: tokenHash }] },
    { test: /FROM bbs_post_like WHERE pid IN/, rows: [] },
    { test: /bbs_attach/, rows: [] },
    { test: /FROM bbs_user WHERE uid IN/, rows: (params: readonly unknown[]) => params.map((uid) => ({ uid: Number(uid), username: 'admin', avatar: 0, v: '0', avatar_auto: '' })) },
    { test: /bbs_cache/, first: null },
  ];
}

function envFor(tokenHash: string) {
  const fake = fakeD1Sql(rules(tokenHash));
  return {
    env: { DB: fake.db, CACHE: fakeKv(), FILES: fakeR2(), ASSETS: fakeAssets(), SITE_URL: 'http://localhost' },
    calls: fake.calls,
  };
}

let edge: ReturnType<typeof fakeCaches>;
beforeEach(() => {
  l0Clear();
  edge = fakeCaches();
  edge.install();
});
afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

async function hit(path: string, headers: Record<string, string> = {}, source = envFor('')) {
  const waited: Promise<unknown>[] = [];
  const res = await app.request(
    path,
    { headers: { cookie: 'csrf=token1', ...headers } },
    source.env as never,
    { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException: () => {} } as never,
  );
  await Promise.all(waited);
  return res;
}

type DetailBody = { code: number; data: { posts: { list: Array<Record<string, unknown>> } } };

describe('访客待审帖本人可见（边缘缓存不得按令牌无关的键复用）', () => {
  it('带正确令牌的详情请求绕开边缘缓存并返回本人待审帖；个人化响应不污染共享缓存', async () => {
    const tokenHash = await hashGuestToken(TOKEN);
    const source = envFor(tokenHash);

    const first = await hit('/api/threads/2', {}, source);
    expect(first.headers.get('x-edge-cache')).toBe('MISS');
    const body1 = (await first.json()) as DetailBody;
    expect(body1.code).toBe(0);
    expect(body1.data.posts.list.map((p) => p.pid)).toEqual([1]);
    expect(edge.entries.size).toBe(1);

    const mine = await hit('/api/threads/2', { 'x-guest-token': TOKEN }, source);
    expect(mine.headers.get('x-edge-cache')).toBeNull();
    const bodyMine = (await mine.json()) as DetailBody;
    expect(bodyMine.code).toBe(0);
    const minePost = bodyMine.data.posts.list.find((p) => p.pid === 3);
    expect(minePost).toBeDefined();
    expect(minePost?.username).toBe('测试访客');
    expect(minePost?.isGuest).toBe(true);
    expect(edge.entries.size).toBe(1);

    const wrong = await hit('/api/threads/2', { 'x-guest-token': '123e4567-e89b-12d3-a456-426614174999' }, source);
    expect(wrong.headers.get('x-edge-cache')).toBeNull();
    const bodyWrong = (await wrong.json()) as DetailBody;
    expect(bodyWrong.data.posts.list.map((p) => p.pid)).toEqual([1]);

    const again = await hit('/api/threads/2', {}, source);
    expect(again.headers.get('x-edge-cache')).toBe('HIT');
    const bodyAgain = (await again.json()) as DetailBody;
    expect(bodyAgain.data.posts.list.map((p) => p.pid)).toEqual([1]);
  });
});
