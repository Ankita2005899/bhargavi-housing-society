/*
 * quick-actions.js
 * The five "Quick actions" buttons on the home page (left rail):
 *   Pay Maintenance · Raise a Complaint · Book Community Hall · Visitor Gate Pass · Resident Directory
 *
 * Who sees what
 *   - Residents and visitors (logged in or not): the NORMAL panel only — the features a resident uses.
 *   - Secretary session: the NORMAL panel *and* the DETAILED panel side by side
 *     (with a switch to view either one on its own). The detailed panel is the management view:
 *     dues collection, complaint handling, hall approvals, gate-pass check-in/out, full member records.
 *
 * Security note: hiding the detailed panel here is only presentation. Every Secretary-only
 * endpoint it calls is also protected on the server (requireSecretary), so a resident cannot
 * reach that data even by calling the API directly.
 */
(function () {
  'use strict';

  /* ================================================================ helpers */
  var S = { session: { loggedIn: false }, settings: {}, me: null, key: null, isSec: false };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }
  function rupee(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function monthStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function plusDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function parseDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s); }
  function fmtDate(s) { return s ? parseDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function fmtTime(s) { return s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''; }
  function monthLabel(m) { return new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
  function monthShort(m) { return new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); }
  function sound(n) { if (window.BHSSound) window.BHSSound.play(n); }
  function formObj(f) { var o = {}; new FormData(f).forEach(function (v, k) { o[k] = v; }); return o; }
  function safeImg(u) { return /^(data:image\/|https?:\/\/|\/|images\/)/.test(String(u || '')) ? u : ''; }

  var CHIP = {
    Paid: 'green', Unpaid: 'red', Open: 'red', 'In Progress': 'amber', Resolved: 'green', Rejected: 'grey',
    Pending: 'amber', Approved: 'green', Cancelled: 'grey', Active: 'blue', 'Checked In': 'amber',
    'Checked Out': 'green', Urgent: 'red', High: 'amber', Normal: 'blue', Low: 'grey'
  };
  function chip(s) { return '<span class="qa-chip qa-chip-' + (CHIP[s] || 'grey') + '">' + esc(s) + '</span>'; }
  function note(html, kind) { return '<div class="qa-note qa-note-' + (kind || 'info') + '">' + html + '</div>'; }
  function loadingHtml() { return '<div class="qa-loading"><span></span><span></span><span></span></div>'; }
  function loginPrompt(msg) {
    return '<div class="qa-login"><div class="qa-login-ic">🔒</div><p>' + esc(msg) + '</p>' +
      '<a class="btn btn-primary btn-sm" href="login.html">Log in</a> <a class="btn btn-outline btn-sm" href="signup.html">Sign up</a></div>';
  }
  function tile(label, value, tone) {
    return '<div class="qa-tile' + (tone ? ' qa-tile-' + tone : '') + '"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
  }

  // Event delegation that survives re-rendering: handlers are looked up at click time.
  function bind(el, acts) {
    el._acts = acts;
    if (el._bound) return;
    el._bound = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || b.disabled) return;
      var fn = el._acts[b.getAttribute('data-act')];
      if (fn) { e.preventDefault(); fn(b, e); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target.closest('form[data-submit]');
      if (!f) return;
      e.preventDefault();
      var fn = el._acts[f.getAttribute('data-submit')];
      if (fn) fn(f, e);
    });
    el.addEventListener('change', function (e) {
      var t = e.target.closest('[data-change]');
      if (!t) return;
      var fn = el._acts[t.getAttribute('data-change')];
      if (fn) fn(t, e);
    });
    el.addEventListener('input', function (e) {
      var t = e.target.closest('[data-input]');
      if (!t) return;
      var fn = el._acts[t.getAttribute('data-input')];
      if (fn) fn(t, e);
    });
  }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('#qaToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'qa-toast qa-show' + (kind === 'error' ? ' qa-toast-err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('qa-show'); }, 3200);
    sound(kind === 'error' ? 'error' : 'success');
  }
  function fail(err) { toast(err && err.message ? err.message : 'Something went wrong.', 'error'); }

  /* ================================================================ styles */
  function injectStyles() {
    if ($('#qaStyles')) return;
    var css = [
      '.qa-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(14,27,50,.6);backdrop-filter:blur(4px);opacity:0;visibility:hidden;transition:opacity .22s ease,visibility .22s ease}',
      '.qa-overlay.qa-show{opacity:1;visibility:visible}',
      '.qa-panel{position:relative;width:min(1240px,100%);max-height:94vh;display:flex;flex-direction:column;background:var(--paper,#F6F5F1);border-radius:22px;overflow:hidden;box-shadow:0 30px 80px -10px rgba(14,27,50,.55);transform:translateY(16px) scale(.98);transition:transform .25s cubic-bezier(.22,.85,.32,1)}',
      '.qa-overlay.qa-show .qa-panel{transform:none}',
      '.qa-head{display:flex;align-items:center;gap:1rem;padding:1rem 1.3rem;background:linear-gradient(135deg,#0E1B32,#1B3A6B);color:#fff;border-bottom:4px solid var(--gold-500,#D9A441)}',
      '.qa-head-ic{flex:0 0 3rem;height:3rem;border-radius:14px;background:rgba(255,255,255,.14);display:grid;place-items:center;font-size:1.6rem}',
      '.qa-head-txt{flex:1;min-width:0}',
      '.qa-head-txt h3{margin:0;font-size:1.3rem;color:#fff;line-height:1.2}',
      '.qa-head-txt p{margin:.15rem 0 0;font-size:.85rem;color:#C9D6EA}',
      '.qa-role{font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:.3em .8em;border-radius:999px;background:rgba(255,255,255,.15);color:#fff;white-space:nowrap}',
      '.qa-role.qa-role-sec{background:var(--gold-500,#D9A441);color:#0E1B32}',
      '.qa-close{width:2.4rem;height:2.4rem;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:1.5rem;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}',
      '.qa-close:hover{background:rgba(255,255,255,.3)}',
      '.qa-seg{display:flex;gap:.35rem;padding:.7rem 1.3rem 0;flex-wrap:wrap}',
      '.qa-seg[hidden]{display:none}',
      '.qa-seg button{border:1.5px solid var(--line,#E2E1D9);background:#fff;color:var(--ink-600,#4A5468);border-radius:999px;padding:.38em 1em;font-size:.85rem;font-weight:600;cursor:pointer}',
      '.qa-seg button.qa-on{background:#0E1B32;border-color:#0E1B32;color:#fff}',
      '.qa-body{overflow-y:auto;padding:1rem 1.3rem 1.4rem;flex:1}',
      '.qa-grid{display:grid;gap:1.2rem;grid-template-columns:1fr;align-items:start}',
      '.qa-grid[data-mode="both"]{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)}',
      '.qa-grid[data-mode="res"]{max-width:780px;margin:0 auto;width:100%}',
      '.qa-grid[data-mode="sec"]{max-width:980px;margin:0 auto;width:100%}',
      '.qa-grid[data-mode="res"] .qa-col-sec,.qa-grid[data-mode="sec"] .qa-col-res{display:none}',
      '@media (max-width:1000px){.qa-grid[data-mode="both"]{grid-template-columns:1fr}.qa-panel{max-height:97vh;border-radius:16px}.qa-head{padding:.8rem 1rem}}',
      '.qa-col{background:#fff;border:1px solid var(--line,#E2E1D9);border-radius:16px;padding:1rem 1.1rem 1.2rem;min-width:0}',
      '.qa-col-sec{border-top:5px solid var(--gold-500,#D9A441)}',
      '.qa-col-res{border-top:5px solid #4E8FC7}',
      '.qa-col-title{display:flex;align-items:center;gap:.6rem;margin:0 0 .9rem;font-size:1.05rem;color:#0E1B32}',
      '.qa-tag{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:.25em .7em;border-radius:999px;background:#E7F0F9;color:#1B3A6B}',
      '.qa-col-sec .qa-tag{background:#FBF1DC;color:#8A6B1F}',
      '.qa-h{margin:1.1rem 0 .5rem;font-size:.82rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--diya-700,#A5411F)}',
      '.qa-h:first-child{margin-top:0}',
      '.qa-note{border-radius:12px;padding:.7rem .9rem;font-size:.9rem;line-height:1.5;margin:.6rem 0}',
      '.qa-note-info{background:#E7F0F9;color:#1B3A6B}.qa-note-warn{background:#FBF1DC;color:#7A5A12}.qa-note-err{background:#FBE9E3;color:#9A2B10}.qa-note-ok{background:#E4F2E7;color:#1F6B3A}',
      '.qa-login{text-align:center;padding:1.4rem .5rem}.qa-login-ic{font-size:2rem}.qa-login p{margin:.4rem 0 1rem;color:var(--ink-600,#4A5468)}',
      '.qa-loading{display:flex;gap:.4rem;justify-content:center;padding:1.6rem}.qa-loading span{width:9px;height:9px;border-radius:50%;background:var(--gold-500,#D9A441);animation:qaBounce 1s infinite ease-in-out}.qa-loading span:nth-child(2){animation-delay:.15s}.qa-loading span:nth-child(3){animation-delay:.3s}',
      '@keyframes qaBounce{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}',
      '.qa-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:.6rem;margin:.2rem 0 .9rem}',
      '.qa-tile{background:var(--paper,#F6F5F1);border:1px solid var(--line,#E2E1D9);border-left:4px solid #4E8FC7;border-radius:12px;padding:.6rem .75rem}',
      '.qa-tile strong{display:block;font-size:1.35rem;line-height:1.1;color:#0E1B32}.qa-tile span{font-size:.76rem;color:var(--ink-600,#4A5468)}',
      '.qa-tile-green{border-left-color:#2E8B57}.qa-tile-red{border-left-color:#C1522C}.qa-tile-amber{border-left-color:#D9A441}',
      '.qa-bar{height:10px;border-radius:999px;background:#E9E7DF;overflow:hidden;margin:.3rem 0 .2rem}.qa-bar i{display:block;height:100%;background:linear-gradient(90deg,#2E8B57,#5FA377);border-radius:999px;transition:width .5s ease}',
      '.qa-muted{color:var(--ink-400,#7C8598);font-size:.82rem}',
      '.qa-chip{display:inline-block;font-size:.72rem;font-weight:700;padding:.18em .7em;border-radius:999px;white-space:nowrap}',
      '.qa-chip-green{background:#E4F2E7;color:#1F6B3A}.qa-chip-red{background:#FBE9E3;color:#A5411F}.qa-chip-amber{background:#FBF1DC;color:#8A6B1F}.qa-chip-blue{background:#E7F0F9;color:#1B3A6B}.qa-chip-grey{background:#ECEDF1;color:#4A5468}',
      '.qa-form{display:grid;gap:.65rem;margin:.4rem 0 .4rem}',
      '.qa-row2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}@media (max-width:520px){.qa-row2{grid-template-columns:1fr}}',
      '.qa-field label{display:block;font-size:.78rem;font-weight:700;color:var(--ink-600,#4A5468);margin-bottom:.2rem}',
      '.qa-field input,.qa-field select,.qa-field textarea,.qa-inline input,.qa-inline select{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E2E1D9);border-radius:10px;padding:.5rem .65rem;font-size:.92rem;background:#fff;color:var(--ink-900,#1B2130)}',
      '.qa-field textarea{min-height:70px;resize:vertical}',
      '.qa-field input:focus,.qa-field select:focus,.qa-field textarea:focus,.qa-inline input:focus,.qa-inline select:focus{outline:none;border-color:var(--diya-600,#C1522C);box-shadow:0 0 0 3px rgba(193,82,44,.12)}',
      '.qa-inline{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:.3rem 0 .6rem}.qa-inline input,.qa-inline select{width:auto;flex:1 1 130px;min-width:0}',
      '.qa-btn{border:1.5px solid #1B3A6B;background:#fff;color:#1B3A6B;border-radius:999px;padding:.5em 1.1em;font-size:.88rem;font-weight:700;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}',
      '.qa-btn:hover{background:#E7F0F9}.qa-btn:active{transform:scale(.97)}.qa-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.qa-btn-primary{background:var(--diya-600,#C1522C);border-color:var(--diya-600,#C1522C);color:#fff;box-shadow:0 6px 16px rgba(193,82,44,.25)}.qa-btn-primary:hover{background:var(--diya-700,#A5411F)}',
      '.qa-btn-ok{background:#2E8B57;border-color:#2E8B57;color:#fff}.qa-btn-ok:hover{background:#25724A}',
      '.qa-btn-danger{border-color:#C1522C;color:#C1522C}.qa-btn-danger:hover{background:#FBE9E3}',
      '.qa-btn-sm{padding:.3em .85em;font-size:.8rem}',
      '.qa-chipbtn{border:1.5px solid var(--line,#E2E1D9);background:#fff;border-radius:999px;padding:.25em .85em;font-size:.8rem;font-weight:600;color:var(--ink-600,#4A5468);cursor:pointer}',
      '.qa-chipbtn.qa-on{background:#0E1B32;border-color:#0E1B32;color:#fff}',
      '.qa-chips{display:flex;gap:.35rem;flex-wrap:wrap;margin:.3rem 0 .6rem}',
      '.qa-list{display:flex;flex-direction:column;gap:.55rem}',
      '.qa-scroll{max-height:340px;overflow-y:auto;padding-right:.2rem}',
      '.qa-item{border:1px solid var(--line,#E2E1D9);border-left:4px solid #4E8FC7;border-radius:12px;padding:.65rem .8rem;background:#fff}',
      '.qa-item.qa-sev-red{border-left-color:#C1522C}.qa-item.qa-sev-amber{border-left-color:#D9A441}.qa-item.qa-sev-green{border-left-color:#2E8B57}.qa-item.qa-sev-grey{border-left-color:#B8BCC8}',
      '.qa-item-top{display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start;flex-wrap:wrap}',
      '.qa-item-top strong{font-size:.98rem;color:#0E1B32}',
      '.qa-item p{margin:.25rem 0 0;font-size:.88rem;color:var(--ink-600,#4A5468);line-height:1.45}',
      '.qa-item .qa-meta{font-size:.78rem;color:var(--ink-400,#7C8598);margin-top:.2rem}',
      '.qa-reply{margin-top:.45rem;background:#F1F6FB;border-radius:10px;padding:.45rem .65rem;font-size:.86rem;color:#1B3A6B}',
      '.qa-actions{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem;align-items:center}',
      '.qa-actions input,.qa-actions select{border:1.5px solid var(--line,#E2E1D9);border-radius:10px;padding:.35rem .55rem;font-size:.85rem;flex:1 1 140px;min-width:0}',
      '.qa-dues{display:flex;align-items:center;gap:.7rem;padding:.5rem .1rem;border-bottom:1px dashed var(--line,#E2E1D9);font-size:.92rem}.qa-dues:last-child{border-bottom:none}',
      '.qa-dues b{flex:1;color:#0E1B32}.qa-dues span.amt{min-width:4.5rem;text-align:right}',
      '.qa-pay{background:linear-gradient(135deg,#FBF1DC,#fff);border:1.5px solid var(--gold-500,#D9A441);border-radius:14px;padding:.8rem 1rem;margin:.6rem 0}',
      '.qa-pay dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.25rem .8rem;font-size:.92rem}.qa-pay dt{color:var(--ink-600,#4A5468);font-weight:700}.qa-pay dd{margin:0;word-break:break-word;white-space:pre-wrap}',
      '.qa-steps{margin:.3rem 0 0;padding-left:1.2rem;font-size:.9rem;color:var(--ink-600,#4A5468);line-height:1.6}',
      '.qa-table-wrap{overflow-x:auto;border:1px solid var(--line,#E2E1D9);border-radius:12px}',
      '.qa-table{width:100%;border-collapse:collapse;font-size:.86rem}.qa-table th{background:#0E1B32;color:#fff;text-align:left;padding:.5rem .65rem;font-size:.74rem;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}.qa-table td{padding:.5rem .65rem;border-top:1px solid var(--line,#E2E1D9);vertical-align:middle}.qa-table tr:nth-child(even) td{background:#FAF9F5}',
      '.qa-room{display:flex;align-items:center;gap:.6rem;padding:.45rem .1rem;border-bottom:1px solid var(--line,#E2E1D9);font-size:.9rem}.qa-room:last-child{border-bottom:none}.qa-room .qa-room-main{flex:1;min-width:0}.qa-room .qa-room-main strong{display:block;color:#0E1B32}.qa-room .qa-room-main span{font-size:.78rem;color:var(--ink-400,#7C8598)}',
      '.qa-cal{margin:.4rem 0 .8rem;max-width:460px}.qa-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem}.qa-cal-head strong{color:#0E1B32}',
      '.qa-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.qa-cal-dow{font-size:.68rem;text-align:center;color:var(--ink-400,#7C8598);font-weight:700;padding:.15rem 0}',
      '.qa-day{aspect-ratio:1/.85;border:1.5px solid var(--line,#E2E1D9);border-radius:8px;background:#fff;font-size:.84rem;font-weight:600;color:#0E1B32;cursor:pointer;padding:0;position:relative}',
      '.qa-day:hover:not(:disabled){border-color:var(--diya-600,#C1522C)}.qa-day:disabled{opacity:.35;cursor:not-allowed}',
      '.qa-day.qa-half{background:linear-gradient(135deg,#fff 50%,#FBE3B8 50%)}.qa-day.qa-full{background:#F4C9BB;border-color:#E3A18D;color:#8A2B12}.qa-day.qa-pick{outline:3px solid #1B3A6B;outline-offset:1px}.qa-day.qa-today{border-color:#4E8FC7}',
      '.qa-legend{display:flex;gap:.9rem;flex-wrap:wrap;font-size:.76rem;color:var(--ink-600,#4A5468);margin-top:.35rem}.qa-legend i{display:inline-block;width:.8rem;height:.8rem;border-radius:3px;margin-right:.3rem;vertical-align:-1px;border:1px solid var(--line,#E2E1D9)}',
      '.qa-code{font-family:"Courier New",monospace !important;font-size:1.35rem;font-weight:800;letter-spacing:.18em;color:#0E1B32;background:#FBF1DC;border:1.5px dashed var(--gold-600,#C08A2A);border-radius:10px;padding:.2rem .7rem;display:inline-block}',
      '.qa-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.55rem}',
      '.qa-person{display:flex;align-items:center;gap:.6rem;border:1px solid var(--line,#E2E1D9);border-radius:12px;padding:.5rem .65rem;background:#fff}',
      '.qa-av{flex:0 0 2.4rem;height:2.4rem;border-radius:50%;background:#E7F0F9;color:#1B3A6B;font-weight:800;display:grid;place-items:center;overflow:hidden}.qa-av img{width:100%;height:100%;object-fit:cover}',
      '.qa-person strong{display:block;font-size:.9rem;color:#0E1B32;line-height:1.2}.qa-person span{font-size:.76rem;color:var(--ink-400,#7C8598)}',
      '.qa-emerg{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.5rem}.qa-emerg a{display:block;text-decoration:none;border:1px solid #F0C9BC;background:#FFF6F2;border-radius:12px;padding:.5rem .7rem;color:#8A2B12;font-size:.84rem}.qa-emerg a strong{display:block;color:#0E1B32;font-size:.88rem}',
      '.qa-details{border:1px dashed var(--line,#E2E1D9);border-radius:12px;padding:.5rem .8rem;margin-top:.9rem;background:#FCFBF8}.qa-details summary{cursor:pointer;font-weight:700;font-size:.88rem;color:#0E1B32}',
      '.qa-link{display:inline-block;margin-top:.7rem;font-size:.86rem;font-weight:700;color:var(--diya-700,#A5411F);text-decoration:none}.qa-link:hover{text-decoration:underline}',
      '.qa-toast{position:absolute;left:50%;bottom:1.4rem;transform:translateX(-50%) translateY(20px);background:#0E1B32;color:#fff;padding:.7em 1.3em;border-radius:999px;font-size:.88rem;box-shadow:0 12px 30px rgba(0,0,0,.3);opacity:0;visibility:hidden;transition:all .25s ease;max-width:90%;text-align:center;z-index:5}',
      '.qa-toast.qa-show{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}.qa-toast-err{background:#9A2B10}',
      '@media (prefers-reduced-motion:reduce){.qa-overlay,.qa-panel,.qa-bar i{transition:none}.qa-loading span{animation:none}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'qaStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ============================================================ shared UI bits */
  // Who is this action being done for? Residents: their own flat. Secretary: pick one.
  function identityHtml() {
    if (!S.session.loggedIn) return '';
    if (S.session.role === 'secretary' && !S.session.memberId) {
      return note('You are logged in as Secretary, so choose which resident you are acting for.', 'info') +
        '<div class="qa-row2"><div class="qa-field"><label>Wing</label><select name="wing" required><option value="">Select wing</option><option>Wing A</option><option>Wing B</option><option>Wing C</option></select></div>' +
        '<div class="qa-field"><label>Flat</label><input name="flat" required maxlength="20" placeholder="e.g. 101"></div></div>' +
        '<div class="qa-field"><label>Resident name (optional)</label><input name="on_behalf_of" maxlength="80" placeholder="Name of the resident"></div>';
    }
    if (S.me) return '<div class="qa-muted">Posting as <b>' + esc(S.me.name) + '</b> · ' + esc(S.me.wing) + ' ' + esc(S.me.flat) + '</div>';
    return '';
  }

  // Editable society settings (UPI, hall fee ...) — Secretary only.
  function settingsCard(title, fields, onSaved) {
    var rows = fields.map(function (f) {
      var val = esc(S.settings[f.key] || '');
      var input = f.area
        ? '<textarea name="' + f.key + '" maxlength="1000" placeholder="' + esc(f.ph || '') + '">' + val + '</textarea>'
        : '<input name="' + f.key + '" type="' + (f.type || 'text') + '" value="' + val + '" maxlength="300" placeholder="' + esc(f.ph || '') + '">';
      return '<div class="qa-field"><label>' + esc(f.label) + '</label>' + input + '</div>';
    }).join('');
    return '<details class="qa-details"><summary>' + esc(title) + '</summary>' +
      '<form class="qa-form" data-submit="saveSettings">' + rows +
      '<div><button class="qa-btn qa-btn-primary qa-btn-sm" type="submit">Save</button></div></form></details>';
  }
  async function saveSettings(form, after) {
    try {
      var body = formObj(form);
      await api('/api/settings', { method: 'PUT', body: body });
      Object.keys(body).forEach(function (k) { S.settings[k] = body[k]; });
      toast('Settings saved.');
      if (after) after();
    } catch (e) { fail(e); }
  }

  /* ================================================================ MODULE: Maintenance */
  var SM = { month: monthStr(new Date()), filter: 'unpaid', wing: 'all', q: '', rooms: [] };

  async function resMaintenance(el) {
    if (!S.session.loggedIn) { el.innerHTML = note('Pay your society maintenance in a few steps. Log in to see your flat\'s dues.') + loginPrompt('Log in to see your dues and payment details.'); return; }
    el.innerHTML = loadingHtml();
    var data;
    try { data = await api('/api/maintenance/mine'); }
    catch (e) {
      el.innerHTML = S.isSec
        ? note('The Secretary account is not linked to a flat, so there are no personal dues to show here. Use the Secretary view for society-wide collection.', 'info')
        : note(esc(e.message), 'warn');
      return;
    }
    var cur = monthStr(new Date());
    var hist = data.history || [];
    var thisMonth = hist.filter(function (h) { return h.month === cur; })[0];
    var unpaid = hist.filter(function (h) { return h.status !== 'Paid' && Number(h.amount) > 0; });
    var owe = unpaid.reduce(function (s, h) { return s + Number(h.amount); }, 0);
    var cfg = S.settings;

    var html = '<div class="qa-tiles">' +
      tile('Your flat', data.wing + ' · ' + data.flat) +
      tile(monthShort(cur), thisMonth ? thisMonth.status : 'Not updated', thisMonth ? (thisMonth.status === 'Paid' ? 'green' : 'red') : 'amber') +
      tile('Outstanding', owe ? rupee(owe) : 'Nil', owe ? 'red' : 'green') + '</div>';

    html += '<div class="qa-h">Last months</div>';
    html += hist.length ? hist.map(function (h) {
      return '<div class="qa-dues"><b>' + esc(monthShort(h.month)) + '</b><span class="amt">' + (Number(h.amount) ? rupee(h.amount) : '—') + '</span>' + chip(h.status) + '</div>';
    }).join('') : note('No maintenance records have been entered for your flat yet.', 'info');

    html += '<div class="qa-h">How to pay</div><div class="qa-pay">';
    var hasPay = cfg.upi_id || cfg.bank_details || cfg.maintenance_amount;
    if (hasPay) {
      html += '<dl>';
      if (cfg.payee_name) html += '<dt>Pay to</dt><dd>' + esc(cfg.payee_name) + '</dd>';
      if (cfg.maintenance_amount) html += '<dt>Monthly</dt><dd>' + rupee(cfg.maintenance_amount) + (cfg.maintenance_due_day ? ' · due by the ' + esc(cfg.maintenance_due_day) + ' of each month' : '') + '</dd>';
      if (cfg.upi_id) html += '<dt>UPI ID</dt><dd>' + esc(cfg.upi_id) + ' <button class="qa-btn qa-btn-sm" data-act="copyUpi">Copy</button></dd>';
      if (cfg.bank_details) html += '<dt>Bank</dt><dd>' + esc(cfg.bank_details) + '</dd>';
      html += '</dl>';
    } else {
      html += '<span class="qa-muted">The Secretary has not published payment details yet. Please ask at the society office.</span>';
    }
    html += '</div><ol class="qa-steps"><li>Pay using the details above and keep the receipt or transaction reference.</li><li>Share the receipt with the Secretary.</li><li>Once it is verified, your month is marked <b>Paid</b> here.</li></ol>';
    el.innerHTML = html;
    bind(el, { copyUpi: function () { navigator.clipboard && navigator.clipboard.writeText(cfg.upi_id).then(function () { toast('UPI ID copied.'); }); } });
  }

  async function secMaintenance(el) {
    el.innerHTML = loadingHtml();
    try { SM.rooms = await api('/api/maintenance?month=' + SM.month); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
    drawSecMaintenance(el);
  }
  function drawSecMaintenance(el) {
    var rooms = SM.rooms;
    var paid = rooms.filter(function (r) { return r.status === 'Paid'; });
    var collected = paid.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    var pct = rooms.length ? Math.round(paid.length * 100 / rooms.length) : 0;
    var wings = {};
    rooms.forEach(function (r) { var w = wings[r.wing] = wings[r.wing] || { n: 0, paid: 0 }; w.n++; if (r.status === 'Paid') w.paid++; });
    var shown = rooms.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
      if (SM.filter === 'unpaid' && x.r.status === 'Paid') return false;
      if (SM.filter === 'paid' && x.r.status !== 'Paid') return false;
      if (SM.wing !== 'all' && x.r.wing !== SM.wing) return false;
      if (SM.q && (x.r.wing + ' ' + x.r.flat + ' ' + (x.r.members[0] ? x.r.members[0].name : '')).toLowerCase().indexOf(SM.q) < 0) return false;
      return true;
    });

    var html = '<div class="qa-inline"><label class="qa-muted" for="qaMonth">Month</label><input id="qaMonth" type="month" value="' + SM.month + '" data-change="month"></div>';
    html += '<div class="qa-tiles">' + tile('Flats', rooms.length) + tile('Paid', paid.length, 'green') + tile('Unpaid', rooms.length - paid.length, 'red') + tile('Collected', rupee(collected), 'green') + '</div>';
    html += '<div class="qa-bar"><i style="width:' + pct + '%"></i></div><div class="qa-muted">' + pct + '% of flats have paid for ' + esc(monthLabel(SM.month)) + '</div>';

    html += '<div class="qa-h">Wing-wise</div><div class="qa-table-wrap"><table class="qa-table"><tr><th>Wing</th><th>Flats</th><th>Paid</th><th>Unpaid</th></tr>' +
      Object.keys(wings).sort().map(function (w) { return '<tr><td>' + esc(w) + '</td><td>' + wings[w].n + '</td><td>' + wings[w].paid + '</td><td>' + (wings[w].n - wings[w].paid) + '</td></tr>'; }).join('') + '</table></div>';

    html += '<div class="qa-h">Flats</div><div class="qa-chips">' +
      ['unpaid', 'paid', 'all'].map(function (f) { return '<button class="qa-chipbtn' + (SM.filter === f ? ' qa-on' : '') + '" data-act="filter" data-v="' + f + '">' + f[0].toUpperCase() + f.slice(1) + '</button>'; }).join('') + '</div>';
    html += '<div class="qa-inline"><select data-change="wing"><option value="all">All wings</option>' +
      Object.keys(wings).sort().map(function (w) { return '<option' + (SM.wing === w ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select>' +
      '<input type="search" placeholder="Search flat or name" value="' + esc(SM.q) + '" data-input="search"></div>';
    html += '<div class="qa-scroll">' + (shown.length ? shown.map(function (x) {
      var r = x.r, rep = r.members.filter(function (m) { return m.id === r.representative_member_id; })[0] || r.members[0];
      return '<div class="qa-room"><div class="qa-room-main"><strong>' + esc(r.wing) + ' · ' + esc(r.flat) + '</strong><span>' + esc(rep ? rep.name : 'No resident') + (r.amount ? ' · ' + rupee(r.amount) : '') + '</span></div>' + chip(r.status) +
        '<button class="qa-btn qa-btn-sm ' + (r.status === 'Paid' ? '' : 'qa-btn-ok') + '" data-act="toggle" data-i="' + x.i + '">' + (r.status === 'Paid' ? 'Mark unpaid' : 'Mark paid') + '</button></div>';
    }).join('') : '<div class="qa-muted" style="padding:.8rem">Nothing to show for this filter.</div>') + '</div>';
    html += '<div class="qa-actions"><button class="qa-btn qa-btn-sm" data-act="copyList">Copy reminder list (unpaid)</button></div>';
    html += settingsCard('Payment details shown to residents', [
      { key: 'payee_name', label: 'Pay to (name)', ph: 'Bhargavi Housing Society' },
      { key: 'maintenance_amount', label: 'Monthly maintenance (₹)', type: 'number', ph: 'e.g. 2500' },
      { key: 'maintenance_due_day', label: 'Due day of month', type: 'number', ph: 'e.g. 10' },
      { key: 'upi_id', label: 'UPI ID', ph: 'name@bank' },
      { key: 'bank_details', label: 'Bank account details', area: true, ph: 'Account name, number, IFSC' }
    ]);
    html += '<a class="qa-link" href="secretary.html#maintenance">Open the full Maintenance tab →</a>';
    el.innerHTML = html;

    bind(el, {
      month: function (t) { if (t.value) { SM.month = t.value; secMaintenance(el); } },
      filter: function (b) { SM.filter = b.getAttribute('data-v'); drawSecMaintenance(el); },
      wing: function (t) { SM.wing = t.value; drawSecMaintenance(el); },
      search: function (t) { SM.q = t.value.trim().toLowerCase(); var pos = t.selectionStart; drawSecMaintenance(el); var n = $('input[type=search]', el); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
      toggle: async function (b) {
        var r = SM.rooms[Number(b.getAttribute('data-i'))], makePaid = r.status !== 'Paid', amt = r.amount > 0 ? r.amount : Number(S.settings.maintenance_amount) || 0;
        if (makePaid && !amt) {
          var v = window.prompt('Amount received from ' + r.wing + ' · ' + r.flat + ' (₹)');
          if (v === null) return;
          amt = Number(v);
          if (!(amt > 0)) { toast('Please enter a valid amount.', 'error'); return; }
        }
        b.disabled = true;
        try {
          await api('/api/maintenance', { method: 'POST', body: { wing: r.wing, flat: r.flat, month: SM.month, amount: makePaid ? amt : r.amount, status: makePaid ? 'Paid' : 'Unpaid', screenshot: r.screenshot, representative_member_id: r.representative_member_id } });
          toast(r.wing + ' · ' + r.flat + (makePaid ? ' marked paid.' : ' marked unpaid.'));
          refresh('both');
        } catch (e) { fail(e); b.disabled = false; }
      },
      copyList: function () {
        var by = {};
        SM.rooms.filter(function (r) { return r.status !== 'Paid'; }).forEach(function (r) { (by[r.wing] = by[r.wing] || []).push(r.flat); });
        var txt = 'Maintenance pending for ' + monthLabel(SM.month) + ':\n' + Object.keys(by).sort().map(function (w) { return w + ': ' + by[w].join(', '); }).join('\n');
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Reminder list copied.'); });
      },
      saveSettings: function (f) { saveSettings(f, function () { refresh('res'); }); }
    });
  }

  /* ================================================================ MODULE: Complaints */
  var CATS = ['Plumbing', 'Electrical', 'Lift', 'Water supply', 'Security', 'Cleaning', 'Parking', 'Noise', 'Other'];
  var SC = { filter: 'active', cat: 'all', wing: 'all', data: null };
  function sevOf(c) { return c.status === 'Resolved' ? 'green' : c.status === 'Rejected' ? 'grey' : (c.priority === 'Urgent' || c.priority === 'High') ? 'red' : 'amber'; }

  async function resComplaint(el) {
    if (!S.session.loggedIn) { el.innerHTML = note('Report a problem in your building — lift, water, electrical, security and more. The Secretary\'s office tracks every complaint.') + loginPrompt('Log in to raise a complaint and track its progress.'); return; }
    var mine = [];
    try { mine = await api('/api/complaints/mine'); } catch (e) { /* show form anyway */ }
    var html = '<div class="qa-h">New complaint</div><form class="qa-form" data-submit="create">' + identityHtml() +
      '<div class="qa-row2"><div class="qa-field"><label>Category</label><select name="category">' + CATS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="qa-field"><label>Priority</label><select name="priority"><option>Normal</option><option>Low</option><option>High</option><option>Urgent</option></select></div></div>' +
      '<div class="qa-field"><label>Title</label><input name="title" required minlength="3" maxlength="120" placeholder="e.g. Lift not working in Wing A"></div>' +
      '<div class="qa-field"><label>Details</label><textarea name="description" maxlength="2000" placeholder="Where is it, since when, anything the technician should know"></textarea></div>' +
      '<div><button class="qa-btn qa-btn-primary" type="submit">Submit complaint</button></div></form>';
    html += '<div class="qa-h">Your complaints</div>';
    html += mine.length ? '<div class="qa-list">' + mine.map(function (c) {
      return '<div class="qa-item qa-sev-' + sevOf(c) + '"><div class="qa-item-top"><strong>' + esc(c.title) + '</strong>' + chip(c.status) + '</div>' +
        '<div class="qa-meta">' + esc(c.category) + ' · ' + esc(c.priority) + ' priority · ' + fmtDate(c.created_at) + '</div>' +
        (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        (c.secretary_reply ? '<div class="qa-reply"><b>Secretary:</b> ' + esc(c.secretary_reply) + '</div>' : '') + '</div>';
    }).join('') + '</div>' : (S.isSec && !S.session.memberId ? note('Complaints you log for residents appear in the Secretary view.', 'info') : '<div class="qa-muted">You have not raised any complaints.</div>');
    el.innerHTML = html;
    bind(el, {
      create: async function (f) {
        var btn = $('button[type=submit]', f); btn.disabled = true;
        try { await api('/api/complaints', { method: 'POST', body: formObj(f) }); toast('Complaint submitted. The Secretary will review it.'); refresh('both'); }
        catch (e) { fail(e); btn.disabled = false; }
      }
    });
  }

  async function secComplaint(el) {
    if (!SC.data) el.innerHTML = loadingHtml();
    try { SC.data = await api('/api/complaints'); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
    drawSecComplaint(el);
  }
  function drawSecComplaint(el) {
    var d = SC.data, st = d.stats;
    var avg = st.avg_resolution_hours == null ? '—' : (Number(st.avg_resolution_hours) >= 48 ? (st.avg_resolution_hours / 24).toFixed(1) + ' days' : st.avg_resolution_hours + ' hrs');
    var items = d.items.filter(function (c) {
      if (SC.filter === 'active' && !(c.status === 'Open' || c.status === 'In Progress')) return false;
      if (SC.filter !== 'active' && SC.filter !== 'all' && c.status !== SC.filter) return false;
      if (SC.cat !== 'all' && c.category !== SC.cat) return false;
      if (SC.wing !== 'all' && c.wing !== SC.wing) return false;
      return true;
    });
    var html = '<div class="qa-tiles">' + tile('Open', st.open, 'red') + tile('In progress', st.in_progress, 'amber') + tile('Resolved', st.resolved, 'green') + tile('Urgent open', st.urgent_open, st.urgent_open ? 'red' : '') + tile('Avg. fix time', avg) + '</div>';
    html += '<div class="qa-chips">' + [['active', 'Needs action'], ['all', 'All'], ['Resolved', 'Resolved'], ['Rejected', 'Rejected']].map(function (f) { return '<button class="qa-chipbtn' + (SC.filter === f[0] ? ' qa-on' : '') + '" data-act="filter" data-v="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>';
    html += '<div class="qa-inline"><select data-change="cat"><option value="all">All categories</option>' + CATS.map(function (c) { return '<option' + (SC.cat === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      '<select data-change="wing"><option value="all">All wings</option>' + ['Wing A', 'Wing B', 'Wing C'].map(function (w) { return '<option' + (SC.wing === w ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select></div>';
    html += items.length ? '<div class="qa-list qa-scroll" style="max-height:520px">' + items.map(function (c) {
      return '<div class="qa-item qa-sev-' + sevOf(c) + '" data-id="' + c.id + '"><div class="qa-item-top"><strong>' + esc(c.title) + '</strong><span>' + chip(c.priority) + ' ' + chip(c.status) + '</span></div>' +
        '<div class="qa-meta">' + esc(c.wing) + ' · ' + esc(c.flat) + ' · ' + esc(c.raised_by) + ' · ' + esc(c.category) + ' · ' + fmtDate(c.created_at) + '</div>' +
        (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        '<div class="qa-actions"><select class="qa-status">' + ['Open', 'In Progress', 'Resolved', 'Rejected'].map(function (s) { return '<option' + (c.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
        '<input class="qa-replytxt" maxlength="1000" placeholder="Reply to resident (optional)" value="' + esc(c.secretary_reply || '') + '"><button class="qa-btn qa-btn-sm qa-btn-primary" data-act="save">Update</button></div></div>';
    }).join('') + '</div>' : '<div class="qa-muted" style="padding:.6rem 0">No complaints match this filter.</div>';
    el.innerHTML = html;
    bind(el, {
      filter: function (b) { SC.filter = b.getAttribute('data-v'); drawSecComplaint(el); },
      cat: function (t) { SC.cat = t.value; drawSecComplaint(el); },
      wing: function (t) { SC.wing = t.value; drawSecComplaint(el); },
      save: async function (b) {
        var card = b.closest('.qa-item'); b.disabled = true;
        try {
          await api('/api/complaints/' + card.getAttribute('data-id'), { method: 'PATCH', body: { status: $('.qa-status', card).value, reply: $('.qa-replytxt', card).value } });
          toast('Complaint updated.'); refresh('both');
        } catch (e) { fail(e); b.disabled = false; }
      }
    });
  }

  /* ================================================================ MODULE: Community hall */
  var SLOTS = { morning: 'Morning (8 AM – 1 PM)', evening: 'Evening (4 PM – 11 PM)', full: 'Full day' };
  var SH = { month: monthStr(new Date()), picked: '', cal: [], data: null };

  function slotsBooked(date) { return SH.cal.filter(function (c) { return c.date === date; }).map(function (c) { return c.slot; }); }
  function slotBlocked(slot, booked) { return booked.indexOf(slot) >= 0 || booked.indexOf('full') >= 0 || (slot === 'full' && booked.length > 0); }

  async function resHall(el) {
    var cfg = S.settings, mine = [];
    if (S.session.loggedIn) { try { mine = await api('/api/hall-bookings/mine'); } catch (e) { /* ignore */ } }
    var html = '<div class="qa-tiles">' + tile('Hall fee', cfg.hall_fee ? rupee(cfg.hall_fee) : 'Ask office') + tile('Capacity', cfg.hall_capacity ? cfg.hall_capacity + ' guests' : '—') + '</div>';
    if (cfg.hall_rules) html += '<details class="qa-details" style="margin-top:0"><summary>Hall rules</summary><p class="qa-muted" style="white-space:pre-wrap;font-size:.88rem">' + esc(cfg.hall_rules) + '</p></details>';
    html += '<div class="qa-h">Pick a date</div><div id="qaHallCal"></div>';
    if (!S.session.loggedIn) {
      html += loginPrompt('Log in to request a booking.');
    } else {
      html += '<form class="qa-form" data-submit="book">' + identityHtml() +
        '<div class="qa-row2"><div class="qa-field"><label>Date</label><input type="date" name="date" required min="' + todayStr() + '" max="' + plusDays(365) + '" value="' + SH.picked + '" data-change="dateInput"></div>' +
        '<div class="qa-field"><label>Time slot</label><select name="slot" required>' + Object.keys(SLOTS).map(function (k) { return '<option value="' + k + '">' + SLOTS[k] + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="qa-row2"><div class="qa-field"><label>Event</label><select name="event_type"><option>Birthday</option><option>Wedding / Engagement</option><option>Religious / Puja</option><option>Family function</option><option>Society meeting</option><option>Other</option></select></div>' +
        '<div class="qa-field"><label>Guests</label><input type="number" name="guests" min="1" required value="20"></div></div>' +
        '<div class="qa-field"><label>Notes (optional)</label><textarea name="purpose" maxlength="500" placeholder="Anything the Secretary should know"></textarea></div>' +
        '<div><button class="qa-btn qa-btn-primary" type="submit">Request booking</button> <span class="qa-muted">Confirmed once the Secretary approves.</span></div></form>';
      html += '<div class="qa-h">Your bookings</div>';
      html += mine.length ? '<div class="qa-list">' + mine.map(function (b) {
        var canCancel = (b.status === 'Pending' || b.status === 'Approved') && b.booking_date >= todayStr();
        return '<div class="qa-item qa-sev-' + (CHIP[b.status] || 'grey') + '"><div class="qa-item-top"><strong>' + fmtDate(b.booking_date) + ' · ' + esc(SLOTS[b.slot] || b.slot) + '</strong>' + chip(b.status) + '</div>' +
          '<div class="qa-meta">' + esc(b.event_type) + ' · ' + b.guests + ' guests</div>' +
          (b.secretary_note ? '<div class="qa-reply"><b>Secretary:</b> ' + esc(b.secretary_note) + '</div>' : '') +
          (canCancel ? '<div class="qa-actions"><button class="qa-btn qa-btn-sm qa-btn-danger" data-act="cancel" data-id="' + b.id + '">Cancel booking</button></div>' : '') + '</div>';
      }).join('') + '</div>' : '<div class="qa-muted">No bookings yet.</div>';
    }
    el.innerHTML = html;
    bind(el, {
      book: async function (f) {
        var btn = $('button[type=submit]', f); btn.disabled = true;
        try { await api('/api/hall-bookings', { method: 'POST', body: formObj(f) }); toast('Request sent. You will see the decision here.'); SH.picked = ''; refresh('both'); }
        catch (e) { fail(e); btn.disabled = false; }
      },
      cancel: async function (b) {
        if (!window.confirm('Cancel this booking?')) return;
        try { await api('/api/hall-bookings/' + b.getAttribute('data-id') + '/cancel', { method: 'PATCH' }); toast('Booking cancelled.'); refresh('both'); } catch (e) { fail(e); }
      },
      dateInput: function (t) { if (t.value) { SH.picked = t.value; SH.month = t.value.slice(0, 7); loadCal(el); } },
      calPrev: function () { var d = parseDate(SH.month + '-01'); d.setMonth(d.getMonth() - 1); if (monthStr(d) >= monthStr(new Date())) { SH.month = monthStr(d); loadCal(el); } },
      calNext: function () { var d = parseDate(SH.month + '-01'); d.setMonth(d.getMonth() + 1); SH.month = monthStr(d); loadCal(el); },
      pickDay: function (b) {
        SH.picked = b.getAttribute('data-d');
        var inp = $('input[name=date]', el); if (inp) inp.value = SH.picked;
        drawCal(el);
      }
    });
    loadCal(el);
  }
  async function loadCal(el) {
    try { SH.cal = await api('/api/hall-bookings/calendar?month=' + SH.month); } catch (e) { SH.cal = []; }
    drawCal(el);
  }
  function drawCal(el) {
    var box = $('#qaHallCal', el); if (!box) return;
    var first = parseDate(SH.month + '-01'), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), today = todayStr();
    var cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<div class="qa-cal-dow">' + d + '</div>'; });
    for (var i = 0; i < first.getDay(); i++) cells.push('<div></div>');
    for (var d = 1; d <= days; d++) {
      var date = SH.month + '-' + pad(d), b = slotsBooked(date), cls = 'qa-day';
      if (b.indexOf('full') >= 0 || (b.indexOf('morning') >= 0 && b.indexOf('evening') >= 0)) cls += ' qa-full'; else if (b.length) cls += ' qa-half';
      if (date === today) cls += ' qa-today';
      if (date === SH.picked) cls += ' qa-pick';
      cells.push('<button type="button" class="' + cls + '" data-act="pickDay" data-d="' + date + '"' + (date < today ? ' disabled' : '') + ' title="' + (b.length ? 'Booked: ' + b.map(function (s) { return SLOTS[s]; }).join(', ') : 'Available') + '">' + d + '</button>');
    }
    box.innerHTML = '<div class="qa-cal"><div class="qa-cal-head"><button type="button" class="qa-btn qa-btn-sm" data-act="calPrev">‹</button><strong>' + esc(monthLabel(SH.month)) + '</strong><button type="button" class="qa-btn qa-btn-sm" data-act="calNext">›</button></div><div class="qa-cal-grid">' + cells.join('') + '</div>' +
      '<div class="qa-legend"><span><i style="background:#fff"></i>Free</span><span><i style="background:linear-gradient(135deg,#fff 50%,#FBE3B8 50%)"></i>One slot booked</span><span><i style="background:#F4C9BB"></i>Fully booked</span></div></div>';
    // Grey out slots already taken on the picked date.
    var sel = $('select[name=slot]', el);
    if (sel) {
      var booked = SH.picked ? slotsBooked(SH.picked) : [];
      Array.prototype.forEach.call(sel.options, function (o) { o.disabled = slotBlocked(o.value, booked); });
      if (sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].disabled) {
        var ok = Array.prototype.filter.call(sel.options, function (o) { return !o.disabled; })[0];
        if (ok) sel.value = ok.value;
      }
    }
  }

  async function secHall(el) {
    if (!SH.data) el.innerHTML = loadingHtml();
    try { SH.data = await api('/api/hall-bookings'); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
    var d = SH.data, st = d.stats, today = todayStr();
    var pending = d.items.filter(function (b) { return b.status === 'Pending'; });
    var upcoming = d.items.filter(function (b) { return b.status === 'Approved' && b.booking_date >= today; }).sort(function (a, b) { return a.booking_date < b.booking_date ? -1 : 1; });
    var history = d.items.filter(function (b) { return !(b.status === 'Pending' || (b.status === 'Approved' && b.booking_date >= today)); }).slice(0, 25);
    function row(b, actions) {
      return '<div class="qa-item qa-sev-' + (CHIP[b.status] || 'grey') + '"><div class="qa-item-top"><strong>' + fmtDate(b.booking_date) + ' · ' + esc(SLOTS[b.slot] || b.slot) + '</strong>' + chip(b.status) + '</div>' +
        '<div class="qa-meta">' + esc(b.wing) + ' · ' + esc(b.flat) + ' · ' + esc(b.booked_by) + ' · ' + esc(b.event_type) + ' · ' + b.guests + ' guests</div>' +
        (b.purpose ? '<p>' + esc(b.purpose) + '</p>' : '') +
        (b.status === 'Pending' && b.has_conflict ? note('Clashes with an already approved booking.', 'warn') : '') +
        (b.secretary_note ? '<div class="qa-reply"><b>Note:</b> ' + esc(b.secretary_note) + '</div>' : '') +
        (actions ? '<div class="qa-actions">' + actions + '</div>' : '') + '</div>';
    }
    var html = '<div class="qa-tiles">' + tile('Awaiting decision', st.pending, st.pending ? 'amber' : '') + tile('Upcoming approved', st.upcoming, 'green') + tile('Approved this month', st.this_month) + tile('All requests', st.total) + '</div>';
    html += '<div class="qa-h">Requests to decide</div>' + (pending.length ? '<div class="qa-list">' + pending.map(function (b) {
      return row(b, '<button class="qa-btn qa-btn-sm qa-btn-ok" data-act="decide" data-d="approve" data-id="' + b.id + '"' + (b.has_conflict ? ' disabled' : '') + '>Approve</button><button class="qa-btn qa-btn-sm qa-btn-danger" data-act="decide" data-d="reject" data-id="' + b.id + '">Reject</button>');
    }).join('') + '</div>' : '<div class="qa-muted">No pending requests.</div>');
    html += '<div class="qa-h">Upcoming bookings</div>' + (upcoming.length ? '<div class="qa-list">' + upcoming.map(function (b) {
      return row(b, '<button class="qa-btn qa-btn-sm qa-btn-danger" data-act="cancelB" data-id="' + b.id + '">Cancel booking</button>');
    }).join('') + '</div>' : '<div class="qa-muted">Nothing booked ahead.</div>');
    if (history.length) html += '<details class="qa-details"><summary>Past &amp; closed requests (' + history.length + ')</summary><div class="qa-list" style="margin-top:.6rem">' + history.map(function (b) { return row(b, ''); }).join('') + '</div></details>';
    html += settingsCard('Hall fee, capacity & rules shown to residents', [
      { key: 'hall_fee', label: 'Hall fee (₹)', type: 'number', ph: 'e.g. 5000' },
      { key: 'hall_capacity', label: 'Capacity (guests)', type: 'number', ph: 'e.g. 150' },
      { key: 'hall_rules', label: 'Rules', area: true }
    ]);
    el.innerHTML = html;
    bind(el, {
      decide: async function (b) {
        var approve = b.getAttribute('data-d') === 'approve';
        var noteTxt = window.prompt(approve ? 'Note for the resident (optional):' : 'Reason for rejecting (optional):', '');
        if (noteTxt === null) return;
        b.disabled = true;
        try { await api('/api/hall-bookings/' + b.getAttribute('data-id') + '/decision', { method: 'PATCH', body: { decision: approve ? 'approve' : 'reject', note: noteTxt } }); toast(approve ? 'Booking approved.' : 'Booking rejected.'); refresh('both'); }
        catch (e) { fail(e); b.disabled = false; }
      },
      cancelB: async function (b) {
        if (!window.confirm('Cancel this approved booking?')) return;
        try { await api('/api/hall-bookings/' + b.getAttribute('data-id') + '/cancel', { method: 'PATCH' }); toast('Booking cancelled.'); refresh('both'); } catch (e) { fail(e); }
      },
      saveSettings: function (f) { saveSettings(f, function () { refresh('res'); }); }
    });
  }

  /* ================================================================ MODULE: Gate pass */
  var SG = { date: todayStr(), filter: 'all', q: '', data: null, last: null };

  function shareText(p) {
    return 'Visitor gate pass — Bhargavi Housing Society\nVisitor: ' + p.visitor_name + '\nFor: ' + p.wing + ' ' + p.flat + '\nDate: ' + fmtDate(p.visit_date) + (p.time_window ? ' (' + p.time_window + ')' : '') + '\nPass code: ' + p.pass_code;
  }
  async function resGate(el) {
    if (!S.session.loggedIn) { el.innerHTML = note('Expecting a guest, delivery or service visit? Generate a gate pass so security lets them in smoothly.') + loginPrompt('Log in to create a visitor gate pass.'); return; }
    var mine = [];
    try { mine = await api('/api/gate-passes/mine'); } catch (e) { /* ignore */ }
    var html = '';
    if (SG.last) {
      html += note('<b>Pass created.</b> Give this code to your visitor and security:<br><span class="qa-code">' + esc(SG.last.pass_code) + '</span> <button class="qa-btn qa-btn-sm" data-act="share" data-id="' + SG.last.id + '">Share</button>', 'ok');
      SG.last = null;
    }
    html += '<div class="qa-h">New gate pass</div><form class="qa-form" data-submit="create">' + identityHtml() +
      '<div class="qa-field"><label>Visitor name</label><input name="visitor_name" required minlength="2" maxlength="80" placeholder="Full name"></div>' +
      '<div class="qa-row2"><div class="qa-field"><label>Visitor phone</label><input name="visitor_phone" type="tel" maxlength="20" placeholder="Optional"></div>' +
      '<div class="qa-field"><label>Purpose</label><select name="purpose"><option>Guest / Family</option><option>Delivery</option><option>Service / Repair</option><option>Cab / Taxi</option><option>Other</option></select></div></div>' +
      '<div class="qa-row2"><div class="qa-field"><label>Visit date</label><input type="date" name="visit_date" required min="' + todayStr() + '" max="' + plusDays(30) + '" value="' + todayStr() + '"></div>' +
      '<div class="qa-field"><label>Time window</label><input name="time_window" maxlength="60" placeholder="e.g. 5 PM – 8 PM"></div></div>' +
      '<div class="qa-field"><label>Vehicle number (optional)</label><input name="vehicle_no" maxlength="20" placeholder="MH 12 AB 1234"></div>' +
      '<div><button class="qa-btn qa-btn-primary" type="submit">Create gate pass</button></div></form>';
    html += '<div class="qa-h">Your passes</div>';
    html += mine.length ? '<div class="qa-list">' + mine.map(function (p) {
      return '<div class="qa-item qa-sev-' + (CHIP[p.status] || 'grey') + '"><div class="qa-item-top"><strong>' + esc(p.visitor_name) + '</strong>' + chip(p.status) + '</div>' +
        '<div class="qa-meta">' + fmtDate(p.visit_date) + (p.time_window ? ' · ' + esc(p.time_window) : '') + (p.purpose ? ' · ' + esc(p.purpose) : '') + (p.vehicle_no ? ' · ' + esc(p.vehicle_no) : '') + '</div>' +
        '<div class="qa-actions"><span class="qa-code" style="font-size:1.05rem">' + esc(p.pass_code) + '</span>' +
        (p.status === 'Active' ? '<button class="qa-btn qa-btn-sm" data-act="share" data-id="' + p.id + '">Share</button><button class="qa-btn qa-btn-sm qa-btn-danger" data-act="cancel" data-id="' + p.id + '">Cancel</button>' : '') + '</div></div>';
    }).join('') + '</div>' : (S.isSec && !S.session.memberId ? note('Passes you create for residents appear in the Secretary view.', 'info') : '<div class="qa-muted">No passes yet.</div>');
    el.innerHTML = html;
    bind(el, {
      create: async function (f) {
        var btn = $('button[type=submit]', f); btn.disabled = true;
        try { SG.last = await api('/api/gate-passes', { method: 'POST', body: formObj(f) }); toast('Gate pass created.'); refresh('both'); }
        catch (e) { fail(e); btn.disabled = false; }
      },
      cancel: async function (b) {
        if (!window.confirm('Cancel this gate pass?')) return;
        try { await api('/api/gate-passes/' + b.getAttribute('data-id') + '/cancel', { method: 'PATCH' }); toast('Pass cancelled.'); refresh('both'); } catch (e) { fail(e); }
      },
      share: function (b) {
        var p = mine.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0];
        if (!p) { var c = $('.qa-code', el); if (c && navigator.clipboard) navigator.clipboard.writeText(c.textContent).then(function () { toast('Pass code copied.'); }); return; }
        var text = shareText(p);
        if (navigator.share) navigator.share({ text: text }).catch(function () { /* user dismissed */ });
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Pass details copied.'); });
      }
    });
  }

  async function secGate(el) {
    if (!SG.data) el.innerHTML = loadingHtml();
    try { SG.data = await api('/api/gate-passes'); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
    drawSecGate(el);
  }
  function drawSecGate(el) {
    var d = SG.data, st = d.stats;
    var items = d.items.filter(function (p) {
      if (SG.date && p.visit_date !== SG.date) return false;
      if (SG.filter !== 'all' && p.status !== SG.filter) return false;
      if (SG.q && (p.pass_code + ' ' + p.visitor_name + ' ' + p.wing + ' ' + p.flat + ' ' + (p.vehicle_no || '')).toLowerCase().indexOf(SG.q) < 0) return false;
      return true;
    });
    var html = '<div class="qa-tiles">' + tile('Expected today', st.today_expected, 'amber') + tile('Inside now', st.inside_now, 'red') + tile('Left today', st.today_done, 'green') + tile('Passes today', st.today_total) + '</div>';
    html += '<div class="qa-inline"><input type="date" value="' + (SG.date || '') + '" data-change="date" aria-label="Filter by date"><button class="qa-btn qa-btn-sm" data-act="today">Today</button><button class="qa-btn qa-btn-sm" data-act="allDates">All dates</button></div>';
    html += '<div class="qa-inline"><input type="search" placeholder="Verify pass code · search visitor, flat or vehicle" value="' + esc(SG.q) + '" data-input="search"></div>';
    html += '<div class="qa-chips">' + ['all', 'Active', 'Checked In', 'Checked Out', 'Cancelled'].map(function (f) { return '<button class="qa-chipbtn' + (SG.filter === f ? ' qa-on' : '') + '" data-act="filter" data-v="' + f + '">' + (f === 'all' ? 'All' : f) + '</button>'; }).join('') + '</div>';
    html += items.length ? '<div class="qa-list qa-scroll" style="max-height:480px">' + items.map(function (p) {
      var acts = '';
      if (p.status === 'Active') acts = '<button class="qa-btn qa-btn-sm qa-btn-ok" data-act="setStatus" data-s="Checked In" data-id="' + p.id + '">Check in</button><button class="qa-btn qa-btn-sm qa-btn-danger" data-act="setStatus" data-s="Cancelled" data-id="' + p.id + '">Cancel</button>';
      else if (p.status === 'Checked In') acts = '<button class="qa-btn qa-btn-sm qa-btn-primary" data-act="setStatus" data-s="Checked Out" data-id="' + p.id + '">Check out</button>';
      return '<div class="qa-item qa-sev-' + (CHIP[p.status] || 'grey') + '"><div class="qa-item-top"><span><span class="qa-code" style="font-size:1.05rem">' + esc(p.pass_code) + '</span></span>' + chip(p.status) + '</div>' +
        '<div class="qa-item-top" style="margin-top:.35rem"><strong>' + esc(p.visitor_name) + '</strong></div>' +
        '<div class="qa-meta">For ' + esc(p.wing) + ' · ' + esc(p.flat) + ' (' + esc(p.requested_by) + ') · ' + fmtDate(p.visit_date) + (p.time_window ? ' · ' + esc(p.time_window) : '') + (p.vehicle_no ? ' · ' + esc(p.vehicle_no) : '') + (p.purpose ? ' · ' + esc(p.purpose) : '') + '</div>' +
        (p.visitor_phone ? '<div class="qa-meta">Visitor phone: <a href="tel:' + esc(p.visitor_phone) + '">' + esc(p.visitor_phone) + '</a></div>' : '') +
        (p.checked_in_at ? '<div class="qa-meta">In: ' + fmtTime(p.checked_in_at) + (p.checked_out_at ? ' · Out: ' + fmtTime(p.checked_out_at) : '') + '</div>' : '') +
        (acts ? '<div class="qa-actions">' + acts + '</div>' : '') + '</div>';
    }).join('') + '</div>' : '<div class="qa-muted" style="padding:.6rem 0">No passes match. Try “All dates”.</div>';
    el.innerHTML = html;
    bind(el, {
      date: function (t) { SG.date = t.value; drawSecGate(el); },
      today: function () { SG.date = todayStr(); drawSecGate(el); },
      allDates: function () { SG.date = ''; drawSecGate(el); },
      filter: function (b) { SG.filter = b.getAttribute('data-v'); drawSecGate(el); },
      search: function (t) { SG.q = t.value.trim().toLowerCase(); var pos = t.selectionStart; drawSecGate(el); var n = $('input[type=search]', el); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
      setStatus: async function (b) {
        var s = b.getAttribute('data-s');
        if (s === 'Cancelled' && !window.confirm('Cancel this pass?')) return;
        b.disabled = true;
        try { await api('/api/gate-passes/' + b.getAttribute('data-id') + '/status', { method: 'PATCH', body: { status: s } }); toast('Marked ' + s.toLowerCase() + '.'); refresh('both'); }
        catch (e) { fail(e); b.disabled = false; }
      }
    });
  }

  /* ================================================================ MODULE: Directory */
  var SD = { wing: 'all', q: '', limit: 60, pub: null, emerg: null, full: null, fq: '', fwing: 'all', fstatus: 'all', flimit: 80 };

  function initials(n) { return String(n || '?').replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase() || '?'; }

  async function resDirectory(el) {
    if (!SD.pub) {
      el.innerHTML = loadingHtml();
      try { SD.pub = await api('/api/public/members'); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
      try {
        var r = await Promise.all([api('/api/public/hospitals'), api('/api/public/ambulances')]);
        SD.emerg = { hospitals: r[0] || [], ambulances: r[1] || [] };
      } catch (e) { SD.emerg = null; }
    }
    var html = '';
    if (SD.emerg && (SD.emerg.ambulances.length || SD.emerg.hospitals.length)) {
      html += '<div class="qa-h">Emergency contacts</div><div class="qa-emerg">' +
        SD.emerg.ambulances.slice(0, 3).map(function (a) { return '<a href="tel:' + esc(a.phone) + '"><strong>🚑 ' + esc(a.service_name) + '</strong>' + esc(a.phone) + (a.eta_minutes ? ' · ~' + a.eta_minutes + ' min' : '') + '</a>'; }).join('') +
        SD.emerg.hospitals.slice(0, 3).map(function (h) { return h.phone_main ? '<a href="tel:' + esc(h.phone_main) + '"><strong>🏥 ' + esc(h.name) + '</strong>' + esc(h.phone_main) + '</a>' : ''; }).join('') + '</div>';
    }
    html += '<div class="qa-h">Residents</div><div class="qa-inline"><input type="search" placeholder="Search by name or flat" value="' + esc(SD.q) + '" data-input="search"></div>';
    html += '<div class="qa-chips">' + ['all', 'Wing A', 'Wing B', 'Wing C'].map(function (w) { return '<button class="qa-chipbtn' + (SD.wing === w ? ' qa-on' : '') + '" data-act="wing" data-v="' + w + '">' + (w === 'all' ? 'All wings' : w) + '</button>'; }).join('') + '</div>';
    html += '<div id="qaDirList"></div>';
    el.innerHTML = html;
    bind(el, {
      search: function (t) { SD.q = t.value.trim().toLowerCase(); SD.limit = 60; drawDirList(el); },
      wing: function (b) { SD.wing = b.getAttribute('data-v'); SD.limit = 60; resDirectory(el); },
      more: function () { SD.limit += 60; drawDirList(el); }
    });
    drawDirList(el);
  }
  function drawDirList(el) {
    var box = $('#qaDirList', el); if (!box) return;
    var list = SD.pub.filter(function (m) { return (SD.wing === 'all' || m.wing === SD.wing) && (!SD.q || (m.name + ' ' + m.wing + ' ' + m.flat).toLowerCase().indexOf(SD.q) >= 0); });
    box.innerHTML = '<div class="qa-muted" style="margin-bottom:.4rem">Showing ' + Math.min(list.length, SD.limit) + ' of ' + list.length + '</div>' +
      (list.length ? '<div class="qa-people">' + list.slice(0, SD.limit).map(function (m) {
        var img = safeImg(m.profile_image);
        return '<div class="qa-person"><div class="qa-av">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : esc(initials(m.name))) + '</div><div><strong>' + esc(m.name) + '</strong><span>' + esc(m.wing) + ' · ' + esc(m.flat) + '</span></div></div>';
      }).join('') + '</div>' + (list.length > SD.limit ? '<div class="qa-actions"><button class="qa-btn qa-btn-sm" data-act="more">Show more</button></div>' : '') : '<div class="qa-muted">No residents match.</div>') +
      '<div class="qa-muted" style="margin-top:.6rem">Contact details are visible to the Secretary only.</div>';
  }

  async function secDirectory(el) {
    if (!SD.full) el.innerHTML = loadingHtml();
    try { SD.full = await api('/api/members'); } catch (e) { el.innerHTML = note(esc(e.message), 'err'); return; }
    drawSecDirectory(el);
  }
  function drawSecDirectory(el) {
    var all = SD.full, rooms = {}, wings = {};
    all.forEach(function (m) { rooms[m.wing + '|' + m.flat] = 1; wings[m.wing] = (wings[m.wing] || 0) + 1; });
    var statuses = {}; all.forEach(function (m) { statuses[m.status || 'Active'] = 1; });
    var list = all.filter(function (m) {
      if (SD.fwing !== 'all' && m.wing !== SD.fwing) return false;
      if (SD.fstatus !== 'all' && (m.status || 'Active') !== SD.fstatus) return false;
      if (SD.fq && [m.name, m.wing, m.flat, m.phone, m.email, m.occupation].join(' ').toLowerCase().indexOf(SD.fq) < 0) return false;
      return true;
    });
    var html = '<div class="qa-tiles">' + tile('Residents', all.length) + tile('Flats', Object.keys(rooms).length) +
      Object.keys(wings).sort().map(function (w) { return tile(w, wings[w]); }).join('') + '</div>';
    html += '<div class="qa-inline"><input type="search" placeholder="Search name, flat, phone, email, occupation" value="' + esc(SD.fq) + '" data-input="search">' +
      '<select data-change="wing"><option value="all">All wings</option>' + Object.keys(wings).sort().map(function (w) { return '<option' + (SD.fwing === w ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select>' +
      '<select data-change="status"><option value="all">Any status</option>' + Object.keys(statuses).sort().map(function (s) { return '<option' + (SD.fstatus === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>';
    html += '<div class="qa-muted" style="margin-bottom:.4rem">Showing ' + Math.min(list.length, SD.flimit) + ' of ' + list.length + '</div>';
    html += '<div class="qa-table-wrap" style="max-height:440px;overflow-y:auto"><table class="qa-table"><tr><th>Resident</th><th>Flat</th><th>Phone</th><th>Email</th><th>Occupation</th><th>Status</th></tr>' +
      (list.length ? list.slice(0, SD.flimit).map(function (m) {
        return '<tr><td><b>' + esc(m.name) + '</b></td><td>' + esc(m.wing) + ' · ' + esc(m.flat) + '</td><td>' + (m.phone ? '<a href="tel:' + esc(m.phone) + '">' + esc(m.phone) + '</a>' : '—') + '</td><td>' + (m.email ? '<a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' : '—') + '</td><td>' + esc(m.occupation || '—') + '</td><td>' + chip(m.status || 'Active') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="qa-muted">No residents match.</td></tr>') + '</table></div>';
    if (list.length > SD.flimit) html += '<div class="qa-actions"><button class="qa-btn qa-btn-sm" data-act="more">Show more</button></div>';
    html += '<a class="qa-link" href="secretary.html#members">Add or edit residents in the Members tab →</a>';
    el.innerHTML = html;
    bind(el, {
      search: function (t) { SD.fq = t.value.trim().toLowerCase(); SD.flimit = 80; var pos = t.selectionStart; drawSecDirectory(el); var n = $('input[type=search]', el); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
      wing: function (t) { SD.fwing = t.value; SD.flimit = 80; drawSecDirectory(el); },
      status: function (t) { SD.fstatus = t.value; SD.flimit = 80; drawSecDirectory(el); },
      more: function () { SD.flimit += 80; drawSecDirectory(el); }
    });
  }

  /* ================================================================ panel framework */
  var MODS = {
    maintenance: { icon: '💳', title: 'Pay Maintenance', sub: 'Dues, payment details and collection status', res: resMaintenance, sec: secMaintenance, resT: 'Your maintenance', secT: 'Collection & defaulters' },
    complaint: { icon: '🛠️', title: 'Raise a Complaint', sub: 'Report problems and track them to resolution', res: resComplaint, sec: secComplaint, resT: 'Raise & track', secT: 'Complaint management' },
    hall: { icon: '🏛️', title: 'Book Community Hall', sub: 'Check availability and request a slot', res: resHall, sec: secHall, resT: 'Availability & booking', secT: 'Booking approvals' },
    gatepass: { icon: '🚪', title: 'Visitor Gate Pass', sub: 'Pre-approve guests, deliveries and services', res: resGate, sec: secGate, resT: 'Create a pass', secT: 'Gate desk' },
    directory: { icon: '📇', title: 'Resident Directory', sub: 'Find neighbours and emergency numbers', res: resDirectory, sec: secDirectory, resT: 'Neighbours', secT: 'Full member records' }
  };
  var overlay, lastFocus, escBound;

  function ensureOverlay() {
    if (overlay) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.className = 'qa-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qaTitle');
    overlay.innerHTML = '<div class="qa-panel"><div class="qa-head"><div class="qa-head-ic" id="qaIcon"></div><div class="qa-head-txt"><h3 id="qaTitle"></h3><p id="qaSub"></p></div><span class="qa-role" id="qaRole"></span>' +
      '<button type="button" class="qa-close" id="qaClose" aria-label="Close">&times;</button></div><div class="qa-seg" id="qaSeg" hidden></div><div class="qa-body"><div class="qa-grid" id="qaGrid"></div></div><div class="qa-toast" id="qaToast" role="status"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePanel(); });
    $('#qaClose', overlay).addEventListener('click', closePanel);
    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('qa-show')) closePanel(); });
    }
  }
  function closePanel() {
    if (!overlay) return;
    overlay.classList.remove('qa-show');
    document.body.style.overflow = '';
    S.key = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function resBody() { return $('#qaGrid .qa-col-res .qa-col-body'); }
  function secBody() { return $('#qaGrid .qa-col-sec .qa-col-body'); }

  async function refresh(which) {
    var m = MODS[S.key]; if (!m) return;
    var jobs = [];
    if ((which === 'res' || which === 'both') && resBody()) jobs.push(m.res(resBody()));
    if ((which === 'sec' || which === 'both') && S.isSec && secBody()) jobs.push(m.sec(secBody()));
    await Promise.all(jobs);
  }

  async function openPanel(key) {
    var m = MODS[key]; if (!m) return;
    ensureOverlay();
    lastFocus = document.activeElement;
    S.key = key;
    if (key === 'hall') { SH.picked = ''; SH.month = monthStr(new Date()); }
    if (key === 'gatepass') { SG.date = todayStr(); SG.q = ''; SG.filter = 'all'; }
    $('#qaIcon').textContent = m.icon;
    $('#qaTitle').textContent = m.title;
    $('#qaSub').textContent = m.sub;
    $('#qaGrid').innerHTML = '<div class="qa-col qa-col-res"><h4 class="qa-col-title">Resident panel</h4><div class="qa-col-body">' + loadingHtml() + '</div></div>';
    overlay.classList.add('qa-show');
    document.body.style.overflow = 'hidden';
    sound('open');

    // Fresh session every time: this is what decides whether the detailed panel exists.
    try { S.session = await api('/api/auth/session'); } catch (e) { S.session = { loggedIn: false }; }
    S.isSec = !!(S.session.loggedIn && S.session.role === 'secretary');
    try { S.settings = await api('/api/settings'); } catch (e) { S.settings = {}; }
    S.me = null;
    if (S.session.loggedIn && S.session.memberId) { try { S.me = await api('/api/members/' + S.session.memberId + '/profile'); } catch (e) { /* optional */ } }
    if (S.key !== key) return; // closed or switched while loading

    var role = $('#qaRole');
    role.textContent = S.isSec ? 'Secretary · full access' : (S.session.loggedIn ? 'Resident' : 'Guest');
    role.className = 'qa-role' + (S.isSec ? ' qa-role-sec' : '');

    var grid = $('#qaGrid'), seg = $('#qaSeg');
    grid.innerHTML =
      '<section class="qa-col qa-col-res"><h4 class="qa-col-title">' + esc(m.resT) + ' <span class="qa-tag">Resident panel</span></h4><div class="qa-col-body">' + loadingHtml() + '</div></section>' +
      (S.isSec ? '<section class="qa-col qa-col-sec"><h4 class="qa-col-title">' + esc(m.secT) + ' <span class="qa-tag">Secretary panel</span></h4><div class="qa-col-body">' + loadingHtml() + '</div></section>' : '');
    grid.setAttribute('data-mode', S.isSec ? 'both' : 'res');

    if (S.isSec) {
      seg.hidden = false;
      seg.innerHTML = [['both', 'Both panels'], ['sec', 'Secretary panel'], ['res', 'Resident panel']].map(function (x) { return '<button type="button" data-mode="' + x[0] + '" class="' + (x[0] === 'both' ? 'qa-on' : '') + '">' + x[1] + '</button>'; }).join('');
      seg.onclick = function (e) {
        var b = e.target.closest('button[data-mode]'); if (!b) return;
        grid.setAttribute('data-mode', b.getAttribute('data-mode'));
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('qa-on', c === b); });
      };
    } else { seg.hidden = true; seg.innerHTML = ''; }

    $('#qaClose').focus();
    refresh('both');
  }

  function init() {
    var btns = document.querySelectorAll('.rail-btn[data-qa]');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () { openPanel(b.getAttribute('data-qa')); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BHSQuickActions = { open: openPanel, close: closePanel };
})();
