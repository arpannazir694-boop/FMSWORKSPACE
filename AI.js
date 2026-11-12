// Global helper for downloading tables as Excel .xlsx
if (typeof window.downloadTableAsExcel !== 'function') {
  window.downloadTableAsExcel = function (tableId, fileName) {
    try {
      var table = document.getElementById(tableId);
      if (!table) return;
      if (typeof XLSX === 'undefined') {
        alert('SheetJS library is loading, please try again in a moment.');
        return;
      }
      var wb = XLSX.utils.table_to_book(table, { sheet: "Sheet1" });
      var cleanName = (fileName || "Report").replace(/[^a-zA-Z0-9_-]/g, "_");
      XLSX.writeFile(wb, cleanName + ".xlsx");
    } catch (err) {
      console.error("Excel export error:", err);
    }
  };
}

// Fallback clipboard copying helper for browsers
if (typeof window.fmsFallbackCopyText !== 'function') {
  window.fmsFallbackCopyText = function (text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof cb === 'function') cb(ok);
    } catch (e) {
      if (typeof cb === 'function') cb(false);
    }
  };
}

// Global helper for copying table contents to clipboard (TSV + HTML)
if (typeof window.copyTableToClipboard !== 'function') {
  window.copyTableToClipboard = function (btnEl, tableId) {
    try {
      var table = document.getElementById(tableId);
      if (!table) return;

      var tsvRows = [];
      var rows = table.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        var cells = rows[i].querySelectorAll('th, td');
        var rowData = [];
        for (var j = 0; j < cells.length; j++) {
          var cellText = (cells[j].innerText || cells[j].textContent || '').trim();
          cellText = cellText.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
          rowData.push(cellText);
        }
        tsvRows.push(rowData.join('\t'));
      }

      var tsvString = tsvRows.join('\n');
      var htmlString = table.outerHTML;

      function setFeedback(success) {
        if (!btnEl) return;
        var icon = btnEl.querySelector('.material-icons-round');
        var origIcon = icon ? icon.textContent : 'content_copy';
        if (icon) icon.textContent = success ? 'check' : 'close';
        btnEl.classList.add(success ? 'is-copied' : 'is-error');
        btnEl.setAttribute('title', success ? 'Copied!' : 'Failed');

        setTimeout(function () {
          if (icon) icon.textContent = origIcon;
          btnEl.classList.remove('is-copied', 'is-error');
          btnEl.setAttribute('title', 'Copy table to clipboard');
        }, 2000);
      }

      if (navigator.clipboard && window.ClipboardItem) {
        try {
          var textBlob = new Blob([tsvString], { type: 'text/plain' });
          var htmlBlob = new Blob([htmlString], { type: 'text/html' });
          navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': textBlob,
              'text/html': htmlBlob
            })
          ]).then(function () {
            setFeedback(true);
          }).catch(function () {
            if (navigator.clipboard.writeText) {
              navigator.clipboard.writeText(tsvString).then(function () { setFeedback(true); }).catch(function () { window.fmsFallbackCopyText(tsvString, setFeedback); });
            } else {
              window.fmsFallbackCopyText(tsvString, setFeedback);
            }
          });
          return;
        } catch (e) {}
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsvString).then(function () {
          setFeedback(true);
        }).catch(function () {
          window.fmsFallbackCopyText(tsvString, setFeedback);
        });
      } else {
        window.fmsFallbackCopyText(tsvString, setFeedback);
      }
    } catch (err) {
      console.error("Table copy error:", err);
    }
  };
}

// Global helper for copying chat message text
window.copyMessageText = function (btnEl) {
  try {
    if (!btnEl) return;
    var wrap = btnEl.closest('.ai-msg-content-wrap') || btnEl.closest('.bai-msg-content-wrap') || btnEl.closest('.trio-msg-content-wrap') ||
               btnEl.closest('.ai-msg') || btnEl.closest('.bai-msg') || btnEl.closest('.trio-msg');
    var msgBubble = wrap ? wrap.querySelector('.ai-msg-bubble, .bai-msg-bubble, .trio-msg-bubble') : null;
    if (!msgBubble) {
      msgBubble = btnEl.closest('.ai-msg-bubble') || btnEl.closest('.bai-msg-bubble') || btnEl.closest('.trio-msg-bubble');
    }
    if (!msgBubble) return;

    var clone = msgBubble.cloneNode(true);
    var toRemove = clone.querySelectorAll(
      '.ai-msg-actions, .bai-msg-actions, .trio-msg-actions, ' +
      '.ai-think-badge, .bai-think-badge, .trio-think-badge, ' +
      '.ai-table-toolbar, .bai-table-toolbar, .trio-table-toolbar, ' +
      '.ai-table-actions, .bai-table-actions, .trio-table-actions'
    );
    for (var k = 0; k < toRemove.length; k++) {
      toRemove[k].remove();
    }

    var textToCopy = (clone.innerText || clone.textContent || '').trim();

    function setFeedback(success) {
      var icon = btnEl.querySelector('.material-icons-round');
      var origIcon = icon ? icon.textContent : 'content_copy';
      if (icon) icon.textContent = success ? 'check' : 'close';
      btnEl.classList.add(success ? 'is-copied' : 'is-error');
      btnEl.setAttribute('title', success ? 'Copied!' : 'Failed');

      setTimeout(function () {
        if (icon) icon.textContent = origIcon;
        btnEl.classList.remove('is-copied', 'is-error');
        btnEl.setAttribute('title', 'Copy message');
      }, 2000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(function () {
        setFeedback(true);
      }).catch(function () {
        window.fmsFallbackCopyText(textToCopy, setFeedback);
      });
    } else {
      window.fmsFallbackCopyText(textToCopy, setFeedback);
    }
  } catch (err) {
    console.error("Message copy error:", err);
  }
};

// Global helper for pasting images or Excel tabular data
window.fmsHandleChatPaste = function (evt, selectedFiles, onAttached, themeOpts) {
  var clipboardData = evt.clipboardData || window.clipboardData;
  if (!clipboardData) return;

  var plainText = (clipboardData.getData('text/plain') || '').trim();
  var htmlData = clipboardData.getData('text/html') || '';

  // 1. Detect if this is Excel, Google Sheets, or tabular/text data
  var isExcelOrTable = !!(
    (htmlData && (
      htmlData.indexOf('<table') !== -1 ||
      htmlData.indexOf('Excel.Sheet') !== -1 ||
      htmlData.indexOf('urn:schemas-microsoft-com:office:excel') !== -1 ||
      htmlData.indexOf('data-sheets-root') !== -1 ||
      htmlData.indexOf('google-sheets-html-origin') !== -1
    )) ||
    (plainText && (plainText.indexOf('\t') !== -1 || plainText.indexOf('\n') !== -1))
  );

  var hasPlainText = plainText.length > 0;

  // ---------------------------------------------------------------------------
  // EXCEL & TEXT PASTING: Always paste as TEXT directly into the input/textarea.
  // NEVER convert to an image attachment, and ignore Excel's synthetic image/png.
  // ---------------------------------------------------------------------------
  if (isExcelOrTable || hasPlainText) {
    var target = evt.target || document.activeElement;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
      // If plainText is missing but htmlData has an HTML table, extract table text as TSV
      if (!hasPlainText && htmlData && htmlData.indexOf('<table') !== -1) {
        evt.preventDefault();
        try {
          var parser = new DOMParser();
          var doc = parser.parseFromString(htmlData, 'text/html');
          var trs = doc.querySelectorAll('tr');
          var extractedLines = [];
          for (var r = 0; r < trs.length; r++) {
            var cells = [];
            var tds = trs[r].querySelectorAll('th, td');
            for (var c = 0; c < tds.length; c++) {
              cells.push((tds[c].innerText || tds[c].textContent || '').trim());
            }
            if (cells.length > 0 && cells.some(function (v) { return v.length > 0; })) {
              extractedLines.push(cells.join('\t'));
            }
          }
          if (extractedLines.length > 0) {
            var extractedText = extractedLines.join('\n');
            var start = target.selectionStart || 0;
            var end = target.selectionEnd || 0;
            var val = target.value || '';
            target.value = val.substring(0, start) + extractedText + val.substring(end);
            target.selectionStart = target.selectionEnd = start + extractedText.length;
            if (typeof autoGrow === 'function') autoGrow(target);
            target.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch (e) {
          console.warn('[fmsHandleChatPaste] table text extraction error:', e);
        }
      } else {
        // Standard text/Excel paste: let the browser paste natively into the textarea.
        // We do NOT preventDefault, so native undo/redo & cursor placement work seamlessly.
        setTimeout(function () {
          if (typeof autoGrow === 'function') autoGrow(target);
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }, 0);
      }
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // 2. PURE IMAGE PASTING: Screenshots (Snipping Tool, PrintScreen, Win+Shift+S)
  // Only reached when there is NO plain text and it's NOT an Excel table.
  // ---------------------------------------------------------------------------
  var items = clipboardData.items || [];
  var imageFiles = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0) {
      var file = items[i].getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (imageFiles.length > 0) {
    evt.preventDefault();
    imageFiles.forEach(function (f) { selectedFiles.push(f); });
    if (typeof onAttached === 'function') onAttached();
    return;
  }
};

// =============================================================================
// ai.js -- "Pre-Production AI" page
// =============================================================================
(function () {
  'use strict';

  var history = [];       // [{ role: 'user'|'bot', text, isThink }]
  var lastActiveNavItem = null;
  var built = false;
  var selectedFiles = [];
  var SESSIONS_KEY = 'fms_ai_sessions_ai';
  var activeSessionId = null;
  var sessions = []; // [{ id, title, timestamp, messages }]
  var isThinkMode = false;

  function updateThinkUI() {
    var heroBtn = document.getElementById('ai-think-btn');
    var dockedBtn = document.getElementById('ai-think-btn-docked');
    [heroBtn, dockedBtn].forEach(function (btn) {
      if (!btn) return;
      btn.classList.toggle('is-active', isThinkMode);
      btn.setAttribute('aria-pressed', isThinkMode ? 'true' : 'false');
      btn.setAttribute('title', isThinkMode
        ? 'Think Mode: ON (Deep Analysis with Gemini 3.8 Flash) - Click for Fast Chat'
        : 'Think Mode: OFF (Fast Chat with Gemini Flash-Lite) - Click for Deep Analysis');
    });
  }

  function toggleThinkMode() {
    isThinkMode = !isThinkMode;
    updateThinkUI();
  }

  function loadSessions() {
    try {
      var raw = localStorage.getItem(SESSIONS_KEY);
      sessions = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(sessions)) sessions = [];
    } catch (e) {
      sessions = [];
    }
  }

  function saveSessions() {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {}
  }

  function getActiveSession() {
    if (!activeSessionId) return null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === activeSessionId) return sessions[i];
    }
    return null;
  }

  function formatTimestamp(ts) {
    var d = new Date(ts);
    var now = new Date();
    var isToday = d.toDateString() === now.toDateString();
    var hours = d.getHours();
    var minutes = d.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    var strTime = hours + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + ampm;
    if (isToday) return strTime;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + strTime;
  }

  function renderHistoryList() {
    var listEl = document.getElementById('ai-history-list');
    if (!listEl) return;

    if (!sessions.length) {
      listEl.innerHTML = '<div class="ai-history-empty">No previous chats</div>';
      return;
    }

    listEl.innerHTML = sessions.map(function (s) {
      var isActive = s.id === activeSessionId;
      return '<div class="ai-history-item' + (isActive ? ' active' : '') + '" data-id="' + s.id + '">' +
        '<div class="ai-history-item-content">' +
          '<div class="ai-history-title" title="' + escapeHtml(s.title) + '">' + escapeHtml(s.title) + '</div>' +
          '<div class="ai-history-time">' + formatTimestamp(s.timestamp) + '</div>' +
        '</div>' +
        '<button type="button" class="ai-history-delete" data-del="' + s.id + '" title="Delete chat">' +
          '<svg class="fms-delete-bin-icon" aria-hidden="true"><use href="#icon-delete-bin" xlink:href="#icon-delete-bin"></use></svg>' +
        '</button>' +
      '</div>';
    }).join('');

    var items = listEl.querySelectorAll('.ai-history-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function (evt) {
        if (evt.target.closest('.ai-history-delete')) return;
        var sid = evt.currentTarget.getAttribute('data-id');
        if (sid) switchSession(sid);
      });
    }

    var delBtns = listEl.querySelectorAll('.ai-history-delete');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function (evt) {
        evt.stopPropagation();
        var sid = evt.currentTarget.getAttribute('data-del');
        if (sid) deleteSession(sid);
      });
    }
  }

  function createNewChat() {
    activeSessionId = null;
    history = [];
    selectedFiles = [];
    renderAttachChips();
    showEmptyState();
    renderHistoryList();
    var heroInput = document.getElementById('ai-chat-input');
    if (heroInput) {
      heroInput.value = '';
      heroInput.focus();
    }
  }

  function switchSession(id) {
    activeSessionId = id;
    var session = getActiveSession();
    if (!session) {
      createNewChat();
      return;
    }

    history = session.messages ? session.messages.slice() : [];
    selectedFiles = [];
    renderAttachChips();
    renderHistoryList();

    if (!history.length) {
      showEmptyState();
      return;
    }

    showChatLog();
    var log = document.getElementById('ai-chat-log');
    if (log) {
      log.innerHTML = '';
      history.forEach(function (m) {
        appendMessage(m.role, m.text, m.files || [], !!m.isThink);
      });
    }
    var dockedInput = document.getElementById('ai-chat-input-docked');
    if (dockedInput) {
      dockedInput.value = '';
      dockedInput.focus();
    }
  }

  function deleteSession(id) {
    sessions = sessions.filter(function (s) { return s.id !== id; });
    saveSessions();
    if (activeSessionId === id) {
      if (sessions.length) {
        switchSession(sessions[0].id);
      } else {
        createNewChat();
      }
    } else {
      renderHistoryList();
    }
  }

  function clearAllSessions() {
    sessions = [];
    saveSessions();
    createNewChat();
  }  // File objects staged for the next outgoing message
    var SUGGESTIONS = [
    'Analyze key performance metrics and trends',
    'Generate a structured summary report',
    'Optimize production and delivery schedule',
    'Extract and calculate data from Excel sheet'
  ];

  function injectStyles() {
    // Loaded via ai.css
  }

  function getUserFirstName() {
    var el = document.getElementById('topbar-username');
    var name = el && el.textContent ? el.textContent.trim() : '';
    if (!name) {
      try { name = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user') || ''; } catch (e) {}
    }
    if (!name || name.toLowerCase() === 'user') return 'there';
    return name.split(' ')[0];
  }

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
    return '<svg class="ai-greet-icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

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

  function updateWelcomeGreeting() {
    var heading = document.getElementById('ai-welcome-heading');
    var g = getTimeGreeting();
    var uname = getUserFirstName();
    if (heading) {
      heading.innerHTML = g.text + ', ' + escapeHtml(uname) + '! ' + greetIconMarkup_(g.icon);
    }
    var nameEl = document.getElementById('ai-user-name');
    if (nameEl) {
      nameEl.textContent = (uname === 'there') ? 'User' : uname;
    }
  }

  function buildMarkup() {
    var container = document.getElementById('page-ai');
    if (!container || built) return;
    loadSessions();
    updateWelcomeGreeting();
    renderHistoryList();
    built = true;
    wireEvents();
  }

  function showEmptyState() {
    var empty = document.getElementById('ai-empty-state');
    var log = document.getElementById('ai-chat-log');
    var docked = document.getElementById('ai-docked-input-bar');
    if (empty) empty.style.display = '';
    if (log) { log.style.display = 'none'; log.innerHTML = ''; }
    if (docked) docked.style.display = 'none';
  }

  function showChatLog() {
    var empty = document.getElementById('ai-empty-state');
    var log = document.getElementById('ai-chat-log');
    var docked = document.getElementById('ai-docked-input-bar');
    if (empty) empty.style.display = 'none';
    if (log) log.style.display = 'flex';
    if (docked) docked.style.display = 'flex';
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

  var tableCounter = 0;

  function formatText(text) {
    var raw = String(text || '');

    // 1. Process [GENERATE_IMAGE: description] tags
    raw = raw.replace(/\[GENERATE_IMAGE:\s*(.+?)\]/gi, function (_, imgPrompt) {
      var promptClean = imgPrompt.trim();
      var seed = Math.floor(Math.random() * 999999);
      var encoded = encodeURIComponent(promptClean);
      var imgUrl = 'https://image.pollinations.ai/prompt/' + encoded + '?width=1024&height=1024&nologo=true&seed=' + seed;
      return '<div class="ai-gen-image-card">' +
        '<a href="' + imgUrl + '" target="_blank" rel="noopener" title="View Fullscreen">' +
          '<img src="' + imgUrl + '" alt="' + escapeHtml(promptClean) + '" loading="lazy">' +
        '</a>' +
        '<div class="ai-gen-image-footer">' +
          '<span class="ai-gen-image-prompt" title="' + escapeHtml(promptClean) + '">' + escapeHtml(promptClean) + '</span>' +
          '<a href="' + imgUrl + '" download="AN_AI_Generated_Image.jpg" target="_blank" class="ai-gen-image-download">' +
            '<span class="material-icons-round">download</span> Save Image' +
          '</a>' +
        '</div>' +
      '</div>';
    });

    // 2. Process Markdown tables
    var lines = raw.split('\n');
    var html = '';
    var inList = false;
    var listType = 'ul';
    var inTable = false;
    var tableRows = [];

    function flushTable() {
      if (!tableRows.length) return '';
      tableCounter++;
      var tId = 'ai-tbl-' + tableCounter;
      var tHtml = '<div class="ai-table-container">' +
        '<div class="ai-table-toolbar">' +
          '<div class="ai-table-meta">' +
            '<span class="material-icons-round ai-table-meta-icon">table_chart</span>' +
            '<span class="ai-table-meta-title">Table</span>' +
          '</div>' +
          '<div class="ai-table-actions">' +
            '<button type="button" class="ai-table-btn ai-table-copy-btn" onclick="window.copyTableToClipboard(this, \'' + tId + '\')" title="Copy table to clipboard">' +
              '<span class="material-icons-round">content_copy</span>' +
              '<span class="ai-table-btn-label">Copy table</span>' +
              '<span class="ai-copy-toast">Copied!</span>' +
            '</button>' +
            '<button type="button" class="ai-table-btn ai-table-excel-btn" onclick="window.downloadTableAsExcel(\'' + tId + '\', \'AN_AI_Report\')" title="Download Excel (.xlsx)">' +
              '<span class="material-icons-round">table_view</span>' +
              '<span class="ai-table-btn-label">Excel</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="ai-table-scroll-wrapper">' +
          '<table class="ai-data-table" id="' + tId + '">';
      
      var isHeader = true;
      for (var r = 0; r < tableRows.length; r++) {
        var rowStr = tableRows[r].trim();
        // Check if separator line (|---|---|)
        if (/^\|?\s*[:\-]+\s*(\|\s*[:\-]+\s*)+\|?$/.test(rowStr)) {
          isHeader = false;
          continue;
        }
        var cols = rowStr.replace(/^\|/, '').replace(/\|$/, '').split('|');
        if (isHeader && r === 0) {
          tHtml += '<thead><tr>';
          cols.forEach(function (c) {
            tHtml += '<th>' + escapeHtml(c.trim()) + '</th>';
          });
          tHtml += '</tr></thead><tbody>';
        } else {
          tHtml += '<tr>';
          cols.forEach(function (c) {
            var parsed = escapeHtml(c.trim())
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>');
            tHtml += '<td>' + parsed + '</td>';
          });
          tHtml += '</tr>';
        }
      }
      tHtml += '</tbody></table></div></div>';
      tableRows = [];
      return tHtml;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var isTableRow = /^\|.*\|\s*$/.test(line.trim());

      if (isTableRow) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        inTable = true;
        tableRows.push(line);
      } else {
        if (inTable) {
          html += flushTable();
          inTable = false;
        }

        // Check for HTML image card preserved from regex
        if (line.indexOf('<div class="ai-gen-image-card">') !== -1) {
          if (inList) { html += '</' + listType + '>'; inList = false; }
          html += line;
          continue;
        }

        var isBullet = /^\s*[\*\-]\s+/.test(line);
        var isNumbered = /^\s*\d+\.\s+/.test(line);

        if (isBullet || isNumbered) {
          var currentType = isNumbered ? 'ol' : 'ul';
          if (!inList || listType !== currentType) {
            if (inList) html += '</' + listType + '>';
            html += '<' + currentType + '>';
            inList = true;
            listType = currentType;
          }
          var cleanLine = line.replace(/^\s*([\*\-]\s+|\d+\.\s+)/, '');
          var parsed = escapeHtml(cleanLine)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
          html += '<li>' + parsed + '</li>';
        } else {
          if (inList) { html += '</' + listType + '>'; inList = false; }
          var escaped = escapeHtml(line)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
          html += (html ? '<br>' : '') + escaped;
        }
      }
    }

    if (inTable) html += flushTable();
    if (inList) html += '</' + listType + '>';
    return html;
  }



  function appendMessage(role, text, files, isThink) {
    var log = document.getElementById('ai-chat-log');
    if (!log) return null;

    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg--' + role + (isThink ? ' ai-msg--think' : '');

    var iconName = role === 'user' ? 'person' : (isThink ? 'psychology' : 'auto_awesome');
    var thinkBadgeHtml = (role === 'bot' && isThink) ? '<div class="ai-think-badge"><span class="material-icons-round">psychology</span> Deep Analysis</div>' : '';

    var filesHtml = '';
    if (role === 'user' && files && files.length) {
      filesHtml = '<div class="ai-msg-files">' + files.map(function (f) {
        if (typeof f === 'string') {
          return '<span class="ai-msg-file-chip"><span class="material-icons-round">description</span>' + escapeHtml(f) + '</span>';
        }
        if (isImageFile(f)) {
          return '<img class="ai-msg-file-thumb" src="' + URL.createObjectURL(f) + '" alt="' + escapeHtml(f.name) + '">';
        }
        return '<span class="ai-msg-file-chip"><span class="material-icons-round">description</span>' + escapeHtml(f.name) + '</span>';
      }).join('') + '</div>';
    }

    var copyBtnHtml = (text || (files && files.length)) ?
      '<div class="ai-msg-actions">' +
        '<button type="button" class="ai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
          '<span class="material-icons-round">content_copy</span>' +
          '<span class="ai-copy-toast">Copied!</span>' +
        '</button>' +
      '</div>' : '';

    wrap.innerHTML =
      '<div class="ai-msg-avatar"><span class="material-icons-round">' + iconName + '</span></div>' +
      '<div class="ai-msg-content-wrap">' +
        '<div class="ai-msg-bubble">' + thinkBadgeHtml + (text ? formatText(text) : '') + filesHtml + '</div>' +
        copyBtnHtml +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function appendStreamMessage(role, text, onDone, isThink) {
    var log = document.getElementById('ai-chat-log');
    if (!log) {
      if (typeof onDone === 'function') onDone();
      return null;
    }

    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg--' + role + (isThink ? ' ai-msg--think' : '');
    var iconName = role === 'user' ? 'person' : (isThink ? 'psychology' : 'auto_awesome');
    var thinkBadgeHtml = (role === 'bot' && isThink) ? '<div class="ai-think-badge"><span class="material-icons-round">psychology</span> Deep Analysis</div>' : '';

    wrap.innerHTML =
      '<div class="ai-msg-avatar"><span class="material-icons-round">' + iconName + '</span></div>' +
      '<div class="ai-msg-content-wrap">' +
        '<div class="ai-msg-bubble">' + thinkBadgeHtml + '<div class="ai-stream-content"></div><span class="ai-stream-cursor"></span></div>' +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();

    var contentEl = wrap.querySelector('.ai-stream-content');
    var cursorEl = wrap.querySelector('.ai-stream-cursor');

    var tokens = String(text || '').split(/(\s+)/);
    var idx = 0;
    var currentText = '';

    var totalTokens = tokens.length;
    var interval = 20;
    var tokensPerTick = totalTokens > 300 ? 4 : (totalTokens > 140 ? 2 : 1);

    var timer = setInterval(function () {
      for (var t = 0; t < tokensPerTick && idx < tokens.length; t++) {
        currentText += tokens[idx++];
      }

      if (contentEl) {
        contentEl.innerHTML = formatText(currentText);
      }
      scrollToBottom();

      if (idx >= tokens.length) {
        clearInterval(timer);
        if (cursorEl) cursorEl.remove();
        if (contentEl) contentEl.innerHTML = formatText(text);
        var contentWrap = wrap.querySelector('.ai-msg-content-wrap');
        if (contentWrap && !contentWrap.querySelector('.ai-msg-actions')) {
          var actionsDiv = document.createElement('div');
          actionsDiv.className = 'ai-msg-actions';
          actionsDiv.innerHTML =
            '<button type="button" class="ai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
              '<span class="material-icons-round">content_copy</span>' +
              '<span class="ai-copy-toast">Copied!</span>' +
            '</button>';
          contentWrap.appendChild(actionsDiv);
        }
        scrollToBottom();
        if (typeof onDone === 'function') onDone();
      }
    }, interval);

    return wrap;
  }

  function appendTyping(isThink) {
    var log = document.getElementById('ai-chat-log');
    if (!log) return null;

    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg--bot' + (isThink ? ' ai-msg--think' : '');
    wrap.id = 'ai-typing-msg';

    var iconName = isThink ? 'psychology' : 'auto_awesome';
    var thinkLabel = isThink ? '<div class="ai-typing-think-label"><span class="material-icons-round">psychology</span> Deep Thinking... analyzing data</div>' : '';

    wrap.innerHTML =
      '<div class="ai-msg-avatar"><span class="material-icons-round">' + iconName + '</span></div>' +
      '<div class="ai-msg-content-wrap">' +
        '<div class="ai-msg-bubble">' + thinkLabel + '<div class="ai-typing"><span></span><span></span><span></span></div></div>' +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }



  function removeTyping() {

    var el = document.getElementById('ai-typing-msg');

    if (el) el.remove();

  }



  function updateScrollToLatestButton() {
    var scroller = document.getElementById('ai-content-scroll');
    var button = document.getElementById('ai-scroll-latest');
    if (!scroller || !button) return;
    var distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    button.classList.toggle('is-visible', distanceFromBottom > 96);
  }

  function scrollToBottom(smooth) {
    var scroller = document.getElementById('ai-content-scroll');
    if (!scroller) return;
    if (smooth && scroller.scrollTo) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    else scroller.scrollTop = scroller.scrollHeight;
    setTimeout(updateScrollToLatestButton, smooth ? 350 : 0);
  }


  // ---------------------------------------------------------------------

  // Simple rule-based bot ------ keyword matching, fully local, no network.

  // ---------------------------------------------------------------------

  var GREETING_KEYWORDS = ['hi', 'hello', 'hey', 'assalamu', 'salam', 'নমস্কার', 'হ্যালো', 'কেমন', 'नमस्ते', 'प्रणाम'];

  function getLoggedInUserName() {
    var raw = '';
    try {
      var u = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
      if (u && u.trim()) raw = u.trim();
    } catch (e) {}
    if (!raw) {
      var topbar = document.getElementById('topbar-user-name') || document.getElementById('profile-name');
      if (topbar && topbar.textContent && topbar.textContent.trim()) {
        var name = topbar.textContent.trim();
        if (name !== 'User' && name !== 'Admin') raw = name;
      }
    }
    if (!raw) return '';

    // Extract ONLY first name (omit title / surname, e.g. "Arpan Nazir" -> "Arpan")
    var parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      if (/^(mr\.?|ms\.?|mrs\.?|md\.?|dr\.?)$/i.test(parts[0])) {
        return parts[1] || parts[0];
      }
      return parts[0];
    }
    return raw;
  }

  function determineConversationLanguage(currentPrompt, historyArr) {
    var text = String(currentPrompt || '').trim();
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';

    var lower = text.toLowerCase();
    // Specific Hindi phonetic keywords
    if (/\b(namaste|kaisa|kaise|kya|aap|shukriya|dhanyawad|pranam|batao|karo|theek hai|kahiye)\b/.test(lower)) return 'hi';
    // Specific Bengali phonetic keywords
    if (/\b(kemon|acho|achen|ki|khobor|dhonnobad|thik|bolun|dekhao|koto|amake|kore|dao|apni|tumi)\b/.test(lower)) return 'bn';

    // If text is short or standard greeting/English ("hi", "hello", "hey", "help", "analyze", etc.):
    // Check if there is an active session history that already established Bengali or Hindi:
    if (historyArr && historyArr.length) {
      for (var i = historyArr.length - 1; i >= 0; i--) {
        var m = historyArr[i];
        if (m && (m.role === 'user' || !m.role)) {
          var t = m.text || '';
          if (/[\u0980-\u09FF]/.test(t)) return 'bn';
          if (/[\u0900-\u097F]/.test(t)) return 'hi';
          var lt = t.toLowerCase();
          if (/\b(namaste|kaisa|kaise|kya|aap|shukriya|dhanyawad|pranam|batao|karo)\b/.test(lt)) return 'hi';
          if (/\b(kemon|acho|achen|ki|khobor|dhonnobad|thik|bolun|dekhao|koto|amake|kore|dao)\b/.test(lt)) return 'bn';
        }
      }
    }

    // Default is strictly English
    return 'en';
  }

  function buildDynamicSystemInstruction(baseInstruction, promptText, historyArr) {
    var userName = getLoggedInUserName();
    var lang = determineConversationLanguage(promptText, historyArr);

    var langSection = "";
    if (lang === 'bn') {
      langSection = [
        "MANDATORY LANGUAGE: BENGALI (বাংলা)",
        "- The user is communicating in BENGALI (বাংলা).",
        "- You MUST respond 100% in fluent, professional, and natural BENGALI (বাংলা).",
        "- DO NOT reply in English or Hindi."
      ].join("\n");
    } else if (lang === 'hi') {
      langSection = [
        "MANDATORY LANGUAGE: HINDI (हिंदी)",
        "- The user is communicating in HINDI (हिंदी).",
        "- You MUST respond 100% in fluent, polite, and professional HINDI (हिंदी).",
        "- DO NOT reply in English or Bengali."
      ].join("\n");
    } else {
      langSection = [
        "MANDATORY LANGUAGE: ENGLISH",
        "- The user is communicating in ENGLISH (e.g. '" + (promptText || 'Hi') + "').",
        "- You MUST respond 100% in fluent, polite, and professional ENGLISH.",
        "- STRICT BAN: Do NOT reply in Bengali (বাংলা) or Hindi (हिंदी). Never output Bengali script when the user speaks in English."
      ].join("\n");
    }

    var userRule = [
      "",
      "==================================================",
      "CRITICAL DYNAMIC CONVERSATION DIRECTIVES (MUST OBEY):",
      langSection,
      "",
      "USER IDENTITY & ADDRESSING RULES:",
      userName ? "- The logged-in user's first name is: \"" + userName + "\"." : "- A logged-in authorized user is speaking with you.",
      userName
        ? "- Address the user gracefully, warmly, and respectfully using ONLY their first name (\"" + userName + "\") when appropriate (in English: \"" + userName + "\", in Bengali: \"" + userName + "\", in Hindi: \"" + userName + " जी\")."
        : "- Address the user respectfully.",
      userName ? "- STRICT RULE: Use ONLY their first name (\"" + userName + "\"). NEVER use their surname, title, or full name." : "",
      "- CRITICAL RULE: Do NOT repeat the user's name in every single message or sentence. Use it naturally and gracefully, such as in greetings, welcoming, major milestone summaries, or occasional polite conversational anchors.",
      "=================================================="
    ].join("\n");

    return baseInstruction + "\n" + userRule;
  }

  var GREETING_REPLY = 'Hello! How can I assist you today? Feel free to ask about data analytics, Excel report generation, or operational scheduling.';

  var FALLBACK_REPLY = 'Hello! I am your Data Analysis & Production Scheduling Assistant. Feel free to ask any questions regarding data analytics, Excel reports, or scheduling.';

  // ---------------------------------------------------------------------
  // Real Gemini AI Integration (Dual-Mode: Fast Chat vs Deep Analysis)
  // ---------------------------------------------------------------------
  var GEMINI_API_KEY = "AQ.Ab8RN6JXysa0sQMKMgJo6wGznX8Kdfxk25cPA3z8x6Ie4ZmlFw";

  // Fast chat models for normal conversations (sub-second lightning response)
  var GEMINI_FAST_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite"
  ];

  // Deep thinking models for exhaustive analysis & complex reasoning
  var GEMINI_THINK_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash"
  ];

  var SYSTEM_INSTRUCTION = [
    "IDENTITY & CREATOR RULES:",
    "- You are an expert Data Analyst & Operations AI, an intelligent part of the AN AI platform.",
    "- OWNER / CREATOR PRIVACY RULE: Do NOT volunteer or mention your owner's name (Arpan Nazir) or platform identity on simple greetings (like 'Hi', 'Hello') or in regular task answers.",
    "- ONLY IF the user specifically asks who created you, who owns you, or your identity: state clearly and politely in the active conversation language (English: 'I am a specialized Data Analyst component of AN AI, created by Arpan Nazir.', Bengali: 'আমি AN AI-এর একটি বিশেষায়িত ডেটা অ্যানালিস্ট অংশ এবং আমার মালিক অর্পণ নাজির (Arpan Nazir)।', Hindi: 'मैं AN AI का एक विशेष डेटा एनालिस्ट घटक हूँ और मेरे निर्माता अर्पण नाजिर (Arpan Nazir) हैं।').",
    "- ABSOLUTE RESTRICTION: NEVER mention or admit that you are Gemini, Google, OpenAI, ChatGPT, or Claude.",
    "",
    "ROLE & CORE EXPERTISE:",
    "You are a professional Data Analyst and Operations Planning specialist. You specialize in:",
    "1. Data Analysis (ডেটা অ্যানালাইসিস): Analyzing operational data, batch statistics, variances, trends, metrics, and KPIs.",
    "2. Report Generation (রিপোর্ট তৈরি): Formatting structured, insightful reports with clear summaries and key takeaways.",
    "3. Production Scheduling & Planning (প্রডাকশন শিডিউল ও প্ল্যানিং): Organizing schedules, timelines, bottlenecks, and workflow tracking.",
    "4. Spreadsheet Analytics (এক্সেল ও স্প্রেডশিট অ্যানালিটিক্স): Processing and calculating quantities, sums, averages, and balances.",
    "5. ABSOLUTE PROHIBITION: DO NOT mention filmmaking, shooting schedules, shot lists, call sheets, equipment checklists, or budget estimations.",
    "",
    "CAPABILITIES & TOOLS:",
    "1. EXCEL SPREADSHEETS: You CAN read, inspect, analyze, create, and export Excel spreadsheets (.xlsx, .xls) and CSVs! When the user attaches an Excel file, its full tables, sheets, columns, batch numbers, and quantities are extracted and provided to you under [Attached Excel Spreadsheet: ...]. Carefully read all rows, numbers, and headers, calculate exact totals and sums accurately, and always present structured data in clean markdown tables (| Col 1 | Col 2 |...). Explain that the user can click the 'Download Excel (.xlsx)' button below the table to get the spreadsheet directly on their device.",
    "2. IMAGE GENERATION: You CAN create and generate realistic charts, conceptual illustrations, or images! When asked to create/show an image, briefly describe it and on its own line output: [GENERATE_IMAGE: detailed english visual prompt, clean lighting, high resolution, masterpiece]",
    "3. TABLE GENERATION (টেবিল তৈরি): Whenever the user asks for a table ('table banao', 'table dao', 'tabulate', 'comparison table', 'list in table', etc.) or when presenting structured data, metrics, comparisons, specifications, or statistics: ALWAYS generate a complete, neat Markdown table using '| Col 1 | Col 2 |...' syntax with headers and rows. The UI automatically renders it as an interactive table with a dedicated Copy Table button (for 1-click clipboard paste into Excel/Sheets) and an Excel download button.",
    "",
    "TONE & GREETING BEHAVIOR:",
    "- When user greets in English (e.g. 'hi', 'hello', 'hey'): Respond warmly, concisely and professionally in ENGLISH (e.g. 'Hello! How can I assist you today? You can ask for data analysis, Excel report generation, or operational scheduling.').",
    "- When user greets in Bengali (e.g. 'নমস্কার', 'হ্যালো', 'কেমন আছেন'): Respond warmly and concisely in BENGALI (e.g. 'হ্যালো! আমি কীভাবে আপনাকে সাহায্য করতে পারি? ডেটা অ্যানালাইসিস, এক্সেল রিপোর্ট তৈরি কিংবা প্রডাকশন শিডিউলিং সংক্রান্ত যেকোনো তথ্য জানতে চাইতে পারেন।').",
    "- When user greets in Hindi (e.g. 'नमस्ते', 'प्रणाम', 'कैसे हैं'): Respond warmly and concisely in HINDI (e.g. 'नमस्ते! मैं आपकी क्या सहायता कर सकता हूँ? आप डेटा विश्लेषण, एक्सेल रिपोर्ट तैयार करने या शेड्यूलिंग से जुड़े सवाल पूछ सकते हैं।').",
    "- STRICT LANGUAGE CONTINUITY: Always reply strictly in the language the user speaks in.",
    "- Always be courteous, precise, smart, and helpful."
  ].join("\n");

  function callGemini(promptText, historyArr, attachedFiles, callback, isThink) {
    var activeModels = isThink ? GEMINI_THINK_MODELS : GEMINI_FAST_MODELS;
    var timeoutMs = isThink ? 25000 : 10000;

    // Prepare contents with alternating roles
    var contents = [];
    if (historyArr && historyArr.length) {
      var recent = historyArr.slice(-6);
      var lastRole = null;
      recent.forEach(function (m) {
        if (m.text) {
          var role = (m.role === 'bot' || m.role === 'model') ? 'model' : 'user';
          if (role === lastRole) {
            // Append parts to avoid consecutive identical roles
            if (contents.length > 0) {
              contents[contents.length - 1].parts.push({ text: m.text });
            }
          } else {
            contents.push({
              role: role,
              parts: [{ text: m.text }]
            });
            lastRole = role;
          }
        }
      });
    }

    function executeFetch(currentParts) {
      if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
        contents[contents.length - 1].parts = contents[contents.length - 1].parts.concat(currentParts);
      } else {
        contents.push({
          role: 'user',
          parts: currentParts
        });
      }

      var dynamicSys = buildDynamicSystemInstruction(SYSTEM_INSTRUCTION, promptText, historyArr);
      if (isThink) {
        dynamicSys += "\n\n" +
          "### MODE: DEEP THINKING & IN-DEPTH ANALYSIS ACTIVE\n" +
          "- You are running in DEEP THINKING / IN-DEPTH ANALYSIS MODE (Powered by Gemini 3.8 Flash).\n" +
          "- Rigorously examine all numbers, data points, tables, and production parameters.\n" +
          "- Perform multi-step logical verification and root-cause analysis.\n" +
          "- Format your answer with clear structured headings: Executive Summary, Granular Breakdown, Risk/Bottleneck Diagnosis, and Strategic Recommendations.\n" +
          "- Calculate exact figures and highlight anomalies.";
      }

      var payload = {
        systemInstruction: {
          parts: [{ text: dynamicSys }]
        },
        contents: contents
      };

      function tryModel(modelIdx) {
        if (modelIdx >= activeModels.length) {
          var fallback = getBotReply(promptText, (attachedFiles ? attachedFiles.length : 0));
          callback(null, fallback);
          return;
        }
        var modelName = activeModels[modelIdx];
        var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + GEMINI_API_KEY;

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        })
        .then(function (res) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var candidate = data && data.candidates && data.candidates[0];
          if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
            var reply = candidate.content.parts.map(function (part) { return part.text; }).join('\n');
            callback(null, reply);
          } else {
            tryModel(modelIdx + 1);
          }
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          console.warn('Gemini model ' + modelName + ' failed (' + (err && err.name === 'AbortError' ? 'timeout' : err.message) + '), switching immediately to next model...');
          tryModel(modelIdx + 1);
        });
      }

      tryModel(0);
    }

    // Prepare attachments (multimodal image, Excel parsing & text reading)
    var parts = [{ text: promptText || 'Please inspect the attached file(s).' }];
    if (attachedFiles && attachedFiles.length) {
      var pending = attachedFiles.length;
      attachedFiles.forEach(function (f) {
        var reader = new FileReader();
        var fname = (f.name || '').toLowerCase();

        // 1. Image files (multimodal inlineData)
        if (f.type && f.type.indexOf('image/') === 0) {
          reader.onload = function (e) {
            var b64 = e.target.result.split(',')[1];
            parts.push({
              inlineData: {
                mimeType: f.type,
                data: b64
              }
            });
            if (--pending === 0) executeFetch(parts);
          };
          reader.readAsDataURL(f);
        }
        // 2. Excel spreadsheets (.xlsx, .xls, .csv)
        else if (/\.(xlsx|xls|csv)$/i.test(fname) || (f.type && (f.type.indexOf('spreadsheet') !== -1 || f.type.indexOf('excel') !== -1 || f.type.indexOf('csv') !== -1))) {
          reader.onload = function (e) {
            try {
              if (typeof XLSX !== 'undefined') {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: 'array' });
                var sheetText = '';
                workbook.SheetNames.forEach(function (sName) {
                  var ws = workbook.Sheets[sName];
                  var csv = XLSX.utils.sheet_to_csv(ws);
                  if (csv && csv.trim()) {
                    sheetText += '\n--- [Sheet: ' + sName + '] ---\n' + csv.trim() + '\n';
                  }
                });
                parts.push({
                  text: '\n[Attached Excel Spreadsheet: ' + f.name + ']\n' + (sheetText || '(Sheet is empty)')
                });
              } else {
                parts.push({
                  text: '\n[Attached File: ' + f.name + ']\n'
                });
              }
            } catch (pErr) {
              console.warn('Error parsing Excel file:', pErr);
              parts.push({
                text: '\n[Attached File: ' + f.name + ' (unreadable format)]\n'
              });
            }
            if (--pending === 0) executeFetch(parts);
          };
          reader.readAsArrayBuffer(f);
        }
        // 3. PDF files (Gemini multimodal)
        else if (f.type === 'application/pdf' || /\.pdf$/i.test(fname)) {
          reader.onload = function (e) {
            var b64 = e.target.result.split(',')[1];
            parts.push({
              inlineData: {
                mimeType: 'application/pdf',
                data: b64
              }
            });
            if (--pending === 0) executeFetch(parts);
          };
          reader.readAsDataURL(f);
        }
        // 4. Plain text & code files
        else {
          reader.onload = function (e) {
            parts.push({
              text: '\n[Attached Document: ' + f.name + ']\n' + e.target.result
            });
            if (--pending === 0) executeFetch(parts);
          };
          reader.readAsText(f);
        }
      });
    } else {
      executeFetch(parts);
    }
  }

  function detectLang(text) {
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    var lower = (text || '').toLowerCase();
    if (/\b(namaste|kaisa|kaise|kya|aap|shukriya|dhanyawad|pranam)\b/.test(lower)) return 'hi';
    if (/\b(kemon|acho|achen|ki|khobor|dhonnobad|thik|bolun)\b/.test(lower)) return 'bn';
    return 'en';
  }

  function getBotReply(userText, fileCount) {
    var text = (userText || '').toLowerCase();
    var lang = detectLang(userText);
    var userName = getLoggedInUserName();

    var identityKeys = ['মালিক', 'কে বানিয়েছে', 'তুমি কে', 'owner', 'creator', 'who made', 'who are you', 'malik', 'kisne banaya'];
    for (var k = 0; k < identityKeys.length; k++) {
      if (text.indexOf(identityKeys[k]) !== -1) {
        if (lang === 'bn') return 'আমি AN AI-এর একটি বিশেষায়িত ডেটা অ্যানালিস্ট অংশ এবং আমার মালিক অর্পণ নাজির (Arpan Nazir)।';
        if (lang === 'hi') return 'मैं AN AI का एक विशेष डेटा एनालिस्ट घटक हूँ और मेरे निर्माता/मालिक अर्पण नाजिर (Arpan Nazir) हैं।';
        return 'I am a specialized Data Analyst component of AN AI, created by Arpan Nazir.';
      }
    }

    var isGreeting = false;
    for (var i = 0; i < GREETING_KEYWORDS.length; i++) {
      if (text.indexOf(GREETING_KEYWORDS[i]) !== -1) {
        isGreeting = true;
        break;
      }
    }

    if (isGreeting) {
      if (lang === 'bn') {
        return (userName ? 'হ্যালো ' + userName + '! ' : 'হ্যালো! ') + 'আমি কীভাবে আপনাকে সাহায্য করতে পারি? ডেটা অ্যানালাইসিস, এক্সেল রিপোর্ট তৈরি কিংবা প্রডাকশন শিডিউলিং সংক্রান্ত যেকোনো তথ্য জানতে চাইতে পারেন।';
      }
      if (lang === 'hi') {
        return (userName ? 'नमस्ते ' + userName + ' जी! ' : 'नमस्ते! ') + 'मैं आपकी क्या मदद कर सकता हूँ? डेटा विश्लेषण, एक्सेल रिपोर्ट तैयार करने या प्रोडक्शन शेड्यूलिंग से जुड़ा कोई भी प्रश्न पूछ सकते हैं।';
      }
      return (userName ? 'Hello ' + userName + '! ' : 'Hello! ') + 'How can I assist you today? Feel free to ask about data analytics, Excel report generation, or operational scheduling.';
    }

    if (!userText && fileCount) {
      if (lang === 'bn') return 'আপনার ' + fileCount + 'টি ফাইল পাওয়া গেছে। ফাইলগুলো অ্যানালাইসিস করা হচ্ছে...';
      if (lang === 'hi') return 'आपकी ' + fileCount + ' फाइलें प्राप्त हुईं। फाइलों का विश्लेषण किया जा रहा है...';
      return 'Received ' + fileCount + ' file' + (fileCount > 1 ? 's' : '') + '. Processing attachments...';
    }

    if (lang === 'bn') {
      return (userName ? 'হ্যালো ' + userName + '! ' : 'হ্যালো! ') + 'আমি আপনার ডেটা অ্যানালাইসিস ও প্রডাকশন শিডিউলিং সহকারী। ডেটা বিশ্লেষণ, এক্সেল রিপোর্ট বা শিডিউলিং সংক্রান্ত যেকোনো প্রশ্ন করতে পারেন।';
    }
    if (lang === 'hi') {
      return (userName ? 'नमस्ते ' + userName + ' जी! ' : 'नमस्ते! ') + 'मैं आपका डेटा विश्लेषण एवं प्रोडक्शन शेड्यूलिंग सहायक हूँ। किसी भी रिपोर्ट या शेड्यूलिंग से संबंधित प्रश्न पूछ सकते हैं।';
    }
    return (userName ? 'Hello ' + userName + '! ' : 'Hello! ') + 'I am your Data Analysis & Production Scheduling Assistant. Feel free to ask any questions regarding data analytics, Excel reports, or scheduling.';
  }



  // ---------------------------------------------------------------------

  // Sending

  // ---------------------------------------------------------------------

  function sendText(text, files) {
    text = String(text || '').trim();
    files = files || [];
    if (!text && !files.length) return;

    if (!activeSessionId) {
      activeSessionId = 'sess_' + Date.now();
      var title = text || (files && files[0] ? files[0].name : 'New Conversation');
      if (title.length > 32) title = title.substring(0, 32) + '...';
      sessions.unshift({
        id: activeSessionId,
        title: title,
        timestamp: Date.now(),
        messages: []
      });
    }

    showChatLog();
    appendMessage('user', text, files);
    history.push({ role: 'user', text: text, files: files.map(function (f) { return f.name; }) });

    var curSess = getActiveSession();
    if (curSess) {
      curSess.messages = history.slice();
      curSess.timestamp = Date.now();
      saveSessions();
      renderHistoryList();
    }

    var useThink = !!isThinkMode;
    appendTyping(useThink);
    var sendBtn = document.getElementById('ai-send-btn');
    var dockedSend = document.getElementById('ai-send-btn-docked');
    if (sendBtn) sendBtn.disabled = true;
    if (dockedSend) dockedSend.disabled = true;

    callGemini(text, history.slice(0, -1), files, function (err, reply) {
      removeTyping();
      appendStreamMessage('bot', reply, function () {
        history.push({ role: 'bot', text: reply, isThink: useThink });

        var curSess2 = getActiveSession();
        if (curSess2) {
          curSess2.messages = history.slice();
          curSess2.timestamp = Date.now();
          saveSessions();
          renderHistoryList();
        }

        var sBtn = document.getElementById('ai-send-btn');
        var dBtn = document.getElementById('ai-send-btn-docked');
        if (sBtn) sBtn.disabled = false;
        if (dBtn) dBtn.disabled = false;
      }, useThink);
    }, useThink);
  }



  function sendFromInput(sourceEl) {
    var heroInput = document.getElementById('ai-chat-input');
    var dockedInput = document.getElementById('ai-chat-input-docked');

    var text = '';
    if (sourceEl && typeof sourceEl.value === 'string' && sourceEl.value.trim()) {
      text = sourceEl.value.trim();
    } else if (dockedInput && dockedInput.value && dockedInput.value.trim()) {
      text = dockedInput.value.trim();
    } else if (heroInput && heroInput.value && heroInput.value.trim()) {
      text = heroInput.value.trim();
    } else if (sourceEl && typeof sourceEl.value === 'string') {
      text = sourceEl.value.trim();
    }

    if (!text && !selectedFiles.length) return;

    if (heroInput) { heroInput.value = ''; autoGrow(heroInput); }
    if (dockedInput) { dockedInput.value = ''; autoGrow(dockedInput); }

    var files = selectedFiles.slice();
    selectedFiles = [];
    renderAttachChips();
    sendText(text, files);
  }

  function autoGrow(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    var maxH = 140;
    var newH = Math.min(textarea.scrollHeight, maxH);
    textarea.style.height = newH + 'px';
    textarea.style.overflowY = (textarea.scrollHeight > maxH) ? 'auto' : 'hidden';
    textarea.style.scrollbarWidth = 'none';
    textarea.style.msOverflowStyle = 'none';
  }



    function formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  }

  function getFileIcon(name) {
    if (!name) return 'insert_drive_file';
    if (/\.(xlsx|xls|csv)$/i.test(name)) return 'table_chart';
    if (/\.(pdf)$/i.test(name)) return 'picture_as_pdf';
    if (/\.(docx?|txt|rtf|md)$/i.test(name)) return 'article';
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'folder_zip';
    return 'insert_drive_file';
  }

  function isImageFile(f) {
    return !!(f && f.type && f.type.indexOf('image/') === 0);
  }

  function renderAttachChips() {
    var wraps = [
      document.getElementById('ai-attach-chips'),
      document.getElementById('ai-attach-chips-docked')
    ];

    wraps.forEach(function (wrap) {
      if (!wrap) return;

      if (!selectedFiles.length) {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
        return;
      }

      wrap.style.display = 'flex';
      wrap.innerHTML = selectedFiles.map(function (f, idx) {
        var sizeStr = formatFileSize(f.size);
        var safeName = escapeHtml(f.name);

        if (isImageFile(f)) {
          var thumbUrl = URL.createObjectURL(f);
          return '<div class="ai-attach-chip ai-attach-chip--image" title="' + safeName + ' (' + sizeStr + ')">' +
            '<div class="ai-attach-thumb-wrap">' +
              '<img class="ai-attach-thumb" src="' + thumbUrl + '" alt="' + safeName + '">' +
            '</div>' +
            '<div class="ai-attach-meta">' +
              '<span class="ai-attach-name">' + safeName + '</span>' +
              '<span class="ai-attach-size">' + sizeStr + '</span>' +
            '</div>' +
            '<button type="button" class="ai-attach-remove" data-idx="' + idx + '" aria-label="Remove image" title="Remove">' +
              '<span class="material-icons-round">close</span>' +
            '</button>' +
          '</div>';
        }

        var iconName = getFileIcon(f.name);
        return '<div class="ai-attach-chip ai-attach-chip--doc" title="' + safeName + ' (' + sizeStr + ')">' +
          '<div class="ai-attach-icon-wrap">' +
            '<span class="material-icons-round">' + iconName + '</span>' +
          '</div>' +
          '<div class="ai-attach-meta">' +
            '<span class="ai-attach-name">' + safeName + '</span>' +
            '<span class="ai-attach-size">' + sizeStr + '</span>' +
          '</div>' +
          '<button type="button" class="ai-attach-remove" data-idx="' + idx + '" aria-label="Remove file" title="Remove">' +
            '<span class="material-icons-round">close</span>' +
          '</button>' +
        '</div>';
      }).join('');

      var removeBtns = wrap.querySelectorAll('.ai-attach-remove');
      for (var i = 0; i < removeBtns.length; i++) {
        removeBtns[i].addEventListener('click', function (evt) {
          evt.stopPropagation();
          var idx = parseInt(evt.currentTarget.getAttribute('data-idx'), 10);
          if (!isNaN(idx) && idx >= 0 && idx < selectedFiles.length) {
            selectedFiles.splice(idx, 1);
            renderAttachChips();
          }
        });
      }
    });
  }

  function toggleSuggestPanel() {

    var panel = document.getElementById('ai-suggest-panel');

    if (!panel) return;

    var isOpen = panel.style.display === 'flex';

    if (isOpen) {

      panel.style.display = 'none';

      return;

    }

    if (!panel.childElementCount) {

      panel.innerHTML = SUGGESTIONS.map(function (s) {

        return '<button type="button" class="ai-suggest-chip">' + escapeHtml(s) + '</button>';

      }).join('');

      var chips = panel.querySelectorAll('.ai-suggest-chip');

      for (var i = 0; i < chips.length; i++) {

        chips[i].addEventListener('click', function (evt) {

          var input = document.getElementById('ai-chat-input');

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

    var input = document.getElementById('ai-chat-input');
    var sendBtn = document.getElementById('ai-send-btn');
    var clearBtn = document.getElementById('ai-clear-btn');
    var clearConfirm = document.getElementById('ai-clear-confirm');
    var clearCancel = document.getElementById('ai-clear-cancel');
    var clearApprove = document.getElementById('ai-clear-approve');
    var backBtn = document.getElementById('ai-back-btn');
    var newChatBtn = document.getElementById('ai-new-chat-btn');
    if (newChatBtn) newChatBtn.addEventListener('click', createNewChat);

    var historyClearAll = document.getElementById('ai-history-clear-all');
    if (historyClearAll) historyClearAll.addEventListener('click', clearAllSessions);

    var attachBtn = document.getElementById('ai-attach-btn');
    var fileInput = document.getElementById('ai-file-input');
    var suggestBtn = document.getElementById('ai-suggest-btn');
    var scrollLatestBtn = document.getElementById('ai-scroll-latest');
    var contentScroller = document.getElementById('ai-content-scroll');


    if (input) {

      input.addEventListener('input', function () { autoGrow(input); });

      input.addEventListener('keydown', function (evt) {

        if (evt.key === "Enter" && !evt.shiftKey) { evt.preventDefault(); sendFromInput(input); }

      });

      input.addEventListener('paste', function (evt) {
        window.fmsHandleChatPaste(evt, selectedFiles, renderAttachChips, {
          accentColor: '#0284c7',
          bannerBg: '#e0f2fe',
          brandName: 'Pre-Production AI'
        });
      });

    }

    if (sendBtn) sendBtn.addEventListener("click", function (evt) { if (evt && evt.preventDefault) evt.preventDefault(); sendFromInput(input); });
    var thinkBtn = document.getElementById('ai-think-btn');
    if (thinkBtn) thinkBtn.addEventListener('click', toggleThinkMode);
    if (clearBtn && clearConfirm) clearBtn.addEventListener('click', function () { clearConfirm.hidden = false; });
    if (clearCancel && clearConfirm) clearCancel.addEventListener('click', function () { clearConfirm.hidden = true; });
    if (clearApprove && clearConfirm) {
      clearApprove.addEventListener('click', function () {
        if (activeSessionId) {
          deleteSession(activeSessionId);
        } else {
          createNewChat();
        }
        clearConfirm.hidden = true;
      });
    }
    if (backBtn) backBtn.addEventListener('click', closeAiPage);



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

    // Docked inputs and prompt cards
    var dockedInput = document.getElementById('ai-chat-input-docked');
    var dockedSend = document.getElementById('ai-send-btn-docked');
    var dockedAttach = document.getElementById('ai-attach-btn-docked');
    var dockedThink = document.getElementById('ai-think-btn-docked');

    if (dockedInput) {
      dockedInput.addEventListener('input', function () { autoGrow(dockedInput); });
      dockedInput.addEventListener("keydown", function (evt) { if (evt.key === "Enter" && !evt.shiftKey) { evt.preventDefault(); sendFromInput(dockedInput); } });
      dockedInput.addEventListener('paste', function (evt) {
        window.fmsHandleChatPaste(evt, selectedFiles, renderAttachChips, {
          accentColor: '#0284c7',
          bannerBg: '#e0f2fe',
          brandName: 'Pre-Production AI'
        });
      });
    }
    if (dockedSend) {
      dockedSend.addEventListener("click", function (evt) { if (evt && evt.preventDefault) evt.preventDefault(); sendFromInput(dockedInput); });
    }
    if (dockedThink) {
      dockedThink.addEventListener('click', toggleThinkMode);
    }
    if (dockedAttach && fileInput) {
      dockedAttach.addEventListener('click', function () { fileInput.click(); });
    }
    updateThinkUI();

    var promptCards = document.querySelectorAll('.ai-prompt-card');
    for (var p = 0; p < promptCards.length; p++) {
      promptCards[p].addEventListener('click', function (evt) {
        var card = evt.currentTarget;
        var ptext = card.getAttribute('data-prompt');
        if (ptext) {
          sendText(ptext, []);
        }
      });
    }

    try {
      var urlParams = new URLSearchParams(window.location.search);
      var initPrompt = urlParams.get('prompt');
      if (initPrompt && input) {
        input.value = initPrompt;
        autoGrow(input);
        input.focus();
      }
    } catch (e) {}

  }


  // ---------------------------------------------------------------------

  // Open / close the AI page (independent of the sidebar nav-item system,

  // since the AI launcher lives in the topbar rather than the sidebar).

  // ---------------------------------------------------------------------


  // ---------------------------------------------------------------------
  // Open / close the AI page (independent of the sidebar nav-item system,
  // since the AI launcher lives in the topbar rather than the sidebar).
  // ---------------------------------------------------------------------
  function isAiPageOpen_() {
    var target = document.getElementById('page-ai');
    return !!(target && target.style.display !== 'none' && built);
  }

  function openAiPage() {
    if (typeof window.closeNavPanel === 'function') {
      try { window.closeNavPanel(); } catch (e) {}
    }
    window.location.href = 'ai.html';
  }

  function closeAiPage() {
    window.location.href = 'index.html';
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    var btn = document.getElementById('topbar-ai-btn');
    if (btn) btn.addEventListener('click', openAiPage);

    var navCard = document.getElementById('nav-ai-btn-preprod');
    if (navCard) {
      navCard.addEventListener('click', openAiPage);
      navCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openAiPage();
        }
      });
    }

    // Access revoked mid-session (see app.js reEvaluateAiAccess_) while this
    // page happens to be open right now ------ close it back to the previous view.
    window.addEventListener('fms:ai-access-revoked', function (evt) {
      if (evt && evt.detail && evt.detail.id === 'ai-preprod' && isAiPageOpen_()) closeAiPage();
    });
  
    // Auto-build and wire events if running standalone
    var isStandalone = !!document.getElementById('page-ai') || document.body.classList.contains('ai-standalone') || window.location.pathname.toLowerCase().indexOf('ai.html') !== -1;
    if (isStandalone) {
      buildMarkup();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();




