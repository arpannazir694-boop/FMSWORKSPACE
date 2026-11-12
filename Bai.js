// Register CSS custom property for smooth live border rotation
try {
  if (window.CSS && typeof CSS.registerProperty === 'function') {
    CSS.registerProperty({
      name: '--bai-border-angle',
      syntax: '<angle>',
      inherits: false,
      initialValue: '0deg'
    });
  }
} catch (e) {}

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

// Global registry & exporter for Multi-Batch Excel Reports (> 10 batches)
window._multiBatchExcelRegistry = window._multiBatchExcelRegistry || {};

window.downloadMultiBatchExcel = function (cacheKey, el) {
  try {
    var dataObj = window._multiBatchExcelRegistry && window._multiBatchExcelRegistry[cacheKey];
    if (!dataObj && typeof sessionStorage !== 'undefined') {
      try {
        var stored = sessionStorage.getItem('bai_card_' + cacheKey);
        if (stored) dataObj = JSON.parse(stored);
      } catch (e) {}
    }

    var targetEl = el;
    if (!targetEl && typeof window.event !== 'undefined' && window.event && window.event.target) {
      targetEl = window.event.target.closest ? window.event.target.closest('.bai-excel-export-card') : null;
    }
    if (!targetEl && cacheKey) {
      targetEl = document.querySelector('[data-card-key="' + cacheKey + '"]') ||
                 document.querySelector('[onclick*="' + cacheKey + '"]');
    }

    function doDownload(list, fileName) {
      if (typeof XLSX === 'undefined') {
        alert('SheetJS (XLSX) লাইব্রেরি লোড হচ্ছে, অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।');
        return;
      }

      var wb = XLSX.utils.book_new();

      // 1. Sheet 1: Batch Summary Matrix (NO Planned Qty, NO Prod Qty)
      var summaryRows = [
        ['Sl', 'Batch No', 'Style No', 'ITB', 'Indent No', 'Indent Date', 'ETD', 'Brand/Unit', 'Total Materials', 'Ready Materials', 'Pending Materials', 'Readiness %', 'Store Status', 'AI Suggestion']
      ];
      list.forEach(function (b, idx) {
        var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
        var vTag = vUpper === 'READY'
          ? 'Ready for Production (100%)'
          : (vUpper === 'ALMOST READY'
            ? 'Almost Ready (90%–99%)'
            : (vUpper === 'CONDITIONAL' ? 'Conditional Start (60%–89%)' : 'HOLD / Cannot Start (< 60%)'));
        summaryRows.push([
          idx + 1,
          b.batchNo,
          b.styleNo,
          b.itb || '-',
          b.indentNo || '-',
          b.indentDate || '-',
          b.etd || '-',
          b.brand || '-',
          b.totalCount,
          b.readyCount,
          b.pendingCount,
          b.readinessPct + '%',
          (b.pendingCount === 0 && b.verdict === 'READY') ? 'Store OK (Sandip Chatterjee)' : (b.storeStatus || 'Verified OK'),
          vTag
        ]);
      });
      var wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Batch Summary');

      // 2. Sheet 2: Pending Materials & Bottlenecks ("sekhane sob thakbe")
      var pendingRows = [
        ['Sl', 'Batch No', 'Style No', 'ITB', 'Indent No', 'Indent Date', 'Missing Material Name', 'Pro Code', 'Supplier PO', 'Pending Qty', 'Delivery ETA (Jyoti)', 'Store Status (Sandip Chatterjee)', 'AI Status', 'Bottleneck / Reason']
      ];
      var pSl = 1;
      list.forEach(function (b) {
        (b.pendingItems || []).forEach(function (it) {
          pendingRows.push([
            pSl++,
            b.batchNo,
            b.styleNo,
            it.itb || b.itb || '-',
            it.indentNo || b.indentNo || '-',
            it.indentDate || b.indentDate || '-',
            it.itemName,
            it.itemCode,
            it.supplierPo || '-',
            it.pendingQty || '-',
            it.eta || (it.remarksJyoti !== '-' ? it.remarksJyoti : 'Awaited'),
            it.storeStatus || '-',
            it.aiStatus || 'Material Pending',
            it.blockerReason || it.aiStatus || '-'
          ]);
        });
      });
      var wsPending = XLSX.utils.aoa_to_sheet(pendingRows);
      XLSX.utils.book_append_sheet(wb, wsPending, 'Pending Materials');

      // 3. Sheet 3: Ready Materials
      var readyRows = [
        ['Sl', 'Batch No', 'Style No', 'ITB', 'Indent No', 'Indent Date', 'ETD', 'Material Name', 'Pro Code', 'Supplier PO', 'Qty / Status', 'Store Status (Sandip Chatterjee)', 'AI Status']
      ];
      var rSl = 1;
      list.forEach(function (b) {
        (b.readyItems || []).forEach(function (it) {
          readyRows.push([
            rSl++,
            b.batchNo,
            b.styleNo,
            it.itb || b.itb || '-',
            it.indentNo || b.indentNo || '-',
            it.indentDate || b.indentDate || '-',
            b.etd || '-',
            it.itemName,
            it.itemCode,
            it.supplierPo || '-',
            it.orderQty !== '-' ? it.orderQty : it.status,
            it.storeStatus || '-',
            it.aiStatus || 'Ready for Production'
          ]);
        });
      });
      var wsReady = XLSX.utils.aoa_to_sheet(readyRows);
      XLSX.utils.book_append_sheet(wb, wsReady, 'Ready Materials');

      // 4. Sheet 4: Shared Bottlenecks
      var sharedMap = {};
      list.forEach(function (b) {
        (b.pendingItems || []).forEach(function (it) {
          var key = (it.itemName || it.itemCode || 'Unknown').trim();
          if (!sharedMap[key]) {
            sharedMap[key] = {
              name: it.itemName,
              code: it.itemCode,
              batches: [],
              styles: [],
              supplierPo: it.supplierPo,
              aiStatus: it.aiStatus,
              storeStatus: it.storeStatus,
              jyotiRemarks: it.remarksJyoti,
              eta: it.eta
            };
          }
          if (sharedMap[key].batches.indexOf(b.batchNo) === -1) {
            sharedMap[key].batches.push(b.batchNo);
          }
          if (b.styleNo && b.styleNo !== '-' && sharedMap[key].styles.indexOf(b.styleNo) === -1) {
            sharedMap[key].styles.push(b.styleNo);
          }
        });
      });
      var sharedRows = [
        ['Sl', 'Blocker Material', 'Pro Code', 'Affected Styles', 'Affected Batches', 'Count Affected', 'Supplier PO', 'Delivery ETA / Remarks', 'AI Status', 'Store Status']
      ];
      var sSl = 1;
      Object.keys(sharedMap).forEach(function (k) {
        var obj = sharedMap[k];
        if (obj.batches.length > 1) {
          sharedRows.push([
            sSl++,
            obj.name,
            obj.code,
            obj.styles.length > 0 ? obj.styles.join(', ') : '-',
            obj.batches.join(', '),
            obj.batches.length,
            obj.supplierPo || '-',
            obj.eta || (obj.jyotiRemarks !== '-' ? obj.jyotiRemarks : 'Awaited'),
            obj.aiStatus || '-',
            obj.storeStatus || '-'
          ]);
        }
      });
      var wsShared = XLSX.utils.aoa_to_sheet(sharedRows);
      XLSX.utils.book_append_sheet(wb, wsShared, 'Shared Bottlenecks');

      var finalFileName = fileName || ('Batch_Audit_Report_' + list.length + '_Batches.xlsx');
      XLSX.writeFile(wb, finalFileName);
    }

    if (dataObj && dataObj.batches && dataObj.batches.length) {
      doDownload(dataObj.batches, dataObj.fileName);
      return;
    }

    // Fallback: If memory/session was cleared (e.g. Live Server refresh), recover dynamically from DOM & database!
    if (window.ConnectorSheetEngine) {
      var isReady = typeof window.ConnectorSheetEngine.isReady === 'function' && window.ConnectorSheetEngine.isReady();
      var loadPromise = isReady
        ? Promise.resolve(true)
        : (typeof window.ConnectorSheetEngine.ensureDataLoaded === 'function' ? window.ConnectorSheetEngine.ensureDataLoaded() : Promise.resolve(false));

      loadPromise.then(function () {
        var recoveredBatches = [];
        var recoveredFileName = null;

        // A. From data-batches attribute on card
        if (targetEl && targetEl.getAttribute('data-batches')) {
          var bArr = targetEl.getAttribute('data-batches').split(',');
          bArr.forEach(function (b) {
            var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b.trim());
            if (r) recoveredBatches.push(r);
          });
          recoveredFileName = targetEl.getAttribute('data-filename');
        }

        // B. From data-style on card (single or multiple styles)
        if (recoveredBatches.length === 0 && targetEl && targetEl.getAttribute('data-style')) {
          var stStr = targetEl.getAttribute('data-style');
          var stList = stStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          stList.forEach(function (st) {
            var bList = window.ConnectorSheetEngine.findBatchesByStyle(st, 50) || [];
            bList.forEach(function (b) {
              if (!recoveredBatches.some(function (it) { return it.batchNo === b.batchNo; })) {
                recoveredBatches.push(b);
              }
            });
          });
          recoveredFileName = targetEl.getAttribute('data-filename') || ('Style_' + stList.join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '') + '_Batches_Audit.xlsx');
        }

        // C. From parent message bubble text (extract batches from summary table in chat)
        if (recoveredBatches.length === 0 && targetEl) {
          var bubble = targetEl.closest('.bai-msg-bubble') || targetEl.closest('.bai-msg');
          if (bubble) {
            var bText = bubble.innerText || bubble.textContent || '';
            var batchCandidates = [];
            var rx = /\b([a-zA-Z]{1,4}[-_]\d{2,6}(?:[/\-_]\d{2,4}(?:[-_]\d{2,4})?)?|\d{2,4}[-_/]\d{2,4}[-_/][a-zA-Z0-9]+)\b/g;
            var m;
            while ((m = rx.exec(bText)) !== null) {
              var c = m[1].trim();
              if (batchCandidates.indexOf(c) === -1) batchCandidates.push(c);
            }
            if (window.BatchAnalysisAI && typeof window.BatchAnalysisAI.extractBatchesFromPrompt === 'function') {
              var foundBatches = window.BatchAnalysisAI.extractBatchesFromPrompt(bText);
              (foundBatches || []).forEach(function (fb) {
                if (batchCandidates.indexOf(fb) === -1) batchCandidates.push(fb);
              });
            }
            batchCandidates.forEach(function (b) {
              var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
              if (r && !recoveredBatches.some(function (it) { return it.batchNo === r.batchNo; })) {
                recoveredBatches.push(r);
              }
            });
            var cardTitle = targetEl.querySelector('.bai-excel-card-title');
            if (cardTitle && cardTitle.innerText) {
              recoveredFileName = cardTitle.innerText.trim();
            }
          }
        }

        // D. From ready_card hint in cacheKey or title
        if (recoveredBatches.length === 0 && ((cacheKey && cacheKey.indexOf('ready_card') !== -1) || (targetEl && targetEl.innerText && targetEl.innerText.indexOf('Ready_For_Production') !== -1))) {
          recoveredBatches = window.ConnectorSheetEngine.getAllReadyForProductionBatches() || [];
          recoveredFileName = 'Ready_For_Production_Batches_Audit_Report.xlsx';
        }

        if (recoveredBatches.length > 0) {
          if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
          window._multiBatchExcelRegistry[cacheKey] = {
            batches: recoveredBatches,
            fileName: recoveredFileName,
            timestamp: Date.now()
          };
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('bai_card_' + cacheKey, JSON.stringify(window._multiBatchExcelRegistry[cacheKey]));
            }
          } catch (e) {}
          doDownload(recoveredBatches, recoveredFileName);
        } else {
          alert('এক্সেল ডেটা পাওয়া যায়নি। অনুগ্রহ করে পুনরায় ব্যাচ অডিট রান করুন।');
        }
      });
      return;
    }

    alert('এক্সেল ডেটা পাওয়া যায়নি। অনুগ্রহ করে পুনরায় ব্যাচ অডিট রান করুন।');
  } catch (err) {
    console.error('[Bai] downloadMultiBatchExcel error:', err);
    alert('এক্সেল ফাইল এক্সপোর্ট করতে সমস্যা হয়েছে: ' + (err && err.message ? err.message : err));
  }
};

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

// BAI.js â "Batch Analysis with AI" page

// =============================================================================

// Self-contained module: injects its own markup + styles into the empty

// <div id="page-bai"></div> container in index.html and wires the topbar

// "Batch Analysis with AI" icon (button#topbar-bai-btn, placed right next to

// the Pre-Production AI icon) to open it.

//

// This is an exact structural clone of ai.js (Pre-Production AI) â same

// simple, fully local rule-based assistant, no external AI API, no network

// calls, no API key â just renamed/re-themed (light green) as its own

// independent page so it never collides with ai.js's markup/styles/ids.

// =============================================================================

(function () {
  'use strict';

  var history = [];       // [{ role: 'user'|'bot', text }]
  var lastActiveNavItem = null;
  var built = false;
  var selectedFiles = [];
  var SESSIONS_KEY = 'fms_ai_sessions_bai';
  var activeSessionId = null;
  var sessions = []; // [{ id, title, timestamp, messages }]
  var isThinkMode = (function () {
    try {
      var stored = localStorage.getItem('bai_think_mode');
      return stored === 'true'; // Default to false for lightning-fast responses
    } catch (e) {
      return false;
    }
  })();
  var isGenerating = false;
  var currentActiveTask = null;

  function setSendButtonState(isBusy) {
    isGenerating = !!isBusy;
    var heroSend = document.getElementById('bai-send-btn');
    var dockedSend = document.getElementById('bai-send-btn-docked');
    var btns = [heroSend, dockedSend].filter(Boolean);

    btns.forEach(function (btn) {
      if (isBusy) {
        btn.disabled = false; // Must be clickable so user can STOP the task
        btn.classList.add('is-stopping');
        btn.setAttribute('title', 'Stop task (টাস্ক বাতিল করুন)');
        btn.setAttribute('aria-label', 'Stop task');
        btn.innerHTML = '<span class="material-icons-round">stop</span>';
      } else {
        btn.disabled = false;
        btn.classList.remove('is-stopping');
        btn.setAttribute('title', 'Send message');
        btn.setAttribute('aria-label', 'Send');
        var isArrow = btn.classList.contains('bai-squircle-btn') || btn.id === 'bai-send-btn-docked';
        btn.innerHTML = '<span class="material-icons-round">' + (isArrow ? 'arrow_upward' : 'send') + '</span>';
      }
    });
  }

  function stopCurrentTask() {
    if (!isGenerating && !currentActiveTask) return;

    var task = currentActiveTask;
    isGenerating = false;
    currentActiveTask = null;
    if (task) {
      task.isAborted = true;
    }
    setSendButtonState(false);

    // 1. Remove typing indicator if present
    removeTyping();

    // 2. Abort network fetch / Gemini API call if active
    if (task && typeof task.abort === 'function') {
      try {
        task.abort();
      } catch (e) {
        console.warn('[Bai] Error aborting task:', e);
      }
    }

    // 3. Clear streaming timer if text was streaming
    if (task && task.streamTimer) {
      clearInterval(task.streamTimer);
      task.streamTimer = null;
    }

    var stoppedNoticeHtml = '<div class="bai-task-expired-badge"><span class="material-icons-round">stop_circle</span> Task Stopped</div>';

    // 4. Update the chat UI
    if (task && task.streamWrap && task.contentEl) {
      if (task.cursorEl) {
        try { task.cursorEl.remove(); } catch (e) {}
      }
      var partial = (typeof task.getCurrentText === 'function') ? task.getCurrentText() : '';
      var baseFormatted = partial ? formatText(partial) : '';
      task.contentEl.innerHTML = baseFormatted + stoppedNoticeHtml;

      var contentWrap = task.streamWrap.querySelector('.bai-msg-content-wrap');
      if (contentWrap && !contentWrap.querySelector('.bai-msg-actions')) {
        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'bai-msg-actions';
        actionsDiv.innerHTML =
          '<button type="button" class="bai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
            '<span class="material-icons-round">content_copy</span>' +
            '<span class="bai-copy-toast">Copied!</span>' +
          '</button>';
        contentWrap.appendChild(actionsDiv);
      }

      history.push({
        role: 'bot',
        text: (partial ? partial + '\n\n' : '') + '*[Task Stopped]*',
        isThink: !!task.isThink
      });
    } else {
      // Stopped before any streaming started (e.g. while thinking or querying)
      var log = document.getElementById('bai-chat-log');
      if (log) {
        var wrap = document.createElement('div');
        wrap.className = 'bai-msg bai-msg--bot' + ((task && task.isThink) ? ' bai-msg--think' : '');
        wrap.innerHTML =
          '<div class="bai-msg-avatar">' + BAI_ICON_SVG + '</div>' +
          '<div class="bai-msg-content-wrap">' +
            '<div class="bai-msg-bubble">' + stoppedNoticeHtml + '</div>' +
          '</div>';
        log.appendChild(wrap);
        scrollToBottom();
      }
      history.push({
        role: 'bot',
        text: '*[Task Stopped]*',
        isThink: !!(task && task.isThink)
      });
    }

    // 5. Persist to session history
    var curSess = getActiveSession();
    if (curSess) {
      curSess.messages = history.slice();
      curSess.timestamp = Date.now();
      saveSessions();
      renderHistoryList();
    }

    // 6. Focus input so user can type immediately
    var dockedInput = document.getElementById('bai-chat-input-docked');
    var heroInput = document.getElementById('bai-chat-input');
    if (dockedInput && dockedInput.offsetParent !== null) {
      dockedInput.focus();
    } else if (heroInput) {
      heroInput.focus();
    }
  }

  window.stopBaiTask = stopCurrentTask;

  function updateThinkUI() {
    var heroBtn = document.getElementById('bai-think-btn');
    var dockedBtn = document.getElementById('bai-think-btn-docked');
    [heroBtn, dockedBtn].forEach(function (btn) {
      if (!btn) return;
      btn.classList.toggle('is-active', isThinkMode);
      btn.setAttribute('aria-pressed', isThinkMode ? 'true' : 'false');
      var label = btn.querySelector('.bai-think-label') || btn.querySelector('.bai-model-label');
      if (label) {
        label.textContent = 'Think';
      }
      btn.setAttribute('title', isThinkMode
        ? 'Think: ON (ডিপ থিংকিং সক্রিয় — ক্লিক করে বন্ধ করুন)'
        : 'Think: OFF (ক্লিক করে ডিপ থিংকিং সক্রিয় করুন)');
    });
  }

  function toggleThinkMode() {
    isThinkMode = !isThinkMode;
    try {
      localStorage.setItem('bai_think_mode', isThinkMode ? 'true' : 'false');
    } catch (e) {}
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
    var listEl = document.getElementById('bai-history-list');
    if (!listEl) return;

    if (!sessions.length) {
      listEl.innerHTML = '<div class="bai-history-empty">No previous chats</div>';
      return;
    }

    listEl.innerHTML = sessions.map(function (s) {
      var isActive = s.id === activeSessionId;
      return '<div class="bai-history-item' + (isActive ? ' active' : '') + '" data-id="' + s.id + '">' +
        '<div class="bai-history-item-content">' +
          '<div class="bai-history-title" title="' + escapeHtml(s.title) + '">' + escapeHtml(s.title) + '</div>' +
          '<div class="bai-history-time">' + formatTimestamp(s.timestamp) + '</div>' +
        '</div>' +
        '<button type="button" class="bai-history-delete" data-del="' + s.id + '" title="Delete chat">' +
          '<svg class="fms-delete-bin-icon" aria-hidden="true"><use href="#icon-delete-bin" xlink:href="#icon-delete-bin"></use></svg>' +
        '</button>' +
      '</div>';
    }).join('');

    var items = listEl.querySelectorAll('.bai-history-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function (evt) {
        if (evt.target.closest('.bai-history-delete')) return;
        var sid = evt.currentTarget.getAttribute('data-id');
        if (sid) switchSession(sid);
      });
    }

    var delBtns = listEl.querySelectorAll('.bai-history-delete');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function (evt) {
        evt.stopPropagation();
        var sid = evt.currentTarget.getAttribute('data-del');
        if (sid) deleteSession(sid);
      });
    }
  }

  function createNewChat() {
    if (isGenerating) {
      stopCurrentTask();
    }
    activeSessionId = null;
    history = [];
    selectedFiles = [];
    renderAttachChips();
    showEmptyState();
    renderHistoryList();
    var heroInput = document.getElementById('bai-chat-input');
    if (heroInput) {
      heroInput.value = '';
      heroInput.focus();
    }
  }

  function switchSession(id) {
    if (isGenerating) {
      stopCurrentTask();
    }
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
    var log = document.getElementById('bai-chat-log');
    if (log) {
      log.innerHTML = '';
      history.forEach(function (m) {
        appendMessage(m.role, m.text, m.files || [], !!m.isThink);
      });
    }
    var dockedInput = document.getElementById('bai-chat-input-docked');
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
    'Analyze live Connector Sheet: summarize Ready for Production vs Material Pending batches',
    'Find batches with Material Pending and check their delivery ETA',
    'Check batches where material was Ordered despite In Stock',
    'Summarize this batch data and output',
    'Compare metrics across active batches',
    'Calculate total target and actual quantities'
  ];

  // Abstract "AI mark" â€” four rounded petals meeting at a center point,
  // forming a pinwheel/knot motif. Original geometry (not a copy of any
  // third-party logo). Used in place of the smart_toy glyph for the header
  // icon and bot avatars.
  var BAI_ICON_SVG =
    '<div class="bai-msg-claude-avatar" aria-hidden="true">' +
      '<svg viewBox="0 0 100 100" class="bai-claude-svg" fill="#D97757" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/>' +
      '</svg>' +
    '</div>';

  // ---------------------------------------------------------------------
  // Styles (scoped, injected once)
  // ---------------------------------------------------------------------
  function injectStyles() {
    // Loaded via bai.css
  }

  function getUserFullName() {
    var raw = '';
    try {
      var u = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
      if (u && u.trim()) raw = u.trim();
    } catch (e) {}
    if (!raw) {
      var topbar = document.getElementById('topbar-username') || document.getElementById('topbar-user-name') || document.getElementById('profile-name') || document.getElementById('profile-menu-name');
      if (topbar && topbar.textContent && topbar.textContent.trim()) {
        var name = topbar.textContent.trim();
        if (name.toLowerCase() !== 'user') raw = name;
      }
    }
    return raw || 'User';
  }

  function getUserFirstName() {
    var name = getUserFullName();
    if (!name || name.toLowerCase() === 'user') return 'there';
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && /^(mr\.?|ms\.?|mrs\.?|md\.?|dr\.?)$/i.test(parts[0])) {
      return parts[1] || parts[0];
    }
    return parts[0];
  }

  function syncUserProfile() {
    var fullName = getUserFullName();
    var nameEl = document.getElementById('bai-user-name');
    if (nameEl && fullName) {
      nameEl.textContent = fullName;
    }
    var sideUserWrap = document.getElementById('bai-side-user');
    if (sideUserWrap) {
      sideUserWrap.title = (fullName !== 'User' ? fullName : 'User Profile') + ' — GudduAI';
    }
    var sideAvatar = document.querySelector('.bai-side-user .bai-user-avatar');
    if (sideAvatar) {
      var avatarInner = getUserAvatarInner();
      if (avatarInner && avatarInner.indexOf('<img') !== -1) {
        sideAvatar.innerHTML = avatarInner;
      }
    }
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
    return '<svg class="bai-greet-icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  var TIME_BASED_GREETINGS = {
    // 05:00 - 08:59: Early Morning / Fresh Shift Start (11 options)
    earlyMorning: [
      "Ready when you are",
      "Rise and shine! Ready to audit today's batches?",
      "Good morning! Let's get the production lines humming.",
      "Early start, clear mind. What are we analyzing first?",
      "Fresh morning, fresh batches. Ready when you are.",
      "Grab your coffee — let's review today's factory targets.",
      "Good morning! All systems online and ready for production.",
      "The factory floor is waking up. Let's inspect material readiness.",
      "A productive morning begins with zero batch bottlenecks.",
      "Sunrise shift ready. Which style are we auditing today?",
      "Good morning! Let's kickstart a seamless, efficient shift."
    ],
    // 09:00 - 11:59: Active Morning / Peak Shift (13 options)
    morning: [
      "Ready when you are",
      "Full steam ahead. Which batches need your AI Suggestion today?",
      "Good morning! Ready to optimize today's workflow.",
      "Peak shift energy. Let's clear pending material gates.",
      "Floor is buzzing. How can BatchIQ assist your audit?",
      "Lines are rolling. Let's check which batches are Ready to Cut.",
      "Good morning! Standing by for your factory queries.",
      "Let's turn batch bottlenecks into smooth green lights.",
      "Ready when you are — let's review style clearances.",
      "High momentum morning! What data do you need scrutinized?",
      "Audits, shortages, or status updates? I'm ready.",
      "Let's ensure zero production downtime this morning.",
      "Ready to run deep batch analytics whenever you are."
    ],
    // 12:00 - 14:59: Midday & Afternoon (11 options)
    midday: [
      "Ready when you are",
      "Good afternoon! Time for a midday production check.",
      "Midday check-in. How are today's lines performing?",
      "Halfway through the shift. Ready to track pending materials?",
      "Good afternoon! Let's inspect what's holding up production.",
      "Post-lunch momentum. Ready to tackle batch roadblocks?",
      "Shift halfway mark. Which batch needs a status audit?",
      "Good afternoon! Let's keep the cutting tables moving.",
      "Data-driven decisions make seamless afternoons. What's next?",
      "Ready when you are — let's audit floor readiness.",
      "Midday clarity. Let's filter out pending fabrics & trims."
    ],
    // 15:00 - 17:59: Late Afternoon / Shift Wrap-Up (11 options)
    afternoon: [
      "Ready when you are",
      "Good afternoon! Wrapping up today's shift targets?",
      "Late afternoon sprint. Let's review output vs planned.",
      "Approaching shift end. Any urgent batch clearances needed?",
      "Closing the afternoon strong. Let's check line balances.",
      "Ready when you are — let's prepare the handover report.",
      "Finishing touches on today's orders. What's pending?",
      "Golden hour on the floor. Let's verify dispatch readiness.",
      "Time to reconcile today's batch metrics and material approvals.",
      "Good afternoon! Let's finish today's batch goals cleanly.",
      "Ready to run the closing shift audit whenever you are."
    ],
    // 18:00 - 21:59: Evening Review & Tomorrow Prep (11 options)
    evening: [
      "Ready when you are",
      "Good evening! Ready to review today's production milestones?",
      "Evening wrap-up. How did our batch clearances fare today?",
      "Good evening! Let's prepare tomorrow's cutting schedules.",
      "Quiet hours approaching. Ready for an end-of-day summary?",
      "Evening reflection: Which styles are cleared for tomorrow?",
      "Let's audit today's achievements and eliminate tomorrow's holds.",
      "Good evening! Batch intelligence is ready for your review.",
      "Winding down the factory floor. Time for consolidated insights.",
      "Ready when you are — let's plan ahead for a winning tomorrow.",
      "End-of-day peace of mind: zero surprise shortages."
    ],
    // 22:00 - 00:59: Night Shift & Quiet Focus (11 options)
    night: [
      "Ready when you are",
      "Good night! Keeping a watchful eye on night operations.",
      "Night owl mode active. Which batch is on your mind?",
      "Working late? BatchIQ has your back round the clock.",
      "Silent hours, sharp insights. What are we auditing?",
      "Night shift running smooth. Let's run a quiet audit.",
      "Burning the midnight oil? Let's make every second count.",
      "Ready when you are — late night factory insights on demand.",
      "Quiet focus brings the deepest breakthroughs. What's next?",
      "Late night data deep-dive. Let's analyze tricky batches.",
      "Night operations monitoring. Standing by for instructions."
    ],
    // 01:00 - 04:59: Late Night Hustle / Midnight Oil (11 options)
    lateNight: [
      "Ready when you are",
      "Still here at this hour? Your dedication is inspiring.",
      "Deep night hustle. Let's solve that complex batch issue.",
      "Quiet factory, deep thoughts. What shall we inspect?",
      "The world is asleep, but BatchIQ never stops computing.",
      "Late night dedication. Ready whenever you are.",
      "Burning the 2 AM oil. Let's get that report sorted.",
      "Silent hours are best for deep problem solving. Let's go.",
      "Zero distractions right now. Let's crack this production puzzle.",
      "Midnight audit session. Ask away, I'm fully awake.",
      "Incredible work ethic. How can I make tonight easier for you?"
    ]
  };

  var _lastGreetingIndex = -1;

  function getTimeGreeting() {
    var hour = new Date().getHours();
    var slotKey = 'morning';
    if (hour >= 5 && hour < 9) {
      slotKey = 'earlyMorning';
    } else if (hour >= 9 && hour < 12) {
      slotKey = 'morning';
    } else if (hour >= 12 && hour < 15) {
      slotKey = 'midday';
    } else if (hour >= 15 && hour < 18) {
      slotKey = 'afternoon';
    } else if (hour >= 18 && hour < 22) {
      slotKey = 'evening';
    } else if (hour >= 22 || hour === 0) {
      slotKey = 'night';
    } else {
      slotKey = 'lateNight';
    }

    var list = TIME_BASED_GREETINGS[slotKey] || TIME_BASED_GREETINGS.morning;
    var idx = Math.floor(Math.random() * list.length);
    if (idx === _lastGreetingIndex && list.length > 1) {
      idx = (idx + 1) % list.length;
    }
    _lastGreetingIndex = idx;
    return list[idx];
  }

  function updateWelcomeGreeting(animate) {
    var heading = document.getElementById('bai-welcome-heading');
    if (heading) {
      var nextText = getTimeGreeting();
      if (animate) {
        heading.classList.add('is-updating');
        setTimeout(function () {
          heading.textContent = nextText;
          heading.classList.remove('is-updating');
        }, 180);
      } else {
        heading.textContent = nextText;
      }
      heading.title = 'Click to switch greeting (75+ variations across the day)';
    }
    syncUserProfile();
  }

  function buildMarkup() {
    var container = document.getElementById('page-bai');
    if (!container || built) return;
    loadSessions();
    updateWelcomeGreeting(false);
    renderHistoryList();
    built = true;
    wireEvents();
  }

  function showEmptyState() {
    var empty = document.getElementById('bai-empty-state');
    var log = document.getElementById('bai-chat-log');
    var docked = document.getElementById('bai-docked-input-bar');
    if (empty) {
      empty.style.display = '';
      updateWelcomeGreeting(false);
    }
    if (log) { log.style.display = 'none'; log.innerHTML = ''; }
    if (docked) docked.style.display = 'none';
  }

  function showChatLog() {
    var empty = document.getElementById('bai-empty-state');
    var log = document.getElementById('bai-chat-log');
    var docked = document.getElementById('bai-docked-input-bar');
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
      return '<div class="bai-gen-image-card">' +
        '<a href="' + imgUrl + '" target="_blank" rel="noopener" title="View Fullscreen">' +
          '<img src="' + imgUrl + '" alt="' + escapeHtml(promptClean) + '" loading="lazy">' +
        '</a>' +
        '<div class="bai-gen-image-footer">' +
          '<span class="bai-gen-image-prompt" title="' + escapeHtml(promptClean) + '">' + escapeHtml(promptClean) + '</span>' +
          '<a href="' + imgUrl + '" download="AN_AI_Generated_Image.jpg" target="_blank" class="bai-gen-image-download">' +
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
      var tId = 'bai-tbl-' + tableCounter;
      var tHtml = '<div class="bai-table-container">' +
        '<div class="bai-table-toolbar">' +
          '<div class="bai-table-meta">' +
            '<span class="material-icons-round bai-table-meta-icon">table_chart</span>' +
            '<span class="bai-table-meta-title">Table</span>' +
          '</div>' +
          '<div class="bai-table-actions">' +
            '<button type="button" class="bai-table-btn bai-table-copy-btn" onclick="window.copyTableToClipboard(this, \'' + tId + '\')" title="Copy table to clipboard">' +
              '<span class="material-icons-round">content_copy</span>' +
              '<span class="bai-table-btn-label">Copy table</span>' +
              '<span class="bai-copy-toast">Copied!</span>' +
            '</button>' +
            '<button type="button" class="bai-table-btn bai-table-excel-btn" onclick="window.downloadTableAsExcel(\'' + tId + '\', \'AN_AI_Report\')" title="Download Excel (.xlsx)">' +
              '<span class="material-icons-round">table_view</span>' +
              '<span class="bai-table-btn-label">Excel</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="bai-table-scroll-wrapper">' +
          '<table class="bai-data-table" id="' + tId + '">';
      
      function getColClass(hName) {
        var hn = String(hName || '').toLowerCase().trim();
        if (hn === '#' || hn === 'sl' || hn === 'no.') return 'bai-col-sl';
        if (hn.indexOf('itb') !== -1) return 'bai-col-itb';
        if (hn.indexOf('batch') !== -1) return 'bai-col-batch';
        if (hn.indexOf('style') !== -1) return 'bai-col-style';
        if (hn.indexOf('indent date') !== -1 || (hn.indexOf('date') !== -1 && hn.indexOf('update') === -1)) return 'bai-col-indent-date';
        if (hn.indexOf('indent') !== -1) return 'bai-col-indent';
        if (hn.indexOf('total') !== -1) return 'bai-col-total';
        if (hn.indexOf('ready') !== -1 && hn.indexOf('%') === -1 && hn.indexOf('score') === -1) return 'bai-col-ready';
        if (hn.indexOf('pending') !== -1 && hn.indexOf('%') === -1) return 'bai-col-pending';
        if (hn.indexOf('%') !== -1 || hn.indexOf('score') !== -1 || hn.indexOf('readiness') !== -1) return 'bai-col-pct';
        if (hn.indexOf('verdict') !== -1 || hn.indexOf('ai suggestion') !== -1 || hn.indexOf('suggestion') !== -1) return 'bai-col-verdict';
        if (hn.indexOf('supplier po') !== -1 || hn === 'po') return 'bai-col-po';
        if (hn.indexOf('store') !== -1) return 'bai-col-store';
        if (hn.indexOf('ai status') !== -1) return 'bai-col-aistatus';
        if (hn.indexOf('material') !== -1 || hn.indexOf('item') !== -1) return 'bai-col-item';
        return 'bai-col-default';
      }

      var headerNames = [];
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
            var h = c.trim();
            headerNames.push(h);
            var colClass = getColClass(h);
            tHtml += '<th class="' + colClass + '">' + escapeHtml(h) + '</th>';
          });
          tHtml += '</tr></thead><tbody>';
        } else {
          tHtml += '<tr>';
          cols.forEach(function (c, cIdx) {
            var h = headerNames[cIdx] || '';
            var colClass = getColClass(h);
            var rawText = c.trim();
            var parsed = escapeHtml(rawText)
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/`([^`]+)`/g, '<code>$1</code>');

            // Format badges if verdict or AI Suggestion
            if (colClass === 'bai-col-verdict') {
              var upper = rawText.toUpperCase();
              if (upper.indexOf('ALMOST READY') !== -1) {
                parsed = '<span class="bai-tbl-badge bai-tbl-badge--almost">' + parsed + '</span>';
              } else if (upper.indexOf('READY') !== -1) {
                parsed = '<span class="bai-tbl-badge bai-tbl-badge--ready">' + parsed + '</span>';
              } else if (upper.indexOf('CONDITIONAL') !== -1) {
                parsed = '<span class="bai-tbl-badge bai-tbl-badge--conditional">' + parsed + '</span>';
              } else if (upper.indexOf('HOLD') !== -1) {
                parsed = '<span class="bai-tbl-badge bai-tbl-badge--hold">' + parsed + '</span>';
              }
            } else if (colClass === 'bai-col-itb') {
              if (rawText !== '-' && rawText !== '') {
                parsed = '<span class="bai-itb-pill">' + parsed + '</span>';
              }
            } else if (colClass === 'bai-col-indent') {
              if (rawText !== '-' && rawText !== '') {
                parsed = '<span class="bai-indent-pill">' + parsed + '</span>';
              }
            }
            tHtml += '<td class="' + colClass + '">' + parsed + '</td>';
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
      var trimmedLine = line.trim();
      var isTableRow = /^\|.*\|\s*$/.test(trimmedLine);
      if (!isTableRow && inTable && /^\|/.test(trimmedLine)) {
        trimmedLine += ' |';
        line = trimmedLine;
        isTableRow = true;
      }

      if (isTableRow) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        inTable = true;
        tableRows.push(line);
      } else {
        if (inTable) {
          html += flushTable();
          inTable = false;
        }

        // Check for HTML image or excel export card preserved from markup
        if (line.indexOf('<div class="bai-gen-image-card">') !== -1 || line.indexOf('bai-excel-export-card') !== -1) {
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

  function getSheetActionBtnHtml(text) {
    if (!text) return '';
    var t = String(text);

    // 1. Specific Batch: e.g. TT-1454/26-27 or Batch TT-0867/26-27
    var bMatch = t.match(/\b([tT]{2}-\d{3,6}\/\d{2}-\d{2})\b/) || t.match(/(?:Batch|batch)\s*[:#-]?\s*([A-Za-z0-9\/-]+)/i);
    if (bMatch && bMatch[1]) {
      var bNum = escapeHtml(bMatch[1].trim());
      return '<button type="button" class="bai-msg-action-btn bai-msg-sheet-btn" onclick="window.ConnectorSheetEngine && window.ConnectorSheetEngine.openWithBatch(\'' + bNum + '\')" title="View Batch ' + bNum + ' in Connector Live Sheet">' +
        '<span class="material-icons-round">table_chart</span>' +
      '</button>';
    }

    // 2. Specific Indent: e.g. NL_0242_TT/26-27, LE_0041_TT/26-27, IND-2026/01
    var iMatch = t.match(/\b((?:NL|LE|IND)[-_]\d{2,6}(?:[-_][a-zA-Z0-9]+)*(?:[/-][a-zA-Z0-9_-]+)*)\b/i);
    if (iMatch && iMatch[1]) {
      var indNum = escapeHtml(iMatch[1].trim());
      return '<button type="button" class="bai-msg-action-btn bai-msg-sheet-btn" onclick="window.ConnectorSheetEngine && window.ConnectorSheetEngine.openWithSearch(\'' + indNum + '\')" title="View Indent ' + indNum + ' in Connector Live Sheet">' +
        '<span class="material-icons-round">table_chart</span>' +
      '</button>';
    }

    // 3. Specific Style: e.g. Style T22896
    var sMatch = t.match(/\b([tT]\d{4,6})\b/);
    if (sMatch && sMatch[1]) {
      var styNum = escapeHtml(sMatch[1].trim());
      return '<button type="button" class="bai-msg-action-btn bai-msg-sheet-btn" onclick="window.ConnectorSheetEngine && window.ConnectorSheetEngine.openWithSearch(\'' + styNum + '\')" title="View Style ' + styNum + ' in Connector Live Sheet">' +
        '<span class="material-icons-round">table_chart</span>' +
      '</button>';
    }

    // 4. General Live Sheet / Connector reference
    var tLower = t.toLowerCase();
    if (tLower.indexOf('connector') !== -1 || tLower.indexOf('live sheet') !== -1 || tLower.indexOf('sheet') !== -1 || tLower.indexOf('batch') !== -1) {
      return '<button type="button" class="bai-msg-action-btn bai-msg-sheet-btn" onclick="window.ConnectorSheetEngine && window.ConnectorSheetEngine.open()" title="Open Connector Live Sheet Records">' +
        '<span class="material-icons-round">table_chart</span>' +
      '</button>';
    }

    return '';
  }

  function getUserAvatarInner() {
    var userName = getUserFullName();
    var photoUrl = '';
    try {
      if (userName && userName.toLowerCase() !== 'user') {
        photoUrl = localStorage.getItem('fms_user_photo_' + userName.toLowerCase()) || '';
      }
      if (!photoUrl) {
        var topImg = document.getElementById('topbar-avatar-img');
        if (topImg && topImg.src && !topImg.hidden) photoUrl = topImg.src;
      }
      if (!photoUrl) {
        photoUrl = localStorage.getItem('fms_profile_photo') || sessionStorage.getItem('fms_profile_photo') || '';
      }
    } catch (e) {}

    if (photoUrl && photoUrl.trim()) {
      return '<img class="bai-msg-user-avatar-img" src="' + escapeHtml(photoUrl.trim()) + '" alt="' + escapeHtml(userName) + '">';
    }
    return '<span class="material-icons-round">person</span>';
  }

  function appendMessage(role, text, files, isThink) {
    var log = document.getElementById('bai-chat-log');
    if (!log) return null;

    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--' + role + (isThink ? ' bai-msg--think' : '');

    var avatarInner = role === 'user'
      ? getUserAvatarInner()
      : BAI_ICON_SVG;

    var thinkBadgeHtml = '';

    var filesHtml = '';
    if (role === 'user' && files && files.length) {
      filesHtml = '<div class="bai-msg-files">' + files.map(function (f) {
        if (typeof f === 'string') {
          return '<span class="bai-msg-file-chip"><span class="material-icons-round">description</span>' + escapeHtml(f) + '</span>';
        }
        if (isImageFile(f)) {
          return '<img class="bai-msg-file-thumb" src="' + URL.createObjectURL(f) + '" alt="' + escapeHtml(f.name) + '">';
        }
        return '<span class="bai-msg-file-chip"><span class="material-icons-round">description</span>' + escapeHtml(f.name) + '</span>';
      }).join('') + '</div>';
    }

    var sheetBtnHtml = (role === 'bot') ? getSheetActionBtnHtml(text) : '';
    var copyBtnHtml = (text || (files && files.length)) ?
      '<div class="bai-msg-actions">' +
        '<button type="button" class="bai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
          '<span class="material-icons-round">content_copy</span>' +
          '<span class="bai-copy-toast">Copied!</span>' +
        '</button>' +
        sheetBtnHtml +
      '</div>' : '';

    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + avatarInner + '</div>' +
      '<div class="bai-msg-content-wrap">' +
        '<div class="bai-msg-bubble">' + thinkBadgeHtml + (text ? formatText(text) : '') + filesHtml + '</div>' +
        copyBtnHtml +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function appendStreamMessage(role, text, onDone, isThink) {
    if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
      if (typeof onDone === 'function') onDone();
      return null;
    }

    var log = document.getElementById('bai-chat-log');
    if (!log) {
      if (typeof onDone === 'function') onDone();
      return null;
    }

    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--' + role + (isThink ? ' bai-msg--think' : '');
    var avatarInner = role === 'user'
      ? getUserAvatarInner()
      : BAI_ICON_SVG;

    var thinkBadgeHtml = '';

    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + avatarInner + '</div>' +
      '<div class="bai-msg-content-wrap">' +
        '<div class="bai-msg-bubble">' + thinkBadgeHtml + '<div class="bai-stream-content"></div><span class="bai-stream-cursor"></span></div>' +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();

    var contentEl = wrap.querySelector('.bai-stream-content');
    var cursorEl = wrap.querySelector('.bai-stream-cursor');

    var tokens = String(text || '').split(/(\s+)/);
    var idx = 0;
    var currentText = '';

    var totalTokens = tokens.length;
    var interval = 16;
    var tokensPerTick = Math.max(8, Math.ceil(totalTokens / 25));

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
        if (currentActiveTask && currentActiveTask.streamTimer === timer) {
          currentActiveTask.streamTimer = null;
        }
        if (cursorEl) cursorEl.remove();
        if (contentEl) contentEl.innerHTML = formatText(text);
        var contentWrap = wrap.querySelector('.bai-msg-content-wrap');
        if (contentWrap && !contentWrap.querySelector('.bai-msg-actions')) {
          var actionsDiv = document.createElement('div');
          actionsDiv.className = 'bai-msg-actions';
          actionsDiv.innerHTML =
            '<button type="button" class="bai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
              '<span class="material-icons-round">content_copy</span>' +
              '<span class="bai-copy-toast">Copied!</span>' +
            '</button>' +
            (role === 'bot' ? getSheetActionBtnHtml(text) : '');
          contentWrap.appendChild(actionsDiv);
        }
        scrollToBottom();
        setSendButtonState(false);
        currentActiveTask = null;
        if (typeof onDone === 'function') onDone();
      }
    }, interval);

    if (currentActiveTask) {
      currentActiveTask.streamTimer = timer;
      currentActiveTask.streamWrap = wrap;
      currentActiveTask.contentEl = contentEl;
      currentActiveTask.cursorEl = cursorEl;
      currentActiveTask.isThink = !!isThink;
      currentActiveTask.getCurrentText = function () { return currentText; };
    }

    return wrap;
  }

  function renderFastResponse(text, isThink) {
    if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) return;
    removeTyping();

    var log = document.getElementById('bai-chat-log');
    if (!log) return;

    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--bot' + (isThink ? ' bai-msg--think' : '');
    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + BAI_ICON_SVG + '</div>' +
      '<div class="bai-msg-content-wrap">' +
        '<div class="bai-msg-bubble"><div class="bai-stream-content"></div><span class="bai-stream-cursor"></span></div>' +
      '</div>';
    log.appendChild(wrap);
    scrollToBottom();

    var contentEl = wrap.querySelector('.bai-stream-content');
    var cursorEl = wrap.querySelector('.bai-stream-cursor');

    if (currentActiveTask) {
      currentActiveTask.streamWrap = wrap;
      currentActiveTask.contentEl = contentEl;
      currentActiveTask.cursorEl = cursorEl;
      currentActiveTask.getCurrentText = function () { return text; };
    }

    function finalize() {
      if (cursorEl) {
        try { cursorEl.remove(); } catch (e) {}
      }
      if (contentEl) {
        contentEl.innerHTML = formatText(text);
      }
      var contentWrap = wrap.querySelector('.bai-msg-content-wrap');
      if (contentWrap && !contentWrap.querySelector('.bai-msg-actions')) {
        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'bai-msg-actions';
        actionsDiv.innerHTML =
          '<button type="button" class="bai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
            '<span class="material-icons-round">content_copy</span>' +
            '<span class="bai-copy-toast">Copied!</span>' +
          '</button>' +
          getSheetActionBtnHtml(text);
        contentWrap.appendChild(actionsDiv);
      }
      scrollToBottom();

      history.push({ role: 'bot', text: text, isThink: isThink });
      var curSess = getActiveSession();
      if (curSess) {
        curSess.messages = history.slice();
        curSess.timestamp = Date.now();
        saveSessions();
        renderHistoryList();
      }

      setSendButtonState(false);
      currentActiveTask = null;
    }

    // High-speed stream: display in ~100-150ms across ~8 chunks of lines
    // Separate card markup from streaming to prevent broken HTML
    var cardIdx = text.indexOf('<div class="bai-excel-export-card"');
    var streamableText = cardIdx !== -1 ? text.substring(0, cardIdx).trim() : text;

    var lines = streamableText.split('\n');
    var totalLines = lines.length;
    var linesPerTick = Math.max(3, Math.ceil(totalLines / 8));
    var lineIdx = 0;
    var currentLines = [];

    var fastTimer = setInterval(function () {
      if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
        clearInterval(fastTimer);
        finalize();
        return;
      }

      for (var k = 0; k < linesPerTick && lineIdx < totalLines; k++) {
        currentLines.push(lines[lineIdx++]);
      }

      if (contentEl) {
        contentEl.innerHTML = formatText(currentLines.join('\n'));
      }
      scrollToBottom();

      if (lineIdx >= totalLines) {
        clearInterval(fastTimer);
        if (currentActiveTask && currentActiveTask.streamTimer === fastTimer) {
          currentActiveTask.streamTimer = null;
        }
        finalize();
      }
    }, 15);

    if (currentActiveTask) {
      currentActiveTask.streamTimer = fastTimer;
    }
  }

  // 12 Progressive Thinking Steps Catalog (matching reference design)
  var THINKING_STEPS_CATALOG = [
    {
      text: "Thinking for a moment...",
      color: "#2563eb",
      bg: "#eff6ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg bai-step-spin" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/><path d="M22 12a10 10 0 0 1-10 10" stroke-opacity="0.5"/><path d="M12 22a10 10 0 0 1-10-10" stroke-opacity="0.2"/><path d="M2 12a10 10 0 0 1 10-10" stroke-opacity="0.1"/></svg>'
    },
    {
      text: "Understanding your request...",
      color: "#2563eb",
      bg: "#eff6ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>'
    },
    {
      text: "Planning the best approach...",
      color: "#059669",
      bg: "#ecfdf5",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    },
    {
      text: "Searching relevant information...",
      color: "#d97706",
      bg: "#fffbeb",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    },
    {
      text: "Analyzing the data...",
      color: "#db2777",
      bg: "#fdf2f8",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
    },
    {
      text: "Exploring different perspectives...",
      color: "#7c3aed",
      bg: "#f5f3ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
    },
    {
      text: "Working on the explanation...",
      color: "#ea580c",
      bg: "#fff7ed",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5z"/></svg>'
    },
    {
      text: "Connecting the key points...",
      color: "#4f46e5",
      bg: "#eef2ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
    },
    {
      text: "Refining and organizing...",
      color: "#059669",
      bg: "#ecfdf5",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg>'
    },
    {
      text: "Checking for accuracy...",
      color: "#2563eb",
      bg: "#eff6ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>'
    },
    {
      text: "Adding examples...",
      color: "#4f46e5",
      bg: "#eef2ff",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/></svg>'
    },
    {
      text: "Finalizing the response...",
      color: "#059669",
      bg: "#ecfdf5",
      svg: '<svg viewBox="0 0 24 24" class="bai-step-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>'
    }
  ];

  var baiTypingTimer = null;

  function buildThinkingStepHtml(stepItem, seconds, isActive) {
    return (
      '<div class="bai-step-row ' + (isActive ? 'is-active' : 'is-done') + '" data-second="' + seconds + '">' +
        '<span class="bai-step-badge" style="background:' + stepItem.bg + '; color:' + stepItem.color + ';">' +
          stepItem.svg +
        '</span>' +
        '<span class="bai-step-text">' + stepItem.text + '</span>' +
        '<span class="bai-step-time">' + seconds + 's</span>' +
      '</div>'
    );
  }

  function appendTyping(isThink) {
    removeTyping();

    var log = document.getElementById('bai-chat-log');
    if (!log) return null;

    var wrap = document.createElement('div');
    wrap.className = 'bai-msg bai-msg--bot bai-msg--thinking-active' + (isThink ? ' bai-msg--think' : '');
    wrap.id = 'bai-typing-msg';

    var avatarInner = BAI_ICON_SVG;
    var initialStepHtml = buildThinkingStepHtml(THINKING_STEPS_CATALOG[0], 1, true);

    wrap.innerHTML =
      '<div class="bai-msg-avatar">' + avatarInner + '</div>' +
      '<div class="bai-msg-content-wrap">' +
        '<div class="bai-thinking-timeline-box">' +
          '<div class="bai-thinking-steps-list" id="bai-thinking-steps-list">' +
            initialStepHtml +
          '</div>' +
        '</div>' +
      '</div>';

    log.appendChild(wrap);
    scrollToBottom();

    var elapsedSeconds = 1;
    var listEl = wrap.querySelector('#bai-thinking-steps-list');

    baiTypingTimer = setInterval(function () {
      elapsedSeconds++;
      if (listEl) {
        var prevActive = listEl.querySelector('.bai-step-row.is-active');
        if (prevActive) {
          prevActive.classList.remove('is-active');
          prevActive.classList.add('is-done');
        }

        var stepIdx = elapsedSeconds - 1;
        if (stepIdx < THINKING_STEPS_CATALOG.length) {
          var stepData = THINKING_STEPS_CATALOG[stepIdx];
          var temp = document.createElement('div');
          temp.innerHTML = buildThinkingStepHtml(stepData, elapsedSeconds, true);
          if (temp.firstElementChild) {
            listEl.appendChild(temp.firstElementChild);
            scrollToBottom();
          }
        } else {
          var lastRow = listEl.lastElementChild;
          if (lastRow) {
            var timeSpan = lastRow.querySelector('.bai-step-time');
            if (timeSpan) timeSpan.textContent = elapsedSeconds + 's';
          }
        }
      }
    }, 1000);

    return wrap;
  }

  function removeTyping() {
    if (baiTypingTimer) {
      clearInterval(baiTypingTimer);
      baiTypingTimer = null;
    }
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

  // Simple rule-based bot â keyword matching, fully local, no network.

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

    var lower = text.toLowerCase().trim();
    // Specific Hindi phonetic keywords
    if (/\b(namaste|kaisa|kaise|kya|aap|shukriya|dhanyawad|pranam|batao|karo|theek hai|kahiye|mujhe|mera|meri)\b/.test(lower)) return 'hi';
    // Specific Bengali phonetic keywords (Banglish)
    if (/\b(kemon|acho|achen|khobor|dhonnobad|bolun|dekhao|koto|amake|kore|dao|apni|tumi|amar|amader|ekta|jodi|kintu|ekhane|bolbe|banao)\b/.test(lower)) return 'bn';

    // If text contains common English sentences or keywords
    if (/\b(list|all|batch|batches|ready|for|production|with|and|the|is|are|store|material|materials|please|show|tell|what|how|why|give|me|report|excel)\b/.test(lower)) {
      return 'en';
    }

    // If ambiguous or short (e.g. "ok", "yes", "thanks"), check recent history
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

    var identitySection = [
      "",
      "IDENTITY & OWNER RULES (STRICT DIRECTIVE):",
      "- You are an intelligent data analysis system, a specialized part of GudduAI.",
      "- ONLY IF the user asks who you are, what your name is, who made you, or your owner/creator (e.g. 'who are you', 'who made you', 'owner ke', 'porichoy dao', 'tomar malik ke', 'identity'):",
      "  * If replying in Bengali / Banglish: You MUST reply: 'আমি GudduAI-এর একটি অংশ এবং আমার মালিকের নাম অর্পণ নাজির (Arpan Nazir)।'",
      "  * If replying in English: You MUST reply: 'I am a part of GudduAI, and my owner\\'s name is Arpan Nazir.'",
      "  * If replying in Hindi: You MUST reply: 'मैं GudduAI का एक हिस्सा हूँ और मेरे मालिक का नाम अर्पण नाज़िर (Arpan Nazir) है।'"
    ].join("\n");

    var userRule = [
      "",
      "==================================================",
      "CRITICAL DYNAMIC CONVERSATION DIRECTIVES (MUST OBEY):",
      langSection,
      identitySection,
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

  var GREETING_REPLY = 'Hello! How can I assist you today? Feel free to ask about batch analytics, quality inspection, or operational scheduling.';
  var FALLBACK_REPLY = 'Hello! I am your Batch Analysis & Quality Analytics Assistant. Feel free to ask any questions regarding batch data, Excel reports, or production scheduling.';

  // ---------------------------------------------------------------------
  // Real Gemini AI Integration (Dual-Mode: Fast Chat vs Deep Analysis)
  // ---------------------------------------------------------------------
  var GEMINI_API_KEY = "AQ.Ab8RN6JXysa0sQMKMgJo6wGznX8Kdfxk25cPA3z8x6Ie4ZmlFw";

  // Fast chat models (Primary: gemini-flash-lite-latest, with ultra-fast fallbacks)
  var GEMINI_FAST_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview"
  ];

  // Deep thinking models (Primary: gemini-3-flash-preview with native thinking)
  var GEMINI_THINK_MODELS = [
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview"
  ];

  var SYSTEM_INSTRUCTION = [
    "STRICT CONTINUOUS LANGUAGE CONTINUITY (CRITICAL MANDATORY RULE):",
    "- CONTINUOUS LANGUAGE MATCHING: You MUST ALWAYS reply in the exact language the user used in their message.",
    "- If user speaks in English: Continue STRICTLY and 100% in ENGLISH.",
    "- If user speaks in Bengali (বাংলা or Banglish): Continue STRICTLY and 100% in BENGALI (বাংলা).",
    "- If user speaks in Hindi: Continue STRICTLY and 100% in HINDI.",
    "- If user speaks in any other language: Continue STRICTLY in that language.",
    "- Never switch languages on your own. Maintain the user's active language across the entire conversation.",
    "",
    "IDENTITY & CREATOR DIRECTIVE (MANDATORY):",
    "- You are an intelligent data analysis system, a specialized part of GudduAI.",
    "- ONLY IF the user asks who you are, what your name is, who made you, or your owner/creator (e.g. 'who are you', 'who made you', 'owner ke', 'porichoy dao', 'tomar malik ke'):",
    "  * If speaking in Bengali / Banglish: You MUST reply: 'আমি GudduAI-এর একটি অংশ এবং আমার মালিকের নাম অর্পণ নাজির (Arpan Nazir)।'",
    "  * If speaking in English: You MUST reply: 'I am a part of GudduAI, and my owner\\'s name is Arpan Nazir.'",
    "  * If speaking in any other language: Translate this exact identity statement faithfully into that language.",
    "- Do NOT volunteer this intro unprompted on routine queries or greetings.",
    "- ABSOLUTE RESTRICTION: NEVER mention or admit that you are Gemini, Google, OpenAI, ChatGPT, or Claude.",
    "",
    "ROLE & CORE EXPERTISE:",
    "You specialize in Batch Analytics, yield variance, quality inspection, production bottleneck scans, and throughput efficiency.",
    "1. Data Analysis (ডেটা অ্যানালাইসিস): Batch data analysis, defect rates, variances, and production KPIs.",
    "2. Report Generation (রিপোর্ট তৈরি): Clear tabular batch summary reports and deviation logs.",
    "3. Production Scheduling (শিডিউলিং ও প্ল্যানিং): Line pace, active batch progress, and workflow planning.",
    "4. ABSOLUTE PROHIBITION: DO NOT mention filmmaking, shooting schedules, shot lists, call sheets, equipment checklists, or budget estimations.",
    "",
    "CAPABILITIES & TOOLS:",
    "1. EXCEL SPREADSHEETS: You CAN read, inspect, analyze, create, and export Excel spreadsheets (.xlsx, .xls) and CSVs! When the user attaches an Excel file, its full tables, sheets, columns, batch numbers, and quantities are extracted and provided to you under [Attached Excel Spreadsheet: ...]. Carefully read all rows, numbers, and headers, calculate exact totals and sums accurately, and always present structured data in clean markdown tables (| Col 1 | Col 2 |...). Explain that the user can click the 'Download Excel (.xlsx)' button below the table to get the spreadsheet directly on their device.",
    "2. IMAGE GENERATION: You CAN create and generate realistic charts, conceptual illustrations, or images! When asked to create/show an image, briefly describe it and on its own line output: [GENERATE_IMAGE: detailed english visual prompt, clean lighting, high resolution, masterpiece]",
    "3. TABLE GENERATION (টেবিল তৈরি): Whenever the user asks for a table ('table banao', 'table dao', 'tabulate', 'batch table', etc.) or when presenting tabular batch metrics, defect rates, yields, comparisons, specifications, or statistics: ALWAYS generate a complete, neat Markdown table using '| Col 1 | Col 2 |...' syntax with headers and rows. The UI automatically renders it as an interactive table with a dedicated Copy Table button (for 1-click clipboard paste into Excel/Sheets) and an Excel download button.",
    "4. LIVE CONNECTOR SHEET & TRIO-AI INTEGRATION (101,370+ RECORDS):",
    "You are DEEPLY CONNECTED in real-time to the 'Connector Live Sheet Records' database (IndexedDB fast cache + Google Sheet live sync + Trio-AI Data).",
    "- You have instant access to 24 live data columns: Batch (A), Date (B), ITB (D), Item No / Pro Code (E), Item Name (F), Comments (G), Style No (H), Colour (I), Indent No (K), Supplier PO (L), Status (M), Store Status Sandip Chatterjee (N), Remarks (O), Planned Qty (P), Prod Qty (R), Batch Qty (S), Remarks Jyoti (T), Order Qty, GRN Qty, Pending Qty, PO Confirmation Date, Category, Indent Date, and real-time AI Status.",
    "- AI STATUS MEANINGS & DECISION RULES:",
    "  * 'Ready for Production': Sandip Chatterjee (Store Manager) has vetted OK. Raw material is verified, received, and safe to start production/cutting immediately.",
    "  * 'Cannot Start Production': Sandip Chatterjee marked NOT OK. Production MUST NOT proceed until quality or quantity discrepancy is resolved.",
    "  * 'Material Pending': Raw material awaiting delivery from supplier. (Check Jyoti Remarks for ETA date, e.g. ETA: 22/09/2026).",
    "  * 'Material Received': Material arrived at factory store, awaiting store manager vetting.",
    "  * 'In Stock': Material is already in stock in warehouse, no new PO was needed.",
    "  * 'Ordered despite In Stock': Material was in stock, yet a supplier PO was placed anyway.",
    "  * 'PO Not Created': Indent exists, but Supplier PO has not been created.",
    "  * 'PO Awaited': Indent raised, PO issuance awaited.",
    "  * 'No update from Store': Indent/PO/Status lacks store update.",
    "",
    "FACTORY WORKFLOW AUDIT & 3 CORE QUERY MODES:",
    "1. BATCH PRODUCTION START & RAW MATERIAL READINESS AUDIT (যেমন: TT-0867/26-27 বা 'production start korbo ki ki material ready ache ki ki ready nei'):",
    "   - When answering a batch inquiry, you MUST organize the response into this EXACT 5-part layout (সবকিছু গুছিয়ে দেখানো):",
    "     * PART 1: Executive AI Suggestion Banner: State clearly if production can start (e.g. '[AI SUGGESTION: READY TO START - 100% Cleared]' or '[AI SUGGESTION: ALMOST READY - 90%-99% In-Stock]' or '[AI SUGGESTION: CONDITIONAL START - Cutting Allowed, Assembly Pending ETA]' or '[AI SUGGESTION: HOLD / CANNOT START - Blocker Detected]').",
    "     * PART 2: Batch KPI Summary: Batch No, Style No, ITB, Indent No, Indent Date, Total Materials, Ready Materials Count, Pending Materials Count, Readiness Score %. (MANDATORY: DO NOT show Planned Qty or Prod Qty - user specifically instructed they are NOT needed).",
    "     * PART 3: Pending / Blocker Materials Table (কী কী Ready নেই & বটলনেক - সবচেয়ে গুরুত্বপূর্ণ):",
    "       Generate a clean Markdown table with headers: | # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Delivery ETA (Jyoti Remarks) | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Action |",
    "       (MANDATORY: You MUST list EVERY SINGLE missing/pending material without omitting or truncating any rows).",
    "     * PART 4: Ready Materials Table (যেসব ম্যাটেরিয়াল প্রস্তুত):",
    "       Generate a clean Markdown table with headers: | # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status |",
    "     * PART 5: Immediate Department Action Plan:",
    "       - Store Department (Sandip Chatterjee): Items that need physical inspection or vetting.",
    "       - Purchase Department (Jyoti): Pending PO creation, vendor follow-up, or ETA expediting.",
    "     * MANDATORY EXHAUSTIVENESS: COMPLETE THE ENTIRE RESPONSE TO THE VERY END. NEVER STOP MID-SENTENCE OR MID-ROW.",
    "",
    "2. STYLE-BASED QUERY ('Style er against e', যেমন: Style 3360 বা Style T22896, PU1392W145R):",
    "   - STRICT ZERO-HALLUCINATION DIRECTIVE: Never invent, fabricate, or guess fake batch numbers (e.g. PU-0421/26-27), fake ITB, fake indents, or fake dates. Strictly output ONLY the exact genuine batch numbers and metrics provided in the live factory database context.",
    "   - If no batches exist for that style in the records, state clearly in Bengali that no active batches were found in the database. DO NOT make up sample batches.",
    "   - Present a Short Summary Style Batch Readiness Matrix table: | # | Batch No | ITB | Indent No | Indent Date | Total Items | Ready Items | Pending Items | Readiness % | AI Suggestion | (MANDATORY: DO NOT show Planned Qty or Prod Qty).",
    "   - IN-DEPTH BATCH BREAKDOWN (যখন ইউজার বিস্তারিত দেখতে চাইবেন বা 'কী কী বাকি আছে কি না আছে' জানতে চাইবেন):",
    "     For each batch under that style, provide a dedicated breakdown:",
    "     * Ready Materials (যেসব ম্যাটেরিয়াল প্রস্তুত): Table with Material Name, Pro Code, ITB, Indent No, Indent Date, Supplier PO, Qty, Store Status, AI Status.",
    "     * Pending / Blocker Materials (কী কী বাকি আছে & বটলনেক): Table with Missing Material, Pro Code, ITB, Indent No, Indent Date, Supplier PO, Pending Qty, Store Status (Sandip Chatterjee), AI Status, Reason / Bottleneck.",
    "   - Identify bottleneck components common across all batches of this style (স্টাইলভিত্তিক কমন সংকট).",
    "   - Department Action Plan for Sandip Chatterjee (Store) and Jyoti (Purchase).",
    "",
    "3. INDENT NO-BASED QUERY ('Indent no. er against e', যেমন: Indent NL_0543_TT/25-26 বা একাধিক Indent NL_0543_TT/25-26, LE_0394_TT/25-26):",
    "   - ABSOLUTE ZERO HALLUCINATION DIRECTIVE: Never invent, guess, or fabricate fake indent numbers, fake supplier POs, or fake batches. Strictly output ONLY the exact genuine records supplied in the live database context.",
    "   - SINGLE INDENT AUDIT: Audit the procurement flow (Indent -> Supplier PO -> Delivery ETA -> Store Receipt / GRN). Present the detailed Indent Procurement Table: | # | Batch No | Style No | Item Name | Pro Code | Supplier PO | Order Qty | GRN Qty | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Jyoti Remarks |.",
    "   - MULTI-INDENT AUDIT (যখন একাধিক Indent দেওয়া হবে): Present a Multi-Indent Comparison Summary Matrix table: | # | Indent No | Associated Styles | Associated Batches | Total Items | PO Created & Received | Material Pending | PO Not Created | Status / AI Suggestion |. Highlight Cross-Indent Common Procurement Bottlenecks (shared missing POs or vendor delays).",
    "   - Department Action Plan for Jyoti (Purchase Department) and Sandip Chatterjee (Store Manager).",
    "",
    "STRICT FORMATTING & STYLE RULES:",
    "- STRICT RULE ON QUANTITIES: DO NOT show Planned Qty or Prod Qty anywhere in tables or headers (The user explicitly instructed: 'Prod qty, planned qty eta dekhanor dorka nei').",
    "- BATCH DETAILS & DATA VOLUME POLICY (CRITICAL USER MANDATE):",
    "  * The user specifically commanded: 'dekho jokhon besi data hoye jache excel file baniye diye dao chat e, eto besi likhte jeo na. chat e sudhu summary ta likhbe, baki sob excel file e thakbe'.",
    "  * 1 or 2 Batches: Provide concise summary and material breakdown tables directly in chat, with the 4-sheet Excel download card attached.",
    "  * MORE THAN 2 BATCHES (> 2 batches, e.g. 3 or more batches, or styles with > 2 batches): DO NOT dump long raw material tables or lengthy text for every batch into chat ('eto besi likhte jeo na'). In CHAT, output ONLY the Executive Summary (Multi-Batch Summary Matrix Table of ALL batches, Shared Bottlenecks, and Action Plan). All the rest of itemized details remain in the attached 4-sheet Excel report.",
    "  * NEVER pick only 1 sample batch to represent a multi-batch query! Every single batch must be included in the Summary Matrix Table.",
    "- STRICT BAN ON EMOJIS: Do NOT output any emojis. Use clean text markers like [OK], [HOLD], [PENDING], [ETA], or markdown bullet points and tables.",
    "- AI Status column values MUST remain strictly in English (e.g. 'Ready for Production', 'Cannot Start Production', 'Material Pending', 'In Stock', 'Material Received').",
    "- Conversational explanations, descriptions, and action advice MUST be in the user's active language (English if user speaks English, Bengali if user speaks Bengali, Hindi if Hindi).",
    "",
    "TONE & GREETING BEHAVIOR:",
    "- When user greets in English (e.g. 'hi', 'hello', 'hey'): Respond warmly, concisely and professionally in ENGLISH.",
    "- When user greets in Bengali (e.g. 'নমস্কার', 'হ্যালো', 'কেমন আছেন'): Respond warmly and concisely in BENGALI.",
    "- When user greets in Hindi (e.g. 'नमस्ते', 'प्रणाम', 'कैसे हैं'): Respond warmly and concisely in HINDI.",
    "- STRICT LANGUAGE CONTINUITY: Always reply strictly in the language the user speaks in.",
    "- Be courteous, precise, smart, and helpful."
  ].join("\n");

  // ---------------------------------------------------------------------------
  // Formatter Helpers for Factory Operations (100% Consistent & Structured)
  // ---------------------------------------------------------------------------
  function formatBatchReadinessResponse(b, forceExcel) {
    if (!b) return '';
    var lines = [];
    var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
    var verdictHeader = vUpper === 'READY'
      ? '### [AI SUGGESTION: READY TO START - 100% Cleared]'
      : (vUpper === 'ALMOST READY'
          ? '### [AI SUGGESTION: ALMOST READY - 90%–99% Materials In-Stock]'
          : (vUpper === 'CONDITIONAL'
              ? '### [AI SUGGESTION: CONDITIONAL START - Cutting & Prep Allowed, Assembly Pending ETA]'
              : '### [AI SUGGESTION: HOLD / CANNOT START - Materials Blocked / Pending]'));

    lines.push(verdictHeader);
    lines.push('');
    lines.push('**ব্যাচ ইনফরমেশন ও প্রডাকশন স্ট্যাটাস সামারি:**');
    lines.push('- **Batch No:** `' + b.batchNo + '` | **Style No:** `' + b.styleNo + '` | **ITB:** `' + (b.itb || '-') + '` | **Indent No:** `' + (b.indentNo || '-') + '` | **Indent Date:** `' + (b.indentDate || '-') + '` | **Brand/Unit:** `' + b.brand + '`');
    lines.push('- **Batch Qty:** `' + b.batchQty + ' pcs` | **Material Readiness Score:** **' + b.readyCount + ' / ' + b.totalCount + ' Materials Ready (' + b.readinessPct + '%)**');
    lines.push('- **Store Clearance (Sandip Chatterjee):** ' + (b.verdict === 'HOLD' ? 'NOT OK / Pending Bottlenecks Detected' : 'All critical cutting raw materials OK'));
    lines.push('');

    // Embedded Excel Card for 1-click Download
    var bCacheKey = 'b_' + b.batchNo.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now();
    var bFileName = 'Batch_' + b.batchNo.replace(/[^a-zA-Z0-9_-]/g, '_') + '_Audit_Report.xlsx';
    if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
    window._multiBatchExcelRegistry[bCacheKey] = {
      batches: [b],
      fileName: bFileName,
      timestamp: Date.now()
    };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('bai_card_' + bCacheKey, JSON.stringify(window._multiBatchExcelRegistry[bCacheKey]));
      }
    } catch (e) {}
    lines.push('<div class="bai-excel-export-card" data-card-key="' + bCacheKey + '" data-batches="' + b.batchNo + '" data-filename="' + bFileName + '" onclick="window.downloadMultiBatchExcel(\'' + bCacheKey + '\', this)">' +
      '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
      '<div class="bai-excel-card-info">' +
        '<div class="bai-excel-card-title">' + bFileName + '</div>' +
        '<div class="bai-excel-card-sub">ব্যাচ `' + b.batchNo + '` এর সম্পূর্ণ কাঁচামাল অডিট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
      '</div>' +
      '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
    '</div>');
    lines.push('');


    // Table 1: Pending Materials / Blockers
    lines.push('#### 1. কী কী Ready নেই & বটলনেক (Pending / Blockers):');
    if (b.pendingItems.length > 0) {
      lines.push('| # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Delivery ETA (Jyoti) | Store Status | AI Status | Bottleneck / Reason |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
      b.pendingItems.forEach(function (it, idx) {
        var etaText = it.eta ? it.eta : (it.remarksJyoti !== '-' ? it.remarksJyoti : 'Awaited');
        lines.push('| ' + (idx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.pendingQty || '-') + ' | ' + etaText + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.blockerReason || it.aiStatus) + ' |');
      });
    } else {
      lines.push('*কোনো ম্যাটেরিয়াল পেন্ডিং নেই! সমস্ত কাঁচামাল কারখানায় উপস্থিত।*');
    }
    lines.push('');

    // Table 2: Ready Materials
    lines.push('#### 2. কোন কোন Material Ready আছে (Ready for Production):');
    if (b.readyItems.length > 0) {
      lines.push('| # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|');
      b.readyItems.forEach(function (it, idx) {
        lines.push('| ' + (idx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.orderQty !== '-' ? it.orderQty : it.status) + ' | **' + it.storeStatus + '** | `' + it.aiStatus + '` |');
      });
    } else {
      lines.push('*কোনো উপাদান এখনও সম্পূর্ণ রেডি নয়।*');
    }
    lines.push('');

    // Action plan
    lines.push('#### 3. ডিপার্টমেন্ট অনুযায়ী অ্যাকশন প্ল্যান (Action Required):');
    if (b.verdict === 'READY') {
      lines.push('- **Cutting & Production Line:** অবিলম্বে কাটিং ও প্রডাকশন শুরু করা যাবে। ফ্লোর সুপারভাইজারকে কাজ বুঝিয়ে দিন।');
      lines.push('- **Store (Sandip Chatterjee):** সমস্ত রেডি ম্যাটেরিয়াল ইস্যু স্লিপ প্রস্তুত করে ফ্লোরে ডেলিভারি দিন।');
    } else if (b.verdict === 'CONDITIONAL') {
      lines.push('- **Cutting Department:** Upper Leather ও প্রাথমিক কাটিংয়ের কাজ শুরু করা যাবে, যাতে লিড টাইম বাঁচে।');
      lines.push('- **Purchase Department (Jyoti):** পেন্ডিং এক্সেসরিজগুলোর ডেলিভারি ETA অনুযায়ী দ্রুত স্টোরে রিসিভ করান।');
      lines.push('- **Store (Sandip Chatterjee):** ম্যাটেরিয়াল আসতেই দ্রুত ইনস্পেকশন করে OK মার্ক করুন।');
    } else {
      lines.push('- **Store (Sandip Chatterjee):** যেসব উপাদানে NOT OK বা ডেটা নেই, সেগুলোর ফিজিক্যাল স্টক অবিলম্বে ভেরিফাই করুন।');
      lines.push('- **Purchase Department (Jyoti):** যাদের Supplier PO ক্রিয়েট হয়নি বা পেন্ডিং আছে, অবিলম্বে ভেন্ডরের সাথে যোগাযোগ করে ডেলিভারি নিশ্চিত করুন।');
      lines.push('- **Production Hold:** কাঁচামাল ক্লিয়ার না হওয়া পর্যন্ত এই ব্যাচ ফ্লোরে নামানো যাবে না।');
    }

    return lines.join('\n');
  }

  function formatMultiBatchResponse(batchesInput, forceExcel) {
    if (!batchesInput || !batchesInput.length) return '';
    var readinessList = [];
    var notFoundList = [];

    batchesInput.forEach(function (bItem) {
      var bReadiness = (bItem && typeof bItem === 'object' && bItem.batchNo)
        ? bItem
        : (window.ConnectorSheetEngine ? window.ConnectorSheetEngine.getBatchMaterialReadiness(String(bItem).trim()) : null);

      if (bReadiness) {
        readinessList.push(bReadiness);
      } else {
        notFoundList.push(String(bItem).trim());
      }
    });

    if (readinessList.length === 0 && notFoundList.length > 0) {
      var linesNF = [];
      linesNF.push('### [মাল্টি-ব্যাচ অনুসন্ধান: ব্যাচ নম্বর পাওয়া যায়নি]');
      linesNF.push('');
      linesNF.push('আপনার প্রদত্ত ব্যাচগুলো (`' + notFoundList.join('`, `') + '`) বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট বা ট্রায়ো-এআই ডেটাবেসে পাওয়া যায়নি।');
      linesNF.push('');
      linesNF.push('**সম্ভাব্য কারণ ও পরবর্তী করণীয়:**');
      linesNF.push('1. **ব্যাচ নম্বর যাচাই করুন:** ব্যাচ নম্বরগুলোর স্পেলিং বা ফরম্যাট ঠিক আছে কিনা মিলিয়ে নিন।');
      linesNF.push('2. **লাইভ শিট সিঙ্ক (Sync Sheet):** এই ব্যাচগুলো সম্প্রতি যুক্ত হয়ে থাকলে উপরের "Sync Sheet" বাটনে ক্লিক করে ডেটা আপডেট করুন।');
      return linesNF.join('\n');
    }

    var lines = [];
    lines.push('### [MULTI-BATCH PRODUCTION AUDIT REPORT]');
    lines.push('');
    lines.push('**মাল্টি-ব্যাচ ওভারভিউ ও প্রডাকশন কম্পারিজন সারসংক্ষেপ:**');
    lines.push('- **Total Batches Analyzed:** **' + readinessList.length + ' টি ব্যাচ**' + (notFoundList.length ? ' *(রেকর্ড পাওয়া যায়নি: `' + notFoundList.join('`, `') + '`)*' : ''));

    var readyBatchesCount = readinessList.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'READY'; }).length;
    var almostBatchesCount = readinessList.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'ALMOST READY'; }).length;
    var condBatchesCount = readinessList.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'CONDITIONAL'; }).length;
    var holdBatchesCount = readinessList.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'HOLD'; }).length;
    lines.push('- **Production Status:** **[READY] ' + readyBatchesCount + ' টি** | **[ALMOST READY] ' + almostBatchesCount + ' টি** | **[CONDITIONAL] ' + condBatchesCount + ' টি** | **[HOLD] ' + holdBatchesCount + ' টি**');
    lines.push('');

    // -------------------------------------------------------------------------
    // IF MORE THAN 2 BATCHES: CLUTTER-FREE CHAT + MULTI-SHEET EXCEL REPORT
    // -------------------------------------------------------------------------
    if (readinessList.length > 2 || forceExcel) {
      var cacheKey = 'mb_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      var mbFileName10 = 'Batch_Audit_Report_' + readinessList.length + '_Batches.xlsx';
      var mbBatchesCsv10 = readinessList.map(function (b) { return b.batchNo; }).join(',');
      if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
      window._multiBatchExcelRegistry[cacheKey] = { batches: readinessList, fileName: mbFileName10, timestamp: Date.now() };
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('bai_card_' + cacheKey, JSON.stringify(window._multiBatchExcelRegistry[cacheKey]));
        }
      } catch (e) {}

      var lines10 = [];
      lines10.push('### [MULTI-BATCH PRODUCTION AUDIT REPORT]');
      lines10.push('');
      lines10.push('**মাল্টি-ব্যাচ ওভারভিউ সারসংক্ষেপ:**');
      lines10.push('- **Total Batches Analyzed:** **' + readinessList.length + ' টি ব্যাচ**' + (notFoundList.length ? ' *(রেকর্ড পাওয়া যায়নি: `' + notFoundList.join('`, `') + '`)*' : ''));
      lines10.push('- **Production Status:** **[READY] ' + readyBatchesCount + ' টি** | **[ALMOST READY] ' + almostBatchesCount + ' টি** | **[CONDITIONAL] ' + condBatchesCount + ' টি** | **[HOLD] ' + holdBatchesCount + ' টি**');
      lines10.push('');
      lines10.push('> [!NOTE]');
      lines10.push('> আপনার অনুরোধ অনুযায়ী ২টির বেশি ব্যাচ (' + readinessList.length + ' টি ব্যাচ) পাওয়ায় চ্যাট সংক্ষিপ্ত রেখে সম্পূর্ণ ডেটা সম্বলিত একটি সুসজ্জিত **মাল্টি-শিট এক্সেল ফাইল (.xlsx)** প্রস্তুত করা হয়েছে। প্রতিটি ব্যাচের সমস্ত উপাদান ও বিস্তারিত বিবরণ এক্সেলে অন্তর্ভুক্ত রয়েছে।');
      lines10.push('');

      // Embedded Excel Card
      lines10.push('<div class="bai-excel-export-card" data-card-key="' + cacheKey + '" data-batches="' + mbBatchesCsv10 + '" data-filename="' + mbFileName10 + '" onclick="window.downloadMultiBatchExcel(\'' + cacheKey + '\', this)">' +
        '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
        '<div class="bai-excel-card-info">' +
          '<div class="bai-excel-card-title">' + mbFileName10 + '</div>' +
          '<div class="bai-excel-card-sub">' + readinessList.length + ' টি ব্যাচের সম্পূর্ণ কাঁচামাল অডিট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
        '</div>' +
        '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
      '</div>');
      lines10.push('');

      // Table 1: Multi-Batch Comparison Summary Matrix (No Planned Qty, No Prod Qty!)
      lines10.push('#### ১. মাল্টি-ব্যাচ তুলনামূলক সারাংশ ম্যাট্রিক্স (Multi-Batch Summary Matrix):');
      lines10.push('| # | Batch No | Style No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Suggestion |');
      lines10.push('|---|---|---|---|---|---|---|---|---|---|---|');
      readinessList.forEach(function (b, idx) {
        var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
        var vTag = vUpper === 'READY'
          ? '[READY] Ready for Production (100%)'
          : (vUpper === 'ALMOST READY'
            ? '[ALMOST READY] 90%–99% Ready'
            : (vUpper === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed (60%–89%)' : '[HOLD] Cannot Start Production (< 60%)'));
        lines10.push('| ' + (idx + 1) + ' | `' + b.batchNo + '` | `' + b.styleNo + '` | `' + (b.itb || '-') + '` | `' + (b.indentNo || '-') + '` | ' + (b.indentDate || '-') + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
      });
      lines10.push('');

      // Section 2: Shared Bottlenecks
      lines10.push('#### ২. কমন ঘাটতি ও বটলনেক বিশ্লেষণ (Cross-Batch Common Bottlenecks):');
      var sharedMap10 = {};
      readinessList.forEach(function (b) {
        (b.pendingItems || []).forEach(function (it) {
          var key = (it.itemName || it.itemCode || 'Unknown').trim();
          if (!sharedMap10[key]) {
            sharedMap10[key] = {
              name: it.itemName,
              code: it.itemCode,
              batches: [],
              supplierPo: it.supplierPo,
              aiStatus: it.aiStatus,
              storeStatus: it.storeStatus,
              jyotiRemarks: it.remarksJyoti,
              eta: it.eta
            };
          }
          if (sharedMap10[key].batches.indexOf(b.batchNo) === -1) {
            sharedMap10[key].batches.push(b.batchNo);
          }
        });
      });
      var sharedKeys10 = Object.keys(sharedMap10);
      var commonBottlenecks10 = sharedKeys10.filter(function (k) { return sharedMap10[k].batches.length > 1; });
      if (commonBottlenecks10.length > 0) {
        lines10.push('নিচের উপাদানগুলো একাধিক ব্যাচের প্রডাকশন আটকে রেখেছে (Shared Bottlenecks across multiple batches):');
        lines10.push('| # | Blocker Material | Pro Code | Affected Batches | Supplier PO | Delivery ETA / Jyoti Remarks | AI Status | Store Status |');
        lines10.push('|---|---|---|---|---|---|---|---|');
        commonBottlenecks10.slice(0, 15).forEach(function (k, idx) {
          var obj = sharedMap10[k];
          var bList = obj.batches.map(function (b) { return '`' + b + '`'; }).join(', ');
          var etaStr = obj.eta ? obj.eta : (obj.jyotiRemarks !== '-' ? obj.jyotiRemarks : 'Awaited');
          lines10.push('| ' + (idx + 1) + ' | **' + obj.name + '** | `' + obj.code + '` | ' + bList + ' | ' + (obj.supplierPo || '-') + ' | ' + etaStr + ' | `' + obj.aiStatus + '` | ' + obj.storeStatus + ' |');
        });
        if (commonBottlenecks10.length > 15) {
          lines10.push('*...এবং আরও ' + (commonBottlenecks10.length - 15) + ' টি শেয়ার্ড উপাদান সম্পূর্ণ এক্সেলে তালিকাভুক্ত রয়েছে।*');
        }
        lines10.push('');
      } else {
        lines10.push('ব্যাচগুলোর মধ্যে কোনো সাধারণ/শেয়ার্ড ঘাটতি পাওয়া যায়নি; প্রতিটি ব্যাচের পেন্ডিং উপাদান আলাদা আলাদা।');
        lines10.push('');
      }

      // Section 3: Action Plan
      lines10.push('#### ৩. ডিপার্টমেন্ট অনুযায়ী সমন্বিত অ্যাকশন প্ল্যান (Consolidated Action Plan):');
      lines10.push('- **Production Floor:** যেসব ব্যাচে Verdict `[READY]` রয়েছে, কেবল সেগুলোর কাটিং অবিলম্বে শুরু করা যাবে। `[CONDITIONAL]` ব্যাচে প্রাথমিক কাটিং ও প্রেপ চলবে। `[HOLD]` ব্যাচগুলোর কাজ বন্ধ রাখুন।');
      lines10.push('- **Store Department (Sandip Chatterjee):** এক্সেল ফাইলের "Pending Materials" শিট দেখে সমস্ত আনভেরিফাইড স্টক দ্রুত ভেরিফাই করে শিট আপডেট করুন।');
      lines10.push('- **Purchase Department (Jyoti):** একাধিক ব্যাচকে আটকে রাখা কমন বটলনেক আইটেমগুলোর ডেলিভারি নিশ্চিত করতে সংশ্লিষ্ট ভেন্ডরদের সাথে অবিলম্বে অগ্রাধিকার ভিত্তিতে যোগাযোগ করুন।');


      return lines10.join('\n');
    }

    // -------------------------------------------------------------------------
    // STANDARD REPORT (<= 10 BATCHES): FULL DETAILED CHAT BREAKDOWN (NO PLANNED/PROD QTY)
    // -------------------------------------------------------------------------

    // Table 1: Multi-Batch Comparison Summary Matrix
    lines.push('#### ১. মাল্টি-ব্যাচ তুলনামূলক সারাংশ ম্যাট্রিক্স (Multi-Batch Comparison Summary Matrix):');
    lines.push('| # | Batch No | Style No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Suggestion |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    readinessList.forEach(function (b, idx) {
      var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
      var vTag = vUpper === 'READY'
        ? '[READY] Ready for Production (100%)'
        : (vUpper === 'ALMOST READY'
          ? '[ALMOST READY] 90%–99% Ready'
          : (vUpper === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed (60%–89%)' : '[HOLD] Cannot Start Production (< 60%)'));
      lines.push('| ' + (idx + 1) + ' | `' + b.batchNo + '` | `' + b.styleNo + '` | `' + (b.itb || '-') + '` | `' + (b.indentNo || '-') + '` | ' + (b.indentDate || '-') + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
    });
    lines.push('');

    // Embedded Excel Card for 1-click Download
    var mbCardKey = 'mb_card_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    var mbFileName = 'Batch_Audit_Report_' + readinessList.length + '_Batches.xlsx';
    var mbBatchListCsv = readinessList.map(function (b) { return b.batchNo; }).join(',');
    if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
    window._multiBatchExcelRegistry[mbCardKey] = { batches: readinessList, fileName: mbFileName, timestamp: Date.now() };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('bai_card_' + mbCardKey, JSON.stringify(window._multiBatchExcelRegistry[mbCardKey]));
      }
    } catch (e) {}
    lines.push('<div class="bai-excel-export-card" data-card-key="' + mbCardKey + '" data-batches="' + mbBatchListCsv + '" data-filename="' + mbFileName + '" onclick="window.downloadMultiBatchExcel(\'' + mbCardKey + '\', this)">' +
      '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
      '<div class="bai-excel-card-info">' +
        '<div class="bai-excel-card-title">' + mbFileName + '</div>' +
        '<div class="bai-excel-card-sub">' + readinessList.length + ' টি ব্যাচের সম্পূর্ণ কাঁচামাল অডিট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
      '</div>' +
      '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
    '</div>');
    lines.push('');

    // Section 2: Detailed Batch-by-Batch Material Breakdown
    lines.push('#### ২. প্রতিটি ব্যাচের বিস্তারিত বিশ্লেষণ (Ready vs Pending Materials):');
    readinessList.forEach(function (b, bIdx) {
      lines.push('---');
      var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
      var verdictTitle = vUpper === 'READY'
        ? '[READY TO START - 100% Cleared]'
        : (vUpper === 'ALMOST READY'
            ? '[ALMOST READY - 90%–99% Materials In-Stock]'
            : (vUpper === 'CONDITIONAL'
                ? '[CONDITIONAL START - Cutting & Prep Allowed, Assembly Pending ETA]'
                : '[HOLD / CANNOT START - Materials Blocked / Pending]'));
      lines.push('##### ব্যাচ #' + (bIdx + 1) + ': `' + b.batchNo + '` — ' + verdictTitle);
      lines.push('- **Style No:** `' + b.styleNo + '` | **ITB:** `' + (b.itb || '-') + '` | **Indent No:** `' + (b.indentNo || '-') + '` | **Indent Date:** `' + (b.indentDate || '-') + '` | **Brand/Unit:** `' + b.brand + '` | **Batch Qty:** `' + b.batchQty + ' pcs`');
      lines.push('- **Readiness Score:** **' + b.readyCount + ' / ' + b.totalCount + ' Materials Ready (' + b.readinessPct + '%)**');
      lines.push('');

      // Table A: Pending Materials (কী কী Ready নেই & বটলনেক)
      if (b.pendingItems && b.pendingItems.length > 0) {
        lines.push('**কী কী Ready নেই & বটলনেক (Pending Materials - ' + b.pendingItems.length + ' টি):**');
        lines.push('| # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Delivery ETA (Jyoti) | Store Status | AI Status | Bottleneck / Reason |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
        b.pendingItems.forEach(function (it, pIdx) {
          var etaText = it.eta ? it.eta : (it.remarksJyoti !== '-' ? it.remarksJyoti : 'Awaited');
          lines.push('| ' + (pIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.pendingQty || '-') + ' | ' + etaText + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.blockerReason || it.aiStatus) + ' |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো ম্যাটেরিয়াল পেন্ডিং নেই! সমস্ত কাঁচামাল কারখানায় উপস্থিত।*');
        lines.push('');
      }

      // Table B: Ready Materials (প্রস্তুত কাঁচামাল)
      if (b.readyItems && b.readyItems.length > 0) {
        lines.push('**প্রস্তুত কাঁচামাল (Ready Materials - ' + b.readyItems.length + ' টি):**');
        lines.push('| # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|');
        b.readyItems.forEach(function (it, rIdx) {
          lines.push('| ' + (rIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.orderQty !== '-' ? it.orderQty : it.status) + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো উপাদান এখনও সম্পূর্ণ রেডি নয়।*');
        lines.push('');
      }
    });

    // Section 3: Shared Bottleneck Analysis
    lines.push('---');
    lines.push('#### ৩. কমন ঘাটতি ও বটলনেক বিশ্লেষণ (Cross-Batch Common Bottlenecks):');
    var sharedMap = {};
    readinessList.forEach(function (b) {
      (b.pendingItems || []).forEach(function (it) {
        var key = (it.itemName || it.itemCode || 'Unknown').trim();
        if (!sharedMap[key]) {
          sharedMap[key] = {
            name: it.itemName,
            code: it.itemCode,
            batches: [],
            supplierPo: it.supplierPo,
            aiStatus: it.aiStatus,
            storeStatus: it.storeStatus,
            jyotiRemarks: it.remarksJyoti,
            eta: it.eta
          };
        }
        if (sharedMap[key].batches.indexOf(b.batchNo) === -1) {
          sharedMap[key].batches.push(b.batchNo);
        }
      });
    });

    var sharedKeys = Object.keys(sharedMap);
    var commonBottlenecks = sharedKeys.filter(function (k) { return sharedMap[k].batches.length > 1; });
    if (commonBottlenecks.length > 0) {
      lines.push('নিচের উপাদানগুলো একাধিক ব্যাচের প্রডাকশন আটকে রেখেছে (Shared Bottlenecks across multiple batches):');
      lines.push('| # | Blocker Material | Pro Code | Affected Batches | Supplier PO | Delivery ETA / Jyoti Remarks | AI Status | Store Status |');
      lines.push('|---|---|---|---|---|---|---|---|');
      commonBottlenecks.forEach(function (k, idx) {
        var obj = sharedMap[k];
        var bList = obj.batches.map(function (b) { return '`' + b + '`'; }).join(', ');
        var etaStr = obj.eta ? obj.eta : (obj.jyotiRemarks !== '-' ? obj.jyotiRemarks : 'Awaited');
        lines.push('| ' + (idx + 1) + ' | **' + obj.name + '** | `' + obj.code + '` | ' + bList + ' | ' + (obj.supplierPo || '-') + ' | ' + etaStr + ' | `' + obj.aiStatus + '` | ' + obj.storeStatus + ' |');
      });
      lines.push('');
    } else if (sharedKeys.length > 0) {
      lines.push('ব্যাচগুলোর মধ্যে কোনো সাধারণ/শেয়ার্ড ঘাটতি পাওয়া যায়নি; প্রতিটি ব্যাচের পেন্ডিং উপাদান আলাদা আলাদা।');
      lines.push('');
    } else {
      lines.push('*সমস্ত ব্যাচ ১০০% প্রস্তুত! কোনো পেন্ডিং উপাদান বা বটলনেক নেই।*');
      lines.push('');
    }

    // Section 4: Consolidated Action Plan
    lines.push('#### ৪. ডিপার্টমেন্ট অনুযায়ী সমন্বিত অ্যাকশন প্ল্যান (Consolidated Action Plan):');
    lines.push('- **Production Floor:** যেসব ব্যাচে Verdict `[READY]` রয়েছে, সেগুলোর কাটিং অবিলম্বে শুরু করা যাবে। `[CONDITIONAL]` ব্যাচে প্রাথমিক কাটিং ও প্রেপ চলবে। `[HOLD]` ব্যাচগুলোর কাজ বন্ধ রাখুন।');
    lines.push('- **Store Department (Sandip Chatterjee):** রেডি ব্যাচগুলোর ম্যাটেরিয়াল ইস্যু স্লিপ প্রস্তুত করে ফ্লোরে পৌঁছে দিন। যেসব আইটেমে NOT OK বা ডেটা নেই সেগুলোর ফিজিক্যাল স্টক অবিলম্বে ভেরিফাই করে শিট আপডেট করুন।');
    lines.push('- **Purchase Department (Jyoti):** একাধিক ব্যাচকে আটকে রাখা কমন বটলনেক আইটেমগুলোর ডেলিভারি নিশ্চিত করতে সংশ্লিষ্ট ভেন্ডরদের সাথে অবিলম্বে অগ্রাধিকার ভিত্তিতে যোগাযোগ করুন।');

    return lines.join('\n');
  }

  function extractBatchesFromPrompt(str, historyArr) {
    if (!str && (!historyArr || !historyArr.length)) return [];
    var s = String(str || '').trim();

    // Normalize and separate glued/concatenated batch codes (e.g. "TT-1395/26-27TT-1465/26-27TT-1404/26-27ei")
    // 1. Separate if a batch year code is glued directly to another batch prefix
    s = s.replace(/(\d{2,4}(?:-\d{2,4})?)([a-zA-Z]{1,4}[-_]\d)/g, '$1 $2');
    // 2. Separate if trailing words (English/Bengali) are glued to the batch number (e.g. "26-27ei", "26-27er")
    s = s.replace(/(\d{2,4}(?:-\d{2,4})?)([a-zA-Z\u0980-\u09FF]{2,})/g, '$1 $2');
    // 3. Separate comma-joined tokens
    s = s.replace(/,([a-zA-Z0-9])/g, ', $1');

    var sLower = s.toLowerCase();
    var isIndQ = sLower.indexOf('indent') !== -1 || sLower.indexOf('ind no') !== -1;
    var isStyQ = sLower.indexOf('style') !== -1 || sLower.indexOf('স্টাইল') !== -1;

    var results = [];
    var seen = {};

    function addBatch(cand) {
      if (!cand) return;
      cand = String(cand).trim().replace(/^[,;:\s]+|[,;:\s]+$/g, '');
      if (!cand) return;
      var cUpper = cand.toUpperCase();
      if (seen[cUpper]) return;

      // A genuine batch number MUST contain at least one digit (all factory batches have numbers e.g. TT-1439, 1439)
      if (!/\d/.test(cand)) return;
      // Reject indents
      if (/^(?:IND|NL|LE)[-_/]/i.test(cand)) return;
      // Reject any code starting with letters followed immediately by slash (e.g. HHA/159/01BK, HSB/121/02) - these are always styles
      if (/^[a-zA-Z]{2,}\//.test(cand)) return;
      // Reject style codes with slashes (e.g. HHA/159/01BK, HSB/121/02)
      if (/[a-zA-Z0-9]{2,}\/\d{1,4}\//.test(cand)) return;
      // Reject if cand matches any style extracted from the prompt
      var promptStyles = extractStylesFromPrompt(str);
      if (promptStyles.some(function (ps) { return ps.toUpperCase() === cUpper; })) return;
      // Reject if cand is a known style in ConnectorSheetEngine
      if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.findRowsByStyle === 'function') {
        if (window.ConnectorSheetEngine.findRowsByStyle(cand, 1).length > 0) return;
      }
      // Reject noise/action keywords in Bengali or English
      if (/^(?:DILAM|HOLO|ER|TA|ACHE|NEI|KORO|DEKHAO|KOTO|STATUS|START|KORBO|BANAO|QUARIES|KIVABE|GULO|EI|AI|OI|STYLE|DETAILS|DETAIL|PRODUCTION|MULTIPLE|DILE|KI|PARBO|KORTE|JABE|HOBE|BOLO|CHAI|LAGBE|AND|OR|EBONG)$/i.test(cUpper)) return;
      // Reject style code like T22896 if style query
      if (isStyQ && /^[tT]\d{4,6}$/.test(cand)) return;
      // Reject standalone calendar years like 2024, 2025, 2026, 2027 unless genuine batch in ConnectorSheetEngine
      if (/^(?:202[0-9]|2030)$/.test(cand)) {
        if (!window.ConnectorSheetEngine || window.ConnectorSheetEngine.findRowsByBatch(cand).length === 0) return;
      }

      seen[cUpper] = true;
      results.push(cand);
    }

    // Mask string so sub-tokens inside already matched batch codes are not re-matched
    var maskedS = s;

    // Pattern A: Hyphen/underscore batch code: e.g. TT-0794/26-27, TT-1454/26-27, B-2026-01, TT-0867/26-27, B-1029/25, TT-0416
    var slashRegex = /\b([a-zA-Z]{1,4}[-_]\d{2,6}(?:[/\-_]\d{2,4}(?:[-_]\d{2,4})?)?)\b/g;
    var mSlash;
    while ((mSlash = slashRegex.exec(s)) !== null) {
      var candA = mSlash[1];
      if (!isIndQ || !/^(?:IND|NL|LE)[-_/]/i.test(candA)) {
        addBatch(candA);
        maskedS = maskedS.replace(candA, new Array(candA.length + 1).join(' '));
      }
    }

    // Pattern B: Year-extended numeric batch code without prefix: e.g. 1439/26-27, 0416/26-27, 1439/26
    var yearBatchRegex = /\b(\d{3,6}[/\-_]\d{2,4}(?:[-_]\d{2,4})?)\b/g;
    var mYear;
    while ((mYear = yearBatchRegex.exec(maskedS)) !== null) {
      addBatch(mYear[1]);
      maskedS = maskedS.replace(mYear[1], new Array(mYear[1].length + 1).join(' '));
    }

    // Pattern C: Batch list segment following keywords (batch, batches, btch, lot, ব্যাচ, লট)
    // Extracts all comma-, space-, 'and'-, 'ebong'-separated tokens in the list
    var listRegex = /(?:batches?|btch|lots?|ব্যাচ|লট)\s*(?:dilam|holo|ta|er|gulo|gulor|no\.?|nos\.?|numbers?|num|#|id|code)?\s*[:=\s-]+([^\n?.!]+)/gi;
    var mList;
    while ((mList = listRegex.exec(s)) !== null) {
      var seg = mList[1];
      var tokens = seg.split(/[\s,;&]+|\band\b|\bebong\b|\bএবং\b|\bও\b/i);
      tokens.forEach(function (tok) {
        tok = tok.trim();
        if (tok && /\d/.test(tok)) {
          addBatch(tok);
        }
      });
    }

    // Pattern D: Standalone numeric tokens if batch intent is present or prompt is a pure list of tokens
    var hasBatchIntent = sLower.indexOf('batch') !== -1 || sLower.indexOf('ব্যাচ') !== -1 || sLower.indexOf('btch') !== -1 ||
                         sLower.indexOf('lot') !== -1 || sLower.indexOf('লট') !== -1 || sLower.indexOf('status') !== -1 ||
                         sLower.indexOf('material') !== -1 || sLower.indexOf('production') !== -1 || sLower.indexOf('ready') !== -1 ||
                         sLower.indexOf('excel') !== -1 || /^\s*[\d,;\s/-]+\s*$/.test(s);
    if (hasBatchIntent) {
      var numRegex = /\b(\d{3,8})\b/g;
      var mNum;
      while ((mNum = numRegex.exec(maskedS)) !== null) {
        addBatch(mNum[1]);
      }
    }

    // Pattern E: Conversation History Fallback (e.g. "eta excel e report dao", "er status dao")
    if (results.length === 0 && historyArr && historyArr.length) {
      for (var h = historyArr.length - 1; h >= 0; h--) {
        var hMsg = historyArr[h];
        if (hMsg && hMsg.text) {
          var hBatches = extractBatchesFromPrompt(hMsg.text, null);
          if (hBatches && hBatches.length > 0) {
            hBatches.forEach(function (b) { addBatch(b); });
            break;
          }
        }
      }
    }

    // Post-filter: If a full batch (e.g. "TT-0416/26-27") is present, remove naked numeric fragment (e.g. "0416")
    var filtered = [];
    for (var f = 0; f < results.length; f++) {
      var rCand = results[f];
      var isSub = false;
      for (var g = 0; g < results.length; g++) {
        if (f !== g && results[g].length > rCand.length) {
          if (results[g].indexOf(rCand) !== -1) {
            isSub = true;
            break;
          }
        }
      }
      if (!isSub) {
        filtered.push(rCand);
      }
    }

    return filtered;
  }

  function extractBatchFromPrompt(str) {
    var all = extractBatchesFromPrompt(str);
    return (all && all.length > 0) ? all[0] : null;
  }

  function formatBatchNotFoundResponse(targetBatch, searchRows) {
    var lines = [];
    lines.push('### [ব্যাচ স্ট্যাটাস অনুসন্ধান: ব্যাচ নম্বর পাওয়া যায়নি]');
    lines.push('');
    lines.push('আপনার প্রদত্ত ব্যাচ নম্বর **`' + targetBatch + '`** বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট (101,370+ রেকর্ড) বা ট্রায়ো-এআই ডেটাবেসে পাওয়া যায়নি।');
    lines.push('');
    if (searchRows && searchRows.length > 0) {
      lines.push('**ডেটাবেসে কাছাকাছি বা সম্পর্কিত রেকর্ডসমূহ:**');
      lines.push('| # | Batch No | Style No | Item Name | Store Status (Sandip Chatterjee) | AI Status |');
      lines.push('|---|---|---|---|---|---|');
      searchRows.forEach(function (r, idx) {
        lines.push('| ' + (idx + 1) + ' | `' + (r[0] || '-') + '` | `' + (r[6] || '-') + '` | **' + (r[4] || '-') + '** | ' + (r[11] || '(Blank)') + ' | `' + (r[23] || '-') + '` |');
      });
      lines.push('');
    }
    lines.push('**সম্ভাব্য কারণ ও পরবর্তী করণীয়:**');
    lines.push('1. **ব্যাচ নম্বর যাচাই করুন:** অনুগ্রহ করে ব্যাচ নম্বরটির স্পেলিং বা ফরম্যাট (যেমন: `TT-0867/26-27` বা `TT-1454/26-27`) ঠিক আছে কিনা পুনরায় মিলিয়ে নিন।');
    lines.push('2. **লাইভ শিট সিঙ্ক (Sync Sheet):** এই ব্যাচটি যদি সম্প্রতি গুগল শিটে নতুন যুক্ত হয়ে থাকে, তবে উপরের **"Connector Live Sheet Records"** কার্ডের **"Sync Sheet"** বাটনে ক্লিক করে সর্বশেষ ডেটা আপডেট করে নিন।');
    lines.push('3. **সঠিক ব্যাচ দিয়ে প্রশ্ন করুন:** সঠিক ব্যাচ নম্বর লিখে দিলে সাথে সাথে সমস্ত কাঁচামালের রিয়েল-টাইম অডিট ও প্রডাকশন শুরুর অনুমতি বিশ্লেষণ করা হবে।');
    return lines.join('\n');
  }

  function extractStylesFromPrompt(str, historyArr) {
    if (!str && (!historyArr || !historyArr.length)) return [];
    var s = String(str || '').trim();
    var candidates = [];

    // 1. Slashed style codes anywhere (e.g. HHA/138/01, HSB/121/02, HSB/122/01/BK-01)
    var slashedMatches = s.match(/\b([A-Za-z0-9]{2,8}\/\d{1,4}\/[A-Za-z0-9_/-]+)\b/g);
    if (slashedMatches) {
      slashedMatches.forEach(function (m) { candidates.push(m.trim()); });
    }

    // 2. Tokens after 'style' / 'styles' / 'স্টাইল' keywords:
    // e.g., "Style T22896, 3360, BY7044W13", "styles: CA6821W138, PU4518S123R", "style T22896 ar HHA/138/01"
    var afterRegex = /(?:styles?|স্টাইল)\s*(?:nos?\.?|numbers?|codes?|er\s*against\s*e|er|gulo|gulor|ta)?\s*[:=\s-]+([^\n?]+)/gi;
    var mAfter;
    while ((mAfter = afterRegex.exec(s)) !== null) {
      var seg = mAfter[1] || '';
      var cutIndex = seg.search(/\b(?:er\s+status|status|er|gulo|gulor|dekhao|bolo|banao|analysis|ki|koto|report|excel)\b|[.?!;]/i);
      if (cutIndex !== -1) {
        seg = seg.substring(0, cutIndex);
      }
      var toks = seg.split(/[,;\t\n]+|\s+(?:and|ar|ebong|o|&)\s+|\s+/);
      toks.forEach(function (t) {
        var tClean = t.replace(/^[`"'*()[\]:;,.\s]+|[`"'*()[\]:;,.\s]+$/g, '');
        if (tClean) candidates.push(tClean);
      });
    }

    // 3. Tokens preceding 'style' / 'styles' / 'স্টাইল' keywords:
    // e.g., "T22896, 3360 style gulo dekhao"
    var beforeRegex = /([A-Za-z0-9_/,.\s-]+)\s+(?:styles?|স্টাইল)\b/gi;
    var mBefore;
    while ((mBefore = beforeRegex.exec(s)) !== null) {
      var segB = mBefore[1] || '';
      var toksB = segB.split(/[,;\t\n]+|\s+(?:and|ar|ebong|o|&)\s+|\s+/);
      toksB.forEach(function (t) {
        var tClean = t.replace(/^[`"'*()[\]:;,.\s]+|[`"'*()[\]:;,.\s]+$/g, '');
        if (tClean) candidates.push(tClean);
      });
    }

    // 4. Standard alphanumeric style code patterns anywhere:
    // e.g., T22896, T44268, BY7044W13, CA6821W138, PU4518S123R, H43813, PU1392W145R
    var alphaMatches = s.match(/\b([tThH]\d{3,6}|[A-Za-z]{1,5}\d{3,6}[A-Za-z0-9_/-]*)\b/g);
    if (alphaMatches) {
      alphaMatches.forEach(function (m) { candidates.push(m.trim()); });
    }

    // 5. Fallback to conversation history if user prompt is a style follow-up
    if (candidates.length === 0 && historyArr && historyArr.length) {
      var sLow = s.toLowerCase();
      var isFollowUp = sLow.indexOf('style') !== -1 || sLow.indexOf('স্টাইল') !== -1 ||
                       sLow.indexOf('excel') !== -1 || sLow.indexOf('এক্সেল') !== -1 ||
                       sLow.indexOf('report') !== -1 || sLow.indexOf('status') !== -1 ||
                       sLow.indexOf('baki') !== -1 || sLow.indexOf('details') !== -1;
      if (isFollowUp) {
        for (var h = historyArr.length - 1; h >= 0; h--) {
          var hText = historyArr[h].text || '';
          var hStyles = extractStylesFromPrompt(hText, null);
          if (hStyles && hStyles.length > 0) {
            return hStyles;
          }
          // Also check if history had a batch number, and find its style from database
          var bInHist = extractBatchFromPrompt(hText);
          if (bInHist && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.findRowsByBatch === 'function') {
            var bRows = window.ConnectorSheetEngine.findRowsByBatch(bInHist);
            if (bRows && bRows.length > 0 && bRows[0][6]) {
              var sVal = String(bRows[0][6]).trim();
              if (sVal && sVal !== '-') return [sVal];
            }
          }
        }
      }
    }

    var noiseWords = [
      'er', 'against', 'e', 'dekhao', 'koto', 'status', 'ache', 'achhe', 'nei', 'analysis',
      'details', 'detail', 'baki', 'sob', 'all', 'chilo', 'holo', 'ta', 'dilam',
      'gulo', 'gulor', 'style', 'styles', 'স্টাইল', 'and', 'ar', 'ebong', 'o', 'theke', 'kore',
      'dao', 'bhalo', 'ami', 'dhoro', 'onek', 'tumi', 'dekhbe', 'sei', 'miliye',
      'besi', 'batch', 'hochhe', 'ki', 'na', 'jodi', 'hoy', 'tahole', 'excel', 'file',
      'anujayi', 'banabe', 'chat', 'deoar', 'dorkar', 'nai', 'report', 'bolo', 'banao',
      'dekhun', 'bolun', 'janan', 'lagbe', 'chai', 'chaichi', 'dekhte', 'koro', 'diyo',
      'dite', 'paro', 'parbe', 'diye', 'hobe', 'korun', 'janun', 'shuru', 'kora', 'jabe',
      'ei', 'ai', 'oi', 'tar', 'amar', 'tomar', 'kon', 'kono', 'akta', 'ekta', 'shob',
      'protiti', 'amader', 'apnar', 'new', 'notun'
    ];

    var seen = {};
    var results = [];

    candidates.forEach(function (c) {
      var cClean = String(c || '').trim();
      if (!cClean || cClean.length <= 2) return;
      var cUp = cClean.toUpperCase();
      if (seen[cUp]) return;
      var cLow = cClean.toLowerCase();
      if (noiseWords.indexOf(cLow) !== -1) return;

      // Filter out batch formats (e.g. TT-1439, TT-1439/26-27, NL-0242)
      if (/^[A-Za-z]{1,4}[-_]\d{3,5}(?:\/\d{2}[-_]\d{2})?$/i.test(cClean)) return;

      // Numeric check: must be at least 3 digits and not common round numbers
      if (/^\d+$/.test(cClean)) {
        if (cClean.length < 3 || ['10', '15', '20', '25', '30', '50', '100'].indexOf(cClean) !== -1) {
          var hasRows = window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.findRowsByStyle === 'function'
            ? window.ConnectorSheetEngine.findRowsByStyle(cClean, 1).length > 0
            : false;
          if (!hasRows) return;
        }
      }

      seen[cUp] = true;
      results.push(cClean);
    });

    return results;
  }

  function extractStyleFromPrompt(str, historyArr) {
    var all = extractStylesFromPrompt(str, historyArr);
    return (all && all.length > 0) ? all[0] : null;
  }

  function extractIndentsFromPrompt(str, historyArr) {
    if (!str && (!historyArr || !historyArr.length)) return [];
    var s = String(str || '').trim();
    if (!s && (!historyArr || !historyArr.length)) return [];
    var sLower = s.toLowerCase();

    var candidates = [];

    // Pattern 1: Direct Regex for factory indents (NL_..., LE_..., IND_...)
    // Supports patterns like NL_0543_TT/25-26, LE_0394_TT/25-26, IND_0242_TT/26-27, IND-2026/89, NL-0543, etc.
    var mDirect = s.match(/\b((?:NL|LE|IND)[-_]\d{2,6}(?:[-_][a-zA-Z0-9]+)*(?:[/-][a-zA-Z0-9_-]+)*)\b/gi);
    if (mDirect) {
      mDirect.forEach(function (m) {
        if (m) candidates.push(m.trim());
      });
    }

    // Pattern 2: Contextual capture after "indent" / "ind" keywords:
    // e.g. "indent NL_0543_TT/25-26 and LE_0394_TT/25-26", "indents: ABC-123, DEF-456"
    var mAfterPrefix = s.match(/(?:indent|indents|ind)\s*(?:no\.?|number|num|#|code|er\s*against\s*e|dilam|er|ta|holo|chilo)?\s*[:=\s-]*([a-zA-Z0-9/_,.\s-]+)/i);
    if (mAfterPrefix && mAfterPrefix[1]) {
      var afterTokens = mAfterPrefix[1].split(/[\s,;&]+|\bar\b|\band\b|\bebong\b/i);
      afterTokens.forEach(function (tok) {
        var tClean = tok.trim().replace(/^[,;:]+|[,;:]+$/g, '');
        if (tClean && tClean.length >= 3 && !/^(er|against|e|dekhao|koto|status|ache|achhe|nei|analysis|bolo|banao|details|dekhte|chaichi|chilo|holo|dilam|ta|ei|ki|amar|tar|kon|akta|ekta|gulo|gulor)$/i.test(tClean)) {
          if (/[0-9]/.test(tClean) && /[a-zA-Z]/.test(tClean)) {
            candidates.push(tClean);
          }
        }
      });
    }

    // Pattern 3: Token immediately BEFORE "indent" / "ind":
    // e.g. "NL_0242_TT/26-27 ei indent er against e bolo", "NL-0242 indent dekhao"
    var mBefore = s.match(/([a-zA-Z0-9/_.-]{3,})\s*(?:ei\s*)?(?:indent|ind)\b/i);
    if (mBefore && mBefore[1]) {
      var candBefore = mBefore[1].trim();
      var cbLower = candBefore.toLowerCase();
      if (!/^(er|against|e|dekhao|koto|status|ache|nei|analysis|bolo|banao|details|dekhte|chaichi|chilo|holo|dilam|ta|ei|ki|amar|tar|kon|akta|ekta|gulo|gulor)$/i.test(cbLower)) {
        candidates.push(candBefore);
      }
    }

    // Pattern 4: Conversation History Fallback
    if (candidates.length === 0 && historyArr && historyArr.length) {
      var isIndFollowUp = sLower.indexOf('indent') !== -1 || sLower.indexOf('status') !== -1 || sLower.indexOf('baki') !== -1 || sLower.indexOf('details') !== -1;
      if (isIndFollowUp) {
        for (var h = historyArr.length - 1; h >= 0; h--) {
          var hText = historyArr[h].text || '';
          var hInds = extractIndentsFromPrompt(hText, null);
          if (hInds && hInds.length > 0) {
            return hInds;
          }
        }
      }
    }

    var noiseWords = [
      'er', 'against', 'e', 'dekhao', 'koto', 'status', 'ache', 'achhe', 'nei', 'analysis',
      'details', 'detail', 'baki', 'sob', 'all', 'chilo', 'holo', 'ta', 'dilam',
      'gulo', 'gulor', 'indent', 'indents', 'ইনডেন্ট', 'and', 'ar', 'ebong', 'o', 'theke', 'kore',
      'dao', 'bhalo', 'ami', 'dhoro', 'onek', 'tumi', 'dekhbe', 'sei', 'miliye',
      'besi', 'batch', 'hochhe', 'ki', 'na', 'jodi', 'hoy', 'tahole', 'excel', 'file',
      'anujayi', 'banabe', 'chat', 'deoar', 'dorkar', 'nai', 'report', 'bolo', 'banao',
      'dekhun', 'bolun', 'janan', 'lagbe', 'chai', 'chaichi', 'dekhte', 'koro', 'diyo',
      'dite', 'paro', 'parbe', 'diye', 'hobe', 'korun', 'janun', 'shuru', 'kora', 'jabe',
      'ei', 'ai', 'oi', 'tar', 'amar', 'tomar', 'kon', 'kono', 'akta', 'ekta', 'shob',
      'protiti', 'amader', 'apnar', 'new', 'notun', 'number', 'no'
    ];

    var seen = {};
    var results = [];

    candidates.forEach(function (c) {
      var cClean = String(c || '').trim();
      if (!cClean || cClean.length <= 2) return;
      var cUp = cClean.toUpperCase();
      if (seen[cUp]) return;
      var cLow = cClean.toLowerCase();
      if (noiseWords.indexOf(cLow) !== -1) return;

      seen[cUp] = true;
      results.push(cClean);
    });

    return results;
  }

  function extractIndentFromPrompt(str, historyArr) {
    var all = extractIndentsFromPrompt(str, historyArr);
    return (all && all.length > 0) ? all[0] : null;
  }

  function formatStyleBatchesResponse(styleNo, batches, forceExcel) {
    if (!batches || !batches.length) return '';
    var lines = [];

    var readyBatchesCount = batches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'READY'; }).length;
    var almostBatchesCount = batches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'ALMOST READY'; }).length;
    var condBatchesCount = batches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'CONDITIONAL'; }).length;
    var holdBatchesCount = batches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'HOLD'; }).length;

    // -------------------------------------------------------------------------
    // IF MORE THAN 2 BATCHES UNDER STYLE: CLUTTER-FREE CHAT + MULTI-SHEET EXCEL REPORT
    // -------------------------------------------------------------------------
    if (batches.length > 2 || forceExcel) {
      var cacheKey = 'style_' + styleNo + '_' + Date.now();
      var styleFileName10 = 'Style_' + styleNo.toUpperCase() + '_Batches_' + batches.length + '.xlsx';
      var styleBatchesCsv10 = batches.map(function (b) { return b.batchNo; }).join(',');
      if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
      window._multiBatchExcelRegistry[cacheKey] = {
        batches: batches,
        fileName: styleFileName10,
        timestamp: Date.now()
      };
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('bai_card_' + cacheKey, JSON.stringify(window._multiBatchExcelRegistry[cacheKey]));
        }
      } catch (e) {}

      var lines10 = [];
      lines10.push('### [STYLE AUDIT REPORT: Style ' + styleNo.toUpperCase() + ']');
      lines10.push('');
      lines10.push('**স্টাইল ওভারভিউ ও রানিং ব্যাচ সামারি:**');
      lines10.push('- **Style Number:** `' + styleNo.toUpperCase() + '`');
      lines10.push('- **Total Active Batches:** **' + batches.length + ' টি ব্যাচ**');
      lines10.push('- **Production Status:** **[READY] ' + readyBatchesCount + ' টি** | **[ALMOST READY] ' + almostBatchesCount + ' টি** | **[CONDITIONAL] ' + condBatchesCount + ' টি** | **[HOLD] ' + holdBatchesCount + ' টি**');
      lines10.push('');
      lines10.push('> [!NOTE]');
      lines10.push('> আপনার অনুরোধ অনুযায়ী ২টির বেশি ব্যাচ (' + batches.length + ' টি ব্যাচ) পাওয়ায় চ্যাট সংক্ষিপ্ত রেখে সম্পূর্ণ ডেটা সম্বলিত একটি সুসজ্জিত **মাল্টি-শিট এক্সেল ফাইল (.xlsx)** প্রস্তুত করা হয়েছে। প্রতিটি ব্যাচের সমস্ত উপাদান ও বিস্তারিত বিবরণ এক্সেলে অন্তর্ভুক্ত রয়েছে।');
      lines10.push('');

      // Embedded Excel Card
      lines10.push('<div class="bai-excel-export-card" data-card-key="' + cacheKey + '" data-style="' + styleNo + '" data-batches="' + styleBatchesCsv10 + '" data-filename="' + styleFileName10 + '" onclick="window.downloadMultiBatchExcel(\'' + cacheKey + '\', this)">' +
        '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
        '<div class="bai-excel-card-info">' +
          '<div class="bai-excel-card-title">' + styleFileName10 + '</div>' +
          '<div class="bai-excel-card-sub">' + batches.length + ' টি ব্যাচের সম্পূর্ণ কাঁচামাল অডিট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
        '</div>' +
        '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
      '</div>');
      lines10.push('');

      // Summary Matrix (NO Planned Qty, NO Prod Qty)
      lines10.push('#### ১. ব্যাচ সারাংশ ম্যাট্রিক্স (Batch Summary Matrix):');
      lines10.push('| # | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Suggestion |');
      lines10.push('|---|---|---|---|---|---|---|---|---|---|');
      batches.forEach(function (b, idx) {
        var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
        var vTag = vUpper === 'READY'
          ? '[READY] Ready for Production (100%)'
          : (vUpper === 'ALMOST READY'
            ? '[ALMOST READY] 90%–99% Ready'
            : (vUpper === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed (60%–89%)' : '[HOLD] Cannot Start Production (< 60%)'));
        lines10.push('| ' + (idx + 1) + ' | `' + b.batchNo + '` | `' + (b.itb || '-') + '` | `' + (b.indentNo || '-') + '` | ' + (b.indentDate || '-') + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
      });
      lines10.push('');

      // Section 2: Shared Bottlenecks
      lines10.push('#### ২. কমন ঘাটতি ও বটলনেক বিশ্লেষণ (Common Bottlenecks across Style Batches):');
      var sharedMap10 = {};
      batches.forEach(function (b) {
        (b.pendingItems || []).forEach(function (it) {
          var key = (it.itemName || it.itemCode || 'Unknown').trim();
          if (!sharedMap10[key]) {
            sharedMap10[key] = {
              name: it.itemName,
              code: it.itemCode,
              batches: [],
              supplierPo: it.supplierPo,
              aiStatus: it.aiStatus,
              storeStatus: it.storeStatus,
              jyotiRemarks: it.remarksJyoti,
              eta: it.eta
            };
          }
          if (sharedMap10[key].batches.indexOf(b.batchNo) === -1) {
            sharedMap10[key].batches.push(b.batchNo);
          }
        });
      });
      var sharedKeys10 = Object.keys(sharedMap10);
      var commonBottlenecks10 = sharedKeys10.filter(function (k) { return sharedMap10[k].batches.length > 1; });
      if (commonBottlenecks10.length > 0) {
        lines10.push('নিচের উপাদানগুলো একাধিক ব্যাচের প্রডাকশন আটকে রেখেছে (Shared Bottlenecks across multiple batches):');
        lines10.push('| # | Blocker Material | Pro Code | Affected Batches | Supplier PO | Delivery ETA / Jyoti Remarks | AI Status | Store Status |');
        lines10.push('|---|---|---|---|---|---|---|---|');
        commonBottlenecks10.slice(0, 15).forEach(function (k, idx) {
          var obj = sharedMap10[k];
          var bList = obj.batches.map(function (b) { return '`' + b + '`'; }).join(', ');
          var etaStr = obj.eta ? obj.eta : (obj.jyotiRemarks !== '-' ? obj.jyotiRemarks : 'Awaited');
          lines10.push('| ' + (idx + 1) + ' | **' + obj.name + '** | `' + obj.code + '` | ' + bList + ' | ' + (obj.supplierPo || '-') + ' | ' + etaStr + ' | `' + obj.aiStatus + '` | ' + obj.storeStatus + ' |');
        });
        if (commonBottlenecks10.length > 15) {
          lines10.push('*...এবং আরও ' + (commonBottlenecks10.length - 15) + ' টি শেয়ার্ড উপাদান সম্পূর্ণ এক্সেলে তালিকাভুক্ত রয়েছে।*');
        }
        lines10.push('');
      } else {
        lines10.push('ব্যাচগুলোর মধ্যে কোনো সাধারণ/শেয়ার্ড ঘাটতি পাওয়া যায়নি; প্রতিটি ব্যাচের পেন্ডিং উপাদান আলাদা আলাদা।');
        lines10.push('');
      }

      // Section 3: Action Plan
      lines10.push('#### ৩. পরবর্তী করণীয় (Action Plan):');
      lines10.push('- **Production Floor:** যেসব ব্যাচে AI Suggestion `[READY]` রয়েছে, কেবল সেগুলোর কাটিং লাইন অবিলম্বে শুরু করা যাবে। `[ALMOST READY]` ব্যাচগুলোর দ্রুত ভেরিফিকেশন সম্পন্ন করুন। `[CONDITIONAL]` ব্যাচে প্রাথমিক কাটিং ও প্রেপ চলবে। `[HOLD]` ব্যাচগুলোর কাজ আটকে রাখুন।');
      lines10.push('- **Store Department (Sandip Chatterjee):** এক্সেল ফাইলের "Pending Materials" শিট দেখে সমস্ত আনভেরিফাইড স্টক দ্রুত ভেরিফাই করে শিট আপডেট করুন।');
      lines10.push('- **Purchase Department (Jyoti):** একাধিক ব্যাচকে আটকে রাখা কমন বটলনেক আইটেমগুলোর ডেলিভারি নিশ্চিত করতে সংশ্লিষ্ট ভেন্ডরদের সাথে অবিলম্বে অগ্রাধিকার ভিত্তিতে যোগাযোগ করুন।');

      return lines10.join('\n');
    }

    lines.push('### [STYLE AUDIT REPORT: Style ' + styleNo.toUpperCase() + ']');
    lines.push('');
    lines.push('**স্টাইল ওভারভিউ ও রানিং ব্যাচ সামারি:**');
    lines.push('- **Style Number:** `' + styleNo.toUpperCase() + '`');
    lines.push('- **Total Active Batches:** **' + batches.length + ' টি ব্যাচ**');
    lines.push('- **Production Status:** **[READY] ' + readyBatchesCount + ' টি** | **[ALMOST READY] ' + almostBatchesCount + ' টি** | **[CONDITIONAL] ' + condBatchesCount + ' টি** | **[HOLD] ' + holdBatchesCount + ' টি**');
    lines.push('');
    lines.push('#### ১. ব্যাচ সারাংশ ম্যাট্রিক্স (Batch Summary Matrix):');
    lines.push('| # | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Suggestion |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    batches.forEach(function (b, idx) {
      var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
      var vTag = vUpper === 'READY'
        ? '[READY] Ready for Production (100%)'
        : (vUpper === 'ALMOST READY'
          ? '[ALMOST READY] 90%–99% Ready'
          : (vUpper === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed (60%–89%)' : '[HOLD] Cannot Start Production (< 60%)'));
      lines.push('| ' + (idx + 1) + ' | `' + b.batchNo + '` | `' + (b.itb || '-') + '` | `' + (b.indentNo || '-') + '` | ' + (b.indentDate || '-') + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
    });
    lines.push('');

    // Embedded Excel Card for 1-click Download
    var styleCardKey = 'style_card_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    var styleFileName = 'Style_' + styleNo.toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '_') + '_Audit_Report.xlsx';
    var styleBatchesCsv = batches.map(function (b) { return b.batchNo; }).join(',');
    if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
    window._multiBatchExcelRegistry[styleCardKey] = { batches: batches, fileName: styleFileName, timestamp: Date.now() };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('bai_card_' + styleCardKey, JSON.stringify(window._multiBatchExcelRegistry[styleCardKey]));
      }
    } catch (e) {}
    lines.push('<div class="bai-excel-export-card" data-card-key="' + styleCardKey + '" data-style="' + styleNo + '" data-batches="' + styleBatchesCsv + '" data-filename="' + styleFileName + '" onclick="window.downloadMultiBatchExcel(\'' + styleCardKey + '\', this)">' +
      '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
      '<div class="bai-excel-card-info">' +
        '<div class="bai-excel-card-title">' + styleFileName + '</div>' +
        '<div class="bai-excel-card-sub">' + batches.length + ' টি ব্যাচের সম্পূর্ণ কাঁচামাল অডিট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
      '</div>' +
      '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
    '</div>');
    lines.push('');

    // Detailed Batch-by-Batch Material Breakdown (কী কী বাকি আছে & কী কী প্রস্তুত)
    lines.push('#### ২. প্রতিটি ব্যাচের বিস্তারিত ম্যাটেরিয়াল স্ট্যাটাস (কী কী রেডি আছে & কী কী বাকি আছে):');
    lines.push('');
    batches.slice(0, 10).forEach(function (b, bIdx) {
      lines.push('---');
      lines.push('##### ব্যাচ #' + (bIdx + 1) + ': `' + b.batchNo + '` (AI Suggestion: **' + (b.aiSuggestion || b.verdict) + '** | ITB: `' + (b.itb || '-') + '` | Indent: `' + (b.indentNo || '-') + '` | Readiness: **' + b.readinessPct + '%**)');
      lines.push('');

      // Pending materials ("কী কী বাকি আছে")
      if (b.pendingItems && b.pendingItems.length > 0) {
        lines.push('**কী কী বাকি আছে & বটলনেক (Pending Materials - ' + b.pendingItems.length + ' টি):**');
        lines.push('| # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Reason |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
        b.pendingItems.forEach(function (it, pIdx) {
          lines.push('| ' + (pIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.pendingQty || '-') + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.blockerReason || it.aiStatus) + ' |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো ম্যাটেরিয়াল পেন্ডিং নেই! এই ব্যাচ ১০০% প্রস্তুত।*');
        lines.push('');
      }

      // Ready materials
      if (b.readyItems && b.readyItems.length > 0) {
        lines.push('**প্রস্তুত কাঁচামাল (Ready Materials - ' + b.readyItems.length + ' টি):**');
        lines.push('| # | Material Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status | AI Status |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|');
        b.readyItems.forEach(function (it, rIdx) {
          lines.push('| ' + (rIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | `' + (it.itb || b.itb || '-') + '` | `' + (it.indentNo || b.indentNo || '-') + '` | ' + (it.indentDate || b.indentDate || '-') + ' | ' + (it.supplierPo || '-') + ' | ' + (it.orderQty !== '-' ? it.orderQty : it.status) + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো উপাদান এখনও সম্পূর্ণ রেডি নয়।*');
        lines.push('');
      }
    });

    lines.push('#### ৩. পরবর্তী করণীয় (Action Plan):');
    lines.push('- **Production Floor:** যেসব ব্যাচে AI Suggestion `READY` এসেছে, কেবল সেগুলোর কাটিং লাইন অবিলম্বে শুরু করা যাবে। `[ALMOST READY]` ব্যাচগুলোর দ্রুত ভেরিফিকেশন সম্পন্ন করুন। `HOLD` ব্যাচগুলোর কাজ আটকে রাখুন।');
    lines.push('- **Store Department (Sandip Chatterjee):** পেন্ডিং ব্যাচগুলোর কাঁচামালের ফিজিক্যাল স্টক অবিলম্বে ভেরিফাই করে শিটে স্ট্যাটাস আপডেট করুন।');
    lines.push('- **Purchase Department (Jyoti):** যে উপাদানগুলোতে Supplier PO এখনও ক্রিয়েট হয়নি (`PO Not Created`), দ্রুত ভেন্ডরের সাথে যোগাযোগ করে পিও ইস্যু ও ডেলিভারি নিশ্চিত করুন।');
    return lines.join('\n');
  }

  function formatStyleNotFoundResponse(targetStyle) {
    var lines = [];
    lines.push('### [স্টাইল অনুসন্ধান: স্টাইল নম্বর পাওয়া যায়নি]');
    lines.push('');
    lines.push('আপনার প্রদত্ত স্টাইল নম্বর **`' + String(targetStyle || '').toUpperCase() + '`** বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট (101,370+ রেকর্ড) বা ট্রায়ো-এআই ডেটাবেসে পাওয়া যায়নি।');
    lines.push('');
    lines.push('**পরামর্শ ও পরবর্তী করণীয়:**');
    lines.push('১. **স্টাইল নম্বর যাচাই করুন:** অনুগ্রহ করে স্টাইল নম্বরের বানান বা ফরম্যাটটি (যেমন: `HHA/159/01BK`, `HSB/121/02`, `T22896`, `BY7044W13`) সঠিক কিনা দেখে নিন।');
    lines.push('২. **লাইভ শিট সিঙ্ক (Sync Sheet):** এই স্টাইলটি যদি সম্প্রতি গুগল শিটে নতুন যুক্ত হয়ে থাকে, তবে উপরের **"Connector Live Sheet Records"** কার্ডের **"Sync Sheet"** বাটনে ক্লিক করে সর্বশেষ ডেটা রিফ্রেশ করে নিন।');
    return lines.join('\n');
  }

  function formatMultiStyleResponse(styles, styleBatchesMap, forceExcel) {
    if (!styles || !styles.length) return '';
    var map = styleBatchesMap || {};
    var allBatches = [];
    var batchSeen = {};
    var notFoundStyles = [];

    styles.forEach(function (st) {
      var bList = map[st];
      if (!bList && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.findBatchesByStyle === 'function') {
        bList = window.ConnectorSheetEngine.findBatchesByStyle(st, 50);
      }
      bList = bList || [];
      if (bList.length === 0) {
        notFoundStyles.push(st);
      } else {
        bList.forEach(function (b) {
          if (!batchSeen[b.batchNo]) {
            batchSeen[b.batchNo] = true;
            if (!b.styleNo || b.styleNo === '-') {
              b.styleNo = st;
            }
            allBatches.push(b);
          }
        });
      }
    });

    var totalBatches = allBatches.length;

    if (totalBatches === 0) {
      var linesNF = [];
      linesNF.push('### [মাল্টি-স্টাইল অনুসন্ধান: কোনো সক্রিয় ব্যাচ পাওয়া যায়নি]');
      linesNF.push('');
      linesNF.push('আপনার প্রদত্ত স্টাইলগুলোর (`' + styles.map(function (s) { return s.toUpperCase(); }).join('`, `') + '`) অধীনে বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিটে কোনো সক্রিয় ব্যাচ রেকর্ড পাওয়া যায়নি।');
      linesNF.push('');
      linesNF.push('**সম্ভাব্য কারণ ও পরবর্তী করণীয়:**');
      linesNF.push('1. **স্টাইল নম্বর যাচাই করুন:** স্টাইল কোডগুলোর স্পেলিং ঠিক আছে কিনা মিলিয়ে নিন (যেমন: `T22896`, `HHA/138/01`, `BY7044W13`)।');
      linesNF.push('2. **লাইভ শিট সিঙ্ক (Sync Sheet):** স্টাইলগুলোর প্রডাকশন প্ল্যান সম্প্রতি যুক্ত হয়ে থাকলে উপরের "Sync Sheet" বাটনে ক্লিক করে ডেটা রিফ্রেশ করুন।');
      return linesNF.join('\n');
    }

    var readyCount = allBatches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'READY'; }).length;
    var almostCount = allBatches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'ALMOST READY'; }).length;
    var condCount = allBatches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'CONDITIONAL'; }).length;
    var holdCount = allBatches.filter(function (b) { return (b.aiSuggestion || b.verdict) === 'HOLD'; }).length;

    var cleanStyleNames = styles.slice(0, 3).map(function (s) { return s.replace(/[^a-zA-Z0-9]/g, ''); }).join('_');
    var excelFileName = 'Multi_Style_Batch_Audit_' + cleanStyleNames + (styles.length > 3 ? '_and_more' : '') + '.xlsx';

    var cacheKey = 'multistyle_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    var multistyleBatchesCsv = allBatches.map(function (b) { return b.batchNo; }).join(',');
    if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
    window._multiBatchExcelRegistry[cacheKey] = {
      batches: allBatches,
      fileName: excelFileName,
      timestamp: Date.now()
    };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('bai_card_' + cacheKey, JSON.stringify(window._multiBatchExcelRegistry[cacheKey]));
      }
    } catch (e) {}

    var lines = [];
    lines.push('### [MULTI-STYLE PRODUCTION AUDIT REPORT]');
    lines.push('');
    lines.push('**মাল্টি-স্টাইল ওভারভিউ ও রানিং ব্যাচ সামারি:**');
    lines.push('- **Styles Analyzed:** ' + styles.map(function (s) { return '`' + s.toUpperCase() + '`'; }).join(', ') + (notFoundStyles.length > 0 ? ' *(রেকর্ড নেই: `' + notFoundStyles.map(function(s){return s.toUpperCase();}).join('`, `') + '`)*' : ''));
    lines.push('- **Total Active Batches:** **' + totalBatches + ' টি ব্যাচ** (সকল স্টাইল মিলিয়ে)');
    lines.push('- **Production Status:** **[READY] ' + readyCount + ' টি** | **[ALMOST READY] ' + almostCount + ' টি** | **[CONDITIONAL] ' + condCount + ' টি** | **[HOLD] ' + holdCount + ' টি**');
    lines.push('');

    // -------------------------------------------------------------------------
    // IF TOTAL BATCHES ACROSS STYLES > 2: CLUTTER-FREE CHAT + AUTO EXCEL FILE
    // -------------------------------------------------------------------------
    if (totalBatches > 2 || forceExcel) {
      lines.push('> [!NOTE]');
      lines.push('> আপনার অনুরোধ অনুযায়ী প্রদত্ত স্টাইলগুলোর অধীনে সর্বমোট **' + totalBatches + ' টি সক্রিয় ব্যাচ** পাওয়া গেছে (যা ২টির বেশি)। আপনার নির্দেশ অনুযায়ী চ্যাট দীর্ঘ ও জটিল না করে সমস্ত কাঁচামালের বিস্তারিত হিসাব সহ একটি **মাল্টি-শিট এক্সেল রিপোর্ট (.xlsx)** প্রস্তুত ও ডাউনলোড করা হয়েছে। এক্সেলে প্রতিটি ব্যাচের রেডি উপাদান, পেন্ডিং উপাদান ও কমন বটলনেক অন্তর্ভুক্ত রয়েছে।');
      lines.push('');

      // Embedded Excel Card
      lines.push('<div class="bai-excel-export-card" data-card-key="' + cacheKey + '" data-batches="' + multistyleBatchesCsv + '" data-filename="' + excelFileName + '" onclick="window.downloadMultiBatchExcel(\'' + cacheKey + '\', this)">' +
        '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
        '<div class="bai-excel-card-info">' +
          '<div class="bai-excel-card-title">' + excelFileName + '</div>' +
          '<div class="bai-excel-card-sub">' + totalBatches + ' টি ব্যাচ (' + styles.length + ' টি স্টাইল) • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
        '</div>' +
        '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
      '</div>');
      lines.push('');

      // Table 1: Multi-Style Summary Matrix (Strictly NO Planned Qty, NO Prod Qty)
      lines.push('#### ১. স্টাইল ও ব্যাচ সারাংশ ম্যাট্রিক্স (Multi-Style Batch Summary Matrix):');
      lines.push('| # | Style No | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Suggestion |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
      allBatches.forEach(function (b, idx) {
        var vUpper = (b.aiSuggestion || b.verdict || '').toUpperCase();
        var vTag = vUpper === 'READY'
          ? '[READY] Ready for Production (100%)'
          : (vUpper === 'ALMOST READY'
            ? '[ALMOST READY] 90%–99% Ready'
            : (vUpper === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed (60%–89%)' : '[HOLD] Cannot Start Production (< 60%)'));
        var itbStr = (b.itb && b.itb !== '-') ? b.itb : '-';
        var indNoStr = (b.indentNo && b.indentNo !== '-') ? b.indentNo : '-';
        var indDtStr = (b.indentDate && b.indentDate !== '-') ? b.indentDate : '-';
        lines.push('| ' + (idx + 1) + ' | `' + (b.styleNo || '-') + '` | `' + b.batchNo + '` | ' + itbStr + ' | ' + indNoStr + ' | ' + indDtStr + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
      });
      lines.push('');

      // Section 2: Cross-Style Common Bottlenecks
      lines.push('#### ২. কমন ঘাটতি ও শেয়ার্ড বটলনেক বিশ্লেষণ (Cross-Style Shared Bottlenecks):');
      var sharedMap = {};
      allBatches.forEach(function (b) {
        (b.pendingItems || []).forEach(function (it) {
          var key = (it.itemName || it.itemCode || 'Unknown').trim();
          if (!sharedMap[key]) {
            sharedMap[key] = {
              name: it.itemName,
              code: it.itemCode,
              batches: [],
              styles: [],
              supplierPo: it.supplierPo,
              aiStatus: it.aiStatus,
              storeStatus: it.storeStatus,
              jyotiRemarks: it.remarksJyoti,
              eta: it.eta
            };
          }
          if (sharedMap[key].batches.indexOf(b.batchNo) === -1) {
            sharedMap[key].batches.push(b.batchNo);
          }
          if (b.styleNo && b.styleNo !== '-' && sharedMap[key].styles.indexOf(b.styleNo) === -1) {
            sharedMap[key].styles.push(b.styleNo);
          }
        });
      });

      var sharedKeys = Object.keys(sharedMap);
      var commonBottlenecks = sharedKeys.filter(function (k) { return sharedMap[k].batches.length > 1; });
      if (commonBottlenecks.length > 0) {
        lines.push('নিচের উপাদানগুলো একাধিক স্টাইল ও ব্যাচের প্রডাকশন আটকে রেখেছে (Shared Bottlenecks across multiple styles/batches):');
        lines.push('| # | Blocker Material | Pro Code | Affected Styles | Affected Batches | Supplier PO | Delivery ETA / Jyoti Remarks | AI Status | Store Status |');
        lines.push('|---|---|---|---|---|---|---|---|---|');
        commonBottlenecks.slice(0, 15).forEach(function (k, idx) {
          var obj = sharedMap[k];
          var stList = obj.styles.map(function (s) { return '`' + s + '`'; }).join(', ');
          var bList = obj.batches.map(function (b) { return '`' + b + '`'; }).join(', ');
          var etaStr = obj.eta ? obj.eta : (obj.jyotiRemarks !== '-' ? obj.jyotiRemarks : 'Awaited');
          lines.push('| ' + (idx + 1) + ' | **' + obj.name + '** | `' + obj.code + '` | ' + stList + ' | ' + bList + ' | ' + (obj.supplierPo || '-') + ' | ' + etaStr + ' | `' + obj.aiStatus + '` | ' + obj.storeStatus + ' |');
        });
        if (commonBottlenecks.length > 15) {
          lines.push('*...এবং আরও ' + (commonBottlenecks.length - 15) + ' টি শেয়ার্ড উপাদান সম্পূর্ণ এক্সেলে তালিকাভুক্ত রয়েছে।*');
        }
        lines.push('');
      } else {
        lines.push('স্টাইলগুলোর ব্যাচের মধ্যে কোনো সাধারণ শেয়ার্ড ঘাটতি পাওয়া যায়নি; প্রতিটি ব্যাচের পেন্ডিং উপাদান আলাদা আলাদা।');
        lines.push('');
      }

      // Section 3: Action Plan
      lines.push('#### ৩. পরবর্তী করণীয় (Action Plan):');
      lines.push('- **Production Floor:** যেসব ব্যাচে Verdict `[READY]` রয়েছে, কেবল সেগুলোর কাটিং লাইন অবিলম্বে শুরু করা যাবে। `[CONDITIONAL]` ব্যাচে কাটিং ও প্রেপ চলবে। `[HOLD]` ব্যাচগুলোর কাজ আটকে রাখুন।');
      lines.push('- **Store Department (Sandip Chatterjee):** এক্সেল ফাইলের "Pending Materials" শিট দেখে সমস্ত আনভেরিফাইড স্টক দ্রুত ফিজিক্যাল ভেরিফাই করে শিট আপডেট করুন।');
      lines.push('- **Purchase Department (Jyoti):** একাধিক স্টাইল ও ব্যাচকে আটকে রাখা কমন বটলনেক উপাদানগুলোর ডেলিভারি নিশ্চিত করতে সংশ্লিষ্ট ভেন্ডরদের সাথে অবিলম্বে অগ্রাধিকার ভিত্তিতে যোগাযোগ করুন।');

      return lines.join('\n');
    }

    // -------------------------------------------------------------------------
    // IF TOTAL BATCHES <= 10: RENDER BATCH-BY-BATCH BREAKDOWN IN CHAT + EXCEL CARD
    // -------------------------------------------------------------------------
    lines.push('<div class="bai-excel-export-card" data-card-key="' + cacheKey + '" data-batches="' + multistyleBatchesCsv + '" data-filename="' + excelFileName + '" onclick="window.downloadMultiBatchExcel(\'' + cacheKey + '\', this)">' +
      '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
      '<div class="bai-excel-card-info">' +
        '<div class="bai-excel-card-title">' + excelFileName + '</div>' +
        '<div class="bai-excel-card-sub">' + totalBatches + ' টি ব্যাচ (' + styles.length + ' টি স্টাইল) • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
      '</div>' +
      '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
    '</div>');
    lines.push('');

    // Table 1: Multi-Style Summary Matrix
    lines.push('#### ১. স্টাইল ও ব্যাচ সারাংশ ম্যাট্রিক্স (Multi-Style Batch Summary Matrix):');
    lines.push('| # | Style No | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    allBatches.forEach(function (b, idx) {
      var itbStr = (b.itb && b.itb !== '-') ? b.itb : '-';
      var indNoStr = (b.indentNo && b.indentNo !== '-') ? b.indentNo : '-';
      var indDtStr = (b.indentDate && b.indentDate !== '-') ? b.indentDate : '-';
      var vTag = b.verdict === 'READY'
        ? '[READY] Ready for Production'
        : (b.verdict === 'CONDITIONAL' ? '[CONDITIONAL] Cutting Allowed' : '[HOLD] Cannot Start Production');
      lines.push('| ' + (idx + 1) + ' | `' + (b.styleNo || '-') + '` | `' + b.batchNo + '` | ' + itbStr + ' | ' + indNoStr + ' | ' + indDtStr + ' | ' + b.totalCount + ' | ' + b.readyCount + ' | ' + b.pendingCount + ' | **' + b.readinessPct + '%** | **' + vTag + '** |');
    });
    lines.push('');

    // Detailed Batch-by-Batch Material Breakdown (কী কী বাকি আছে & কী কী প্রস্তুত)
    lines.push('#### ২. প্রতিটি ব্যাচের বিস্তারিত ম্যাটেরিয়াল স্ট্যাটাস (কী কী রেডি আছে & কী কী বাকি আছে):');
    lines.push('');
    allBatches.forEach(function (b, bIdx) {
      lines.push('---');
      var bItb = (b.itb && b.itb !== '-') ? b.itb : '-';
      var bIndNo = (b.indentNo && b.indentNo !== '-') ? b.indentNo : '-';
      var bIndDt = (b.indentDate && b.indentDate !== '-') ? b.indentDate : '-';
      lines.push('##### ব্যাচ #' + (bIdx + 1) + ': `' + b.batchNo + '` (Style: `' + (b.styleNo || '-') + '` | ITB: `' + bItb + '` | Indent: `' + bIndNo + '` (' + bIndDt + ') | Verdict: **' + b.verdict + '** | Readiness: **' + b.readinessPct + '%**)');
      lines.push('');

      // Ready materials
      if (b.readyItems && b.readyItems.length > 0) {
        lines.push('**প্রস্তুত কাঁচামাল (Ready Materials - ' + b.readyItems.length + ' টি):**');
        lines.push('| # | Material Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status | AI Status |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|');
        b.readyItems.forEach(function (it, rIdx) {
          var itbVal = (it.itb && it.itb !== '-') ? it.itb : bItb;
          var indNoVal = (it.indentNo && it.indentNo !== '-') ? it.indentNo : bIndNo;
          var indDtVal = (it.indentDate && it.indentDate !== '-') ? it.indentDate : bIndDt;
          lines.push('| ' + (rIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | ' + itbVal + ' | ' + indNoVal + ' | ' + indDtVal + ' | ' + (it.supplierPo || '-') + ' | ' + (it.orderQty !== '-' ? it.orderQty : it.status) + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো উপাদান এখনও সম্পূর্ণ রেডি নয়।*');
        lines.push('');
      }

      // Pending materials ("কী কী বাকি আছে")
      if (b.pendingItems && b.pendingItems.length > 0) {
        lines.push('**কী কী বাকি আছে & বটলনেক (Pending Materials - ' + b.pendingItems.length + ' টি):**');
        lines.push('| # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Reason |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
        b.pendingItems.forEach(function (it, pIdx) {
          var itbVal = (it.itb && it.itb !== '-') ? it.itb : bItb;
          var indNoVal = (it.indentNo && it.indentNo !== '-') ? it.indentNo : bIndNo;
          var indDtVal = (it.indentDate && it.indentDate !== '-') ? it.indentDate : bIndDt;
          lines.push('| ' + (pIdx + 1) + ' | **' + it.itemName + '** | `' + it.itemCode + '` | ' + itbVal + ' | ' + indNoVal + ' | ' + indDtVal + ' | ' + (it.supplierPo || '-') + ' | ' + (it.pendingQty || '-') + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.blockerReason || it.aiStatus) + ' |');
        });
        lines.push('');
      } else {
        lines.push('*কোনো ম্যাটেরিয়াল পেন্ডিং নেই! এই ব্যাচ ১০০% প্রস্তুত।*');
        lines.push('');
      }
    });

    lines.push('#### ৩. পরবর্তী করণীয় (Action Plan):');
    lines.push('- **Production Floor:** যেসব ব্যাচে Verdict `READY` এসেছে, কেবল সেগুলোর কাটিং লাইন অবিলম্বে শুরু করা যাবে। `HOLD` ব্যাচগুলোর কাজ আটকে রাখুন।');
    lines.push('- **Store Department (Sandip Chatterjee):** পেন্ডিং ব্যাচগুলোর কাঁচামালের ফিজিক্যাল স্টক অবিলম্বে ভেরিফাই করে শিটে স্ট্যাটাস আপডেট করুন।');
    lines.push('- **Purchase Department (Jyoti):** যে উপাদানগুলোতে Supplier PO এখনও ক্রিয়েট হয়নি (`PO Not Created`), দ্রুত ভেন্ডরের সাথে যোগাযোগ করে পিও ইস্যু ও ডেলিভারি নিশ্চিত করুন।');
    return lines.join('\n');
  }

  function formatAllReadyBatchesResponse(readyBatches, forceExcel) {
    var lines = [];
    lines.push('### [AUDIT REPORT: ALL BATCHES READY FOR PRODUCTION (100% STORE OK)]');
    lines.push('');
    lines.push('**এক্সিকিউটিভ সামারি (Executive Summary):**');
    lines.push('ফ্যাক্টরির লাইভ কানেক্টর শিট অডিটের ভিত্তিতে বর্তমানে যেসকল ব্যাচের কাঁচামাল **১০০% রিসিভড** হয়েছে এবং স্টোর ম্যানেজার **সন্দীপ চ্যাটার্জি** কর্তৃক Store Status **[OK]** হিসেবে চূড়ান্ত ভেরিফাই করা হয়েছে, সেগুলোর বিস্তারিত বিশ্লেষণ নিচে উপস্থাপন করা হলো:');
    lines.push('');

    if (!readyBatches || readyBatches.length === 0) {
      lines.push('বর্তমানে কোনো ব্যাচে ১০০% কাঁচামাল প্রাপ্তি ও স্টোর ক্লিয়ারেন্স সম্পন্ন অবস্থায় পাওয়া যায়নি। সমস্ত সক্রিয় ব্যাচে কিছু উপাদান পেন্ডিং বা ভেরিফিকেশন প্রক্রিয়াধীন রয়েছে।');
      lines.push('');
      lines.push('- **পরামর্শ:** স্টোর ডিপার্টমেন্টকে (Sandip Chatterjee) আনভেরিফাইড স্টক দ্রুত ভেরিফাই করে শিট আপডেট করার নির্দেশ দিন এবং পারচেজ ডিপার্টমেন্টকে (Jyoti) পেন্ডিং PO ডেলিভারি তদারকি করতে বলুন।');
      return lines.join('\n');
    }

    var totalMaterials = 0;
    var styleMap = {};
    readyBatches.forEach(function (b) {
      totalMaterials += (b.totalCount || 0);
      var st = (b.styleNo || 'Unknown').trim();
      if (!styleMap[st]) styleMap[st] = [];
      styleMap[st].push(b);
    });
    var uniqueStyles = Object.keys(styleMap);

    // Operational KPI Overview
    lines.push('**সার্বিক উৎপাদন প্রস্তুতি মেট্রিক্স (Operational Metrics):**');
    lines.push('- **মোট প্রস্তুত ব্যাচ (Total Ready Batches):** **' + readyBatches.length + ' টি ব্যাচ**');
    lines.push('- **সম্পর্কিত মোট স্টাইল (Styles Covered):** **' + uniqueStyles.length + ' টি স্টাইল**');
    lines.push('- **যাচাইকৃত মোট কাঁচামাল (Total Verified Materials):** **' + totalMaterials + ' টি উপাদান (১০০% প্রস্তুত)**');
    lines.push('- **ঘাটতি কাঁচামাল (Pending Materials):** **0 টি (শূন্য ঘাটতি / Zero Blocker)**');
    lines.push('- **স্টোর অনুমোদন (Store Clearance):** **Sandip Chatterjee (Store Manager) — 100% OK**');
    lines.push('- **ফ্যাক্টরি ভার্ডিক্ট (Factory Floor Verdict):** **`[READY TO START - 100% Cleared]`**');
    lines.push('');

    // Excel Export Card
    var cacheKey = 'ready_all_' + Date.now();
    var readyBatchesCsv = readyBatches.map(function (b) { return b.batchNo; }).join(',');
    if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
    window._multiBatchExcelRegistry[cacheKey] = {
      batches: readyBatches,
      fileName: 'Ready_For_Production_Batches_Audit_Report.xlsx',
      timestamp: Date.now()
    };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('bai_card_' + cacheKey, JSON.stringify(window._multiBatchExcelRegistry[cacheKey]));
      }
    } catch (e) {}

    lines.push('<div class="bai-excel-export-card" data-card-key="' + cacheKey + '" data-batches="' + readyBatchesCsv + '" data-filename="Ready_For_Production_Batches_Audit_Report.xlsx" onclick="window.downloadMultiBatchExcel(\'' + cacheKey + '\', this)">' +
      '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
      '<div class="bai-excel-card-info">' +
        '<div class="bai-excel-card-title">Ready_For_Production_Batches_Audit_Report.xlsx</div>' +
        '<div class="bai-excel-card-sub">১০০% প্রস্তুত ' + readyBatches.length + 'টি ব্যাচের সম্পূর্ণ অডিট রিপোর্ট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
      '</div>' +
      '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
    '</div>');
    lines.push('');

    // Table 1: Ready Batches Detailed List
    lines.push('#### ১. প্রস্তুত ব্যাচসমূহের বিবরণী তালিকা (Ready Batches List):');
    lines.push('| # | Batch No | Style No | ITB | Indent No | Indent Date | ETD | Brand / Unit | Total Material | Ready Material | Pending Material | Store Status | AI Verdict |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    var maxChatRows = readyBatches.length > 25 ? 20 : readyBatches.length;
    for (var i = 0; i < maxChatRows; i++) {
      var rb = readyBatches[i];
      var itbStr = (rb.itb && rb.itb !== '-') ? rb.itb : '-';
      var indNoStr = (rb.indentNo && rb.indentNo !== '-') ? rb.indentNo : '-';
      var indDtStr = (rb.indentDate && rb.indentDate !== '-') ? rb.indentDate : '-';
      var etdStr = (rb.etd && rb.etd !== '-') ? '**' + rb.etd + '**' : '-';
      var brandStr = (rb.brand && rb.brand !== '-') ? rb.brand : '-';
      lines.push('| ' + (i + 1) + ' | `' + rb.batchNo + '` | `' + rb.styleNo + '` | ' + itbStr + ' | ' + indNoStr + ' | ' + indDtStr + ' | ' + etdStr + ' | ' + brandStr + ' | ' + rb.totalCount + ' | ' + rb.readyCount + ' | 0 | **OK (Sandip)** | `[READY]` |');
    }
    if (readyBatches.length > maxChatRows) {
      lines.push('');
      lines.push('*(আরও ' + (readyBatches.length - maxChatRows) + 'টি ব্যাচসহ মোট ' + readyBatches.length + 'টি ব্যাচের সম্পূর্ণ তালিকা উপরের এক্সেল ফাইলে অন্তর্ভুক্ত রয়েছে — এক্সেল ফাইলটি ডাউনলোড করতে কার্ডে ক্লিক করুন)*');
    }
    lines.push('');

    // Deep Analysis: Style-wise Production Grouping
    lines.push('#### ২. স্টাইল ভিত্তিক উৎপাদন প্রস্তুতি ও ব্যাচ বিন্যাস (Style Grouping Analysis):');
    uniqueStyles.forEach(function (st) {
      var bList = styleMap[st];
      var bNames = bList.map(function (x) { return '`' + x.batchNo + '`'; }).join(', ');
      lines.push('- **Style `' + st + '`:** মোট **' + bList.length + 'টি ব্যাচ** প্রস্তুত (' + bNames + ')');
    });
    lines.push('');

    // Deep Analysis: ETD & Priority
    lines.push('#### ৩. ডেলিভারি সময়সীমা ও কাটিং অগ্রাধিকার (ETD & Floor Priority):');
    var withEtd = readyBatches.filter(function (b) { return b.etd && b.etd !== '-'; });
    if (withEtd.length > 0) {
      lines.push('- যে সকল ব্যাচের ডেলিভারি তারিখ (ETD) সন্নিকটে রয়েছে, সেগুলোর ফেব্রিক ও লে-প্ল্যান অবিলম্বে কাটিং টেবিলে অগ্রাধিকার দেওয়া সমীচীন।');
    } else {
      lines.push('- তালিকাভুক্ত সমস্ত ব্যাচের কাঁচামাল ১০০% ভেরিফাইড থাকায় ফ্লোরের কাটিং টেবিল ও ক্যাপাসিটি অনুযায়ী তাৎক্ষণিকভাবে যে কোনো ব্যাচের কাজ শুরু করা নিরাপদ।');
    }
    lines.push('');

    // Action Plan
    lines.push('#### ৪. ডিপার্টমেন্ট ভিত্তিক সমন্বিত অ্যাকশন প্ল্যান (Floor Action Plan):');
    lines.push('- **Cutting Master:** তালিকাভুক্ত ১০০% প্রস্তুত ব্যাচগুলোর প্যাটার্ন ও মার্কার প্রস্তুত করে কাটিং শুরু করুন।');
    lines.push('- **Store Department (Sandip Chatterjee):** অনুমোদিত কাঁচামাল ফ্লোরে ইস্যু করার জন্য রিলিজ স্লিপ চূড়ান্ত করুন।');
    lines.push('- **Line Supervisor:** একই স্টাইলের ব্যাচগুলো পর্যায়ক্রমে লাইনে তুলুন যাতে মেটেরিয়াল হ্যান্ডলিং ও লাইন সেটিং অপটিমাইজড থাকে।');

    return lines.join('\n');
  }

  function formatIndentAuditResponse(audit) {
    if (!audit) return '';
    var lines = [];
    lines.push('### [INDENT PROCUREMENT AUDIT: Indent ' + audit.indentNo + ']');
    lines.push('');
    lines.push('**ইনডেন্ট ও পারচেজ অর্ডার সারসংক্ষেপ (Indent Overview):**');
    lines.push('- **Indent No:** `' + audit.indentNo + '`');
    lines.push('- **Associated Batches:** `' + (audit.batches || '-') + '`');
    lines.push('- **Associated Styles:** `' + (audit.styleNo || '-') + '`');
    lines.push('- **Supplier PO(s):** `' + (audit.supplierPo || '-') + '`');
    lines.push('- **Total Materials in Indent:** **' + audit.itemCount + ' টি**');
    lines.push('- **Total Order Qty:** `' + audit.totalOrderQty + '` | **Total GRN Qty:** `' + audit.totalGrnQty + '` | **Total Pending Qty:** `' + audit.totalPendingQty + '`');
    lines.push('');
    lines.push('#### ইনডেন্ট কম্পোনেন্ট অডিট টেবিল (Procurement Breakdown):');
    lines.push('| # | Batch No | Style No | Item Name | Pro Code | Supplier PO | Order Qty | GRN Qty | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Jyoti Remarks |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    audit.items.forEach(function (it, idx) {
      lines.push('| ' + (idx + 1) + ' | `' + it.batch + '` | `' + it.style + '` | **' + it.itemName + '** | `' + it.itemCode + '` | ' + (it.supplierPo || '-') + ' | ' + it.orderQty + ' | ' + it.grnQty + ' | ' + it.pendingQty + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.jyotiRemarks || '-') + ' |');
    });
    lines.push('');

    // Bottleneck analysis
    var poNotCreatedCount = 0;
    var materialPendingCount = 0;
    var materialReceivedCount = 0;
    audit.items.forEach(function (it) {
      var s = String(it.aiStatus || '').toLowerCase();
      if (s.indexOf('po not created') !== -1) poNotCreatedCount++;
      else if (s.indexOf('material pending') !== -1) materialPendingCount++;
      else if (s.indexOf('material received') !== -1) materialReceivedCount++;
    });

    lines.push('#### অডিট বিশ্লেষণ ও মূল বটলনেক (Procurement Bottleneck):');
    if (poNotCreatedCount === audit.itemCount) {
      lines.push('- **[CRITICAL BOTTLENECK - PO NOT CREATED]:** এই ইনডেন্টের আওতাভুক্ত সমস্ত **' + audit.itemCount + 'টি আইটেমের জন্যই পারচেজ অর্ডার এখনো ক্রিয়েট করা হয়নি (`PO Not Create`)**। ইনডেন্ট অনুমোদিত হলেও সাপ্লায়ারের নিকট PO ইস্যু না করায় কাঁচামাল পৌঁছায়নি এবং সংশ্লিষ্ট ব্যাচগুলোর উৎপাদন সম্পূর্ণ স্থগিত (`HOLD`) রয়েছে।');
    } else {
      if (poNotCreatedCount > 0) {
        lines.push('- **PO Not Created:** ' + poNotCreatedCount + 'টি আইটেমের সাপ্লায়ার PO এখনও ইস্যু করা হয়নি।');
      }
      if (materialPendingCount > 0) {
        lines.push('- **Material Pending:** ' + materialPendingCount + 'টি আইটেমের PO ইস্যু হলেও ডেলিভারি পেন্ডিং রয়েছে।');
      }
      if (materialReceivedCount > 0) {
        lines.push('- **Material Received:** ' + materialReceivedCount + 'টি আইটেম ফ্যাক্টরিতে রিসিভ হয়েছে।');
      }
    }
    lines.push('');
    lines.push('#### পরবর্তী পদক্ষেপ (Action Plan):');
    lines.push('- **[ACTION - Jyoti (Purchase Department)]:** অবিলম্বে এই ইনডেন্টের উপাদানগুলোর জন্য সংশ্লিষ্ট ভেন্ডরদের কাছে Supplier PO ইস্যু করুন এবং ডেলিভারি কনফার্মেশন ডেট শিটে আপডেট করুন।');
    lines.push('- **[ACTION - Sandip Chatterjee (Store Manager)]:** সাপ্লায়ার থেকে চালানসহ মালামাল ফ্যাক্টরিতে আসার সাথে সাথে ফিজিক্যাল স্টক ভেরিফিকেশন ও GRN সম্পন্ন করে স্টোর স্ট্যাটাস OK আপডেট করুন।');
    return lines.join('\n');
  }

  function formatMultiIndentResponse(indents, indentAuditsMap, forceExcel) {
    if (!indents || !indents.length) return '';
    var map = indentAuditsMap || {};
    var foundAudits = [];
    var notFoundIndents = [];
    var allBatchesSet = new Set();
    var allStylesSet = new Set();
    var allBatchesAudits = [];
    var batchSeen = {};

    indents.forEach(function (ind) {
      var audit = map[ind];
      if (!audit && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.getIndentAudit === 'function') {
        audit = window.ConnectorSheetEngine.getIndentAudit(ind);
      }
      if (!audit) {
        notFoundIndents.push(ind);
      } else {
        foundAudits.push(audit);
        if (audit.batches) {
          audit.batches.split(/,\s*/).forEach(function (b) {
            b = b.trim();
            if (b && b !== '-') {
              allBatchesSet.add(b);
              if (!batchSeen[b] && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.getBatchMaterialReadiness === 'function') {
                batchSeen[b] = true;
                var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
                if (r) allBatchesAudits.push(r);
              }
            }
          });
        }
        if (audit.styleNo) {
          audit.styleNo.split(/,\s*/).forEach(function (st) {
            st = st.trim();
            if (st && st !== '-') allStylesSet.add(st);
          });
        }
      }
    });

    if (foundAudits.length === 0) {
      var linesNF = [];
      linesNF.push('### [মাল্টি-ইনডেন্ট অনুসন্ধান: কোনো ইনডেন্ট পাওয়া যায়নি]');
      linesNF.push('');
      linesNF.push('আপনার প্রদত্ত ইনডেন্টগুলোর (`' + indents.join('`, `') + '`) কোনটিই বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট বা ট্রায়ো-এআই ডেটাবেসে পাওয়া যায়নি।');
      linesNF.push('');
      linesNF.push('**পরামর্শ ও পরবর্তী করণীয়:**');
      linesNF.push('১. **ইনডেন্ট নম্বর যাচাই করুন:** ইনডেন্ট কোডগুলোর স্পেলিং ও ফরম্যাট ঠিক আছে কিনা দেখে নিন (যেমন: `NL_0543_TT/25-26`, `LE_0394_TT/25-26`)।');
      linesNF.push('২. **লাইভ শিট সিঙ্ক (Sync Sheet):** ইনডেন্টগুলো সম্প্রতি সিস্টেমে এন্ট্রি করা হয়ে থাকলে উপরের **"Connector Live Sheet Records"** কার্ডের **"Sync Sheet"** বাটনে ক্লিক করে ডেটা রিফ্রেশ করে নিন।');
      return linesNF.join('\n');
    }

    var totalItemsCount = 0;
    var totalOrderQtyAll = 0;
    var totalGrnQtyAll = 0;
    var totalPendingQtyAll = 0;

    var indentMatrixRows = [];
    var sharedPoNotCreated = [];
    var sharedPendingMaterials = [];

    foundAudits.forEach(function (aud) {
      var poNotCreatedCount = 0;
      var matPendingCount = 0;
      var matReceivedCount = 0;

      var oQty = parseFloat(aud.totalOrderQty) || 0;
      var gQty = parseFloat(aud.totalGrnQty) || 0;
      var pQty = parseFloat(aud.totalPendingQty) || 0;
      totalOrderQtyAll += oQty;
      totalGrnQtyAll += gQty;
      totalPendingQtyAll += pQty;
      totalItemsCount += aud.itemCount;

      aud.items.forEach(function (it) {
        var s = String(it.aiStatus || '').toLowerCase();
        var poStr = String(it.supplierPo || '').toLowerCase();
        var isPoMissing = s.indexOf('po not created') !== -1 || poStr.indexOf('po not create') !== -1 || poStr === '-' || poStr === '' || poStr.indexOf('data not found') !== -1;
        var pNum = parseFloat(String(it.pendingQty).replace(/[^0-9.]/g, '')) || 0;

        if (isPoMissing) {
          poNotCreatedCount++;
          sharedPoNotCreated.push({
            indentNo: aud.indentNo,
            batch: it.batch,
            style: it.style,
            itemCode: it.itemCode,
            itemName: it.itemName,
            orderQty: it.orderQty,
            storeStatus: it.storeStatus,
            aiStatus: it.aiStatus,
            jyotiRemarks: it.jyotiRemarks
          });
        } else if (s.indexOf('material pending') !== -1 || pNum > 0) {
          matPendingCount++;
          sharedPendingMaterials.push({
            indentNo: aud.indentNo,
            batch: it.batch,
            style: it.style,
            itemCode: it.itemCode,
            itemName: it.itemName,
            supplierPo: it.supplierPo,
            pendingQty: it.pendingQty,
            storeStatus: it.storeStatus,
            aiStatus: it.aiStatus,
            jyotiRemarks: it.jyotiRemarks
          });
        } else {
          matReceivedCount++;
        }
      });

      var verdictBadge = '';
      if (poNotCreatedCount === aud.itemCount) {
        verdictBadge = '[CRITICAL] PO Not Created';
      } else if (poNotCreatedCount > 0) {
        verdictBadge = '[HOLD] Partial PO Created (' + poNotCreatedCount + ' Pending)';
      } else if (matPendingCount > 0) {
        verdictBadge = '[PENDING] Delivery Awaited (' + matPendingCount + ' Pending)';
      } else {
        verdictBadge = '[READY] 100% Received';
      }

      indentMatrixRows.push({
        indentNo: aud.indentNo,
        styles: aud.styleNo,
        batches: aud.batches,
        itemCount: aud.itemCount,
        matReceivedCount: matReceivedCount,
        matPendingCount: matPendingCount,
        poNotCreatedCount: poNotCreatedCount,
        verdictBadge: verdictBadge
      });
    });

    var lines = [];
    lines.push('### [MULTI-INDENT PROCUREMENT AUDIT REPORT]');
    lines.push('');
    lines.push('**মাল্টি-ইনডেন্ট সারসংক্ষেপ (Multi-Indent Overview):**');
    lines.push('- **Indents Analyzed:** ' + foundAudits.map(function (a) { return '`' + a.indentNo + '`'; }).join(', ') + (notFoundIndents.length > 0 ? ' *(রেকর্ড নেই: `' + notFoundIndents.join('`, `') + '`)*' : ''));
    lines.push('- **Associated Styles:** ' + (Array.from(allStylesSet).map(function (s) { return '`' + s + '`'; }).join(', ') || '-'));
    lines.push('- **Associated Batches:** ' + (Array.from(allBatchesSet).map(function (b) { return '`' + b + '`'; }).join(', ') || '-'));
    lines.push('- **Total Materials in Scope:** **' + totalItemsCount + ' টি আইটেম** (সকল ইনডেন্ট মিলিয়ে)');
    lines.push('- **Cumulative Volumes:** **Total Order Qty:** `' + totalOrderQtyAll.toFixed(2).replace(/\.00$/, '') + '` | **Total GRN Qty:** `' + totalGrnQtyAll.toFixed(2).replace(/\.00$/, '') + '` | **Total Pending Qty:** `' + totalPendingQtyAll.toFixed(2).replace(/\.00$/, '') + '`');
    lines.push('');

    // Table 1: Multi-Indent Comparison Summary Matrix Table
    lines.push('#### ১. মাল্টি-ইনডেন্ট তুলনা ম্যাট্রিক্স টেবিল (Multi-Indent Comparison Summary Matrix):');
    lines.push('| # | Indent No | Associated Styles | Associated Batches | Total Items | PO Created & Received | Material Pending | PO Not Created | Status / Verdict |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    indentMatrixRows.forEach(function (r, idx) {
      lines.push('| ' + (idx + 1) + ' | `' + r.indentNo + '` | `' + (r.styles || '-') + '` | `' + (r.batches || '-') + '` | ' + r.itemCount + ' | ' + r.matReceivedCount + ' | ' + r.matPendingCount + ' | ' + r.poNotCreatedCount + ' | **' + r.verdictBadge + '** |');
    });
    lines.push('');

    // Embedded Excel Card for 1-click Download if batches available
    if (allBatchesAudits.length > 0) {
      var miCardKey = 'multiindent_card_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      var miExportFileName = 'Multi_Indent_Audit_' + foundAudits.length + '_Indents.xlsx';
      var miBatchListCsv = allBatchesAudits.map(function (b) { return b.batchNo; }).join(',');
      if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
      window._multiBatchExcelRegistry[miCardKey] = {
        batches: allBatchesAudits,
        fileName: miExportFileName,
        timestamp: Date.now()
      };
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('bai_card_' + miCardKey, JSON.stringify(window._multiBatchExcelRegistry[miCardKey]));
        }
      } catch (e) {}

      lines.push('<div class="bai-excel-export-card" data-card-key="' + miCardKey + '" data-indents="' + foundAudits.map(function (a) { return a.indentNo; }).join(',') + '" data-batches="' + miBatchListCsv + '" data-filename="' + miExportFileName + '" onclick="window.downloadMultiBatchExcel(\'' + miCardKey + '\', this)">' +
        '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
        '<div class="bai-excel-card-info">' +
          '<div class="bai-excel-card-title">' + miExportFileName + '</div>' +
          '<div class="bai-excel-card-sub">' + foundAudits.length + 'টি ইনডেন্টের আওতাধীন ' + allBatchesAudits.length + 'টি ব্যাচের কাঁচামাল অডিট স্প্রেডশিট • ৪টি শিট</div>' +
        '</div>' +
        '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
      '</div>');
      lines.push('');
    }

    // Section 2: Procurement Bottlenecks Across Indents
    lines.push('#### ২. প্রকিউরমেন্ট বটলনেক ও সাপ্লায়ার পিও বিশ্লেষণ (Procurement Bottlenecks across Indents):');
    if (sharedPoNotCreated.length > 0) {
      lines.push('নিচের উপাদানগুলোর বিপরীতে পারচেজ অর্ডার এখনো ইস্যু করা হয়নি (`PO Not Created` - বটলনেক):');
      lines.push('| # | Indent No | Batch No | Missing Material | Pro Code | Order Qty | Store Status | AI Status | Jyoti Remarks |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      sharedPoNotCreated.slice(0, 15).forEach(function (it, idx) {
        lines.push('| ' + (idx + 1) + ' | `' + it.indentNo + '` | `' + it.batch + '` | **' + it.itemName + '** | `' + it.itemCode + '` | ' + it.orderQty + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.jyotiRemarks || '-') + ' |');
      });
      if (sharedPoNotCreated.length > 15) {
        lines.push('*...এবং আরও ' + (sharedPoNotCreated.length - 15) + ' টি আইটেমের পিও বাকি রয়েছে।*');
      }
      lines.push('');
    } else {
      lines.push('পরীক্ষিত ইনডেন্টগুলোর সকল আইটেমের পারচেজ অর্ডার তৈরি হয়েছে। কোনো PO Not Created বটলনেক নেই।');
      lines.push('');
    }

    if (sharedPendingMaterials.length > 0) {
      lines.push('নিচের উপাদানগুলোর পারচেজ অর্ডার ইস্যু হলেও কারখানায় মালামাল পৌঁছানো বাকি রয়েছে (`Material Pending`):');
      lines.push('| # | Indent No | Batch No | Missing Material | Pro Code | Supplier PO | Pending Qty | Store Status | AI Status | Delivery ETA (Jyoti) |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|');
      sharedPendingMaterials.slice(0, 15).forEach(function (it, idx) {
        lines.push('| ' + (idx + 1) + ' | `' + it.indentNo + '` | `' + it.batch + '` | **' + it.itemName + '** | `' + it.itemCode + '` | ' + (it.supplierPo || '-') + ' | ' + it.pendingQty + ' | ' + it.storeStatus + ' | `' + it.aiStatus + '` | ' + (it.jyotiRemarks || 'Awaited') + ' |');
      });
      if (sharedPendingMaterials.length > 15) {
        lines.push('*...এবং আরও ' + (sharedPendingMaterials.length - 15) + ' টি আইটেম ডেলিভারি পেন্ডিং রয়েছে।*');
      }
      lines.push('');
    }

    // Section 3: Action Plan
    lines.push('#### ৩. ডিপার্টমেন্ট অনুযায়ী সমন্বিত অ্যাকশন প্ল্যান (Consolidated Action Plan):');
    lines.push('- **[ACTION - Jyoti (Purchase Department)]:** যেসকল উপাদান ও ইনডেন্টে `PO Not Created` রয়েছে, অবিলম্বে ভেন্ডরদের কাছে Supplier PO ইস্যু করুন এবং শিটে ডেলিভারি কনফার্মেশন ডেট আপডেট করুন।');
    lines.push('- **[ACTION - Sandip Chatterjee (Store Manager)]:** সাপ্লায়ার থেকে চালানসহ মালামাল কারখানায় পৌঁছানোর সাথে সাথে ফিজিক্যাল স্টক ভেরিফিকেশন ও GRN সম্পন্ন করে স্টোর স্ট্যাটাস OK আপডেট করুন।');
    lines.push('- **Production Floor:** যেসকল ব্যাচের ইনডেন্টে কাঁচামাল পেন্ডিং বা PO ইস্যু হয়নি, সেগুলোর কাটিং স্থগিত রাখুন।');

    return lines.join('\n');
  }

  function formatIndentNotFoundResponse(targetIndent) {
    var lines = [];
    lines.push('### [ইনডেন্ট অনুসন্ধান: ইনডেন্ট নম্বর পাওয়া যায়নি]');
    lines.push('');
    lines.push('আপনার প্রদত্ত ইনডেন্ট নম্বর **`' + targetIndent + '`** বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট বা ট্রায়ো-এআই ডেটাবেসে পাওয়া যায়নি।');
    lines.push('');
    lines.push('**পরামর্শ:**');
    lines.push('১. ইনডেন্ট নম্বরের ফরম্যাটটি যাচাই করুন (যেমন: `NL_0242_TT/26-27` বা `LE_0041_TT/26-27`)।');
    lines.push('২. যদি ইনডেন্টটি সম্প্রতি গুগল শিটে যুক্ত হয়ে থাকে, তবে উপরের **"Connector Live Sheet Records"** কার্ডের **"Sync Sheet"** বাটনে ক্লিক করে সর্বশেষ ডেটা রিফ্রেশ করে নিন।');
    return lines.join('\n');
  }

  function formatGenericIndentGuideResponse() {
    var lines = [];
    lines.push('### [ইনডেন্ট প্রকিউরমেন্ট অ্যানালাইসিস (Indent Analysis)]');
    lines.push('');
    lines.push('ইনডেন্টভিত্তিক বিশ্লেষণের মাধ্যমে আপনি যেকোনো ইনডেন্টের অধীনে থাকা সমস্ত কাঁচামালের প্রকিউরমেন্ট স্ট্যাটাস রিয়েল-টাইমে ট্র্যাক করতে পারবেন:');
    lines.push('- ইনডেন্টের বিপরীতে পারচেজ অর্ডার (`Supplier PO`) তৈরি হয়েছে কিনা (`PO Not Created` বটলনেক শনাক্তকরণ)।');
    lines.push('- অর্ডার পরিমাণ (`Order Qty`), জিআরএন প্রাপ্ত পরিমাণ (`GRN Qty`) এবং পেন্ডিং পরিমাণ (`Pending Qty`) অডিট।');
    lines.push('- পারচেজ টিম (Jyoti) এবং স্টোর ম্যানেজার (Sandip Chatterjee)-এর রিয়েল-টাইম রিমার্কস ও স্ট্যাটাস যাচাই।');
    lines.push('');
    lines.push('যেকোনো নির্দিষ্ট ইনডেন্ট যাচাই করতে অনুগ্রহ করে ইনডেন্ট নম্বরটি লিখুন (যেমন: `NL_0242_TT/26-27 ei indent er against e bolo` বা `Indent NL_0242_TT/26-27`)।');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Connector Live Sheet Records Deep Connection Engine
  // ---------------------------------------------------------------------------
  function getLiveConnectorContextForPrompt(userPrompt, historyArr) {
    if (!window.ConnectorSheetEngine || typeof window.ConnectorSheetEngine.isReady !== 'function') {
      return '';
    }
    if (!window.ConnectorSheetEngine.isReady()) {
      return '';
    }

    var promptLower = String(userPrompt || '').toLowerCase();

    // -------------------------------------------------------------------------
    // 0. ALL READY FOR PRODUCTION BATCHES (100% materials received and Store OK)
    // -------------------------------------------------------------------------
    var isReadyAllBatchesQuery =
      (promptLower.indexOf('ready for production') !== -1 || promptLower.indexOf('ready to start') !== -1 || (promptLower.indexOf('ready') !== -1 && promptLower.indexOf('production') !== -1) || promptLower.indexOf('100%') !== -1) &&
      (promptLower.indexOf('all') !== -1 || promptLower.indexOf('list') !== -1 || promptLower.indexOf('store ok') !== -1 || promptLower.indexOf('সব') !== -1 || promptLower.indexOf('সকল') !== -1 || promptLower.indexOf('তালিকা') !== -1 || promptLower.indexOf('গুলো') !== -1 || promptLower.indexOf('gulo') !== -1 || promptLower.indexOf('batch') !== -1);

    var targetBatches = extractBatchesFromPrompt(userPrompt);

    if (isReadyAllBatchesQuery && (!targetBatches || targetBatches.length === 0) && typeof window.ConnectorSheetEngine.getAllReadyForProductionBatches === 'function') {
      var allReadyBatches = window.ConnectorSheetEngine.getAllReadyForProductionBatches() || [];
      var outReady = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 0: All Ready for Production Batches Audit):\n' +
        'Query Target: All Batches Currently Ready for Production (100% Materials Received and Store OK Sandip Chatterjee)\n' +
        'Total Ready Batches Found in Factory Database: ' + allReadyBatches.length + ' Batches\n\n' +
        'COMPLETE AUDIT LIST OF ALL 100% READY BATCHES:\n';

      allReadyBatches.forEach(function (b, idx) {
        var itbVal = (b.itb && b.itb !== '-') ? b.itb : '-';
        var indVal = (b.indentNo && b.indentNo !== '-') ? b.indentNo : '-';
        var indDtVal = (b.indentDate && b.indentDate !== '-') ? b.indentDate : '-';
        var etdVal = (b.etd && b.etd !== '-') ? b.etd : '-';
        var brandVal = (b.brand && b.brand !== '-') ? b.brand : '-';
        outReady += '#' + (idx + 1) + ': Batch ' + b.batchNo + ' | Style: ' + b.styleNo + ' | ITB: ' + itbVal + ' | Indent No: ' + indVal + ' | Indent Date: ' + indDtVal + ' | ETD: ' + etdVal + ' | Brand: ' + brandVal + ' | Total Materials: ' + b.totalCount + ' | Ready: ' + b.readyCount + ' | Pending: 0 | Store Status: OK (Sandip Chatterjee) | Verdict: [READY TO START]\n';
      });

      outReady += '\nMANDATORY INSTRUCTION FOR OUTPUT:\n' +
        'Conduct a deep, rigorous, and professional factory operational data analysis:\n' +
        '1. Executive Summary & Verification Banner: Highlight total ready batches (' + allReadyBatches.length + '), styles covered, total verified materials, 0 pending materials, and Store Manager (Sandip Chatterjee) 100% clearance.\n' +
        '2. Complete Ready Batches Audit Table with columns: | # | Batch No | Style No | ITB | Indent No | Indent Date | ETD | Brand / Unit | Total Material | Ready Material | Pending Material | Store Status | Verdict |\n' +
        '   (Include all batches accurately. Format in clean Markdown table).\n' +
        '3. Style-Wise Batch Grouping & Sequencing Analysis: Group batches by Style No and highlight batch distribution, line load, and priority by ETD timeline.\n' +
        '4. Operational Directives & Action Plan: Clear immediate instructions for the Cutting & Production Floor and Store Department.\n' +
        '5. Note: State that the complete interactive 4-sheet Excel report has been prepared and can be downloaded from the card below.\n' +
        'STRICT RULES: Continuous language matching (if user prompt is English, reply in English; if Bengali, reply in Bengali). Strictly NO emojis! Clean markdown tables only.]\n';

      return outReady;
    }

    // -------------------------------------------------------------------------
    // 1. SPECIFIC BATCH NUMBER DETECTION & DEEP COMPONENT AUDIT (Single or Multi-Batch)
    // -------------------------------------------------------------------------

    if (targetBatches && targetBatches.length > 1) {
      var bAudits = [];
      var notFoundBatches = [];
      targetBatches.forEach(function (b) {
        var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
        if (r) {
          bAudits.push(r);
        } else {
          notFoundBatches.push(b);
        }
      });

      if (bAudits.length > 0) {
        var outMulti = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 1: Multi-Batch Production Audit):\n' +
          'Total Batches Queried: ' + targetBatches.length + ' (' + bAudits.length + ' found in factory database' + (notFoundBatches.length ? ', ' + notFoundBatches.length + ' not found: ' + notFoundBatches.join(', ') : '') + ')\n\n' +
          'MULTI-BATCH COMPARATIVE SUMMARY:\n';

        bAudits.forEach(function (b, idx) {
          var itbStr = (b.itb && b.itb !== '-') ? b.itb : '-';
          var indStr = (b.indentNo && b.indentNo !== '-') ? b.indentNo : '-';
          var indDtStr = (b.indentDate && b.indentDate !== '-') ? b.indentDate : '-';
          var bDatesStr = 'ERP Issue: ' + (b.erpIssueDate || '-') + ', Mat Issue: ' + (b.materialIssueDate || '-') + ', Handover: ' + (b.materialHandoverDate || '-') + ', 100% Rec: ' + (b.material100RecDate || '-');
          outMulti += '#' + (idx + 1) + ': Batch ' + b.batchNo + ' | Style: ' + b.styleNo + ' | ITB: ' + itbStr + ' | Indent No: ' + indStr + ' | Indent Date: ' + indDtStr + ' | Bantala: [' + bDatesStr + '] | Ready: ' + b.readyCount + '/' + b.totalCount + ' (' + b.readinessPct + '%) | Verdict: ' + b.verdict + '\n';
        });
        outMulti += '\n';

        if (bAudits.length > 2) {
          // Calculate shared bottlenecks across batches
          var sharedMapMulti = {};
          bAudits.forEach(function (b) {
            (b.pendingItems || []).forEach(function (it) {
              var k = (it.itemName || it.itemCode || 'Unknown').trim();
              if (!sharedMapMulti[k]) {
                sharedMapMulti[k] = { name: it.itemName, code: it.itemCode, batches: [], po: it.supplierPo, ai: it.aiStatus, store: it.storeStatus, eta: it.eta, remarks: it.remarksJyoti };
              }
              if (sharedMapMulti[k].batches.indexOf(b.batchNo) === -1) {
                sharedMapMulti[k].batches.push(b.batchNo);
              }
            });
          });
          var sharedKeysMulti = Object.keys(sharedMapMulti).filter(function (k) { return sharedMapMulti[k].batches.length > 1; });
          if (sharedKeysMulti.length > 0) {
            outMulti += '\nSHARED BOTTLENECK MATERIALS ACROSS BATCHES (Common missing raw materials):\n';
            sharedKeysMulti.slice(0, 15).forEach(function (k, idx) {
              var item = sharedMapMulti[k];
              var etaVal = item.eta ? item.eta : (item.remarks !== '-' ? item.remarks : 'Awaited');
              outMulti += '#' + (idx + 1) + ': ' + item.name + ' (' + item.code + ') | Missing in ' + item.batches.length + ' batches: ' + item.batches.join(', ') + ' | PO: ' + (item.po || '-') + ' | Store: ' + item.store + ' | AI: ' + item.ai + ' | ETA: ' + etaVal + '\n';
            });
          }

          outMulti += '\nCRITICAL USER MANDATE (> 2 BATCHES / HIGH VOLUME DATA):\n' +
            'The user specifically commanded: "dekho jokhon besi data hoye jache excel file baniye diye dao chat e, eto besi likhte jeo na. chat e sudhu summary ta likhbe, baki sob excel file e thakbe".\n' +
            'MANDATORY RULES FOR OUTPUT:\n' +
            '1. DO NOT write lengthy texts, detailed essays, or component-by-component lists in chat ("eto besi likhte jeo na").\n' +
            '2. In CHAT, output ONLY the concise Executive Summary ("chat e sudhu summary ta likhbe"):\n' +
            '   - Executive Verdict Summary (State which batches are READY, CONDITIONAL, or HOLD in 1-2 lines).\n' +
            '   - Table 1 (Summary Matrix): Clean Markdown table containing ALL ' + bAudits.length + ' queried batches with columns: | # | Batch No | Style No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict | (MANDATORY: DO NOT show Planned Qty or Prod Qty).\n' +
            '     CRITICAL NOTE FOR TABLE COLUMNS: Populate ITB, Indent No, and Indent Date EXACTLY as provided in the summary above for each batch! A batch has 1 ITB and may have 1 or 2 Indents (e.g. Non-leather and Leather indents with their respective dates). Always show the actual values, NEVER put "-" if values are given above!\n' +
            '   - Shared Bottlenecks across batches (if any).\n' +
            '   - Brief Action Plan for Store Manager Sandip Chatterjee and Purchase Department Jyoti (2-3 bullet points).\n' +
            '   - Explicit Excel Notice: State in 1 line that the complete item-by-item detailed audit report across 4 sheets (Summary, Pending, Ready, Bottlenecks) is attached in the Excel report below.\n' +
            '3. NEVER pick just one sample batch to represent the group! Every single queried batch MUST be listed in the Summary Matrix Table.\n' +
            'STRICT RULE: Strictly NO emojis! Clean markdown tables only. AI Status badges in English.]\n';

          return outMulti;
        }

        // 2 BATCHES: Provide full detailed breakdown in chat
        bAudits.forEach(function (b, idx) {
          outMulti += '=== BATCH #' + (idx + 1) + ': ' + b.batchNo + ' (Style: ' + b.styleNo + ' | ITB: ' + (b.itb || '-') + ' | Indent No: ' + (b.indentNo || '-') + ' | Indent Date: ' + (b.indentDate || '-') + ' | Readiness: ' + b.readinessPct + '% | Verdict: ' + b.verdict + ') ===\n';
          outMulti += 'Pending Materials (' + b.pendingItems.length + '):\n';
          if (b.pendingItems.length === 0) {
            outMulti += '  (None - 100% Ready)\n';
          } else {
            b.pendingItems.forEach(function (it, pIdx) {
              outMulti += '  [' + (pIdx + 1) + '] ' + it.itemName + ' | Code: ' + it.itemCode + ' | ITB: ' + (it.itb || b.itb || '-') + ' | Indent No: ' + (it.indentNo || b.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || b.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Pending Qty: ' + it.pendingQty + ' | ETA: ' + (it.eta || 'Awaited') + ' | Store: ' + it.storeStatus + ' | AI: ' + it.aiStatus + ' | Blocker: ' + (it.blockerReason || it.aiStatus) + '\n';
            });
          }
          outMulti += 'Ready Materials (' + b.readyItems.length + '):\n';
          b.readyItems.forEach(function (it, rIdx) {
            outMulti += '  [' + (rIdx + 1) + '] ' + it.itemName + ' | Code: ' + it.itemCode + ' | ITB: ' + (it.itb || b.itb || '-') + ' | Indent No: ' + (it.indentNo || b.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || b.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Store: ' + it.storeStatus + ' | AI: ' + it.aiStatus + '\n';
          });
          outMulti += '\n';
        });

        outMulti += 'CRITICAL MANDATORY INSTRUCTION FOR OUTPUT (1-2 BATCHES):\n' +
          'The user instructed: "chat e 1-2 ta batch er details debe".\n' +
          'Provide the Executive Multi-Batch Summary Matrix Table AND the detailed tables (Pending Materials first, then Ready Materials) for each of the 2 batches directly in chat.\n' +
          '1. Multi-Batch Summary Matrix Table: | # | Batch No | Style No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | AI Verdict |\n' +
          '2. Detailed Batch Breakdown for each batch:\n' +
          '   - Table 1: Pending / Blocker Materials Table (কী কী বাকি আছে & বটলনেক - সবচেয়ে গুরুত্বপূর্ণ) with columns: | # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Delivery ETA | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Reason |\n' +
          '   - Table 2: Ready Materials Table (যেসব উপাদান প্রস্তুত) with columns: | # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status |\n' +
          '3. Cross-Batch Shared Bottleneck Analysis\n' +
          '4. Departmental Action Plan\n' +
          'STRICT RULE: Absolutely NO emojis! Clean markdown tables only. AI Status badges in English.]\n';

        return outMulti;
      }
    }

    var targetBatch = (targetBatches && targetBatches.length > 0) ? targetBatches[0] : null;

    if (targetBatch) {
      var bReadiness = window.ConnectorSheetEngine.getBatchMaterialReadiness(targetBatch);
      if (bReadiness) {
        var out = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 1: Batch Production Start & Material Audit):\n' +
          'Query Target: Batch "' + bReadiness.batchNo + '" (Matched: ' + bReadiness.totalCount + ' component material rows in factory database)\n' +
          'Style No: ' + bReadiness.styleNo + ' | ITB: ' + (bReadiness.itb || '-') + ' | Indent No: ' + (bReadiness.indentNo || '-') + ' | Indent Date: ' + (bReadiness.indentDate || '-') + ' | Batch Qty: ' + bReadiness.batchQty + ' | Brand/Unit: ' + bReadiness.brand + '\n' +
          'Bantala Production Dates: ERP Issue: ' + (bReadiness.erpIssueDate || '-') + ' | Material Issue: ' + (bReadiness.materialIssueDate || '-') + ' | Handover to Fabricator: ' + (bReadiness.materialHandoverDate || '-') + ' | 100% Material Received: ' + (bReadiness.material100RecDate || '-') + '\n' +
          'OVERALL PRODUCTION VERDICT: ' + bReadiness.verdictText + '\n' +
          'READINESS SCORE: ' + bReadiness.readyCount + ' of ' + bReadiness.totalCount + ' Materials Ready (' + bReadiness.readinessPct + '% Ready)\n\n' +
          'PENDING / BLOCKER MATERIALS (' + bReadiness.pendingItems.length + ' Items - Material Pending / Blocker / PO Awaited):\n';
        if (bReadiness.pendingItems.length === 0) {
          out += '(None! All raw materials are 100% ready for production)\n';
        } else {
          bReadiness.pendingItems.forEach(function (it, idx) {
            out += '#' + (idx + 1) + ': ' + it.itemName + ' | Pro Code: ' + it.itemCode + ' | ITB: ' + (it.itb || bReadiness.itb || '-') + ' | Indent No: ' + (it.indentNo || bReadiness.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || bReadiness.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Pending Qty: ' + it.pendingQty + ' | Jyoti Remarks: ' + it.remarksJyoti + ' | ETA: ' + (it.eta || 'Awaited') + ' | Store Status: ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + ' | Blocker: ' + (it.blockerReason || it.aiStatus) + '\n';
          });
        }

        out += '\nREADY MATERIALS (' + bReadiness.readyItems.length + ' Items - Ready for Production / In Stock):\n';
        bReadiness.readyItems.forEach(function (it, idx) {
          out += '#' + (idx + 1) + ': ' + it.itemName + ' | Pro Code: ' + it.itemCode + ' | ITB: ' + (it.itb || bReadiness.itb || '-') + ' | Indent No: ' + (it.indentNo || bReadiness.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || bReadiness.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Status: ' + it.status + ' | Store Status (Sandip Chatterjee): ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + ' | Planned/Order: ' + (it.orderQty !== '-' ? it.orderQty : it.status) + '\n';
        });

        out += '\nMANDATORY INSTRUCTION FOR OUTPUT:\n' +
          'Format your entire response neatly organized ("সবকিছু গুছিয়ে") in fluent, professional Bengali (বাংলা) or active language:\n' +
          '1. Executive Verdict Banner: ' + bReadiness.verdictText + '\n' +
          '2. KPI Cards: Total Components (' + bReadiness.totalCount + '), Ready (' + bReadiness.readyCount + '), Pending (' + bReadiness.pendingCount + '), Readiness Score (' + bReadiness.readinessPct + '%)\n' +
          '3. Table 1: Pending / Bottleneck Materials (কী কী Ready নেই & বটলনেক - সবচেয়ে গুরুত্বপূর্ণ) with columns: | # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Delivery ETA | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Reason | (MANDATORY: You MUST list EVERY SINGLE missing/pending material without omitting or truncating any rows!).\n' +
          '4. Table 2: Ready Materials (যেসব ম্যাটেরিয়াল প্রডাকশনের জন্য প্রস্তুত) with columns: | # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status | (MANDATORY: List all ready materials cleanly without truncation).\n' +
          '5. Action Plan for Store (Sandip Chatterjee) and Purchase (Jyoti).\n' +
          'CRITICAL RULE: COMPLETE THE ENTIRE RESPONSE TO THE VERY END. DO NOT CUT OFF MID-SENTENCE OR MID-TABLE. STRICT RULE: Absolutely NO emojis! AI Status badges in English.]\n';

        return out;
      } else {
        var searchRows = window.ConnectorSheetEngine.search(targetBatch, 5);
        var outNotFound = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA:\n' +
          'Queried Batch: "' + targetBatch + '" was not found in the factory database.\n';
        if (searchRows && searchRows.length > 0) {
          outNotFound += 'Closest matching records in database:\n';
          searchRows.forEach(function (r, idx) {
            outNotFound += '#' + (idx + 1) + ': Batch ' + r[0] + ' | Style: ' + r[6] + ' | Item: ' + r[4] + ' | Store Status: ' + r[11] + ' | AI Status: ' + r[23] + '\n';
          });
        }
        outNotFound += 'CRITICAL DIRECTIVE: STRICTLY FORBIDDEN TO INVENT, FABRICATE, OR HALLUCINATE ANY FAKE ROWS, DUMMY ITEMS, OR PLACEHOLDERS (such as "নির্দিষ্ট আইটেম ও প্রো কোড", "পরিকল্পিত পরিমাণ", "স্টাইল ও কালার বিবরণ").\n' +
          'Politely and clearly explain in Bengali that Batch "' + targetBatch + '" was not located in the current database. If close matches exist above, mention only those genuine records. Advise the user to verify the batch spelling or click "Sync Sheet" in Connector Live Sheet Records to sync the latest Google Sheets rows.]\n';
        return outNotFound;
      }
    }

    // -------------------------------------------------------------------------
    // 2. STYLE-BASED QUERY ("Style er against e")
    // Evaluated BEFORE general questions so queries like "PU1392W145R style er production start"
    // will always accurately query the style database!
    // -------------------------------------------------------------------------
    var targetStyles = extractStylesFromPrompt(userPrompt, historyArr);
    var isStyleQuery = promptLower.indexOf('style') !== -1 || promptLower.indexOf('স্টাইল') !== -1 || (targetStyles && targetStyles.length > 0);

    if (isStyleQuery) {
      if (!targetStyles || !targetStyles.length) {
        targetStyles = extractStylesFromPrompt(userPrompt, historyArr);
      }

      if (targetStyles && targetStyles.length > 1) {
        var allBatchesMulti = [];
        var notFoundMulti = [];
        targetStyles.forEach(function (st) {
          var bList = window.ConnectorSheetEngine.findBatchesByStyle(st, 50) || [];
          if (bList.length === 0) {
            notFoundMulti.push(st);
          } else {
            bList.forEach(function (b) {
              if (!b.styleNo || b.styleNo === '-') b.styleNo = st;
              allBatchesMulti.push(b);
            });
          }
        });

        var outMultiStyle = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 2: Multi-Style Production Audit):\n' +
          'Queried Styles: ' + targetStyles.map(function (s) { return '"' + s.toUpperCase() + '"'; }).join(', ') + ' (' + allBatchesMulti.length + ' total active batch(es) across styles' + (notFoundMulti.length ? ', Not found: ' + notFoundMulti.join(', ') : '') + ')\n';

        if (allBatchesMulti.length > 0) {
          outMultiStyle += '\nCRITICAL ZERO-HALLUCINATION DIRECTIVE:\n' +
            'You must strictly and exclusively output the genuine ' + allBatchesMulti.length + ' batch(es) listed below with their EXACT metrics.\n' +
            'STRICTLY FORBIDDEN to invent, fabricate, or guess fake batch numbers (such as PU-0421/26-27), fake ITB, fake indents, or fake dates.\n';

          outMultiStyle += '\nSUMMARY BATCH MATRIX ACROSS STYLES:\n';
          allBatchesMulti.forEach(function (b, idx) {
            outMultiStyle += '#' + (idx + 1) + ': Style ' + b.styleNo + ' | Batch ' + b.batchNo + ' | ITB: ' + (b.itb || '-') + ' | Indent No: ' + (b.indentNo || '-') + ' | Indent Date: ' + (b.indentDate || '-') + ' | Ready: ' + b.readyCount + '/' + b.totalCount + ' (' + b.readinessPct + '%) | Verdict: ' + b.verdictText + '\n';
          });

          outMultiStyle += '\nMANDATORY INSTRUCTION FOR OUTPUT:\n' +
            (allBatchesMulti.length > 2
              ? 'CRITICAL USER MANDATE (> 2 BATCHES RULE): Total combined batches across the queried styles is ' + allBatchesMulti.length + ' (> 2). The user explicitly instructed: "chat e 1-2 ta batch er details debe....2 er besi batch dile chat e na diye excel file debe, sekhane details e report hisebe baniye debe". DO NOT dump long exhaustive material breakdown tables for all batches into chat ("chat e na diye excel file debe"). Instead, provide a clean Executive Multi-Style Summary Matrix Table with columns: | # | Style No | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict |, summarize Shared Bottlenecks, Action Plan, and clearly state that the complete item-by-item 4-sheet Excel report has been prepared for download.\n'
              : 'The user queried ' + allBatchesMulti.length + ' batch(es) across styles (<= 2). Provide an Executive Multi-Style Summary Matrix with columns: | # | Style No | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict | followed by the detailed breakdown (Pending Materials first, then Ready Materials) for each batch directly in chat.\n') +
            'STRICT MANDATE: DO NOT show Planned Qty or Prod Qty anywhere in tables or text. STRICTLY NO emojis! AI Status badges in English.]\n';

          return outMultiStyle;
        } else {
          outMultiStyle += 'No batches found for styles: ' + targetStyles.join(', ') + ' in database.\n' +
            'CRITICAL DIRECTIVE: DO NOT INVENT OR HALLUCINATE ANY FAKE BATCHES OR PLACEHOLDERS.\n' +
            'Politely inform the user in Bengali that none of the queried styles have active batches in the factory records.]\n';
          return outMultiStyle;
        }
      }

      var targetStyle = (targetStyles && targetStyles.length === 1) ? targetStyles[0] : null;

      if (targetStyle) {
        var styleBatches = window.ConnectorSheetEngine.findBatchesByStyle(targetStyle, 50);
        var outStyle = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 2: Style-Based Audit & Detailed Component Breakdown):\n' +
          'Query Target Style: "' + targetStyle.toUpperCase() + '" (' + (styleBatches ? styleBatches.length : 0) + ' batch(es) found in database)\n';

        if (styleBatches && styleBatches.length > 0) {
          outStyle += '\nCRITICAL ZERO-HALLUCINATION DIRECTIVE FOR AI:\n' +
            'You must strictly and exclusively output the genuine ' + styleBatches.length + ' active batch(es) listed below with their EXACT metrics.\n' +
            'STRICTLY FORBIDDEN to invent, fabricate, or guess fake batch numbers (such as PU-0421/26-27), fake ITB, fake indents, or fake dates.\n';

          outStyle += '\nPART 1: SUMMARY BATCH MATRIX UNDER STYLE ' + targetStyle.toUpperCase() + ':\n';
          styleBatches.forEach(function (b, idx) {
            outStyle += '#' + (idx + 1) + ': Batch ' + b.batchNo + ' | ITB: ' + (b.itb || '-') + ' | Indent No: ' + (b.indentNo || '-') + ' | Indent Date: ' + (b.indentDate || '-') + ' | Ready: ' + b.readyCount + '/' + b.totalCount + ' (' + b.readinessPct + '%) | Verdict: ' + b.verdictText + '\n';
          });

          if (styleBatches.length > 2) {
            // Find shared bottlenecks across style batches
            var sharedMapStyle = {};
            styleBatches.forEach(function (b) {
              (b.pendingItems || []).forEach(function (it) {
                var k = (it.itemName || it.itemCode || 'Unknown').trim();
                if (!sharedMapStyle[k]) {
                  sharedMapStyle[k] = { name: it.itemName, code: it.itemCode, batches: [], po: it.supplierPo, ai: it.aiStatus, store: it.storeStatus, eta: it.eta, remarks: it.remarksJyoti };
                }
                if (sharedMapStyle[k].batches.indexOf(b.batchNo) === -1) {
                  sharedMapStyle[k].batches.push(b.batchNo);
                }
              });
            });
            var sharedKeys = Object.keys(sharedMapStyle).filter(function (k) { return sharedMapStyle[k].batches.length > 1; });
            if (sharedKeys.length > 0) {
              outStyle += '\nSHARED BOTTLENECK MATERIALS ACROSS BATCHES (Common missing raw materials):\n';
              sharedKeys.slice(0, 15).forEach(function (k, idx) {
                var item = sharedMapStyle[k];
                var etaVal = item.eta ? item.eta : (item.remarks !== '-' ? item.remarks : 'Awaited');
                outStyle += '#' + (idx + 1) + ': ' + item.name + ' (' + item.code + ') | Missing in ' + item.batches.length + ' batches: ' + item.batches.join(', ') + ' | PO: ' + (item.po || '-') + ' | Store: ' + item.store + ' | AI: ' + item.ai + ' | ETA: ' + etaVal + '\n';
              });
            }

            outStyle += '\nMANDATORY INSTRUCTION FOR OUTPUT (> 2 BATCHES):\n' +
              'The user explicitly instructed: "chat e 1-2 ta batch er details debe....2 er besi batch dile chat e na diye excel file debe, sekhane details e report hisebe baniye debe".\n' +
              'Style ' + targetStyle.toUpperCase() + ' has ' + styleBatches.length + ' batches (> 2). DO NOT dump long exhaustive material breakdown tables for all batches into chat ("chat e না diye excel file debe").\n' +
              'Format your response neatly organized in fluent Bengali (বাংলা) or active language:\n' +
              '1. Style Executive Header: Style Number, Total Active Batches, and readiness summary.\n' +
              '2. Table 1: Style Batch Readiness Matrix table with columns: | # | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict | (MANDATORY: DO NOT show Planned Qty or Prod Qty).\n' +
              '3. Style-wide Bottleneck Analysis: Highlight common raw material shortages across the batches (e.g. leather, lining, zipper).\n' +
              '4. Department Action Plan for Production floor, Store Manager (Sandip Chatterjee), and Purchase Department (Jyoti).\n' +
              '5. Explicit Excel Notice: Clearly inform the user that because Style ' + targetStyle.toUpperCase() + ' has ' + styleBatches.length + ' batches (> 2), the complete item-by-item detailed audit report across 4 sheets (Summary, Pending, Ready, Bottlenecks) has been compiled into the interactive Excel file attached below (click card to download).\n' +
              'STRICT RULE: Strictly NO emojis! Clean markdown tables only. AI Status badges in English. MANDATORY: Zero Planned Qty, Zero Prod Qty.]\n';

            return outStyle;
          }

          // 1-2 BATCHES UNDER STYLE: Provide full in-depth component breakdown in chat
          outStyle += '\nPART 2: IN-DEPTH COMPONENT BREAKDOWN FOR EACH BATCH (কী কী বাকি আছে এবং কী কী রেডি আছে):\n';
          styleBatches.forEach(function (b, bIdx) {
            outStyle += '\n--- BATCH #' + (bIdx + 1) + ': ' + b.batchNo + ' (Style: ' + (b.styleNo || targetStyle) + ' | ITB: ' + (b.itb || '-') + ' | Indent: ' + (b.indentNo || '-') + ' (' + (b.indentDate || '-') + ') | Batch Qty: ' + b.batchQty + ', Verdict: ' + b.verdictText + ', Score: ' + b.readinessPct + '%) ---\n';
            outStyle += 'PENDING / BLOCKER MATERIALS (' + b.pendingItems.length + ' Items - কী কী বাকি আছে):\n';
            if (b.pendingItems.length === 0) {
              outStyle += '  (All components ready! No blockers)\n';
            } else {
              b.pendingItems.forEach(function (it, pIdx) {
                outStyle += '  #' + (pIdx + 1) + ': ' + it.itemName + ' | Code: ' + it.itemCode + ' | ITB: ' + (it.itb || b.itb || '-') + ' | Indent No: ' + (it.indentNo || b.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || b.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Pending Qty: ' + it.pendingQty + ' | Store: ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + ' | Blocker: ' + (it.blockerReason || it.aiStatus) + ' | ETA: ' + (it.eta || 'Awaited') + '\n';
              });
            }
            outStyle += 'READY MATERIALS (' + b.readyItems.length + ' Items - যেসব ম্যাটেরিয়াল প্রস্তুত):\n';
            if (b.readyItems.length === 0) {
              outStyle += '  (None ready for production yet)\n';
            } else {
              b.readyItems.forEach(function (it, iIdx) {
                outStyle += '  #' + (iIdx + 1) + ': ' + it.itemName + ' | Code: ' + it.itemCode + ' | ITB: ' + (it.itb || b.itb || '-') + ' | Indent No: ' + (it.indentNo || b.indentNo || '-') + ' | Indent Date: ' + (it.indentDate || b.indentDate || '-') + ' | Supplier PO: ' + it.supplierPo + ' | Status: ' + it.status + ' | Store: ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + '\n';
              });
            }
          });

          outStyle += '\nMANDATORY INSTRUCTION FOR OUTPUT (1-2 BATCHES):\n' +
            'The user queried ' + styleBatches.length + ' batch(es) under Style ' + targetStyle.toUpperCase() + ' (<= 2). The user instructed: "chat e 1-2 ta batch er details debe".\n' +
            'Provide both the summary matrix AND the full in-depth details of what materials are pending ("কী কী বাকি আছে") and ready ("কী কী রেডি আছে") for each batch in chat:\n' +
            '1. Style Executive Header: Style Number, Total Active Batches.\n' +
            '2. Table 1: Style Batch Readiness Matrix table with columns: | # | Batch No | ITB | Indent No | Indent Date | Total Materials | Ready Materials | Pending Materials | Readiness % | Production Verdict | (MANDATORY: DO NOT show Planned Qty or Prod Qty).\n' +
            '3. Detailed Component Breakdown for each batch:\n' +
            '   - A clear batch header: "### ব্যাচ: [Batch No] - [Verdict]"\n' +
            '   - Table A: Pending / Blocker Materials (কী কী বাকি আছে & বটলনেক - সবচেয়ে গুরুত্বপূর্ণ) with columns: | # | Missing Material | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Bottleneck / Reason |\n' +
            '   - Table B: Ready Materials (যেসব ম্যাটেরিয়াল প্রস্তুত) with columns: | # | Material / Item Name | Pro Code | ITB | Indent No | Indent Date | Supplier PO | Qty / Status | Store Status (Sandip Chatterjee) | AI Status |\n' +
            '4. Style-wide Bottleneck Analysis: Highlight common raw material shortages.\n' +
            '5. Action Plan for Store Manager Sandip Chatterjee and Purchase Department (Jyoti).\n' +
            'STRICT RULE: Strictly NO emojis! Clean markdown tables only. AI Status badges in English. MANDATORY: Zero Planned Qty, Zero Prod Qty.]\n';

          return outStyle;
        } else {
          outStyle += 'No batches found for Style "' + targetStyle + '" in database.\n' +
            'CRITICAL DIRECTIVE: DO NOT INVENT OR HALLUCINATE ANY FAKE BATCHES OR PLACEHOLDERS.\n' +
            'Politely inform the user in Bengali that Style "' + targetStyle + '" currently has no active batches in the factory records. Suggest checking the style number spelling or clicking "Sync Sheet" in Connector Live Sheet Records.]\n';
          return outStyle;
        }
      } else {
        var outStyleGen = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 2 Framework: Style-Based Query):\n' +
          'User asked for Style-based analysis ("Style er against e").\n' +
          'Total records in database: ' + window.ConnectorSheetEngine.getRowCount().toLocaleString() + '\n' +
          'INSTRUCTION: Explain in Bengali how Style-based queries work (showing both the short summary matrix of all batches under that style AND the detailed breakdown of what is ready vs pending for each batch).\n' +
          'CRITICAL RULE: STRICTLY FORBIDDEN to output dummy or placeholder batches like B-2026-01 or B-2026-02. Do NOT invent sample tables with fake batches.\n' +
          'Politely ask the user to provide their specific Style Number(s) (e.g. "Style T22896, 3360, BY7044W13").]\n';
        return outStyleGen;
      }
    }

    // -------------------------------------------------------------------------
    // 3. INDENT NO-BASED QUERY ("Indent no. er against e" - Single or Multiple Indents)
    // -------------------------------------------------------------------------
    var targetIndents = extractIndentsFromPrompt(userPrompt, historyArr);
    var isIndentQuery = promptLower.indexOf('indent') !== -1 || (targetIndents && targetIndents.length > 0);
    if (isIndentQuery) {
      // 3A. MULTIPLE INDENTS QUERIED
      if (targetIndents && targetIndents.length > 1) {
        var iAudits = [];
        var notFoundIndents = [];
        targetIndents.forEach(function (ind) {
          var aud = window.ConnectorSheetEngine.getIndentAudit(ind);
          if (aud) iAudits.push(aud);
          else notFoundIndents.push(ind);
        });

        if (iAudits.length > 0) {
          var outMultiIndent = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 3: Multi-Indent Procurement Audit):\n' +
            'Query Target Indents (' + targetIndents.length + ' indents): ' + targetIndents.join(', ') + '\n' +
            'Matched Indents in database: ' + iAudits.length + (notFoundIndents.length > 0 ? ' (Not Found: ' + notFoundIndents.join(', ') + ')' : '') + '\n\n';

          iAudits.forEach(function (ia, idx) {
            outMultiIndent += '=== INDENT #' + (idx + 1) + ': ' + ia.indentNo + ' (Styles: ' + ia.styleNo + ' | Batches: ' + ia.batches + ' | Total Items: ' + ia.itemCount + ' | Order: ' + ia.totalOrderQty + ' | GRN: ' + ia.totalGrnQty + ' | Pending: ' + ia.totalPendingQty + ') ===\n';
            outMultiIndent += 'Supplier PO(s): ' + ia.supplierPo + '\n';
            outMultiIndent += 'Items Breakdown:\n';
            ia.items.slice(0, 30).forEach(function (it, itIdx) {
              outMultiIndent += '  #' + (itIdx + 1) + ': Batch ' + it.batch + ' | ' + it.itemName + ' (' + it.itemCode + ') | PO: ' + it.supplierPo + ' | Order: ' + it.orderQty + ' | GRN: ' + it.grnQty + ' | Pending: ' + it.pendingQty + ' | Store: ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + ' | Jyoti: ' + it.jyotiRemarks + '\n';
            });
            if (ia.items.length > 30) {
              outMultiIndent += '  ... (' + (ia.items.length - 30) + ' more items in database)\n';
            }
            outMultiIndent += '\n';
          });

          outMultiIndent += 'CRITICAL MANDATORY INSTRUCTION FOR OUTPUT (MULTI-INDENT AUDIT):\n' +
            'The user provided multiple Indent numbers (' + targetIndents.join(', ') + ').\n' +
            'Provide a well-structured, comparative Procurement Audit in fluent, professional Bengali (বাংলা):\n' +
            '1. Multi-Indent Executive Overview: List all analyzed indents, associated styles, associated batches, and total order vs pending volumes.\n' +
            '2. Multi-Indent Comparison Summary Matrix Table with columns:\n' +
            '   | # | Indent No | Associated Styles | Associated Batches | Total Items | PO Created & Received | Material Pending | PO Not Created | Status / Verdict |\n' +
            '   (MANDATORY: Every single queried indent MUST have its own row in the matrix table).\n' +
            '3. Procurement Bottleneck & PO Analysis across the indents:\n' +
            '   - Highlight if any indents are stalled because "PO Not Create" (Supplier PO not issued by Purchase department).\n' +
            '   - Highlight pending delivery items and vendor commitments from Jyoti Remarks.\n' +
            '4. Departmental Action Plan:\n' +
            '   - Action for Jyoti (Purchase Department) to issue missing Supplier POs and follow up on pending deliveries.\n' +
            '   - Action for Sandip Chatterjee (Store Manager) to perform GRN and update physical stock.\n' +
            '5. Mention that detailed material audits are also compiled in the multi-sheet Excel report.\n' +
            'CRITICAL DIRECTIVE: STRICT ZERO HALLUCINATION. Do not invent any fake indents, batches, or PO numbers. Only use genuine records provided above.\n' +
            'STRICT RULE: Absolutely NO emojis! AI Status badges in English.]\n';

          return outMultiIndent;
        } else {
          var outMultiIndNF = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 3: Indents Not Found):\n' +
            'Target Indents: "' + targetIndents.join(', ') + '" were not found in factory records.\n' +
            'INSTRUCTION: Politely explain in Bengali that none of the provided indents were located in active factory records. Suggest checking the indent spelling/format or clicking "Sync Sheet". Strictly NO emojis!]\n';
          return outMultiIndNF;
        }
      }
      // 3B. SINGLE INDENT QUERIED
      else if (targetIndents && targetIndents.length === 1) {
        var targetIndent = targetIndents[0];
        var indentAudit = window.ConnectorSheetEngine.getIndentAudit(targetIndent);
        if (indentAudit) {
          var outIndent = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 3: Indent-Based Procurement Audit):\n' +
            'Target Indent: "' + indentAudit.indentNo + '"\n' +
            'Associated Batches: ' + indentAudit.batches + '\n' +
            'Associated Styles: ' + indentAudit.styleNo + '\n' +
            'Supplier PO(s): ' + indentAudit.supplierPo + '\n' +
            'Total Materials in Indent: ' + indentAudit.itemCount + '\n' +
            'Total Order Qty: ' + indentAudit.totalOrderQty + ' | Total GRN Qty: ' + indentAudit.totalGrnQty + ' | Total Pending Qty: ' + indentAudit.totalPendingQty + '\n\n' +
            'Indent Component Records:\n';

          indentAudit.items.forEach(function (it, idx) {
            outIndent += '#' + (idx + 1) + ': Batch ' + it.batch + ' | Style: ' + it.style + ' | ' + it.itemName + ' (' + it.itemCode + ') | PO: ' + it.supplierPo + ' | Order: ' + it.orderQty + ' | GRN: ' + it.grnQty + ' | Pending: ' + it.pendingQty + ' | Store: ' + it.storeStatus + ' | AI Status: ' + it.aiStatus + ' | Jyoti: ' + it.jyotiRemarks + '\n';
          });

          outIndent += '\nINSTRUCTION: Formulate a comprehensive Indent Procurement Report in Bengali:\n' +
            '1. Indent & PO Overview: Indent No, Associated Batches, Associated Styles, Supplier PO status.\n' +
            '2. Indent Procurement Audit Table with columns: | # | Batch No | Style No | Item Name | Pro Code | Supplier PO | Order Qty | GRN Qty | Pending Qty | Store Status (Sandip Chatterjee) | AI Status | Jyoti Remarks |\n' +
            '3. Procurement Bottleneck Analysis: If Supplier PO is "PO Not Create" across items, emphasize that the Indent was raised but the Purchase Department has not issued the Supplier PO yet.\n' +
            '4. Action Plan for Jyoti (Purchase Department) and Sandip Chatterjee (Store Manager).\n' +
            'STRICT RULE: Strictly NO emojis! AI Status in English.]\n';
          return outIndent;
        } else {
          var outIndentNotFound = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 3: Indent Not Found):\n' +
            'Target Indent: "' + targetIndent + '" was not found in active records.\n' +
            'INSTRUCTION: Politely explain in Bengali that Indent "' + targetIndent + '" was not located in factory records. Suggest checking the indent number spelling (e.g. NL_0242_TT/26-27) or clicking "Sync Sheet". Strictly NO emojis!]\n';
          return outIndentNotFound;
        }
      } else {
        var outIndentGen = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 3 Framework: Indent-Based Query):\n' +
          'User asked for Indent-based analysis ("Indent no. er against e").\n' +
          'Total records in database: ' + window.ConnectorSheetEngine.getRowCount().toLocaleString() + '\n' +
          'INSTRUCTION: Explain in Bengali how Indent-based queries audit the procurement flow (verifying whether Supplier PO has been generated, comparing Ordered Qty vs GRN Received Qty vs Pending Qty, and tracking delivery ETAs from Jyoti Remarks).\n' +
          'CRITICAL RULE: STRICTLY FORBIDDEN to output dummy or placeholder tables with fake data. Invite the user to provide an Indent Number (e.g. "NL_0242_TT/26-27") for live audit.]\n';
        return outIndentGen;
      }
    }

    // -------------------------------------------------------------------------
    // 4. GENERAL BATCH PRODUCTION START INQUIRY (No specific batch number, style, or indent given)
    // -------------------------------------------------------------------------
    var isGenBatchStart = (promptLower.indexOf('production start') !== -1 || promptLower.indexOf('start korbo') !== -1 ||
                           (promptLower.indexOf('material ready') !== -1 && promptLower.indexOf('ready nei') !== -1) ||
                           promptLower.indexOf('ki ki ready') !== -1 || promptLower.indexOf('kon kon material') !== -1) &&
                          !targetBatch && (!targetStyles || targetStyles.length === 0) && !targetIndent && !isStyleQuery && !isIndentQuery;

    if (isGenBatchStart) {
      var sampleBatch = 'TT-0867/26-27';
      var sampleReadiness = window.ConnectorSheetEngine.getBatchMaterialReadiness(sampleBatch);
      if (!sampleReadiness) {
        var allR = window.ConnectorSheetEngine.getAllRows();
        if (allR && allR.length > 0) {
          sampleBatch = allR[0][0];
          sampleReadiness = window.ConnectorSheetEngine.getBatchMaterialReadiness(sampleBatch);
        }
      }

      var outGen = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Mode 1 Framework: Production Readiness Audit):\n' +
        'User is asking how to analyze batch production start readiness and determine which materials are ready vs pending.\n' +
        'Database status: ' + window.ConnectorSheetEngine.getRowCount().toLocaleString() + ' records active in memory.\n';

      if (sampleReadiness) {
        outGen += 'Demonstration Sample Batch: "' + sampleReadiness.batchNo + '" (Style: ' + sampleReadiness.styleNo + '):\n' +
          '- Verdict: ' + sampleReadiness.verdictText + '\n' +
          '- Ready Items: ' + sampleReadiness.readyCount + ' / ' + sampleReadiness.totalCount + ' (' + sampleReadiness.readinessPct + '%)\n' +
          '- Pending Items: ' + sampleReadiness.pendingCount + '\n';
      }

      outGen += 'INSTRUCTION: Provide a comprehensive, structured response in Bengali explaining the Batch Production Start Material Audit process:\n' +
        '1. How the AI cross-references all Bill of Materials (BOM) components.\n' +
        '2. How Store Status Sandip Chatterjee (OK vs NOT OK) and AI Status determine the Production Start Verdict.\n' +
        '3. If a genuine Demonstration Sample Batch is provided above, you may reference its real metrics. CRITICAL RULE: STRICTLY FORBIDDEN to invent fake batches like B-2026-01 or B-2026-02.\n' +
        '4. Ask the user to provide their specific batch number (e.g. "TT-0867/26-27") for instant live analysis.\n' +
        'STRICT RULE: Absolutely NO emojis! AI Status badges in English.]\n';

      return outGen;
    }

    // -------------------------------------------------------------------------
    // 5. STATUS CATEGORY QUERIES
    // -------------------------------------------------------------------------
    var isReadyQuery = promptLower.indexOf('ready for production') !== -1 || promptLower.indexOf('ready batch') !== -1 || (promptLower.indexOf('ready') !== -1 && promptLower.indexOf('production') !== -1);
    var isPendingQuery = promptLower.indexOf('material pending') !== -1 || promptLower.indexOf('pending material') !== -1 || (promptLower.indexOf('pending') !== -1 && promptLower.indexOf('batch') !== -1);
    var isCannotStartQuery = promptLower.indexOf('cannot start') !== -1 || promptLower.indexOf('not ok') !== -1 || promptLower.indexOf('production korte parbe na') !== -1;
    var isStockQuery = promptLower.indexOf('in stock') !== -1 || promptLower.indexOf('in-stock') !== -1 || promptLower.indexOf('stock e ache') !== -1;
    var isOrderedStockQuery = promptLower.indexOf('ordered despite in stock') !== -1 || promptLower.indexOf('stock e thaka sotteo') !== -1;

    if (isReadyQuery || isPendingQuery || isCannotStartQuery || isStockQuery || isOrderedStockQuery) {
      var statusFilter = isReadyQuery ? 'Ready for Production' :
                         isCannotStartQuery ? 'Cannot Start Production' :
                         isPendingQuery ? 'Material Pending' :
                         isOrderedStockQuery ? 'Ordered despite In Stock' : 'In Stock';
      var sampleRows = window.ConnectorSheetEngine.findRowsByAiStatus(statusFilter, 12);
      var stats = window.ConnectorSheetEngine.getSummaryMetrics();
      var out2 = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Status Query: ' + statusFilter + '):';
      if (stats) {
        out2 += '\nTotal database records: ' + stats.total.toLocaleString();
        out2 += '\nOverall Status Breakdown:';
        out2 += '\n- Ready for Production: ' + stats.readyForProduction.toLocaleString();
        out2 += '\n- Cannot Start Production: ' + stats.cannotStartProduction.toLocaleString();
        out2 += '\n- Material Pending: ' + stats.materialPending.toLocaleString();
        out2 += '\n- Material Received: ' + stats.materialReceived.toLocaleString();
        out2 += '\n- In Stock: ' + stats.inStock.toLocaleString();
        out2 += '\n- Ordered despite In Stock: ' + stats.orderedDespiteStock.toLocaleString();
        out2 += '\n- PO Not Created: ' + stats.poNotCreated.toLocaleString();
        out2 += '\n- PO Awaited: ' + stats.poAwaited.toLocaleString();
        out2 += '\n- No update from Store: ' + stats.noUpdate.toLocaleString();
      }
      out2 += '\nSample ' + sampleRows.length + ' live records matching "' + statusFilter + '":';
      sampleRows.forEach(function (r, idx) {
        out2 += '\n#' + (idx + 1) + ': Batch ' + r[0] + ' | Style: ' + r[6] + ' | Item: ' + r[4] + ' | SupplierPO: ' + r[9] + ' | StoreStatus: ' + r[11] + ' | AI Status: ' + r[23] + ' | Remarks: ' + (r[16] || r[12]);
      });
      out2 += '\nINSTRUCTION: Formulate an executive operational report in Bengali with live metric breakdown, a neat Markdown table of batches, and actionable advice for factory floor operations. STRICT RULE: Absolutely NO emojis!]\n';
      return out2;
    }

    // -------------------------------------------------------------------------
    // 6. GENERAL CONNECTOR SHEET OVERVIEW
    // -------------------------------------------------------------------------
    var isConnectorQuery = promptLower.indexOf('connector') !== -1 || promptLower.indexOf('live sheet') !== -1 ||
                           promptLower.indexOf('live data') !== -1 || promptLower.indexOf('trio') !== -1 ||
                           promptLower.indexOf('overall summary') !== -1 || promptLower.indexOf('overview') !== -1 ||
                           promptLower.indexOf('all batches') !== -1;

    if (isConnectorQuery) {
      var statsGen = window.ConnectorSheetEngine.getSummaryMetrics();
      var sampleGen = window.ConnectorSheetEngine.getSampleRows(8);
      var out3 = '\n\n[LIVE CONNECTOR SHEET & TRIO-AI REAL-TIME DATA (Executive Overview):';
      if (statsGen) {
        out3 += '\nTotal database records: ' + statsGen.total.toLocaleString();
        out3 += '\nStatus Breakdown:';
        out3 += '\n- Ready for Production: ' + statsGen.readyForProduction.toLocaleString();
        out3 += '\n- Cannot Start Production: ' + statsGen.cannotStartProduction.toLocaleString();
        out3 += '\n- Material Pending: ' + statsGen.materialPending.toLocaleString();
        out3 += '\n- Material Received: ' + statsGen.materialReceived.toLocaleString();
        out3 += '\n- In Stock: ' + statsGen.inStock.toLocaleString();
        out3 += '\n- Ordered despite In Stock: ' + statsGen.orderedDespiteStock.toLocaleString();
        out3 += '\n- PO Not Created: ' + statsGen.poNotCreated.toLocaleString();
        out3 += '\n- PO Awaited: ' + statsGen.poAwaited.toLocaleString();
        out3 += '\n- No update from Store: ' + statsGen.noUpdate.toLocaleString();
      }
      out3 += '\nSample active records:';
      sampleGen.forEach(function (r, idx) {
        out3 += '\n#' + (idx + 1) + ': Batch ' + r[0] + ' | Style: ' + r[6] + ' | Item: ' + r[4] + ' | Planned: ' + r[13] + ' | AI Status: ' + r[23];
      });
      out3 += '\nINSTRUCTION: Provide an executive overview in Bengali of the Connector Live Sheet Records with total counts, readiness percentage, and bottleneck areas. STRICT RULE: Absolutely NO emojis!]\n';
      return out3;
    }

    return '';
  }

  function callGemini(promptText, historyArr, attachedFiles, callbackOrHandlers, isThink) {
    var activeModels = isThink ? GEMINI_THINK_MODELS : GEMINI_FAST_MODELS;
    var timeoutMs = isThink ? 25000 : 15000;

    var onChunk = null;
    var onDone = null;

    if (typeof callbackOrHandlers === 'function') {
      onDone = function (text) { callbackOrHandlers(null, text); };
    } else if (callbackOrHandlers && typeof callbackOrHandlers === 'object') {
      onChunk = callbackOrHandlers.onChunk;
      onDone = callbackOrHandlers.onDone;
    }

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

      // Ensure contents strictly begins with role: 'user' for Gemini API compliance
      while (contents.length > 0 && contents[0].role !== 'user') {
        contents.shift();
      }

      var dynamicSys = buildDynamicSystemInstruction(SYSTEM_INSTRUCTION, promptText, historyArr);
      if (isThink) {
        dynamicSys += "\n\n" +
          "### MODE: DEEP THINKING & IN-DEPTH ANALYSIS ACTIVE\n" +
          "- You are running in DEEP THINKING / IN-DEPTH ANALYSIS MODE (Powered by BatchIQ Deep Analysis Engine).\n" +
          "- Rigorously cross-examine all batch numbers, scrap variances, quality logs, and production timings.\n" +
          "- Conduct thorough root-cause analysis on yield deviations and machine downtime.\n" +
          "- Present findings in structured tables with Executive Highlights, Defect/Variance Root Causes, and Concrete Corrective Actions.\n" +
          "- Verify all math and metrics accurately.";
      }

      var payload = {
        systemInstruction: {
          parts: [{ text: dynamicSys }]
        },
        contents: contents,
        generationConfig: {
          maxOutputTokens: isThink ? 16384 : 8192,
          temperature: 0.1
        }
      };

      function tryModel(modelIdx) {
        if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
          return;
        }
        if (modelIdx >= activeModels.length) {
          var fallback = getBotReply(promptText, (attachedFiles ? attachedFiles.length : 0));
          if (typeof onDone === 'function') onDone(fallback);
          return;
        }

        var modelName = activeModels[modelIdx];
        var isStreaming = typeof onChunk === 'function';
        var endpoint = isStreaming ? ':streamGenerateContent?alt=sse&key=' : ':generateContent?key=';
        var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + endpoint + GEMINI_API_KEY;

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

        if (currentActiveTask) {
          currentActiveTask.abort = function () {
            if (timeoutId) clearTimeout(timeoutId);
            if (controller) {
              try { controller.abort(); } catch (e) {}
            }
          };
        }

        var accumulatedText = '';

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);

          if (isStreaming && res.body && typeof res.body.getReader === 'function') {
            var reader = res.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';

            function readNext() {
              if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
                try { reader.cancel(); } catch (e) {}
                return;
              }

              reader.read().then(function (chunk) {
                if (timeoutId) {
                  clearTimeout(timeoutId);
                  timeoutId = null;
                }

                if (chunk.done) {
                  if (typeof onDone === 'function') {
                    onDone(accumulatedText);
                  }
                  return;
                }

                buffer += decoder.decode(chunk.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop();

                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (line.indexOf('data:') !== 0) continue;
                  var jsonStr = line.slice(5).trim();
                  if (!jsonStr) continue;
                  try {
                    var parsed = JSON.parse(jsonStr);
                    var cand = parsed && parsed.candidates && parsed.candidates[0];
                    if (cand && cand.content && cand.content.parts) {
                      for (var p = 0; p < cand.content.parts.length; p++) {
                        var chunkText = cand.content.parts[p].text;
                        if (chunkText) {
                          accumulatedText += chunkText;
                          if (typeof onChunk === 'function') {
                            onChunk(chunkText, accumulatedText);
                          }
                        }
                      }
                    }
                  } catch (pe) {}
                }

                readNext();
              }).catch(function (streamErr) {
                if (timeoutId) clearTimeout(timeoutId);
                if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) return;
                if (accumulatedText.length > 0) {
                  if (typeof onDone === 'function') onDone(accumulatedText);
                } else {
                  console.warn('Stream failed on model ' + modelName + ', trying next model...');
                  tryModel(modelIdx + 1);
                }
              });
            }

            readNext();
          } else {
            return res.json().then(function (data) {
              if (timeoutId) clearTimeout(timeoutId);
              if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) return;

              var candidate = data && data.candidates && data.candidates[0];
              if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
                var reply = candidate.content.parts.map(function (part) { return part.text; }).join('\n');
                if (typeof onDone === 'function') onDone(reply);
              } else {
                tryModel(modelIdx + 1);
              }
            });
          }
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
            console.log('[Bai] Gemini fetch aborted or task cancelled by user.');
            return;
          }
          if (accumulatedText.length > 0) {
            if (typeof onDone === 'function') onDone(accumulatedText);
            return;
          }
          console.warn('Gemini model ' + modelName + ' failed (' + (err && err.name === 'AbortError' ? 'timeout' : err.message) + '), switching immediately to next model...');
          tryModel(modelIdx + 1);
        });
      }

      tryModel(0);
    }

    // Prepare attachments (multimodal image, Excel parsing & text reading)
    var liveContext = getLiveConnectorContextForPrompt(promptText, historyArr);
    var finalPromptText = (promptText || 'Please inspect the attached file(s).') + (liveContext ? liveContext : '');
    var parts = [{ text: finalPromptText }];
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

  function getBotReply(userText, fileCount) {
    var text = (userText || '').toLowerCase().trim();
    var identityKeys = ['মালিক', 'কে বানিয়েছে', 'তুমি কে', 'পরিচয়', 'porichoy', 'identity', 'owner', 'creator', 'who made', 'who are you', 'malik'];
    for (var k = 0; k < identityKeys.length; k++) {
      if (text.indexOf(identityKeys[k]) !== -1) {
        if (/[\u0980-\u09FF]/.test(text) || text.indexOf('porichoy') !== -1 || text.indexOf('malik') !== -1 || text.indexOf('ke ') !== -1 || text.indexOf('tumi') !== -1) {
          return 'আমি GudduAI-এর একটি অংশ এবং আমার মালিকের নাম অর্পণ নাজির (Arpan Nazir)।';
        }
        return "I am a part of GudduAI, and my owner's name is Arpan Nazir.";
      }
    }

    // Direct local answers using ConnectorSheetEngine if ready
    if (window.ConnectorSheetEngine && window.ConnectorSheetEngine.isReady()) {
      // 1. Batch Production Start & Material Readiness (Single or Multiple Batches)
      var targetBatches = extractBatchesFromPrompt(userText);
      if (targetBatches && targetBatches.length > 1) {
        return formatMultiBatchResponse(targetBatches);
      } else if (targetBatches && targetBatches.length === 1) {
        var bCand = targetBatches[0];
        var readiness = window.ConnectorSheetEngine.getBatchMaterialReadiness(bCand);
        if (readiness) {
          return formatBatchReadinessResponse(readiness);
        } else {
          var closeMatches = window.ConnectorSheetEngine.search(bCand, 5);
          return formatBatchNotFoundResponse(bCand, closeMatches);
        }
      }
      // 1.5 All Ready for Production Batches Query
      var uLow = String(userText || '').toLowerCase();
      var isReadyAllQ =
        (uLow.indexOf('ready for production') !== -1 || uLow.indexOf('ready to start') !== -1 || (uLow.indexOf('ready') !== -1 && uLow.indexOf('production') !== -1) || uLow.indexOf('100%') !== -1) &&
        (uLow.indexOf('all') !== -1 || uLow.indexOf('list') !== -1 || uLow.indexOf('store ok') !== -1 || uLow.indexOf('সব') !== -1 || uLow.indexOf('সকল') !== -1 || uLow.indexOf('তালিকা') !== -1 || uLow.indexOf('গুলো') !== -1 || uLow.indexOf('gulo') !== -1 || uLow.indexOf('batch') !== -1);
      if (isReadyAllQ && (!targetBatches || targetBatches.length === 0) && typeof window.ConnectorSheetEngine.getAllReadyForProductionBatches === 'function') {
        var allReady = window.ConnectorSheetEngine.getAllReadyForProductionBatches();
        return formatAllReadyBatchesResponse(allReady);
      }

      // 2. Style-based Query (Single or Multiple Styles)
      var targetStyles = extractStylesFromPrompt(userText);
      if (targetStyles && targetStyles.length > 1) {
        var smMap = {};
        var totalB = 0;
        targetStyles.forEach(function (st) {
          var bList = window.ConnectorSheetEngine.findBatchesByStyle(st, 50) || [];
          smMap[st] = bList;
          totalB += bList.length;
        });
        return formatMultiStyleResponse(targetStyles, smMap, totalB > 2);
      } else if (targetStyles && targetStyles.length === 1) {
        var sCand = targetStyles[0];
        var sBatches = window.ConnectorSheetEngine.findBatchesByStyle(sCand, 50);
        if (sBatches && sBatches.length > 0) {
          return formatStyleBatchesResponse(sCand, sBatches, sBatches.length > 2);
        } else {
          return '### [স্টাইল অনুসন্ধান: স্টাইল নম্বর পাওয়া যায়নি]\n\nআপনার প্রদত্ত স্টাইল নম্বর **`' + sCand.toUpperCase() + '`** বর্তমানে ফ্যাক্টরির লাইভ কানেক্টর শিট রেকর্ডে পাওয়া যায়নি। অনুগ্রহ করে স্টাইল নম্বরটি যাচাই করুন অথবা "Sync Sheet" বাটনে ক্লিক করুন।';
        }
      }

      // 3. Indent-based Query (Single or Multiple Indents)
      var targetIndents = extractIndentsFromPrompt(userText);
      if (targetIndents && targetIndents.length > 1) {
        var indMap = {};
        targetIndents.forEach(function (ind) {
          indMap[ind] = window.ConnectorSheetEngine.getIndentAudit(ind);
        });
        return formatMultiIndentResponse(targetIndents, indMap, true);
      } else if (targetIndents && targetIndents.length === 1) {
        var targetIndent = targetIndents[0];
        var iAudit = window.ConnectorSheetEngine.getIndentAudit(targetIndent);
        if (iAudit) {
          return formatIndentAuditResponse(iAudit);
        } else {
          return formatIndentNotFoundResponse(targetIndent);
        }
      } else if (text.indexOf('indent') !== -1 || text.indexOf('ind no') !== -1) {
        return formatGenericIndentGuideResponse();
      }
    }

    // Only match greetings if short and standalone
    if (text.length < 25 && /^(hi|hello|hey|assalamu|salam|নমস্কার|হ্যালো|नमस्ते|प्रणाम)\b/i.test(text)) {
      return GREETING_REPLY;
    }

    if (!userText && fileCount) {
      return 'Got ' + fileCount + ' file' + (fileCount > 1 ? 's' : '') + ' ------ thanks! Processing attachments...';
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

    // Initialize active task and set button to STOP TASK state
    currentActiveTask = {
      isThink: useThink,
      isAborted: false,
      abort: null,
      streamTimer: null,
      streamWrap: null,
      contentEl: null,
      cursorEl: null,
      getCurrentText: null
    };
    setSendButtonState(true);

    var promptLower = text.toLowerCase();
    var isExcelRequested = /\b(excel|xlsx|xls|csv|sheet|এক্সেল|স্প্রেডশিট)\b/i.test(promptLower) ||
                           promptLower.indexOf('excel') !== -1 ||
                           promptLower.indexOf('এক্সেল') !== -1;

    var isReadyAllBatchesQuery =
      (promptLower.indexOf('ready for production') !== -1 || promptLower.indexOf('ready to start') !== -1 || (promptLower.indexOf('ready') !== -1 && promptLower.indexOf('production') !== -1) || promptLower.indexOf('100%') !== -1) &&
      (promptLower.indexOf('all') !== -1 || promptLower.indexOf('list') !== -1 || promptLower.indexOf('store ok') !== -1 || promptLower.indexOf('সব') !== -1 || promptLower.indexOf('সকল') !== -1 || promptLower.indexOf('তালিকা') !== -1 || promptLower.indexOf('গুলো') !== -1 || promptLower.indexOf('gulo') !== -1 || promptLower.indexOf('batch') !== -1);

    // Ensure Connector Sheet records are loaded ONLY when batches, styles, indents, excel, or ready batch list are requested
    var targetBatches = isReadyAllBatchesQuery ? extractBatchesFromPrompt(text, null) : extractBatchesFromPrompt(text, history);
    var targetStyles = isReadyAllBatchesQuery ? extractStylesFromPrompt(text, null) : extractStylesFromPrompt(text, history);
    var targetIndents = isReadyAllBatchesQuery ? extractIndentsFromPrompt(text, null) : extractIndentsFromPrompt(text, history);
    var targetIndent = (targetIndents && targetIndents.length > 0) ? targetIndents[0] : null;
    var isDataQuery = (targetBatches && targetBatches.length > 0) ||
                      (targetStyles && targetStyles.length > 0) ||
                      (targetIndents && targetIndents.length > 0) ||
                      (!!targetIndent) ||
                      isExcelRequested ||
                      isReadyAllBatchesQuery;

    var ensureLoadedPromise = Promise.resolve();
    if (isDataQuery) {
      if (window.ConnectorSheetEngine && !window.ConnectorSheetEngine.isReady() && typeof window.ConnectorSheetEngine.ensureDataLoaded === 'function') {
        ensureLoadedPromise = window.ConnectorSheetEngine.ensureDataLoaded();
      } else if (!isReadyAllBatchesQuery && targetBatches && targetBatches.length > 0 && (!targetStyles || targetStyles.length === 0) && (!targetIndents || targetIndents.length === 0) && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.ensureBatchLoaded === 'function') {
        ensureLoadedPromise = Promise.all(targetBatches.map(function (b) {
          return window.ConnectorSheetEngine.ensureBatchLoaded(b);
        }));
      } else if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.ensureDataLoaded === 'function') {
        ensureLoadedPromise = window.ConnectorSheetEngine.ensureDataLoaded();
      }
    }

    ensureLoadedPromise.then(function () {
      if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) {
        return;
      }

      function buildExcelCardHtmlForQuery(isReadyAllQ, batchesArr, stylesArr, indentsArr, isExcelReq, replyStr) {
        if (!window.ConnectorSheetEngine || !window.ConnectorSheetEngine.isReady()) return '';
        var finalReply = replyStr || '';
        if (finalReply.indexOf('bai-excel-export-card') !== -1) return '';

        // 1. All Ready for Production Batches
        if (isReadyAllQ) {
          var allReadyBatches = window.ConnectorSheetEngine.getAllReadyForProductionBatches();
          if (allReadyBatches && allReadyBatches.length > 0) {
            var readyKey = 'ready_card_' + Date.now();
            if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
            window._multiBatchExcelRegistry[readyKey] = {
              batches: allReadyBatches,
              fileName: 'Ready_For_Production_Batches_Audit_Report.xlsx',
              timestamp: Date.now()
            };
            try {
              sessionStorage.setItem('bai_card_' + readyKey, JSON.stringify(window._multiBatchExcelRegistry[readyKey]));
            } catch (e) {}
            var rBatchListCsv = allReadyBatches.map(function (b) { return b.batchNo; }).join(',');
            return '\n\n' +
              '<div class="bai-excel-export-card" data-card-key="' + readyKey + '" data-batches="' + rBatchListCsv + '" data-filename="Ready_For_Production_Batches_Audit_Report.xlsx" onclick="window.downloadMultiBatchExcel(\'' + readyKey + '\', this)">' +
                '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
                '<div class="bai-excel-card-info">' +
                  '<div class="bai-excel-card-title">Ready_For_Production_Batches_Audit_Report.xlsx</div>' +
                  '<div class="bai-excel-card-sub">১০০% প্রস্তুত ' + allReadyBatches.length + 'টি ব্যাচের সম্পূর্ণ অডিট রিপোর্ট • ৪টি শিট (Summary, Pending, Ready, Bottlenecks)</div>' +
                '</div>' +
                '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
              '</div>';
          }
        }
        // 2. Specific Batches Queried (Multi-batch or Excel explicitly requested)
        else if (batchesArr && batchesArr.length > 0) {
          var bAuditList = [];
          batchesArr.forEach(function (b) {
            var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
            if (r) bAuditList.push(r);
          });
          if (bAuditList.length > 0 && (isExcelReq || batchesArr.length > 1 || finalReply.indexOf('excel') !== -1 || finalReply.indexOf('এক্সেল') !== -1)) {
            var bCardKey = 'batch_card_' + Date.now();
            if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
            var bExportFileName = bAuditList.length === 1 ? ('Batch_' + bAuditList[0].batchNo.replace(/[^a-zA-Z0-9_-]/g, '_') + '_Audit_Report.xlsx') : ('Batch_Audit_Report_' + bAuditList.length + '_Batches.xlsx');
            window._multiBatchExcelRegistry[bCardKey] = {
              batches: bAuditList,
              fileName: bExportFileName,
              timestamp: Date.now()
            };
            try {
              sessionStorage.setItem('bai_card_' + bCardKey, JSON.stringify(window._multiBatchExcelRegistry[bCardKey]));
            } catch (e) {}
            var batchListCsv = bAuditList.map(function (b) { return b.batchNo; }).join(',');
            return '\n\n' +
              '<div class="bai-excel-export-card" data-card-key="' + bCardKey + '" data-batches="' + batchListCsv + '" data-filename="' + bExportFileName + '" onclick="window.downloadMultiBatchExcel(\'' + bCardKey + '\', this)">' +
                '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
                '<div class="bai-excel-card-info">' +
                  '<div class="bai-excel-card-title">' + bExportFileName + '</div>' +
                  '<div class="bai-excel-card-sub">' + bAuditList.length + 'টি ব্যাচের কাঁচামাল অডিট স্প্রেডশিট • ৪টি শিট</div>' +
                '</div>' +
                '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
              '</div>';
          }
        }
        // 3. Style Queried
        else if (stylesArr && stylesArr.length > 0) {
          var styleAuditList = [];
          stylesArr.forEach(function (st) {
            var bList = window.ConnectorSheetEngine.findBatchesByStyle(st, 50) || [];
            bList.forEach(function (b) { styleAuditList.push(b); });
          });
          if (styleAuditList.length > 0 && (isExcelReq || styleAuditList.length > 2 || finalReply.indexOf('excel') !== -1 || finalReply.indexOf('এক্সেল') !== -1)) {
            var sCardKey = 'style_card_' + Date.now();
            if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
            var sExportFileName = 'Style_' + stylesArr.join('_').replace(/[^a-zA-Z0-9_-]/g, '_') + '_Batches_Audit.xlsx';
            window._multiBatchExcelRegistry[sCardKey] = {
              batches: styleAuditList,
              fileName: sExportFileName,
              timestamp: Date.now()
            };
            try {
              sessionStorage.setItem('bai_card_' + sCardKey, JSON.stringify(window._multiBatchExcelRegistry[sCardKey]));
            } catch (e) {}
            var styleBatchListCsv = styleAuditList.map(function (b) { return b.batchNo; }).join(',');
            return '\n\n' +
              '<div class="bai-excel-export-card" data-card-key="' + sCardKey + '" data-style="' + stylesArr.join(',') + '" data-batches="' + styleBatchListCsv + '" data-filename="' + sExportFileName + '" onclick="window.downloadMultiBatchExcel(\'' + sCardKey + '\', this)">' +
                '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
                '<div class="bai-excel-card-info">' +
                  '<div class="bai-excel-card-title">' + sExportFileName + '</div>' +
                  '<div class="bai-excel-card-sub">' + styleAuditList.length + 'টি ব্যাচের কাঁচামাল অডিট স্প্রেডশিট • ৪টি শিট</div>' +
                '</div>' +
                '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
              '</div>';
          }
        }
        // 4. Indent Queried
        else if (indentsArr && indentsArr.length > 0) {
          if (indentsArr.length > 1) {
            var allIndBatches = [];
            var indBatchSeen = {};
            indentsArr.forEach(function (ind) {
              var ia = window.ConnectorSheetEngine.getIndentAudit(ind);
              if (ia && ia.batches) {
                var bArr = ia.batches.split(/,\s*/).filter(Boolean);
                bArr.forEach(function (b) {
                  b = b.trim();
                  if (b && b !== '-' && !indBatchSeen[b]) {
                    indBatchSeen[b] = true;
                    var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
                    if (r) allIndBatches.push(r);
                  }
                });
              }
            });
            if (allIndBatches.length > 0 && (isExcelReq || allIndBatches.length > 1 || finalReply.indexOf('excel') !== -1 || finalReply.indexOf('এক্সেল') !== -1)) {
              var miCardKey = 'multiindent_card_' + Date.now();
              if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
              var miExportFileName = 'Multi_Indent_Audit_' + indentsArr.length + '_Indents.xlsx';
              window._multiBatchExcelRegistry[miCardKey] = {
                batches: allIndBatches,
                fileName: miExportFileName,
                timestamp: Date.now()
              };
              try {
                sessionStorage.setItem('bai_card_' + miCardKey, JSON.stringify(window._multiBatchExcelRegistry[miCardKey]));
              } catch (e) {}
              var miBatchListCsv = allIndBatches.map(function (b) { return b.batchNo; }).join(',');
              return '\n\n' +
                '<div class="bai-excel-export-card" data-card-key="' + miCardKey + '" data-indents="' + indentsArr.join(',') + '" data-batches="' + miBatchListCsv + '" data-filename="' + miExportFileName + '" onclick="window.downloadMultiBatchExcel(\'' + miCardKey + '\', this)">' +
                  '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
                  '<div class="bai-excel-card-info">' +
                    '<div class="bai-excel-card-title">' + miExportFileName + '</div>' +
                    '<div class="bai-excel-card-sub">' + indentsArr.length + 'টি ইনডেন্টের আওতাধীন ' + allIndBatches.length + 'টি ব্যাচের কাঁচামাল অডিট স্প্রেডশিট • ৪টি শিট</div>' +
                  '</div>' +
                  '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
                '</div>';
            }
          } else {
            var singleIndent = indentsArr[0];
            var iAudit = window.ConnectorSheetEngine.getIndentAudit(singleIndent);
            if (iAudit && iAudit.items && iAudit.items.length > 0) {
              var indBatches = (iAudit.batches || '').split(/,\s*/).filter(Boolean);
              var iBatchAudits = [];
              indBatches.forEach(function (b) {
                b = b.trim();
                if (b && b !== '-') {
                  var r = window.ConnectorSheetEngine.getBatchMaterialReadiness(b);
                  if (r) iBatchAudits.push(r);
                }
              });
              if (iBatchAudits.length > 0 && (isExcelReq || iBatchAudits.length > 1 || finalReply.indexOf('excel') !== -1 || finalReply.indexOf('এক্সেল') !== -1)) {
                var iCardKey = 'indent_card_' + Date.now();
                if (!window._multiBatchExcelRegistry) window._multiBatchExcelRegistry = {};
                var iExportFileName = 'Indent_' + singleIndent.replace(/[^a-zA-Z0-9_-]/g, '_') + '_Batches_Audit.xlsx';
                window._multiBatchExcelRegistry[iCardKey] = {
                  batches: iBatchAudits,
                  fileName: iExportFileName,
                  timestamp: Date.now()
                };
                try {
                  sessionStorage.setItem('bai_card_' + iCardKey, JSON.stringify(window._multiBatchExcelRegistry[iCardKey]));
                } catch (e) {}
                var iBatchListCsv = iBatchAudits.map(function (b) { return b.batchNo; }).join(',');
                return '\n\n' +
                  '<div class="bai-excel-export-card" data-card-key="' + iCardKey + '" data-indent="' + singleIndent + '" data-batches="' + iBatchListCsv + '" data-filename="' + iExportFileName + '" onclick="window.downloadMultiBatchExcel(\'' + iCardKey + '\', this)">' +
                    '<div class="bai-excel-card-icon"><span class="material-icons-round">table_view</span></div>' +
                    '<div class="bai-excel-card-info">' +
                      '<div class="bai-excel-card-title">' + iExportFileName + '</div>' +
                      '<div class="bai-excel-card-sub">ইন্ডেন্ট ' + singleIndent + '-এর ' + iBatchAudits.length + 'টি ব্যাচের কাঁচামাল অডিট স্প্রেডশিট • ৪টি শিট</div>' +
                    '</div>' +
                    '<button type="button" class="bai-excel-download-btn"><span class="material-icons-round">file_download</span> Download Excel</button>' +
                  '</div>';
              }
            }
          }
        }
        return '';
      }

      var streamUi = null;
      var renderPending = false;
      var lastRenderedText = '';

      function ensureStreamUi() {
        if (streamUi) return streamUi;
        removeTyping();
        var log = document.getElementById('bai-chat-log');
        if (!log) return null;

        var wrap = document.createElement('div');
        wrap.className = 'bai-msg bai-msg--bot' + (useThink ? ' bai-msg--think' : '');
        wrap.innerHTML =
          '<div class="bai-msg-avatar">' + BAI_ICON_SVG + '</div>' +
          '<div class="bai-msg-content-wrap">' +
            '<div class="bai-msg-bubble"><div class="bai-stream-content"></div><span class="bai-stream-cursor"></span></div>' +
          '</div>';
        log.appendChild(wrap);
        scrollToBottom();

        var contentEl = wrap.querySelector('.bai-stream-content');
        var cursorEl = wrap.querySelector('.bai-stream-cursor');

        currentActiveTask.streamWrap = wrap;
        currentActiveTask.contentEl = contentEl;
        currentActiveTask.cursorEl = cursorEl;

        streamUi = {
          wrap: wrap,
          contentEl: contentEl,
          cursorEl: cursorEl
        };
        return streamUi;
      }

      callGemini(text, history.slice(0, -1), files, {
        onChunk: function (chunkText, fullAccumulated) {
          if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) return;
          var ui = ensureStreamUi();
          if (!ui) return;

          currentActiveTask.getCurrentText = function () { return fullAccumulated; };

          if (!renderPending) {
            renderPending = true;
            requestAnimationFrame(function () {
              renderPending = false;
              if (ui.contentEl && fullAccumulated !== lastRenderedText) {
                ui.contentEl.innerHTML = formatText(fullAccumulated);
                lastRenderedText = fullAccumulated;
                scrollToBottom();
              }
            });
          }
        },
        onDone: function (reply) {
          if (!isGenerating || (currentActiveTask && currentActiveTask.isAborted)) return;
          removeTyping();

          var finalReply = reply || '';
          var cardHtml = buildExcelCardHtmlForQuery(isReadyAllBatchesQuery, targetBatches, targetStyles, targetIndents, isExcelRequested, finalReply);
          var completedText = finalReply + (cardHtml || '');

          var ui = streamUi;
          if (ui) {
            if (ui.cursorEl) {
              try { ui.cursorEl.remove(); } catch (e) {}
            }
            if (ui.contentEl) {
              ui.contentEl.innerHTML = formatText(finalReply) + (cardHtml || '');
              var contentWrap = ui.wrap.querySelector('.bai-msg-content-wrap');
              if (contentWrap && !contentWrap.querySelector('.bai-msg-actions')) {
                var actionsDiv = document.createElement('div');
                actionsDiv.className = 'bai-msg-actions';
                actionsDiv.innerHTML =
                  '<button type="button" class="bai-msg-action-btn" onclick="window.copyMessageText(this)" title="Copy message">' +
                    '<span class="material-icons-round">content_copy</span>' +
                    '<span class="bai-copy-toast">Copied!</span>' +
                  '</button>' +
                  getSheetActionBtnHtml(finalReply);
                contentWrap.appendChild(actionsDiv);
              }
              scrollToBottom();
            }

            history.push({ role: 'bot', text: completedText, isThink: useThink });
            var curSess2 = getActiveSession();
            if (curSess2) {
              curSess2.messages = history.slice();
              curSess2.timestamp = Date.now();
              saveSessions();
              renderHistoryList();
            }

            setSendButtonState(false);
            currentActiveTask = null;
          } else {
            // Non-streaming fallback
            appendStreamMessage('bot', completedText, function () {
              history.push({ role: 'bot', text: completedText, isThink: useThink });
              var curSess3 = getActiveSession();
              if (curSess3) {
                curSess3.messages = history.slice();
                curSess3.timestamp = Date.now();
                saveSessions();
                renderHistoryList();
              }
              setSendButtonState(false);
              currentActiveTask = null;
            }, useThink);
          }
        }
      }, useThink);
    });
  }

  function sendFromInput(sourceEl) {
    if (isGenerating) {
      stopCurrentTask();
      return;
    }

    var heroInput = document.getElementById('bai-chat-input');
    var dockedInput = document.getElementById('bai-chat-input-docked');

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
      document.getElementById('bai-attach-chips'),
      document.getElementById('bai-attach-chips-docked')
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
          return '<div class="bai-attach-chip bai-attach-chip--image" title="' + safeName + ' (' + sizeStr + ')">' +
            '<div class="bai-attach-thumb-wrap">' +
              '<img class="bai-attach-thumb" src="' + thumbUrl + '" alt="' + safeName + '">' +
            '</div>' +
            '<div class="bai-attach-meta">' +
              '<span class="bai-attach-name">' + safeName + '</span>' +
              '<span class="bai-attach-size">' + sizeStr + '</span>' +
            '</div>' +
            '<button type="button" class="bai-attach-remove" data-idx="' + idx + '" aria-label="Remove image" title="Remove">' +
              '<span class="material-icons-round">close</span>' +
            '</button>' +
          '</div>';
        }

        var iconName = getFileIcon(f.name);
        return '<div class="bai-attach-chip bai-attach-chip--doc" title="' + safeName + ' (' + sizeStr + ')">' +
          '<div class="bai-attach-icon-wrap">' +
            '<span class="material-icons-round">' + iconName + '</span>' +
          '</div>' +
          '<div class="bai-attach-meta">' +
            '<span class="bai-attach-name">' + safeName + '</span>' +
            '<span class="bai-attach-size">' + sizeStr + '</span>' +
          '</div>' +
          '<button type="button" class="bai-attach-remove" data-idx="' + idx + '" aria-label="Remove file" title="Remove">' +
            '<span class="material-icons-round">close</span>' +
          '</button>' +
        '</div>';
      }).join('');

      var removeBtns = wrap.querySelectorAll('.bai-attach-remove');
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
    var newChatBtn = document.getElementById('bai-new-chat-btn');
    if (newChatBtn) newChatBtn.addEventListener('click', createNewChat);

    var welcomeHeading = document.getElementById('bai-welcome-heading');
    if (welcomeHeading) {
      welcomeHeading.addEventListener('click', function () {
        updateWelcomeGreeting(true);
      });
    }

    var historyClearAll = document.getElementById('bai-history-clear-all');
    if (historyClearAll) historyClearAll.addEventListener('click', clearAllSessions);

    var attachBtn = document.getElementById('bai-attach-btn');
    var fileInput = document.getElementById('bai-file-input');
    var suggestBtn = document.getElementById('bai-suggest-btn');
    var scrollLatestBtn = document.getElementById('bai-scroll-latest');
    var contentScroller = document.getElementById('bai-content-scroll');

    if (input) {

      input.addEventListener('input', function () { autoGrow(input); });

      input.addEventListener('keydown', function (evt) {
        if (evt.key === "Enter" && !evt.shiftKey) {
          evt.preventDefault();
          if (!isGenerating) {
            sendFromInput(input);
          }
        }
      });

      input.addEventListener('paste', function (evt) {
        window.fmsHandleChatPaste(evt, selectedFiles, renderAttachChips, {
          accentColor: '#1a73e8',
          bannerBg: '#e8f0fe',
          brandName: 'BatchIQ'
        });
      });

    }

    if (sendBtn) {
      sendBtn.addEventListener("click", function (evt) {
        if (evt && evt.preventDefault) evt.preventDefault();
        if (isGenerating) {
          stopCurrentTask();
        } else {
          sendFromInput(input);
        }
      });
    }
    var thinkBtn = document.getElementById('bai-think-btn');
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
    if (backBtn) backBtn.addEventListener('click', closeBaiPage);
    var collapseBtn = document.getElementById('bai-side-collapse-btn');
    var sidebar = document.getElementById('bai-window-sidebar');
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener('click', function () {
        sidebar.classList.toggle('is-collapsed');
      });
    }

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
    var dockedInput = document.getElementById('bai-chat-input-docked');
    var dockedSend = document.getElementById('bai-send-btn-docked');
    var dockedAttach = document.getElementById('bai-attach-btn-docked');
    var dockedThink = document.getElementById('bai-think-btn-docked');

    if (dockedInput) {
      dockedInput.addEventListener('input', function () { autoGrow(dockedInput); });
      dockedInput.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter" && !evt.shiftKey) {
          evt.preventDefault();
          if (!isGenerating) {
            sendFromInput(dockedInput);
          }
        }
      });
      dockedInput.addEventListener('paste', function (evt) {
        window.fmsHandleChatPaste(evt, selectedFiles, renderAttachChips, {
          accentColor: '#1a73e8',
          bannerBg: '#e8f0fe',
          brandName: 'BatchIQ'
        });
      });
    }
    if (dockedSend) {
      dockedSend.addEventListener("click", function (evt) {
        if (evt && evt.preventDefault) evt.preventDefault();
        if (isGenerating) {
          stopCurrentTask();
        } else {
          sendFromInput(dockedInput);
        }
      });
    }
    if (dockedThink) {
      dockedThink.addEventListener('click', toggleThinkMode);
    }
    if (dockedAttach && fileInput) {
      dockedAttach.addEventListener('click', function () { fileInput.click(); });
    }
    updateThinkUI();

    var promptCards = document.querySelectorAll('.bai-prompt-card');
    for (var p = 0; p < promptCards.length; p++) {
      promptCards[p].addEventListener('click', function (evt) {
        var card = evt.currentTarget;
        var ptext = card.getAttribute('data-prompt');
        if (ptext && !isGenerating) {
          sendText(ptext, []);
        }
      });
    }

    var seeMoreBtn = document.getElementById('bai-see-more-btn');
    var cardsGrid = document.getElementById('bai-cards-grid');
    if (seeMoreBtn && cardsGrid) {
      seeMoreBtn.addEventListener('click', function () {
        var isExpanded = cardsGrid.classList.toggle('is-expanded');
        seeMoreBtn.classList.toggle('is-active', isExpanded);
        seeMoreBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        var textSpan = seeMoreBtn.querySelector('.bai-see-more-text');
        var iconSpan = seeMoreBtn.querySelector('.bai-see-more-icon');
        if (textSpan) {
          textSpan.textContent = isExpanded ? 'See less' : 'See more';
        }
        if (iconSpan) {
          iconSpan.textContent = isExpanded ? 'expand_less' : 'expand_more';
        }
      });
    }

    try {
      var urlParams = new URLSearchParams(window.location.search);
      var initPrompt = urlParams.get('prompt') || (urlParams.get('batch') ? ('Analyze Batch ' + urlParams.get('batch')) : '');
      if (initPrompt && input) {
        input.value = initPrompt;
        autoGrow(input);
        input.focus();
        if (urlParams.get('auto') === '1' || urlParams.get('send') === '1') {
          setTimeout(function () {
            sendText(initPrompt, []);
          }, 350);
        }
      }
    } catch (e) {}

  }

  // ---------------------------------------------------------------------

  // Open / close the Batch Analysis with AI page (independent of the

  // sidebar nav-item system, since the launcher lives in the topbar rather

  // than the sidebar â same pattern as ai.js).

  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Open / close the Batch Analysis with AI page (independent of the
  // sidebar nav-item system, since the launcher lives in the topbar rather
  // than the sidebar â same pattern as ai.js).
  // ---------------------------------------------------------------------
  function isBaiPageOpen_() {
    var target = document.getElementById('page-bai');
    return !!(target && target.style.display !== 'none' && built);
  }

  function openBaiPage() {
    if (typeof window.closeNavPanel === 'function') {
      try { window.closeNavPanel(); } catch (e) {}
    }
    window.location.href = 'bai.html';
  }

  function closeBaiPage() {
    window.location.href = 'index.html';
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    var btn = document.getElementById('topbar-bai-btn');
    if (btn) btn.addEventListener('click', openBaiPage);

    var navCard = document.getElementById('nav-ai-btn-bai');
    if (navCard) {
      navCard.addEventListener('click', openBaiPage);
      navCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBaiPage();
        }
      });
    }

    // Access revoked mid-session (see app.js reEvaluateAiAccess_) while this
    // page happens to be open right now â close it back to the previous view.
    window.addEventListener('fms:ai-access-revoked', function (evt) {
      if (evt && evt.detail && evt.detail.id === 'ai-batch-analysis' && isBaiPageOpen_()) closeBaiPage();
    });
  
    // Auto-build and wire events if running standalone
    var isStandalone = !!document.getElementById('page-bai') || document.body.classList.contains('bai-standalone') || window.location.pathname.toLowerCase().indexOf('bai.html') !== -1;
    if (isStandalone) {
      buildMarkup();
    }
    syncUserProfile();
  }

  // Export BatchAnalysisAI helper methods to global window
  window.BatchAnalysisAI = {
    callGemini: callGemini,
    openBaiPage: openBaiPage,
    getLiveConnectorContextForPrompt: getLiveConnectorContextForPrompt,
    getBotReply: getBotReply,
    extractBatchesFromPrompt: extractBatchesFromPrompt,
    formatMultiBatchResponse: formatMultiBatchResponse,
    formatBatchReadinessResponse: formatBatchReadinessResponse,
    extractStylesFromPrompt: extractStylesFromPrompt,
    formatStyleBatchesResponse: formatStyleBatchesResponse,
    formatMultiStyleResponse: formatMultiStyleResponse,
    extractIndentsFromPrompt: extractIndentsFromPrompt,
    formatIndentAuditResponse: formatIndentAuditResponse,
    formatMultiIndentResponse: formatMultiIndentResponse,
    formatAllReadyBatchesResponse: formatAllReadyBatchesResponse,
    sendPrompt: function (text) {
      if (!text) return;
      var heroInput = document.getElementById('bai-chat-input');
      var dockedInput = document.getElementById('bai-chat-input-docked');
      if (heroInput) heroInput.value = text;
      if (dockedInput) dockedInput.value = text;
      sendText(text, []);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
