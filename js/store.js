/*
  JAX Fitness Studio: shared data store.

  Everything is saved in this browser's localStorage under one key.
  The website (trial form) and the staff dashboard (admin/) read and write
  the same data when they are opened from the same address, for example
  through VS Code Live Server. Data does not leave this browser: use
  Settings > Export backup in the dashboard to keep a copy.
*/
(function () {
  'use strict';

  var KEY = 'jax.crm.v1';

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Message templates. {placeholders} are filled in when a message is sent.
  var TEMPLATES = {
    lead_welcome: 'Hi {name}, this is {studio}. Thanks for booking a free trial. Which day and time suits you? Reply here and we will hold a spot for you.',
    trial_followup: 'Hi {name}, good having you in for your trial at {studio}. Ready to keep going? Reply JOIN and we will set up your membership.',
    renewal: 'Hi {name}, your {plan} membership at {studio} ends on {expiry}. Reply RENEW and we will keep your spot.',
    expired: 'Hi {name}, your {studio} membership ended on {expiry}. Want to pick up where you left off? Reply RENEW and we will get you back on the floor.',
    payment_due: 'Hi {name}, a reminder from {studio}: {due} is pending on your account. You can pay at the front desk or reply here for payment details.',
    inactive: 'Hi {name}, we have not seen you at {studio} for {days} days. Want us to book you into a session this week?'
  };

  function defaults() {
    return {
      version: 1,
      leads: [],
      members: [],
      charges: [],      // amounts owed: membership fees, extras
      payments: [],     // amounts received
      attendance: [],   // check-ins
      messages: [],     // WhatsApp message log
      followups: {},    // follow-up key -> when it was last sent or snoozed
      plans: [
        { id: 'plan_open', name: 'Open floor', months: 1, fee: 0 },
        { id: 'plan_classes', name: 'Classes', months: 1, fee: 0 },
        { id: 'plan_pt', name: 'Personal training', months: 1, fee: 0 }
      ],
      templates: Object.assign({}, TEMPLATES),
      settings: {
        studioName: 'JAX Fitness Studio',
        countryCode: '91',
        currency: '₹',
        mode: 'click',                                  // 'click' or 'api'
        apiEndpoint: 'http://localhost:8787/send',
        autoSend: false,
        autoEveryMin: 15,
        renewalDays: 7,        // remind this many days before expiry
        inactiveDays: 10,      // flag members not seen for this many days
        trialFollowHours: 24,  // follow up this long after a trial
        cooldownDays: 3        // do not repeat the same follow-up within this many days
      }
    };
  }

  function load() {
    var def = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return def;
      var db = JSON.parse(raw);
      Object.keys(def).forEach(function (k) { if (db[k] === undefined) db[k] = def[k]; });
      db.settings = Object.assign(def.settings, db.settings);
      db.templates = Object.assign(def.templates, db.templates);
      return db;
    } catch (e) {
      return def;
    }
  }

  function save(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Used by the website's trial form.
  function addLead(input) {
    var db = load();
    var lead = {
      id: uid('lead'),
      name: String(input.name || '').trim(),
      phone: String(input.phone || '').trim(),
      email: String(input.email || '').trim(),
      program: input.program || '',
      preferredDate: input.preferredDate || '',
      source: input.source || 'Website',
      status: 'new',
      notes: input.notes || '',
      createdAt: new Date().toISOString(),
      lastContactAt: null
    };
    db.leads.unshift(lead);
    save(db);
    return lead;
  }

  window.JAXStore = {
    KEY: KEY,
    TEMPLATES: TEMPLATES,
    defaults: defaults,
    load: load,
    save: save,
    uid: uid,
    todayISO: todayISO,
    addLead: addLead
  };
})();
