// The "View Details" popup: a small step-based directory (menu -> wing ->
// room -> members, or list -> item) shared by the homepage. Member
// records are permission-gated — see loadMemberProfile() below, which is
// the piece that stops one resident from opening another resident's
// details.

import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/dom.js';
import { api } from '../utils/api.js';

export function initDetailsPopup({ session }) {
  const overlay = document.getElementById('detailsPopupOverlay');
  const title = document.getElementById('detailsPopupTitle');
  const menu = document.getElementById('detailsPopupMenu');
  const body = document.getElementById('detailsPopupBody');
  const content = document.getElementById('detailsPopupContent');
  const back = document.getElementById('detailsPopupBack');
  const closeBtn = document.getElementById('detailsPopupClose');
  const triggerBtn = document.getElementById('viewDetailsBtn');
  const maintenanceTriggerBtn = document.getElementById('viewMaintenanceBtn');
  if (!overlay || !triggerBtn) return;

  let stack = [];

  function showMenuStep() {
    title.textContent = 'Directory';
    menu.hidden = false;
    body.hidden = true;
  }
  function goToStep(fn) { stack.push(fn); fn(); }
  function goBack() {
    stack.pop();
    const prev = stack[stack.length - 1];
    if (prev) prev(); else showMenuStep();
  }
  function open() {
    stack = [];
    overlay.classList.remove('popup-wide');
    showMenuStep();
    overlay.classList.add('show');
  }
  function close() { overlay.classList.remove('show'); }

  triggerBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  back.addEventListener('click', goBack);

  // "Maintenance" in the hamburger menu jumps straight into the popup's
  // maintenance step, skipping the top-level directory menu. That step
  // shows richer cards (photo, amount, receipt screenshot) so the popup
  // opens in a wider layout than the plain directory menu.
  if (maintenanceTriggerBtn) {
    maintenanceTriggerBtn.addEventListener('click', () => {
      stack = [];
      overlay.classList.add('show', 'popup-wide');
      goToStep(stepMaintenanceWings);
    });
  }

  /* ===== Lightbox: full-size payment screenshot viewer ===== */
  let lightbox = null;
  function openLightbox(src) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'maint-lightbox';
      lightbox.innerHTML = `<button class="maint-lightbox-close" aria-label="Close">${icon('close', 18)}</button><img alt="Payment screenshot">`;
      lightbox.addEventListener('click', e => {
        if (e.target === lightbox || e.target.closest('.maint-lightbox-close')) lightbox.classList.remove('show');
      });
      document.body.appendChild(lightbox);
    }
    lightbox.querySelector('img').src = src;
    lightbox.classList.add('show');
  }

  function renderListButtons(items) {
    content.innerHTML = items.map((it, i) =>
      `<button class="list-tile" data-i="${i}">
         <span class="list-tile-icon">${it.iconSvg}</span>
         <span class="list-tile-label">${escapeHtml(it.label)}</span>
         <span class="list-tile-arrow">${icon('chevronLeft', 16)}</span>
       </button>`
    ).join('');
    content.querySelectorAll('.list-tile').forEach(btn => {
      btn.addEventListener('click', () => items[Number(btn.dataset.i)].onClick());
    });
  }

  /* ===== Members: wing -> room -> members in that room -> profile ===== */
  let membersCache = null;

  async function stepMembersWings() {
    title.textContent = 'Members — select wing';
    menu.hidden = true; body.hidden = false;
    content.innerHTML = '<p class="popup-status">Loading…</p>';
    try {
      if (!membersCache) membersCache = await api('/api/public/members');
      const wings = [...new Set(membersCache.map(m => m.wing))].sort();
      if (!wings.length) return content.innerHTML = '<p class="popup-status">No members added yet.</p>';
      renderListButtons(wings.map(w => ({
        iconSvg: icon('building'), label: w, onClick: () => goToStep(() => stepMembersRooms(w))
      })));
    } catch (err) {
      content.innerHTML = '<p class="popup-status popup-status-error">Could not load members. Please try again.</p>';
    }
  }

  function stepMembersRooms(wing) {
    title.textContent = wing + ' — select room';
    menu.hidden = true; body.hidden = false;
    const rooms = [...new Set(membersCache.filter(m => m.wing === wing).map(m => m.flat))].sort();
    if (!rooms.length) return content.innerHTML = '<p class="popup-status">No rooms found in this wing.</p>';
    renderListButtons(rooms.map(r => ({
      iconSvg: icon('door'), label: 'Room ' + r, onClick: () => goToStep(() => stepMembersList(wing, r))
    })));
  }

  function stepMembersList(wing, room) {
    title.textContent = wing + ' · Room ' + room;
    menu.hidden = true; body.hidden = false;
    const list = membersCache.filter(m => m.wing === wing && m.flat === room);
    if (!list.length) return content.innerHTML = '<p class="popup-status">No members in this room.</p>';
    content.innerHTML = list.map(m => {
      const photo = m.profile_image
        ? `<img class="member-avatar" src="${escapeHtml(m.profile_image)}" alt="">`
        : `<span class="member-avatar member-avatar-fallback">${escapeHtml(initials(m.name))}</span>`;
      return `<button class="member-row" data-id="${m.id}">
        ${photo}
        <span class="member-row-body">
          <span class="member-row-name">${escapeHtml(m.name)}</span>
          <span class="tag ${m.status === 'Active' ? 'active' : 'inactive'}">${escapeHtml(m.status)}</span>
        </span>
        <span class="list-tile-arrow">${icon('chevronLeft', 16)}</span>
      </button>`;
    }).join('');
    content.querySelectorAll('.member-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => goToStep(() => stepMemberProfile(Number(rowEl.dataset.id))));
    });
  }

  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '—';
  }

  // This is the permission-gated step: what shows here depends entirely
  // on who is logged in, never on what was clicked.
  async function stepMemberProfile(memberId) {
    title.textContent = 'Member profile';
    menu.hidden = true; body.hidden = false;
    const s = await session();

    if (!s.loggedIn) {
      content.innerHTML = `
        <div class="access-note">
          <span class="access-note-icon">${icon('lock', 22)}</span>
          <p>Log in to view full contact details for society members.</p>
          <div class="access-note-actions">
            <a class="btn btn-primary btn-sm" href="login.html">Log in</a>
            <a class="btn btn-outline btn-sm" href="signup.html">Sign up</a>
          </div>
        </div>`;
      return;
    }

    if (s.role !== 'secretary' && String(s.memberId) !== String(memberId)) {
      content.innerHTML = `
        <div class="access-note">
          <span class="access-note-icon">${icon('shield', 22)}</span>
          <p>You can only view your own member profile.</p>
        </div>`;
      return;
    }

    content.innerHTML = '<p class="popup-status">Loading…</p>';
    try {
      const m = await api(`/api/members/${memberId}/profile`);
      const photo = m.profile_image
        ? `<img class="member-avatar member-avatar-lg" src="${escapeHtml(m.profile_image)}" alt="">`
        : `<span class="member-avatar member-avatar-lg member-avatar-fallback">${escapeHtml(initials(m.name))}</span>`;
      content.innerHTML = `
        <div class="profile-card">
          ${photo}
          <div class="profile-card-body">
            <h4>${escapeHtml(m.name)}</h4>
            <span class="tag ${m.status === 'Active' ? 'active' : 'inactive'}">${escapeHtml(m.status)}</span>
            <dl class="profile-detail-list">
              <div><dt>${icon('building', 15)} Wing / Flat</dt><dd>${escapeHtml(m.wing)}, ${escapeHtml(m.flat)}</dd></div>
              <div><dt>${icon('phone', 15)} Phone</dt><dd>${escapeHtml(m.phone || '—')}</dd></div>
              <div><dt>${icon('phone', 15)} Alternate</dt><dd>${escapeHtml(m.phone_2 || '—')}</dd></div>
              <div><dt>${icon('mail', 15)} Email</dt><dd>${escapeHtml(m.email || '—')}</dd></div>
              <div><dt>${icon('note', 15)} Address</dt><dd>${escapeHtml(m.address_1 || '—')}</dd></div>
              <div><dt>${icon('note', 15)} Occupation</dt><dd>${escapeHtml(m.occupation || '—')}</dd></div>
              <div><dt>${icon('note', 15)} Maintenance dues</dt><dd>${escapeHtml(m.dues || '—')}</dd></div>
            </dl>
          </div>
        </div>`;
    } catch (err) {
      content.innerHTML = '<p class="popup-status popup-status-error">Could not load this profile. Please try again.</p>';
    }
  }

  /* ===== Hospitals: list -> full detail (public, no login required) ===== */
  let hospitalsCache = null;

  async function stepHospitalsList() {
    title.textContent = 'Hospitals';
    menu.hidden = true; body.hidden = false;
    content.innerHTML = '<p class="popup-status">Loading…</p>';
    try {
      if (!hospitalsCache) hospitalsCache = await api('/api/public/hospitals');
      if (!hospitalsCache.length) return content.innerHTML = '<p class="popup-status">No hospitals added yet.</p>';
      renderListButtons(hospitalsCache.map(h => ({
        iconSvg: icon('hospital'), label: h.name, onClick: () => goToStep(() => stepHospitalDetail(h.id))
      })));
    } catch (err) {
      content.innerHTML = '<p class="popup-status popup-status-error">Could not load hospitals. Please try again.</p>';
    }
  }

  function stepHospitalDetail(id) {
    const h = hospitalsCache.find(x => String(x.id) === String(id));
    if (!h) return;
    title.textContent = h.name;
    menu.hidden = true; body.hidden = false;
    content.innerHTML = `
      <div class="profile-card">
        <span class="member-avatar member-avatar-lg member-avatar-fallback">${icon('hospital', 22)}</span>
        <div class="profile-card-body">
          <h4>${escapeHtml(h.name)}</h4>
          <dl class="profile-detail-list">
            <div><dt>${icon('note', 15)} Address</dt><dd>${escapeHtml(h.address || '—')}</dd></div>
            <div><dt>${icon('phone', 15)} Main line</dt><dd>${escapeHtml(h.phone_main || '—')}</dd></div>
            <div><dt>${icon('phone', 15)} Staff / on-call</dt><dd>${escapeHtml(h.phone_staff || '—')}</dd></div>
            ${h.notes ? `<div><dt>${icon('note', 15)} Notes</dt><dd>${escapeHtml(h.notes)}</dd></div>` : ''}
          </dl>
        </div>
      </div>`;
  }

  /* ===== Ambulance: list -> full detail (public, no login required) ===== */
  let ambulancesCache = null;

  async function stepAmbulancesList() {
    title.textContent = 'Ambulance services';
    menu.hidden = true; body.hidden = false;
    content.innerHTML = '<p class="popup-status">Loading…</p>';
    try {
      if (!ambulancesCache) ambulancesCache = await api('/api/public/ambulances');
      if (!ambulancesCache.length) return content.innerHTML = '<p class="popup-status">No ambulance services added yet.</p>';
      renderListButtons(ambulancesCache.map(a => ({
        iconSvg: icon('ambulance'), label: a.service_name, onClick: () => goToStep(() => stepAmbulanceDetail(a.id))
      })));
    } catch (err) {
      content.innerHTML = '<p class="popup-status popup-status-error">Could not load ambulance services. Please try again.</p>';
    }
  }

  function stepAmbulanceDetail(id) {
    const a = ambulancesCache.find(x => String(x.id) === String(id));
    if (!a) return;
    title.textContent = a.service_name;
    menu.hidden = true; body.hidden = false;
    content.innerHTML = `
      <div class="profile-card">
        <span class="member-avatar member-avatar-lg member-avatar-fallback">${icon('ambulance', 22)}</span>
        <div class="profile-card-body">
          <h4>${escapeHtml(a.service_name)}</h4>
          <dl class="profile-detail-list">
            <div><dt>${icon('phone', 15)} Phone</dt><dd>${escapeHtml(a.phone || '—')}</dd></div>
            <div><dt>${icon('clock', 15)} ETA</dt><dd>${escapeHtml(String(a.eta_minutes))} min</dd></div>
            ${a.notes ? `<div><dt>${icon('note', 15)} Notes</dt><dd>${escapeHtml(a.notes)}</dd></div>` : ''}
          </dl>
        </div>
      </div>`;
  }

  /* ===== Maintenance: members the Secretary chose to feature here =====
     Bridged from the Secretary Dashboard via localStorage — that
     dashboard already has the data client-side when the Secretary
     selects rows, and this page has no Secretary session to query the
     protected /api/maintenance endpoint directly.
     One room = one featured member, enforced on the Secretary side, so
     the Wing -> Room flow below always renders a single card per room. */
  function getMaintenanceSelection() {
    try { return JSON.parse(localStorage.getItem('secMaintenanceSelection') || '[]'); }
    catch (e) { return []; }
  }

  function stepMaintenanceWings() {
    title.textContent = 'Maintenance — select wing';
    menu.hidden = true; body.hidden = false;

    const selected = getMaintenanceSelection();
    if (!selected.length) {
      content.innerHTML = `
        <div class="access-note">
          <span class="access-note-icon">${icon('receipt', 22)}</span>
          <p>No members are featured here yet. The Secretary can select members from the Maintenance tab and choose “Feature on public dashboard”.</p>
        </div>`;
      return;
    }

    const wings = [...new Set(selected.map(r => r.wing))].sort();
    content.innerHTML = `<div class="maint-wing-grid"></div>`;
    const grid = content.querySelector('.maint-wing-grid');
    wings.forEach(w => {
      const roomsInWing = selected.filter(r => r.wing === w);
      const paidCount = roomsInWing.filter(r => r.status === 'Paid').length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'maint-wing-tile';
      btn.innerHTML = `
        <span class="maint-wing-tile-icon">${icon('building', 20)}</span>
        <span class="maint-wing-tile-label">${escapeHtml(w)}</span>
        <span class="maint-wing-tile-sub">${roomsInWing.length} room${roomsInWing.length === 1 ? '' : 's'} featured</span>
        <span class="maint-wing-tile-progress"><span style="width:${roomsInWing.length ? (paidCount / roomsInWing.length * 100) : 0}%"></span></span>
        <span class="maint-wing-tile-foot">${paidCount}/${roomsInWing.length} paid ${icon('chevronLeft', 14)}</span>`;
      btn.addEventListener('click', () => goToStep(() => stepMaintenanceWingRooms(w)));
      grid.appendChild(btn);
    });
  }

  function stepMaintenanceWingRooms(wing) {
    title.textContent = wing + ' — Maintenance';
    menu.hidden = true; body.hidden = false;

    const selected = getMaintenanceSelection().filter(r => r.wing === wing)
      .sort((a, b) => String(a.flat).localeCompare(String(b.flat)));
    if (!selected.length) {
      content.innerHTML = '<p class="popup-status">No featured members in this wing.</p>';
      return;
    }

    content.innerHTML = selected.map((r, i) => {
      const paid = r.status === 'Paid';
      const photo = r.profile_image
        ? `<img class="member-avatar" src="${escapeHtml(r.profile_image)}" alt="">`
        : `<span class="member-avatar member-avatar-fallback">${escapeHtml(initials(r.name))}</span>`;
      const screenshotHtml = paid && r.screenshot
        ? `<button type="button" class="maint-card-receipt" data-i="${i}">
             <img src="${escapeHtml(r.screenshot)}" alt="Payment receipt">
             <span>${icon('camera', 13)} View receipt</span>
           </button>`
        : (paid ? `<p class="maint-card-no-receipt">No receipt uploaded yet.</p>` : '');
      return `
        <div class="maint-card">
          <div class="maint-card-top">
            ${photo}
            <span class="member-row-body">
              <span class="member-row-name">Room ${escapeHtml(r.flat)} — ${escapeHtml(r.name)}</span>
              <span class="tag ${paid ? 'paid' : 'due'}">${paid ? 'Paid' : 'Unpaid'}${r.month ? ' · ' + escapeHtml(r.month) : ''}</span>
            </span>
            <span class="maint-popup-amount">₹${(Number(r.amount) || 0).toLocaleString('en-IN')}</span>
          </div>
          ${screenshotHtml}
        </div>`;
    }).join('');

    content.querySelectorAll('.maint-card-receipt').forEach(btn => {
      btn.addEventListener('click', () => openLightbox(selected[Number(btn.dataset.i)].screenshot));
    });
  }

  const ENTRY_STEP = {
    members: stepMembersWings,
    ambulance: stepAmbulancesList,
    hospital: stepHospitalsList
  };
  menu.querySelectorAll('.details-popup-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn = ENTRY_STEP[btn.dataset.view];
      if (fn) goToStep(fn);
    });
  });

  // Icons for the top-level menu (replaces the old emoji spans).
  menu.querySelectorAll('.details-popup-option').forEach(btn => {
    const iconSlot = btn.querySelector('.details-popup-option-icon');
    if (!iconSlot) return;
    const map = { members: 'user', ambulance: 'ambulance', hospital: 'hospital' };
    iconSlot.innerHTML = icon(map[btn.dataset.view] || 'note', 20);
  });
}