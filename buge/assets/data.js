/* ============================================================
   不鸽 · Deadline Radar —— 词典与示例数据
   纯前端、无网络请求；所有数据保存在浏览器 localStorage。
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  BG.VERSION = '1.0.0';
  BG.STORAGE_KEY = 'buge.deadline.v1';

  /* ---------- 平台词典 ---------- */
  BG.PLATFORMS = [
    {
      id: 'mooc', name: '中国大学MOOC', short: 'MOOC', color: '#2F6B4F', bg: '#E6F0E9',
      keywords: ['中国大学mooc', '大学mooc', 'mooc', '慕课', '爱课程', 'icourse163', 'icourse']
    },
    {
      id: 'chaoxing', name: '超星学习通', short: '学习通', color: '#B4552F', bg: '#F7EAE2',
      keywords: ['学习通', '超星', 'chaoxing', '泛雅', 'xuexitong']
    },
    {
      id: 'yuketang', name: '雨课堂', short: '雨课堂', color: '#38559E', bg: '#E8ECF7',
      keywords: ['雨课堂', 'yuketang', '学堂在线', '长江雨课堂']
    },
    {
      id: 'zhihuishu', name: '智慧树', short: '智慧树', color: '#6E4693', bg: '#EFE8F5',
      keywords: ['智慧树', '知到', 'zhihuishu', '翻转课堂']
    },
    {
      id: 'group', name: '班级群', short: '群消息', color: '#256E8C', bg: '#E4F0F4',
      keywords: ['qq群', '微信群', '班级群', '群里', '辅导员', '班长', '学委', '群通知', '钉钉']
    },
    {
      id: 'jw', name: '教务系统', short: '教务', color: '#8A6B2F', bg: '#F5EEDD',
      keywords: ['教务', '教务处', '正方', 'jwxt', '教学管理系统', '研究生院']
    },
    {
      id: 'manual', name: '手动添加', short: '手动', color: '#6B6F76', bg: '#EFEEEB',
      keywords: []
    }
  ];

  BG.platformById = function (id) {
    return BG.PLATFORMS.filter(function (p) { return p.id === id; })[0] || BG.PLATFORMS[BG.PLATFORMS.length - 1];
  };

  /* ---------- 任务类型 ---------- */
  BG.TYPES = [
    { id: 'homework', name: '作业', kw: ['作业', '习题', '练习', '课后题', '章节测试', '单元测验', '测验', '小测'], hours: 2 },
    { id: 'lab', name: '实验', kw: ['实验', '上机', '实训', '实验报告', '编程题'], hours: 3.5 },
    { id: 'paper', name: '论文', kw: ['论文', '报告', '综述', '读书笔记', '大作业', '课程设计'], hours: 6 },
    { id: 'exam', name: '考试', kw: ['考试', '期末', '期中', '补考', '体测'], hours: 2 },
    { id: 'present', name: '展示', kw: ['展示', '汇报', 'pre', 'ppt', '答辩', '演讲'], hours: 2.5 },
    { id: 'discuss', name: '讨论', kw: ['讨论', '互评', '回帖', '发帖', '评论'], hours: 0.5 },
    { id: 'other', name: '其他', kw: [], hours: 1 }
  ];

  BG.typeById = function (id) {
    return BG.TYPES.filter(function (t) { return t.id === id; })[0] || BG.TYPES[BG.TYPES.length - 1];
  };

  BG.typeOf = function (text) {
    var t = String(text || '').toLowerCase();
    var best = null;
    BG.TYPES.forEach(function (type) {
      type.kw.forEach(function (k) {
        if (t.indexOf(k.toLowerCase()) !== -1) {
          if (!best || k.length > best.kw.length) best = { type: type, kw: k };
        }
      });
    });
    return best ? best.type.id : 'homework';
  };

  /* ---------- 示例通知（评委可直接点“填入示例”体验） ---------- */
  BG.SAMPLE_NOTICE = [
    '【高等数学A(上)】第11周作业已发布',
    '本周作业共 8 题，请于 11月20日 23:59 前在 中国大学MOOC 提交，逾期不计分。本次作业占总评 10%。',
    '',
    '学习通 · 数据结构',
    '实验四：二叉树的遍历与线索化。请在下周三 18:00 前提交实验报告与源码，占平时分 15%，预计需要 4 小时。',
    '',
    '群通知（辅导员）',
    '各位同学：马克思主义基本原理课程论文（2000 字）截止时间为 11月27日 17:00，请交至教务系统，占期末总评 30%。'
  ].join('\n');

  /* ---------- 演示任务种子（相对“现在”生成，保证任何时间打开都成立） ---------- */
  function at(now, dayOffset, hour, minute) {
    var d = new Date(now.getTime());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  }

  BG.seedTasks = function (now) {
    now = now || new Date();
    var sem = BG.semesterStart(now);
    return [
      {
        id: 'seed-1', title: '第11周作业（8 题）', course: '高等数学A(上)', platform: 'mooc', type: 'homework',
        dueAt: at(now, 1, 23, 59), weight: 10, estHours: 2.5, progress: 30,
        note: '第 3、5、8 题不会，明天下午去找助教。', createdAt: at(now, -3, 9, 0), source: 'demo'
      },
      {
        id: 'seed-2', title: '实验四：二叉树的遍历与线索化', course: '数据结构', platform: 'chaoxing', type: 'lab',
        dueAt: at(now, 3, 18, 0), weight: 15, estHours: 4, progress: 0,
        note: '报告 + 源码打包，命名：学号_姓名_实验四。', createdAt: at(now, -2, 10, 0), source: 'demo'
      },
      {
        id: 'seed-3', title: 'Unit 5 小组展示 PPT', course: '大学英语III', platform: 'group', type: 'present',
        dueAt: at(now, 2, 14, 0), weight: 10, estHours: 3, progress: 60,
        note: '我负责第 3 部分，组内定稿前要合一次。', createdAt: at(now, -4, 20, 0), source: 'demo'
      },
      {
        id: 'seed-4', title: '实验报告 3：示波器的使用', course: '大学物理实验', platform: 'yuketang', type: 'lab',
        dueAt: at(now, 1, 8, 0), weight: 5, estHours: 1.5, progress: 20,
        note: '数据表格已拍照，图像处理还没画。', createdAt: at(now, -1, 15, 0), source: 'demo'
      },
      {
        id: 'seed-5', title: '单元测验（第 4 章）', course: '中国近现代史纲要', platform: 'zhihuishu', type: 'other',
        dueAt: at(now, -1, 23, 59), weight: 5, estHours: 0.5, progress: 0,
        note: '只有一次答题机会，40 分钟。', createdAt: at(now, -6, 8, 0), source: 'demo'
      },
      {
        id: 'seed-6', title: '课程论文（2000 字）', course: '马克思主义基本原理', platform: 'jw', type: 'paper',
        dueAt: at(now, 9, 17, 0), weight: 30, estHours: 6, progress: 0,
        note: '选题：数字劳动与人的全面发展。要求 3 篇参考文献。', createdAt: at(now, -5, 9, 0), source: 'demo'
      },
      {
        id: 'seed-7', title: '第 6 章习题', course: '数字逻辑', platform: 'mooc', type: 'homework',
        dueAt: at(now, 11, 23, 59), weight: 5, estHours: 1.5, progress: 0,
        note: '', createdAt: at(now, -1, 9, 0), source: 'demo'
      },
      {
        id: 'seed-8', title: '《活着》读书报告', course: '大学语文', platform: 'chaoxing', type: 'paper',
        dueAt: at(now, -4, 23, 59), weight: 10, estHours: 2, progress: 100,
        note: '已提交，得分 88。', createdAt: at(now, -12, 9, 0), status: 'done', source: 'demo'
      }
    ].map(function (t, i) {
      return Object.assign({ status: 'todo', progress: 0, weight: 8, estHours: 2 }, t, { order: i });
    });
  };

  /* ---------- 语义小词典：给“建议理由”用 ---------- */
  BG.TIPS = {
    overdue: '已经过期了，补救要在今天之内动手',
    critical: '不到 24 小时，先把它推到“今天必须完成”',
    heavy: '剩余工时比可用时间还多，别再往后拖',
    weight: '占总评比例高，值得优先投入',
    quick: '剩得不多，一小时以内能收尾，适合先清掉',
    later: '还有缓冲时间，按计划推进即可'
  };
})(window.BG);
