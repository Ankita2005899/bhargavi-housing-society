/*
 * logout-confirm.js
 * Shows a "Are you sure you want to log out?" popup before any logout happens.
 *  - Yes -> the normal logout code of the page runs.
 *  - No  -> popup closes, user stays logged in.
 * Works for the navbar button (#logoutBtn) and the Secretary dashboard
 * button (#secLogoutBtn), even though those buttons are created dynamically.
 */
(function () {
  'use strict';

  var SELECTOR = '#logoutBtn, #secLogoutBtn';
  var overlay = null;
  var lastBtn = null;

  function injectStyles() {
    if (document.getElementById('logoutConfirmStyles')) return;
    var css = [
      '.lc-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;',
      'padding:16px;background:rgba(14,27,50,.55);backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease;}',
      '.lc-overlay.lc-show{opacity:1;}',
      '.lc-box{width:100%;max-width:400px;background:#fff;border-radius:16px;padding:26px 24px 22px;text-align:center;',
      'box-shadow:0 24px 60px -12px rgba(14,27,50,.45);transform:translateY(12px) scale(.97);transition:transform .2s ease;',
      'font-family:inherit;}',
      '.lc-overlay.lc-show .lc-box{transform:none;}',
      '.lc-icon{width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:#FBE9E3;color:#C1522C;',
      'display:flex;align-items:center;justify-content:center;font-size:24px;}',
      '.lc-title{margin:0 0 6px;font-size:1.2rem;font-weight:700;color:#0E1B32;}',
      '.lc-text{margin:0 0 20px;font-size:.95rem;line-height:1.5;color:#4A5468;}',
      '.lc-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}',
      '.lc-btn{flex:1 1 140px;padding:10px 16px;border-radius:999px;font-size:.95rem;font-weight:600;cursor:pointer;',
      'font-family:inherit;border:1.5px solid transparent;transition:transform .12s ease,box-shadow .12s ease,background .12s ease;}',
      '.lc-btn:active{transform:scale(.97);}',
      '.lc-no{background:#fff;color:#1B3A6B;border-color:#1B3A6B;}',
      '.lc-no:hover{background:#E7F0F9;}',
      '.lc-yes{background:#C1522C;color:#fff;box-shadow:0 8px 20px rgba(193,82,44,.28);}',
      '.lc-yes:hover{background:#A5411F;}',
      '.lc-btn:focus-visible{outline:3px solid #4E8FC7;outline-offset:2px;}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'logoutConfirmStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function closeDialog() {
    if (!overlay) return;
    var el = overlay;
    overlay = null;
    document.removeEventListener('keydown', onKeydown, true);
    el.classList.remove('lc-show');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    if (lastBtn && document.contains(lastBtn)) lastBtn.focus();
  }

  function onKeydown(e) {
    if (!overlay) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    } else if (e.key === 'Tab') {
      // keep focus inside the dialog
      var f = overlay.querySelectorAll('button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function openDialog(btn) {
    if (overlay) return;
    injectStyles();
    lastBtn = btn;

    overlay = document.createElement('div');
    overlay.className = 'lc-overlay';
    overlay.innerHTML =
      '<div class="lc-box" role="dialog" aria-modal="true" aria-labelledby="lcTitle" aria-describedby="lcText">' +
        '<div class="lc-icon" aria-hidden="true">&#x1F6AA;</div>' +
        '<h3 class="lc-title" id="lcTitle">Log out?</h3>' +
        '<p class="lc-text" id="lcText">Are you sure you want to log out of your account?</p>' +
        '<div class="lc-actions">' +
          '<button type="button" class="lc-btn lc-no">No, stay logged in</button>' +
          '<button type="button" class="lc-btn lc-yes">Yes, log out</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var yes = overlay.querySelector('.lc-yes');
    var no = overlay.querySelector('.lc-no');

    no.addEventListener('click', closeDialog);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });
    yes.addEventListener('click', function () {
      var target = lastBtn;
      closeDialog();
      if (target && document.contains(target)) {
        target.dataset.logoutConfirmed = '1';   // lets the next click pass through
        target.click();                         // runs the page's original logout code
      }
    });

    document.addEventListener('keydown', onKeydown, true);
    var shown = overlay;
    requestAnimationFrame(function () { shown.classList.add('lc-show'); });
    no.focus();  // safest default: "No" is focused
  }

  // Capture phase => runs BEFORE the page's own logout handler.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest(SELECTOR) : null;
    if (!btn) return;

    if (btn.dataset.logoutConfirmed === '1') {   // user already said "Yes"
      delete btn.dataset.logoutConfirmed;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openDialog(btn);
  }, true);
})();
