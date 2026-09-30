// =============================================================================
// BAI.js — "Batch Analysis with AI" page
// =============================================================================
// Self-contained module: injects its own markup + styles into the empty
// <div id="page-bai"></div> container in index.html and wires the topbar
// "Batch Analysis with AI" icon (button#topbar-bai-btn, placed right next to
// the Pre-Production AI icon) to open it.
//
// This is an exact structural clone of ai.js (Pre-Production AI) — same
// simple, fully local rule-based assistant, no external AI API, no network
// calls, no API key — just renamed/re-themed (light green) as its own
// independent page so it never collides with ai.js's markup/styles/ids.
// =============================================================================
(function () {
  'use strict';

  var history = [];       // [{ role: 'user'|'bot', text }]
  var lastActiveNavItem = null;
  var built = false;
  var selectedFiles = [];  // File objects staged for the next outgoing message
  var SUGGESTIONS = [
    'Summarize this batch of footage',
    'Flag any inconsistencies in these files',
    'Compare metrics across these batches',
    'What should I look for first?'
  ];

  // Abstract "AI mark" — four rounded petals meeting at a center point,
  // forming a pinwheel/knot motif. Original geometry (not a copy of any
  // third-party logo). Used in place of the smart_toy glyph for the header
  // icon and bot avatars.
  var BAI_ICON_SVG =
    '<svg class="bai-ai-mark" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M12,12 C9.2,9.6 8.3,6.1 12,2.6 C15.7,6.1 14.8,9.6 12,12 Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M12,12 C9.2,9.6 8.3,6.1 12,2.6 C15.7,6.1 14.8,9.6 12,12 Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" transform="rotate(90 12 12)"/>' +
      '<path d="M12,12 C9.2,9.6 8.3,6.1 12,2.6 C15.7,6.1 14.8,9.6 12,12 Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" transform="rotate(180 12 12)"/>' +
      '<path d="M12,12 C9.2,9.6 8.3,6.1 12,2.6 C15.7,6.1 14.8,9.6 12,12 Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" transform="rotate(270 12 12)"/>' +
      '<circle cx="12" cy="12" r="1.15" fill="currentColor"/>' +
    '</svg>';

  // ---------------------------------------------------------------------
  // Styles (scoped, injected once)
  // ---------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('bai-page-styles')) return;
    var css = ''
      + '.bai-page-wrap{--bai-bg:#e9edf5;--bai-ink:#243454;--bai-muted:#75829b;--bai-green:#1f9d57;--bai-green-dark:#0d6b39;display:flex;flex-direction:column;height:calc(100vh - 96px);max-height:calc(100vh - 96px);background:var(--bai-bg);margin:-24px;padding:0;color:var(--bai-ink);}'
      + '.bai-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:var(--bai-bg);border-bottom:1px solid rgba(255,255,255,.55);box-shadow:0 8px 18px rgba(163,177,198,.18);flex-shrink:0;z-index:1;}'
      + '.bai-back-link{display:flex;align-items:center;gap:6px;background:var(--bai-bg);border:none;color:var(--bai-green-dark);font-size:13.5px;font-weight:700;cursor:pointer;padding:9px 13px;border-radius:12px;box-shadow:5px 5px 10px #c7cdd8,-5px -5px 10px #fff;transition:transform .18s,box-shadow .18s;}'
      + '.bai-back-link:hover{transform:translateY(-1px);box-shadow:7px 7px 14px #c7cdd8,-7px -7px 14px #fff;}'
      + '.bai-back-link .material-icons-round{font-size:17px;}'
      + '.bai-topbar-right{display:flex;align-items:center;gap:12px;}'
      + '.bai-clear-btn{display:flex;align-items:center;justify-content:center;background:var(--bai-bg);border:none;color:#cf3f45;border-radius:11px;width:38px;height:38px;padding:0;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:4px 4px 9px #c7cdd8,-4px -4px 9px #fff;transition:transform .18s,box-shadow .18s;}'
      + '.bai-clear-btn .material-icons-round{font-size:25px;}'
      + '.bai-clear-btn:hover{transform:translateY(-1px);box-shadow:inset 2px 2px 5px #c7cdd8,inset -2px -2px 5px #fff;}'
      + '.bai-clear-btn .material-icons-round{font-size:25px;}'
      + '.bai-clear-confirm[hidden]{display:none;}.bai-clear-confirm{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(233,237,245,.3);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);}.bai-clear-confirm-card{width:min(360px,100%);padding:28px;border-radius:24px;background:#e9edf5;box-shadow:14px 14px 28px #b9c2d1,-12px -12px 25px #fff;display:flex;flex-direction:column;align-items:center;text-align:center;}.bai-clear-confirm-icon{width:54px;height:54px;display:flex;align-items:center;justify-content:center;border-radius:18px;background:#e9edf5;color:#cf3f45;box-shadow:inset 4px 4px 8px #c7cdd8,inset -4px -4px 8px #fff;font-size:29px;}.bai-clear-confirm-card h2{margin:16px 0 7px;font-size:19px;color:#243454;}.bai-clear-confirm-card p{margin:0;color:#75829b;font-size:13px;line-height:1.55;}.bai-clear-confirm-actions{display:flex;gap:10px;width:100%;margin-top:22px;}.bai-clear-confirm-actions button{flex:1;border:0;border-radius:12px;padding:11px 12px;font:700 13px inherit;cursor:pointer;}.bai-clear-cancel{color:#0d6b39;background:#e9edf5;box-shadow:4px 4px 9px #c7cdd8,-4px -4px 9px #fff;}.bai-clear-approve{color:#fff;background:linear-gradient(145deg,#e65d63,#b62f37);box-shadow:4px 4px 9px #c7cdd8,-3px -3px 7px #fff;}'
      + '.bai-clear-confirm{background:rgba(255,244,232,.34);}.bai-clear-confirm-card{background:#fff4e8;box-shadow:14px 14px 28px #dfc9b7,-12px -12px 25px #fffdf9;}.bai-clear-confirm-icon,.bai-clear-cancel{background:#fff4e8;}.bai-clear-confirm-icon{box-shadow:inset 4px 4px 8px #e1c8b4,inset -4px -4px 8px #fffdf9;}.bai-clear-confirm-actions button{transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;}.bai-clear-cancel{box-shadow:4px 4px 9px #dfc9b7,-4px -4px 9px #fffdf9;}.bai-clear-cancel:hover,.bai-clear-approve:hover{transform:translateY(-2px);filter:brightness(1.04);}.bai-clear-cancel:active{transform:translateY(1px);box-shadow:inset 3px 3px 7px #dfc9b7,inset -3px -3px 7px #fffdf9;}.bai-clear-approve:active{transform:translateY(1px) scale(.98);box-shadow:inset 3px 3px 7px rgba(115,25,31,.38),inset -2px -2px 5px rgba(255,255,255,.18);}'
      + '.bai-online-badge{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#52617b;padding:8px 11px;border-radius:11px;box-shadow:inset 2px 2px 5px #c7cdd8,inset -2px -2px 5px #fff;}'
      + '.bai-online-dot{width:8px;height:8px;border-radius:50%;background:#27c77b;box-shadow:0 0 0 3px rgba(39,199,123,.16);flex-shrink:0;}'
      + '.bai-chat-shell{display:flex;flex:1;min-height:0;margin:22px 24px;background:linear-gradient(145deg,#f0faf3,#dcefe1);border-radius:28px;box-shadow:14px 14px 28px #bcdcc6,-14px -14px 28px #fffdf9;overflow:hidden;}'
      + '.bai-chat-shell,.bai-content-scroll{scrollbar-width:thin;scrollbar-color:#43d17c transparent;}'
      + '.bai-chat-shell::-webkit-scrollbar,.bai-content-scroll::-webkit-scrollbar{width:5px;}.bai-chat-shell::-webkit-scrollbar-track,.bai-content-scroll::-webkit-scrollbar-track{background:rgba(31,157,87,.08);border-radius:999px;}.bai-chat-shell::-webkit-scrollbar-thumb,.bai-content-scroll::-webkit-scrollbar-thumb{min-height:36px;background:linear-gradient(180deg,#78eaa3,#1f9d57);border:1px solid transparent;border-radius:999px;background-clip:padding-box;}.bai-chat-shell::-webkit-scrollbar-button,.bai-content-scroll::-webkit-scrollbar-button{display:none;}'
      + '.bai-ai-sidebar{width:310px;flex-shrink:0;padding:22px 18px;background:linear-gradient(155deg,#f3fbf5,#dbeee0);border-right:1px solid rgba(178,212,190,.34);display:flex;flex-direction:column;overflow:hidden;}'
      + '.bai-chat-main{display:flex;flex:1;flex-direction:column;min-width:0;background:rgba(245,251,247,.3);position:relative;}'
      + '.bai-content-scroll{flex:1;overflow-y:auto;padding:28px 24px 42px;display:flex;flex-direction:column;min-height:0;}'
      + '.bai-scroll-latest{position:absolute;right:26px;bottom:92px;z-index:3;width:42px;height:42px;padding:0;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bai-bg);color:var(--bai-green);box-shadow:5px 5px 11px #c7cdd8,-4px -4px 9px #fff;cursor:pointer;opacity:0;visibility:hidden;transform:translateY(10px) scale(.9);transition:opacity .2s ease,transform .2s ease,visibility .2s;}.bai-scroll-latest.is-visible{opacity:1;visibility:visible;transform:translateY(0) scale(1);}.bai-scroll-latest:hover{color:var(--bai-green-dark);transform:translateY(-2px) scale(1.04);}.bai-scroll-latest:active{transform:translateY(1px) scale(.97);box-shadow:inset 3px 3px 7px #c7cdd8,inset -3px -3px 7px #fff;}.bai-scroll-latest .material-icons-round{font-size:25px;}'
      + '.bai-header-row{display:flex;flex-direction:column;align-items:flex-start;gap:17px;margin:0;width:100%;padding:25px 22px;border-radius:21px;background:linear-gradient(145deg,#f8fdf9,#ddefe2);box-shadow:inset 5px 5px 10px rgba(178,212,190,.22),inset -5px -5px 10px rgba(255,255,255,.76);flex-shrink:0;position:relative;overflow:hidden;}'
      + '.bai-sidebar-image-wrap{display:flex;align-items:flex-end;justify-content:center;margin-top:auto;padding:22px 0 2px;min-height:0;}'
      + '.bai-sidebar-image{display:block;width:136%;max-width:none;height:auto;max-height:340px;object-fit:contain;object-position:center bottom;border-radius:18px;filter:drop-shadow(7px 9px 10px rgba(70,120,90,.18));}'
      + '.bai-header-row:after{content:"";position:absolute;width:130px;height:130px;border-radius:50%;right:-52px;top:-65px;background:rgba(255,255,255,.38);box-shadow:inset 5px 5px 12px rgba(180,215,195,.25);}'
      + '.bai-header-icon{width:58px;height:58px;border-radius:19px;background:linear-gradient(145deg,#2fbf6f,#0d6b39);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:7px 7px 13px #a9cdb2,-5px -5px 10px #fff,inset 2px 2px 3px rgba(255,255,255,.32);position:relative;z-index:1;}'
      + '.bai-header-icon:before{content:"";position:absolute;inset:6px;border-radius:14px;border:1px solid rgba(255,255,255,.25);}'
      + '.bai-header-icon .material-icons-round{font-size:27px;color:#fff;position:relative;z-index:1;}'
      + '.bai-header-icon .bai-ai-mark{width:27px;height:27px;color:#fff;position:relative;z-index:1;}'
      + '.bai-msg-avatar .bai-ai-mark{width:16px;height:16px;}'
      + '.bai-header-text{position:relative;z-index:1;}'
      + '.bai-header-text h1{font-size:21px;font-weight:800;letter-spacing:-.4px;margin:0 0 5px;color:#233656;text-shadow:1px 1px 0 rgba(255,255,255,.65);}'
      + '.bai-header-text h1 .bai-pulse-word{color:#1f9d57;display:inline-block;animation:bai-green-pulse 1.8s ease-in-out infinite;}'
      + '@keyframes bai-green-pulse{0%,100%{transform:scale(1);color:#1f9d57;text-shadow:none;}50%{transform:scale(1.12);color:#2fbf6f;text-shadow:0 0 10px rgba(47,191,111,.34);}}'
      + '.bai-header-text p{font-size:12.5px;margin:0;color:#73819a;font-weight:600;line-height:1.6;}'
      + '.bai-header-text:after{content:"AI BATCH ASSISTANT";display:inline-flex;margin-top:8px;padding:4px 8px;border-radius:8px;background:#e8f7ee;color:#1f9d57;font-size:9px;font-weight:800;letter-spacing:.8px;box-shadow:inset 2px 2px 4px #cfe9d8,inset -2px -2px 4px #fffaf5;}'
      + '.bai-empty-state{width:100%;}'
      + '.bai-welcome-card{background:linear-gradient(145deg,#f7fdf9,#def0e5);border-radius:25px;box-shadow:12px 12px 25px #b7d9c0,-12px -12px 25px #fffdf9;padding:42px 24px 36px;text-align:center;margin:0 auto 20px;max-width:1120px;flex-shrink:0;}'
      + '.bai-welcome-sparkle{font-size:34px;color:var(--bai-green);margin-bottom:12px;display:inline-flex;width:62px;height:62px;align-items:center;justify-content:center;border-radius:20px;background:#eafaf1;box-shadow:inset 5px 5px 10px #c3e3cc,inset -5px -5px 10px #fffdf9;}'
      + '.bai-welcome-sparkle .bai-ai-mark{width:34px;height:34px;}'
      + '.bai-welcome-card h2{font-size:21px;font-weight:800;letter-spacing:-.3px;margin:0 0 7px;color:var(--bai-ink);}'
      + '.bai-greet-icon{display:inline-block;vertical-align:-5px;margin-left:5px;color:var(--bai-green);}'
      + '.bai-welcome-card > p{font-size:13px;color:var(--bai-muted);margin:0;font-weight:600;}'
      + '.bai-chat-log{display:flex;flex-direction:column;gap:16px;flex:1;min-height:0;width:100%;max-width:1120px;margin:0 auto;}'
      + '.bai-msg{display:flex;gap:10px;max-width:78%;align-items:flex-start;flex-shrink:0;}'
      + '.bai-msg-avatar{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:4px 4px 8px #c7cdd8,-3px -3px 7px #fff;}'
      + '.bai-msg-avatar .material-icons-round{font-size:16px;}'
      + '.bai-msg-bubble{padding:12px 15px;border-radius:16px;font-size:13.5px;font-weight:600;line-height:1.6;white-space:pre-wrap;word-break:break-word;box-shadow:5px 5px 11px #c7cdd8,-5px -5px 11px #fff;}'
      + '.bai-msg--user{align-self:flex-end;flex-direction:row-reverse;}'
      + '.bai-msg--user .bai-msg-avatar{background:var(--bai-bg);color:var(--bai-green-dark);}'
      + '.bai-msg--user .bai-msg-bubble{background:linear-gradient(145deg,#2fbf6f,#0d6b39);color:#fff;font-weight:700;border-bottom-right-radius:5px;box-shadow:6px 6px 13px #b9c2d2,-4px -4px 9px #fff,inset 1px 1px 1px rgba(255,255,255,.22);}'
      + '.bai-msg--bot .bai-msg-avatar{background:linear-gradient(145deg,#2fbf6f,#0d6b39);color:#fff;}'
      + '.bai-msg--bot .bai-msg-bubble{background:var(--bai-bg);color:#33415c;border-bottom-left-radius:5px;}'
      + '.bai-msg-bubble strong{font-weight:700;}'
      + '.bai-msg-bubble ul{margin:6px 0 0;padding-left:18px;}'
      + '.bai-msg-bubble li{margin-bottom:3px;}'
      + '.bai-typing{display:flex;gap:4px;align-items:center;padding:4px 2px;}'
      + '.bai-typing span{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:bai-typing-bounce 1.1s infinite ease-in-out;}'
      + '.bai-typing span:nth-child(2){animation-delay:.15s;}'
      + '.bai-typing span:nth-child(3){animation-delay:.3s;}'
      + '@keyframes bai-typing-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}'
      + '.bai-input-bar{flex-shrink:0;background:rgba(240,250,244,.72);padding:16px 24px 10px;border-top:1px solid rgba(255,255,255,.8);}'
      + '.bai-input-row{display:flex;align-items:center;gap:10px;background:var(--bai-bg);border:none;border-radius:18px;padding:9px 9px 9px 14px;max-width:1120px;margin:auto;box-shadow:inset 6px 6px 12px #c7cdd8,inset -6px -6px 12px #fff;}'
      + '.bai-icon-btn{background:var(--bai-bg);border:none;color:#8795ae;cursor:pointer;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;flex-shrink:0;box-shadow:3px 3px 6px #c7cdd8,-3px -3px 6px #fff;transition:transform .15s,box-shadow .15s,color .15s;}'
      + '.bai-icon-btn:hover{color:var(--bai-green-dark);transform:translateY(-1px);}'
      + '#bai-suggest-btn .material-icons-round{color:var(--bai-green);animation:bai-suggest-blink 1.7s ease-in-out infinite;}'
      + '@keyframes bai-suggest-blink{0%,100%{opacity:.58;filter:drop-shadow(0 0 0 rgba(31,157,87,0));}50%{opacity:1;filter:drop-shadow(0 0 5px rgba(31,157,87,.78));}}'
      + '.bai-chat-textarea{flex:1;resize:none;border:none;padding:8px 4px;font-size:13.5px;font-family:inherit;line-height:1.5;max-height:120px;outline:none;background:transparent;color:var(--bai-ink);}'
      + '.bai-chat-textarea::placeholder{color:#8794aa;}'
      + '.bai-send-btn{width:40px;height:40px;border-radius:13px;border:none;background:linear-gradient(145deg,#2fbf6f,#0d6b39);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;box-shadow:5px 5px 10px #b9c2d2,-3px -3px 7px #fff,inset 1px 1px 1px rgba(255,255,255,.28);transition:transform .15s,opacity .15s;}'
      + '.bai-send-btn:hover{transform:translateY(-2px);}'
      + '.bai-send-btn:disabled{opacity:.5;cursor:not-allowed;}'
      + '.bai-send-btn .material-icons-round{font-size:18px;}'
      + '.bai-input-hint{font-size:10.5px;color:#8b98ae;text-align:center;padding:10px 0 4px;display:flex;align-items:center;justify-content:center;gap:5px;}'
      + '.bai-input-hint .material-icons-round{font-size:12px;}'
      + '.bai-attach-chips{display:none;flex-wrap:wrap;gap:7px;padding:0 4px 10px;max-width:1120px;margin:auto;}'
      + '.bai-attach-chip{display:flex;align-items:center;gap:6px;background:var(--bai-bg);border-radius:10px;padding:6px 6px 6px 10px;font-size:11.5px;font-weight:700;color:var(--bai-ink);box-shadow:inset 2px 2px 5px #c7cdd8,inset -2px -2px 5px #fff;max-width:190px;}'
      + '.bai-attach-chip .material-icons-round{font-size:15px;flex-shrink:0;color:var(--bai-green-dark);}'
      + '.bai-attach-chip .bai-attach-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.bai-attach-chip--image{position:relative;padding:0;background:none;box-shadow:none;max-width:none;}'
      + '.bai-attach-thumb{width:54px;height:54px;object-fit:cover;border-radius:11px;display:block;box-shadow:3px 3px 7px #c7cdd8,-3px -3px 7px #fff;}'
      + '.bai-attach-remove--image{position:absolute;top:-6px;right:-6px;background:#fff;box-shadow:0 2px 6px rgba(36,52,84,.35);border-radius:50%;width:18px;height:18px;padding:0;align-items:center;justify-content:center;color:#5b6b88;}'
      + '.bai-attach-remove--image .material-icons-round{font-size:12px;}'
      + '.bai-msg-file-thumb{width:84px;height:84px;object-fit:cover;border-radius:12px;display:block;box-shadow:0 2px 6px rgba(0,0,0,.18);}'
      + '.bai-attach-remove{background:none;border:none;padding:2px;margin:0;display:flex;cursor:pointer;color:#8795ae;flex-shrink:0;border-radius:6px;}'
      + '.bai-attach-remove:hover{color:#cf3f45;}'
      + '.bai-attach-remove .material-icons-round{font-size:14px;color:inherit;}'
      + '.bai-suggest-panel{display:none;flex-wrap:wrap;gap:7px;padding:0 4px 10px;max-width:1120px;margin:auto;}'
      + '.bai-suggest-chip{background:var(--bai-bg);border:none;border-radius:11px;padding:7px 12px;font-size:11.5px;font-weight:700;color:var(--bai-green-dark);cursor:pointer;box-shadow:3px 3px 6px #c7cdd8,-3px -3px 6px #fff;transition:transform .15s,box-shadow .15s;}'
      + '.bai-suggest-chip:hover{transform:translateY(-1px);}'
      + '.bai-msg-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
      + '.bai-msg-file-chip{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.2);border-radius:8px;padding:4px 8px 4px 6px;font-size:11px;font-weight:700;}'
      + '.bai-msg-file-chip .material-icons-round{font-size:13px;}'
      + '@media (max-width:760px){.bai-msg{max-width:92%;}.bai-topbar{padding:10px 12px;}.bai-topbar-right{gap:7px;}.bai-clear-btn{padding:8px;}.bai-clear-btn .material-icons-round{margin:0;}.bai-clear-btn{font-size:0;}.bai-chat-shell{margin:14px 12px;border-radius:22px;flex-direction:column;overflow:auto;}.bai-ai-sidebar{width:auto;padding:12px;border-right:none;border-bottom:1px solid rgba(178,212,190,.34);}.bai-header-row{min-height:auto;padding:15px;gap:13px;border-radius:17px;flex-direction:row;align-items:center;}.bai-sidebar-image-wrap{padding:12px 4px 2px;}.bai-sidebar-image{width:100%;max-height:145px;}.bai-header-text:after{margin-top:6px;}.bai-header-icon{width:48px;height:48px;border-radius:16px;}.bai-header-icon .material-icons-round{font-size:23px;}.bai-header-text h1{font-size:18px;}.bai-header-text p{line-height:1.45;}.bai-content-scroll{padding:18px 16px 34px;}.bai-input-bar{padding:12px 16px 4px;}.bai-welcome-card{padding:34px 18px 28px;border-radius:21px;}}';
    var style = document.createElement('style');
    style.id = 'bai-page-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // Markup
  // ---------------------------------------------------------------------
  function getUserFirstName() {
    var el = document.getElementById('topbar-username');
    var name = el && el.textContent ? el.textContent.trim() : '';
    if (!name || name.toLowerCase() === 'user') return 'there';
    return name.split(' ')[0];
  }

  // Small line-icon set (stroke-based, inherits color via currentColor) used
  // in place of emoji for the welcome-card greeting.
  var GREET_ICONS = {
    sun: '<circle cx="12" cy="12" r="4.3"></circle><line x1="12" y1="2.5" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="21.5"></line><line x1="4.6" y1="4.6" x2="6.3" y2="6.3"></line><line x1="17.7" y1="17.7" x2="19.4" y2="19.4"></line><line x1="2.5" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="21.5" y2="12"></line><line x1="4.6" y1="19.4" x2="6.3" y2="17.7"></line><line x1="17.7" y1="6.3" x2="19.4" y2="4.6"></line>',
    sunrise: '<path d="M17 18a5 5 0 0 0-10 0"></path><line x1="12" y1="2" x2="12" y2="9"></line><line x1="4.6" y1="10.6" x2="6" y2="12"></line><line x1="1.5" y1="18" x2="4" y2="18"></line><line x1="20" y1="18" x2="22.5" y2="18"></line><line x1="18" y1="12" x2="19.4" y2="10.6"></line><line x1="2" y1="22" x2="22" y2="22"></line><polyline points="8.5 6 12 2.5 15.5 6"></polyline>',
    sunset: '<path d="M17 18a5 5 0 0 0-10 0"></path><line x1="12" y1="9" x2="12" y2="2"></line><line x1="4.6" y1="10.6" x2="6" y2="12"></line><line x1="1.5" y1="18" x2="4" y2="18"></line><line x1="20" y1="18" x2="22.5" y2="18"></line><line x1="18" y1="12" x2="19.4" y2="10.6"></line><line x1="2" y1="22" x2="22" y2="22"></line><polyline points="15.5 5.5 12 9 8.5 5.5"></polyline>',
    moon: '<path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.7 6.7 0 0 0 9.9 9.9z"></path>',
    feather: '<path d="M19.8 12.2a5.7 5.7 0 0 0-8-8L5.3 10.7v8h8z"></path><line x1="15.4" y1="7.6" x2="3.3" y2="19.7"></line><line x1="16.7" y1="14.5" x2="9" y2="14.5"></line>',
    star: '<polygon points="12 2.5 14.8 8.4 21.2 9.3 16.6 13.8 17.7 20.2 12 17.2 6.3 20.2 7.4 13.8 2.8 9.3 9.2 8.4 12 2.5"></polygon>',
    owl: '<path d="M12 3.2c-3.7 0-6.5 2.9-6.5 6.6v3.6a6.5 6.5 0 0 0 13 0v-3.6c0-3.7-2.8-6.6-6.5-6.6z"></path><path d="M7 5.6 5.2 3M17 5.6 18.8 3"></path><path fill="currentColor" stroke="none" d="M9.4 12a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM14.6 12a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"></path><path fill="currentColor" stroke="none" d="M12 13.6l-1.1 2.1h2.2z"></path>',
    candle: '<path fill="currentColor" stroke="none" d="M12 2.3c1.3 1.9 2 3.3 2 4.6a2 2 0 1 1-4 0c0-1.3.7-2.7 2-4.6z"></path><rect x="9.7" y="8.6" width="4.6" height="10.6" rx="1.1"></rect><line x1="6.5" y1="19.2" x2="17.5" y2="19.2"></line>',
    wave: '<path d="M8 12.5v-7a1.4 1.4 0 1 1 2.8 0v5.5"></path><path d="M10.8 10.6V4.4a1.4 1.4 0 1 1 2.8 0v6.2"></path><path d="M13.6 10.6V5.8a1.4 1.4 0 1 1 2.8 0v6.4"></path><path d="M16.4 12.2v-3a1.4 1.4 0 1 1 2.8 0v6.3c0 3.4-2.4 6-6 6h-1.4c-2 0-3.2-.6-4.4-2.1L4 14.7a1.5 1.5 0 0 1 2.2-2l1.8 1.9"></path>'
  };

  function greetIconMarkup_(key) {
    var body = GREET_ICONS[key] || GREET_ICONS.star;
    return '<svg class="bai-greet-icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  // Picks a random, time-of-day-aware greeting so the welcome card feels
  // fresh on every visit instead of always saying "Hello".
  function getTimeGreeting() {
    var hour = new Date().getHours();
    var options;
    if (hour >= 5 && hour < 12) {
      options = [
        { text: 'Good Morning', icon: 'sun' },
        { text: 'Rise and Shine', icon: 'sunrise' },
        { text: 'Early Bird', icon: 'feather' },
        { text: 'Hello', icon: 'wave' }
      ];
    } else if (hour >= 12 && hour < 17) {
      options = [
        { text: 'Good Afternoon', icon: 'sun' },
        { text: 'Hope Your Day Is Going Well', icon: 'star' },
        { text: 'Hello', icon: 'wave' }
      ];
    } else if (hour >= 17 && hour < 21) {
      options = [
        { text: 'Good Evening', icon: 'sunset' },
        { text: 'Winding Down', icon: 'moon' },
        { text: 'Hello', icon: 'wave' }
      ];
    } else {
      options = [
        { text: 'Night Owl', icon: 'owl' },
        { text: 'Working Late', icon: 'moon' },
        { text: 'Burning the Midnight Oil', icon: 'candle' }
      ];
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  function buildMarkup() {
    var container = document.getElementById('page-bai');
    if (!container || built) return;

    container.innerHTML =
      '<div class="bai-page-wrap">' +
        '<div class="bai-topbar">' +
          '<button type="button" class="bai-back-link" id="bai-back-btn"><span class="material-icons-round">arrow_back</span>Back to Home</button>' +
          '<div class="bai-topbar-right">' +
            '<button type="button" class="bai-clear-btn" id="bai-clear-btn" title="Clear chat" aria-label="Clear chat"><span class="material-icons-round">delete_outline</span></button>' +
            '<span class="bai-online-badge"><span class="bai-online-dot"></span>AI Online</span>' +
          '</div>' +
        '</div>' +
        '<div class="bai-chat-shell">' +
        '<aside class="bai-ai-sidebar">' +
          '<div class="bai-header-row">' +
            '<div class="bai-header-icon">' + BAI_ICON_SVG + '</div>' +
            '<div class="bai-header-text"><h1>Batch Analysis with <span class="bai-pulse-word">AI</span></h1><p>Your smart assistant for batch analysis insights.</p></div>' +
          '</div>' +
          '<div class="bai-sidebar-image-wrap"><img class="bai-sidebar-image" src="https://res.cloudinary.com/dnrgcigsj/image/upload/v1785843827/ChatGPT_Image_Aug_4_2026_05_13_26_PM_omd7ui.png" alt="Batch analysis illustration"></div>' +
        '</aside>' +
        '<div class="bai-chat-main">' +
        '<div class="bai-content-scroll" id="bai-content-scroll">' +
          '<div id="bai-empty-state">' +
            '<div class="bai-welcome-card">' +
              '<span class="bai-welcome-sparkle">' + BAI_ICON_SVG + '</span>' +
              '<h2>' + (function () { var g = getTimeGreeting(); return g.text + ', ' + escapeHtml(getUserFirstName()) + '! ' + greetIconMarkup_(g.icon); })() + '</h2>' +
              '<p>How can I help you with batch analysis today?</p>' +
            '</div>' +
          '</div>' +
          '<div class="bai-chat-log" id="bai-chat-log" style="display:none;"></div>' +
        '</div>' +
        '<button type="button" class="bai-scroll-latest" id="bai-scroll-latest" title="Go to latest message" aria-label="Go to latest message"><span class="material-icons-round">keyboard_double_arrow_down</span></button>' +
        '<div class="bai-suggest-panel" id="bai-suggest-panel"></div>' +
        '<div class="bai-attach-chips" id="bai-attach-chips"></div>' +
        '<div class="bai-input-bar">' +
          '<input type="file" id="bai-file-input" multiple style="display:none;">' +
          '<div class="bai-input-row">' +
            '<button type="button" class="bai-icon-btn" id="bai-attach-btn" title="Attach files"><span class="material-icons-round">attach_file</span></button>' +
            '<textarea class="bai-chat-textarea" id="bai-chat-input" rows="1" placeholder="Type your question here... (Enter to send, Shift+Enter for new line)"></textarea>' +
            '<button type="button" class="bai-icon-btn" id="bai-suggest-btn" title="Suggestions"><span class="material-icons-round">tips_and_updates</span></button>' +
            '<button type="button" class="bai-send-btn" id="bai-send-btn" title="Send" aria-label="Send"><span class="material-icons-round">send</span></button>' +
          '</div>' +
          '<div class="bai-input-hint"><span class="material-icons-round">info</span>Batch Analysis AI can make mistakes — please verify important numbers and details.</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bai-clear-confirm" id="bai-clear-confirm" hidden><div class="bai-clear-confirm-card" role="dialog" aria-modal="true" aria-labelledby="bai-clear-confirm-title"><span class="material-icons-round bai-clear-confirm-icon">delete_outline</span><h2 id="bai-clear-confirm-title">Clear this chat?</h2><p>Are you sure you want to clear this chat? This action cannot be undone.</p><div class="bai-clear-confirm-actions"><button type="button" class="bai-clear-cancel" id="bai-clear-cancel">No, keep it</button><button type="button" class="bai-clear-approve" id="bai-clear-approve">Yes, clear chat</button></div></div></div>';

    built = true;
    wireEvents();
  }

  function showEmptyState() {
    var empty = document.getElementById('bai-empty-state');
    var log = document.getElementById('bai-chat-log');
    if (empty) empty.style.display = '';
    if (log) { log.style.display = 'none'; log.innerHTML = ''; }
  }

  function showChatLog() {
    var empty = document.getElementById('bai-empty-state');
    var log = document.getElementById('bai-chat-log');
    if (empty) empty.style.display = 'none';
    if (log) log.style.display = 'flex';
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal formatting: **bold** and "- " bullet lines -> <ul><li>.
  function formatText(text) {
    var lines = String(text).split('\n');
    var html = '';
    var inList = false;
    lines.forEach(function (line) {
      var isBullet = /^\s*-\s+/.test(line);
      if (isBullet) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + escapeHtml(line.replace(/^\s*-\s+/, '')).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        var escaped = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html += (html ? '<br>' : '') + escaped;
      }
    });
    if (inList) html += '</ul>';
    return html;
  }

  function appendMessage(role, text, files) {
    var log = document.getElementById('bai-chat-log');
    if (!log) return null;
    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--' + role;
    var avatarInner = role === 'user' ? '<span class="material-icons-round">person</span>' : BAI_ICON_SVG;
    var filesHtml = '';
    if (role === 'user' && files && files.length) {
      filesHtml = '<div class="bai-msg-files">' + files.map(function (f) {
        if (isImageFile(f)) {
          return '<img class="bai-msg-file-thumb" src="' + URL.createObjectURL(f) + '" alt="' + escapeHtml(f.name) + '">';
        }
        return '<span class="bai-msg-file-chip"><span class="material-icons-round">description</span>' + escapeHtml(f.name) + '</span>';
      }).join('') + '</div>';
    }
    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + avatarInner + '</div>' +
      '<div class="bai-msg-bubble">' + (text ? formatText(text) : '') + filesHtml + '</div>';
    log.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function appendTyping() {
    var log = document.getElementById('bai-chat-log');
    if (!log) return null;
    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--bot';
    wrap.id = 'bai-typing-msg';
    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + BAI_ICON_SVG + '</div>' +
      '<div class="bai-msg-bubble"><div class="bai-typing"><span></span><span></span><span></span></div></div>';
    log.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function removeTyping() {
    var el = document.getElementById('bai-typing-msg');
    if (el) el.remove();
  }

  function updateScrollToLatestButton() {
    var scroller = document.getElementById('bai-content-scroll');
    var button = document.getElementById('bai-scroll-latest');
    if (!scroller || !button) return;
    var distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    button.classList.toggle('is-visible', distanceFromBottom > 96);
  }

  function scrollToBottom(smooth) {
    var scroller = document.getElementById('bai-content-scroll');
    if (!scroller) return;
    if (smooth && scroller.scrollTo) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    else scroller.scrollTop = scroller.scrollHeight;
    setTimeout(updateScrollToLatestButton, smooth ? 350 : 0);
  }

  // ---------------------------------------------------------------------
  // Simple rule-based bot — keyword matching, fully local, no network.
  // ---------------------------------------------------------------------
  var GREETING_KEYWORDS = ['hi', 'hello', 'hey', 'assalamu', 'salam'];
  var GREETING_REPLY = 'Hello! How can I help you today?';
  var FALLBACK_REPLY = 'Sorry, I can\'t help with that right now.';

  function getBotReply(userText, fileCount) {
    var text = userText.toLowerCase();
    for (var i = 0; i < GREETING_KEYWORDS.length; i++) {
      if (text.indexOf(GREETING_KEYWORDS[i]) !== -1) return GREETING_REPLY;
    }
    if (!userText && fileCount) {
      return 'Got ' + fileCount + ' file' + (fileCount > 1 ? 's' : '') + ' — thanks! I can\'t open attachments yet, but they\'re noted for this conversation.';
    }
    return FALLBACK_REPLY;
  }

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------
  function sendText(text, files) {
    text = String(text || '').trim();
    files = files || [];
    if (!text && !files.length) return;

    showChatLog();
    appendMessage('user', text, files);
    history.push({ role: 'user', text: text, files: files.map(function (f) { return f.name; }) });

    appendTyping();
    var sendBtn = document.getElementById('bai-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    // Small delay so the typing indicator feels natural — still fully local.
    setTimeout(function () {
      var reply = getBotReply(text, files.length);
      removeTyping();
      appendMessage('bot', reply);
      history.push({ role: 'bot', text: reply });
      if (sendBtn) sendBtn.disabled = false;
    }, 450);
  }

  function sendFromInput() {
    var input = document.getElementById('bai-chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text && !selectedFiles.length) return;
    input.value = '';
    autoGrow(input);
    var files = selectedFiles.slice();
    selectedFiles = [];
    renderAttachChips();
    sendText(text, files);
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function isImageFile(f) {
    return !!(f && f.type && f.type.indexOf('image/') === 0);
  }

  function renderAttachChips() {
    var wrap = document.getElementById('bai-attach-chips');
    if (!wrap) return;
    if (!selectedFiles.length) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    wrap.style.display = 'flex';
    wrap.innerHTML = selectedFiles.map(function (f, idx) {
      if (isImageFile(f)) {
        return '<div class="bai-attach-chip bai-attach-chip--image">' +
          '<img class="bai-attach-thumb" src="' + URL.createObjectURL(f) + '" alt="' + escapeHtml(f.name) + '">' +
          '<button type="button" class="bai-attach-remove bai-attach-remove--image" data-idx="' + idx + '" aria-label="Remove image"><span class="material-icons-round">close</span></button></div>';
      }
      return '<div class="bai-attach-chip"><span class="material-icons-round">description</span>' +
        '<span class="bai-attach-name">' + escapeHtml(f.name) + '</span>' +
        '<button type="button" class="bai-attach-remove" data-idx="' + idx + '" aria-label="Remove file"><span class="material-icons-round">close</span></button></div>';
    }).join('');
    var removeBtns = wrap.querySelectorAll('.bai-attach-remove');
    for (var i = 0; i < removeBtns.length; i++) {
      removeBtns[i].addEventListener('click', function (evt) {
        var idx = parseInt(evt.currentTarget.getAttribute('data-idx'), 10);
        selectedFiles.splice(idx, 1);
        renderAttachChips();
      });
    }
  }

  function toggleSuggestPanel() {
    var panel = document.getElementById('bai-suggest-panel');
    if (!panel) return;
    var isOpen = panel.style.display === 'flex';
    if (isOpen) {
      panel.style.display = 'none';
      return;
    }
    if (!panel.childElementCount) {
      panel.innerHTML = SUGGESTIONS.map(function (s) {
        return '<button type="button" class="bai-suggest-chip">' + escapeHtml(s) + '</button>';
      }).join('');
      var chips = panel.querySelectorAll('.bai-suggest-chip');
      for (var i = 0; i < chips.length; i++) {
        chips[i].addEventListener('click', function (evt) {
          var input = document.getElementById('bai-chat-input');
          if (input) {
            input.value = evt.currentTarget.textContent;
            autoGrow(input);
            input.focus();
          }
          panel.style.display = 'none';
        });
      }
    }
    panel.style.display = 'flex';
  }

  function wireEvents() {
    var input = document.getElementById('bai-chat-input');
    var sendBtn = document.getElementById('bai-send-btn');
    var clearBtn = document.getElementById('bai-clear-btn');
    var clearConfirm = document.getElementById('bai-clear-confirm');
    var clearCancel = document.getElementById('bai-clear-cancel');
    var clearApprove = document.getElementById('bai-clear-approve');
    var backBtn = document.getElementById('bai-back-btn');
    var attachBtn = document.getElementById('bai-attach-btn');
    var fileInput = document.getElementById('bai-file-input');
    var suggestBtn = document.getElementById('bai-suggest-btn');
    var scrollLatestBtn = document.getElementById('bai-scroll-latest');
    var contentScroller = document.getElementById('bai-content-scroll');

    if (input) {
      input.addEventListener('input', function () { autoGrow(input); });
      input.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          sendFromInput();
        }
      });
      input.addEventListener('paste', function (evt) {
        var items = (evt.clipboardData && evt.clipboardData.items) || [];
        var pastedImages = [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0) {
            var file = items[i].getAsFile();
            if (file) pastedImages.push(file);
          }
        }
        if (pastedImages.length) {
          evt.preventDefault();
          pastedImages.forEach(function (f) { selectedFiles.push(f); });
          renderAttachChips();
        }
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', sendFromInput);
    if (clearBtn && clearConfirm) clearBtn.addEventListener('click', function () { clearConfirm.hidden = false; });
    if (clearCancel && clearConfirm) clearCancel.addEventListener('click', function () { clearConfirm.hidden = true; });
    if (clearApprove && clearConfirm) {
      clearApprove.addEventListener('click', function () {
        history = [];
        selectedFiles = [];
        renderAttachChips();
        showEmptyState();
        clearConfirm.hidden = true;
      });
    }
    if (backBtn) backBtn.addEventListener('click', closeBaiPage);

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var newFiles = Array.prototype.slice.call(fileInput.files || []);
        newFiles.forEach(function (f) { selectedFiles.push(f); });
        fileInput.value = ''; // reset so re-picking the same file(s) still fires 'change'
        renderAttachChips();
      });
    }
    if (suggestBtn) suggestBtn.addEventListener('click', toggleSuggestPanel);
    if (scrollLatestBtn) scrollLatestBtn.addEventListener('click', function () { scrollToBottom(true); });
    if (contentScroller) contentScroller.addEventListener('scroll', updateScrollToLatestButton, { passive: true });

  }

  // ---------------------------------------------------------------------
  // Open / close the Batch Analysis with AI page (independent of the
  // sidebar nav-item system, since the launcher lives in the topbar rather
  // than the sidebar — same pattern as ai.js).
  // ---------------------------------------------------------------------
  function isBaiPageOpen_() {
    var target = document.getElementById('page-bai');
    return !!(target && target.style.display !== 'none' && built);
  }

  function openBaiPage() {
    // Admin-controlled access (USERS sheet Column K). window.FMS may not be
    // ready yet on very first paint, so an unavailable check fails open
    // (same "unrestricted until an admin opts in" convention as elsewhere).
    if (window.FMS && typeof window.FMS.hasAiAccess === 'function' && !window.FMS.hasAiAccess('ai-batch-analysis')) {
      if (typeof window.FMS.showToast === 'function') {
        window.FMS.showToast('error', 'Access Restricted', 'You do not have access to Batch Analysis with AI. Contact an admin.');
      }
      return;
    }

    injectStyles();
    buildMarkup();

    lastActiveNavItem = document.querySelector('.nav-item.active[data-page]');
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.page-view').forEach(function (v) { v.style.display = 'none'; });
    var contentArea = document.querySelector('.content-area');
    if (contentArea) contentArea.classList.remove('ai-chat--preprod', 'ai-chat--trio');
    if (contentArea) contentArea.classList.add('ai-chat-active', 'ai-chat--batch');

    var target = document.getElementById('page-bai');
    if (target) target.style.display = '';
  }

  function closeBaiPage() {
    if (lastActiveNavItem) {
      lastActiveNavItem.click();
      return;
    }
    var home = document.querySelector('.nav-item[data-page="home"]');
    if (home) home.click();
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    var btn = document.getElementById('topbar-bai-btn');
    if (btn) btn.addEventListener('click', openBaiPage);

    // Access revoked mid-session (see app.js reEvaluateAiAccess_) while this
    // page happens to be open right now — close it back to the previous view.
    window.addEventListener('fms:ai-access-revoked', function (evt) {
      if (evt && evt.detail && evt.detail.id === 'ai-batch-analysis' && isBaiPageOpen_()) closeBaiPage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
