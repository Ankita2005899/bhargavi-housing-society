/* responsive-nav.js — gives every inner page a phone/tablet menu.
   The home page has its own slide menu (#hamburgerBtn); this only runs where that is missing. */
(function () {
  'use strict';
  function init() {
    if (document.getElementById('hamburgerBtn')) return;
    var inner = document.querySelector('.site-header .header-inner');
    var nav = document.querySelector('.site-header .main-nav');
    if (!inner || !nav) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rn-burger';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    inner.appendChild(btn);

    var overlay = document.createElement('div');
    overlay.className = 'rn-overlay';
    var drawer = document.createElement('aside');
    drawer.className = 'rn-drawer';
    drawer.setAttribute('aria-label', 'Site menu');
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
    function link(a, label) { return '<a href="' + esc(a.getAttribute('href') || '#') + '">' + esc(label || a.textContent.trim()) + '</a>'; }

    // built on open, so menus that other scripts fill in later are included
    function build() {
      var html = '<div class="rn-drawer-head"><span>Menu</span><button type="button" class="rn-close" aria-label="Close menu">&times;</button></div>';
      Array.prototype.forEach.call(nav.children, function (el) {
        if (el.matches && el.matches('.nav-item-dropdown')) {
          var trigger = el.querySelector('.nav-dropdown-trigger');
          var panelLinks = Array.prototype.slice.call(el.querySelectorAll('.nav-dropdown-panel a'));
          var label = trigger ? trigger.textContent.trim() : 'More';
          var seen = {}, items = '';
          if (trigger) { seen[trigger.getAttribute('href')] = 1; items += link(trigger, 'All ' + label); }
          panelLinks.forEach(function (a) {
            var h = a.getAttribute('href');
            if (!h || seen[h]) return; seen[h] = 1; items += link(a);
          });
          html += '<details class="rn-group"><summary>' + esc(label) + '</summary>' + items + '</details>';
        } else if (el.tagName === 'A') {
          html += link(el);
        }
      });
      drawer.innerHTML = html;
    }

    function open() {
      build();
      drawer.classList.add('show'); overlay.classList.add('show');
      document.documentElement.classList.add('rn-lock');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      drawer.classList.remove('show'); overlay.classList.remove('show');
      document.documentElement.classList.remove('rn-lock');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function () { drawer.classList.contains('show') ? close() : open(); });
    overlay.addEventListener('click', close);
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('.rn-close') || e.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1100) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
