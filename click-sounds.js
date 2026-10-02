/*
 * click-sounds.js
 * Gives every click on the website a sound — and not the same one every time:
 *   - each kind of control has its own sound (nav link, primary button, tab, toggle,
 *     close, delete, log out ...)
 *   - the 5 Quick Actions on the home page each have their own signature sound
 *     (coin, wrench, bell, door knock, page flip)
 *   - every play is nudged slightly in pitch so repeats never sound identical
 *   - clicking anything else on the page (cards, photos, empty space) gives a soft tick
 *
 * Sounds are synthesised with the Web Audio API, so there are no audio files to load.
 * A small speaker button (bottom-left) mutes / unmutes; the choice is remembered.
 * Other scripts can call:  BHSSound.play('success' | 'error' | 'open' | 'close' | ...)
 */
(function () {
  'use strict';
  if (window.BHSSound) return;

  var STORE_KEY = 'bhsSoundMuted';
  var ctx = null, master = null, noiseBuf = null;
  var muted = false;
  var lastPlay = 0;
  var pitch = 1; // per-play random variation

  try { muted = localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* storage blocked */ }

  /* ------------------------------------------------------------ audio basics */
  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try {
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }

  // One note: oscillator + quick attack / exponential decay. f2 = optional glide target.
  function tone(freq, t0, dur, type, vol, f2) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq * pitch, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2 * pitch, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.004 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.06);
  }

  // A burst of filtered noise (thuds, clanks, page flips).
  function noise(t0, dur, vol, filterType, freq, q, freq2) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq * pitch, t0);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2 * pitch, t0 + dur);
    f.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.005 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /* ------------------------------------------------------------------ sounds */
  var SOUNDS = {
    // very quiet tick for "clicked on something that isn't a control"
    soft:      function (t) { tone(520, t, 0.04, 'sine', 0.07); },
    // default for plain buttons / unknown controls
    tap:       function (t) { tone(640, t, 0.06, 'triangle', 0.16); },
    // text links
    link:      function (t) { tone(560, t, 0.05, 'sine', 0.14); tone(840, t + 0.04, 0.06, 'sine', 0.10); },
    // header / menu navigation: soft rising pop
    nav:       function (t) { tone(420, t, 0.11, 'sine', 0.18, 760); },
    // main call-to-action buttons: bright two-note chime
    primary:   function (t) { tone(660, t, 0.08, 'triangle', 0.2); tone(990, t + 0.07, 0.12, 'triangle', 0.2); },
    // outline / secondary buttons: gentle double tap
    secondary: function (t) { tone(440, t, 0.07, 'sine', 0.17); tone(587, t + 0.06, 0.08, 'sine', 0.13); },
    // tabs / chips / segmented controls: woody tick
    tab:       function (t) { tone(310, t, 0.05, 'square', 0.07); noise(t, 0.03, 0.12, 'bandpass', 1800, 2); },
    // checkboxes, radios, dropdowns: switch click
    toggle:    function (t) { tone(1250, t, 0.03, 'square', 0.06); tone(880, t + 0.045, 0.04, 'square', 0.05); },
    // close / back: falling blip
    close:     function (t) { tone(720, t, 0.1, 'sine', 0.17, 420); },
    // delete / remove: low thud
    danger:    function (t) { tone(150, t, 0.14, 'sine', 0.32, 55); noise(t, 0.06, 0.1, 'lowpass', 500, 1); },
    // log out: three falling notes
    logout:    function (t) { tone(660, t, 0.1, 'sine', 0.17); tone(523, t + 0.09, 0.1, 'sine', 0.17); tone(392, t + 0.18, 0.16, 'sine', 0.17); },
    // modal / panel opening: rising whoosh + note
    open:      function (t) { tone(330, t, 0.16, 'sine', 0.15, 700); noise(t, 0.12, 0.05, 'highpass', 1500, 1); },

    // programmatic feedback
    success:   function (t) { tone(523, t, 0.09, 'triangle', 0.18); tone(659, t + 0.08, 0.09, 'triangle', 0.18); tone(784, t + 0.16, 0.16, 'triangle', 0.2); },
    error:     function (t) { tone(220, t, 0.12, 'sawtooth', 0.1); tone(165, t + 0.11, 0.18, 'sawtooth', 0.1); },

    // ---- Quick Actions: one signature sound each ----
    'qa-maintenance': function (t) { // coin
      tone(988, t, 0.07, 'square', 0.09); tone(1319, t + 0.07, 0.28, 'square', 0.09); },
    'qa-complaint': function (t) {   // wrench clank
      noise(t, 0.05, 0.28, 'bandpass', 2600, 4); tone(420, t, 0.09, 'triangle', 0.2, 300);
      noise(t + 0.11, 0.05, 0.22, 'bandpass', 3200, 4); tone(520, t + 0.11, 0.09, 'triangle', 0.16, 380); },
    'qa-hall': function (t) {        // bell
      tone(784, t, 0.5, 'sine', 0.2); tone(1568, t, 0.32, 'sine', 0.08); tone(2349, t, 0.18, 'sine', 0.04); },
    'qa-gatepass': function (t) {    // two door knocks
      tone(190, t, 0.1, 'sine', 0.38, 90); noise(t, 0.05, 0.16, 'lowpass', 700, 1);
      tone(170, t + 0.15, 0.1, 'sine', 0.38, 85); noise(t + 0.15, 0.05, 0.16, 'lowpass', 700, 1); },
    'qa-directory': function (t) {   // page flip + ding
      noise(t, 0.16, 0.14, 'bandpass', 900, 0.8, 4200); tone(1175, t + 0.15, 0.12, 'sine', 0.1); }
  };

  function play(name) {
    if (muted) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    if (!ac()) return;
    var now = Date.now();
    if (now - lastPlay < 35) return; // swallow accidental double events
    lastPlay = now;
    pitch = 1 + (Math.random() - 0.5) * 0.08; // ±4 %
    try { fn(ctx.currentTime + 0.005); } catch (e) { /* never break the page for a sound */ }
  }

  /* ----------------------------------------------------- what was clicked? */
  var INTERACTIVE = '[data-sound],a,button,[role="button"],[role="tab"],input,select,textarea,summary,label,.rail-btn,.sec-tab';
  var TEXT_INPUTS = 'input[type=text],input[type=email],input[type=password],input[type=search],input[type=number],input[type=date],input[type=month],input[type=tel],input[type=url],textarea';

  function classify(target) {
    if (!target || !target.closest) return 'soft';
    var el = target.closest(INTERACTIVE);
    if (!el) return 'soft';

    var forced = el.getAttribute('data-sound');
    if (forced && SOUNDS[forced]) return forced;

    // A label click is followed by a click on its input — let the input make the sound.
    if (el.tagName === 'LABEL' && (el.control || el.querySelector('input,select,textarea'))) return null;

    var qa = el.getAttribute('data-qa');
    if (qa && SOUNDS['qa-' + qa]) return 'qa-' + qa;

    var label = ((el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).toLowerCase().replace(/\s+/g, ' ').trim();
    var head = label.slice(0, 40);

    if (/log ?out|sign ?out/.test(head)) return 'logout';
    if (el.matches('.modal-close,.qa-close,.details-popup-back,[id$="Close"],[id$="close"]') || /^(×|✕|x|close)\b/.test(head) || /\bclose\b/.test(el.getAttribute('aria-label') || '')) return 'close';
    if (el.matches('.btn-danger,.qa-btn-danger,[data-act*="delete"],[data-act*="remove"]') || /^(delete|remove)\b/.test(head)) return 'danger';
    if (el.matches('.sec-tab,[role=tab],.qa-seg button,.qa-chipbtn')) return 'tab';
    if (el.matches('input[type=checkbox],input[type=radio],select,.switch')) return 'toggle';
    if (el.matches(TEXT_INPUTS)) return 'soft';
    if (el.matches('.btn-primary,.btn-gold,button[type=submit],input[type=submit],.qa-btn-primary,.qa-btn-ok')) return 'primary';
    if (el.matches('.btn,.btn-outline,.btn-ghost,.qa-btn')) return 'secondary';
    if (el.closest('.main-nav,.slide-menu,.site-header nav,.mobile-menu,.menu-drawer')) return 'nav';
    if (el.tagName === 'A') return 'link';
    return 'tap';
  }

  // Capture phase: runs before the page's own handlers, so the sound is instant.
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'bhsSoundToggle') return; // the toggle makes its own sound
    var name = classify(e.target);
    if (name) play(name);
  }, true);

  // A page that navigates away would cut the sound off, so give same-tab internal
  // links a moment (130 ms) to be heard. Only if nothing else already handled the click.
  document.addEventListener('click', function (e) {
    if (muted || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    if (a.origin !== location.origin) return;
    if (a.pathname === location.pathname && a.search === location.search) return;
    e.preventDefault();
    setTimeout(function () { location.href = a.href; }, 130);
  }, false);

  /* --------------------------------------------------------- mute button */
  function injectToggle() {
    if (document.getElementById('bhsSoundToggle') || !document.body) return;
    var css = document.createElement('style');
    css.textContent =
      '#bhsSoundToggle{position:fixed;left:1rem;bottom:1.1rem;z-index:140;width:42px;height:42px;border-radius:50%;' +
      'border:2px solid #D9A441;background:#0E1B32;color:#D9A441;display:grid;place-items:center;cursor:pointer;' +
      'box-shadow:0 8px 20px rgba(14,27,50,.3);padding:0;transition:transform .15s ease,background .15s ease;}' +
      '#bhsSoundToggle:hover{transform:scale(1.08);background:#1B3A6B;}' +
      '#bhsSoundToggle:focus-visible{outline:3px solid #4E8FC7;outline-offset:2px;}' +
      '#bhsSoundToggle svg{width:20px;height:20px;}' +
      '@media print{#bhsSoundToggle{display:none}}';
    document.head.appendChild(css);

    var btn = document.createElement('button');
    btn.id = 'bhsSoundToggle';
    btn.type = 'button';
    document.body.appendChild(btn);

    function paint() {
      btn.setAttribute('aria-label', muted ? 'Turn click sounds on' : 'Turn click sounds off');
      btn.title = muted ? 'Click sounds: off (tap to turn on)' : 'Click sounds: on (tap to turn off)';
      btn.innerHTML = muted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    }
    paint();
    btn.addEventListener('click', function () {
      muted = !muted;
      try { localStorage.setItem(STORE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      paint();
      if (!muted) play('success');
    });
  }

  window.BHSSound = {
    play: play,
    mute: function () { muted = true; try { localStorage.setItem(STORE_KEY, '1'); } catch (e) {} },
    unmute: function () { muted = false; try { localStorage.setItem(STORE_KEY, '0'); } catch (e) {} },
    isMuted: function () { return muted; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectToggle);
  else injectToggle();
})();
