/* 解析引擎的回归测试：node tests/parser.test.js */
global.window = global;
require('../assets/data.js');
require('../assets/parser.js');
const BG = global.BG;

const NOW = new Date('2026-11-18T10:00:00+08:00');
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

function p(text) { return BG.parseNotices(text, { now: NOW }); }
function iso(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

console.log('\n== 1. 三段混排通知 ==');
{
  const r = p(BG.SAMPLE_NOTICE);
  check('分成 3 条', r.drafts.length === 3, '实际 ' + r.drafts.length);
  const [a, b, c] = r.drafts;
  r.drafts.forEach(d => console.log('   ', [d.course, d.title, iso(d.dueAt), d.platform, d.weight, d.estHours].join(' | ')));
  check('第1条课程', a && a.course === '高等数学A(上)', a && a.course);
  check('第1条截止 11-20 23:59', a && iso(a.dueAt) === '2026-11-20 23:59', a && iso(a.dueAt));
  check('第1条平台 mooc', a && a.platform === 'mooc', a && a.platform);
  check('第1条占比 10', a && a.weight === 10, a && a.weight);
  check('第2条课程 数据结构', b && b.course === '数据结构', b && b.course);
  check('第2条下周三是 11-25 18:00', b && iso(b.dueAt) === '2026-11-25 18:00', b && iso(b.dueAt));
  check('第2条占比 15', b && b.weight === 15, b && b.weight);
  check('第2条工时 4h', b && b.estHours === 4, b && b.estHours);
  check('第3条 11-27 17:00', c && iso(c.dueAt) === '2026-11-27 17:00', c && iso(c.dueAt));
  check('第3条占比 30', c && c.weight === 30, c && c.weight);
  check('第3条课程', c && c.course === '马克思主义基本原理', c && c.course);
  check('第3条平台取提交去处「教务系统」', c && c.platform === 'jw', c && c.platform);
}

console.log('\n== 2. 各种时间写法 ==');
const cases = [
  ['请于11月20日23:59前提交', '2026-11-20 23:59'],
  ['截止时间：2026/12/3 17:00', '2026-12-03 17:00'],
  ['本周五 12:00 前交', '2026-11-20 12:00'],
  ['下周一上午9点前', '2026-11-23 09:00'],
  ['11.25 前提交实验报告', '2026-11-25 23:59'],
  ['明天下午5点前发群里', '2026-11-19 17:00'],
  ['今晚24点前', '2026-11-18 23:59'],
  ['第13周周三 18:00', '2026-11-25 18:00'],
  ['12月5日晚上8点', '2026-12-05 20:00'],
  ['2027年1月5日 10:00', '2027-01-05 10:00']
];
cases.forEach(([text, want]) => {
  const r = p(text);
  const got = r.drafts[0] ? iso(r.drafts[0].dueAt) : 'none';
  check(text + ' → ' + want, got === want, got);
});

console.log('\n== 3. 缺时间 / 空输入 ==');
{
  const r = p('请大家按时完成作业');
  check('无时间 → failed', r.drafts.length === 0 && r.failed.length === 1);
  const e = p('   ');
  check('空白 → 0 条', e.drafts.length === 0 && e.blockCount === 0);
}

console.log('\n== 4. 单条带编号的通知 ==');
{
  const text = `【数据结构】实验五
1. 请于 12 月 2 日 23:59 前提交实验报告，占平时分 20%
2. 下周四 10:00 进行上机验收`;
  const r = p(text);
  r.drafts.forEach(d => console.log('   ', [d.course, d.title, iso(d.dueAt)].join(' | ')));
  check('拆成 2 条', r.drafts.length === 2, '实际 ' + r.drafts.length);
  check('两条都继承课程', r.drafts.every(d => d.course === '数据结构'));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
