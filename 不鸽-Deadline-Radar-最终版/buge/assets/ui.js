/* ============================================================
   不鸽 · 交互与渲染【最终版】
   - 总览 / 全部任务：看板与清单（固定安排也列进清单）
   - 学习计划：系统排的未来 7 天 + 左上角返回
   - 右栏：今日作战计划 + 未来 7 天切换
   - 设置：作息、绩点/学分、重要性占比、职业规划、周/月/日目标、固定安排
   - 音乐（白噪音）/ 自习室（限时专注）
   ============================================================ */
(function (BG) {
  'use strict';

  var U = BG.util, M = BG.model, S = BG.store, P = BG.planner;
  var DAY = 86400000;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var now = Date.now();
  var ui = {
    view: 'overview', filter: 'all', sort: 'smart', platform: 'all',
    drafts: [], editId: null, fired: {},
    planDay: 0, plan: null,
    viewStack: [],
    study: null, studyTimer: null
  };
  var firstRender = true;

  /* ---------------- 基础 ---------------- */
  function tasks() { return S.get().tasks; }
  function goals() { return S.get().goals || []; }
  function activities() { return S.get().activities || []; }
  function settings() { return S.get().settings; }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  }

  function toast(msg, icon) {
    var el = $('#toast');
    el.innerHTML = '<svg class="ico"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + esc(msg) + '</span>';
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function setView(view, fromBack) {
    if (!fromBack && view !== ui.view) {
      ui.viewStack.push(ui.view);
      if (ui.viewStack.length > 20) ui.viewStack.shift();
    }
    ui.view = view;
    $$('.view').forEach(function (el) {
      el.classList.toggle('is-hidden', el.id !== 'view-' + view);
    });
    $$('.nav-item').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.view === view);
    });
    $('#main').scrollTop = 0;
    render();
  }

  function goBack() {
    var prev = ui.viewStack.pop();
    if (!prev || prev === ui.view) prev = 'overview';
    setView(prev, true);
    var name = { overview: '总览', tasks: '全部任务', settings: '设置', plan: '学习计划' }[prev] || '上一页';
    toast('已返回' + name);
  }

  function daysFromNow(ts) {
    var a = U.startOfDay(new Date(now)).getTime();
    var b = U.startOfDay(new Date(ts)).getTime();
    return Math.round((b - a) / DAY);
  }

  /* ---------------- 顶部 ---------------- */
  function renderHeader(list, plan) {
    var d = new Date(now);
    var st = M.stats(list, now);
    var sem = settings().semesterStart;
    var week = BG.teachingWeek(new Date(now), new Date(sem));
    $('#dateLabel').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + U.weekLabel(d);
    $('#weekLabel').textContent = '第 ' + week + ' 教学周';

    var hour = d.getHours();
    var greet = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    var headline = '';
    if (!st.open) {
      headline = '清单是空的，<em>0</em> 个截止点在追你';
    } else if (st.overdue > 0) {
      headline = '有 <em>' + st.overdue + '</em> 件事已经逾期了';
    } else if (st.today > 0) {
      headline = '今天有 <em>' + st.today + '</em> 件事要交';
    } else {
      headline = '接下来 7 天还有 <em>' + st.week + '</em> 个截止点';
    }
    $('#headline').innerHTML = greet + '，' + headline;

    var load = M.weeklyLoad(list, now, settings());
    var sub;
    if (!st.open) {
      sub = '没有待办。可以去设置里恢复示例数据，或者导入一段真实的平台通知。';
    } else if (load.overload) {
      sub = '7 天内要投入 ' + load.need.toFixed(1) + ' 小时，按每天 ' + settings().dailyHours +
        ' 小时算有点紧' + (st.overdue ? '，先处理逾期的 ' + st.overdue + ' 件。' : '，今天先清掉一件。');
    } else {
      sub = '7 天内要投入 ' + load.need.toFixed(1) + ' 小时，每天 ' + settings().dailyHours +
        ' 小时的预算还留有余量。' + (st.overdue ? '有 ' + st.overdue + ' 件已逾期，别拖了。' : '');
    }
    if (plan && plan.stats.plannedHours && st.open) {
      sub += ' 未来 7 天的每日计划已经排好，去「学习计划」看每天几点做什么。';
    }
    $('#headSub').textContent = sub;

    $('#navTaskCount').textContent = st.open;
    $('#navPlanCount').textContent = plan ? plan.days.filter(function (day) { return day.plannedMinutes > 0; }).length : 7;
    $('#tasksMeta').textContent = '共 ' + st.total + ' 件 · 待办 ' + st.open + ' 件 · 已完成 ' + st.done + ' 件';
    $('#listCount').textContent = st.open + ' 件待办' + (activities().length ? ' · ' + activities().length + ' 个固定安排' : '');
    $('#listCount2').textContent = st.open + ' 件待办' + (activities().length ? ' · ' + activities().length + ' 个固定安排' : '');
  }

  /* ---------------- 雷达 ---------------- */
  function renderRadar(list) {
    var out = [], maxCount = 0, maxIdx = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(now + i * DAY);
      var d0 = U.startOfDay(d).getTime(), d1 = d0 + DAY;
      var dayTasks = list.filter(function (t) { return t.dueAt >= d0 && t.dueAt < d1; });
      if (dayTasks.length > maxCount) { maxCount = dayTasks.length; maxIdx = i; }

      var dots = dayTasks.slice(0, 6).map(function (t) {
        var p = BG.platformById(t.platform);
        return '<i class="day-dot' + (t.status === 'done' ? ' is-done' : '') + '" style="--pc:' + p.color +
          '" title="' + esc(t.course + ' · ' + t.title) + '"></i>';
      }).join('');
      if (dayTasks.length > 6) dots += '<i class="day-dot" style="--pc:#B9B2A1"></i>';

      out.push(
        '<div class="day' + (i === 0 ? ' is-today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : '') + '">' +
          '<div class="day-name">' + (i === 0 ? '今天' : U.weekLabel(d)) + '</div>' +
          '<div class="day-num">' + d.getDate() + '</div>' +
          '<div class="day-dots">' + (dots || '<span class="day-empty">—</span>') + '</div>' +
        '</div>'
      );
    }
    $('#radar').innerHTML = out.join('');

    var openCount = list.filter(function (t) { return t.status !== 'done'; }).length;
    var hint;
    if (!openCount) hint = '未来 7 天没有截止点，难得清静。';
    else if (maxCount === 0) hint = '未来 7 天没有新的截止，目前的 ' + openCount + ' 件都在更远处。';
    else {
      var dd = new Date(now + maxIdx * DAY);
      hint = (maxIdx === 0 ? '今天' : U.weekLabel(dd)) + '最挤：<b>' + maxCount + '</b> 个截止点 · 未来 7 天共 <b>' + openCount + '</b> 件待办';
    }
    $('#radarHint').innerHTML = hint;
  }

  /* ---------------- Hero ---------------- */
  function renderHero(list, plan) {
    var open = list.filter(function (t) { return t.status !== 'done'; })
      .sort(function (a, b) { return scoreOf(plan, b.id) - scoreOf(plan, a.id); });
    var wrap = $('#hero');

    if (!open.length) {
      wrap.innerHTML =
        '<section class="hero is-empty">' +
          '<div class="hero-left">' +
            '<div class="kicker lime">现在最该做的一件事</div>' +
            '<h2>没有待办。这个晚上归你。</h2>' +
            '<p class="hero-reason">导入一段平台通知，或者恢复示例数据看看它怎么工作。</p>' +
            '<div class="hero-actions">' +
              '<button class="btn btn-lime" data-action="open-import">导入一条通知</button>' +
              '<button class="btn btn-dark-ghost" data-action="seed-demo">恢复示例</button>' +
            '</div>' +
          '</div>' +
          '<div class="hero-empty-mark"><svg class="ico" style="width:24px;height:24px"><use href="#i-check"/></svg></div>' +
        '</section>';
      return;
    }

    var t = open[0];
    var p = BG.platformById(t.platform);
    var info = plan.scores[t.id] || { score: 0, quadrant: 'later', reason: '' };
    var q = P.QUADRANTS[info.quadrant] || P.QUADRANTS.later;
    var score = info.score;
    var rem = M.remainingHours(t);
    var C = 326.73;
    var off = C * (1 - score / 100);

    wrap.innerHTML =
      '<section class="hero">' +
        '<div class="hero-left">' +
          '<div class="kicker lime">现在最该做的一件事 · ' + esc(q.name) + '</div>' +
          '<h2><span class="hero-course">' + esc(t.course) + ' · </span>' + esc(t.title) + '</h2>' +
          '<p class="hero-reason">' + esc(info.reason || M.reason(t, now)) + '</p>' +
          '<div class="hero-tags">' +
            '<span class="hero-tag hot">' + esc(U.countdown(t.dueAt - now)) + '</span>' +
            '<span class="hero-tag qtag q-' + q.id + '">' + esc(q.action) + '</span>' +
            (t.weight ? '<span class="hero-tag">占总评 ' + t.weight + '%</span>' : '') +
            '<span class="hero-tag">还需 ' + U.humanHours(rem) + '</span>' +
            '<span class="hero-tag">' + esc(p.name) + '</span>' +
          '</div>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-lime" data-action="focus" data-id="' + t.id + '">开始做</button>' +
            '<button class="btn btn-dark-ghost" data-action="toggle" data-id="' + t.id + '">标记完成</button>' +
          '</div>' +
        '</div>' +
        '<div class="hero-ring">' +
          '<svg viewBox="0 0 120 120">' +
            '<circle class="ring-track" cx="60" cy="60" r="52"></circle>' +
            '<circle class="ring-fill" cx="60" cy="60" r="52" stroke-dasharray="' + C + '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
          '</svg>' +
          '<div class="ring-num">' + score + '</div>' +
          '<div class="ring-label">优先级</div>' +
        '</div>' +
      '</section>';
  }

  function scoreOf(plan, id) {
    return plan && plan.scores[id] ? plan.scores[id].score : 0;
  }

  /* ---------------- 筛选 ---------------- */
  function filterTasks(list, plan) {
    var out = list.slice();
    if (ui.platform !== 'all') out = out.filter(function (t) { return t.platform === ui.platform; });
    if (ui.filter === 'week') out = out.filter(function (t) { return t.status !== 'done' && t.dueAt < now + 7 * DAY; });
    else if (ui.filter === 'overdue') out = out.filter(function (t) { return t.status !== 'done' && t.dueAt < now; });
    else if (ui.filter === 'done') out = out.filter(function (t) { return t.status === 'done'; });

    if (ui.sort === 'due') out.sort(function (a, b) { return a.dueAt - b.dueAt; });
    else if (ui.sort === 'weight') out.sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
    else out.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      return scoreOf(plan, b.id) - scoreOf(plan, a.id);
    });
    return out;
  }

  function renderFilters(list) {
    var open = list.filter(function (t) { return t.status !== 'done'; });
    var defs = [
      { id: 'all', label: '全部', n: open.length },
      { id: 'week', label: '7 天内', n: open.filter(function (t) { return t.dueAt < now + 7 * DAY; }).length },
      { id: 'overdue', label: '已逾期', n: open.filter(function (t) { return t.dueAt < now; }).length },
      { id: 'done', label: '已完成', n: list.filter(function (t) { return t.status === 'done'; }).length }
    ];
    var html = defs.map(function (d) {
      return '<button class="chip' + (ui.filter === d.id ? ' is-active' : '') + '" data-action="filter" data-filter="' +
        d.id + '" role="tab" aria-selected="' + (ui.filter === d.id) + '">' + d.label +
        '<span class="n">' + d.n + '</span></button>';
    }).join('');
    if (ui.platform !== 'all') {
      var p = BG.platformById(ui.platform);
      html = '<button class="chip is-active" data-action="clear-platform">' + esc(p.short) + ' ×</button>' + html;
    }
    $('#filters').innerHTML = html;
    $('#filters2').innerHTML = html;

    $$('#sortSel, #sortSel2').forEach(function (sel) { sel.value = ui.sort; });
  }

  /* ---------------- 任务卡 ---------------- */
  var GROUP_LABEL = {
    overdue: '已逾期', critical: '24 小时内', soon: '3 天内', week: '本周内', later: '更远', done: '已完成'
  };

  function taskCard(t, plan) {
    var p = BG.platformById(t.platform);
    var b = M.bucket(t, now);
    var cd = t.status === 'done' ? '已完成' : U.countdown(t.dueAt - now);
    var cls = b === 'overdue' || b === 'critical' ? 'hot' : b === 'soon' ? 'warm' : 'cool';
    var info = plan.scores[t.id] || { score: 0, quadrant: 'later', reason: '' };
    var q = P.QUADRANTS[info.quadrant] || P.QUADRANTS.later;
    var progress = Math.max(0, Math.min(100, t.progress || 0));

    return '<article class="task' + (t.status === 'done' ? ' is-done' : '') + '" data-id="' + t.id + '" data-bucket="' + b + '">' +
      '<button class="check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.status === 'done' ? '标记未完成' : '标记完成') + '">' +
        '<svg class="ico"><use href="#i-check"/></svg></button>' +
      '<div class="task-body">' +
        '<div class="task-top">' +
          '<span class="plat" style="--pc:' + p.color + ';--pb:' + p.bg + '">' + esc(p.short) + '</span>' +
          '<span class="course">' + esc(t.course) + '</span>' +
          '<span class="type">' + esc(BG.typeById(t.type).name) + '</span>' +
          '<span class="qtag q-' + q.id + '" title="' + esc(q.name) + '">' + esc(q.action) + '</span>' +
          (t.career ? '<span class="career-tag" title="与职业规划相关">职业</span>' : '') +
        '</div>' +
        '<h3 class="task-title">' + esc(t.title) + '</h3>' +
        '<div class="task-meta">' +
          '<span class="mi"><svg class="ico"><use href="#i-clock"/></svg>' + esc(U.fmtMonthDay(t.dueAt) + ' ' + U.fmtTime(t.dueAt)) + '</span>' +
          (t.weight ? '<span class="mi">占总评 ' + t.weight + '%</span>' : '') +
          (t.credits >= 3 ? '<span class="mi">' + t.credits + ' 学分</span>' : '') +
          '<span class="mi">预估 ' + U.humanHours(t.estHours) + '</span>' +
          (progress > 0 ? '<span class="mi">已完成 ' + progress + '%</span>' : '') +
        '</div>' +
        (progress > 0 || t.status === 'done' ? '<div class="bar"><i style="width:' + (t.status === 'done' ? 100 : progress) + '%"></i></div>' : '') +
      '</div>' +
      '<div class="task-right">' +
        '<div class="cd ' + cls + '">' + esc(cd) + '</div>' +
        '<div class="pri" title="' + esc(info.reason) + '">优先级 <b>' + info.score + '</b></div>' +
        '<div class="row-actions">' +
          '<button class="icon-btn" data-action="edit" data-id="' + t.id + '" title="编辑" aria-label="编辑">' +
            '<svg class="ico"><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn" data-action="delete" data-id="' + t.id + '" title="删除" aria-label="删除">' +
            '<svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ---------------- 固定安排卡片（进任务清单） ---------------- */
  function activityNextAt(a, baseNow) {
    if (a.repeat === 'once' && a.date) {
      var once = new Date(a.date + 'T00:00:00');
      if (isNaN(once.getTime())) return null;
      var sm = toMin(a.start);
      once.setHours(Math.floor(sm / 60), sm % 60, 0, 0);
      var onceEnd = once.getTime() + (toMin(a.end) - sm) * 60000;
      if (once.getTime() <= baseNow && onceEnd > baseNow) return once.getTime();
      return once.getTime() > baseNow ? once.getTime() : null;
    }
    var today = U.startOfDay(new Date(baseNow));
    var target = a.day % 7; /* 周一=1 … 周六=6、周日=0 */
    var diff = (target - today.getDay() + 7) % 7;
    var d = U.addDays(today, diff);
    var m = toMin(a.start);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    var endTs = d.getTime() + (toMin(a.end) - m) * 60000;
    if (d.getTime() <= baseNow && endTs > baseNow) return d.getTime();
    if (d.getTime() <= baseNow) d = U.addDays(d, 7);
    var weeks = Number(a.weeks) || 0;
    var startWeek = a.startWeek ? U.startOfDay(new Date(a.startWeek)).getTime() : 0;
    if (startWeek && weeks > 0) {
      var endWeek = startWeek + weeks * 7 * DAY;
      if (d.getTime() >= endWeek) return null;
    }
    return d.getTime();
  }

  function activityWhen(a) {
    var next = activityNextAt(a, now);
    if (!next) return '已结束';
    var days = daysFromNow(next);
    var prefix = days === 0 ? '今天 ' : days === 1 ? '明天 ' : days >= 7 ? '下' + U.weekLabel(new Date(next)) + ' ' : U.weekLabel(new Date(next)) + ' ';
    return prefix + U.fmtTime(next);
  }

  function activityCard(a) {
    var kind = BG.activityKind(a.kind);
    var when = activityWhen(a);
    var next = activityNextAt(a, now);
    var color = kind.id === 'club' ? '#256E8C' : '#8A6B2F';
    var bg = kind.id === 'club' ? '#E4F0F4' : '#F5EEDD';
    var dayLabel = a.repeat === 'once' && a.date ? a.date.replace(/-/g, '/') : U.WEEK[a.day - 1];
    var repLabel = a.repeat === 'once' ? '单次'
      : a.weeks === 1 ? '仅本周'
        : (a.weeks ? '每周 · ' + a.weeks + ' 周' : '每周');
    return '<article class="task is-activity" data-id="' + a.id + '" data-kind="' + kind.id + '">' +
      '<div class="act-mark" aria-hidden="true"><svg class="ico"><use href="#' + (kind.id === 'club' ? 'i-users' : 'i-calendar') + '"/></svg></div>' +
      '<div class="task-body">' +
        '<div class="task-top">' +
          '<span class="plat" style="--pc:' + color + ';--pb:' + bg + '">' + esc(kind.short) + '</span>' +
          '<span class="course">' + esc(dayLabel) + '</span>' +
          '<span class="type">固定安排</span>' +
          '<span class="act-rep-inline">' + esc(repLabel) + '</span>' +
        '</div>' +
        '<h3 class="task-title">' + esc(a.title) + '</h3>' +
        '<div class="task-meta">' +
          '<span class="mi"><svg class="ico"><use href="#i-clock"/></svg>' + esc(a.start + '–' + a.end) + '</span>' +
          (a.place ? '<span class="mi">' + esc(a.place) + '</span>' : '') +
          '<span class="mi">' + (next ? '下次 ' + esc(when) : '已结束') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="task-right">' +
        '<div class="cd ' + (next && next - now < 24 * 3600000 ? 'hot' : 'cool') + '">' + esc(when) + '</div>' +
        '<div class="pri">固定安排</div>' +
        '<div class="row-actions">' +
          '<button class="icon-btn" data-action="edit-activity" data-id="' + a.id + '" title="编辑这个安排" aria-label="编辑这个安排">' +
            '<svg class="ico"><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn" data-action="remove-activity" data-id="' + a.id + '" title="删除这个安排" aria-label="删除这个安排">' +
            '<svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function activityGroupHtml() {
    if (ui.filter !== 'all' || ui.platform !== 'all') return '';
    var acts = activities().slice().sort(function (a, b) {
      var na = activityNextAt(a, now), nb = activityNextAt(b, now);
      return (na || Infinity) - (nb || Infinity);
    });
    if (!acts.length) return '';
    return '<div class="group group-act">' +
      '<div class="group-head"><i class="g-dot" style="--gc:#8A6B2F"></i>固定安排' +
      '<span class="g-n">' + acts.length + '</span><span class="g-line"></span></div>' +
      acts.map(activityCard).join('') +
    '</div>';
  }

  function renderList(list, plan) {
    var filtered = filterTasks(list, plan);
    var actHtml = activityGroupHtml();
    var el1 = $('#taskList'), el2 = $('#taskList2');
    if (!filtered.length && !actHtml) {
      var empty = '<div class="empty"><b>这里还没有任务</b><p>把群里的通知、平台公告粘进“导入通知”，它会自动拆成条目。</p></div>';
      el1.innerHTML = empty; el2.innerHTML = empty;
      return;
    }
    var html = '';
    ['overdue', 'critical', 'soon', 'week', 'later', 'done'].forEach(function (g) {
      if (g === 'done') html += actHtml;
      var items = filtered.filter(function (t) { return M.bucket(t, now) === g; });
      if (!items.length) return;
      var color = g === 'overdue' ? 'var(--red)' : g === 'critical' ? '#D2691E' : g === 'soon' ? '#C9A227' : g === 'done' ? '#BFD8C9' : '#C9C2B1';
      html += '<div class="group">' +
        '<div class="group-head"><i class="g-dot" style="--gc:' + color + '"></i>' + GROUP_LABEL[g] +
        '<span class="g-n">' + items.length + '</span><span class="g-line"></span></div>' +
        items.map(function (t) { return taskCard(t, plan); }).join('') +
        '</div>';
    });
    el1.innerHTML = html;
    el2.innerHTML = html;
  }

  /* ---------------- 学习计划视图（新增） ---------------- */
  function goalById(id) { return byId(goals(), id); }

  function pblockRow(b, plan) {
    if (b.kind === 'activity') {
      return '<div class="pblock is-activity">' +
        '<div class="pblock-time"><b>' + U.fmtTime(b.start) + '</b><span>' + U.fmtTime(b.end) + '</span></div>' +
        '<div class="pblock-axis"><i class="act-dot"></i></div>' +
        '<div class="pblock-body">' +
          '<div class="pblock-title">' + esc(b.label || '固定安排') + '</div>' +
          '<div class="pblock-sub"><span class="ptag act">' +
            (b.activityKind === 'other' ? '其他活动' : '社团') + '</span>' +
            (b.place ? ' · ' + esc(b.place) : '') + ' · ' + (b.repeat === 'once' ? '单次' : '每周') +
          '</div>' +
        '</div><div class="pblock-end"></div>' +
      '</div>';
    }

    if (b.kind === 'goal') {
      var g = goalById(b.goalId);
      var scope = g ? (g.scope === 'day' ? '日目标' : g.scope === 'month' ? '月目标' : '周目标') : '目标';
      return '<div class="pblock is-goal">' +
        '<div class="pblock-time"><b>' + U.fmtTime(b.start) + '</b><span>' + U.fmtTime(b.end) + '</span></div>' +
        '<div class="pblock-axis"><i class="goal-dot"></i></div>' +
        '<div class="pblock-body">' +
          '<div class="pblock-title">' + esc(g ? g.title : (b.label || '学习目标')) + '</div>' +
          '<div class="pblock-sub"><span class="ptag plan">' + scope + '</span> · ' + b.minutes + ' 分钟 · ' +
            esc(b.energyLabel || '') + '</div>' +
        '</div><div class="pblock-end"></div>' +
      '</div>';
    }

    var t = byId(tasks(), b.taskId);
    if (!t) return '';
    var info = plan.scores[t.id] || { quadrant: 'later' };
    var q = P.QUADRANTS[info.quadrant] || P.QUADRANTS.later;
    var p = BG.platformById(t.platform);
    return '<div class="pblock is-task" data-id="' + t.id + '">' +
      '<div class="pblock-time"><b>' + U.fmtTime(b.start) + '</b><span>' + U.fmtTime(b.end) + '</span></div>' +
      '<div class="pblock-axis"><i style="--pc:' + p.color + '"></i></div>' +
      '<div class="pblock-body">' +
        '<div class="pblock-title">' + esc(t.title) + '</div>' +
        '<div class="pblock-sub">' +
          '<span class="course">' + esc(t.course) + '</span>' +
          ' · ' + b.minutes + ' 分钟 · ' + esc(b.energyLabel || '') +
          ' · <span class="ptag q-' + q.id + '">' + esc(q.action) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="check pcheck" data-action="toggle" data-id="' + t.id + '" aria-label="标记完成">' +
        '<svg class="ico"><use href="#i-check"/></svg></button>' +
    '</div>';
  }

  function renderPlanView(plan) {
    var days = plan.days;
    if (ui.planDay < 0 || ui.planDay >= days.length) ui.planDay = 0;

    var strip = days.map(function (d, i) {
      var dt = new Date(d.date);
      var pct = d.budgetMinutes ? Math.min(100, Math.round(d.plannedMinutes / d.budgetMinutes * 100)) : 0;
      var label = i === 0 ? '今天' : U.weekLabel(dt);
      return '<button class="pday' + (i === 0 ? ' is-today' : '') + (i === ui.planDay ? ' is-active' : '') +
        (d.late ? ' is-late' : '') + '" data-action="plan-day" data-day="' + i + '" aria-pressed="' + (i === ui.planDay) + '">' +
        '<span class="pday-name">' + label + '</span>' +
        '<span class="pday-num">' + dt.getDate() + '</span>' +
        '<span class="pday-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="pday-hours">' + (d.plannedMinutes ? (d.plannedMinutes / 60).toFixed(1) + 'h' : '—') + '</span>' +
      '</button>';
    }).join('');
    $('#planStrip').innerHTML = strip;

    $('#planGoals').innerHTML = plan.goals.length
      ? plan.goals.map(function (g) {
          var prog = Math.round(g.progress);
          var rem = g.scope === 'day' ? (prog >= 100 ? '已完成' : '每天重复')
            : g.need > 0.05 ? '还差 ' + U.humanHours(g.need)
              : (g.linkedHours > 0 ? '由关联任务推进' : (prog >= 100 ? '已完成' : '待安排'));
          return '<div class="pgoal">' +
            '<div class="pgoal-top"><span class="gscope g-' + g.scope + '">' + scopeName(g.scope) + '</span>' +
              '<span class="pgoal-rem">' + esc(rem) + '</span></div>' +
            '<div class="pgoal-title" title="' + esc(g.title) + '">' + esc(g.title) + '</div>' +
            '<div class="pgoal-bar"><i style="width:' + prog + '%"></i></div>' +
            '<div class="pgoal-meta"><span>进度 ' + prog + '%</span><span>' +
              (g.scope === 'day' ? '每天一块' : '截止 ' + U.fmtMonthDay(g.deadline)) + '</span></div>' +
          '</div>';
        }).join('')
      : '<div class="pgoal pgoal-empty">还没有周/月/日目标。去设置里加一个，计划会每天给它留固定时间。</div>';

    $('#planDayCount').textContent = days.length;
    $('#planMeta').textContent = '未来 ' + days.length + ' 天 · 计划 ' + plan.stats.plannedHours.toFixed(1) +
      ' 小时 · 有 ' + days.filter(function (d) { return d.plannedMinutes > 0; }).length + ' 天有安排';

    var today = days[0], tomorrow = days[1];
    var subBits = [];
    subBits.push(today.plannedMinutes
      ? '今天 ' + today.taskCount + ' 个任务块 · ' + (today.plannedMinutes / 60).toFixed(1) + ' 小时'
      : '今天没有排任务块');
    if (tomorrow && tomorrow.plannedMinutes) subBits.push('明天 ' + (tomorrow.plannedMinutes / 60).toFixed(1) + ' 小时');
    if (plan.unscheduled.length) subBits.push('还有 ' + plan.stats.overflowHours.toFixed(1) + ' 小时排不下');
    $('#planSub').textContent = subBits.join(' · ') + '。点上面的日期可以看每一天。';

    var day = days[ui.planDay];
    var dt = new Date(day.date);
    var pct = day.budgetMinutes ? Math.min(100, Math.round(day.plannedMinutes / day.budgetMinutes * 100)) : 0;
    var actHours = day.activities.reduce(function (s, a) { return s + a.minutes / 60; }, 0);

    var head = '<div class="pdetail-head">' +
      '<div>' +
        '<div class="kicker">系统排的这一天</div>' +
        '<h2 class="pdetail-title">' + U.fmtMonthDay(day.date) + ' · ' + U.weekLabel(dt) +
          (ui.planDay === 0 ? '<span class="pdetail-today">今天</span>' : '') + '</h2>' +
        '<p class="pdetail-sub">' + day.taskCount + ' 个任务块' +
          (day.goalCount ? ' · ' + day.goalCount + ' 个目标块' : '') +
          (day.activities.length ? ' · ' + day.activities.length + ' 个固定安排' : '') +
          ' · 45 分钟一块' + '</p>' +
      '</div>' +
      '<div class="pdetail-meter">' +
        '<div class="pdetail-num"><b>' + (day.plannedMinutes / 60).toFixed(1) + '</b>' +
          '<span>/ ' + (day.budgetMinutes / 60).toFixed(1) + ' 小时可用</span></div>' +
        '<div class="load-bar"><i class="' + (pct >= 95 ? 'over' : '') + '" style="width:' + pct + '%"></i></div>' +
        '<div class="pdetail-cap">每日预算 ' + settings().dailyHours + 'h' + (day.weekend ? ' · 周末 +1h' : '') +
          (actHours ? ' · 固定安排 ' + actHours.toFixed(1) + 'h' : '') + '</div>' +
      '</div>' +
    '</div>';

    var rows = day.blocks.map(function (b) { return pblockRow(b, plan); }).join('');
    var body = rows
      ? '<div class="plan-timeline">' + rows + '</div>'
      : '<div class="empty plan-empty-block"><b>' +
          (day.late ? '今天的学习时间已经过去了' : days.every(function (d) { return d.plannedMinutes === 0; })
            ? '还没有需要排的事情' : '这一天暂时没有安排') + '</b><p>' +
          (day.late ? '明天 8:00 起按计划继续，别熬夜补。'
            : days.every(function (d) { return d.plannedMinutes === 0; }) ? '导入通知、添加任务或设一个周/月目标，这里就会自动排出来。'
            : '系统把任务排到了更靠近截止日的几天，点上面其他日期看看。') + '</p></div>';

    var warn = '';
    if (day.late) {
      warn += '<div class="plan-warn">已经过了今天的学习时间。今天先睡，明天 8:00 从这里继续。</div>';
    }
    if (plan.unscheduled.length) {
      warn += '<div class="plan-warn"><b>未来 7 天还差 ' + plan.stats.overflowHours.toFixed(1) + ' 小时排不下</b><br>' +
        plan.unscheduled.slice(0, 4).map(function (u) {
          return '· ' + esc((u.course ? u.course + ' · ' : '') + u.title) + ' 还差 ' + u.hours.toFixed(1) + ' 小时';
        }).join('<br>') +
        (plan.unscheduled.length > 4 ? '<br>…' : '') +
        '<br><span>把每日预算调高、把预估工时调低，或者砍掉「不紧急不重要」的那一档。</span></div>';
    }

    var note = '<p class="plan-note">先做「紧急且重要」，再给「重要不紧急」留固定时间。' +
      '饭点、社团和 23:00 之后不排学习块，块间休息 10 分钟。</p>';

    $('#planDetail').innerHTML = head + body + warn + note;
  }

  /* ---------------- 右栏：今日 / 某一天 ---------------- */
  function renderRailPlan(plan) {
    var days = plan.days;
    var idx = Math.min(ui.planDay, days.length - 1);
    var day = days[idx];

    $('#railDays').innerHTML = days.map(function (d, i) {
      var label = i === 0 ? '今' : U.weekLabel(new Date(d.date)).replace('周', '');
      return '<button class="rday' + (i === idx ? ' is-active' : '') + (i === 0 ? ' today' : '') +
        '" data-action="plan-day" data-day="' + i + '" title="' + U.fmtMonthDay(d.date) + '">' +
        '<b>' + label + '</b><span>' + (d.plannedMinutes ? (d.plannedMinutes / 60).toFixed(1) : '·') + '</span></button>';
    }).join('');

    $('#railPlanTitle').textContent = idx === 0 ? '今日作战计划' : U.weekLabel(new Date(day.date)) + '的计划';
    $('#budgetTag').textContent = settings().dailyHours + 'h 预算';
    var el = $('#plan');

    if (day.late) {
      el.innerHTML = '<p class="plan-empty">已经 23:00 了。今天先睡，明天 8:30 从这里继续排。</p>' +
        '<div class="plan-foot">明天可用 <b>' + settings().dailyHours + '</b> 小时' +
        (plan.stats.overflowHours ? ' · 还有 <span class="warn">' + plan.stats.overflowHours.toFixed(1) + ' 小时</span>留给之后' : '') + '</div>';
      return;
    }
    if (!day.blocks.length) {
      el.innerHTML = '<p class="plan-empty">这一天没有排学习块。' +
        (days.every(function (d) { return d.plannedMinutes === 0; }) ? '没有待办，今天不用排计划。' : '点上面的日期看看别的天。') + '</p>';
      return;
    }

    var html = day.blocks.map(function (b) {
      if (b.kind === 'activity') {
        return '<div class="plan-item is-activity">' +
          '<div class="plan-time">' + U.fmtTime(b.start) + '</div>' +
          '<div class="plan-axis"><i style="--pc:#B9B2A1"></i></div>' +
          '<div class="plan-body">' +
            '<div class="plan-course">' + (b.activityKind === 'other' ? '其他活动' : '社团') + ' · 固定安排</div>' +
            '<div class="plan-title">' + esc(b.label || '固定安排') + '</div>' +
            '<div class="plan-dur">' + U.fmtTime(b.start) + '–' + U.fmtTime(b.end) + ' · ' + b.minutes + ' 分钟</div>' +
          '</div>' +
        '</div>';
      }
      if (b.kind === 'goal') {
        var g = goalById(b.goalId);
        return '<div class="plan-item is-goal">' +
          '<div class="plan-time">' + U.fmtTime(b.start) + '</div>' +
          '<div class="plan-axis"><i style="--pc:#C9A227"></i></div>' +
          '<div class="plan-body">' +
            '<div class="plan-course">' + (g && g.scope === 'day' ? '日目标' : g && g.scope === 'month' ? '月目标' : '周目标') + '</div>' +
            '<div class="plan-title">' + esc(g ? g.title : (b.label || '学习目标')) + '</div>' +
            '<div class="plan-dur">' + b.minutes + ' 分钟 · ' + esc(b.energyLabel || '') + '</div>' +
          '</div>' +
        '</div>';
      }
      var t = byId(tasks(), b.taskId);
      if (!t) return '';
      var p = BG.platformById(t.platform);
      var info = plan.scores[t.id] || { quadrant: 'later' };
      var q = P.QUADRANTS[info.quadrant] || P.QUADRANTS.later;
      return '<div class="plan-item">' +
        '<div class="plan-time">' + U.fmtTime(b.start) + '</div>' +
        '<div class="plan-axis"><i style="--pc:' + p.color + '"></i></div>' +
        '<div class="plan-body">' +
          '<div class="plan-course">' + esc(t.course) + ' · ' + esc(q.action) + '</div>' +
          '<div class="plan-title">' + esc(t.title) + '</div>' +
          '<div class="plan-dur">' + U.fmtTime(b.start) + '–' + U.fmtTime(b.end) + ' · ' + b.minutes + ' 分钟</div>' +
        '</div>' +
      '</div>';
    }).join('');

    html += '<div class="plan-foot">' +
      (day.plannedMinutes ? '这一天排 <b>' + (day.plannedMinutes / 60).toFixed(1) + '</b> / ' + settings().dailyHours + ' 小时' : '这一天还没排') +
      (day.overflowMinutes > 0 ? ' · <span class="warn">超出 ' + (day.overflowMinutes / 60).toFixed(1) + ' 小时</span>' : '') +
      (plan.stats.overflowHours > 0.1 ? ' · <span class="warn">7 天还差 ' + plan.stats.overflowHours.toFixed(1) + ' 小时</span>' : '') +
      '<button class="link-btn plan-more" data-action="view" data-view="plan">查看 7 天完整计划 →</button>' +
    '</div>';
    el.innerHTML = html;
  }

  /* ---------------- 提醒 ---------------- */
  function reminderTime(ts) {
    var d = daysFromNow(ts);
    if (d === 0) return '今天 ' + U.fmtTime(ts);
    if (d === 1) return '明天 ' + U.fmtTime(ts);
    return U.fmtMonthDay(ts) + ' ' + U.fmtTime(ts);
  }

  function renderReminders(list) {
    var rem = M.reminders(list, now).slice(0, 6);
    var el = $('#reminders');
    if (!rem.length) {
      el.innerHTML = '<p class="plan-empty">未来 14 天没有提醒节点。</p>';
      return;
    }
    el.innerHTML = rem.map(function (r) {
      var isDue = r.label === '截止';
      return '<div class="rem">' +
        '<div class="rem-time' + (r.at - now < 3600000 ? ' now' : '') + '">' + reminderTime(r.at) + '</div>' +
        '<div class="rem-body"><span class="rem-task">' + esc(r.task.course) + ' · ' + esc(r.task.title) + '</span>' +
        '<span class="rem-label' + (isDue ? ' due' : '') + '">' + r.label + '</span></div>' +
      '</div>';
    }).join('');
  }

  function renderLoad(list) {
    var load = M.weeklyLoad(list, now, settings());
    var pct = Math.min(100, Math.round(load.ratio * 100));
    $('#loadRatio').textContent = pct + '%';
    var max = Math.max.apply(null, load.perDay.concat([1]));
    var days = load.perDay.map(function (n, i) {
      var d = new Date(now + i * DAY);
      var h = n ? Math.max(6, (n / max) * 30) : 2;
      var cls = n ? (i === 0 ? 'today' : 'has') : '';
      return '<div class="load-day"><i class="' + cls + '" style="height:' + h + 'px" title="' + (n || 0) + ' 件"></i>' +
        '<span>' + U.weekLabel(d).replace('周', '') + '</span></div>';
    }).join('');

    $('#load').innerHTML =
      '<div class="load-num"><b>' + load.need.toFixed(1) + '</b><span>/ ' + load.cap + ' 小时</span></div>' +
      '<div class="load-bar"><i class="' + (load.overload ? 'over' : '') + '" style="width:' + pct + '%"></i></div>' +
      '<div class="load-days">' + days + '</div>' +
      '<p class="load-note' + (load.overload ? ' warn' : '') + '">' +
        (load.overload
          ? '按每天 ' + settings().dailyHours + ' 小时算，这周排不满，建议挑一件提前做。'
          : '还剩 ' + Math.max(0, load.cap - load.need).toFixed(1) + ' 小时余量，节奏正常。') +
      '</p>';
  }

  function renderPlatformNav(list) {
    var open = list.filter(function (t) { return t.status !== 'done'; });
    var html = '<button class="pf-item' + (ui.platform === 'all' ? ' is-active' : '') + '" data-action="platform" data-platform="all">' +
      '<i class="pf-dot" style="--pc:#D9F26B"></i><span>全部平台</span><span class="pf-count">' + open.length + '</span></button>';
    BG.PLATFORMS.forEach(function (p) {
      if (p.id === 'manual') return;
      var n = open.filter(function (t) { return t.platform === p.id; }).length;
      if (!n && ui.platform !== p.id) return;
      html += '<button class="pf-item' + (ui.platform === p.id ? ' is-active' : '') + '" data-action="platform" data-platform="' + p.id + '">' +
        '<i class="pf-dot" style="--pc:' + p.color + '"></i><span>' + esc(p.short) + '</span><span class="pf-count">' + n + '</span></button>';
    });
    $('#platformNav').innerHTML = html;
  }

  /* ---------------- 设置页 ---------------- */
  function scopeName(scope) {
    return scope === 'day' ? '每日' : scope === 'month' ? '本月' : '本周';
  }

  function renderSettings(list) {
    if (ui.view !== 'settings') return;
    var st = settings();

    var range = $('#dailyHours');
    if (document.activeElement !== range) range.value = st.dailyHours;
    $('#dailyHoursOut').textContent = st.dailyHours + ' 小时';

    var dateInput = $('#semStart');
    if (document.activeElement !== dateInput) {
      var d = new Date(st.semesterStart);
      dateInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    $('#weekNow').textContent = '现在是第 ' + BG.teachingWeek(new Date(now), new Date(st.semesterStart)) + ' 周';

    var wake = $('#wakeTime'), sleep = $('#sleepTime');
    if (document.activeElement !== wake) wake.value = st.wake || '07:30';
    if (document.activeElement !== sleep) sleep.value = st.sleep || '23:00';

    var gpaC = $('#gpaCurrent'), gpaT = $('#gpaTarget'), gm = $('#goalMinutes');
    if (document.activeElement !== gpaC) gpaC.value = st.gpaCurrent;
    if (document.activeElement !== gpaT) gpaT.value = st.gpaTarget;
    if (document.activeElement !== gm) gm.value = st.goalMinutes;
    $('#goalMinutesOut').textContent = st.goalMinutes + ' 分钟';

    /* ---- 绩点 / 学分 / 学校要求 / 档案导入 ---- */
    var ce = $('#creditsEarned'), cr = $('#creditsRequired'), sr = $('#schoolReq');
    if (ce && document.activeElement !== ce) ce.value = st.creditsEarned || '';
    if (cr && document.activeElement !== cr) cr.value = st.creditsRequired || '';
    if (sr && document.activeElement !== sr) sr.value = st.schoolRequirement || '';
    var earned = Number(st.creditsEarned) || 0;
    var required = Number(st.creditsRequired) || 0;
    var creditPct = required ? Math.min(100, Math.round(earned / required * 100)) : 0;
    if ($('#creditBar')) $('#creditBar').style.width = creditPct + '%';
    if ($('#creditMeta')) {
      $('#creditMeta').textContent = required
        ? '已修 ' + earned + ' / ' + required + ' 学分 · 还差 ' + Math.max(0, required - earned) + ' 学分'
        : '填入学分后显示毕业进度';
    }
    if ($('#profileInfo')) {
      $('#profileInfo').textContent = st.profileName
        ? '已导入：' + st.profileName
        : '未导入';
    }

    /* ---- 紧急 / 重要总占比 ---- */
    var pw = Object.assign({}, BG.DEFAULT_PRIORITY, st.priorityWeights || {});
    var wU = $('#wUrgency'), wI = $('#wImportance');
    if (wU && document.activeElement !== wU) wU.value = Math.round(pw.urgency);
    if (wI && document.activeElement !== wI) wI.value = Math.round(pw.importance);
    if ($('#wUrgencyOut')) $('#wUrgencyOut').textContent = Math.round(pw.urgency) + '%';
    if ($('#wImportanceOut')) $('#wImportanceOut').textContent = Math.round(pw.importance) + '%';
    if ($('#pwTotal')) $('#pwTotal').textContent = '100%';

    /* ---- 重要性占比 ---- */
    var rawW = Object.assign({}, BG.DEFAULT_WEIGHTS, st.importanceWeights || {});
    var hasCareer = String(st.careerGoal || '').trim().length > 0;
    var wG = $('#wGpa'), wC = $('#wCredits'), wK = $('#wCareer');
    if (wG && document.activeElement !== wG) wG.value = Math.round(rawW.gpa);
    if (wC && document.activeElement !== wC) wC.value = Math.round(rawW.credits);
    if (wK) {
      if (document.activeElement !== wK) wK.value = Math.round(rawW.career);
      wK.disabled = !hasCareer;
    }
    if ($('#wGpaOut')) $('#wGpaOut').textContent = Math.round(rawW.gpa) + '%';
    if ($('#wCreditsOut')) $('#wCreditsOut').textContent = Math.round(rawW.credits) + '%';
    if ($('#wCareerOut')) $('#wCareerOut').textContent = Math.round(rawW.career) + '%' + (hasCareer ? '' : '（未启用）');
    if ($('#weightTotal')) $('#weightTotal').textContent = '合计 ' + Math.round(rawW.gpa + rawW.credits + rawW.career) + '%';
    var careerBox = $('#careerGoal');
    if (careerBox && document.activeElement !== careerBox) careerBox.value = st.careerGoal || '';
    if ($('#careerHint')) {
      $('#careerHint').textContent = hasCareer
        ? '已启用：任务勾选「与职业规划相关」后，拿到这个占比。'
        : '没填职业规划时这一项不参与，绩点和学分按比例重分配。';
    }

    var nbs = $('#notifyBtn');
    var on = st.notify && ('Notification' in window) && Notification.permission === 'granted';
    nbs.innerHTML = '<svg class="ico"><use href="#i-bell"/></svg><span>' + (on ? '桌面提醒已开启' : '开启桌面提醒') + '</span>';
    nbs.style.color = on ? 'var(--green)' : '';
    $('#notifyMini').textContent = on ? '已开启' : '开启';

    var rem = M.reminders(list, now).slice(0, 5);
    $('#reminderPreview').innerHTML = rem.length
      ? rem.map(function (r) {
          return '<div class="rp-item"><span>' + esc(r.task.title) + '</span><b>' + reminderTime(r.at) + '</b></div>';
        }).join('')
      : '<div class="rp-item"><span>暂无</span><b>—</b></div>';
    $('#verLabel').textContent = 'v' + BG.VERSION.replace('-final', '').replace('-four', '').replace('-three', '').replace('-two', '').replace('-mod', '') + ' · 最终版';

    /* ---- 目标列表 ---- */
    var gl = goals();
    $('#goalList').innerHTML = gl.length
      ? gl.map(function (g) {
          var prog = M.goalProgress(g, list);
          var linked = list.filter(function (t) { return t.goalId === g.id; });
          var deadline = new Date(P.goalDeadline(g, now));
          return '<div class="goal-item">' +
            '<div class="goal-top">' +
              '<span class="gscope g-' + g.scope + '">' + scopeName(g.scope) + '</span>' +
              '<b class="goal-title">' + esc(g.title) + '</b>' +
              '<span class="goal-hours">' + (g.scope === 'day' ? '每天 ' : '目标 ') + U.humanHours(g.targetHours) + '</span>' +
              '<button class="icon-btn" data-action="del-goal" data-id="' + g.id + '" aria-label="删除目标">' +
                '<svg class="ico"><use href="#i-trash"/></svg></button>' +
            '</div>' +
            '<div class="bar goal-bar"><i style="width:' + prog + '%"></i></div>' +
            '<div class="goal-meta">' +
              '<span>进度 ' + prog + '%' + (linked.length ? ' · 自动同步 ' + linked.length + ' 个任务' : '') + '</span>' +
              '<span>' + (g.scope === 'day' ? '每天重复' : '截止 ' + U.fmtMonthDay(deadline.getTime())) + '</span>' +
              '<input class="goal-range" type="range" min="0" max="100" step="5" value="' + Math.round(prog) + '"' +
                (linked.length ? ' disabled title="进度由关联任务自动同步"' : ' data-goal="' + g.id + '"') +
                ' aria-label="目标进度">' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="goal-empty">还没有目标。先写一个「本周最重要的一件事」，它会每天固定占 45 分钟。</div>';

    /* ---- 社团与其他活动 ---- */
    var acts = activities();
    $('#activityList').innerHTML = acts.length
      ? acts.map(function (a) {
          var k = BG.activityKind(a.kind);
          var rep = a.repeat === 'once'
            ? ('单次 · ' + (a.date || '自定'))
            : (a.weeks === 1 ? '仅本周' : ('每周' + (a.weeks ? ' · ' + a.weeks + ' 周' : '')));
          return '<div class="act-item">' +
            '<span class="act-kind k-' + k.id + '">' + esc(k.short) + '</span>' +
            '<span class="act-day">' + (a.repeat === 'once' ? '单次' : U.WEEK[a.day - 1]) + '</span>' +
            '<b class="act-title">' + esc(a.title) + '</b>' +
            '<span class="act-time">' + a.start + '–' + a.end + '</span>' +
            (a.place ? '<span class="act-place">' + esc(a.place) + '</span>' : '') +
            '<span class="act-rep">' + esc(rep) + '</span>' +
            '<button class="icon-btn" data-action="edit-activity" data-id="' + a.id + '" aria-label="编辑安排">' +
              '<svg class="ico"><use href="#i-edit"/></svg></button>' +
            '<button class="icon-btn" data-action="del-activity" data-id="' + a.id + '" aria-label="删除安排">' +
              '<svg class="ico"><use href="#i-trash"/></svg></button>' +
          '</div>';
        }).join('')
      : '<div class="goal-empty">还没有固定安排。社团、例会、讲座、课外实践都会从可用时间里先扣掉。</div>';
  }

  /* ---------------- 总渲染 ---------------- */
  function render() {
    now = Date.now();
    var list = tasks();
    var plan = M.weekPlan(now);
    ui.plan = plan;
    renderHeader(list, plan);
    renderRadar(list);
    renderHero(list, plan);
    renderFilters(list);
    renderList(list, plan);
    renderPlatformNav(list);
    renderRailPlan(plan);
    renderReminders(list);
    renderLoad(list);
    renderPlanView(plan);
    renderSettings(list);
    renderMusicDock();
    if (firstRender) {
      document.body.classList.add('is-ready');
      firstRender = false;
    }
  }

  /* ---------------- 导入弹层 ---------------- */
  function openImport() {
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">导入 · 粘贴原文即可</div>' +
              '<h2 id="modalTitle">把通知粘进来</h2>' +
              '<p>课程名、截止时间、平台、占总评比例会被自动拆出来。识别不准的地方，你可以直接改。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<textarea id="noticeInput" class="notice-input" placeholder="例如：&#10;【高等数学A(上)】第11周作业已发布&#10;请于 11月20日 23:59 前在中国大学MOOC提交，占总评 10%。"></textarea>' +
            '<div class="notice-tools">' +
              '<button class="link-btn" data-action="fill-sample">填入一段示例通知</button>' +
              '<span class="char-count" id="charCount">0 字</span>' +
            '</div>' +
            '<div id="parseResult"></div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">不会联网，文本只在本机解析。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-dark" data-action="parse" id="parseBtn">识别一下</button>' +
              '<button class="btn btn-lime is-hidden" data-action="import-confirm" id="importBtn">导入</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';

    var ta = $('#noticeInput');
    ta.addEventListener('input', function () {
      $('#charCount').textContent = ta.value.length + ' 字';
    });
    ta.focus();
    ui.drafts = [];
  }

  function confidenceDots(c) {
    if (!c) return '';
    var order = ['due', 'course', 'platform', 'weight'];
    var cls = { high: 'ok', med: 'med', none: '' };
    return '<span class="conf" title="截止/课程/平台/占比 的识别把握">' +
      order.map(function (k) { return '<i class="' + (cls[c[k]] || '') + '"></i>'; }).join('') + '</span>';
  }

  function draftRow(d, i) {
    var p = BG.platformById(d.platform);
    return '<article class="draft" data-index="' + i + '">' +
      '<div class="draft-top">' +
        '<span class="draft-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<input class="draft-course" data-field="course" value="' + esc(d.course) + '" placeholder="课程名" aria-label="课程">' +
        confidenceDots(d.confidence) +
        '<button class="icon-btn" data-action="drop-draft" data-index="' + i + '" aria-label="移除这条">' +
          '<svg class="ico"><use href="#i-close"/></svg></button>' +
      '</div>' +
      '<input class="draft-title" data-field="title" value="' + esc(d.title) + '" placeholder="任务名" aria-label="任务名">' +
      '<div class="draft-fields">' +
        '<label>截止时间<input type="datetime-local" data-field="dueAt" value="' + U.toLocalInput(d.dueAt) + '"></label>' +
        '<label>占总评 %<input type="number" min="0" max="100" data-field="weight" value="' + (d.weight == null ? '' : d.weight) + '" placeholder="—"></label>' +
        '<label>预计小时<input type="number" min="0" step="0.5" data-field="estHours" value="' + d.estHours + '"></label>' +
        '<label>平台<select data-field="platform">' +
          BG.PLATFORMS.map(function (pl) {
            return '<option value="' + pl.id + '"' + (pl.id === d.platform ? ' selected' : '') + '>' + esc(pl.name) + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="draft-raw">原文：' + esc((d.raw || '').replace(/\s+/g, ' ')) + '</div>' +
    '</article>';
  }

  function renderPreview(res) {
    var el = $('#parseResult');
    if (!res) { el.innerHTML = ''; return; }
    var btn = $('#importBtn');
    if (btn) {
      btn.classList.toggle('is-hidden', !ui.drafts.length);
      btn.textContent = '导入 ' + ui.drafts.length + ' 条';
    }
    var head = '<div class="parse-summary"><svg class="ico sm"><use href="#i-spark"/></svg>' +
      '识别到 <b>' + ui.drafts.length + '</b> 条 · 原文 <b>' + res.blockCount + '</b> 段' +
      (res.failed.length ? ' · <span style="color:var(--amber)">' + res.failed.length + ' 段没找到截止时间</span>' : '') +
      '</div>';
    var fail = res.failed.length
      ? '<div class="fail-note">这些段落没识别出时间，可以手动补一条：<br>' +
        res.failed.map(function (f) { return '· ' + esc(f.text) + '…'; }).join('<br>') + '</div>'
      : '';
    el.innerHTML = head + fail + (ui.drafts.length
      ? '<div class="drafts">' + ui.drafts.map(draftRow).join('') + '</div>'
      : '<div class="empty" style="padding:26px"><b>还没识别到内容</b><p>粘贴通知后点“识别一下”，或者先点“填入一段示例通知”。</p></div>');
  }

  function doParse() {
    var text = ($('#noticeInput') || {}).value || '';
    if (!text.trim()) { toast('先粘贴一段通知'); return; }
    var res = BG.parseNotices(text, { now: Date.now(), semStart: settings().semesterStart });
    ui.drafts = res.drafts.map(function (d) { return Object.assign({}, d); });
    renderPreview(res);
    if (!res.drafts.length) toast('没找到截止时间，试试把“11月20日 23:59”这样的写法带上', 'i-warn');
  }

  function confirmImport() {
    var valid = ui.drafts.filter(function (d) { return d.dueAt && d.title; });
    if (!valid.length) { toast('还没有可导入的任务'); return; }
    var r = S.addDrafts(valid, Date.now());
    closeModal();
    render();
    toast('已加入 ' + r.added + ' 个截止点' + (r.skipped ? '，' + r.skipped + ' 条重复已跳过' : ''));
  }

  /* ---------------- 任务表单 ---------------- */
  function goalOptions(selected) {
    var opts = '<option value="">不关联目标</option>';
    goals().forEach(function (g) {
      opts += '<option value="' + g.id + '"' + (g.id === selected ? ' selected' : '') + '>' +
        scopeName(g.scope) + ' · ' + esc(g.title) + '</option>';
    });
    return opts;
  }

  function openTaskForm(task) {
    var isEdit = !!task;
    var t = task || {
      id: null, title: '', course: '', platform: 'manual', type: 'homework',
      dueAt: U.addDays(U.startOfDay(new Date()), 1).getTime() + 23.9 * 3600000,
      weight: null, credits: 2, importance: 2, career: false, goalId: null, estHours: 2, progress: 0, note: ''
    };
    if (!task) t.dueAt = new Date(new Date().setHours(23, 59, 0, 0)).getTime() + DAY;

    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">' + (isEdit ? '编辑任务' : '手动添加') + '</div>' +
              '<h2 id="modalTitle">' + (isEdit ? esc(t.course) + ' · ' + esc(t.title) : '补一条系统里没有的截止时间') + '</h2>' +
              '<p>手动填写适合“老师口头布置”或者通知太短、拆不出来的情况。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="form">' +
              '<div class="field full"><label for="fTitle">任务名</label>' +
                '<input id="fTitle" class="input" value="' + esc(t.title) + '" placeholder="例如：第 11 周作业"></div>' +
              '<div class="field"><label for="fCourse">课程</label>' +
                '<input id="fCourse" class="input" value="' + esc(t.course) + '" placeholder="例如：高等数学A(上)"></div>' +
              '<div class="field"><label for="fPlatform">来源平台</label>' +
                '<select id="fPlatform" class="input">' + BG.PLATFORMS.map(function (p) {
                  return '<option value="' + p.id + '"' + (p.id === t.platform ? ' selected' : '') + '>' + esc(p.name) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="field"><label for="fDue">截止时间</label>' +
                '<input id="fDue" class="input" type="datetime-local" value="' + U.toLocalInput(t.dueAt) + '"></div>' +
              '<div class="field"><label for="fType">类型</label>' +
                '<select id="fType" class="input">' + BG.TYPES.map(function (ty) {
                  return '<option value="' + ty.id + '"' + (ty.id === t.type ? ' selected' : '') + '>' + esc(ty.name) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="field"><label for="fWeight">占总评 %（可空）</label>' +
                '<input id="fWeight" class="input" type="number" min="0" max="100" value="' + (t.weight == null ? '' : t.weight) + '" placeholder="例如 30"></div>' +
              '<div class="field"><label for="fCredits">课程学分</label>' +
                '<input id="fCredits" class="input" type="number" min="0" max="20" step="0.5" value="' + (t.credits == null ? 2 : t.credits) + '"></div>' +
              '<div class="field"><label for="fHours">预计投入小时</label>' +
                '<input id="fHours" class="input" type="number" min="0" step="0.5" value="' + t.estHours + '"></div>' +
              '<div class="field full"><label class="check-line"><input id="fCareer" type="checkbox"' + (t.career ? ' checked' : '') + '> ' +
                '与职业规划相关 <span class="muted">（在设置里填写职业规划后生效）</span></label></div>' +
              '<div class="field full"><label for="fGoal">关联周 / 月 / 日目标（可空）</label>' +
                '<select id="fGoal" class="input">' + goalOptions(t.goalId) + '</select></div>' +
              '<div class="field full"><label for="fNote">备注</label>' +
                '<textarea id="fNote" class="input" placeholder="提交方式、格式要求、组队信息……">' + esc(t.note) + '</textarea></div>' +
              (isEdit ? '<div class="field full"><label>完成进度</label>' +
                '<div class="progress-row"><input id="fProgress" type="range" class="range" min="0" max="100" step="5" value="' + (t.progress || 0) + '">' +
                '<b id="fProgressOut">' + (t.progress || 0) + '%</b></div></div>' : '') +
            '</div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            (isEdit ? '<button class="link-btn" data-action="delete" data-id="' + t.id + '">删除这条任务</button>' : '<span class="foot-note">保存后会立刻进入优先级排序。</span>') +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-dark" data-action="save-task" data-id="' + (t.id || '') + '">保存</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';

    var pr = $('#fProgress');
    if (pr) pr.addEventListener('input', function () { $('#fProgressOut').textContent = pr.value + '%'; });
    setTimeout(function () { var el = $('#fTitle'); if (el) el.focus(); }, 50);
  }

  function saveTask(id) {
    var title = $('#fTitle').value.trim();
    var course = $('#fCourse').value.trim() || '未分类';
    var due = U.fromLocalInput($('#fDue').value);
    if (!title) { toast('任务名不能为空', 'i-warn'); $('#fTitle').focus(); return; }
    if (!due) { toast('请选择截止时间', 'i-warn'); $('#fDue').focus(); return; }

    var patch = {
      title: title, course: course, platform: $('#fPlatform').value, type: $('#fType').value,
      dueAt: due, weight: $('#fWeight').value === '' ? null : Number($('#fWeight').value),
      credits: Number($('#fCredits').value) || 2,
      career: !!($('#fCareer') && $('#fCareer').checked),
      goalId: $('#fGoal').value || null,
      estHours: Number($('#fHours').value) || 2, note: $('#fNote').value.trim()
    };
    if ($('#fProgress')) patch.progress = Number($('#fProgress').value);

    if (id) {
      S.update(id, patch);
      toast('已更新');
    } else {
      S.addDrafts([Object.assign({ confidence: {} }, patch)], Date.now());
      toast('已添加一条截止时间');
    }
    closeModal();
    render();
  }

  function closeModal() {
    $('#modalRoot').innerHTML = '';
  }

  function confirmDialog(title, text, okLabel, onOk) {
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal" style="width:min(420px,100%)" role="dialog" aria-modal="true">' +
          '<header class="modal-head"><div><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></div></header>' +
          '<footer class="modal-foot"><span></span><div class="btn-row-end">' +
            '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
            '<button class="btn btn-danger-ghost" data-action="confirm-ok">' + esc(okLabel) + '</button>' +
          '</div></footer>' +
        '</div>' +
      '</div>';
    $('#modalRoot').querySelector('[data-action="confirm-ok"]').addEventListener('click', function () {
      closeModal(); onOk();
    });
  }

  /* ---------------- 提醒 ---------------- */
  function enableNotify() {
    if (!('Notification' in window)) { toast('这个浏览器不支持桌面通知', 'i-warn'); return; }
    if (Notification.permission === 'granted') {
      S.setSettings({ notify: true });
      toast('桌面提醒已开启，页面开着时会在节点弹出');
      render();
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        S.setSettings({ notify: true });
        toast('桌面提醒已开启');
        render();
      } else {
        toast('通知权限被拒绝，可以在浏览器站点设置里重新允许', 'i-warn');
      }
    }).catch(function () { toast('这个环境不支持通知权限', 'i-warn'); });
  }

  function checkNotifications() {
    var st = settings();
    if (!st.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    M.reminders(tasks(), Date.now()).forEach(function (r) {
      var key = r.task.id + '|' + r.label;
      if (ui.fired[key]) return;
      if (r.at <= Date.now() && r.at > Date.now() - 2 * 60000) {
        ui.fired[key] = true;
        var body = r.label === '截止'
          ? '现在截止：' + r.task.course + ' · ' + r.task.title
          : r.label + '：' + r.task.course + ' · ' + r.task.title;
        try { new Notification('不鸽 · ' + U.fmtTime(r.task.dueAt) + ' 截止', { body: body }); } catch (e) { /* ignore */ }
        toast(body, 'i-bell');
      }
    });
  }

  /* ---------------- 导出 ---------------- */
  function exportIcs() {
    var ics = M.toIcs(tasks());
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '不鸽-作业截止.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已导出 .ics，可导入手机自带日历');
  }

  /* ---------------- 目标 / 社团 ---------------- */
  function addGoalFromForm() {
    var title = ($('#goalTitle').value || '').trim();
    if (!title) { toast('给目标起个名字', 'i-warn'); $('#goalTitle').focus(); return; }
    var scope = $('#goalScope').value;
    var hours = Number($('#goalHours').value) || (scope === 'day' ? 0.5 : 3);
    var imp = Number($('#goalImp').value) || 2;
    S.addGoal({
      title: title, scope: scope, targetHours: hours, importance: imp, progress: 0,
      deadline: P.goalDeadline({ scope: scope, deadline: 0 }, now)
    });
    $('#goalTitle').value = '';
    render();
    toast('目标已加入排程：每天固定' + (scope === 'day' ? '一块' : ' 45 分钟'));
  }

  function isoDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function syncActivityForm() {
    var rep = ($('#fActRepeat') || {}).value || 'weekly';
    if ($('#actWeeksWrap')) $('#actWeeksWrap').classList.toggle('is-hidden', rep !== 'weekly');
    if ($('#actDateWrap')) $('#actDateWrap').classList.toggle('is-hidden', rep !== 'once');
    if ($('#actDayWrap')) $('#actDayWrap').classList.toggle('is-hidden', rep === 'once');
  }

  function openActivityForm(activity) {
    var isEdit = !!activity;
    var base = activity || {
      title: '', kind: 'club', repeat: 'weekly', weeks: 16, day: 1,
      start: '18:30', end: '20:00', place: '', date: isoDate(now)
    };
    var rep = base.repeat === 'once' ? 'once' : (Number(base.weeks) === 1 ? 'week' : 'weekly');
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="actModalTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">固定安排 · ' + (isEdit ? '编辑' : '新增') + '</div>' +
              '<h2 id="actModalTitle">' + (isEdit ? esc(base.title) : '把社团、讲座、实践排进课表') + '</h2>' +
              '<p>可以设「每周 / 仅本周 / 单次」和持续周数；排计划时会整段扣掉。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="form">' +
              '<div class="field full"><label for="fActTitle">名称</label>' +
                '<input id="fActTitle" class="input" value="' + esc(base.title) + '" placeholder="例如：人工智能前沿讲座"></div>' +
              '<div class="field"><label for="fActKind">类型</label>' +
                '<select id="fActKind" class="input">' +
                  '<option value="club"' + (base.kind === 'club' ? ' selected' : '') + '>社团活动</option>' +
                  '<option value="other"' + (base.kind === 'other' ? ' selected' : '') + '>其他活动</option>' +
                '</select></div>' +
              '<div class="field"><label for="fActRepeat">重复</label>' +
                '<select id="fActRepeat" class="input">' +
                  '<option value="weekly"' + (rep === 'weekly' ? ' selected' : '') + '>每周重复</option>' +
                  '<option value="week"' + (rep === 'week' ? ' selected' : '') + '>仅本周</option>' +
                  '<option value="once"' + (rep === 'once' ? ' selected' : '') + '>单次</option>' +
                '</select></div>' +
              '<div class="field" id="actWeeksWrap"><label for="fActWeeks">持续周数</label>' +
                '<input id="fActWeeks" class="input" type="number" min="1" max="52" step="1" value="' + (Number(base.weeks) || 16) + '"></div>' +
              '<div class="field is-hidden" id="actDateWrap"><label for="fActDate">单次日期</label>' +
                '<input id="fActDate" class="input" type="date" value="' + (base.date || isoDate(now)) + '"></div>' +
              '<div class="field" id="actDayWrap"><label for="fActDay">星期</label>' +
                '<select id="fActDay" class="input">' +
                  [1, 2, 3, 4, 5, 6, 7].map(function (d) {
                    return '<option value="' + d + '"' + (Number(base.day) === d ? ' selected' : '') + '>' + U.WEEK[d - 1] + '</option>';
                  }).join('') +
                '</select></div>' +
              '<div class="field"><label for="fActStart">开始时间</label>' +
                '<input id="fActStart" class="input" type="time" value="' + (base.start || '18:30') + '"></div>' +
              '<div class="field"><label for="fActEnd">结束时间</label>' +
                '<input id="fActEnd" class="input" type="time" value="' + (base.end || '20:00') + '"></div>' +
              '<div class="field full"><label for="fActPlace">地点（可空）</label>' +
                '<input id="fActPlace" class="input" value="' + esc(base.place || '') + '" placeholder="例如：图书馆报告厅 / 线上"></div>' +
            '</div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">「仅本周」只影响当前这一周，下周自动失效。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-dark" data-action="save-activity" data-id="' + (isEdit ? base.id : '') + '">保存</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';
    syncActivityForm();
    setTimeout(function () { var el = $('#fActTitle'); if (el) el.focus(); }, 50);
  }

  function saveActivityForm(id) {
    var title = ($('#fActTitle').value || '').trim();
    var kind = $('#fActKind').value || 'club';
    var rep = $('#fActRepeat').value || 'weekly';
    var start = $('#fActStart').value || '18:30';
    var end = $('#fActEnd').value || '20:00';
    if (!title) { toast('给安排起个名字', 'i-warn'); $('#fActTitle').focus(); return; }
    if (toMin(end) <= toMin(start)) { toast('结束时间要晚于开始时间', 'i-warn'); return; }
    var repeat = rep === 'once' ? 'once' : 'weekly';
    var weeks = rep === 'once' ? 0 : (rep === 'week' ? 1 : Math.max(1, Math.min(52, Number($('#fActWeeks').value) || 16)));
    var date = rep === 'once' ? ($('#fActDate').value || '') : '';
    if (repeat === 'once' && !date) { toast('选一个单次日期', 'i-warn'); return; }
    var day = Number($('#fActDay').value) || 1;
    if (repeat === 'once') {
      var dt = new Date(date + 'T00:00:00');
      day = ((dt.getDay() + 6) % 7) + 1;
    }
    var startWeek = 0;
    if (repeat === 'weekly') {
      /* 保存时从本周重新起算，改「持续周数」立即生效 */
      startWeek = U.mondayOf(new Date(now)).getTime();
    }
    var draft = {
      title: title, kind: kind, repeat: repeat, weeks: weeks, startWeek: startWeek,
      date: date, day: day, start: start, end: end, place: ($('#fActPlace').value || '').trim()
    };
    if (id) {
      S.updateActivity(id, draft);
      toast('已更新固定安排');
    } else {
      S.addActivity(draft);
      toast('已加入' + BG.activityKind(kind).name);
    }
    closeModal();
    render();
  }

  function setPriorityWeight(which, value) {
    var v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    var next = which === 'urgency'
      ? { urgency: v, importance: 100 - v }
      : { urgency: 100 - v, importance: v };
    S.setSettings({ priorityWeights: next });
    render();
  }

  function setImportanceWeight(key, value) {
    var s = settings();
    var raw = Object.assign({}, BG.DEFAULT_WEIGHTS, s.importanceWeights || {});
    var keys = ['gpa', 'credits', 'career'];
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    var others = keys.filter(function (k) { return k !== key; });
    var sumOthers = others.reduce(function (a, k) { return a + Math.max(0, Number(raw[k]) || 0); }, 0);
    var remaining = 100 - v;
    var next = {};
    next[key] = v;
    if (sumOthers <= 0) {
      others.forEach(function (k) { next[k] = remaining / 2; });
    } else {
      others.forEach(function (k) {
        next[k] = remaining * Math.max(0, Number(raw[k]) || 0) / sumOthers;
      });
    }
    var vals = keys.map(function (k) { return Math.round((next[k] || 0) * 10) / 10; });
    vals[2] = Math.round((100 - vals[0] - vals[1]) * 10) / 10;
    if (vals[2] < 0) { vals[1] += vals[2]; vals[2] = 0; }
    S.setSettings({
      importanceWeights: { gpa: vals[0], credits: vals[1], career: vals[2] }
    });
    render();
  }

  function applyProfile(parsed) {
    var patch = Object.assign({}, parsed.settings);
    patch.profileName = parsed.source;
    patch.profileAt = Date.now();
    S.setSettings(patch);
    render();
    toast('已导入 ' + parsed.fields.length + ' 个字段：' + parsed.source);
  }

  function buildProfileFile(text, filename) {
    try {
      var res = BG.profile.parse(text, filename);
      applyProfile(res);
    } catch (e) {
      toast(e.message || '文件读不出来', 'i-warn');
    }
  }

  /* ================= 音乐（白噪音 / 纯音乐） ================= */
  function musicTimerText() {
    var rem = BG.music.timerRemaining();
    if (!rem) return '不限时';
    return Math.ceil(rem / 60000) + ' 分钟后停';
  }

  function musicTrackRow(t) {
    var st = BG.music.state();
    var active = st.track && st.track.id === t.id;
    return '<button class="mtrack' + (active ? ' is-active' : '') + '" data-action="music-play" data-id="' + t.id + '">' +
      '<span class="mtrack-ico"><svg class="ico"><use href="#' + (active && st.playing ? 'i-pause' : 'i-play') + '"/></svg></span>' +
      '<span class="mtrack-body"><b>' + esc(t.title) + '</b><span>' + esc(t.genre || '') +
        (t.desc ? ' · ' + esc(t.desc) : '') + '</span></span>' +
      '<span class="mtrack-tag">' + (t.local ? '本地' : '内置') + '</span>' +
    '</button>';
  }

  function renderMusicModal() {
    var st = BG.music.state();
    if (!$('#musicList')) return;
    $('#musicList').innerHTML = BG.music.all().map(musicTrackRow).join('');
    var vol = $('#musicVol');
    if (vol && document.activeElement !== vol) vol.value = Math.round(st.volume * 100);
    var out = $('#musicVolOut');
    if (out) out.textContent = Math.round(st.volume * 100) + '%';
    var tl = $('#musicTimerLabel');
    if (tl) tl.textContent = musicTimerText();
    $$('.music-timers .seg-btn').forEach(function (b) {
      var min = Number(b.dataset.min);
      b.classList.toggle('is-on', min === (st.timerMinutes || 0));
    });
  }

  function openMusic() {
    var st = BG.music.state();
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal music-modal" role="dialog" aria-modal="true" aria-labelledby="musicTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">音乐 · 白噪音 / 纯音乐</div>' +
              '<h2 id="musicTitle">把耳朵安顿好</h2>' +
              '<p>内置曲目在浏览器里实时合成，离线也能听；也可以导入自己下载的音乐。所有声音只在本机播放。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="收起"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="music-list" id="musicList">' + BG.music.all().map(musicTrackRow).join('') + '</div>' +
            '<div class="music-tools">' +
              '<label class="btn btn-ghost upload-btn">' +
                '<svg class="ico"><use href="#i-upload"/></svg>导入本地音乐' +
                '<input id="musicFile" type="file" accept="audio/*" multiple>' +
              '</label>' +
              '<a class="link-btn" href="https://github.com/btahir/open-lofi" target="_blank" rel="noopener">去 CC0 曲库 Open Lo-Fi 下载</a>' +
            '</div>' +
            '<p class="music-credit">CC0 推荐：After School Rain / Terminal Rain / Temple at Dawn；下载后点「导入本地音乐」。</p>' +
            '<div class="music-settings">' +
              '<div class="setting-row"><span>音量</span><output id="musicVolOut">' + Math.round(st.volume * 100) + '%</output></div>' +
              '<input id="musicVol" class="range" type="range" min="0" max="100" step="5" value="' + Math.round(st.volume * 100) + '">' +
              '<div class="setting-row mt"><span>定时停止</span><span class="muted" id="musicTimerLabel">' + musicTimerText() + '</span></div>' +
              '<div class="seg music-timers">' +
                '<button class="seg-btn" data-action="music-timer" data-min="0">不限</button>' +
                '<button class="seg-btn" data-action="music-timer" data-min="15">15 分钟</button>' +
                '<button class="seg-btn" data-action="music-timer" data-min="30">30 分钟</button>' +
                '<button class="seg-btn" data-action="music-timer" data-min="45">45 分钟</button>' +
                '<button class="seg-btn" data-action="music-timer" data-min="60">60 分钟</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">收起后继续播放，右下角可以暂停。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="music-stop">停止</button>' +
              '<button class="btn btn-dark" data-action="close-modal">收起</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';
    renderMusicModal();
  }

  function renderMusicDock() {
    var dock = $('#musicDock');
    if (!dock) return;
    var st = BG.music.state();
    if (!st.track) {
      dock.classList.add('is-hidden');
      dock.innerHTML = '';
      return;
    }
    dock.classList.remove('is-hidden');
    dock.innerHTML =
      '<span class="mdot' + (st.playing ? ' on' : '') + '"></span>' +
      '<div class="dock-body"><b>' + esc(st.track.title) + '</b><span>音乐 · ' +
        (st.playing ? '正在播放' : '已暂停') + (st.timerUntil ? ' · ' + musicTimerText() : '') + '</span></div>' +
      '<button class="icon-btn" data-action="music-toggle" title="' + (st.playing ? '暂停' : '播放') + '" aria-label="' + (st.playing ? '暂停' : '播放') + '">' +
        '<svg class="ico"><use href="#' + (st.playing ? 'i-pause' : 'i-play') + '"/></svg></button>' +
      '<button class="icon-btn" data-action="music-stop" title="停止" aria-label="停止">' +
        '<svg class="ico"><use href="#i-stop"/></svg></button>' +
      '<button class="icon-btn" data-action="music-dismiss" title="收起播放器" aria-label="收起播放器">' +
        '<svg class="ico"><use href="#i-close"/></svg></button>' +
      '<button class="icon-btn" data-action="open-music" title="打开音乐" aria-label="打开音乐">' +
        '<svg class="ico"><use href="#i-music"/></svg></button>';
  }

  /* ================= 自习室 ================= */
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    s = s % 60;
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function studySuggestions() {
    var plan = ui.plan || M.weekPlan(now);
    var day = plan.days[0];
    var map = {};
    var items = [];
    day.blocks.forEach(function (b) {
      if (b.kind !== 'task') return;
      var t = byId(tasks(), b.taskId);
      if (!t || t.status === 'done') return;
      var item = map[t.id];
      if (!item) {
        item = map[t.id] = {
          id: t.id, taskId: t.id, title: t.title, course: t.course,
          minutes: 0, start: b.start, selected: true, done: false, baseProgress: t.progress || 0
        };
      }
      item.minutes += b.minutes;
    });
    Object.keys(map).forEach(function (id) { items.push(map[id]); });
    items.sort(function (a, b) { return a.start - b.start; });
    if (!items.length) {
      /* 今天没排任务块（比如深夜），退而求其次：未来 24 小时到期的任务 */
      tasks().filter(function (t) {
        return t.status !== 'done' && t.dueAt < now + DAY;
      }).slice(0, 3).forEach(function (t) {
        items.push({
          id: t.id, taskId: t.id, title: t.title, course: t.course,
          minutes: Math.max(20, Math.min(60, Math.round(M.remainingHours(t) * 60))),
          start: t.dueAt, selected: true, done: false, baseProgress: t.progress || 0
        });
      });
    }
    return items;
  }

  function studyTotal() {
    if (!ui.study) return 0;
    return ui.study.items.reduce(function (sum, it) {
      return sum + (it.selected ? Math.max(10, Number(it.minutes) || 0) : 0);
    }, 0);
  }

  function allStudyDone() {
    if (!ui.study) return false;
    var chosen = ui.study.items.filter(function (x) { return x.selected; });
    return chosen.length > 0 && chosen.every(function (x) { return x.done; });
  }

  function openStudy() {
    if (ui.study && ui.study.phase === 'active') { renderStudySession(); return; }
    if (ui.study && ui.study.phase === 'done') { ui.study = null; }
    if (!ui.study) {
      var items = studySuggestions();
      ui.study = { phase: 'setup', items: items, manualSession: false, completed: {} };
      var total = items.reduce(function (s, it) { return s + (it.selected ? it.minutes : 0); }, 0);
      ui.study.sessionMinutes = Math.max(15, total || 45);
    }
    renderStudySetup();
  }

  function renderStudySetup() {
    var s = ui.study;
    var total = studyTotal();
    if (!s.manualSession) s.sessionMinutes = Math.max(15, total || 45);
    var rows = s.items.map(function (it, i) {
      return '<div class="study-item' + (it.selected ? ' is-on' : '') + '">' +
        '<label class="study-check"><input type="checkbox" data-study-check="' + i + '"' + (it.selected ? ' checked' : '') + '>' +
          '<span></span></label>' +
        '<div class="study-info"><b>' + esc(it.title) + '</b><span>' + esc(it.course || '') + ' · 今天的计划份额</span></div>' +
        '<label class="study-min"><input type="number" min="10" max="180" step="5" data-study-min="' + i + '" value="' + it.minutes + '"' + (it.selected ? '' : ' disabled') + '> 分钟</label>' +
      '</div>';
    }).join('');
    var empty = !s.items.length
      ? '<div class="empty study-empty"><b>今天还没有可自习的任务块</b><p>先去学习计划看看今天排了什么，或者导入一条通知。</p>' +
        '<button class="btn btn-ghost" data-action="study-go-plan">去学习计划</button></div>'
      : '';
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal wide study-modal" role="dialog" aria-modal="true" aria-labelledby="studyTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">自习室 · 限时专注</div>' +
              '<h2 id="studyTitle">这一段时间，只做这几件</h2>' +
              '<p>系统按今天的计划挑了 ' + s.items.length + ' 件（不含社团和其他活动），预计 ' + total + ' 分钟。你可以删减任务，也可以改每件的预期时间。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            rows + empty +
            (s.items.length ? '<div class="study-setup">' +
              '<div class="study-total">已选 <b>' + s.items.filter(function (x) { return x.selected; }).length + '</b> 件 · 预计 <b id="studyTotalNum">' + total + '</b> 分钟</div>' +
              '<label class="study-session">本次专注 <input id="studyMinutes" type="number" min="15" max="240" step="5" value="' + s.sessionMinutes + '"> 分钟</label>' +
              '<p class="study-fit" id="studyFit">专注时长要覆盖已选任务，开始后不能暂停。</p>' +
            '</div>' : '') +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">开始后计时不可暂停，提前离开会中断本次专注。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-lime" data-action="study-start"' + (s.items.length ? '' : ' disabled') + '>开始专注</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';
    updateStudyFit();
  }

  function studyBaseUpdate(item, done) {
    var t = byId(tasks(), item.taskId);
    if (!t) return;
    var est = Math.max(0.25, Number(t.estHours) || 1);
    var ratio = Math.min(100, Math.round((item.minutes / (est * 60)) * 100));
    var base = Math.max(0, Number(item.baseProgress) || 0);
    var next = done ? Math.min(100, base + ratio) : base;
    var patch = { progress: next };
    if (!done) patch.status = next >= 100 ? 'done' : 'todo';
    S.update(item.taskId, patch);
  }

  function renderStudySession() {
    var s = ui.study;
    if (!s || s.phase !== 'active') return;
    var left = Math.max(0, s.endsAt - Date.now());
    var pct = s.minutes ? Math.max(0, Math.min(100, 100 - left / (s.minutes * 60000) * 100)) : 0;
    var rows = s.items.filter(function (it) { return it.selected; }).map(function (it) {
      var idx = s.items.indexOf(it);
      return '<label class="study-run-item' + (it.done ? ' is-done' : '') + '">' +
        '<input type="checkbox" data-study-done="' + idx + '"' + (it.done ? ' checked' : '') + '>' +
        '<span class="study-run-title">' + esc(it.title) + '</span>' +
        '<span class="study-run-min">' + it.minutes + ' 分钟</span>' +
      '</label>';
    }).join('');
    var doneCount = s.items.filter(function (x) { return x.selected && x.done; }).length;
    var chosenCount = s.items.filter(function (x) { return x.selected; }).length;
    var allDone = chosenCount > 0 && doneCount === chosenCount;
    $('#modalRoot').innerHTML =
      '<div class="modal-mask study-mask">' +
        '<div class="modal study-modal study-run" role="dialog" aria-modal="true" aria-labelledby="studyRunTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">自习室 · 专注中</div>' +
              '<h2 id="studyRunTitle">只做这一件事</h2>' +
              '<p>手机扣过去，切走会中断。时间到了会自动结算。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="study-exit-guard" aria-label="提前离开"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="study-clock-wrap">' +
              '<div class="study-clock" id="studyClock">' + fmtClock(left) + '</div>' +
              '<div class="study-clock-label">还剩</div>' +
              '<div class="study-progress"><i id="studyProgress" style="width:' + pct.toFixed(1) + '%"></i></div>' +
              '<div class="study-run-meta">本次 <b>' + s.minutes + '</b> 分钟 · 已选 <b>' + s.items.filter(function (x) { return x.selected; }).length + '</b> 件 · 完成 <b>' + doneCount + '</b> 件</div>' +
            '</div>' +
            '<div class="study-run-list">' + rows + '</div>' +
            '<p class="study-note">完成的勾上，会自动同步到任务进度；没勾的留到下一轮。</p>' +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">' + (allDone ? '都勾完了，可以提前结算。' : '全部勾完或时间到才会结算。') + '</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="study-exit-guard">提前离开</button>' +
              (allDone ? '<button class="btn btn-dark" data-action="study-finish-early">完成本轮</button>' : '') +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';
    startStudyTimer();
  }

  function updateStudyClock() {
    if (!ui.study || ui.study.phase !== 'active') return;
    var left = ui.study.endsAt - Date.now();
    if (left <= 0) {
      finishStudy();
      return;
    }
    var el = $('#studyClock');
    if (el) el.textContent = fmtClock(left);
    var bar = $('#studyProgress');
    if (bar) bar.style.width = Math.max(0, Math.min(100, 100 - left / (ui.study.minutes * 60000) * 100)).toFixed(1) + '%';
  }

  function startStudyTimer() {
    clearInterval(ui.studyTimer);
    ui.studyTimer = setInterval(updateStudyClock, 1000);
  }

  function stopStudyTimer() {
    clearInterval(ui.studyTimer);
    ui.studyTimer = null;
  }

  function finishStudy() {
    if (!ui.study) return;
    stopStudyTimer();
    ui.study.phase = 'done';
    var s = ui.study;
    var chosen = s.items.filter(function (x) { return x.selected; });
    var done = chosen.filter(function (x) { return x.done; });
    var left = chosen.filter(function (x) { return !x.done; });
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal study-modal" role="dialog" aria-modal="true">' +
          '<header class="modal-head"><div><div class="kicker">自习室 · 结算</div>' +
            '<h2>时间到，先给自己记一笔</h2>' +
            '<p>这一轮完成 <b>' + done.length + ' / ' + chosen.length + '</b> 件。</p></div>' +
            '<button class="icon-btn" data-action="study-close" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="study-result">' +
              '<div class="study-result-num">' + done.length + '<span>/ ' + chosen.length + '</span></div>' +
              '<div class="study-result-label">已勾选完成</div>' +
            '</div>' +
            (left.length
              ? '<div class="plan-warn"><b>还没完成的：</b><br>' + left.map(function (x) { return '· ' + esc(x.title) + '（' + x.minutes + ' 分钟）'; }).join('<br>') + '</div>'
              : '<p class="study-note">这一轮全清了，去喝口水。</p>') +
          '</div>' +
          '<footer class="modal-foot"><span class="foot-note">没完成的不会消失，仍留在任务清单里。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="study-again">再开一轮</button>' +
              '<button class="btn btn-dark" data-action="study-close">回到总览</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';
    toast(done.length + ' / ' + chosen.length + ' 件完成，别急着切走', 'i-check');
  }

  function studyExitGuard() {
    if (!ui.study || ui.study.phase !== 'active') { closeModal(); return; }
    /* 计时继续跑，但把模态换成确认层 */
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal" style="width:min(440px,100%)" role="dialog" aria-modal="true">' +
          '<header class="modal-head"><div><h2>专注还没结束</h2>' +
            '<p>现在离开，这一轮专注会中断，已经勾选的进度会保留。要不要再坚持一下？</p></div></header>' +
          '<footer class="modal-foot"><span></span><div class="btn-row-end">' +
            '<button class="btn btn-ghost" data-action="study-stay">继续专注</button>' +
            '<button class="btn btn-danger-ghost" data-action="study-leave">中断并离开</button>' +
          '</div></footer>' +
        '</div>' +
      '</div>';
  }

  function closeStudy() {
    stopStudyTimer();
    ui.study = null;
    closeModal();
    render();
  }

  function updateStudyFit() {
    var s = ui.study;
    if (!s) return;
    var total = studyTotal();
    var minutes = Number(s.sessionMinutes) || 0;
    var el = $('#studyFit');
    if (!el) return;
    if (minutes < total) {
      el.textContent = '专注时长比已选任务少 ' + (total - minutes) + ' 分钟，开始前请延长或删减任务。';
      el.classList.add('warn');
    } else {
      el.textContent = '专注时长覆盖已选任务，开始后不能暂停。';
      el.classList.remove('warn');
    }
  }

  function startStudyFromSetup() {
    var s = ui.study;
    if (!s) return;
    var chosen = s.items.filter(function (x) { return x.selected; });
    if (!chosen.length) { toast('至少选一件今天要做的事', 'i-warn'); return; }
    var total = studyTotal();
    var minutes = Number(s.sessionMinutes) || total;
    if (minutes < total) {
      toast('专注时长不够完成已选任务，请延长时长或删减任务', 'i-warn');
      var box = $('#studyMinutes');
      if (box) box.focus();
      return;
    }
    s.minutes = Math.max(15, Math.min(240, minutes));
    s.endsAt = Date.now() + s.minutes * 60000;
    s.phase = 'active';
    s.items.forEach(function (it) {
      it.done = false;
      var t = byId(tasks(), it.taskId);
      it.baseProgress = t ? (t.progress || 0) : 0;
    });
    renderStudySession();
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var mask = e.target.classList && e.target.classList.contains('modal-mask');
    var trigger = e.target.closest('[data-action]');

    if (mask) {
      if (ui.study && ui.study.phase === 'active') { studyExitGuard(); return; }
      closeModal();
      return;
    }
    if (!trigger) return;

    var action = trigger.dataset.action;
    var id = trigger.dataset.id;

    switch (action) {
      case 'view': setView(trigger.dataset.view); break;
      case 'back': goBack(); break;
      case 'plan-day':
        ui.planDay = Number(trigger.dataset.day) || 0;
        render();
        break;
      case 'replan':
        render();
        toast('已按现在的任务、目标和时间重排');
        break;
      case 'filter': ui.filter = trigger.dataset.filter; render(); break;
      case 'platform':
        ui.platform = trigger.dataset.platform;
        if (ui.view === 'overview') setView('tasks'); else render();
        break;
      case 'clear-platform': ui.platform = 'all'; render(); break;
      case 'open-import': openImport(); break;
      case 'open-manual': openTaskForm(null); break;
      case 'open-activity': openActivityForm(null); break;
      case 'edit-activity':
        var actEdit = byId(activities(), id);
        if (actEdit) openActivityForm(actEdit);
        break;
      case 'save-activity': saveActivityForm(id); break;
      case 'download-profile': {
        var text = BG.profile.example();
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '不鸽-学校档案模板.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('模板已下载，按字段改成自己的就行');
        break;
      }
      case 'open-music': openMusic(); break;
      case 'open-study': openStudy(); break;
      case 'music-play': {
        var tr = BG.music.byId(id);
        if (!tr) break;
        var mst = BG.music.state();
        if (mst.track && mst.track.id === id && mst.playing) BG.music.stop();
        else BG.music.play(tr);
        renderMusicModal();
        break;
      }
      case 'music-toggle': BG.music.toggle(); break;
      case 'music-stop': BG.music.stop(); break;
      case 'music-dismiss': BG.music.dismiss(); break;
      case 'music-timer': {
        BG.music.setTimer(Number(trigger.dataset.min) || 0);
        renderMusicModal();
        break;
      }
      case 'remove-activity':
        confirmDialog('删除这个固定安排？', '删除后不会再出现在任务清单、学习计划和自习室可用时间里。', '删除', function () {
          S.removeActivity(id);
          render();
          toast('已删除固定安排');
        });
        break;
      case 'study-start': startStudyFromSetup(); break;
      case 'study-exit-guard': studyExitGuard(); break;
      case 'study-stay': renderStudySession(); break;
      case 'study-leave':
        closeStudy();
        toast('已中断本次专注');
        break;
      case 'study-close': closeStudy(); break;
      case 'study-go-plan':
        ui.study = null;
        closeModal();
        setView('plan');
        break;
      case 'study-again':
        closeStudy();
        openStudy();
        break;
      case 'study-finish-early':
        if (!allStudyDone()) { toast('还有任务没勾完，坚持到计时结束', 'i-warn'); break; }
        finishStudy();
        break;
      case 'close-modal': closeModal(); break;
      case 'fill-sample':
        $('#noticeInput').value = BG.SAMPLE_NOTICE;
        $('#charCount').textContent = $('#noticeInput').value.length + ' 字';
        doParse();
        break;
      case 'parse': doParse(); break;
      case 'import-confirm': confirmImport(); break;
      case 'drop-draft': {
        var idx = Number(trigger.dataset.index);
        ui.drafts.splice(idx, 1);
        renderPreview({ blockCount: ui.drafts.length + 1, failed: [] });
        break;
      }
      case 'save-task': saveTask(id); break;
      case 'toggle': {
        var t = tasks().filter(function (x) { return x.id === id; })[0];
        if (!t) break;
        var done = t.status !== 'done';
        S.update(id, { status: done ? 'done' : 'todo', progress: done ? 100 : 0 });
        render();
        toast(done ? '完成 · 还剩 ' + M.stats(tasks(), now).open + ' 件待办' : '已放回待办');
        break;
      }
      case 'edit': {
        var t2 = tasks().filter(function (x) { return x.id === id; })[0];
        if (t2) openTaskForm(t2);
        break;
      }
      case 'delete':
        confirmDialog('删除这条任务？', '删除后无法恢复，导出的日历也不会再包含它。', '删除', function () {
          S.remove(id);
          closeModal();
          render();
          toast('已删除');
        });
        break;
      case 'focus': {
        var el = document.querySelector('.task[data-id="' + id + '"]') ||
          document.querySelector('.pblock[data-id="' + id + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('is-flash');
          setTimeout(function () { el.classList.remove('is-flash'); }, 1400);
        }
        toast('先把最小的那一步做了：打开资料，写下第一行');
        break;
      }
      case 'export-ics': exportIcs(); break;
      case 'notify': enableNotify(); break;
      case 'add-goal': addGoalFromForm(); break;
      case 'del-goal':
        S.removeGoal(id);
        render();
        toast('已删除目标');
        break;
      case 'del-activity':
        S.removeActivity(id);
        render();
        toast('已删除固定安排');
        break;
      case 'seed-demo':
        S.resetDemo(Date.now());
        closeModal();
        render();
        toast('已恢复示例数据（任务、目标、社团、作息一起）');
        break;
      case 'clear-all':
        confirmDialog('清空全部数据？', '这会删掉本机保存的任务、目标和固定安排，重新载入示例可以恢复演示数据。', '清空', function () {
          S.clearAll();
          closeModal();
          render();
          toast('已清空');
        });
        break;
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'wUrgency' || e.target.id === 'wImportance') {
      var pv = Number(e.target.value);
      var other = 100 - pv;
      if (e.target.id === 'wUrgency') {
        if ($('#wUrgencyOut')) $('#wUrgencyOut').textContent = pv + '%';
        if ($('#wImportanceOut')) $('#wImportanceOut').textContent = other + '%';
        if ($('#wImportance')) $('#wImportance').value = other;
      } else {
        if ($('#wImportanceOut')) $('#wImportanceOut').textContent = pv + '%';
        if ($('#wUrgencyOut')) $('#wUrgencyOut').textContent = other + '%';
        if ($('#wUrgency')) $('#wUrgency').value = other;
      }
      return;
    }
    if (e.target.id === 'wGpa' || e.target.id === 'wCredits' || e.target.id === 'wCareer') {
      var outId = e.target.id === 'wGpa' ? '#wGpaOut' : e.target.id === 'wCredits' ? '#wCreditsOut' : '#wCareerOut';
      var outEl = $(outId);
      if (outEl) outEl.textContent = e.target.value + '%';
      return;
    }
    if (e.target.id === 'musicVol') {
      var mv = Number(e.target.value);
      BG.music.setVolume(mv / 100);
      var mo = $('#musicVolOut');
      if (mo) mo.textContent = mv + '%';
      return;
    }
    if (e.target.id === 'studyMinutes' && ui.study) {
      ui.study.sessionMinutes = Number(e.target.value);
      ui.study.manualSession = true;
      updateStudyFit();
      return;
    }
    var field = e.target.dataset.field;
    if (!field) return;
    var card = e.target.closest('.draft');
    if (!card) return;
    var idx = Number(card.dataset.index);
    var d = ui.drafts[idx];
    if (!d) return;
    if (field === 'dueAt') d.dueAt = U.fromLocalInput(e.target.value);
    else if (field === 'weight') d.weight = e.target.value === '' ? null : Number(e.target.value);
    else if (field === 'estHours') d.estHours = Number(e.target.value) || 0;
    else d[field] = e.target.value;
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'musicFile') {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (files.length) {
        var last = null;
        files.forEach(function (f) {
          var made = BG.music.addFile(f);
          if (made) last = made;
        });
        if (last) BG.music.play(last);
        renderMusicModal();
      }
      e.target.value = '';
      return;
    }
    if (e.target.id === 'profileFile') {
      var file = (e.target.files || [])[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { buildProfileFile(String(reader.result || ''), file.name); };
      reader.onerror = function () { toast('文件读取失败', 'i-warn'); };
      reader.readAsText(file);
      e.target.value = '';
      return;
    }
    if (e.target.id === 'fActRepeat') { syncActivityForm(); return; }
    if (e.target.id === 'wUrgency') { setPriorityWeight('urgency', Number(e.target.value)); return; }
    if (e.target.id === 'wImportance') { setPriorityWeight('importance', Number(e.target.value)); return; }
    if (e.target.id === 'wGpa') { setImportanceWeight('gpa', Number(e.target.value)); return; }
    if (e.target.id === 'wCredits') { setImportanceWeight('credits', Number(e.target.value)); return; }
    if (e.target.id === 'wCareer') { setImportanceWeight('career', Number(e.target.value)); return; }
    if (e.target.id === 'careerGoal') {
      S.setSettings({ careerGoal: e.target.value.trim() });
      render();
      return;
    }
    if (e.target.id === 'creditsEarned' || e.target.id === 'creditsRequired') {
      S.setSettings(e.target.id === 'creditsEarned'
        ? { creditsEarned: Math.max(0, Number(e.target.value) || 0) }
        : { creditsRequired: Math.max(0, Number(e.target.value) || 0) });
      render();
      return;
    }
    if (e.target.id === 'schoolReq') {
      S.setSettings({ schoolRequirement: e.target.value.trim() });
      render();
      return;
    }
    if (e.target.dataset && e.target.dataset.studyCheck != null && ui.study) {
      var si = ui.study.items[Number(e.target.dataset.studyCheck)];
      if (si) {
        si.selected = e.target.checked;
        renderStudySetup();
      }
      return;
    }
    if (e.target.dataset && e.target.dataset.studyMin != null && ui.study) {
      var sm = ui.study.items[Number(e.target.dataset.studyMin)];
      if (sm) {
        sm.minutes = Math.max(10, Math.min(180, Number(e.target.value) || 10));
        renderStudySetup();
      }
      return;
    }
    if (e.target.dataset && e.target.dataset.studyDone != null && ui.study) {
      var sd = ui.study.items[Number(e.target.dataset.studyDone)];
      if (sd) {
        sd.done = e.target.checked;
        studyBaseUpdate(sd, sd.done);
        renderStudySession();
        toast(sd.done ? '记下了：' + sd.title : '已取消勾选', sd.done ? 'i-check' : 'i-arrow');
      }
      return;
    }
    if (e.target.id === 'sortSel' || e.target.id === 'sortSel2') {
      ui.sort = e.target.value;
      render();
    }
    if (e.target.id === 'semStart' && e.target.value) {
      var d = new Date(e.target.value + 'T00:00:00');
      S.setSettings({ semesterStart: d.getTime() });
      render();
    }
    if (e.target.id === 'dailyHours') {
      S.setSettings({ dailyHours: Number(e.target.value) });
      render();
    }
    if (e.target.id === 'gpaCurrent' || e.target.id === 'gpaTarget') {
      var v = Number(e.target.value);
      if (isFinite(v) && v >= 0) {
        S.setSettings(e.target.id === 'gpaCurrent' ? { gpaCurrent: v } : { gpaTarget: v });
        render();
      }
    }
    if (e.target.id === 'goalMinutes') {
      S.setSettings({ goalMinutes: Number(e.target.value) });
      render();
    }
    if (e.target.id === 'wakeTime') { S.setSettings({ wake: e.target.value }); render(); }
    if (e.target.id === 'sleepTime') { S.setSettings({ sleep: e.target.value }); render(); }
    if (e.target.dataset && e.target.dataset.goal && e.target.classList.contains('goal-range')) {
      S.updateGoal(e.target.dataset.goal, { progress: Number(e.target.value) });
      render();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#modalRoot').innerHTML) {
      if (ui.study && ui.study.phase === 'active') studyExitGuard();
      else closeModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openImport(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && $('#noticeInput')) doParse();
  });

  /* ---------------- 初始化 ---------------- */
  function init() {
    S.load(Date.now());
    /* 演示入口：file:// 下也能直接打开某个状态给评委看 */
    var params = new URLSearchParams(location.search);
    var state = params.get('state');

    var lastMusicError = '';
    BG.music.on(function (st) {
      if (st.error && st.error !== lastMusicError) {
        lastMusicError = st.error;
        toast(st.error, 'i-warn');
      }
      if (!st.error) lastMusicError = '';
      renderMusicDock();
      if ($('#musicList')) renderMusicModal();
    });

    render();
    setView(params.get('view') === 'settings' ? 'settings' : 'overview');

    if (state === 'import') {
      openImport();
      $('#noticeInput').value = BG.SAMPLE_NOTICE;
      $('#charCount').textContent = BG.SAMPLE_NOTICE.length + ' 字';
      doParse();
    }
    if (state === 'manual') openTaskForm(null);
    if (state === 'settings') setView('settings');
    if (state === 'plan') setView('plan');
    if (state === 'tasks') setView('tasks');
    if (state === 'music') openMusic();
    if (state === 'study') openStudy();
    if (state === 'empty') {
      S.clearAll();
      render();
      toast('示例数据已清空，可以自己导入一条');
    }

    setInterval(checkNotifications, 30000);
    setInterval(function () {
      if (!BG.music.state().timerUntil) return;
      renderMusicDock();
      var tl = $('#musicTimerLabel');
      if (tl) tl.textContent = musicTimerText();
    }, 15000);
    setInterval(function () {
      if (document.hidden) return;
      if ($('#modalRoot').innerHTML) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      render();
    }, 120000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.BG);
