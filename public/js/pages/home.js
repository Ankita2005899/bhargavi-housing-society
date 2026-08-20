import { initAccountMenu, getSession } from '../components/accountMenu.js';
import { initDetailsPopup } from '../components/detailsPopup.js';

document.addEventListener('DOMContentLoaded', async () => {

  /* ---------- require login before the homepage itself is shown ----------
     Visitors must sign up / log in first; only once that's done does the
     original site UI open. Anyone not logged in is sent to login.html
     straight away (their intended page is remembered so they land back
     here right after logging in). */
  const session = await getSession(true);
  if (!session.loggedIn) {
    const next = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    window.location.replace(`login.html?next=${next}`);
    return;
  }
  document.body.classList.remove('site-gate-pending');

  /* ---------- live site edits: assign stable keys + restore any saved edits ---------- */
  const EDIT_STORAGE_KEY = 'bhsSiteEdits';

  function assignEditKeys() {
    document.querySelectorAll('main h1, main h2, main h3, main h4, main p, main li, footer p').forEach((el, i) => {
      if (el.closest('.modal-overlay, form, .edit-toolbar')) return;
      if (!el.textContent.trim()) return;
      if (!el.dataset.editKey) el.dataset.editKey = 'text-' + i;
    });
    document.querySelectorAll('main img, footer img').forEach((el, i) => {
      if (el.closest('.modal-overlay')) return;
      if (!el.dataset.editKey) el.dataset.editKey = 'img-' + i;
    });
  }

  function applySavedEdits() {
    let edits = {};
    try { edits = JSON.parse(localStorage.getItem(EDIT_STORAGE_KEY) || '{}'); } catch (e) { edits = {}; }
    Object.keys(edits).forEach(key => {
      const el = document.querySelector(`[data-edit-key="${key}"]`);
      if (!el) return;
      if (edits[key].type === 'text') el.innerHTML = edits[key].value;
      else if (edits[key].type === 'img') el.src = edits[key].value;
    });
  }

  assignEditKeys();
  applySavedEdits();

  /* ---------- preloader ---------- */
  const preloader = document.getElementById('preloader');
  window.addEventListener('load', () => {
    setTimeout(() => preloader.classList.add('hide'), 350);
  });
  setTimeout(() => preloader && preloader.classList.add('hide'), 1800);

  /* ---------- footer year ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- header shrink on scroll + scroll-top button ---------- */
  const header = document.getElementById('siteHeader');
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    header.style.boxShadow = y > 10 ? '0 6px 20px rgba(0,0,0,.18)' : 'none';
    if (scrollTopBtn) scrollTopBtn.classList.toggle('show', y > 600);
  });
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));

  /* ---------- animated stat counters ---------- */
  const statEls = document.querySelectorAll('[data-count]');
  const statIO = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        statIO.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  statEls.forEach(el => statIO.observe(el));

  function animateCount(el) {
    const target = parseInt(el.getAttribute('data-count'), 10);
    const duration = 1400;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- hamburger slide menu ---------- */
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const slideMenu = document.getElementById('slideMenu');
  const menuOverlay = document.getElementById('menuOverlay');
  const closeMenuBtn = document.getElementById('closeMenuBtn');

  function openMenu() {
    slideMenu.classList.add('show');
    menuOverlay.classList.add('show');
  }
  function closeMenu() {
    slideMenu.classList.remove('show');
    menuOverlay.classList.remove('show');
  }
  hamburgerBtn.addEventListener('click', openMenu);
  closeMenuBtn.addEventListener('click', closeMenu);
  menuOverlay.addEventListener('click', closeMenu);
  slideMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  /* ---------- account state (login/signup vs. logged-in pill) ---------- */
  initAccountMenu();

  /* ---------- "View Details" popup (public directory + gated profiles) ---------- */
  initDetailsPopup({ session: getSession });

  // Keep the homepage "Committee members" stat in sync with the real
  // member list stored in the database, instead of a hardcoded number.
  const committeeMemberCountEl = document.getElementById('committeeMemberCount');
  if (committeeMemberCountEl) {
    fetch('/api/members/count')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && typeof data.count === 'number') {
          committeeMemberCountEl.setAttribute('data-count', data.count);
        }
      })
      .catch(() => { /* fall back to the default data-count already on the element */ });
  }

  /* ---- top-right: "Website Dashboard" — re-enter the site in a live-editing mode ---- */
  const reentryFlash = document.getElementById('reentryFlash');
  const editToolbar = document.getElementById('editToolbar');
  const editImageInput = document.getElementById('editImageInput');
  let editModeOn = false;
  let pendingImageEl = null;

  const editableTextEls = () => document.querySelectorAll('[data-edit-key^="text-"]');
  const editableImgEls = () => document.querySelectorAll('[data-edit-key^="img-"]');

  function enterEditMode() {
    editModeOn = true;
    document.body.classList.add('site-edit-mode');
    editableTextEls().forEach(el => el.setAttribute('contenteditable', 'true'));
    editToolbar.classList.add('show');
  }

  function exitEditMode() {
    editModeOn = false;
    document.body.classList.remove('site-edit-mode');
    editableTextEls().forEach(el => el.removeAttribute('contenteditable'));
    editToolbar.classList.remove('show');
  }

  // Reached via the "Website (edit mode)" button on the Secretary Dashboard
  // page (secretary.html?edit=1 -> index.html?edit=1).
  if (new URLSearchParams(window.location.search).get('edit') === '1') {
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    reentryFlash.classList.add('show');
    setTimeout(() => reentryFlash.classList.remove('show'), 280);

    const glowTargets = document.querySelectorAll('.site-header, .ticker-bar, .hero, .section, .site-footer');
    glowTargets.forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('glow-pulse');
        setTimeout(() => el.classList.remove('glow-pulse'), 800);
      }, i * 70);
    });

    setTimeout(() => {
      enterEditMode();
      showToast('Editing mode on — click any highlighted text or photo to edit it');
    }, 300);
  }

  /* click a highlighted photo (in edit mode) to replace it */
  document.addEventListener('click', (e) => {
    if (!editModeOn) return;
    const img = e.target.closest('[data-edit-key^="img-"]');
    if (img) {
      e.preventDefault();
      pendingImageEl = img;
      editImageInput.click();
    }
  });

  editImageInput.addEventListener('change', () => {
    const file = editImageInput.files && editImageInput.files[0];
    if (!file || !pendingImageEl) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingImageEl.src = reader.result;
      showToast('Photo updated — click "Save & show" to keep it');
    };
    reader.readAsDataURL(file);
    editImageInput.value = '';
  });

  /* save all current text + photo edits so they show even after exiting edit mode */
  document.getElementById('saveEditsBtn').addEventListener('click', () => {
    const edits = {};
    editableTextEls().forEach(el => { edits[el.dataset.editKey] = { type: 'text', value: el.innerHTML }; });
    editableImgEls().forEach(el => { edits[el.dataset.editKey] = { type: 'img', value: el.src }; });
    try {
      localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(edits));
      showToast('Changes saved — now visible on the website');
    } catch (err) {
      showToast('Could not save — one of the new photos may be too large');
    }
  });

  document.getElementById('exitEditBtn').addEventListener('click', () => {
    exitEditMode();
    showToast('Editing mode off');
  });

  /* ---------- meeting popup ---------- */
  const meetingPopupOverlay = document.getElementById('meetingPopupOverlay');
  const meetingPopupClose = document.getElementById('meetingPopupClose');
  const meetingPopupClose2 = document.getElementById('meetingPopupClose2');

  function openMeetingPopup() { meetingPopupOverlay.classList.add('show'); }
  function closeMeetingPopup() { meetingPopupOverlay.classList.remove('show'); }

  ['openMeetingPopupBtn', 'openMeetingPopupBtn2'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', openMeetingPopup);
  });
  meetingPopupClose.addEventListener('click', closeMeetingPopup);
  meetingPopupClose2.addEventListener('click', closeMeetingPopup);
  meetingPopupOverlay.addEventListener('click', (e) => { if (e.target === meetingPopupOverlay) closeMeetingPopup(); });

  // Auto-show the scheduled meeting popup shortly after arriving at the dashboard
  let meetingShown = false;
  const dashboardSection = document.getElementById('dashboard');
  const dashIO = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !meetingShown) {
        meetingShown = true;
        setTimeout(openMeetingPopup, 900);
        dashIO.disconnect();
      }
    });
  }, { threshold: 0.5 });
  if (dashboardSection) dashIO.observe(dashboardSection);

  /* close any modal with Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMeetingPopup();
      closeMenu();
      const detailsOverlay = document.getElementById('detailsPopupOverlay');
      if (detailsOverlay) detailsOverlay.classList.remove('show');
    }
  });

  /* ---------- left rail slider ---------- */
  const railTrack = document.getElementById('railTrack');
  const railDotsWrap = document.getElementById('railDots');
  if (railTrack) {
    const slides = railTrack.querySelectorAll('.rail-slide');
    slides.forEach((_, i) => {
      const dot = document.createElement('span');
      if (i === 0) dot.classList.add('active');
      dot.addEventListener('click', () => goToSlide(i));
      railDotsWrap.appendChild(dot);
    });
    let current = 0;
    function goToSlide(i) {
      current = i;
      railTrack.style.transform = `translateX(-${i * 100}%)`;
      railDotsWrap.querySelectorAll('span').forEach((d, idx) => d.classList.toggle('active', idx === i));
    }
    setInterval(() => {
      current = (current + 1) % slides.length;
      goToSlide(current);
    }, 4200);
  }

  /* ---------- rail quick-action toasts ---------- */
  const toast = document.getElementById('toast');
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  document.querySelectorAll('.rail-btn[data-toast]').forEach(btn => {
    btn.addEventListener('click', () => showToast(btn.getAttribute('data-toast')));
  });

  /* ---------- events filter ---------- */
  const chips = document.querySelectorAll('.filter-chip');
  const eventCards = document.querySelectorAll('.event-card');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter');
      eventCards.forEach(card => {
        const match = filter === 'all' || card.getAttribute('data-cat') === filter;
        card.classList.toggle('hidden', !match);
      });
    });
  });

});
