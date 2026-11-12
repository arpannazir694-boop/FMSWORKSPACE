// =============================================================================
// batchAnalysis.js — Batch Analysis: Excel Upload → Shared Google Drive → Table
// =============================================================================
(function () {
  'use strict';

  var STORAGE_KEY_DATA = 'FMS_BATCH_ANALYSIS_EXCEL_DATA';
  var STORAGE_KEY_META = 'FMS_BATCH_ANALYSIS_EXCEL_META';

  var GAS_URL = window.GAS_URL || '';
  function getGasUrl() { return window.GAS_URL || GAS_URL || ''; }

  var currentHeaders = [];   // Array of column header strings
  var currentData = [];      // Array of row objects keyed by header
  var filteredRows = [];     // Filtered/sorted view of currentData
  var currentPage = 1;
  var pageSize = 50;
  var searchQuery = '';
  var sortCol = null;
  var sortAsc = true;
  var initialized = false;
  var saving = false;

  // Holds the most recently parsed (but not-yet-saved) file, so the
  // dedicated "Save to Google Drive" button can push it on demand.
  var pendingUpload = null; // { filename, sourceFileBase64, sourceFileMime }

  var CHUNK_SIZE = 3000; // rows per network call — keeps each save request small & fast

  function el(id) { return document.getElementById(id); }
  function helpers() { return window.FMS || {}; }
  function toast(type, title, msg) { if (helpers().showToast) helpers().showToast(type, title, msg); else alert(title + ': ' + msg); }
  function esc(v) { return helpers().esc ? helpers().esc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function canUseAppsScript_() { return typeof google !== 'undefined' && google.script && google.script.run; }

  // Promise wrapper around google.script.run with a hard timeout, so the UI
  // never gets stuck on "Saving…" forever if a call never comes back (which
  // is exactly what happened with the old single giant-payload save).
  function gasCall_(fnName, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!canUseAppsScript_()) { reject(new Error('Apps Script bridge not available.')); return; }
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('The request took too long and timed out. Please check your connection and try saving again.'));
      }, timeoutMs || 45000);

      var runner = google.script.run
        .withSuccessHandler(function (result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .withFailureHandler(function (error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
      runner[fnName].apply(runner, args);
    });
  }

  function chunkArray_(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function arrayBufferToBase64_(buffer) {
    var bytes = new Uint8Array(buffer);
    var parts = [];
    var chunkSize = 0x8000;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
    }
    return btoa(parts.join(''));
  }

  // ---------------------------------------------------------------------------
  // Persistence Helpers (localStorage) — quick local fallback/cache
  // ---------------------------------------------------------------------------
  function saveToStorage(filename, rows, headers, uploadTime) {
    try {
      var meta = { filename: filename, uploadTime: uploadTime || new Date().toLocaleString(), totalRows: rows.length, totalCols: headers.length };
      localStorage.setItem(STORAGE_KEY_META, JSON.stringify(meta));
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify({ headers: headers, rows: rows }));
    } catch (e) { console.warn('Storage error:', e); }
  }

  function loadFromStorage() {
    try {
      var metaStr = localStorage.getItem(STORAGE_KEY_META);
      var dataStr = localStorage.getItem(STORAGE_KEY_DATA);
      if (!metaStr || !dataStr) return false;
      var meta = JSON.parse(metaStr);
      var data = JSON.parse(dataStr);
      if (data && Array.isArray(data.rows) && Array.isArray(data.headers) && data.rows.length) {
        currentHeaders = data.headers;
        currentData = data.rows;
        updateFileStatusUI(meta.filename, meta.totalRows, meta.uploadTime);
        applyFiltersAndRender();
        return true;
      }
    } catch (e) { console.warn('Load storage error:', e); }
    return false;
  }

  function clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY_META);
      localStorage.removeItem(STORAGE_KEY_DATA);
    } catch (e) {}
    currentData = [];
    currentHeaders = [];
    filteredRows = [];
    resetUI();
  }

  // ---------------------------------------------------------------------------
  // Excel File Reader via SheetJS (xlsx)
  // ---------------------------------------------------------------------------
  function processExcelFile(file) {
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      var mb = (file.size / 1024 / 1024).toFixed(1);
      toast('error', 'File Too Large', 'File "' + file.name + '" is ' + mb + ' MB. Maximum allowed Excel size is 25 MB.');
      return;
    }

    var XLSXLib = window.XLSX;
    if (!XLSXLib) {
      toast('error', 'Library Missing', 'SheetJS (xlsx) library failed to load. Check your internet connection.');
      return;
    }

    if (helpers().showSpinner) helpers().showSpinner('Reading Excel file…');

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var workbook = XLSXLib.read(data, { type: 'array' });
        var sourceFileBase64 = arrayBufferToBase64_(e.target.result);

        if (!workbook.SheetNames.length) throw new Error('The uploaded Excel file contains no worksheets.');

        var firstSheetName = workbook.SheetNames[0];
        var worksheet = workbook.Sheets[firstSheetName];
        var jsonRows = XLSXLib.utils.sheet_to_json(worksheet, { defval: '' });

        if (!jsonRows || jsonRows.length === 0) throw new Error('No data rows found in sheet "' + firstSheetName + '".');

        var headerMap = {};
        jsonRows.forEach(function (row) { Object.keys(row).forEach(function (k) { headerMap[k] = true; }); });
        currentHeaders = Object.keys(headerMap);
        currentData = jsonRows;
        sortCol = null;
        searchQuery = '';

        var searchInput = el('batch-analysis-search');
        if (searchInput) searchInput.value = '';

        var uploadTime = new Date().toLocaleString();
        saveToStorage(file.name, currentData, currentHeaders, uploadTime);
        updateFileStatusUI(file.name, currentData.length, uploadTime, true);
        applyFiltersAndRender();

        pendingUpload = {
          filename: file.name,
          sourceFileBase64: sourceFileBase64,
          sourceFileMime: file.type || 'application/octet-stream'
        };
        setSaveButtonState_('ready');

        toast('success', 'File Loaded', 'Loaded ' + currentData.length + ' rows locally. Click "Save to Google Drive" below to store it for everyone.');
      } catch (err) {
        toast('error', 'Parse Error', err.message || 'Could not parse the selected Excel file.');
      } finally {
        if (helpers().hideSpinner) helpers().hideSpinner();
      }
    };

    reader.onerror = function () {
      if (helpers().hideSpinner) helpers().hideSpinner();
      toast('error', 'Read Error', 'Failed to read the file.');
    };

    reader.readAsArrayBuffer(file);
  }

  // ---------------------------------------------------------------------------
  // Cloud Sync — saves the parsed data + original workbook to shared Drive
  // ---------------------------------------------------------------------------
  function syncToCloud(filename, headers, rows, sourceFileBase64, sourceFileMime, onDone) {
    if (canUseAppsScript_()) {
      google.script.run
        .withSuccessHandler(function (result) {
          if (result && result.success) {
            toast('success', 'Saved to Drive', 'The Excel data is stored in shared Google Drive (' + result.count + ' rows) and is available to everyone.');
          } else {
            toast('error', 'Save Failed', (result && result.error) || 'The Excel data could not be saved to Google Drive.');
          }
          if (onDone) onDone(!!(result && result.success));
        })
        .withFailureHandler(function (error) {
          var msg = (error && error.message) ? error.message : String(error || 'Unknown error');
          toast('error', 'Save Failed', msg);
          if (onDone) onDone(false);
        })
        .saveBatchAnalysisData(filename, headers, rows, sourceFileBase64, sourceFileMime);
      return;
    }

    var url = getGasUrl();
    if (!url) {
      toast('error', 'Save Failed', 'Google Apps Script connection (GAS_URL) was not found. Open the app through its published Apps Script deployment URL.');
      if (onDone) onDone(false);
      return;
    }

    var payload = JSON.stringify({
      action: 'saveBatchAnalysisData',
      filename: filename,
      headers: headers,
      rows: rows,
      sourceFileBase64: sourceFileBase64,
      sourceFileMime: sourceFileMime
    });

    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: payload
    }).then(function () {
      toast('warning', 'Upload Sent', 'The server could not confirm this upload. Open the app through its Apps Script deployment to save reliably in shared Drive storage.');
      if (onDone) onDone(false);
    }).catch(function (e) {
      toast('error', 'Save Failed', (e && e.message) || 'Could not reach the server.');
      if (onDone) onDone(false);
    });
  }

  function setSaveButtonState_(state, percent) {
    // state: 'hidden' | 'ready' | 'saving' | 'saved'
    var btn = el('btn-save-batch-analysis-drive');
    if (!btn) return;
    var icon = btn.querySelector('.material-icons-round');
    var label = btn.querySelector('.save-btn-label');

    if (state === 'hidden') {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'inline-flex';
    if (state === 'saving') {
      btn.disabled = true;
      if (icon) icon.textContent = 'sync';
      if (label) label.textContent = (typeof percent === 'number') ? ('Saving… ' + percent + '%') : 'Saving…';
    } else if (state === 'saved') {
      btn.disabled = false;
      if (icon) icon.textContent = 'cloud_done';
      if (label) label.textContent = 'Saved — Save Again';
    } else {
      btn.disabled = false;
      if (icon) icon.textContent = 'cloud_upload';
      if (label) label.textContent = 'Save to Google Drive';
    }
  }

  function saveNow_() {
    if (saving) return;
    if (!currentHeaders.length || !currentData.length) {
      toast('error', 'Nothing to Save', 'Upload an Excel file first, then click Save to Google Drive.');
      return;
    }
    var filename = (pendingUpload && pendingUpload.filename) || 'Batch_Analysis.xlsx';
    var sourceFileBase64 = pendingUpload && pendingUpload.sourceFileBase64;
    var sourceFileMime = pendingUpload && pendingUpload.sourceFileMime;

    saving = true;
    setSaveButtonState_('saving', 0);

    if (canUseAppsScript_()) {
      // Large-file-safe path: stream the data up in small chunks instead of
      // one giant call, so it can't hang forever and shows real progress.
      runChunkedSave_(filename, currentHeaders, currentData, sourceFileBase64, sourceFileMime);
    } else {
      // No Apps Script bridge available (app opened outside its deployment) —
      // fall back to the old best-effort single-shot save.
      syncToCloud(filename, currentHeaders, currentData, sourceFileBase64, sourceFileMime, function (success) {
        saving = false;
        setSaveButtonState_(success ? 'saved' : 'ready');
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Chunked save — for very large workbooks (1 lakh+ rows). Converts each row
  // to a compact array (values only, no repeated header keys) and uploads it
  // in small pieces so no single network call is ever too big to complete.
  // ---------------------------------------------------------------------------
  function runChunkedSave_(filename, headers, rows, sourceFileBase64, sourceFileMime) {
    var compact = rows.map(function (row) {
      return headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    });
    var chunks = chunkArray_(compact, CHUNK_SIZE);
    var totalChunks = chunks.length;

    // Give the "begin" call a longer timeout since it also carries the
    // original workbook file (can be several MB even after compression).
    gasCall_('beginBatchAnalysisUpload', [filename, headers, sourceFileBase64, sourceFileMime], 120000)
      .then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'Could not start the save.');
        var uploadId = result.uploadId;
        return sendChunksSequentially_(uploadId, chunks, 0, totalChunks)
          .then(function () { return gasCall_('finalizeBatchAnalysisUpload', [uploadId, totalChunks], 90000); });
      })
      .then(function (result) {
        saving = false;
        if (result && result.success) {
          setSaveButtonState_('saved');
          toast('success', 'Saved to Drive', 'The Excel data is stored in shared Google Drive (' + result.count + ' rows) and is available to everyone.');
        } else {
          setSaveButtonState_('ready');
          toast('error', 'Save Failed', (result && result.error) || 'The Excel data could not be saved to Google Drive.');
        }
      })
      .catch(function (error) {
        saving = false;
        setSaveButtonState_('ready');
        var msg = (error && error.message) ? error.message : String(error || 'Unknown error');
        toast('error', 'Save Failed', msg + ' You can click "Save to Google Drive" again to retry.');
      });
  }

  function sendChunksSequentially_(uploadId, chunks, index, totalChunks) {
    if (index >= chunks.length) return Promise.resolve();
    setSaveButtonState_('saving', Math.round((index / totalChunks) * 100));
    return gasCall_('appendBatchAnalysisChunk', [uploadId, index, chunks[index]], 45000)
      .then(function (result) {
        if (!result || !result.success) {
          throw new Error((result && result.error) || ('Chunk ' + (index + 1) + ' of ' + totalChunks + ' failed to upload.'));
        }
        return sendChunksSequentially_(uploadId, chunks, index + 1, totalChunks);
      });
  }

  // ---------------------------------------------------------------------------
  // Fetch existing shared data from Drive on load
  // ---------------------------------------------------------------------------
  function applyCloudData_(result, emptyState) {
    if (result && result.success && Array.isArray(result.rows) && result.rows.length > 0) {
      currentHeaders = result.headers || [];
      currentData = result.rows;
      saveToStorage(result.filename || 'Batch_Analysis.xlsx', currentData, currentHeaders, result.uploadTime);
      updateFileStatusUI(result.filename || 'Batch_Analysis.xlsx', currentData.length, result.uploadTime || 'Cloud');
      applyFiltersAndRender();
      return;
    }

    if (result && !result.success) {
      showEmptyState(emptyState, 'error_outline', result.error || 'Could not load the shared Batch Analysis data.');
      return;
    }

    var loaded = loadFromStorage();
    if (!loaded) showEmptyState(emptyState, 'cloud_upload', 'No Batch Analysis data has been uploaded yet. Upload an Excel file above to get started.');
  }

  function showEmptyState(emptyState, icon, message) {
    if (!emptyState) return;
    emptyState.style.display = '';
    emptyState.innerHTML = '<span class="material-icons-round">' + icon + '</span><p>' + esc(message) + '</p>';
  }

  function fetchFromCloud() {
    var url = getGasUrl();
    var useAppsScript = canUseAppsScript_();
    var emptyState = el('batch-analysis-empty-state');

    if (!useAppsScript && !url) {
      loadFromStorage();
      return;
    }

    showEmptyState(emptyState, 'sync', 'Loading shared Batch Analysis data…');

    if (useAppsScript) {
      google.script.run
        .withSuccessHandler(function (result) { applyCloudData_(result, emptyState); })
        .withFailureHandler(function (error) {
          var loaded = loadFromStorage();
          if (!loaded) {
            var msg = (error && error.message) ? error.message : String(error || '');
            showEmptyState(emptyState, 'error_outline', 'Could not load the shared Batch Analysis data' + (msg ? ' — ' + msg : '') + '.');
          }
        })
        .getBatchAnalysisData();
      return;
    }

    var callbackName = 'fms_ba_fetch_' + Date.now();
    var script = document.createElement('script');
    script.src = url + '?action=getBatchAnalysisData&callback=' + callbackName + '&_=' + Date.now();

    window[callbackName] = function (result) {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
      applyCloudData_(result, emptyState);
    };

    script.onerror = function () {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
      var loaded = loadFromStorage();
      if (!loaded) showEmptyState(emptyState, 'error_outline', 'Could not load the shared Batch Analysis data.');
    };

    document.head.appendChild(script);
  }

  // Expose data globally for AI Bots (Bai.js / Trio.js), matching app convention
  if (!window.FMS) window.FMS = {};
  window.FMS.getBatchAnalysisData = function () {
    return { headers: currentHeaders, rows: currentData, totalRows: currentData.length };
  };

  // ---------------------------------------------------------------------------
  // UI Render & Stats
  // ---------------------------------------------------------------------------
  function updateFileStatusUI(filename, totalRows, uploadTime, hasPending) {
    var statusBar = el('batch-analysis-file-status-bar');
    var nameEl = el('batch-analysis-loaded-filename');
    var metaEl = el('batch-analysis-loaded-meta');

    if (statusBar) statusBar.style.display = 'flex';
    if (nameEl) nameEl.textContent = filename || 'Batch_Analysis.xlsx';
    if (metaEl) metaEl.textContent = totalRows + ' row' + (totalRows === 1 ? '' : 's') + ' · ' + uploadTime;
    setSaveButtonState_(hasPending ? 'ready' : 'hidden');
  }

  function resetUI() {
    var statusBar = el('batch-analysis-file-status-bar');
    if (statusBar) statusBar.style.display = 'none';
    pendingUpload = null;
    setSaveButtonState_('hidden');

    var tableWrap = el('batch-analysis-table-wrap');
    var footer = el('batch-analysis-footer');
    var tableEl = el('batch-analysis-table');
    var countBadge = el('batch-analysis-count-badge');
    var excelBtn = el('btn-download-batch-analysis-excel');
    var fileInput = el('batch-analysis-file-input');

    if (footer) footer.style.display = 'none';
    if (tableEl) tableEl.style.display = 'none';
    if (countBadge) countBadge.textContent = '— records';
    if (excelBtn) excelBtn.disabled = true;
    if (fileInput) fileInput.value = '';

    showEmptyState(el('batch-analysis-empty-state'), 'cloud_upload', 'No Batch Analysis data has been uploaded yet. Upload an Excel file above to get started.');
    if (tableWrap) { /* keep wrap visible so empty state shows */ }
  }

  function applyFiltersAndRender() {
    if (!currentData || currentData.length === 0) {
      resetUI();
      return;
    }

    var q = searchQuery.toLowerCase();
    filteredRows = currentData.filter(function (row) {
      if (!q) return true;
      return currentHeaders.some(function (h) { return String(row[h] == null ? '' : row[h]).toLowerCase().indexOf(q) !== -1; });
    });

    if (sortCol) {
      filteredRows.sort(function (a, b) {
        var av = String(a[sortCol] == null ? '' : a[sortCol]).toLowerCase();
        var bv = String(b[sortCol] == null ? '' : b[sortCol]).toLowerCase();
        var na = parseFloat(av), nb = parseFloat(bv);
        var isNum = !isNaN(na) && !isNaN(nb) && av !== '' && bv !== '';
        var cmp = isNum ? (na - nb) : av.localeCompare(bv);
        return sortAsc ? cmp : -cmp;
      });
    }

    currentPage = 1;
    renderTable();
  }

  function renderTable() {
    var emptyState = el('batch-analysis-empty-state');
    var tableWrap = el('batch-analysis-table-wrap');
    var footer = el('batch-analysis-footer');
    var thead = el('batch-analysis-thead');
    var tbody = el('batch-analysis-tbody');
    var tableEl = el('batch-analysis-table');
    var excelBtn = el('btn-download-batch-analysis-excel');

    if (!currentHeaders.length || filteredRows.length === 0) {
      showEmptyState(emptyState, 'search_off', 'No matching rows found.');
      if (tableEl) tableEl.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (excelBtn) excelBtn.disabled = true;
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableEl) tableEl.style.display = '';
    if (footer) footer.style.display = 'flex';
    if (excelBtn) excelBtn.disabled = false;

    var countBadge = el('batch-analysis-count-badge');
    if (countBadge) countBadge.textContent = filteredRows.length + ' record' + (filteredRows.length === 1 ? '' : 's');

    var headHtml = '<tr><th class="dt-th dt-th-num">#</th>';
    currentHeaders.forEach(function (h) {
      var isSorted = sortCol === h;
      var icon = isSorted ? (sortAsc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
      headHtml += '<th class="dt-th dt-th-sortable ' + (isSorted ? 'dt-th-sorted' : '') + '" data-header="' + esc(h) + '">' +
        '<span>' + esc(h) + '</span>' +
        '<span class="material-icons-round dt-sort-icon">' + icon + '</span>' +
        '</th>';
    });
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    thead.querySelectorAll('[data-header]').forEach(function (th) {
      th.addEventListener('click', function () {
        var h = th.getAttribute('data-header');
        if (sortCol === h) sortAsc = !sortAsc; else { sortCol = h; sortAsc = true; }
        applyFiltersAndRender();
      });
    });

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;

    var start = (currentPage - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    var pageSlice = filteredRows.slice(start, end);

    var bodyHtml = '';
    pageSlice.forEach(function (row, idx) {
      bodyHtml += '<tr class="' + ((start + idx) % 2 ? 'dt-tr-odd' : 'dt-tr-even') + '">';
      bodyHtml += '<td class="dt-td dt-td-num">' + (start + idx + 1) + '</td>';
      currentHeaders.forEach(function (h) {
        var val = String(row[h] == null ? '' : row[h]);
        if (searchQuery && val.toLowerCase().indexOf(searchQuery.toLowerCase()) !== -1) {
          var safeSearch = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          var marked = esc(val).replace(new RegExp('(' + safeSearch + ')', 'gi'), '<mark class="dt-highlight">$1</mark>');
          bodyHtml += '<td class="dt-td">' + marked + '</td>';
        } else {
          bodyHtml += '<td class="dt-td">' + esc(val) + '</td>';
        }
      });
      bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;

    var infoEl = el('batch-analysis-info');
    if (infoEl) {
      infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
        (currentData.length !== total ? ' (filtered from ' + currentData.length + ' total)' : '') + ' entries';
    }

    renderPagination(currentPage, totalPages);
  }

  function renderPagination(current, total) {
    var container = el('batch-analysis-pagination');
    if (!container) return;
    container.innerHTML = '';

    function mkBtn(label, page, disabled, active, isIcon) {
      var btn = document.createElement('button');
      btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
      btn.innerHTML = isIcon ? '<span class="material-icons-round">' + label + '</span>' : label;
      btn.disabled = disabled;
      if (!disabled) {
        btn.addEventListener('click', function () {
          currentPage = page;
          renderTable();
          var wrap = el('batch-analysis-table-wrap');
          if (wrap) wrap.scrollTop = 0;
        });
      }
      return btn;
    }

    container.appendChild(mkBtn('first_page', 1, current <= 1, false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1, false, true));

    for (var p = 1; p <= total; p++) {
      if (p === 1 || p === total || (p >= current - 2 && p <= current + 2)) {
        container.appendChild(mkBtn(p, p, false, p === current, false));
      }
    }

    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page', total, current >= total, false, true));
  }

  // ---------------------------------------------------------------------------
  // Export (Excel)
  // ---------------------------------------------------------------------------
  function exportExcel() {
    if (!filteredRows.length || !window.XLSX) {
      toast('error', 'Export Failed', 'No data available to export.');
      return;
    }

    var ws = window.XLSX.utils.json_to_sheet(filteredRows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Batch Analysis');

    var metaStr = localStorage.getItem(STORAGE_KEY_META);
    var filename = 'Batch_Analysis_Export.xlsx';
    if (metaStr) {
      try { filename = 'Export_' + JSON.parse(metaStr).filename; } catch (e) {}
    }

    window.XLSX.writeFile(wb, filename);
    toast('success', 'Downloaded', 'Batch Analysis data exported to ' + filename);
  }

  // ---------------------------------------------------------------------------
  // Event Wiring
  // ---------------------------------------------------------------------------
  function init() {
    if (initialized) return;
    initialized = true;

    var fileInput = el('batch-analysis-file-input');
    var dropzone = el('batch-analysis-dropzone');
    var reuploadBtn = el('btn-reupload-batch-analysis');
    var clearBtn = el('btn-clear-batch-analysis');
    var saveBtn = el('btn-save-batch-analysis-drive');
    var refreshBtn = el('btn-refresh-batch-analysis');
    var excelBtn = el('btn-download-batch-analysis-excel');

    if (dropzone && fileInput) dropzone.addEventListener('click', function () { fileInput.click(); });
    if (reuploadBtn && fileInput) reuploadBtn.addEventListener('click', function () { fileInput.click(); });
    if (saveBtn) saveBtn.addEventListener('click', saveNow_);
    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) processExcelFile(e.target.files[0]);
      });
    }

    if (dropzone) {
      dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
      dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('dragover'); });
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) processExcelFile(e.dataTransfer.files[0]);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!confirm('Are you sure you want to clear the shared Batch Analysis data? This removes it from Google Drive for everyone.')) return;
        clearStorage();
        if (canUseAppsScript_()) {
          google.script.run
            .withSuccessHandler(function () { toast('info', 'Cleared', 'Batch Analysis data removed from Google Drive.'); })
            .withFailureHandler(function (error) { toast('error', 'Clear Failed', (error && error.message) || 'Could not clear the shared data.'); })
            .clearBatchAnalysisData();
        } else {
          toast('info', 'Cleared Locally', 'Local data cleared. Open the app through its Apps Script deployment to clear the shared Drive copy too.');
        }
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', function () { fetchFromCloud(); });
    if (excelBtn) excelBtn.addEventListener('click', exportExcel);

    var searchInput = el('batch-analysis-search');
    var searchClear = el('batch-analysis-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchQuery = searchInput.value.trim();
        if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
        applyFiltersAndRender();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none';
        applyFiltersAndRender();
      });
    }

    var pageSizeSelect = el('batch-analysis-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(pageSizeSelect.value, 10) || 50;
        currentPage = 1;
        renderTable();
      });
    }

    // Load shared data as soon as the section can be shown, and also lazily
    // when the sidebar nav item is clicked (in case the page was hidden at
    // startup by a permissions check).
    var nav = document.querySelector('.nav-item[data-page="batch-analysis"]');
    if (nav) nav.addEventListener('click', function () { fetchFromCloud(); });

    fetchFromCloud();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());