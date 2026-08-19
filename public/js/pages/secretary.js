import { api as authApi } from '../utils/api.js';

document.addEventListener('DOMContentLoaded', () => {

  const secGate = document.getElementById('secGate');
  const secDashboard = document.getElementById('secDashboard');
  const gateLoggedInActions = document.getElementById('gateLoggedInActions');
  const secGateTitle = document.getElementById('secGateTitle');
  const secGateMsg = document.getElementById('secGateMsg');
  const secGateIcon = document.getElementById('secGateIcon');
  const secGateLoginBtn = document.getElementById('secGateLoginBtn');

  /* ---------- toast ---------- */
  const toast = document.getElementById('toast');
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  /* ---------- reusable delete-confirmation popup ---------- */
  const confirmOverlay = document.getElementById('confirmModalOverlay');
  const confirmTitle = document.getElementById('confirmModalTitle');
  const confirmMsg = document.getElementById('confirmModalMsg');
  const confirmOkBtn = document.getElementById('confirmModalOk');
  const confirmCancelBtn = document.getElementById('confirmModalCancel');
  let confirmResolver = null;

  function askConfirm(title, message) {
    confirmTitle.textContent = title;
    confirmMsg.textContent = message;
    confirmOverlay.classList.add('show');
    return new Promise((resolve) => { confirmResolver = resolve; });
  }
  function closeConfirm(result) {
    confirmOverlay.classList.remove('show');
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
  }
  confirmOkBtn.addEventListener('click', () => closeConfirm(true));
  confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
  confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) closeConfirm(false); });

  /* ---------- access gate ----------
     Logging in now happens on login.html against the unified accounts
     table. This page just checks the session: only role === 'secretary'
     gets the dashboard — a resident who wanders here (or anyone signed
     out) is turned back, never shown any secretary data. */
  function showDashboard() {
    secGate.hidden = true;
    secDashboard.hidden = false;
    gateLoggedInActions.hidden = false;
    loadEverything();
  }

  function showDenied({ title, message, showLogin }) {
    secGateIcon.textContent = '🔒';
    secGateTitle.textContent = title;
    secGateMsg.textContent = message;
    secGateLoginBtn.hidden = !showLogin;
  }

  authApi('/api/auth/session')
    .then(session => {
      if (session.loggedIn && session.role === 'secretary') {
        showDashboard();
      } else if (session.loggedIn) {
        showDenied({
          title: 'Secretary access only',
          message: 'Your account is a resident account, so it can only manage your own member profile — not the full dashboard.',
          showLogin: false
        });
      } else {
        showDenied({
          title: 'Please log in',
          message: 'This dashboard is restricted to the Secretary account. Log in to continue.',
          showLogin: true
        });
      }
    })
    .catch(() => showDenied({
      title: 'Could not verify access',
      message: 'We could not reach the server to check your session. Please try again.',
      showLogin: true
    }));

  document.getElementById('secLogoutBtn').addEventListener('click', () => {
    authApi('/api/auth/logout', { method: 'POST' }).finally(() => {
      window.location.href = 'index.html';
    });
  });

  /* ---------- tabs ---------- */
  document.querySelectorAll('.sec-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sec-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sec-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.sec-tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  const rupee = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function api(path, options) {
    const res = await fetch('/api/' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (res.status === 401 || res.status === 403) {
      secDashboard.hidden = true;
      gateLoggedInActions.hidden = true;
      secGate.hidden = false;
      showDenied({
        title: 'Your session expired',
        message: 'Please log in again to continue.',
        showLogin: true
      });
      throw new Error('Session expired');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) { /* ignore */ }
      throw new Error(detail || ('Request failed (' + res.status + ')'));
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function loadEverything() {
    loadMembers();
    loadFinance();
    loadProjects();
    loadHospitals();
    loadAmbulances();
    loadStaff();
    loadMaintenance();
  }

  // Resize an image file down to a small square JPEG data URL so it's
  // reasonable to store as text in the database. Returns a Promise<string>.
  function fileToResizedDataUrl(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read image'));
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ==================== MEMBERS ==================== */
  const memberForm = document.getElementById('memberForm');
  const memberTableBody = document.getElementById('memberTableBody');
  const memberEmpty = document.getElementById('memberEmpty');
  let membersByWing = {}; // { wing: { room: [members] } }
  let currentWing = null;
  let currentRoom = null;

  const memStepWings = document.getElementById('memStepWings');
  const memStepRooms = document.getElementById('memStepRooms');
  const memStepRoom = document.getElementById('memStepRoom');
  const wingSelect = document.getElementById('wingSelect');
  const roomSelect = document.getElementById('roomSelect');
  const crumbWing = document.getElementById('memCrumbWing');
  const crumbRoom = document.getElementById('memCrumbRoom');
  const crumbSep1 = document.getElementById('memCrumbSep1');
  const crumbSep2 = document.getElementById('memCrumbSep2');

  const DEFAULT_WINGS = ['Wing A', 'Wing B', 'Wing C'];

  async function loadMembers() {
    try {
      membersByWing = await api('members/rooms');
      renderCounts();
      renderWingDropdown();
      if (currentWing && currentRoom) renderRoomView();
      else if (currentWing) renderRoomDropdown();
    } catch (err) {
      showToast('Could not load members: ' + err.message);
    }
  }

  function allMembersFlat() {
    return Object.values(membersByWing).flatMap(rooms => Object.values(rooms).flat());
  }

  function renderCounts() {
    const all = allMembersFlat();
    document.getElementById('memCountTotal').textContent = all.length;
    document.getElementById('memCountActive').textContent = all.filter(m => m.status === 'Active').length;
    document.getElementById('memCountDue').textContent = all.filter(m => m.dues === 'Dues pending').length;
  }

  function goToWings() {
    currentWing = null; currentRoom = null;
    crumbWing.hidden = true; crumbRoom.hidden = true; crumbSep1.hidden = true; crumbSep2.hidden = true;
    memStepWings.hidden = false; memStepRooms.hidden = true; memStepRoom.hidden = true;
    wingSelect.value = '';
    renderWingDropdown();
  }
  function goToRooms(wing) {
    currentWing = wing; currentRoom = null;
    crumbWing.textContent = '🏢 ' + wing; crumbWing.hidden = false; crumbSep1.hidden = false;
    crumbRoom.hidden = true; crumbSep2.hidden = true;
    memStepWings.hidden = true; memStepRooms.hidden = false; memStepRoom.hidden = true;
    roomSelect.value = '';
    renderRoomDropdown();
  }
  function goToRoom(wing, room) {
    currentWing = wing; currentRoom = room;
    crumbWing.textContent = '🏢 ' + wing; crumbWing.hidden = false; crumbSep1.hidden = false;
    crumbRoom.textContent = '🚪 Room ' + room; crumbRoom.hidden = false; crumbSep2.hidden = false;
    memStepWings.hidden = true; memStepRooms.hidden = true; memStepRoom.hidden = false;
    renderRoomView();
  }

  document.querySelector('.mem-crumb[data-level="wings"]').addEventListener('click', goToWings);
  crumbWing.addEventListener('click', () => goToRooms(currentWing));

  function renderWingDropdown() {
    const wingsPresent = Object.keys(membersByWing);
    const wings = Array.from(new Set([...DEFAULT_WINGS, ...wingsPresent]));
    const prevValue = wingSelect.value;
    wingSelect.innerHTML = '<option value="">— Choose a wing —</option>';
    wings.forEach(w => {
      const count = membersByWing[w] ? Object.values(membersByWing[w]).flat().length : 0;
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = `${w} (${count} member${count === 1 ? '' : 's'})`;
      wingSelect.appendChild(opt);
    });
    wingSelect.value = prevValue;
  }
  wingSelect.addEventListener('change', () => {
    if (wingSelect.value) goToRooms(wingSelect.value);
  });
  document.getElementById('newWingBtn').addEventListener('click', () => {
    const input = document.getElementById('newWingInput');
    const wing = input.value.trim();
    if (!wing) return;
    input.value = '';
    goToRooms(wing);
  });

  function renderRoomDropdown() {
    const rooms = currentWing && membersByWing[currentWing] ? Object.keys(membersByWing[currentWing]) : [];
    roomSelect.innerHTML = '<option value="">— Choose a room —</option>';
    rooms.forEach(r => {
      const count = membersByWing[currentWing][r].length;
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `Room ${r} (${count} member${count === 1 ? '' : 's'})`;
      roomSelect.appendChild(opt);
    });
    if (!rooms.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.disabled = true;
      opt.textContent = 'No rooms yet — add one below';
      roomSelect.appendChild(opt);
    }
  }
  roomSelect.addEventListener('change', () => {
    if (roomSelect.value) goToRoom(currentWing, roomSelect.value);
  });
  document.getElementById('newRoomBtn').addEventListener('click', () => {
    const input = document.getElementById('newRoomInput');
    const room = input.value.trim();
    if (!room) return;
    input.value = '';
    goToRoom(currentWing, room);
  });

  function maskAadhaar(a) {
    if (!a) return '—';
    const clean = String(a);
    return 'XXXX XXXX ' + clean.slice(-4);
  }
  function formatAadhaar(a) {
    const clean = String(a || '').replace(/\s+/g, '');
    return clean.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function renderRoomView() {
    const list = (currentWing && currentRoom && membersByWing[currentWing] && membersByWing[currentWing][currentRoom]) || [];
    memberTableBody.innerHTML = '';
    memberEmpty.hidden = list.length > 0;
    list.forEach(m => {
      const tr = document.createElement('tr');
      const memberId = 'BHS-' + String(m.id).padStart(4, '0');
      const photoCell = m.profile_image
        ? `<img class="mem-photo-thumb" src="${escapeHtml(m.profile_image)}" alt="">`
        : `<span class="mem-photo-thumb-fallback">👤</span>`;
      tr.innerHTML = `
        <td>${photoCell}</td>
        <td>${memberId}</td>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.email || '—')}</td>
        <td class="mem-expand-cell" data-kind="phone">
          ${escapeHtml(m.phone || '—')}
          <div class="mem-expand-drop">
            <div><strong>Phone 1:</strong> ${escapeHtml(m.phone || '—')}</div>
            <div><strong>Phone 2:</strong> ${escapeHtml(m.phone_2 || '—')}</div>
          </div>
        </td>
        <td class="mem-expand-cell" data-kind="address">
          ${escapeHtml((m.address_1 || '—').slice(0, 18))}${(m.address_1 || '').length > 18 ? '…' : ''}
          <div class="mem-expand-drop">
            <div><strong>Address 1:</strong> ${escapeHtml(m.address_1 || '—')}</div>
            <div><strong>Address 2:</strong> ${escapeHtml(m.address_2 || '—')}</div>
          </div>
        </td>
        <td class="mem-aadhaar-cell" data-full="${escapeHtml(formatAadhaar(m.aadhaar_number))}" data-masked="${escapeHtml(maskAadhaar(m.aadhaar_number))}" title="Click to reveal/hide">${escapeHtml(maskAadhaar(m.aadhaar_number))}</td>
        <td>${escapeHtml(m.occupation || '—')}${m.business ? ' · ' + escapeHtml(m.business) : ''}</td>
        <td><span class="tag ${m.status === 'Active' ? 'active' : 'inactive'}">${escapeHtml(m.status)}</span></td>
        <td><span class="tag ${m.dues === 'Dues paid' ? 'paid' : 'due'}">${escapeHtml(m.dues)}</span></td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${m.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${m.id}" title="Delete">🗑️</button>
        </td>`;
      memberTableBody.appendChild(tr);
    });
  }

  // expandable phone/address dropdown toggle
  memberTableBody.addEventListener('click', (e) => {
    const cell = e.target.closest('.mem-expand-cell');
    if (cell) {
      const wasOpen = cell.classList.contains('open');
      document.querySelectorAll('.mem-expand-cell.open').forEach(c => c.classList.remove('open'));
      if (!wasOpen) cell.classList.add('open');
      return;
    }
    const aadhaarCell = e.target.closest('.mem-aadhaar-cell');
    if (aadhaarCell) {
      const showing = aadhaarCell.dataset.revealed === '1';
      aadhaarCell.textContent = showing ? aadhaarCell.dataset.masked : aadhaarCell.dataset.full;
      aadhaarCell.dataset.revealed = showing ? '0' : '1';
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.mem-expand-cell')) {
      document.querySelectorAll('.mem-expand-cell.open').forEach(c => c.classList.remove('open'));
    }
  });

  /* ---------- member edit modal ---------- */
  const memberModalOverlay = document.getElementById('memberModalOverlay');
  const memberModalTitle = document.getElementById('memberModalTitle');
  const memPhotoPreview = document.getElementById('memPhotoPreview');
  const memPhotoPlaceholder = document.getElementById('memPhotoPlaceholder');

  function openMemberModal(member) {
    memberForm.reset();
    memPhotoPreview.hidden = true;
    memPhotoPlaceholder.hidden = false;
    if (member) {
      memberModalTitle.textContent = 'Edit member';
      document.getElementById('memberEditId').value = member.id;
      document.getElementById('memIdDisplay').value = 'BHS-' + String(member.id).padStart(4, '0');
      document.getElementById('memName').value = member.name;
      document.getElementById('memEmail').value = member.email || '';
      document.getElementById('memPhone').value = member.phone || '';
      document.getElementById('memPhone2').value = member.phone_2 || '';
      document.getElementById('memAddress1').value = member.address_1 || '';
      document.getElementById('memAddress2').value = member.address_2 || '';
      document.getElementById('memAadhaar').value = formatAadhaar(member.aadhaar_number);
      document.getElementById('memOccupation').value = member.occupation || '';
      document.getElementById('memBusiness').value = member.business || '';
      document.getElementById('memStatus').value = member.status;
      document.getElementById('memDues').value = member.dues;
      document.getElementById('memProfileImage').value = member.profile_image || '';
      if (member.profile_image) {
        memPhotoPreview.src = member.profile_image;
        memPhotoPreview.hidden = false;
        memPhotoPlaceholder.hidden = true;
      }
      document.getElementById('memWingHidden').value = member.wing;
      document.getElementById('memFlatHidden').value = member.flat;
    } else {
      memberModalTitle.textContent = 'Add member';
      document.getElementById('memberEditId').value = '';
      document.getElementById('memIdDisplay').value = '';
      document.getElementById('memWingHidden').value = currentWing || '';
      document.getElementById('memFlatHidden').value = currentRoom || '';
    }
    memberModalOverlay.classList.add('show');
    setTimeout(() => document.getElementById('memName').focus(), 50);
  }
  function closeMemberModal() {
    memberModalOverlay.classList.remove('show');
  }
  document.getElementById('memCancelBtn').addEventListener('click', closeMemberModal);
  memberModalOverlay.addEventListener('click', (e) => { if (e.target === memberModalOverlay) closeMemberModal(); });

  document.getElementById('addMemberToRoomBtn').addEventListener('click', () => {
    document.getElementById('addMemName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('addMemName').focus(), 300);
  });

  /* ---------- inline "add member" row (under the table header) ---------- */
  const addMemPhotoFile = document.getElementById('addMemPhotoFile');
  const addMemPhotoData = document.getElementById('addMemPhotoData');
  const addMemPhotoPreview = document.getElementById('addMemPhotoPreview');
  const addMemPhotoPlaceholder = document.getElementById('addMemPhotoPlaceholder');

  addMemPhotoFile.addEventListener('change', async () => {
    const file = addMemPhotoFile.files && addMemPhotoFile.files[0];
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file, 160);
      addMemPhotoData.value = dataUrl;
      addMemPhotoPreview.src = dataUrl;
      addMemPhotoPreview.hidden = false;
      addMemPhotoPlaceholder.hidden = true;
    } catch (err) {
      showToast('Could not read that image');
    }
  });

  function resetInlineAddRow() {
    ['addMemName', 'addMemEmail', 'addMemPhone1', 'addMemPhone2', 'addMemAddress1', 'addMemAddress2',
      'addMemAadhaar', 'addMemOccupation', 'addMemBusiness'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('addMemStatus').value = 'Active';
    document.getElementById('addMemDues').value = 'Dues paid';
    addMemPhotoFile.value = '';
    addMemPhotoData.value = '';
    addMemPhotoPreview.hidden = true;
    addMemPhotoPlaceholder.hidden = false;
  }

  document.getElementById('addMemSaveBtn').addEventListener('click', async () => {
    if (!currentWing || !currentRoom) {
      showToast('Choose a wing and room first');
      return;
    }
    const record = {
      name: document.getElementById('addMemName').value.trim(),
      wing: currentWing,
      flat: currentRoom,
      email: document.getElementById('addMemEmail').value.trim(),
      phone: document.getElementById('addMemPhone1').value.trim(),
      phone_2: document.getElementById('addMemPhone2').value.trim(),
      address_1: document.getElementById('addMemAddress1').value.trim(),
      address_2: document.getElementById('addMemAddress2').value.trim(),
      aadhaar_number: document.getElementById('addMemAadhaar').value.replace(/\s+/g, ''),
      occupation: document.getElementById('addMemOccupation').value.trim(),
      business: document.getElementById('addMemBusiness').value.trim(),
      profile_image: addMemPhotoData.value,
      status: document.getElementById('addMemStatus').value,
      dues: document.getElementById('addMemDues').value
    };
    const missing = ['name', 'email', 'phone', 'phone_2', 'address_1', 'address_2', 'aadhaar_number', 'occupation']
      .filter(f => !record[f]);
    if (missing.length) {
      showToast('Please fill all required fields (marked *)');
      return;
    }
    if (!/^\d{12}$/.test(record.aadhaar_number)) {
      showToast('Aadhaar number must be exactly 12 digits');
      return;
    }
    const saveBtn = document.getElementById('addMemSaveBtn');
    saveBtn.disabled = true;
    try {
      await api('members', { method: 'POST', body: JSON.stringify(record) });
      showToast('Member added');
      resetInlineAddRow();
      await loadMembers();
      goToRoom(currentWing, currentRoom);
    } catch (err) {
      showToast('Could not save member: ' + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.getElementById('memProfileImage').addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
      memPhotoPreview.src = url;
      memPhotoPreview.hidden = false;
      memPhotoPlaceholder.hidden = true;
    } else {
      memPhotoPreview.hidden = true;
      memPhotoPlaceholder.hidden = false;
    }
  });

  memberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('memberEditId').value;
    const record = {
      name: document.getElementById('memName').value.trim(),
      wing: document.getElementById('memWingHidden').value,
      flat: document.getElementById('memFlatHidden').value,
      email: document.getElementById('memEmail').value.trim(),
      phone: document.getElementById('memPhone').value.trim(),
      phone_2: document.getElementById('memPhone2').value.trim(),
      address_1: document.getElementById('memAddress1').value.trim(),
      address_2: document.getElementById('memAddress2').value.trim(),
      aadhaar_number: document.getElementById('memAadhaar').value.replace(/\s+/g, ''),
      occupation: document.getElementById('memOccupation').value.trim(),
      business: document.getElementById('memBusiness').value.trim(),
      profile_image: document.getElementById('memProfileImage').value.trim(),
      status: document.getElementById('memStatus').value,
      dues: document.getElementById('memDues').value
    };
    if (!/^\d{12}$/.test(record.aadhaar_number)) {
      showToast('Aadhaar number must be exactly 12 digits');
      return;
    }
    try {
      if (editId) {
        await api('members/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Member updated');
      } else {
        await api('members', { method: 'POST', body: JSON.stringify(record) });
        showToast('Member added');
      }
      closeMemberModal();
      currentWing = record.wing; currentRoom = record.flat;
      await loadMembers();
      goToRoom(record.wing, record.flat);
    } catch (err) {
      showToast('Could not save member: ' + err.message);
    }
  });

  memberTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const list = (currentWing && currentRoom && membersByWing[currentWing] && membersByWing[currentWing][currentRoom]) || [];
    const m = list.find(m => String(m.id) === String(id));
    if (btn.dataset.act === 'del') {
      const ok = await askConfirm('Remove this member?', m ? `"${m.name}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('members/' + id, { method: 'DELETE' });
        await loadMembers();
        showToast('Member removed');
      } catch (err) {
        showToast('Could not delete member: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      if (!m) return;
      openMemberModal(m);
    }
  });

  /* ==================== FINANCE ==================== */
  const financeForm = document.getElementById('financeForm');
  const financeTableBody = document.getElementById('financeTableBody');
  const financeEmpty = document.getElementById('financeEmpty');
  const finCancelBtn = document.getElementById('finCancelBtn');
  let finance = [];

  async function loadFinance() {
    try {
      finance = await api('finance');
      renderFinance();
    } catch (err) {
      showToast('Could not load money records: ' + err.message);
    }
  }

  function renderFinance() {
    financeTableBody.innerHTML = '';
    financeEmpty.hidden = finance.length > 0;
    let income = 0, expense = 0;
    finance.forEach(f => {
      if (f.type === 'Income') income += Number(f.amount) || 0; else expense += Number(f.amount) || 0;
      const tr = document.createElement('tr');
      const dateStr = f.entry_date ? new Date(f.entry_date).toISOString().slice(0, 10) : '—';
      tr.innerHTML = `
        <td>${escapeHtml(f.description)}</td>
        <td>${escapeHtml(f.category)}</td>
        <td><span class="tag ${f.type === 'Income' ? 'paid' : 'due'}">${escapeHtml(f.type)}</span></td>
        <td>${rupee(f.amount)}</td>
        <td>${dateStr}</td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${f.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${f.id}" title="Delete">🗑️</button>
        </td>`;
      financeTableBody.appendChild(tr);
    });
    document.getElementById('finIncomeTotal').textContent = rupee(income);
    document.getElementById('finExpenseTotal').textContent = rupee(expense);
    document.getElementById('finBalanceTotal').textContent = rupee(income - expense);
  }

  financeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('finEditId').value;
    const record = {
      description: document.getElementById('finDesc').value.trim(),
      category: document.getElementById('finCategory').value,
      type: document.getElementById('finType').value,
      amount: Number(document.getElementById('finAmount').value) || 0,
      entry_date: document.getElementById('finDate').value || null
    };
    if (!record.description || !record.amount) return;
    try {
      if (editId) {
        await api('finance/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Entry updated');
      } else {
        await api('finance', { method: 'POST', body: JSON.stringify(record) });
        showToast('Entry added');
      }
      await loadFinance();
      resetFinanceForm();
    } catch (err) {
      showToast('Could not save entry: ' + err.message);
    }
  });

  function resetFinanceForm() {
    financeForm.reset();
    document.getElementById('finEditId').value = '';
    document.getElementById('finSubmitBtn').textContent = '+ Add entry';
    finCancelBtn.hidden = true;
  }
  finCancelBtn.addEventListener('click', resetFinanceForm);

  financeTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'del') {
      const f = finance.find(f => String(f.id) === String(id));
      const ok = await askConfirm('Delete this money record?', f ? `"${f.description}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('finance/' + id, { method: 'DELETE' });
        await loadFinance();
        showToast('Entry deleted');
      } catch (err) {
        showToast('Could not delete entry: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      const f = finance.find(f => String(f.id) === String(id));
      if (!f) return;
      document.getElementById('finEditId').value = f.id;
      document.getElementById('finDesc').value = f.description;
      document.getElementById('finCategory').value = f.category;
      document.getElementById('finType').value = f.type;
      document.getElementById('finAmount').value = f.amount;
      document.getElementById('finDate').value = f.entry_date ? new Date(f.entry_date).toISOString().slice(0, 10) : '';
      document.getElementById('finSubmitBtn').textContent = 'Update entry';
      finCancelBtn.hidden = false;
      financeForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /* ==================== PROJECTS ==================== */
  const projectForm = document.getElementById('projectForm');
  const projectTableBody = document.getElementById('projectTableBody');
  const projectEmpty = document.getElementById('projectEmpty');
  const projCancelBtn = document.getElementById('projCancelBtn');
  let projects = [];

  async function loadProjects() {
    try {
      projects = await api('projects');
      renderProjects();
    } catch (err) {
      showToast('Could not load projects: ' + err.message);
    }
  }

  function renderProjects() {
    projectTableBody.innerHTML = '';
    projectEmpty.hidden = projects.length > 0;
    projects.forEach(p => {
      const statusClass = p.status === 'Ongoing' ? 'ongoing' : p.status === 'Completed' ? 'completed' : 'planned';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.owner || '—')}</td>
        <td><span class="tag ${statusClass}">${escapeHtml(p.status)}</span></td>
        <td>${rupee(p.budget)}</td>
        <td>${rupee(p.spent)}</td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${p.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${p.id}" title="Delete">🗑️</button>
        </td>`;
      projectTableBody.appendChild(tr);
    });
    document.getElementById('projCountTotal').textContent = projects.length;
    document.getElementById('projCountOngoing').textContent = projects.filter(p => p.status === 'Ongoing').length;
    document.getElementById('projCountDone').textContent = projects.filter(p => p.status === 'Completed').length;
  }

  projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('projEditId').value;
    const record = {
      title: document.getElementById('projTitle').value.trim(),
      owner: document.getElementById('projOwner').value.trim(),
      status: document.getElementById('projStatus').value,
      budget: Number(document.getElementById('projBudget').value) || 0,
      spent: Number(document.getElementById('projSpent').value) || 0
    };
    if (!record.title) return;
    try {
      if (editId) {
        await api('projects/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Project updated');
      } else {
        await api('projects', { method: 'POST', body: JSON.stringify(record) });
        showToast('Project added');
      }
      await loadProjects();
      resetProjectForm();
    } catch (err) {
      showToast('Could not save project: ' + err.message);
    }
  });

  function resetProjectForm() {
    projectForm.reset();
    document.getElementById('projEditId').value = '';
    document.getElementById('projSubmitBtn').textContent = '+ Add project';
    projCancelBtn.hidden = true;
  }
  projCancelBtn.addEventListener('click', resetProjectForm);

  projectTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'del') {
      const p = projects.find(p => String(p.id) === String(id));
      const ok = await askConfirm('Delete this project?', p ? `"${p.title}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('projects/' + id, { method: 'DELETE' });
        await loadProjects();
        showToast('Project deleted');
      } catch (err) {
        showToast('Could not delete project: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      const p = projects.find(p => String(p.id) === String(id));
      if (!p) return;
      document.getElementById('projEditId').value = p.id;
      document.getElementById('projTitle').value = p.title;
      document.getElementById('projOwner').value = p.owner || '';
      document.getElementById('projStatus').value = p.status;
      document.getElementById('projBudget').value = p.budget;
      document.getElementById('projSpent').value = p.spent;
      document.getElementById('projSubmitBtn').textContent = 'Update project';
      projCancelBtn.hidden = false;
      projectForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /* ==================== HOSPITALS ==================== */
  const hospitalForm = document.getElementById('hospitalForm');
  const hospitalTableBody = document.getElementById('hospitalTableBody');
  const hospitalEmpty = document.getElementById('hospitalEmpty');
  const hospCancelBtn = document.getElementById('hospCancelBtn');
  let hospitals = [];

  async function loadHospitals() {
    try {
      hospitals = await api('hospitals');
      renderHospitals();
    } catch (err) {
      showToast('Could not load hospitals: ' + err.message);
    }
  }

  function renderHospitals() {
    hospitalTableBody.innerHTML = '';
    hospitalEmpty.hidden = hospitals.length > 0;
    hospitals.forEach(h => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>🏥 ${escapeHtml(h.name)}</td>
        <td>${escapeHtml(h.address)}</td>
        <td>${escapeHtml(h.phone_main || '—')}</td>
        <td>${escapeHtml(h.phone_staff || '—')}</td>
        <td>${escapeHtml(h.notes || '—')}</td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${h.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${h.id}" title="Delete">🗑️</button>
        </td>`;
      hospitalTableBody.appendChild(tr);
    });
    document.getElementById('hospCountTotal').textContent = hospitals.length;
  }

  hospitalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('hospEditId').value;
    const record = {
      name: document.getElementById('hospName').value.trim(),
      address: document.getElementById('hospAddress').value.trim(),
      phone_main: document.getElementById('hospPhoneMain').value.trim(),
      phone_staff: document.getElementById('hospPhoneStaff').value.trim(),
      notes: document.getElementById('hospNotes').value.trim()
    };
    if (!record.name || !record.address) return;
    try {
      if (editId) {
        await api('hospitals/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Hospital updated');
      } else {
        await api('hospitals', { method: 'POST', body: JSON.stringify(record) });
        showToast('Hospital added');
      }
      await loadHospitals();
      resetHospitalForm();
    } catch (err) {
      showToast('Could not save hospital: ' + err.message);
    }
  });

  function resetHospitalForm() {
    hospitalForm.reset();
    document.getElementById('hospEditId').value = '';
    document.getElementById('hospSubmitBtn').textContent = '+ Add hospital';
    hospCancelBtn.hidden = true;
  }
  hospCancelBtn.addEventListener('click', resetHospitalForm);

  hospitalTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'del') {
      const h = hospitals.find(h => String(h.id) === String(id));
      const ok = await askConfirm('Remove this hospital?', h ? `"${h.name}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('hospitals/' + id, { method: 'DELETE' });
        await loadHospitals();
        showToast('Hospital removed');
      } catch (err) {
        showToast('Could not delete hospital: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      const h = hospitals.find(h => String(h.id) === String(id));
      if (!h) return;
      document.getElementById('hospEditId').value = h.id;
      document.getElementById('hospName').value = h.name;
      document.getElementById('hospAddress').value = h.address;
      document.getElementById('hospPhoneMain').value = h.phone_main || '';
      document.getElementById('hospPhoneStaff').value = h.phone_staff || '';
      document.getElementById('hospNotes').value = h.notes || '';
      document.getElementById('hospSubmitBtn').textContent = 'Update hospital';
      hospCancelBtn.hidden = false;
      hospitalForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /* ==================== AMBULANCE ==================== */
  const ambulanceForm = document.getElementById('ambulanceForm');
  const ambulanceTableBody = document.getElementById('ambulanceTableBody');
  const ambulanceEmpty = document.getElementById('ambulanceEmpty');
  const ambCancelBtn = document.getElementById('ambCancelBtn');
  let ambulances = [];

  async function loadAmbulances() {
    try {
      ambulances = await api('ambulances');
      renderAmbulances();
    } catch (err) {
      showToast('Could not load ambulance services: ' + err.message);
    }
  }

  function renderAmbulances() {
    ambulanceTableBody.innerHTML = '';
    ambulanceEmpty.hidden = ambulances.length > 0;
    ambulances.forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>🚑 ${escapeHtml(a.service_name)}</td>
        <td>${escapeHtml(a.phone)}</td>
        <td><span class="tag ${a.eta_minutes <= 10 ? 'paid' : 'due'}">${escapeHtml(String(a.eta_minutes))} min</span></td>
        <td>${escapeHtml(a.notes || '—')}</td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${a.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${a.id}" title="Delete">🗑️</button>
        </td>`;
      ambulanceTableBody.appendChild(tr);
    });
    document.getElementById('ambCountTotal').textContent = ambulances.length;
    document.getElementById('ambFastestEta').textContent = ambulances.length
      ? Math.min(...ambulances.map(a => Number(a.eta_minutes) || Infinity)) + ' min'
      : '—';
  }

  ambulanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('ambEditId').value;
    const record = {
      service_name: document.getElementById('ambName').value.trim(),
      phone: document.getElementById('ambPhone').value.trim(),
      eta_minutes: Number(document.getElementById('ambEta').value) || 0,
      notes: document.getElementById('ambNotes').value.trim()
    };
    if (!record.service_name || !record.phone) return;
    try {
      if (editId) {
        await api('ambulances/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Ambulance service updated');
      } else {
        await api('ambulances', { method: 'POST', body: JSON.stringify(record) });
        showToast('Ambulance service added');
      }
      await loadAmbulances();
      resetAmbulanceForm();
    } catch (err) {
      showToast('Could not save ambulance service: ' + err.message);
    }
  });

  function resetAmbulanceForm() {
    ambulanceForm.reset();
    document.getElementById('ambEditId').value = '';
    document.getElementById('ambSubmitBtn').textContent = '+ Add ambulance';
    ambCancelBtn.hidden = true;
  }
  ambCancelBtn.addEventListener('click', resetAmbulanceForm);

  ambulanceTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'del') {
      const a = ambulances.find(a => String(a.id) === String(id));
      const ok = await askConfirm('Remove this ambulance service?', a ? `"${a.service_name}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('ambulances/' + id, { method: 'DELETE' });
        await loadAmbulances();
        showToast('Ambulance service removed');
      } catch (err) {
        showToast('Could not delete ambulance service: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      const a = ambulances.find(a => String(a.id) === String(id));
      if (!a) return;
      document.getElementById('ambEditId').value = a.id;
      document.getElementById('ambName').value = a.service_name;
      document.getElementById('ambPhone').value = a.phone;
      document.getElementById('ambEta').value = a.eta_minutes;
      document.getElementById('ambNotes').value = a.notes || '';
      document.getElementById('ambSubmitBtn').textContent = 'Update ambulance';
      ambCancelBtn.hidden = false;
      ambulanceForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /* ==================== STAFF & VENDORS ==================== */
  const staffForm = document.getElementById('staffForm');
  const staffTableBody = document.getElementById('staffTableBody');
  const staffEmpty = document.getElementById('staffEmpty');
  const staffCancelBtn = document.getElementById('staffCancelBtn');
  let staffList = [];

  async function loadStaff() {
    try {
      staffList = await api('staff');
      renderStaff();
    } catch (err) {
      showToast('Could not load staff & vendors: ' + err.message);
    }
  }

  function renderStaff() {
    staffTableBody.innerHTML = '';
    staffEmpty.hidden = staffList.length > 0;
    staffList.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.role)}</td>
        <td>${escapeHtml(s.phone || '—')}</td>
        <td>${escapeHtml(s.address || '—')}</td>
        <td>${escapeHtml(s.id_proof || '—')}</td>
        <td><span class="tag ${s.status === 'Active' ? 'active' : 'inactive'}">${escapeHtml(s.status)}</span></td>
        <td>${escapeHtml(s.notes || '—')}</td>
        <td>
          <button class="sec-row-btn" data-act="edit" data-id="${s.id}" title="Edit">✏️</button>
          <button class="sec-row-btn danger" data-act="del" data-id="${s.id}" title="Delete">🗑️</button>
        </td>`;
      staffTableBody.appendChild(tr);
    });
    document.getElementById('staffCountTotal').textContent = staffList.length;
    document.getElementById('staffCountActive').textContent = staffList.filter(s => s.status === 'Active').length;
  }

  staffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('staffEditId').value;
    const record = {
      name: document.getElementById('staffName').value.trim(),
      role: document.getElementById('staffRole').value,
      phone: document.getElementById('staffPhone').value.trim(),
      address: document.getElementById('staffAddress').value.trim(),
      id_proof: document.getElementById('staffIdProof').value.trim(),
      status: document.getElementById('staffStatus').value,
      notes: document.getElementById('staffNotes').value.trim()
    };
    if (!record.name || !record.phone) return;
    try {
      if (editId) {
        await api('staff/' + editId, { method: 'PUT', body: JSON.stringify(record) });
        showToast('Staff/vendor updated');
      } else {
        await api('staff', { method: 'POST', body: JSON.stringify(record) });
        showToast('Staff/vendor added');
      }
      await loadStaff();
      resetStaffForm();
    } catch (err) {
      showToast('Could not save staff/vendor: ' + err.message);
    }
  });

  function resetStaffForm() {
    staffForm.reset();
    document.getElementById('staffEditId').value = '';
    document.getElementById('staffStatus').value = 'Active';
    document.getElementById('staffSubmitBtn').textContent = '+ Add staff / vendor';
    staffCancelBtn.hidden = true;
  }
  staffCancelBtn.addEventListener('click', resetStaffForm);

  staffTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sec-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'del') {
      const s = staffList.find(s => String(s.id) === String(id));
      const ok = await askConfirm('Remove this staff/vendor?', s ? `"${s.name}" will be permanently deleted from the database. This can't be undone.` : 'This will be permanently deleted from the database.');
      if (!ok) return;
      try {
        await api('staff/' + id, { method: 'DELETE' });
        await loadStaff();
        showToast('Staff/vendor removed');
      } catch (err) {
        showToast('Could not delete staff/vendor: ' + err.message);
      }
    } else if (btn.dataset.act === 'edit') {
      const s = staffList.find(s => String(s.id) === String(id));
      if (!s) return;
      document.getElementById('staffEditId').value = s.id;
      document.getElementById('staffName').value = s.name;
      document.getElementById('staffRole').value = s.role;
      document.getElementById('staffPhone').value = s.phone || '';
      document.getElementById('staffAddress').value = s.address || '';
      document.getElementById('staffIdProof').value = s.id_proof || '';
      document.getElementById('staffStatus').value = s.status;
      document.getElementById('staffNotes').value = s.notes || '';
      document.getElementById('staffSubmitBtn').textContent = 'Update staff / vendor';
      staffCancelBtn.hidden = false;
      staffForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /* ==================== MAINTENANCE ==================== */
  const maintMonthPicker = document.getElementById('maintMonthPicker');
  const maintenanceTableBody = document.getElementById('maintenanceTableBody');
  const maintenanceEmpty = document.getElementById('maintenanceEmpty');
  let maintenanceRows = [];

  function currentMonthStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  maintMonthPicker.value = currentMonthStr();

  async function loadMaintenance() {
    try {
      maintenanceRows = await api('maintenance?month=' + encodeURIComponent(maintMonthPicker.value));
      renderMaintenance();
    } catch (err) {
      showToast('Could not load maintenance records: ' + err.message);
    }
  }
  maintMonthPicker.addEventListener('change', loadMaintenance);

  function renderMaintenance() {
    maintenanceTableBody.innerHTML = '';
    maintenanceEmpty.hidden = maintenanceRows.length > 0;
    let paid = 0, unpaid = 0, collected = 0;
    maintenanceRows.forEach(r => {
      if (r.status === 'Paid') { paid++; collected += Number(r.amount) || 0; } else { unpaid++; }
      const photoCell = r.profile_image
        ? `<img class="mem-photo-thumb" src="${escapeHtml(r.profile_image)}" alt="">`
        : `<span class="mem-photo-thumb-fallback">👤</span>`;
      const screenshotCellHtml = r.screenshot
        ? `<img class="maint-screenshot-thumb" src="${escapeHtml(r.screenshot)}" alt="Payment screenshot" data-act="view-screenshot">`
        : `<span class="maint-screenshot-none">No screenshot</span>`;
      const tr = document.createElement('tr');
      tr.dataset.memberId = r.member_id;
      tr.innerHTML = `
        <td>${photoCell}</td>
        <td class="maint-name-cell">${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.wing)} / Room ${escapeHtml(r.flat)}</td>
        <td><input type="number" class="maint-amount-input" min="0" value="${Number(r.amount) || 0}"></td>
        <td>
          <select class="maint-status-select">
            <option ${r.status === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
            <option ${r.status === 'Paid' ? 'selected' : ''}>Paid</option>
          </select>
        </td>
        <td>
          <div class="maint-screenshot-cell" data-current="${r.screenshot ? escapeHtml(r.screenshot) : ''}">
            <div class="maint-screenshot-preview">${screenshotCellHtml}</div>
            <input type="file" class="maint-screenshot-file" accept="image/*" ${r.status === 'Paid' ? '' : 'hidden'}>
          </div>
        </td>
        <td><button class="btn btn-primary btn-sm maint-save-btn" type="button">Save</button></td>`;
      maintenanceTableBody.appendChild(tr);
    });
    document.getElementById('maintCountTotal').textContent = maintenanceRows.length;
    document.getElementById('maintCountPaid').textContent = paid;
    document.getElementById('maintCountUnpaid').textContent = unpaid;
    document.getElementById('maintCollected').textContent = rupee(collected);
  }

  // Toggle the screenshot upload field when Paid/Unpaid changes
  maintenanceTableBody.addEventListener('change', (e) => {
    if (e.target.classList.contains('maint-status-select')) {
      const tr = e.target.closest('tr');
      const fileInput = tr.querySelector('.maint-screenshot-file');
      fileInput.hidden = e.target.value !== 'Paid';
    }
  });

  // View a payment screenshot full-size in a new tab
  maintenanceTableBody.addEventListener('click', (e) => {
    const thumb = e.target.closest('[data-act="view-screenshot"]');
    if (!thumb) return;
    const win = window.open();
    if (win) win.document.write(`<img src="${thumb.src}" style="max-width:100%;">`);
  });

  maintenanceTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.maint-save-btn');
    if (!btn) return;
    const tr = btn.closest('tr');
    const memberId = tr.dataset.memberId;
    const amount = Number(tr.querySelector('.maint-amount-input').value) || 0;
    const status = tr.querySelector('.maint-status-select').value;
    const screenshotCell = tr.querySelector('.maint-screenshot-cell');
    const fileInput = tr.querySelector('.maint-screenshot-file');
    let screenshot = screenshotCell.dataset.current || null;

    btn.disabled = true;
    try {
      const file = fileInput.files && fileInput.files[0];
      if (status === 'Paid' && file) {
        screenshot = await fileToResizedDataUrl(file, 640);
      } else if (status === 'Unpaid') {
        screenshot = null; // clear proof if marked unpaid
      }
      await api('maintenance', {
        method: 'POST',
        body: JSON.stringify({ member_id: memberId, month: maintMonthPicker.value, amount, status, screenshot })
      });
      showToast('Maintenance record saved');
      await loadMaintenance();
    } catch (err) {
      showToast('Could not save maintenance record: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* close confirm modal with Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeConfirm(false);
  });

});