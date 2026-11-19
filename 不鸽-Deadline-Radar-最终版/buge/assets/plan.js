/* ============================================================
   不鸽 · 学习计划引擎（planner）【最终版】
   纯函数：不碰 DOM、不读 localStorage，浏览器和 Node 都能直接跑。
   ------------------------------------------------------------
   排序 —— 艾森豪威尔矩阵：紧急度 60% + 重要度 40%

     紧急度 U = 60% × 时间余量紧迫 + 40% × 截止临近
       时间余量紧迫 = 剩余工时 ≥ 剩余时间 ? 1 : e^(−(剩余时间−剩余工时)/60)
       截止临近     = 1 / (1 + 剩余小时 / 36)

     重要度 I = 40% × 成绩占比 + 20% × 课程学分 + 20% × 绩点压力
              + 12% × 关联周/月目标 + 8% × 手动重要程度
       绩点压力 = clamp((目标绩点 − 当前绩点) / 0.6, 0, 1) × 成绩占比

     优先级 = 100 × (60% × U + 40% × I)

   排程 —— 参考大众学习习惯：
     · 先扣掉饭点（12:00–13:30 午饭午休、18:00–19:00 晚饭）、作息和社团/固定安排
     · 45 分钟一块、块间休息 10 分钟；每天按预算封顶（周末多 1 小时）
     · 按优先级从高到低排；任务在截止前留出缓冲，长任务往前摊开
     · 每天给「重要不紧急」的周/月目标留固定 45 分钟，日目标每天一块
     · 高难度任务优先上午/晚上，碎片任务放到午后低谷
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  var DAY = 86400000, HOUR = 3600000, MIN = 60000;

  var DEFAULTS = {
    dailyHours: 3,          /* 每天可投入学习时间 */
    weekendBonus: 1,        /* 周末额外容量（小时） */
    wake: '07:30',          /* 起床 */
    sleep: '23:00',         /* 最晚学习到几点 */
    goalMinutes: 45,        /* 每天留给周/月目标的时间 */
    gpaCurrent: 3.4,
    gpaTarget: 3.7,
    gpaScale: 4,
    focusMinutes: 45,       /* 一块专注 */
    breakMinutes: 10,       /* 块间休息 */
    minBlockMinutes: 20,    /* 小于 20 分钟不单独占一块 */
    horizonDays: 7
  };

  /* 午饭 + 午休、晚饭 —— 大众作息里最容易被打断的两段时间 */
  var LUNCH = [12 * 60, 13 * 60 + 30];
  var DINNER = [18 * 60, 19 * 60];

  var QUADRANTS = {
    do:    { id: 'do',    name: '紧急且重要', action: '马上做', hint: '先做它，别排到明天' },
    plan:  { id: 'plan',  name: '重要不紧急', action: '计划做', hint: '每天固定给它一段时间' },
    quick: { id: 'quick', name: '紧急不重要', action: '顺手做', hint: '集中 25 分钟一起清掉' },
    later: { id: 'later', name: '不紧急不重要', action: '有空做', hint: '有余力再碰，别占黄金时段' }
  };

  var DEEP_TYPES = { paper: 1, lab: 1, exam: 1, present: 1 };
  var LIGHT_TYPES = { discuss: 1, other: 1 };

  /* ---------------- 小工具 ---------------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function atClock(day, h, m) { var d = new Date(day.getTime()); d.setHours(h, m, 0, 0); return d; }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
      (d.getDate() < 10 ? '0' : '') + d.getDate();
  }
  function toMinutes(hhmm, fallback) {
    var m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(hhmm || ''));
    if (!m) return fallback;
    return clamp(parseInt(m[1], 10), 0, 23) * 60 + clamp(parseInt(m[2], 10), 0, 59);
  }
  function humanHours(h) {
    if (!isFinite(h)) return '—';
    if (h <= 0) return '0 分钟';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分钟';
    return (Math.round(h * 10) / 10) + ' 小时';
  }
  function energyOf(ts) {
    var d = new Date(ts);
    var m = d.getHours() * 60 + d.getMinutes();
    if (m < 12 * 60) return 'high';        /* 上午：适合攻坚 */
    if (m < 16 * 60) return 'low';         /* 午后低谷：适合碎片任务 */
    if (m < 18 * 60) return 'mid';
    if (m < 20 * 60) return 'low';         /* 刚吃完晚饭 */
    return 'mid';                          /* 晚间：第二段专注 */
  }
  var ENERGY_LABEL = { high: '黄金时段', mid: '次高峰', low: '低谷时段' };

  function remainingHours(t) {
    var p = clamp(num(t.progress, 0), 0, 100);
    return Math.max(0, num(t.estHours, 0) * (1 - p / 100));
  }

  function todayStart(now) { return startOfDay(new Date(now)); }

  function endOfWeek(now) {
    var d = startOfDay(new Date(now));
    var wd = (d.getDay() + 6) % 7; /* 周一 = 0 */
    d.setDate(d.getDate() + (6 - wd));
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  }
  function endOfMonth(now) {
    var d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 0, 0).getTime();
  }

  function goalDeadline(goal, now) {
    if (goal.deadline) return goal.deadline;
    if (goal.scope === 'week') return endOfWeek(now);
    if (goal.scope === 'month') return endOfMonth(now);
    var d = new Date(now);
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  }

  /* 目标进度：有关联任务就按任务完成度自动算，否则用手动进度 */
  function goalProgress(goal, tasks) {
    var linked = (tasks || []).filter(function (t) { return t.goalId === goal.id; });
    if (!linked.length) return clamp(num(goal.progress, 0), 0, 100);
    var total = 0, weighted = 0;
    linked.forEach(function (t) {
      var w = Math.max(0.5, num(t.estHours, 1));
      total += w;
      weighted += w * (t.status === 'done' ? 100 : clamp(num(t.progress, 0), 0, 100));
    });
    return total ? Math.round(weighted / total) : 0;
  }

  function linkedOpenHours(goal, tasks) {
    return (tasks || []).filter(function (t) {
      return t.goalId === goal.id && t.status !== 'done';
    }).reduce(function (a, t) { return a + remainingHours(t); }, 0);
  }

  /* ---------------- 优先级 ---------------- */
  function makeContext(state, now) {
    state = state || {};
    var s = Object.assign({}, DEFAULTS, state.settings || {});
    Object.keys(DEFAULTS).forEach(function (k) {
      if (typeof DEFAULTS[k] === 'number') s[k] = num(s[k], DEFAULTS[k]);
    });
    var tasks = (state.tasks || []).filter(Boolean);
    var goals = (state.goals || []).filter(Boolean);
    var activities = (state.activities || []).filter(Boolean);
    var goalById = {};
    goals.forEach(function (g) { goalById[g.id] = g; });
    var ts = now instanceof Date ? now.getTime() : num(now, Date.now());
    return { now: ts, settings: s, tasks: tasks, goals: goals, activities: activities, goalById: goalById };
  }

  /* 最终版：紧急/重要总占比，用户可在设置里滑动 */
  function priorityWeights(s) {
    var raw = s.priorityWeights || {};
    var urgency = clamp(num(raw.urgency, 60), 0, 100);
    var importance = clamp(num(raw.importance, 40), 0, 100);
    var sum = urgency + importance;
    if (sum <= 0) { urgency = 60; importance = 40; sum = 100; }
    return {
      urgency: urgency / sum,
      importance: importance / sum,
      raw: { urgency: urgency, importance: importance }
    };
  }

  /* 最终版：重要性的三个来源按设置里的占比归一化；没填职业规划就不计入 */
  function importanceWeights(s) {
    var raw = s.importanceWeights || {};
    var gpa = clamp(num(raw.gpa, 30), 0, 100);
    var credits = clamp(num(raw.credits, 30), 0, 100);
    var career = clamp(num(raw.career, 40), 0, 100);
    var hasCareer = String(s.careerGoal || '').trim().length > 0;
    if (!hasCareer) career = 0;
    var sum = gpa + credits + career;
    if (sum <= 0) {
      gpa = hasCareer ? 30 : 50;
      credits = hasCareer ? 30 : 50;
      career = hasCareer ? 40 : 0;
      sum = gpa + credits + career;
    }
    return {
      gpa: gpa / sum,
      credits: credits / sum,
      career: career / sum,
      hasCareer: hasCareer,
      raw: { gpa: gpa, credits: credits, career: career }
    };
  }

  function scoreTask(t, ctx) {
    var s = ctx.settings;
    var hl = (t.dueAt - ctx.now) / HOUR;
    var rem = remainingHours(t);
    var overdue = hl <= 0;

    /* 剩下的时间里，先扣掉这件事要用的工时，看还有多少余量 */
    var spareUrgency = overdue ? 1 : (rem >= hl ? 1 : Math.exp(-(hl - rem) / 60));
    var proximity = overdue ? 1 : 1 / (1 + Math.max(0, hl) / 36);
    var urgency = overdue ? 1 : clamp(0.6 * spareUrgency + 0.4 * proximity, 0, 1);

    var weight = num(t.weight, 8);
    var stakes = clamp(weight / 40, 0, 1);
    var gap = clamp((num(s.gpaTarget, 0) - num(s.gpaCurrent, 0)) /
      Math.max(1, num(s.gpaScale, 4)) / 0.15, 0, 1);
    var w = importanceWeights(s);
    var gpaFactor = clamp(stakes * (0.7 + 0.3 * gap), 0, 1);
    var creditFactor = clamp(num(t.credits, 2) / 4, 0, 1);
    var careerFactor = (w.hasCareer && t.career) ? 1 : 0;
    var importance = clamp(w.gpa * gpaFactor + w.credits * creditFactor + w.career * careerFactor, 0, 1);

    var quadrant = urgency >= 0.55 ? (importance >= 0.55 ? 'do' : 'quick')
      : (importance >= 0.55 ? 'plan' : 'later');
    var pw = priorityWeights(s);
    var score = Math.round(100 * (pw.urgency * urgency + pw.importance * importance));

    var parts = [];
    if (overdue) parts.push('已逾期，今天先补');
    else parts.push('剩 ' + humanHours(hl) + '，还需 ' + humanHours(rem));
    if (weight >= 20) parts.push('占总评 ' + weight + '%');
    if (num(t.credits, 0) >= 3) parts.push(num(t.credits, 0) + ' 学分');
    if (w.hasCareer && t.career) parts.push('服务职业规划');
    parts.push(QUADRANTS[quadrant].hint);

    return {
      score: score,
      urgency: urgency,
      importance: importance,
      quadrant: quadrant,
      overdue: overdue,
      hoursLeft: hl,
      remaining: rem,
      deep: !!DEEP_TYPES[t.type],
      light: !!LIGHT_TYPES[t.type],
      reason: parts.join(' · ')
    };
  }

  function scopeName(scope) { return scope === 'month' ? '本月' : scope === 'day' ? '每日' : '本周'; }

  function scoreGoal(goal, ctx) {
    var deadline = goalDeadline(goal, ctx.now);
    var daysLeft = Math.max(0, (deadline - ctx.now) / DAY);
    var urgency, importance;
    if (goal.scope === 'day') {
      /* 每日习惯：固定一块，不跟急事抢早晨，放到午后/晚间低谷 */
      urgency = 0.46;
      importance = 0.52 + 0.08 * (clamp(num(goal.importance, 2), 1, 3) - 1);
    } else {
      urgency = 1 / (1 + daysLeft / 8);
      importance = 0.52 + 0.08 * (clamp(num(goal.importance, 2), 1, 3) - 1) + (goal.scope === 'week' ? 0.04 : 0);
    }
    var score = Math.round(100 * (0.55 * urgency + 0.45 * importance));
    return {
      score: score,
      urgency: urgency,
      importance: importance,
      deadline: deadline,
      reason: scopeName(goal.scope) + '目标 · 还差 ' + Math.max(0, daysLeft).toFixed(0) + ' 天到截止'
    };
  }

  /* ---------------- 一天的可用窗口 ---------------- */
  function activityInWeeks(a, date) {
    if (!a.startWeek) return true;
    var start = startOfDay(new Date(a.startWeek)).getTime();
    var day = startOfDay(date).getTime();
    var diff = Math.floor((day - start) / (7 * DAY));
    var weeks = num(a.weeks, 0);
    if (weeks <= 0) return true;
    return diff >= 0 && diff < weeks;
  }

  function activitiesOn(activities, date, now) {
    var out = [];
    var wd = (date.getDay() + 6) % 7 + 1; /* 周一 = 1 */
    var key = dayKey(date.getTime());
    (activities || []).forEach(function (a) {
      var hit = a.repeat === 'once'
        ? (a.date === key)
        : (num(a.day, wd) === wd && activityInWeeks(a, date));
      if (!hit) return;
      var smin = toMinutes(a.start, -1);
      var emin = toMinutes(a.end, -1);
      if (smin < 0 || emin < 0 || emin <= smin) return;
      out.push({
        id: a.id,
        title: a.title || '固定安排',
        place: a.place || '',
        kind: a.kind === 'other' ? 'other' : 'club',
        start: atClock(date, Math.floor(smin / 60), smin % 60).getTime(),
        end: atClock(date, Math.floor(emin / 60), emin % 60).getTime(),
        minutes: emin - smin,
        repeat: a.repeat || 'weekly',
        weeks: num(a.weeks, 0)
      });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  function cutWindow(w, aStart, aEnd) {
    var ws = w.start.getTime(), we = w.end.getTime();
    if (aEnd <= ws || aStart >= we) return [w];
    var out = [];
    if (aStart > ws) out.push({ start: new Date(ws), end: new Date(Math.min(aStart, we)) });
    if (aEnd < we) out.push({ start: new Date(Math.max(aEnd, ws)), end: new Date(we) });
    out.forEach(function (x) { x.cursor = new Date(x.start.getTime()); });
    return out;
  }

  function makeDay(index, ctx) {
    var s = ctx.settings;
    var today = todayStart(ctx.now);
    var date = addDays(today, index);
    var weekday = date.getDay();
    var weekend = weekday === 0 || weekday === 6;
    var budgetMin = Math.round((num(s.dailyHours, 3) + (weekend ? num(s.weekendBonus, 0) : 0)) * 60);
    budgetMin = clamp(budgetMin, 30, 8 * 60);

    var wakeMin = toMinutes(s.wake, 450) + 30;               /* 起床后 30 分钟早餐 */
    if (weekend) wakeMin += 45;                              /* 周末晚起 45 分钟 */
    var sleepMin = toMinutes(s.sleep, 1380);

    var dayStart = atClock(date, Math.floor(wakeMin / 60), wakeMin % 60);
    if (index === 0) {
      var earliest = new Date(ctx.now + 5 * MIN);
      earliest.setSeconds(0, 0);
      var m = earliest.getMinutes();
      earliest.setMinutes(m + (5 - m % 5) % 5, 0, 0);
      if (earliest > dayStart) dayStart = earliest;
    }
    var dayEnd = atClock(date, Math.floor(sleepMin / 60), sleepMin % 60);

    var day = {
      index: index,
      date: date.getTime(),
      weekday: weekday,
      isToday: index === 0,
      weekend: weekend,
      budgetSettingMinutes: budgetMin,
      budgetMinutes: 0,
      plannedMinutes: 0,
      goalMinutes: 0,
      windows: [],
      blocks: [],
      activities: []
    };

    var startMin = dayStart.getHours() * 60 + dayStart.getMinutes();
    var wins = [];
    function addWindow(aMin, bMin) {
      var sa = Math.max(atClock(date, Math.floor(aMin / 60), aMin % 60).getTime(), dayStart.getTime());
      var eb = Math.min(atClock(date, Math.floor(bMin / 60), bMin % 60).getTime(), dayEnd.getTime());
      if (eb - sa < 15 * MIN) return;
      wins.push({ start: new Date(sa), end: new Date(eb), cursor: new Date(sa) });
    }
    /* 从“现在/起床”到午饭、午饭后到晚饭、晚饭后到收工 */
    addWindow(0, LUNCH[0]);
    addWindow(LUNCH[1], DINNER[0]);
    addWindow(DINNER[1], 24 * 60);

    /* 扣掉社团/固定安排 */
    var acts = activitiesOn(ctx.activities, date, ctx.now);
    acts.forEach(function (a) {
      var next = [];
      wins.forEach(function (w) {
        next = next.concat(cutWindow(w, a.start, a.end));
      });
      wins = next;
    });
    wins = wins.filter(function (w) { return (w.end - w.start) / MIN >= 15; });

    /* 固定安排也放进时间轴，让人看得见“为什么这段时间没排学习” */
    day.blocks = acts.map(function (a) {
      return {
        kind: 'activity', activityId: a.id, activityKind: a.kind, label: a.title, place: a.place,
        start: a.start, end: a.end, minutes: a.minutes, repeat: a.repeat
      };
    });
    day.activities = acts;

    var freeMin = wins.reduce(function (sum, w) { return sum + (w.end - w.start) / MIN; }, 0);
    day.windows = wins;
    day.budgetMinutes = Math.min(budgetMin, freeMin);
    day.freeMinutes = freeMin;
    day.late = index === 0 && freeMin < 30;
    return day;
  }

  /* 按“这段窗口适合什么活”排序：攻坚排上午/晚间，碎片排午后低谷 */
  function windowRank(w, deep) {
    var e = energyOf(w.start.getTime());
    if (deep) return e === 'high' ? 0 : e === 'mid' ? 1 : 2;
    return e === 'low' ? 0 : e === 'mid' ? 1 : 2;
  }

  function windowsFor(day, deep) {
    return day.windows.slice().sort(function (a, b) {
      var ra = windowRank(a, deep), rb = windowRank(b, deep);
      if (ra !== rb) return ra - rb;
      return a.start.getTime() - b.start.getTime();
    });
  }

  /* ---------------- 往某一天里放一块 ---------------- */
  function place(day, minutes, opts) {
    var s = opts.settings;
    var cand = windowsFor(day, opts.deep);
    for (var k = 0; k < cand.length; k++) {
      var w = cand[k];
      if (!w) continue;
      var startMs = w.cursor.getTime();
      var room = Math.floor((w.end.getTime() - startMs) / MIN);
      if (room < s.minBlockMinutes) continue;

      var take = Math.min(minutes, room, s.focusMinutes);

      if (opts.before && opts.before !== Infinity) {
        var allow = Math.floor((opts.before - startMs) / MIN);
        if (allow < s.minBlockMinutes) continue;
        take = Math.min(take, allow);
      }

      var budgetRoom = day.budgetMinutes - day.plannedMinutes;
      if (budgetRoom < s.minBlockMinutes) return null;
      take = Math.min(take, budgetRoom);

      if (opts.goal) {
        var goalRoom = s.goalMinutes - day.goalMinutes;
        if (goalRoom < s.minBlockMinutes) continue;
        take = Math.min(take, goalRoom);
      }

      if (take < Math.min(minutes, s.minBlockMinutes)) continue;

      var start = new Date(startMs);
      var end = new Date(startMs + take * MIN);
      var block = {
        kind: opts.kind,
        taskId: opts.taskId || null,
        goalId: opts.goalId || null,
        start: start.getTime(),
        end: end.getTime(),
        minutes: take,
        energy: energyOf(startMs),
        energyLabel: ENERGY_LABEL[energyOf(startMs)],
        deep: !!opts.deep,
        before: opts.before || null
      };
      day.blocks.push(block);
      day.plannedMinutes += take;
      if (opts.goal) day.goalMinutes += take;
      w.cursor = new Date(end.getTime() + s.breakMinutes * MIN);
      if (w.cursor.getTime() >= w.end.getTime()) w.cursor = new Date(w.end.getTime());
      return block;
    }
    return null;
  }

  function latestDayIndex(ts, now) {
    if (ts <= now) return 0;
    var a = startOfDay(new Date(now)).getTime();
    var b = startOfDay(new Date(ts)).getTime();
    return Math.round((b - a) / DAY);
  }

  /* 缓冲时间落到清晨时，这一天其实排不进去 —— 往前挪一天 */
  function latestFeasibleDay(days, before, now) {
    if (before === Infinity) return 0;
    var latest = clamp(latestDayIndex(before, now), 0, days.length - 1);
    while (latest > 0) {
      var d = days[latest];
      var first = d.windows.length ? d.windows[0].start.getTime() : Infinity;
      if (first < before) break;
      latest--;
    }
    return latest;
  }

  function dayOrder(days, start, latest, isGoal, taskId) {
    var idx = [];
    for (var i = start; i <= latest && i < days.length; i++) idx.push(i);
    idx.sort(function (a, b) {
      var da = days[a], db = days[b];
      var la = da.budgetMinutes ? da.plannedMinutes / da.budgetMinutes : 1;
      var lb = db.budgetMinutes ? db.plannedMinutes / db.budgetMinutes : 1;
      /* 同一件事已经开过头，就优先在原来那天接着做，别拆到四天去 */
      if (taskId) {
        if (da.blocks.some(function (x) { return x.taskId === taskId; })) la -= 0.3;
        if (db.blocks.some(function (x) { return x.taskId === taskId; })) lb -= 0.3;
      }
      if (Math.abs(la - lb) > 0.08) return la - lb;
      return isGoal ? a - b : b - a; /* 目标从今天起；任务同负荷时靠近截止日 */
    });
    return idx;
  }

  function isDeepTask(item) {
    return item.deep || item.importance >= 0.62;
  }

  function scheduleTask(item, days, ctx, unscheduled) {
    var s = ctx.settings;
    var t = item.task;
    var buffer = (0.5 + 3 * item.importance) * HOUR;
    var before = t.dueAt - buffer;
    if (before <= ctx.now + 30 * MIN) before = t.dueAt;   /* 缓冲不够就别留了 */
    if (t.dueAt < ctx.now) before = Infinity;              /* 逾期任务：今天能补多少补多少 */

    var latest = latestFeasibleDay(days, before, ctx.now);
    if (t.dueAt < ctx.now) latest = 0;

    var perDayHours = Math.max(1, num(s.dailyHours, 3) * 0.8);
    var span = Math.max(0, Math.floor(item.need / perDayHours));
    var startDay = clamp(latest - span, 0, latest);
    var deep = isDeepTask(item);

    var guard = 0;
    while (item.need > 0.01 && guard++ < 80) {
      var minutes = Math.min(s.focusMinutes, Math.round(item.need * 60));
      if (minutes < 10) minutes = 10;  /* 收尾不足 10 分钟也补成一小块 */
      var placed = false;
      var order = dayOrder(days, startDay, latest, false, t.id);
      for (var k = 0; k < order.length; k++) {
        var block = place(days[order[k]], minutes, {
          kind: 'task', taskId: t.id, deep: deep, before: before, settings: s
        });
        if (block) {
          item.need -= block.minutes / 60;
          placed = true;
          break;
        }
      }
      if (!placed) {
        /* 截止前几天排满了，就往前找空位，而不是直接判“排不下” */
        if (startDay > 0) { startDay = 0; continue; }
        break;
      }
    }
    if (item.need > 0.05) {
      unscheduled.push({
        kind: 'task', id: t.id, title: t.title, course: t.course,
        hours: item.need, dueAt: t.dueAt
      });
    }
  }

  function scheduleGoal(item, days, ctx, unscheduled) {
    var s = ctx.settings;
    if (item.need <= 0.01 && !item.perDay) return;
    var goal = item.goal;

    if (item.perDay) {
      var per = Math.round(Math.max(0.25, num(goal.targetHours, 0.5)) * 60);
      for (var i = 0; i < days.length; i++) {
        var block = place(days[i], per, {
          kind: 'goal', goalId: goal.id, goal: true, deep: false, settings: s
        });
        if (block) block.label = goal.title;
      }
      item.need = 0;
      return;
    }

    var latest = clamp(latestDayIndex(item.deadline, ctx.now), 0, days.length - 1);
    var guard = 0;
    while (item.need > 0.01 && guard++ < 40) {
      var minutes = Math.min(s.goalMinutes, Math.round(item.need * 60));
      if (minutes < s.minBlockMinutes) break;
      var placed = false;
      var order = dayOrder(days, 0, latest, true);
      for (var k = 0; k < order.length; k++) {
        var b = place(days[order[k]], minutes, {
          kind: 'goal', goalId: goal.id, goal: true, deep: false, settings: s
        });
        if (b) {
          b.label = goal.title;
          item.need -= b.minutes / 60;
          placed = true;
          break;
        }
      }
      if (!placed) break;
    }
    if (item.need > 0.05) {
      unscheduled.push({
        kind: 'goal', id: goal.id, title: goal.title, scope: goal.scope, hours: item.need
      });
    }
  }

  /* ---------------- 主入口：排一周 ---------------- */
  function buildWeek(state, now) {
    var ctx = makeContext(state, now);
    var s = ctx.settings;
    var open = ctx.tasks.filter(function (t) { return t.status !== 'done'; });
    var scores = {};

    var days = [];
    for (var i = 0; i < s.horizonDays; i++) days.push(makeDay(i, ctx));

    var items = [];
    open.forEach(function (t) {
      var r = scoreTask(t, ctx);
      scores[t.id] = r;
      items.push({
        kind: 'task', id: t.id, task: t, score: r.score, dueAt: t.dueAt,
        need: r.remaining, importance: r.importance, urgency: r.urgency,
        quadrant: r.quadrant, deep: r.deep
      });
    });

    var goalPlans = [];
    ctx.goals.forEach(function (g) {
      var prog = goalProgress(g, ctx.tasks);
      var linked = linkedOpenHours(g, ctx.tasks);
      var base = Math.max(0, num(g.targetHours, 2) * (1 - prog / 100));
      var need = g.scope === 'day' ? 0 : Math.max(0, base - linked);
      var sc = scoreGoal(g, ctx);
      var item = {
        kind: 'goal', id: g.id, goal: g, score: sc.score, deadline: sc.deadline,
        need: need, perDay: g.scope === 'day', progress: prog, meta: sc
      };
      goalPlans.push({
        id: g.id, title: g.title, scope: g.scope, progress: prog, need: need,
        deadline: sc.deadline, score: sc.score, linkedHours: linked,
        targetHours: num(g.targetHours, 0), importance: num(g.importance, 2)
      });
      if (need > 0.01 || (g.scope === 'day' && prog < 100)) items.push(item);
    });

    items.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var ad = a.dueAt || a.deadline || 0, bd = b.dueAt || b.deadline || 0;
      return ad - bd;
    });

    var unscheduled = [];
    items.forEach(function (item) {
      if (item.need <= 0.01 && !item.perDay) return;
      if (item.kind === 'task') scheduleTask(item, days, ctx, unscheduled);
      else scheduleGoal(item, days, ctx, unscheduled);
    });

    days.forEach(function (d) {
      d.blocks.sort(function (a, b) {
        if (a.start !== b.start) return a.start - b.start;
        return a.kind === 'activity' ? -1 : 1;
      });
      d.plannedHours = d.plannedMinutes / 60;
      d.capacityHours = d.budgetMinutes / 60;
      d.taskCount = d.blocks.filter(function (b) { return b.kind === 'task'; }).length;
      d.goalCount = d.blocks.filter(function (b) { return b.kind === 'goal'; }).length;
      d.utilization = d.budgetMinutes ? d.plannedMinutes / d.budgetMinutes : 0;
      d.overflowMinutes = Math.max(0, d.plannedMinutes - d.budgetMinutes);
    });

    var taskNeed = open.reduce(function (sum, t) { return sum + remainingHours(t); }, 0);
    var goalNeed = goalPlans.reduce(function (sum, g) { return sum + g.need; }, 0);
    var plannedHours = days.reduce(function (sum, d) { return sum + d.plannedHours; }, 0);
    var capacityHours = days.reduce(function (sum, d) { return sum + d.capacityHours; }, 0);
    var taskBlocks = days.reduce(function (sum, d) { return sum + d.taskCount; }, 0);

    return {
      now: ctx.now,
      days: days,
      goals: goalPlans,
      scores: scores,
      unscheduled: unscheduled,
      settings: s,
      stats: {
        neededHours: taskNeed + goalNeed,
        taskHours: taskNeed,
        goalHours: goalNeed,
        plannedHours: plannedHours,
        capacityHours: capacityHours,
        overflowHours: Math.max(0, taskNeed + goalNeed - plannedHours),
        taskBlocks: taskBlocks,
        late: days[0].late
      }
    };
  }

  BG.planner = {
    DEFAULTS: DEFAULTS,
    QUADRANTS: QUADRANTS,
    makeContext: makeContext,
    scoreTask: scoreTask,
    importanceWeights: importanceWeights,
    priorityWeights: priorityWeights,
    scoreGoal: scoreGoal,
    goalDeadline: goalDeadline,
    goalProgress: goalProgress,
    remainingHours: remainingHours,
    endOfWeek: endOfWeek,
    endOfMonth: endOfMonth,
    humanHours: humanHours,
    energyOf: energyOf,
    buildWeek: buildWeek
  };
})(window.BG);
