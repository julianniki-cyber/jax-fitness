/*
  JAX Fitness Studio: WhatsApp sending.

  Two modes, chosen in the dashboard under Settings > WhatsApp:

  'click'  Opens WhatsApp (app or WhatsApp Web) with the message already
           written. Staff tap Send. Free, no setup.

  'api'    Posts the message to your own server (see /server), which sends it
           through the WhatsApp Business Cloud API with no tap needed.
*/
(function () {
  'use strict';

  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  // Turns "98765 43210" into "919876543210" using the default country code.
  function normalize(phone, countryCode) {
    var d = digits(phone);
    var cc = digits(countryCode);
    if (!d) return '';
    if (d.length === 11 && d.charAt(0) === '0' && cc) d = d.slice(1);
    if (d.length === 10 && cc) d = cc + d;
    return d.length >= 11 ? d : '';
  }

  // Fills {name}, {studio}, ... Unknown placeholders stay visible so they get noticed.
  function fill(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (match, key) {
      var v = vars ? vars[key] : undefined;
      return v === undefined || v === null || v === '' ? match : String(v);
    });
  }

  function link(number, text) {
    return 'https://wa.me/' + digits(number) + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function openLink(url) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || json.ok === false) throw new Error(json.error || ('Server replied ' + res.status));
        return json;
      });
    }, function () {
      throw new Error('Could not reach the WhatsApp server at ' + url + '. Is it running?');
    });
  }

  /*
    send({ phone, text, templateKey, vars }, settings)
    Resolves with { mode: 'click' } or { mode: 'api', id }.
  */
  function send(msg, settings) {
    var to = normalize(msg.phone, settings.countryCode);
    if (!to) return Promise.reject(new Error('The phone number for ' + (msg.vars && msg.vars.name || 'this person') + ' looks incomplete.'));
    if (settings.mode === 'api') {
      return postJSON(settings.apiEndpoint, {
        to: to,
        text: msg.text,
        templateKey: msg.templateKey || null,
        vars: msg.vars || {}
      }).then(function (json) { return { mode: 'api', id: json.id || null }; });
    }
    openLink(link(to, msg.text));
    return Promise.resolve({ mode: 'click' });
  }

  // Checks the server's /health route, next to the /send route.
  function testServer(endpoint) {
    var url = String(endpoint || '').replace(/\/send\/?$/, '') + '/health';
    return fetch(url).then(function (r) { return r.json(); }, function () {
      throw new Error('Could not reach ' + url);
    });
  }

  window.JAXWhatsApp = {
    digits: digits,
    normalize: normalize,
    fill: fill,
    link: link,
    send: send,
    testServer: testServer
  };
})();
