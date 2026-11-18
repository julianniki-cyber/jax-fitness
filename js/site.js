/* JAX Fitness Studio: website interactions. */
(function () {
  'use strict';

  var cfg = window.JAX_CONFIG || {};
  var docEl = document.documentElement;
  var root = document.getElementById('jx-root');
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------- intro: plays once per browser session ---------- */
  var intro = document.getElementById('js-intro');
  var introTimer = null;
  var introPlaying = false;

  function endIntro() {
    clearTimeout(introTimer);
    introPlaying = false;
    try { sessionStorage.setItem('jax-intro', '1'); } catch (e) {}
    docEl.classList.add('jx-seen');
    root.classList.add('is-in');
  }

  function bindSkip() {
    var skip = document.getElementById('js-skip');
    if (skip) skip.addEventListener('click', endIntro);
  }

  function playIntro() {
    // Swap in a fresh copy so every CSS animation restarts from zero.
    var fresh = intro.cloneNode(true);
    intro.parentNode.replaceChild(fresh, intro);
    intro = fresh;
    bindSkip();
    root.classList.remove('is-in');
    docEl.classList.remove('jx-seen');
    introPlaying = true;
    clearTimeout(introTimer);
    introTimer = setTimeout(endIntro, reduced ? 950 : 3100);
  }

  if (docEl.classList.contains('jx-seen')) {
    root.classList.add('is-in');
  } else {
    bindSkip();
    introPlaying = true;
    introTimer = setTimeout(endIntro, reduced ? 950 : 3100);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && introPlaying) endIntro();
  });

  var replay = document.getElementById('js-replay');
  if (replay) replay.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'instant' });
    playIntro();
  });

  /* ---------- mobile menu: the two X halves join to close ---------- */
  var burger = document.getElementById('js-burger');
  var menu = document.getElementById('js-menu');

  function setMenu(open) {
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
  }
  burger.addEventListener('click', function () { setMenu(menu.hidden); });

  /* ---------- section jumps with the X wipe ---------- */
  var wipe = document.getElementById('js-wipe');
  var wipeA, wipeB;

  function jumpTo(el) {
    var top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top, behavior: 'instant' });
  }

  document.querySelectorAll('[data-go]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = document.getElementById(link.getAttribute('data-go'));
      if (!target) return;
      e.preventDefault();
      setMenu(false);
      if (reduced) { jumpTo(target); return; }
      clearTimeout(wipeA); clearTimeout(wipeB);
      wipe.classList.remove('on');
      void wipe.offsetWidth; // restart the animation
      wipe.classList.add('on');
      wipeA = setTimeout(function () { jumpTo(target); }, 360);
      wipeB = setTimeout(function () { wipe.classList.remove('on'); }, 820);
    });
  });

  /* ---------- programs rail arrows ---------- */
  var rail = document.getElementById('js-rail');
  document.getElementById('js-prev').addEventListener('click', function () { rail.scrollBy({ left: -340, behavior: 'smooth' }); });
  document.getElementById('js-next').addEventListener('click', function () { rail.scrollBy({ left: 340, behavior: 'smooth' }); });

  /* ---------- schedule: sample timetable, replace with your classes ---------- */
  var CLASSES = [
    { day: 'Mon', time: '06:30', name: 'Barbell basics', type: 'Strength' },
    { day: 'Mon', time: '18:30', name: 'Engine', type: 'HIIT' },
    { day: 'Tue', time: '07:00', name: 'Open hips', type: 'Mobility' },
    { day: 'Wed', time: '06:30', name: 'Heavy day', type: 'Strength' },
    { day: 'Thu', time: '18:30', name: 'Intervals', type: 'HIIT' },
    { day: 'Fri', time: '07:00', name: 'Push and pull', type: 'Strength' },
    { day: 'Sat', time: '08:00', name: 'Team session', type: 'HIIT' },
    { day: 'Sat', time: '09:30', name: 'Reset', type: 'Mobility' }
  ];
  var FILTERS = ['All', 'Strength', 'HIIT', 'Mobility'];
  var ARROW = '<svg viewBox="0 0 60 100" aria-hidden="true"><path d="M0 0H30L60 50L30 100H0L30 50Z"></path></svg>';
  var filterBox = document.getElementById('js-filters');
  var rowsBox = document.getElementById('js-rows');
  var current = 'All';

  function renderSchedule() {
    filterBox.innerHTML = FILTERS.map(function (f) {
      var on = f === current;
      return '<button class="jx-pill' + (on ? ' sel' : '') + '" type="button" aria-pressed="' + on + '" data-filter="' + f + '">' + f + '</button>';
    }).join('');
    rowsBox.innerHTML = CLASSES.filter(function (c) {
      return current === 'All' || c.type === current;
    }).map(function (c) {
      return '<div class="jx-row" style="display: grid; grid-template-columns: 70px 90px minmax(0, 1fr) 130px 110px; align-items: center; gap: 16px; min-height: 60px; border-bottom: 1px solid #2a2a2a">' +
        '<div class="jx-label" style="color: #fff">' + c.day + '</div>' +
        '<div style="font-variant-numeric: tabular-nums; color: #d0d0d0">' + c.time + '</div>' +
        '<div style="font: 400 26px/1 Anton, Impact, sans-serif; text-transform: uppercase">' + c.name + '</div>' +
        '<div class="jx-label">' + c.type + '</div>' +
        '<a class="jx-book" href="#contact" data-class="' + c.type + '" style="justify-content: flex-end">Book ' + ARROW + '</a>' +
        '</div>';
    }).join('');
  }
  filterBox.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    current = b.getAttribute('data-filter');
    renderSchedule();
  });
  // "Book" on a class pre-selects that program in the trial form.
  rowsBox.addEventListener('click', function (e) {
    var a = e.target.closest('[data-class]');
    if (!a) return;
    var sel = document.getElementById('tf-program');
    if (sel) sel.value = a.getAttribute('data-class');
  });
  renderSchedule();

  /* ---------- contact buttons from config ---------- */
  var waNumber = String(cfg.whatsappNumber || '').replace(/\D/g, '');
  function waLink(text) {
    return 'https://wa.me/' + waNumber + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  var waBtn = document.getElementById('js-wa');
  if (waBtn && waNumber) waBtn.href = waLink('Hi ' + (cfg.studioName || 'JAX') + ', I would like to know more about training with you.');
  var telBtn = document.getElementById('js-tel');
  if (telBtn && cfg.phone) telBtn.href = 'tel:' + String(cfg.phone).replace(/[^\d+]/g, '');

  /* ---------- free trial form: saves a lead for the staff dashboard ---------- */
  var form = document.getElementById('trial-form');
  var err = document.getElementById('tf-error');
  var done = document.getElementById('tf-done');
  var dateInput = document.getElementById('tf-date');
  if (dateInput) dateInput.min = window.JAXStore ? window.JAXStore.todayISO() : '';

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('tf-name');
    var phone = document.getElementById('tf-phone');
    var digits = phone.value.replace(/\D/g, '');
    name.removeAttribute('aria-invalid');
    phone.removeAttribute('aria-invalid');

    var problem = '';
    if (!name.value.trim()) { problem = 'Add your name.'; name.setAttribute('aria-invalid', 'true'); name.focus(); }
    else if (digits.length < 10) { problem = 'Add a WhatsApp number with at least 10 digits.'; phone.setAttribute('aria-invalid', 'true'); phone.focus(); }
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;

    var program = document.getElementById('tf-program').value;
    var day = dateInput.value;
    if (window.JAXStore) {
      window.JAXStore.addLead({ name: name.value, phone: phone.value, program: program, preferredDate: day, source: 'Website' });
    }

    var waDone = document.getElementById('tf-wa');
    if (waNumber) {
      waDone.href = waLink('Hi ' + (cfg.studioName || 'JAX') + ', I just booked a free trial. Name: ' + name.value.trim() +
        '. Program: ' + program + (day ? '. Preferred day: ' + day : '') + '.');
      waDone.hidden = false;
    }
    form.querySelectorAll('.jx-fgrid, .jx-fgrid + .jx-ferr + div').forEach(function (el) { el.style.display = 'none'; });
    done.hidden = false;
  });

  /* ---------- X cursor (mouse only) ---------- */
  var cur = document.getElementById('js-cur');
  var curOn = false, hot = false;
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    var isHot = !!(e.target.closest && e.target.closest('a,button,input,select,label'));
    if (isHot !== hot) { hot = isHot; cur.classList.toggle('hot', hot); }
    if (!curOn) { curOn = true; cur.classList.add('on'); root.classList.add('has-cur'); }
  });
  document.addEventListener('pointerleave', function () { cur.classList.remove('on'); curOn = false; });
})();
