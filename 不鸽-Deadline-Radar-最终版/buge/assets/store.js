/* ============================================================
   不鸽 · 状态与数据层【最终版】
   - 本地持久化（localStorage，失败时退回内存）
   - 任务 / 周月日目标 / 社团与其他活动 的增删改
   - 统一的排程入口：BG.model.weekPlan(now)
   评分与排程的数学都放在 plan.js，这里只负责状态与导出。
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  var DAY = 86400000, HOUR = 3600000;
  var U = BG.util;
  var planner = BG.planner;

  /* ---------------- 基础计算 ---------------- */
  function remainingHours(t) { return planner.remainingHours(t); }
  function hoursLeft(t, now) { return (t.dueAt - now) / HOUR; }

  function context(now) {
    return planner.makeContext(get(), new Date(now || Date.now()));
  }

  function scoreInfo(t, now) { return planner.scoreTask(t, context(now)); }

  /* 兼容旧接口：rawScore 返回 0–1，score 返回 0–100 */
  function rawScore(t, now) { return scoreInfo(t, now).score / 100; }
  function score(t, now) { return scoreInfo(t, now).score; }
  function reason(t, now) { return scoreInfo(t, now).reason; }
  function quadrant(t, now) {
    var info = scoreInfo(t, now);
    return planner.QUADRANTS[info.quadrant];
  }

  function bucket(t, now) {
    if (t.status === 'done') return 'done';
    var hl = hoursLeft(t, now);
    if (hl < 0) return 'overdue';
    if (hl <= 24) return 'critical';
    if (hl <= 72) return 'soon';
    if (hl <= 168) return 'week';
    return 'later';
  }

  /* ---------------- 学习计划 ---------------- */
  function weekPlan(now) {
    return planner.buildWeek(get(), new Date(now || Date.now()));
  }

  /* 旧版单日接口（保留给外部调用与旧测试） */
  function buildPlan(tasks, now, settings) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    var s = get();
    var plan = planner.buildWeek({
      tasks: tasks,
      goals: s.goals,
      activities: s.activities,
      settings: settings || s.settings
    }, now);
    var day = plan.days[0];
    var blocks = day.blocks.filter(function (b) { return b.kind !== 'activity'; })
      .map(function (b) {
        return {
          taskId: b.taskId, goalId: b.goalId, kind: b.kind,
          start: new Date(b.start), end: new Date(b.end), hours: b.minutes / 60
        };
      });
    return {
      blocks: blocks,
      scheduledHours: day.plannedMinutes / 60,
      totalNeeded: plan.stats.neededHours,
      overflow: plan.stats.overflowHours,
      budget: (settings || s.settings).dailyHours || 3,
      late: day.late
    };
  }

  function goalProgress(goal, tasks) {
    return planner.goalProgress(goal, tasks || get().tasks);
  }

  /* ---------------- 提醒 ---------------- */
  var OFFSETS = [
    { ms: -72 * HOUR, label: '提前 3 天' },
    { ms: -24 * HOUR, label: '提前 1 天' },
    { ms: -6 * HOUR, label: '提前 6 小时' },
    { ms: -1 * HOUR, label: '提前 1 小时' }
  ];

  function reminders(tasks, now) {
    var out = [];
    tasks.forEach(function (t) {
      if (t.status === 'done') return;
      OFFSETS.forEach(function (o) {
        var at = t.dueAt + o.ms;
        if (at > now - 30 * 60000 && at < now + 14 * DAY) {
          out.push({ task: t, at: at, label: o.label, kind: o.ms === -72 * HOUR ? 'early' : 'near' });
        }
      });
      if (t.dueAt > now - 30 * 60000 && t.dueAt < now + 14 * DAY) {
        out.push({ task: t, at: t.dueAt, label: '截止', kind: 'due' });
      }
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /* ---------------- 周负荷 ---------------- */
  function weeklyLoad(tasks, now, settings) {
    var end = now + 7 * DAY;
    var list = tasks.filter(function (t) {
      return t.status !== 'done' && t.dueAt < end;
    });
    var need = list.reduce(function (s, t) { return s + remainingHours(t); }, 0);
    var cap = (settings.dailyHours || 3) * 7;
    var perDay = [];
    for (var i = 0; i < 7; i++) {
      var d0 = U.startOfDay(new Date(now + i * DAY)).getTime();
      var d1 = d0 + DAY;
      var count = tasks.filter(function (t) {
        return t.status !== 'done' && t.dueAt >= d0 && t.dueAt < d1;
      }).length;
      perDay.push(count);
    }
    return {
      need: need, cap: cap, ratio: cap ? need / cap : 0,
      count: list.length, perDay: perDay,
      overload: need > cap * 0.85
    };
  }

  function stats(tasks, now) {
    var open = tasks.filter(function (t) { return t.status !== 'done'; });
    var todayEnd = U.startOfDay(new Date(now)).getTime() + DAY;
    return {
      open: open.length,
      overdue: open.filter(function (t) { return t.dueAt < now; }).length,
      today: open.filter(function (t) { return t.dueAt >= now && t.dueAt < todayEnd; }).length,
      week: open.filter(function (t) { return t.dueAt < now + 7 * DAY; }).length,
      done: tasks.filter(function (t) { return t.status === 'done'; }).length,
      total: tasks.length
    };
  }

  /* ---------------- .ics 导出 ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsTime(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function toIcs(tasks) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BuGe//Deadline Radar//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:不鸽 · 作业截止'
    ];
    tasks.filter(function (t) { return t.status !== 'done'; }).forEach(function (t) {
      var p = BG.platformById(t.platform);
      var start = t.dueAt - 30 * 60000;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:buge-' + t.id + '@local');
      lines.push('DTSTAMP:' + icsTime(Date.now()));
      lines.push('DTSTART:' + icsTime(start));
      lines.push('DTEND:' + icsTime(t.dueAt));
      lines.push('SUMMARY:' + icsEscape('【' + p.short + '】' + t.course + ' · ' + t.title));
      lines.push('DESCRIPTION:' + icsEscape('截止 ' + U.fmtDateTime(t.dueAt) + (t.weight ? ' · 占总评 ' + t.weight + '%' : '') + (t.note ? '\n' + t.note : '')));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT6H');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('6 小时后截止：' + t.course + ' · ' + t.title));
      lines.push('END:VALARM');
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-P1D');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('明天截止：' + t.course + ' · ' + t.title));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /* ---------------- 存储 ---------------- */
  var KEY = BG.STORAGE_KEY;
  var memory = null;
  var state = null;

  function defaultSettings(now) {
    return {
      dailyHours: 3,
      semesterStart: BG.semesterStart(now).getTime(),
      notify: false,
      seeded: false,
      /* 最终版：紧急/重要总占比 + 绩点 / 学分 / 学校要求 / 职业规划 / 重要性占比 */
      gpaCurrent: 3.42,
      gpaTarget: 3.72,
      gpaScale: 4,
      creditsEarned: 0,
      creditsRequired: 0,
      schoolRequirement: '',
      careerGoal: '',
      importanceWeights: { gpa: 30, credits: 30, career: 40 },
      priorityWeights: { urgency: 60, importance: 40 },
      profileName: '',
      profileAt: 0,
      goalMinutes: 45,
      wake: '07:30',
      sleep: '23:00'
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function normalize(t) {
    return {
      id: t.id, title: t.title || '未命名任务', course: t.course || '未分类', platform: t.platform || 'manual',
      type: t.type || 'homework', dueAt: t.dueAt, weight: t.weight == null ? null : Number(t.weight),
      credits: t.credits == null ? 2 : Number(t.credits),
      importance: clamp(t.importance == null ? 2 : Number(t.importance), 1, 3),
      career: !!t.career,
      goalId: t.goalId || null,
      estHours: t.estHours || 2, progress: t.progress || 0, note: t.note || '',
      status: t.status || 'todo', createdAt: t.createdAt || Date.now(), source: t.source || 'manual'
    };
  }

  function normalizeGoal(g) {
    return {
      id: g.id,
      title: g.title || '未命名目标',
      scope: /^(day|week|month)$/.test(g.scope) ? g.scope : 'week',
      targetHours: Math.max(0, Number(g.targetHours) || 2),
      progress: clamp(Number(g.progress) || 0, 0, 100),
      importance: clamp(g.importance == null ? 2 : Number(g.importance), 1, 3),
      course: g.course || '',
      deadline: Number(g.deadline) || 0,
      createdAt: g.createdAt || Date.now()
    };
  }

  function normalizeActivity(a) {
    var day = Number(a.day);
    return {
      id: a.id,
      title: a.title || '固定安排',
      kind: a.kind === 'other' ? 'other' : 'club',
      day: day >= 1 && day <= 7 ? day : 1,
      start: /^\d{1,2}:\d{2}$/.test(a.start) ? a.start : '18:30',
      end: /^\d{1,2}:\d{2}$/.test(a.end) ? a.end : '20:00',
      repeat: a.repeat === 'once' ? 'once' : 'weekly',
      weeks: a.weeks ? clamp(Number(a.weeks) || 1, 1, 52) : 0,
      startWeek: Number(a.startWeek) || 0,
      date: a.date || '',
      place: a.place || ''
    };
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      memory = JSON.parse(JSON.stringify(state));
    }
  }

  function seedState(now) {
    var d = new Date(now);
    var settings = defaultSettings(d);
    /* 示例里先放一份职业规划与学分档案，方便演示；用户可以随时清空 */
    settings.careerGoal = BG.IMPORTANCE_SEED || '';
    settings.creditsEarned = 96;
    settings.creditsRequired = 160;
    settings.schoolRequirement = '毕业需 160 学分；保研/奖学金参考绩点 3.5 以上';
    return {
      tasks: BG.seedTasks(d).map(normalize),
      goals: (BG.seedGoals ? BG.seedGoals(d) : []).map(normalizeGoal),
      activities: (BG.seedActivities ? BG.seedActivities(d) : []).map(normalizeActivity),
      settings: settings,
      version: BG.VERSION
    };
  }

  function load(now) {
    now = now || Date.now();
    var parsed = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) { parsed = memory; }

    if (parsed && parsed.tasks) {
      var settings = Object.assign(defaultSettings(new Date(now)), parsed.settings || {});
      settings.importanceWeights = Object.assign(
        {}, BG.DEFAULT_WEIGHTS, (parsed.settings || {}).importanceWeights || {}
      );
      settings.priorityWeights = Object.assign(
        {}, BG.DEFAULT_PRIORITY, (parsed.settings || {}).priorityWeights || {}
      );
      state = {
        tasks: (parsed.tasks || []).map(normalize),
        goals: (parsed.goals || []).map(normalizeGoal),
        activities: (parsed.activities || []).map(normalizeActivity),
        settings: settings,
        version: BG.VERSION
      };
    } else {
      state = seedState(now);
      state.settings.seeded = true;
      persist();
    }
    return state;
  }

  function get() { return state || load(); }

  function addDrafts(drafts, now) {
    now = now || Date.now();
    var s = get();
    var added = 0, skipped = 0;
    drafts.forEach(function (d) {
      var dup = s.tasks.some(function (t) {
        return t.course === d.course && t.title === d.title &&
          Math.abs(t.dueAt - d.dueAt) < 60 * 60000;
      });
      if (dup) { skipped++; return; }
      s.tasks.push(normalize(Object.assign({}, d, {
        id: 't-' + BG.hash(d.course + d.title + d.dueAt + Math.random()),
        createdAt: now, status: 'todo', progress: 0, source: 'import'
      })));
      added++;
    });
    persist();
    return { added: added, skipped: skipped };
  }

  function update(id, patch) {
    var s = get();
    s.tasks = s.tasks.map(function (t) {
      if (t.id !== id) return t;
      var next = Object.assign({}, t, patch);
      if (patch.status === 'done') next.progress = 100;
      if (patch.progress === 100) next.status = 'done';
      if (patch.status === 'todo' && t.status === 'done' && patch.progress == null) next.progress = 0;
      return normalize(next);
    });
    persist();
  }

  function remove(id) {
    var s = get();
    s.tasks = s.tasks.filter(function (t) { return t.id !== id; });
    persist();
  }

  function setSettings(patch) {
    var s = get();
    s.settings = Object.assign({}, s.settings, patch);
    persist();
  }

  /* ---------------- 目标 CRUD ---------------- */
  function addGoal(draft, now) {
    now = now || Date.now();
    var s = get();
    var g = normalizeGoal(Object.assign({}, draft, {
      id: 'g-' + BG.hash(String(draft.title || '') + now + Math.random()),
      createdAt: now
    }));
    s.goals.push(g);
    persist();
    return g;
  }

  function updateGoal(id, patch) {
    var s = get();
    s.goals = s.goals.map(function (g) {
      return g.id === id ? normalizeGoal(Object.assign({}, g, patch)) : g;
    });
    persist();
  }

  function removeGoal(id) {
    var s = get();
    s.goals = s.goals.filter(function (g) { return g.id !== id; });
    s.tasks = s.tasks.map(function (t) {
      return t.goalId === id ? Object.assign({}, t, { goalId: null }) : t;
    });
    persist();
  }

  /* ---------------- 社团 / 固定安排 CRUD ---------------- */
  function addActivity(draft) {
    var s = get();
    var next = Object.assign({}, draft);
    if (next.repeat !== 'once' && !next.startWeek) {
      next.startWeek = U.mondayOf(new Date()).getTime();
    }
    var a = normalizeActivity(Object.assign(next, {
      id: 'a-' + BG.hash(String(draft.title || '') + Date.now() + Math.random())
    }));
    s.activities.push(a);
    persist();
    return a;
  }

  function updateActivity(id, patch) {
    var s = get();
    s.activities = s.activities.map(function (a) {
      if (a.id !== id) return a;
      var merged = Object.assign({}, a, patch);
      if (merged.repeat !== 'once' && !merged.startWeek) {
        merged.startWeek = U.mondayOf(new Date()).getTime();
      }
      return normalizeActivity(merged);
    });
    persist();
  }

  function removeActivity(id) {
    var s = get();
    s.activities = s.activities.filter(function (a) { return a.id !== id; });
    persist();
  }

  function resetDemo(now) {
    now = now || Date.now();
    state = seedState(now);
    persist();
  }

  function clearAll() {
    var s = get();
    s.tasks = [];
    s.goals = [];
    s.activities = [];
    persist();
  }

  BG.model = {
    remainingHours: remainingHours,
    hoursLeft: hoursLeft,
    rawScore: rawScore,
    score: score,
    reason: reason,
    quadrant: quadrant,
    bucket: bucket,
    context: context,
    weekPlan: weekPlan,
    goalProgress: goalProgress,
    buildPlan: buildPlan,
    reminders: reminders,
    weeklyLoad: weeklyLoad,
    stats: stats,
    toIcs: toIcs
  };

  BG.store = {
    load: load,
    get: get,
    addDrafts: addDrafts,
    update: update,
    remove: remove,
    setSettings: setSettings,
    addGoal: addGoal,
    updateGoal: updateGoal,
    removeGoal: removeGoal,
    addActivity: addActivity,
    updateActivity: updateActivity,
    removeActivity: removeActivity,
    resetDemo: resetDemo,
    clearAll: clearAll,
    persist: persist
  };
})(window.BG);
