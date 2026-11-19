/* ============================================================
   不鸽 · Deadline Radar —— 词典与示例数据【最终版】
   纯前端、无网络请求；所有数据保存在浏览器 localStorage。
   最终版：新增「紧急度 / 重要度占比」滑杆（默认 6:4，可调 7:3 / 5:5）；
   原「静室」改名为「音乐」；三版的重要性占比（绩点 / 学分 / 职业规划）、
   职业规划卡、固定安排持续周数、学校绩点学分文件导入全部保留。
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  BG.VERSION = '2.4.0-final';
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

  /* ---------- 手动重要程度 ---------- */
  BG.IMPORTANCE = [
    { v: 1, name: '一般' },
    { v: 2, name: '重要' },
    { v: 3, name: '关键' }
  ];

  BG.importanceName = function (v) {
    return (BG.IMPORTANCE.filter(function (x) { return x.v === Number(v); })[0] || BG.IMPORTANCE[1]).name;
  };

  /* ---------- 重要性的三个来源（最终版：可分别调占比） ---------- */
  BG.IMPORTANCE_FACTORS = [
    { id: 'gpa', name: '绩点', desc: '占总评比例越高、离目标绩点越远，这项越重' },
    { id: 'credits', name: '课程学分', desc: '课程学分越高，投入越值' },
    { id: 'career', name: '职业规划', desc: '任务是否明确服务于你的职业规划目标' }
  ];

  BG.DEFAULT_WEIGHTS = { gpa: 30, credits: 30, career: 40 };
  BG.DEFAULT_PRIORITY = { urgency: 60, importance: 40 };

  BG.IMPORTANCE_SEED = '成为算法工程师：先把数据结构、算法和项目经历打牢';

  /* ---------- 周 / 月 / 日目标 ---------- */
  function endOfWeek(now) {
    var d = new Date(now);
    d.setHours(0, 0, 0, 0);
    var wd = (d.getDay() + 6) % 7; // 周一 = 0
    d.setDate(d.getDate() + (6 - wd));
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  }
  function endOfMonth(now) {
    var d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 0, 0).getTime();
  }
  function endOfToday(now) {
    var d = new Date(now);
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  }

  BG.seedGoals = function (now) {
    now = now || new Date();
    return [
      {
        id: 'goal-w1', title: '实验四：报告 + 源码一起交掉', scope: 'week',
        targetHours: 4, progress: 0, importance: 3, course: '数据结构',
        deadline: endOfWeek(now), createdAt: now.getTime()
      },
      {
        id: 'goal-m1', title: '马原论文拿到 85 分以上', scope: 'month',
        targetHours: 6, progress: 0, importance: 3, course: '马克思主义基本原理',
        deadline: endOfMonth(now), createdAt: now.getTime()
      },
      {
        id: 'goal-d1', title: '每天 30 分钟六级听力', scope: 'day',
        targetHours: 0.5, progress: 0, importance: 2, course: '大学英语III',
        deadline: endOfToday(now), createdAt: now.getTime()
      }
    ];
  };

  /* ---------- 固定安排类型 ---------- */
  BG.ACTIVITY_KINDS = [
    { id: 'club', name: '社团活动', short: '社团' },
    { id: 'other', name: '其他活动', short: '其他' }
  ];

  BG.activityKind = function (id) {
    return BG.ACTIVITY_KINDS.filter(function (k) { return k.id === id; })[0] || BG.ACTIVITY_KINDS[0];
  };

  /* ---------- 社团与固定安排（每周重复，可设持续周数） ---------- */
  BG.seedActivities = function (now) {
    now = now || new Date();
    var ws = new Date(now);
    ws.setHours(0, 0, 0, 0);
    var wd = (ws.getDay() + 6) % 7;
    ws.setDate(ws.getDate() - wd);
    var startWeek = ws.getTime();
    return [
      { id: 'act-1', title: '篮球社训练', kind: 'club', day: 4, start: '18:30', end: '20:00', repeat: 'weekly', weeks: 16, startWeek: startWeek, place: '东区篮球场' },
      { id: 'act-2', title: '学生会例会', kind: 'club', day: 2, start: '19:00', end: '20:30', repeat: 'weekly', weeks: 16, startWeek: startWeek, place: '学生活动中心 302' },
      { id: 'act-3', title: '家教', kind: 'other', day: 6, start: '10:00', end: '12:00', repeat: 'weekly', weeks: 16, startWeek: startWeek, place: '线上' },
      { id: 'act-4', title: '人工智能前沿讲座', kind: 'other', day: 3, start: '19:00', end: '20:30', repeat: 'weekly', weeks: 8, startWeek: startWeek, place: '图书馆报告厅' }
    ];
  };

  /* ---------- 音乐曲库 ----------
     内置曲目全部由浏览器 Web Audio 实时合成，离线可播；
     在线 CC0 曲库（Open Lo-Fi）的入口放在播放器里，学生可下载后导入。 */
  BG.MUSIC_TRACKS = [
    { id: 'rain-window', title: '雨落窗台', genre: '雨声 · 白噪', recipe: 'rain', desc: '细密的雨，适合阅读和写作业' },
    { id: 'pink-focus', title: '粉噪专注', genre: '粉红噪音', recipe: 'pink', desc: '比白噪更柔，长时间听不刺耳' },
    { id: 'night-train', title: '深夜列车', genre: '棕噪 · 低音铺底', recipe: 'train', desc: '像夜里缓慢行驶的列车' },
    { id: 'morning-cafe', title: '清晨咖啡', genre: '暖噪 · 和弦', recipe: 'cafe', desc: '有一点咖啡店底噪的晨间氛围' },
    { id: 'ocean-breath', title: '海浪呼吸', genre: '海浪 · 慢呼吸', recipe: 'ocean', desc: '一波一波，适合 4-7-8 呼吸' }
  ];

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
    /* 课程学分 / 职业规划关联 / 目标关联：让示例一打开就有上下文 */
    var credits = { 'seed-1': 5, 'seed-2': 4, 'seed-3': 3, 'seed-4': 1, 'seed-5': 3, 'seed-6': 3, 'seed-7': 3, 'seed-8': 2 };
    var importance = { 'seed-1': 2, 'seed-2': 3, 'seed-3': 2, 'seed-4': 2, 'seed-5': 1, 'seed-6': 3, 'seed-7': 2, 'seed-8': 1 };
    var careerTasks = { 'seed-1': true, 'seed-2': true, 'seed-7': true };
    var goalLink = { 'seed-2': 'goal-w1', 'seed-6': 'goal-m1' };
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
      return Object.assign({
        status: 'todo', progress: 0, weight: 8, estHours: 2,
        credits: credits[t.id] || 2, importance: importance[t.id] || 2,
        career: !!careerTasks[t.id], goalId: goalLink[t.id] || null
      }, t, { order: i });
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
