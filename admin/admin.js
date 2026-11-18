/*
  JAX Studio Desk: client management + WhatsApp follow-ups.
  Plain JavaScript, no build step. Data lives in localStorage (see js/store.js).
*/
(function () {
  'use strict';

  var S = window.JAXStore;
  var W = window.JAXWhatsApp;
  var db = S.load();

  var main = document.getElementById('main');
  var modal = document.getElementById('modal');
  var modalBody = document.getElementById('modal-body');
  var toastEl = document.getElementById('toast');

  // Per-page filters, kept while switching pages.
  var ui = { leadQ: '', leadStatus: 'all', memQ: '', memFilter: 'all', payRange: 'month', checkQ: '' };
  var currentPage = 'dashboard';

  /* =====================================================================
     Labels
     ===================================================================== */
  var LEAD_STATUS = [
    ['new', 'New'], ['contacted', 'Contacted'], ['trial_booked', 'Trial booked'],
    ['trial_done', 'Trial done'], ['joined', 'Joined'], ['lost', 'Lost']
  ];
  var LEAD_PILL = { new: 'info', contacted: '', trial_booked: 'warn', trial_done: 'warn', joined: 'ok', lost: 'bad' };
  var MEMBER_STATE = { active: ['Active', 'ok'], expiring: ['Renewal due', 'warn'], expired: ['Expired', 'bad'], frozen: ['Frozen', ''], cancelled: ['Cancelled', ''] };
  var TEMPLATE_LABEL = {
    lead_welcome: 'Welcome new lead',
    trial_followup: 'Trial follow-up',
    renewal: 'Renewal reminder',
    expired: 'Expired membership',
    payment_due: 'Payment due',
    inactive: 'Not seen lately'
  };
  var TEMPLATE_HELP = {
    lead_welcome: 'Sent to new trial bookings.',
    trial_followup: 'Sent after a trial when the person has not joined.',
    renewal: 'Sent before a membership ends.',
    expired: 'Sent after a membership has ended.',
    payment_due: 'Sent when a member owes money.',
    inactive: 'Sent when an active member stops coming.'
  };
  var METHODS = ['Cash', 'UPI', 'Card', 'Bank transfer'];
  var WA_ICON = '<svg class="wa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.9-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';

  /* =====================================================================
     Small helpers
     ===================================================================== */
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() { return S.todayISO(); }
  function parseD(iso) { var p = String(iso).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); } // b minus a
  function addDays(iso, n) { var d = parseD(iso); d.setDate(d.getDate() + n); return S.todayISO(d); }
  function addMonths(iso, m) {
    var d = parseD(iso), day = d.getDate();
    d.setMonth(d.getMonth() + Number(m));
    if (d.getDate() < day) d.setDate(0);
    return S.todayISO(d);
  }
  function dateOf(ts) { return S.todayISO(new Date(ts)); }
  function fmtDate(iso) {
    if (!iso) return '–';
    var d = String(iso).length > 10 ? new Date(iso) : parseD(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function fmtWhen(ts) { return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function money(n) { return (db.settings.currency || '₹') + Number(n || 0).toLocaleString('en-IN'); }
  function firstName(name) { return String(name || '').replace(/^Sample:\s*/, '').trim().split(/\s+/)[0] || 'there'; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function matches(q, fields) {
    q = q.trim().toLowerCase();
    if (!q) return true;
    return fields.some(function (f) { return String(f || '').toLowerCase().indexOf(q) !== -1; });
  }

  function persist() {
    if (!S.save(db)) toast('Could not save. Browser storage is full or blocked.', true);
    updateCount();
  }

  var toastTimer;
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 3600);
  }

  /* =====================================================================
     Data helpers
     ===================================================================== */
  function findLead(id) { return db.leads.find(function (x) { return x.id === id; }); }
  function findMember(id) { return db.members.find(function (x) { return x.id === id; }); }
  function findPlan(id) { return db.plans.find(function (x) { return x.id === id; }); }
  function planName(id) { var p = findPlan(id); return p ? p.name : 'Membership'; }

  function balance(memberId) {
    var owed = db.charges.reduce(function (a, c) { return c.memberId === memberId ? a + Number(c.amount) : a; }, 0);
    var paid = db.payments.reduce(function (a, p) { return p.memberId === memberId ? a + Number(p.amount) : a; }, 0);
    return owed - paid;
  }
  function lastVisit(memberId) {
    var last = null;
    db.attendance.forEach(function (a) { if (a.memberId === memberId && (!last || a.at > last)) last = a.at; });
    return last;
  }
  function checkedInToday(memberId) {
    var t = today();
    return db.attendance.some(function (a) { return a.memberId === memberId && dateOf(a.at) === t; });
  }
  function memberState(m) {
    if (m.status === 'frozen' || m.status === 'cancelled') return m.status;
    var d = daysBetween(today(), m.expiryDate);
    if (d < 0) return 'expired';
    if (d <= Number(db.settings.renewalDays)) return 'expiring';
    return 'active';
  }
  function expiryText(m) {
    var d = daysBetween(today(), m.expiryDate);
    if (d === 0) return 'ends today';
    if (d > 0) return plural(d, 'day') + ' left';
    return 'ended ' + plural(-d, 'day') + ' ago';
  }
  function statePill(m) {
    var s = MEMBER_STATE[memberState(m)];
    return '<span class="pill ' + s[1] + '">' + s[0] + '</span>';
  }
  function leadPill(status) {
    var label = (LEAD_STATUS.find(function (s) { return s[0] === status; }) || [status, status])[1];
    return '<span class="pill ' + (LEAD_PILL[status] || '') + '">' + esc(label) + '</span>';
  }

  /* =====================================================================
     WhatsApp follow-up engine
     Builds the list of messages that are due, from the rules in Settings.
     ===================================================================== */
  function buildQueue() {
    var s = db.settings, t = today(), now = Date.now(), q = [];

    function recentlySent(key) {
      var at = db.followups[key];
      return at && (now - new Date(at).getTime()) / 864e5 < Number(s.cooldownDays);
    }
    function add(templateKey, key, kind, rec, reason, vars, rank) {
      q.push({
        templateKey: templateKey, key: key, kind: kind, id: rec.id, name: rec.name, phone: rec.phone,
        reason: reason, rank: rank,
        vars: Object.assign({ name: firstName(rec.name), studio: s.studioName }, vars)
      });
    }

    db.leads.forEach(function (l) {
      if (l.status === 'new' && !db.followups['welcome:' + l.id]) {
        add('lead_welcome', 'welcome:' + l.id, 'lead', l, 'New trial booking' + (l.program ? ' · ' + l.program : ''),
          { program: l.program || '', date: l.preferredDate ? fmtDate(l.preferredDate) : '' }, 1);
      }
      if (l.status === 'trial_done') {
        var since = l.trialDoneAt || l.lastContactAt || l.createdAt;
        var hours = (now - new Date(since).getTime()) / 36e5;
        if (hours >= Number(s.trialFollowHours) && !recentlySent('trial:' + l.id)) {
          add('trial_followup', 'trial:' + l.id, 'lead', l, 'Trial done, not joined yet', { program: l.program || '' }, 2);
        }
      }
    });

    db.members.forEach(function (m) {
      if (m.status === 'cancelled') return;
      var state = memberState(m);
      var d = daysBetween(t, m.expiryDate);
      var base = { plan: planName(m.planId), expiry: fmtDate(m.expiryDate) };

      if (state === 'expiring') {
        var k1 = 'renewal:' + m.id + ':' + m.expiryDate;
        if (!recentlySent(k1)) add('renewal', k1, 'member', m, 'Membership ' + expiryText(m), Object.assign({ days: d }, base), 2);
      }
      if (state === 'expired' && d >= -30) {
        var k2 = 'expired:' + m.id + ':' + m.expiryDate;
        if (!recentlySent(k2)) add('expired', k2, 'member', m, 'Membership ' + expiryText(m), base, 3);
      }
      var bal = balance(m.id);
      if (bal > 0 && !recentlySent('due:' + m.id)) {
        add('payment_due', 'due:' + m.id, 'member', m, money(bal) + ' pending', Object.assign({ due: money(bal) }, base), 2);
      }
      if (state === 'active' || state === 'expiring') {
        var lv = lastVisit(m.id);
        var gone = daysBetween(lv ? dateOf(lv) : m.startDate, t);
        if (gone >= Number(s.inactiveDays) && !recentlySent('inactive:' + m.id)) {
          add('inactive', 'inactive:' + m.id, 'member', m,
            lv ? 'Last visit ' + plural(gone, 'day') + ' ago' : 'No check-ins since joining (' + plural(gone, 'day') + ')',
            Object.assign({ days: gone }, base), 4);
        }
      }
    });

    return q.sort(function (a, b) { return a.rank - b.rank || a.name.localeCompare(b.name); });
  }

  function fillTemplate(key, vars) { return W.fill(db.templates[key] || '', vars); }

  // Sends one message and records it. opts: { kind, id, name, phone, templateKey, text, key, vars }
  function sendMessage(opts, quiet) {
    return W.send({ phone: opts.phone, text: opts.text, templateKey: opts.templateKey, vars: opts.vars }, db.settings)
      .then(function (res) {
        logMessage(opts, res.mode, res.mode === 'api' ? 'Sent' : 'Opened in WhatsApp');
        if (opts.key) db.followups[opts.key] = new Date().toISOString();
        if (opts.kind === 'lead') {
          var l = findLead(opts.id);
          if (l) { l.lastContactAt = new Date().toISOString(); if (l.status === 'new') l.status = 'contacted'; }
        }
        persist();
        if (!quiet) toast(res.mode === 'api' ? 'Sent to ' + opts.name + '.' : 'WhatsApp opened for ' + opts.name + '. Tap Send there.');
        return res;
      })
      .catch(function (err) {
        logMessage(opts, db.settings.mode, 'Failed: ' + err.message);
        persist();
        if (!quiet) toast('Not sent. ' + err.message, true);
        throw err;
      });
  }
  function logMessage(opts, mode, status) {
    db.messages.unshift({
      id: S.uid('msg'), at: new Date().toISOString(), kind: opts.kind || '', refId: opts.id || '',
      name: opts.name, phone: opts.phone, templateKey: opts.templateKey || 'custom', text: opts.text, mode: mode, status: status
    });
    if (db.messages.length > 500) db.messages.length = 500;
  }

  function queueItemToMessage(item) {
    return {
      kind: item.kind, id: item.id, name: item.name, phone: item.phone, key: item.key,
      templateKey: item.templateKey, vars: item.vars, text: fillTemplate(item.templateKey, item.vars)
    };
  }

  // API mode only: sends every due follow-up, one after another.
  var sendingAll = false;
  function sendAllDue(quiet) {
    if (db.settings.mode !== 'api' || sendingAll) return Promise.resolve();
    var queue = buildQueue();
    if (!queue.length) { if (!quiet) toast('Nothing due right now.'); return Promise.resolve(); }
    sendingAll = true;
    var sent = 0, failed = 0;
    return queue.reduce(function (p, item) {
      return p.then(function () {
        return sendMessage(queueItemToMessage(item), true).then(function () { sent++; }, function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      sendingAll = false;
      if (!quiet || failed) toast(plural(sent, 'message') + ' sent' + (failed ? ', ' + failed + ' failed. See the message log.' : '.'), failed > 0);
      render();
    });
  }

  var autoTimer = null;
  function setupAutoSend() {
    clearInterval(autoTimer);
    if (db.settings.mode === 'api' && db.settings.autoSend) {
      var mins = Math.max(5, Number(db.settings.autoEveryMin) || 15);
      autoTimer = setInterval(function () { sendAllDue(true); }, mins * 60000);
      setTimeout(function () { sendAllDue(true); }, 4000);
    }
  }

  function updateCount() {
    var n = buildQueue().length;
    document.getElementById('fu-count').textContent = n ? String(n) : '';
  }

  /* =====================================================================
     Shared bits of markup
     ===================================================================== */
  function emptyState(title, text, actionHtml) {
    return '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(text) + (actionHtml ? '<div style="margin-top:14px">' + actionHtml + '</div>' : '') + '</div>';
  }
  function waButton(attrs, label) {
    return '<button class="btn sm wa" type="button" ' + attrs + '>' + WA_ICON + (label || 'WhatsApp') + '</button>';
  }
  function queueRow(item, showPreview) {
    return '<div class="row">' +
      (showPreview ? '' : '<span class="fu-type">' + esc(TEMPLATE_LABEL[item.templateKey]) + '</span>') +
      '<div class="who"><b>' + esc(item.name) + '</b><span>' + esc(item.reason) + ' · ' + esc(item.phone || 'no number') + '</span></div>' +
      '<div class="row-actions">' +
        waButton('data-act="fu-send" data-key="' + esc(item.key) + '"', db.settings.mode === 'api' ? 'Send' : 'Send on WhatsApp') +
        '<button class="btn sm" type="button" data-act="fu-edit" data-key="' + esc(item.key) + '">Edit message</button>' +
        '<button class="btn sm ghost" type="button" data-act="fu-skip" data-key="' + esc(item.key) + '">Skip</button>' +
      '</div>' +
      (showPreview ? '<p class="preview">' + esc(fillTemplate(item.templateKey, item.vars)) + '</p>' : '') +
      '</div>';
  }
  function modeBanner() {
    var s = db.settings;
    if (s.mode === 'api') {
      return '<div class="banner api"><p><b>Automatic sending is on.</b> Messages go straight out through your WhatsApp server' +
        (s.autoSend ? ', and due follow-ups are sent every ' + Math.max(5, Number(s.autoEveryMin) || 15) + ' minutes while this dashboard is open.' : '. Use "Send all due" or send one at a time.') +
        '</p><a class="btn sm" href="#settings">WhatsApp settings</a></div>';
    }
    return '<div class="banner"><p><b>Click-to-send mode.</b> Each Send opens WhatsApp with the message written for you. Check it and tap Send. Automatic sending can be switched on in Settings once your WhatsApp Business API server is set up.</p><a class="btn sm" href="#settings">WhatsApp settings</a></div>';
  }

  /* =====================================================================
     Pages
     ===================================================================== */
  var pages = {};

  /* ---------- Dashboard ---------- */
  pages.dashboard = {
    title: 'Dashboard',
    view: function () {
      var t = today();
      var members = db.members.filter(function (m) { return m.status !== 'cancelled'; });
      var active = members.filter(function (m) { var s = memberState(m); return s === 'active' || s === 'expiring'; }).length;
      var expiring = members.filter(function (m) { return memberState(m) === 'expiring'; }).length;
      var expired = members.filter(function (m) { return memberState(m) === 'expired' && daysBetween(t, m.expiryDate) >= -30; }).length;
      var dues = db.members.reduce(function (a, m) { var b = balance(m.id); return b > 0 ? a + b : a; }, 0);
      var todays = db.attendance.filter(function (a) { return dateOf(a.at) === t; });
      var weekAgo = Date.now() - 7 * 864e5;
      var newLeads = db.leads.filter(function (l) { return new Date(l.createdAt).getTime() >= weekAgo; }).length;
      var queue = buildQueue();

      var isEmpty = !db.members.length && !db.leads.length;
      var html = '<div class="head"><div><h1>Today</h1><p>' + esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })) + '</p></div>' +
        '<div class="actions"><button class="btn" type="button" data-act="lead-add">Add lead</button><button class="btn" type="button" data-act="member-add">Add member</button><a class="btn light" href="#attendance">Check in</a></div></div>';

      if (isEmpty) {
        html += '<div class="panel">' + emptyState('No clients yet', 'Add your first member or lead, or load sample data to try the dashboard. Free trial bookings from the website also land here.',
          '<div class="actions" style="justify-content:center"><button class="btn primary" type="button" data-act="member-add">Add member</button><button class="btn" type="button" data-act="sample">Load sample data</button></div>') + '</div>';
        return html;
      }

      html += '<div class="tiles">' +
        '<a class="tile ok" href="#members" data-filter-mem="active"><span class="label">Active members</span><span class="num">' + active + '</span></a>' +
        '<a class="tile' + (expiring ? ' warn' : '') + '" href="#members" data-filter-mem="expiring"><span class="label">Renewals due</span><span class="num">' + expiring + '</span></a>' +
        '<a class="tile' + (expired ? ' bad' : '') + '" href="#members" data-filter-mem="expired"><span class="label">Expired, last 30 days</span><span class="num">' + expired + '</span></a>' +
        '<a class="tile' + (dues ? ' bad' : '') + '" href="#payments"><span class="label">Pending dues</span><span class="num">' + money(dues) + '</span></a>' +
        '<a class="tile" href="#attendance"><span class="label">Check-ins today</span><span class="num">' + todays.length + '</span></a>' +
        '<a class="tile" href="#leads"><span class="label">New leads, 7 days</span><span class="num">' + newLeads + '</span></a>' +
        '</div>';

      html += '<div class="cols"><div class="panel"><div class="panel-head"><h2>WhatsApp follow-ups due</h2><a class="btn sm" href="#followups">See all ' + queue.length + '</a></div><div class="panel-body rows">' +
        (queue.length ? queue.slice(0, 6).map(function (i) { return queueRow(i, false); }).join('') : emptyState('All caught up', 'No follow-ups are due right now.')) +
        '</div></div>';

      var pipeline = LEAD_STATUS.map(function (s) {
        var n = db.leads.filter(function (l) { return l.status === s[0]; }).length;
        return '<button class="chip" type="button" data-act="lead-filter" data-status="' + s[0] + '">' + s[1] + ' <b>' + n + '</b></button>';
      }).join('');

      html += '<div><div class="panel"><div class="panel-head"><h2>Checked in today</h2><a class="btn sm" href="#attendance">Check someone in</a></div><div class="panel-body rows">' +
        (todays.length ? todays.slice().sort(function (a, b) { return b.at.localeCompare(a.at); }).slice(0, 8).map(function (a) {
          var m = findMember(a.memberId);
          return '<div class="row"><div class="who"><b>' + esc(m ? m.name : 'Removed member') + '</b><span>' + esc(m ? planName(m.planId) : '') + '</span></div><span class="label">' + fmtTime(a.at) + '</span></div>';
        }).join('') : emptyState('No check-ins yet today', '')) +
        '</div></div>' +
        '<div class="panel"><div class="panel-head"><h2>Leads pipeline</h2><a class="btn sm" href="#leads">Open leads</a></div><div class="panel-body"><div class="chips" style="margin:10px 0 4px">' + pipeline + '</div></div></div></div></div>';
      return html;
    }
  };

  /* ---------- WhatsApp follow-ups ---------- */
  pages.followups = {
    title: 'WhatsApp follow-ups',
    view: function () {
      var queue = buildQueue();
      var groups = {};
      queue.forEach(function (i) { (groups[i.templateKey] = groups[i.templateKey] || []).push(i); });
      var html = '<div class="head"><div><h1>WhatsApp follow-ups</h1><p>' + (queue.length ? plural(queue.length, 'message') + ' due' : 'Nothing due') + '</p></div><div class="actions">' +
        (db.settings.mode === 'api' ? '<button class="btn primary" type="button" data-act="fu-send-all"' + (queue.length ? '' : ' disabled') + '>Send all due</button>' : '') +
        '<button class="btn" type="button" data-act="compose-free">New message</button></div></div>' + modeBanner();

      if (!queue.length) {
        html += '<div class="panel">' + emptyState('All caught up', 'New trial bookings, renewals, dues and members who stop coming will show up here automatically.') + '</div>';
      } else {
        Object.keys(TEMPLATE_LABEL).forEach(function (k) {
          if (!groups[k]) return;
          html += '<div class="panel"><div class="panel-head"><h2>' + esc(TEMPLATE_LABEL[k]) + ' <span class="label" style="margin-left:8px">' + groups[k].length + '</span></h2><span class="hint">' + esc(TEMPLATE_HELP[k]) + '</span></div><div class="panel-body rows">' +
            groups[k].map(function (i) { return queueRow(i, true); }).join('') + '</div></div>';
        });
      }

      var log = db.messages.slice(0, 40);
      html += '<div class="panel"><div class="panel-head"><h2>Message log</h2><span class="hint">Last ' + log.length + ' messages</span></div>' +
        (log.length ? '<div class="table-wrap" style="border:0"><table><thead><tr><th>When</th><th>To</th><th>Type</th><th>Message</th><th>Status</th></tr></thead><tbody>' +
          log.map(function (m) {
            var bad = /^Failed/.test(m.status);
            return '<tr><td>' + esc(fmtWhen(m.at)) + '</td><td>' + esc(m.name) + '<span class="sub">' + esc(m.phone) + '</span></td><td>' + esc(TEMPLATE_LABEL[m.templateKey] || 'Custom') + '</td>' +
              '<td style="max-width:360px"><span class="sub" style="color:#cfcfcf">' + esc(m.text.length > 140 ? m.text.slice(0, 140) + '…' : m.text) + '</span></td>' +
              '<td><span class="pill ' + (bad ? 'bad' : (m.mode === 'api' ? 'ok' : '')) + '">' + esc(m.status) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' : emptyState('No messages yet', 'Messages you send from the dashboard are recorded here.')) + '</div>';
      return html;
    }
  };

  /* ---------- Leads ---------- */
  pages.leads = {
    title: 'Leads & trials',
    view: function () {
      var chips = '<button class="chip" type="button" data-act="lead-filter" data-status="all" aria-pressed="' + (ui.leadStatus === 'all') + '">All <b>' + db.leads.length + '</b></button>' +
        LEAD_STATUS.map(function (s) {
          var n = db.leads.filter(function (l) { return l.status === s[0]; }).length;
          return '<button class="chip" type="button" data-act="lead-filter" data-status="' + s[0] + '" aria-pressed="' + (ui.leadStatus === s[0]) + '">' + s[1] + ' <b>' + n + '</b></button>';
        }).join('');
      return '<div class="head"><div><h1>Leads &amp; trials</h1><p>Free trial bookings from the website land here as New.</p></div><div class="actions"><button class="btn primary" type="button" data-act="lead-add">Add lead</button></div></div>' +
        '<div class="chips">' + chips + '</div>' +
        '<div class="toolbar"><input class="input search" type="search" id="lead-q" data-ui="leadQ" placeholder="Search name, phone or program" aria-label="Search leads" value="' + esc(ui.leadQ) + '"></div>' +
        '<div id="list">' + this.list() + '</div>';
    },
    list: function () {
      var rows = db.leads.filter(function (l) {
        return (ui.leadStatus === 'all' || l.status === ui.leadStatus) && matches(ui.leadQ, [l.name, l.phone, l.program, l.source]);
      });
      if (!db.leads.length) return '<div class="panel">' + emptyState('No leads yet', 'Trial bookings from the website appear here. You can also add walk-ins and calls yourself.', '<button class="btn primary" type="button" data-act="lead-add">Add lead</button>') + '</div>';
      if (!rows.length) return '<div class="panel">' + emptyState('No matches', 'Try a different search or status.') + '</div>';
      return '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Program</th><th>Preferred day</th><th>Source</th><th>Status</th><th>Added</th><th class="num">Actions</th></tr></thead><tbody>' +
        rows.map(function (l) {
          var opts = LEAD_STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === l.status ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');
          return '<tr><td><b>' + esc(l.name) + '</b><span class="sub">' + esc(l.phone) + '</span></td>' +
            '<td>' + esc(l.program || '–') + '</td><td>' + esc(l.preferredDate ? fmtDate(l.preferredDate) : '–') + '</td><td>' + esc(l.source || '–') + '</td>' +
            '<td><select class="cell-select" data-act="lead-status" data-id="' + l.id + '" aria-label="Status for ' + esc(l.name) + '">' + opts + '</select></td>' +
            '<td>' + esc(fmtDate(l.createdAt)) + (l.lastContactAt ? '<span class="sub">Contacted ' + esc(fmtDate(l.lastContactAt)) + '</span>' : '') + '</td>' +
            '<td><div class="acts">' + waButton('data-act="compose" data-kind="lead" data-id="' + l.id + '"') +
              (l.status !== 'joined' ? '<button class="btn sm" type="button" data-act="lead-convert" data-id="' + l.id + '">Make member</button>' : '') +
              '<button class="btn sm ghost" type="button" data-act="lead-edit" data-id="' + l.id + '">Edit</button></div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  };

  /* ---------- Members ---------- */
  var MEMBER_FILTERS = [['all', 'All'], ['active', 'Active'], ['expiring', 'Renewal due'], ['expired', 'Expired'], ['dues', 'Has dues'], ['frozen', 'Frozen'], ['cancelled', 'Cancelled']];
  pages.members = {
    title: 'Members',
    view: function () {
      var chips = MEMBER_FILTERS.map(function (f) {
        var n = db.members.filter(function (m) { return memberMatchesFilter(m, f[0]); }).length;
        return '<button class="chip" type="button" data-act="mem-filter" data-f="' + f[0] + '" aria-pressed="' + (ui.memFilter === f[0]) + '">' + f[1] + ' <b>' + n + '</b></button>';
      }).join('');
      return '<div class="head"><div><h1>Members</h1><p>Plans, renewals, dues and visits in one place.</p></div><div class="actions"><button class="btn primary" type="button" data-act="member-add">Add member</button></div></div>' +
        '<div class="chips">' + chips + '</div>' +
        '<div class="toolbar"><input class="input search" type="search" id="mem-q" data-ui="memQ" placeholder="Search name or phone" aria-label="Search members" value="' + esc(ui.memQ) + '"></div>' +
        '<div id="list">' + this.list() + '</div>';
    },
    list: function () {
      if (!db.members.length) return '<div class="panel">' + emptyState('No members yet', 'Add a member, or convert a lead from Leads & trials.', '<button class="btn primary" type="button" data-act="member-add">Add member</button>') + '</div>';
      var rows = db.members.filter(function (m) { return memberMatchesFilter(m, ui.memFilter) && matches(ui.memQ, [m.name, m.phone, m.email]); })
        .sort(function (a, b) { return a.expiryDate.localeCompare(b.expiryDate); });
      if (!rows.length) return '<div class="panel">' + emptyState('No matches', 'Try a different search or filter.') + '</div>';
      return '<div class="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Expiry</th><th class="num">Balance</th><th>Last visit</th><th class="num">Actions</th></tr></thead><tbody>' +
        rows.map(function (m) {
          var bal = balance(m.id), lv = lastVisit(m.id), inToday = checkedInToday(m.id);
          return '<tr><td><b>' + esc(m.name) + '</b><span class="sub">' + esc(m.phone) + '</span></td>' +
            '<td>' + esc(planName(m.planId)) + '</td><td>' + statePill(m) + '</td>' +
            '<td>' + esc(fmtDate(m.expiryDate)) + '<span class="sub">' + esc(expiryText(m)) + '</span></td>' +
            '<td class="num">' + (bal > 0 ? '<span style="color:var(--bad)">' + money(bal) + ' due</span>' : bal < 0 ? money(-bal) + ' credit' : '–') + '</td>' +
            '<td>' + (lv ? esc(fmtDate(lv)) : '<span class="sub">Never</span>') + '</td>' +
            '<td><div class="acts">' +
              '<button class="btn sm" type="button" data-act="checkin" data-id="' + m.id + '"' + (inToday || m.status === 'cancelled' ? ' disabled' : '') + '>' + (inToday ? 'In today' : 'Check in') + '</button>' +
              '<button class="btn sm" type="button" data-act="renew" data-id="' + m.id + '">Renew</button>' +
              '<button class="btn sm" type="button" data-act="pay" data-id="' + m.id + '">Payment</button>' +
              waButton('data-act="compose" data-kind="member" data-id="' + m.id + '"') +
              '<button class="btn sm ghost" type="button" data-act="member-edit" data-id="' + m.id + '">Edit</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  };
  function memberMatchesFilter(m, f) {
    if (f === 'all') return true;
    if (f === 'dues') return balance(m.id) > 0;
    var s = memberState(m);
    if (f === 'active') return s === 'active' || s === 'expiring';
    return s === f;
  }

  /* ---------- Payments ---------- */
  pages.payments = {
    title: 'Payments',
    view: function () {
      var t = today(), monthStart = t.slice(0, 8) + '01';
      var monthPaid = db.payments.filter(function (p) { return p.date >= monthStart; });
      var collected = monthPaid.reduce(function (a, p) { return a + Number(p.amount); }, 0);
      var due = db.members.map(function (m) { return { m: m, bal: balance(m.id) }; }).filter(function (x) { return x.bal > 0; })
        .sort(function (a, b) { return b.bal - a.bal; });
      var dueTotal = due.reduce(function (a, x) { return a + x.bal; }, 0);

      var html = '<div class="head"><div><h1>Payments</h1><p>Fees charged on joining and renewal, and what has been paid.</p></div><div class="actions"><button class="btn" type="button" data-act="charge">Add charge</button><button class="btn primary" type="button" data-act="pay">Record payment</button></div></div>' +
        '<div class="tiles"><div class="tile ok"><span class="label">Collected this month</span><span class="num">' + money(collected) + '</span></div>' +
        '<div class="tile' + (dueTotal ? ' bad' : '') + '"><span class="label">Pending dues</span><span class="num">' + money(dueTotal) + '</span></div>' +
        '<div class="tile"><span class="label">Payments this month</span><span class="num">' + monthPaid.length + '</span></div></div>';

      html += '<div class="panel"><div class="panel-head"><h2>Dues</h2><span class="hint">' + plural(due.length, 'member') + ' owe money</span></div><div class="panel-body rows">' +
        (due.length ? due.map(function (x) {
          return '<div class="row"><div class="who"><b>' + esc(x.m.name) + '</b><span>' + esc(planName(x.m.planId)) + ' · ' + esc(x.m.phone) + '</span></div>' +
            '<b style="color:var(--bad);font-variant-numeric:tabular-nums">' + money(x.bal) + '</b>' +
            '<div class="row-actions"><button class="btn sm primary" type="button" data-act="pay" data-id="' + x.m.id + '">Record payment</button>' +
            waButton('data-act="compose" data-kind="member" data-id="' + x.m.id + '" data-template="payment_due"', 'Remind') + '</div></div>';
        }).join('') : emptyState('No dues', 'Everyone is paid up.')) + '</div></div>';

      html += '<div class="panel"><div class="panel-head"><h2>Transactions</h2><select class="select" data-ui="payRange" aria-label="Date range">' +
        [['month', 'This month'], ['30', 'Last 30 days'], ['all', 'All time']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.payRange === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div><div id="list">' + this.list() + '</div></div>';
      return html;
    },
    list: function () {
      var t = today();
      var from = ui.payRange === 'month' ? t.slice(0, 8) + '01' : ui.payRange === '30' ? addDays(t, -30) : '0000';
      var items = db.payments.map(function (p) { return { type: 'Payment', date: p.date, memberId: p.memberId, amount: Number(p.amount), desc: p.method + (p.note ? ' · ' + p.note : ''), id: p.id, store: 'payments' }; })
        .concat(db.charges.map(function (c) { return { type: 'Charge', date: c.date, memberId: c.memberId, amount: Number(c.amount), desc: c.desc, id: c.id, store: 'charges' }; }))
        .filter(function (x) { return x.date >= from; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
      if (!items.length) return emptyState('Nothing in this period', '');
      return '<div class="table-wrap" style="border:0"><table><thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Details</th><th class="num">Amount</th><th class="num"></th></tr></thead><tbody>' +
        items.map(function (x) {
          var m = findMember(x.memberId);
          return '<tr><td>' + esc(fmtDate(x.date)) + '</td><td>' + esc(m ? m.name : 'Removed member') + '</td>' +
            '<td><span class="pill ' + (x.type === 'Payment' ? 'ok' : '') + '">' + x.type + '</span></td><td>' + esc(x.desc) + '</td>' +
            '<td class="num">' + (x.type === 'Payment' ? '' : '+') + money(x.amount) + '</td>' +
            '<td class="num"><button class="btn sm ghost" type="button" data-act="tx-delete" data-store="' + x.store + '" data-id="' + x.id + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  };

  /* ---------- Attendance ---------- */
  pages.attendance = {
    title: 'Attendance',
    view: function () {
      var t = today();
      var todays = db.attendance.filter(function (a) { return dateOf(a.at) === t; }).sort(function (a, b) { return b.at.localeCompare(a.at); });
      var weekFrom = addDays(t, -6);
      var week = db.attendance.filter(function (a) { return dateOf(a.at) >= weekFrom; }).length;
      var gone = db.members.filter(function (m) { var s = memberState(m); return s === 'active' || s === 'expiring'; })
        .map(function (m) { var lv = lastVisit(m.id); return { m: m, days: daysBetween(lv ? dateOf(lv) : m.startDate, t), never: !lv }; })
        .filter(function (x) { return x.days >= Number(db.settings.inactiveDays); })
        .sort(function (a, b) { return b.days - a.days; });

      return '<div class="head"><div><h1>Attendance</h1><p>' + plural(todays.length, 'check-in') + ' today · ' + plural(week, 'check-in') + ' in the last 7 days</p></div></div>' +
        '<div class="panel" style="margin-bottom:16px"><div class="panel-body" style="padding-top:16px">' +
        '<label class="label" for="check-q">Check a member in</label>' +
        '<input class="input big-search" type="search" id="check-q" data-ui="checkQ" placeholder="Type a name or phone number" autocomplete="off" value="' + esc(ui.checkQ) + '" style="margin-top:8px">' +
        '<div id="list">' + this.list() + '</div></div></div>' +
        '<div class="cols"><div class="panel"><div class="panel-head"><h2>Today</h2></div><div class="panel-body rows">' +
        (todays.length ? todays.map(function (a) {
          var m = findMember(a.memberId);
          return '<div class="row"><div class="who"><b>' + esc(m ? m.name : 'Removed member') + '</b><span>' + (m ? statePill(m) : '') + '</span></div><span class="label">' + fmtTime(a.at) + '</span>' +
            '<button class="btn sm ghost" type="button" data-act="checkin-undo" data-id="' + a.id + '">Undo</button></div>';
        }).join('') : emptyState('No check-ins yet today', '')) + '</div></div>' +
        '<div class="panel"><div class="panel-head"><h2>Not seen lately</h2><span class="hint">' + db.settings.inactiveDays + '+ days without a visit</span></div><div class="panel-body rows">' +
        (gone.length ? gone.map(function (x) {
          return '<div class="row"><div class="who"><b>' + esc(x.m.name) + '</b><span>' + (x.never ? 'No check-ins since joining' : 'Last visit ' + plural(x.days, 'day') + ' ago') + '</span></div>' +
            waButton('data-act="compose" data-kind="member" data-id="' + x.m.id + '" data-template="inactive"', 'Nudge') + '</div>';
        }).join('') : emptyState('Everyone is showing up', '')) + '</div></div></div>';
    },
    list: function () {
      var q = ui.checkQ.trim();
      var pool = db.members.filter(function (m) { return m.status !== 'cancelled'; });
      var found = q ? pool.filter(function (m) { return matches(q, [m.name, m.phone]); }) : [];
      if (!q) return '<p class="hint" style="margin-top:10px">Start typing to find a member.</p>';
      if (!found.length) return '<p class="hint" style="margin-top:10px">No member matches "' + esc(q) + '".</p>';
      return '<div class="check-grid">' + found.slice(0, 12).map(function (m) {
        var inToday = checkedInToday(m.id), s = memberState(m);
        return '<div class="check-card"><div><b>' + esc(m.name) + '</b><span>' + (s === 'expired' ? 'Membership expired' : esc(planName(m.planId)) + ' · ' + esc(expiryText(m))) + '</span></div>' +
          '<button class="btn sm ' + (inToday ? '' : 'light') + '" type="button" data-act="checkin" data-id="' + m.id + '"' + (inToday ? ' disabled' : '') + '>' + (inToday ? 'In today' : 'Check in') + '</button></div>';
      }).join('') + '</div>';
    }
  };

  /* ---------- Settings ---------- */
  pages.settings = {
    title: 'Settings',
    view: function () {
      var s = db.settings;
      var plans = db.plans.map(function (p) { return planRow(p); }).join('');
      var templates = Object.keys(TEMPLATE_LABEL).map(function (k) {
        return '<div class="field"><label for="tpl-' + k + '">' + esc(TEMPLATE_LABEL[k]) + '</label><p class="hint">' + esc(TEMPLATE_HELP[k]) + '</p>' +
          '<textarea class="textarea" id="tpl-' + k + '" name="tpl-' + k + '">' + esc(db.templates[k]) + '</textarea></div>';
      }).join('');

      return '<div class="head"><div><h1>Settings</h1><p>Studio details, WhatsApp, follow-up rules, plans and message wording.</p></div></div>' +
        '<form class="panel" id="settings-form" data-form="settings">' +

        '<div class="settings-sec"><h2>Studio</h2><div class="grid2">' +
          field('Studio name', '<input class="input" id="s-name" name="studioName" value="' + esc(s.studioName) + '" required>') +
          field('Default country code', '<input class="input" id="s-cc" name="countryCode" inputmode="numeric" value="' + esc(s.countryCode) + '">', 'Added to 10-digit numbers. 91 for India.') +
          field('Currency symbol', '<input class="input" id="s-cur" name="currency" value="' + esc(s.currency) + '">') +
        '</div></div>' +

        '<div class="settings-sec"><h2>WhatsApp</h2><div class="radio-row">' +
          '<label class="radio-card"><input type="radio" name="mode" value="click"' + (s.mode !== 'api' ? ' checked' : '') + '><span><b>Click-to-send</b><span>Opens WhatsApp with the message written. Staff tap Send. Free, works now.</span></span></label>' +
          '<label class="radio-card"><input type="radio" name="mode" value="api"' + (s.mode === 'api' ? ' checked' : '') + '><span><b>Automatic (Business API)</b><span>Sends through your WhatsApp Cloud API server in the server folder. Needs Meta setup first, see the README.</span></span></label>' +
        '</div><div class="grid2">' +
          field('Server address', '<input class="input" id="s-endpoint" name="apiEndpoint" value="' + esc(s.apiEndpoint) + '">', 'Only used in automatic mode.') +
          field('Send due follow-ups every (minutes)', '<input class="input" id="s-every" name="autoEveryMin" type="number" min="5" value="' + esc(s.autoEveryMin) + '">') +
        '</div>' +
        '<label class="check"><input type="checkbox" name="autoSend"' + (s.autoSend ? ' checked' : '') + '><span>In automatic mode, send due follow-ups on a timer while this dashboard is open</span></label>' +
        '<div class="actions"><button class="btn sm" type="button" data-act="test-server">Test server connection</button></div></div>' +

        '<div class="settings-sec"><h2>Follow-up rules</h2><div class="grid2">' +
          field('Renewal reminder, days before expiry', '<input class="input" id="s-ren" name="renewalDays" type="number" min="0" value="' + esc(s.renewalDays) + '">') +
          field('Flag members not seen for, days', '<input class="input" id="s-inact" name="inactiveDays" type="number" min="1" value="' + esc(s.inactiveDays) + '">') +
          field('Trial follow-up after, hours', '<input class="input" id="s-trial" name="trialFollowHours" type="number" min="0" value="' + esc(s.trialFollowHours) + '">') +
          field('Wait before repeating a reminder, days', '<input class="input" id="s-cool" name="cooldownDays" type="number" min="1" value="' + esc(s.cooldownDays) + '">') +
        '</div></div>' +

        '<div class="settings-sec"><h2>Membership plans</h2><p class="hint">Fees are charged to the member when they join or renew.</p>' +
          '<div class="plan-row label" aria-hidden="true"><span>Plan name</span><span>Months</span><span>Fee</span><span></span></div>' +
          '<div id="plan-rows" style="display:flex;flex-direction:column;gap:8px">' + plans + '</div>' +
          '<div><button class="btn sm" type="button" data-act="plan-add">Add plan</button></div></div>' +

        '<div class="settings-sec"><h2>Message wording</h2><p class="hint">Placeholders are filled in for each person:</p>' +
          '<div class="tokens"><code>{name}</code><code>{studio}</code><code>{plan}</code><code>{expiry}</code><code>{days}</code><code>{due}</code><code>{program}</code><code>{date}</code></div>' +
          templates + '</div>' +

        '<div class="sticky-save"><button class="btn primary" type="submit">Save settings</button></div></form>' +

        '<div class="panel"><div class="settings-sec"><h2>Your data</h2>' +
          '<p class="hint">Everything is stored in this browser on this computer. Export a backup regularly, and before clearing browser data.</p>' +
          '<div class="actions"><button class="btn" type="button" data-act="export">Export backup</button><button class="btn" type="button" data-act="import">Import backup</button>' +
          '<button class="btn" type="button" data-act="sample">Load sample data</button><button class="btn danger" type="button" data-act="clear">Delete all data</button></div></div></div>';
    }
  };
  function field(label, control, hint) {
    var id = (control.match(/id="([^"]+)"/) || [])[1];
    return '<div class="field"><label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' + control + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + '</div>';
  }
  function planRow(p) {
    return '<div class="plan-row" data-plan="' + esc(p.id) + '">' +
      '<input class="input" name="plan-name" aria-label="Plan name" value="' + esc(p.name) + '" required>' +
      '<input class="input" name="plan-months" aria-label="Months" type="number" min="1" value="' + esc(p.months) + '">' +
      '<input class="input" name="plan-fee" aria-label="Fee" type="number" min="0" step="1" value="' + esc(p.fee) + '">' +
      '<button class="icon-btn" type="button" data-act="plan-remove" aria-label="Remove plan ' + esc(p.name) + '">×</button></div>';
  }

  /* =====================================================================
     Rendering and routing
     ===================================================================== */
  function render() {
    var page = pages[currentPage] || pages.dashboard;
    main.innerHTML = page.view();
    document.title = page.title + ' · JAX Studio Desk';
    document.querySelectorAll('#nav a').forEach(function (a) {
      if (a.getAttribute('data-page') === currentPage) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    updateCount();
  }
  function renderList() {
    var page = pages[currentPage];
    var box = document.getElementById('list');
    if (page && page.list && box) box.innerHTML = page.list();
  }
  function route() {
    var name = (location.hash || '#dashboard').slice(1);
    currentPage = pages[name] ? name : 'dashboard';
    render();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* =====================================================================
     Modals
     ===================================================================== */
  function openModal(title, bodyHtml, footHtml, formName) {
    modalBody.innerHTML = '<form class="form" data-form="' + (formName || '') + '" novalidate>' +
      '<div class="modal-head"><h2 id="modal-title">' + esc(title) + '</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">×</button></div>' +
      '<div class="modal-main form">' + bodyHtml + '</div>' +
      '<div class="modal-foot">' + footHtml + '</div></form>';
    if (!modal.open) modal.showModal();
    var first = modalBody.querySelector('.modal-main input:not([type=hidden]), .modal-main select, .modal-main textarea');
    if (first) first.focus();
  }
  function closeModal() { if (modal.open) modal.close(); }
  function cancelBtn() { return '<button class="btn ghost" type="button" data-act="close">Cancel</button>'; }
  function planOptions(selected) {
    return db.plans.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + ' · ' + plural(Number(p.months), 'month') + ' · ' + money(p.fee) + '</option>';
    }).join('');
  }
  function methodOptions(sel) { return METHODS.map(function (m) { return '<option' + (m === sel ? ' selected' : '') + '>' + m + '</option>'; }).join(''); }
  function memberOptions(sel) {
    return db.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
      var b = balance(m.id);
      return '<option value="' + m.id + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + (b > 0 ? ' · ' + money(b) + ' due' : '') + '</option>';
    }).join('');
  }
  function val(form, name) { var el = form.elements[name]; return el ? String(el.value).trim() : ''; }
  function invalid(form, name, msg) {
    var el = form.elements[name];
    var err = form.querySelector('.form-error');
    if (err) { err.textContent = msg; err.hidden = false; }
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    return false;
  }
  var ERR = '<p class="form-error hint" role="alert" style="color:var(--bad)" hidden></p>';
  function phoneOk(p) { return W.normalize(p, db.settings.countryCode) !== ''; }

  /* ---------- lead ---------- */
  function leadModal(l) {
    l = l || {};
    var statusOpts = LEAD_STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === (l.status || 'new') ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');
    openModal(l.id ? 'Edit lead' : 'Add lead',
      '<input type="hidden" name="id" value="' + esc(l.id || '') + '"><div class="grid2">' +
      field('Name', '<input class="input" id="f-name" name="name" value="' + esc(l.name || '') + '" required>') +
      field('WhatsApp number', '<input class="input" id="f-phone" name="phone" type="tel" value="' + esc(l.phone || '') + '" required>') +
      field('Program', '<input class="input" id="f-program" name="program" list="programs" value="' + esc(l.program || '') + '">') +
      field('Preferred day', '<input class="input" id="f-date" name="preferredDate" type="date" value="' + esc(l.preferredDate || '') + '">') +
      field('Source', '<select class="input" id="f-source" name="source">' + ['Walk-in', 'Phone call', 'Instagram', 'Referral', 'Website', 'Other'].map(function (o) { return '<option' + (o === (l.source || 'Walk-in') ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
      field('Status', '<select class="input" id="f-status" name="status">' + statusOpts + '</select>') +
      '</div>' + field('Notes', '<textarea class="textarea" id="f-notes" name="notes" style="min-height:70px">' + esc(l.notes || '') + '</textarea>') +
      '<datalist id="programs"><option>Strength</option><option>HIIT</option><option>Personal training</option><option>Mobility</option></datalist>' + ERR,
      (l.id ? '<button class="btn danger left" type="button" data-act="lead-delete" data-id="' + l.id + '">Delete</button>' : '') + cancelBtn() + '<button class="btn primary" type="submit">Save lead</button>',
      'lead');
  }

  /* ---------- member (add, from lead too) ---------- */
  function memberAddModal(prefill) {
    prefill = prefill || {};
    var firstPlan = db.plans[0] ? db.plans[0].id : '';
    openModal(prefill.leadId ? 'Make ' + firstName(prefill.name) + ' a member' : 'Add member',
      '<input type="hidden" name="leadId" value="' + esc(prefill.leadId || '') + '"><div class="grid2">' +
      field('Name', '<input class="input" id="f-name" name="name" value="' + esc(prefill.name || '') + '" required>') +
      field('WhatsApp number', '<input class="input" id="f-phone" name="phone" type="tel" value="' + esc(prefill.phone || '') + '" required>') +
      field('Email (optional)', '<input class="input" id="f-email" name="email" type="email" value="' + esc(prefill.email || '') + '">') +
      field('Plan', '<select class="input" id="f-plan" name="planId" data-act="plan-pick">' + planOptions(firstPlan) + '</select>') +
      field('Start date', '<input class="input" id="f-start" name="startDate" type="date" value="' + today() + '" required>') +
      field('Fee for this plan', '<input class="input" id="f-fee" name="fee" type="number" min="0" value="' + esc(findPlan(firstPlan) ? findPlan(firstPlan).fee : 0) + '">') +
      field('Paid now', '<input class="input" id="f-paid" name="paid" type="number" min="0" value="0">') +
      field('Payment method', '<select class="input" id="f-method" name="method">' + methodOptions('UPI') + '</select>') +
      '</div>' + ERR,
      cancelBtn() + '<button class="btn primary" type="submit">Add member</button>', 'member-add');
  }

  function memberEditModal(m) {
    openModal('Edit ' + m.name,
      '<input type="hidden" name="id" value="' + m.id + '"><div class="grid2">' +
      field('Name', '<input class="input" id="f-name" name="name" value="' + esc(m.name) + '" required>') +
      field('WhatsApp number', '<input class="input" id="f-phone" name="phone" type="tel" value="' + esc(m.phone) + '" required>') +
      field('Email', '<input class="input" id="f-email" name="email" type="email" value="' + esc(m.email || '') + '">') +
      field('Plan', '<select class="input" id="f-plan" name="planId">' + planOptions(m.planId) + '</select>') +
      field('Expiry date', '<input class="input" id="f-exp" name="expiryDate" type="date" value="' + esc(m.expiryDate) + '" required>', 'Use Renew to extend with a fee.') +
      field('Status', '<select class="input" id="f-status" name="status">' + [['active', 'Active'], ['frozen', 'Frozen (paused)'], ['cancelled', 'Cancelled']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === m.status ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>') +
      '</div>' + field('Notes', '<textarea class="textarea" id="f-notes" name="notes" style="min-height:70px">' + esc(m.notes || '') + '</textarea>') + ERR,
      '<button class="btn danger left" type="button" data-act="member-delete" data-id="' + m.id + '">Delete</button>' + cancelBtn() + '<button class="btn primary" type="submit">Save</button>',
      'member-edit');
  }

  function renewModal(m) {
    var base = daysBetween(today(), m.expiryDate) >= 0 ? m.expiryDate : today();
    var p = findPlan(m.planId) || db.plans[0];
    openModal('Renew ' + m.name,
      '<input type="hidden" name="id" value="' + m.id + '">' +
      '<div class="summary">Current expiry ' + esc(fmtDate(m.expiryDate)) + ' (' + esc(expiryText(m)) + '). The new period starts ' + (base === m.expiryDate ? 'when the current one ends.' : 'today, since the membership has ended.') + '</div>' +
      '<input type="hidden" name="base" value="' + base + '"><div class="grid2">' +
      field('Plan', '<select class="input" id="f-plan" name="planId" data-act="plan-pick">' + planOptions(p ? p.id : '') + '</select>') +
      field('Fee', '<input class="input" id="f-fee" name="fee" type="number" min="0" value="' + esc(p ? p.fee : 0) + '">') +
      field('Paid now', '<input class="input" id="f-paid" name="paid" type="number" min="0" value="' + esc(p ? p.fee : 0) + '">') +
      field('Payment method', '<select class="input" id="f-method" name="method">' + methodOptions('UPI') + '</select>') +
      '</div><p class="hint" id="renew-preview"></p>' + ERR,
      cancelBtn() + '<button class="btn primary" type="submit">Renew</button>', 'renew');
    updateRenewPreview();
  }
  function updateRenewPreview() {
    var form = modalBody.querySelector('form[data-form="renew"]');
    if (!form) return;
    var p = findPlan(val(form, 'planId'));
    var el = document.getElementById('renew-preview');
    if (p && el) el.textContent = 'New expiry: ' + fmtDate(addMonths(val(form, 'base'), p.months));
  }

  function payModal(memberId) {
    if (!db.members.length) { toast('Add a member first.', true); return; }
    var sel = memberId || '';
    var bal = sel ? balance(sel) : 0;
    openModal('Record payment',
      '<div class="grid2">' +
      field('Member', '<select class="input" id="f-mem" name="memberId" required><option value="">Choose a member</option>' + memberOptions(sel) + '</select>') +
      field('Amount', '<input class="input" id="f-amt" name="amount" type="number" min="1" value="' + (bal > 0 ? bal : '') + '" required>') +
      field('Date', '<input class="input" id="f-date" name="date" type="date" value="' + today() + '" required>') +
      field('Method', '<select class="input" id="f-method" name="method">' + methodOptions('UPI') + '</select>') +
      '</div>' + field('Note (optional)', '<input class="input" id="f-note" name="note" placeholder="For example: UPI ref 4821">') + ERR,
      cancelBtn() + '<button class="btn primary" type="submit">Save payment</button>', 'pay');
  }

  function chargeModal(memberId) {
    if (!db.members.length) { toast('Add a member first.', true); return; }
    openModal('Add charge',
      '<div class="grid2">' +
      field('Member', '<select class="input" id="f-mem" name="memberId" required><option value="">Choose a member</option>' + memberOptions(memberId || '') + '</select>') +
      field('Amount', '<input class="input" id="f-amt" name="amount" type="number" min="1" required>') +
      field('Date', '<input class="input" id="f-date" name="date" type="date" value="' + today() + '" required>') +
      '</div>' + field('What is it for', '<input class="input" id="f-desc" name="desc" placeholder="For example: Locker, diet plan, supplements" required>') + ERR,
      cancelBtn() + '<button class="btn primary" type="submit">Add charge</button>', 'charge');
  }

  /* ---------- WhatsApp compose ---------- */
  var composeCtx = null;
  function composeModal(ctx) {
    // ctx: { kind, id, name, phone, templateKey, key, vars }
    composeCtx = ctx;
    var opts = '<option value="custom">Blank message</option>' + Object.keys(TEMPLATE_LABEL).map(function (k) {
      return '<option value="' + k + '"' + (k === ctx.templateKey ? ' selected' : '') + '>' + esc(TEMPLATE_LABEL[k]) + '</option>';
    }).join('');
    var text = ctx.templateKey && ctx.templateKey !== 'custom' ? fillTemplate(ctx.templateKey, ctx.vars) : '';
    var apiNote = db.settings.mode === 'api'
      ? '<p class="hint">Automatic mode: this goes out through your WhatsApp server. Outside a 24-hour chat window, WhatsApp only delivers messages that use a template Meta has approved.</p>'
      : '<p class="hint">WhatsApp opens with this message ready. Check it and tap Send.</p>';
    openModal('WhatsApp ' + firstName(ctx.name),
      '<div class="summary">To <b>' + esc(ctx.name) + '</b> · ' + esc(ctx.phone || 'no number saved') + '</div>' +
      field('Message type', '<select class="input" id="f-tpl" name="templateKey" data-act="tpl-pick">' + opts + '</select>') +
      field('Message', '<textarea class="textarea" id="f-text" name="text" style="min-height:150px" required>' + esc(text) + '</textarea>') + apiNote + ERR,
      cancelBtn() + '<button class="btn primary" type="submit">' + WA_ICON + (db.settings.mode === 'api' ? 'Send now' : 'Open in WhatsApp') + '</button>', 'compose');
  }
  function contextFor(kind, id, templateKey) {
    var rec = kind === 'lead' ? findLead(id) : findMember(id);
    if (!rec) return null;
    var vars = { name: firstName(rec.name), studio: db.settings.studioName };
    if (kind === 'lead') {
      vars.program = rec.program || '';
      vars.date = rec.preferredDate ? fmtDate(rec.preferredDate) : '';
      templateKey = templateKey || (rec.status === 'trial_done' ? 'trial_followup' : 'lead_welcome');
    } else {
      var state = memberState(rec), bal = balance(rec.id), lv = lastVisit(rec.id);
      vars.plan = planName(rec.planId);
      vars.expiry = fmtDate(rec.expiryDate);
      vars.days = Math.abs(daysBetween(today(), rec.expiryDate));
      vars.due = money(Math.max(bal, 0));
      if (templateKey === 'inactive') vars.days = daysBetween(lv ? dateOf(lv) : rec.startDate, today());
      templateKey = templateKey || (bal > 0 ? 'payment_due' : state === 'expired' ? 'expired' : state === 'expiring' ? 'renewal' : 'custom');
    }
    var keyMap = { lead_welcome: 'welcome:' + id, trial_followup: 'trial:' + id, payment_due: 'due:' + id, inactive: 'inactive:' + id };
    if (kind === 'member') {
      keyMap.renewal = 'renewal:' + id + ':' + rec.expiryDate;
      keyMap.expired = 'expired:' + id + ':' + rec.expiryDate;
    }
    return { kind: kind, id: id, name: rec.name, phone: rec.phone, templateKey: templateKey, vars: vars, keyMap: keyMap };
  }

  function confirmModal(title, text, confirmLabel, onConfirm) {
    pendingConfirm = onConfirm;
    openModal(title, '<p style="margin:0">' + esc(text) + '</p>',
      cancelBtn() + '<button class="btn danger" type="button" data-act="confirm-yes">' + esc(confirmLabel) + '</button>', 'confirm');
  }
  var pendingConfirm = null;

  /* =====================================================================
     Actions
     ===================================================================== */
  function checkIn(id) {
    var m = findMember(id);
    if (!m) return;
    if (checkedInToday(id)) { toast(m.name + ' is already checked in today.'); return; }
    db.attendance.push({ id: S.uid('att'), memberId: id, at: new Date().toISOString() });
    persist();
    var s = memberState(m);
    toast(m.name + ' checked in.' + (s === 'expired' ? ' Note: membership has expired.' : balance(id) > 0 ? ' Note: ' + money(balance(id)) + ' is due.' : ''), s === 'expired');
    ui.checkQ = '';
    render();
    var box = document.getElementById('check-q');
    if (box) box.focus();
  }

  function findQueueItem(key) { return buildQueue().find(function (i) { return i.key === key; }); }

  var actions = {
    close: closeModal,
    'lead-add': function () { leadModal(); },
    'lead-edit': function (el) { var l = findLead(el.dataset.id); if (l) leadModal(l); },
    'lead-delete': function (el) {
      var l = findLead(el.dataset.id);
      if (!l) return;
      confirmModal('Delete lead', 'Delete ' + l.name + '? This cannot be undone.', 'Delete', function () {
        db.leads = db.leads.filter(function (x) { return x.id !== l.id; });
        persist(); toast('Lead deleted.'); render();
      });
    },
    'lead-convert': function (el) {
      var l = findLead(el.dataset.id);
      if (l) memberAddModal({ leadId: l.id, name: l.name, phone: l.phone, email: l.email });
    },
    'lead-filter': function (el) { ui.leadStatus = el.dataset.status; if (currentPage !== 'leads') location.hash = '#leads'; else render(); },
    'mem-filter': function (el) { ui.memFilter = el.dataset.f; render(); },
    'member-add': function () {
      if (!db.plans.length) { toast('Add a membership plan in Settings first.', true); return; }
      memberAddModal();
    },
    'member-edit': function (el) { var m = findMember(el.dataset.id); if (m) memberEditModal(m); },
    'member-delete': function (el) {
      var m = findMember(el.dataset.id);
      if (!m) return;
      confirmModal('Delete member', 'Delete ' + m.name + ' and their payments and check-ins? To keep their history, set the status to Cancelled instead.', 'Delete', function () {
        db.members = db.members.filter(function (x) { return x.id !== m.id; });
        db.charges = db.charges.filter(function (x) { return x.memberId !== m.id; });
        db.payments = db.payments.filter(function (x) { return x.memberId !== m.id; });
        db.attendance = db.attendance.filter(function (x) { return x.memberId !== m.id; });
        persist(); toast('Member deleted.'); render();
      });
    },
    renew: function (el) { var m = findMember(el.dataset.id); if (m) renewModal(m); },
    pay: function (el) { payModal(el.dataset.id); },
    charge: function (el) { chargeModal(el.dataset.id); },
    'tx-delete': function (el) {
      var store = el.dataset.store, id = el.dataset.id;
      confirmModal('Delete entry', 'Delete this ' + (store === 'payments' ? 'payment' : 'charge') + '? Balances will be recalculated.', 'Delete', function () {
        db[store] = db[store].filter(function (x) { return x.id !== id; });
        persist(); toast('Entry deleted.'); render();
      });
    },
    checkin: function (el) { checkIn(el.dataset.id); },
    'checkin-undo': function (el) {
      db.attendance = db.attendance.filter(function (a) { return a.id !== el.dataset.id; });
      persist(); toast('Check-in removed.'); render();
    },
    compose: function (el) {
      var ctx = contextFor(el.dataset.kind, el.dataset.id, el.dataset.template);
      if (!ctx) return;
      ctx.key = ctx.keyMap[ctx.templateKey] || null;
      composeModal(ctx);
    },
    'compose-free': function () {
      var people = db.members.map(function (m) { return { kind: 'member', id: m.id, name: m.name }; })
        .concat(db.leads.filter(function (l) { return l.status !== 'joined'; }).map(function (l) { return { kind: 'lead', id: l.id, name: l.name + ' (lead)' }; }))
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (!people.length) { toast('Add a member or lead first.', true); return; }
      openModal('New WhatsApp message',
        field('Send to', '<select class="input" id="f-who" name="who" required><option value="">Choose a person</option>' +
          people.map(function (p) { return '<option value="' + p.kind + ':' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</select>') + ERR,
        cancelBtn() + '<button class="btn primary" type="submit">Next</button>', 'compose-pick');
    },
    'fu-send': function (el) {
      var item = findQueueItem(el.dataset.key);
      if (!item) return;
      el.disabled = true;
      sendMessage(queueItemToMessage(item)).then(render, function () { el.disabled = false; });
    },
    'fu-edit': function (el) {
      var item = findQueueItem(el.dataset.key);
      if (item) composeModal({ kind: item.kind, id: item.id, name: item.name, phone: item.phone, templateKey: item.templateKey, key: item.key, vars: item.vars });
    },
    'fu-skip': function (el) {
      db.followups[el.dataset.key] = new Date().toISOString();
      persist();
      toast(/^welcome:/.test(el.dataset.key) ? 'Skipped.' : 'Skipped for ' + plural(Number(db.settings.cooldownDays), 'day') + '.');
      render();
    },
    'fu-send-all': function (el) { el.disabled = true; el.textContent = 'Sending…'; sendAllDue(false); },
    'confirm-yes': function () { var fn = pendingConfirm; pendingConfirm = null; closeModal(); if (fn) fn(); },
    'plan-add': function () {
      document.getElementById('plan-rows').insertAdjacentHTML('beforeend', planRow({ id: S.uid('plan'), name: '', months: 1, fee: 0 }));
    },
    'plan-remove': function (el) {
      var row = el.closest('[data-plan]');
      var id = row.dataset.plan;
      if (db.members.some(function (m) { return m.planId === id; })) { toast('Members are on this plan. Move them to another plan first.', true); return; }
      if (document.querySelectorAll('#plan-rows [data-plan]').length <= 1) { toast('Keep at least one plan.', true); return; }
      row.remove();
    },
    'test-server': function () {
      var form = document.getElementById('settings-form');
      W.testServer(val(form, 'apiEndpoint')).then(function (res) {
        toast(res.configured ? 'Server is running and connected to WhatsApp.' : 'Server is running, but WhatsApp keys are not set. Check server/.env.', !res.configured);
      }, function (err) { toast(err.message + '. Start it with: cd server && npm start', true); });
    },
    export: function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'jax-studio-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Backup downloaded.');
    },
    import: function () { document.getElementById('import-file').click(); },
    sample: function () {
      var has = db.members.length || db.leads.length;
      var go = function () { loadSample(); persist(); toast('Sample data loaded. Delete it from Settings before going live.'); location.hash = '#dashboard'; render(); };
      if (has) confirmModal('Load sample data', 'This adds sample members, leads and payments next to your own data. Continue?', 'Load sample data', go);
      else go();
    },
    clear: function () {
      confirmModal('Delete all data', 'Delete every member, lead, payment, check-in and message from this browser? Export a backup first if you might need it.', 'Delete everything', function () {
        var keepSettings = db.settings, keepTemplates = db.templates, keepPlans = db.plans;
        db = S.defaults();
        db.settings = keepSettings; db.templates = keepTemplates; db.plans = keepPlans;
        persist(); toast('All client data deleted. Settings were kept.'); render();
      });
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (el && el.tagName !== 'SELECT' && actions[el.dataset.act]) {
      e.preventDefault();
      actions[el.dataset.act](el);
      return;
    }
    var tile = e.target.closest('[data-filter-mem]');
    if (tile) ui.memFilter = tile.dataset.filterMem;
  });

  // Close the modal by clicking the backdrop.
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.act === 'lead-status') {
      var l = findLead(el.dataset.id);
      if (!l) return;
      if (el.value === 'joined' && l.status !== 'joined') {
        el.value = l.status;
        memberAddModal({ leadId: l.id, name: l.name, phone: l.phone, email: l.email });
        return;
      }
      l.status = el.value;
      if (l.status === 'trial_done') l.trialDoneAt = new Date().toISOString();
      persist(); toast(l.name + ': ' + el.options[el.selectedIndex].text + '.');
      render();
      return;
    }
    if (el.dataset.act === 'plan-pick') {
      var form = el.form, p = findPlan(el.value);
      if (p && form.elements.fee) form.elements.fee.value = p.fee;
      if (p && form.dataset.form === 'renew' && form.elements.paid) form.elements.paid.value = p.fee;
      updateRenewPreview();
      return;
    }
    if (el.dataset.act === 'tpl-pick' && composeCtx) {
      var key = el.value;
      composeCtx.templateKey = key;
      if (composeCtx.keyMap) composeCtx.key = composeCtx.keyMap[key] || null;
      if (key === 'inactive' && composeCtx.kind === 'member') {
        var m = findMember(composeCtx.id), lv = m && lastVisit(m.id);
        if (m) composeCtx.vars.days = daysBetween(lv ? dateOf(lv) : m.startDate, today());
      }
      el.form.elements.text.value = key === 'custom' ? '' : fillTemplate(key, composeCtx.vars);
      return;
    }
    if (el.dataset.ui === 'payRange') { ui.payRange = el.value; renderList(); }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.ui && el.dataset.ui !== 'payRange') { ui[el.dataset.ui] = el.value; renderList(); }
    if (el.getAttribute('aria-invalid')) el.removeAttribute('aria-invalid');
  });

  // Enter in the check-in search checks in the only match.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'check-q') {
      e.preventDefault();
      var btns = document.querySelectorAll('#list [data-act="checkin"]:not([disabled])');
      if (btns.length === 1) checkIn(btns[0].dataset.id);
    }
  });

  /* =====================================================================
     Form submits
     ===================================================================== */
  var forms = {
    lead: function (f) {
      if (!val(f, 'name')) return invalid(f, 'name', 'Add a name.');
      if (!phoneOk(val(f, 'phone'))) return invalid(f, 'phone', 'Add a full WhatsApp number, at least 10 digits.');
      var id = val(f, 'id');
      var l = id ? findLead(id) : null;
      var data = { name: val(f, 'name'), phone: val(f, 'phone'), program: val(f, 'program'), preferredDate: val(f, 'preferredDate'), source: val(f, 'source'), status: val(f, 'status'), notes: val(f, 'notes') };
      if (data.status === 'joined' && (!l || l.status !== 'joined')) data.status = l ? l.status : 'new';
      if (l) {
        if (data.status === 'trial_done' && l.status !== 'trial_done') l.trialDoneAt = new Date().toISOString();
        Object.assign(l, data);
      } else {
        db.leads.unshift(Object.assign({ id: S.uid('lead'), email: '', createdAt: new Date().toISOString(), lastContactAt: null }, data));
      }
      persist(); closeModal(); toast(l ? 'Lead saved.' : 'Lead added. A welcome message is waiting in follow-ups.'); render();
    },
    'member-add': function (f) {
      if (!val(f, 'name')) return invalid(f, 'name', 'Add a name.');
      if (!phoneOk(val(f, 'phone'))) return invalid(f, 'phone', 'Add a full WhatsApp number, at least 10 digits.');
      var p = findPlan(val(f, 'planId'));
      if (!p) return invalid(f, 'planId', 'Choose a plan.');
      var start = val(f, 'startDate') || today();
      var fee = Number(val(f, 'fee')) || 0, paid = Number(val(f, 'paid')) || 0;
      var m = { id: S.uid('mem'), name: val(f, 'name'), phone: val(f, 'phone'), email: val(f, 'email'), planId: p.id, startDate: start, expiryDate: addMonths(start, p.months), status: 'active', notes: '', createdAt: new Date().toISOString() };
      db.members.push(m);
      if (fee > 0) db.charges.push({ id: S.uid('chg'), memberId: m.id, amount: fee, date: start, desc: p.name + ' · ' + plural(Number(p.months), 'month') });
      if (paid > 0) db.payments.push({ id: S.uid('pay'), memberId: m.id, amount: paid, date: today(), method: val(f, 'method'), note: 'On joining' });
      var leadId = val(f, 'leadId');
      if (leadId) { var l = findLead(leadId); if (l) l.status = 'joined'; }
      persist(); closeModal(); toast(m.name + ' added. Membership runs to ' + fmtDate(m.expiryDate) + '.'); render();
    },
    'member-edit': function (f) {
      var m = findMember(val(f, 'id'));
      if (!m) return closeModal();
      if (!val(f, 'name')) return invalid(f, 'name', 'Add a name.');
      if (!phoneOk(val(f, 'phone'))) return invalid(f, 'phone', 'Add a full WhatsApp number, at least 10 digits.');
      if (!val(f, 'expiryDate')) return invalid(f, 'expiryDate', 'Add an expiry date.');
      Object.assign(m, { name: val(f, 'name'), phone: val(f, 'phone'), email: val(f, 'email'), planId: val(f, 'planId'), expiryDate: val(f, 'expiryDate'), status: val(f, 'status'), notes: val(f, 'notes') });
      persist(); closeModal(); toast('Saved.'); render();
    },
    renew: function (f) {
      var m = findMember(val(f, 'id'));
      var p = findPlan(val(f, 'planId'));
      if (!m || !p) return closeModal();
      var fee = Number(val(f, 'fee')) || 0, paid = Number(val(f, 'paid')) || 0;
      var newExpiry = addMonths(val(f, 'base'), p.months);
      m.planId = p.id; m.expiryDate = newExpiry;
      if (m.status !== 'active') m.status = 'active';
      if (fee > 0) db.charges.push({ id: S.uid('chg'), memberId: m.id, amount: fee, date: today(), desc: 'Renewal · ' + p.name + ' · ' + plural(Number(p.months), 'month') });
      if (paid > 0) db.payments.push({ id: S.uid('pay'), memberId: m.id, amount: paid, date: today(), method: val(f, 'method'), note: 'Renewal' });
      persist(); closeModal(); toast(m.name + ' renewed to ' + fmtDate(newExpiry) + '.'); render();
    },
    pay: function (f) {
      if (!val(f, 'memberId')) return invalid(f, 'memberId', 'Choose a member.');
      var amt = Number(val(f, 'amount'));
      if (!(amt > 0)) return invalid(f, 'amount', 'Enter an amount above zero.');
      db.payments.push({ id: S.uid('pay'), memberId: val(f, 'memberId'), amount: amt, date: val(f, 'date') || today(), method: val(f, 'method'), note: val(f, 'note') });
      var m = findMember(val(f, 'memberId'));
      persist(); closeModal(); toast(money(amt) + ' recorded for ' + (m ? m.name : 'member') + '.'); render();
    },
    charge: function (f) {
      if (!val(f, 'memberId')) return invalid(f, 'memberId', 'Choose a member.');
      var amt = Number(val(f, 'amount'));
      if (!(amt > 0)) return invalid(f, 'amount', 'Enter an amount above zero.');
      if (!val(f, 'desc')) return invalid(f, 'desc', 'Say what the charge is for.');
      db.charges.push({ id: S.uid('chg'), memberId: val(f, 'memberId'), amount: amt, date: val(f, 'date') || today(), desc: val(f, 'desc') });
      persist(); closeModal(); toast('Charge added.'); render();
    },
    'compose-pick': function (f) {
      var who = val(f, 'who');
      if (!who) return invalid(f, 'who', 'Choose who to message.');
      var parts = who.split(':');
      var ctx = contextFor(parts[0], parts[1], 'custom');
      if (!ctx) return closeModal();
      ctx.key = null;
      composeModal(ctx);
    },
    compose: function (f) {
      var text = val(f, 'text');
      if (!text) return invalid(f, 'text', 'Write a message first.');
      if (!phoneOk(composeCtx.phone)) return invalid(f, 'text', 'This person has no valid WhatsApp number. Edit their details first.');
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      var key = val(f, 'templateKey');
      sendMessage({ kind: composeCtx.kind, id: composeCtx.id, name: composeCtx.name, phone: composeCtx.phone, templateKey: key, vars: composeCtx.vars, text: text, key: composeCtx.key })
        .then(function () { closeModal(); render(); }, function () { btn.disabled = false; });
    },
    settings: function (f) {
      var s = db.settings;
      var num = function (name, min, fallback) { var n = Number(val(f, name)); return isFinite(n) && n >= min ? n : fallback; };
      if (!val(f, 'studioName')) return invalid(f, 'studioName', 'Add the studio name.');
      // plans
      var rows = f.querySelectorAll('#plan-rows [data-plan]');
      var plans = [], bad = false;
      rows.forEach(function (r) {
        var name = r.querySelector('[name=plan-name]').value.trim();
        if (!name) { bad = true; r.querySelector('[name=plan-name]').setAttribute('aria-invalid', 'true'); return; }
        plans.push({ id: r.dataset.plan, name: name, months: Math.max(1, Number(r.querySelector('[name=plan-months]').value) || 1), fee: Math.max(0, Number(r.querySelector('[name=plan-fee]').value) || 0) });
      });
      if (bad) { toast('Every plan needs a name.', true); return; }
      db.plans = plans;
      Object.assign(s, {
        studioName: val(f, 'studioName'),
        countryCode: W.digits(val(f, 'countryCode')),
        currency: val(f, 'currency') || '₹',
        mode: f.querySelector('[name=mode]:checked').value,
        apiEndpoint: val(f, 'apiEndpoint'),
        autoSend: f.elements.autoSend.checked,
        autoEveryMin: num('autoEveryMin', 5, 15),
        renewalDays: num('renewalDays', 0, 7),
        inactiveDays: num('inactiveDays', 1, 10),
        trialFollowHours: num('trialFollowHours', 0, 24),
        cooldownDays: num('cooldownDays', 1, 3)
      });
      Object.keys(TEMPLATE_LABEL).forEach(function (k) {
        var t = f.elements['tpl-' + k];
        if (t && t.value.trim()) db.templates[k] = t.value.trim();
      });
      persist(); setupAutoSend(); toast('Settings saved.'); render();
    }
  };

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var name = f.dataset.form;
    if (!forms[name]) return;
    e.preventDefault();
    var err = f.querySelector('.form-error');
    if (err) err.hidden = true;
    forms[name](f);
  });

  /* ---------- import ---------- */
  document.getElementById('import-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (err) { toast('That file is not a valid backup.', true); return; }
      if (!data || !Array.isArray(data.members) || !Array.isArray(data.leads)) { toast('That file is not a JAX Studio Desk backup.', true); return; }
      confirmModal('Import backup', 'Replace all data in this browser with the backup from ' + file.name + '?', 'Replace my data', function () {
        S.save(data);
        db = S.load();
        persist(); setupAutoSend(); toast('Backup imported.'); render();
      });
    };
    reader.readAsText(file);
  });

  /* =====================================================================
     Sample data, clearly named, for trying the dashboard
     ===================================================================== */
  function loadSample() {
    var t = today();
    var fees = { plan_open: 2500, plan_classes: 3500, plan_pt: 12000 };
    db.plans.forEach(function (p) { if (!p.fee && fees[p.id]) p.fee = fees[p.id]; });
    var planIds = db.plans.map(function (p) { return p.id; });
    function ago(days, hour) { var d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour || 7, Math.floor(Math.random() * 50), 0, 0); return d.toISOString(); }
    var people = [
      // name, start offset (days ago), months, plan index, paid share, visits [days ago]
      ['Sample: Arjun Mehta', 20, 1, 1, 1, [0, 2, 4, 6, 9]],
      ['Sample: Priya Nair', 26, 1, 0, 1, [1, 3, 8]],
      ['Sample: Rohan Kapoor', 40, 1, 2, 0.5, [12, 15, 19]],
      ['Sample: Sneha Iyer', 85, 3, 1, 1, [0, 1, 3, 5, 7, 10]],
      ['Sample: Vikram Singh', 33, 1, 0, 1, [14, 18, 25]],
      ['Sample: Ananya Rao', 10, 1, 1, 0, [2, 6]],
      ['Sample: Kabir Joshi', 175, 6, 0, 1, [0, 4, 9]],
      ['Sample: Meera Pillai', 28, 1, 2, 1, [22]]
    ];
    people.forEach(function (row, i) {
      var p = findPlan(planIds[row[3] % planIds.length]) || db.plans[0];
      var start = addDays(t, -row[1]);
      var id = S.uid('mem');
      db.members.push({ id: id, name: row[0], phone: '98' + String(10000000 + i * 1234567).slice(0, 8), email: '', planId: p.id, startDate: start, expiryDate: addMonths(start, row[2]), status: 'active', notes: 'Sample record', createdAt: new Date(parseD(start)).toISOString() });
      var fee = (p.fee || 0) * (row[2] / (p.months || 1));
      if (fee) db.charges.push({ id: S.uid('chg'), memberId: id, amount: fee, date: start, desc: p.name + ' · ' + plural(row[2], 'month') });
      if (fee && row[4]) db.payments.push({ id: S.uid('pay'), memberId: id, amount: Math.round(fee * row[4]), date: start, method: i % 2 ? 'Cash' : 'UPI', note: 'On joining' });
      row[5].forEach(function (d) { db.attendance.push({ id: S.uid('att'), memberId: id, at: ago(d, 6 + (i % 4) * 3) }); });
    });
    var leads = [
      ['Sample: Ishaan Verma', 'Strength', 'new', 0, 'Website'],
      ['Sample: Diya Shah', 'HIIT', 'new', 1, 'Instagram'],
      ['Sample: Neil Fernandes', 'Personal training', 'contacted', 2, 'Website'],
      ['Sample: Tara Menon', 'Mobility', 'trial_booked', 3, 'Referral'],
      ['Sample: Aditya Rao', 'Strength', 'trial_done', 4, 'Walk-in'],
      ['Sample: Kavya Reddy', 'HIIT', 'lost', 12, 'Website']
    ];
    leads.forEach(function (row, i) {
      var created = ago(row[3], 10);
      db.leads.unshift({
        id: S.uid('lead'), name: row[0], phone: '97' + String(20000000 + i * 2345671).slice(0, 8), email: '', program: row[1],
        preferredDate: addDays(t, 2 + i), source: row[4], status: row[2], notes: 'Sample record',
        createdAt: created, lastContactAt: row[2] === 'new' ? null : created, trialDoneAt: row[2] === 'trial_done' ? ago(2, 9) : undefined
      });
    });
  }

  /* ---------- start ---------- */
  route();
  setupAutoSend();
  // Pick up trial bookings made on the website in another tab.
  window.addEventListener('storage', function (e) {
    if (e.key === S.KEY) { db = S.load(); if (!modal.open) render(); else updateCount(); }
  });
})();
