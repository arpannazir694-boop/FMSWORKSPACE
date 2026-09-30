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
  var columnFilters = {}; // { headerName: filterString } — per-column filter row, same pattern used across the app
  var initialized = false;
  var saving = false;
  var isFetchingFromCloud = false;

  // Holds the most recently parsed (but not-yet-saved) file, so the
  // dedicated "Save to Google Drive" button can push it on demand.
  var pendingUpload = null; // { filename, sourceFileBase64, sourceFileMime }

  var CHUNK_SIZE = 6000; // rows per network call — bigger chunks = fewer round trips

  // The original workbook file used to be sent as ONE giant base64 string in
  // a single network call, which is exactly what caused "maximum file size"
  // errors on large Excel files. It's now split into pieces this size (in
  // base64 characters, ~1.5MB of real file data per piece) and streamed the
  // same way the row data already is.
  var SOURCE_CHUNK_SIZE = 2000000;

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

  // Same idea as chunkArray_ but for a plain string (the base64-encoded
  // source file). Safe to slice a base64 string anywhere since it's plain
  // ASCII and gets rejoined in the same order before decoding.
  function chunkString_(str, size) {
    var out = [];
    for (var i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
    return out;
  }

  // Maps each server action's positional args (used with google.script.run)
  // to the named JSON body fields doPost() expects, so the fetch fallback
  // can call the exact same chunked actions instead of the old blind
  // single-shot save.
  var ACTION_ARG_NAMES_ = {
    beginBatchAnalysisUpload: ['filename', 'headers', 'sourceFileMime'],
    appendBatchAnalysisChunk: ['uploadId', 'chunkIndex', 'rowsChunk'],
    appendBatchAnalysisSourceChunk: ['uploadId', 'chunkIndex', 'chunk'],
    finalizeBatchAnalysisUpload: ['uploadId', 'totalChunks', 'totalSourceChunks'],
    getBatchAnalysisSourceFileBase64: ['fileId'],
    getBatchAnalysisData: ['page', 'pageSize'],
    syncBatchAnalysisFromDriveFolder: ['page', 'pageSize']
  };

  // Real fetch-based call to the Apps Script Web App (used when this page is
  // NOT loaded through google.script.run, e.g. an externally-hosted frontend
  // calling the GAS_URL backend). Deliberately does NOT use mode:'no-cors' —
  // no-cors returns an opaque response the browser can't read, so the old
  // code always resolved success regardless of whether the server actually
  // saved anything. This reads and parses the real JSON response instead.
  function gasFetchCall_(fnName, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var url = getGasUrl();
      if (!url) { reject(new Error('Google Apps Script connection (GAS_URL) was not found. Open the app through its published Apps Script deployment URL.')); return; }

      var argNames = ACTION_ARG_NAMES_[fnName] || [];
      var payload = { action: fnName };
      for (var i = 0; i < argNames.length; i++) payload[argNames[i]] = args[i];

      var settled = false;
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (controller) controller.abort();
        reject(new Error('The request took too long and timed out. Please check your connection and try saving again.'));
      }, timeoutMs || 45000);

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // avoids a CORS preflight
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) { return res.text(); })
        .then(function (text) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('Could not read the server response — the save may not have completed.'));
          }
        })
        .catch(function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // Transport-agnostic call: uses the fast google.script.run bridge when the
  // page is loaded inside Apps Script's own HtmlService context, otherwise
  // falls back to a real (readable) fetch call — both go through the exact
  // same chunked begin/append/finalize actions, so large-file saves are
  // equally safe and equally verified either way.
  function serverCall_(fnName, args, timeoutMs) {
    return canUseAppsScript_() ? gasCall_(fnName, args, timeoutMs) : gasFetchCall_(fnName, args, timeoutMs);
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
        columnFilters = {};
        buildTableHead_();
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
    columnFilters = {};
    resetUI();
  }

  // ---------------------------------------------------------------------------
  // Excel File Reader via SheetJS (xlsx)
  // ---------------------------------------------------------------------------
  function processExcelFile(file) {
    if (!file) return;

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
        columnFilters = {};
        buildTableHead_();

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
  // Cloud Sync — saving now always goes through runChunkedSave_() below,
  // which is transport-agnostic (google.script.run or a real fetch call)
  // and always verifies the server's actual response before reporting
  // success. The old syncToCloud()/no-cors single-shot save was removed:
  // no-cors made the fetch always resolve "successfully" even when the
  // server-side save silently failed or never completed on large files.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Save to Google Drive Password Protection
  // Required Password: "Arpan@4523"
  // ---------------------------------------------------------------------------
  var DRIVE_SAVE_PASSWORD = 'Arpan@4523';

  function openPasswordModal_() {
    if (saving) return;
    if (!currentHeaders.length || !currentData.length) {
      toast('error', 'Nothing to Save', 'Upload an Excel file first, then click Save to Google Drive.');
      return;
    }

    var modal = el('ba-password-modal');
    var input = el('ba-password-input');
    var wrap = el('ba-password-input-wrap');
    var errorEl = el('ba-password-error');

    if (!modal) {
      saveNow_();
      return;
    }

    if (input) {
      input.value = '';
      input.type = 'password';
    }
    var toggleIcon = el('ba-toggle-pw-icon');
    if (toggleIcon) toggleIcon.textContent = 'visibility';

    if (wrap) wrap.classList.remove('is-invalid');
    if (errorEl) errorEl.style.display = 'none';

    modal.style.display = 'flex';
    if (input) setTimeout(function () { input.focus(); }, 100);
  }

  function closePasswordModal_() {
    var modal = el('ba-password-modal');
    if (modal) modal.style.display = 'none';
    var input = el('ba-password-input');
    if (input) input.value = '';
  }

  function verifyAndSave_() {
    var input = el('ba-password-input');
    var wrap = el('ba-password-input-wrap');
    var errorEl = el('ba-password-error');

    var val = (input && input.value) ? input.value : '';

    if (val === DRIVE_SAVE_PASSWORD) {
      closePasswordModal_();
      saveNow_();
    } else {
      if (wrap) {
        wrap.classList.remove('is-invalid');
        void wrap.offsetWidth; // trigger reflow for shake animation
        wrap.classList.add('is-invalid');
      }
      if (errorEl) errorEl.style.display = 'flex';
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  function initPasswordModal_() {
    var modal = el('ba-password-modal');
    var closeBtn = el('ba-password-modal-close');
    var cancelBtn = el('ba-password-cancel-btn');
    var submitBtn = el('ba-password-submit-btn');
    var togglePwBtn = el('ba-toggle-pw-btn');
    var input = el('ba-password-input');

    if (closeBtn) closeBtn.addEventListener('click', closePasswordModal_);
    if (cancelBtn) cancelBtn.addEventListener('click', closePasswordModal_);
    if (submitBtn) submitBtn.addEventListener('click', verifyAndSave_);

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closePasswordModal_();
      });
    }

    if (togglePwBtn && input) {
      togglePwBtn.addEventListener('click', function () {
        var isPw = input.type === 'password';
        input.type = isPw ? 'text' : 'password';
        var icon = el('ba-toggle-pw-icon');
        if (icon) icon.textContent = isPw ? 'visibility_off' : 'visibility';
      });
    }

    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          verifyAndSave_();
        } else if (e.key === 'Escape') {
          closePasswordModal_();
        }
      });
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

    // Always use the chunked, verified save path — whether the fast
    // google.script.run bridge is available or we have to fall back to a
    // real (non-no-cors) fetch call. The old single-shot syncToCloud() path
    // is no longer used for saving: with fetch's mode:'no-cors' it always
    // reported "Saved" even when the server-side save silently failed,
    // which is exactly the bug being fixed here.
    runChunkedSave_(filename, currentHeaders, currentData, sourceFileBase64, sourceFileMime);
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

    // The original workbook file is now split into small base64 pieces too
    // (same reasoning as the row data above) instead of being sent whole in
    // the "begin" call — that single huge string was the actual cause of
    // "maximum file size" failures on big Excel files.
    var sourceChunks = sourceFileBase64 ? chunkString_(sourceFileBase64, SOURCE_CHUNK_SIZE) : [];
    var totalSourceChunks = sourceChunks.length;
    var totalOps = totalChunks + totalSourceChunks;
    var completedOps = 0;
    function bumpProgress_() {
      completedOps++;
      setSaveButtonState_('saving', totalOps ? Math.round((completedOps / totalOps) * 100) : 0);
    }

    serverCall_('beginBatchAnalysisUpload', [filename, headers, sourceFileMime], 60000)
      .then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'Could not start the save.');
        var uploadId = result.uploadId;
        return Promise.all([
          sendChunksConcurrently_(uploadId, chunks, totalChunks, bumpProgress_),
          sendSourceChunksConcurrently_(uploadId, sourceChunks, totalSourceChunks, bumpProgress_)
        ]).then(function () {
          return serverCall_('finalizeBatchAnalysisUpload', [uploadId, totalChunks, totalSourceChunks], 240000);
        });
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

  // Sends multiple chunks in parallel (bounded concurrency) instead of one
  // at a time. Each chunk writes to its own uniquely-named file, so there's
  // no ordering dependency between chunks — finalize re-sorts them by name
  // regardless of arrival order. This is the main fix for slow large-file
  // uploads: with CONCURRENCY=6, ~6x fewer round-trip waits than sequential.
  var CHUNK_UPLOAD_CONCURRENCY = 6;
  var SOURCE_CHUNK_UPLOAD_CONCURRENCY = 4;

  function sendChunksConcurrently_(uploadId, chunks, totalChunks, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!chunks.length) { resolve(); return; }
      var nextIndex = 0;
      var completed = 0;
      var failed = false;

      function launchNext() {
        if (failed) return;
        if (nextIndex >= chunks.length) return;
        var index = nextIndex++;
        serverCall_('appendBatchAnalysisChunk', [uploadId, index, chunks[index]], 60000)
          .then(function (result) {
            if (failed) return;
            if (!result || !result.success) {
              failed = true;
              reject(new Error((result && result.error) || ('Chunk ' + (index + 1) + ' of ' + totalChunks + ' failed to upload.')));
              return;
            }
            completed++;
            if (onProgress) onProgress();
            if (completed >= chunks.length) {
              resolve();
            } else {
              launchNext();
            }
          })
          .catch(function (err) {
            if (failed) return;
            failed = true;
            reject(err);
          });
      }

      var starters = Math.min(CHUNK_UPLOAD_CONCURRENCY, chunks.length);
      for (var i = 0; i < starters; i++) launchNext();
    });
  }

  // Same pattern as sendChunksConcurrently_ above, but for the original
  // workbook file's base64 pieces instead of row data. Runs alongside the
  // row-data upload (both share the same upload session) so saving a large
  // file isn't slower than before — it's just no longer sent as one string
  // big enough to trip "maximum file size" errors.
  function sendSourceChunksConcurrently_(uploadId, chunks, totalChunks, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!chunks.length) { resolve(); return; }
      var nextIndex = 0;
      var completed = 0;
      var failed = false;

      function launchNext() {
        if (failed) return;
        if (nextIndex >= chunks.length) return;
        var index = nextIndex++;
        serverCall_('appendBatchAnalysisSourceChunk', [uploadId, index, chunks[index]], 60000)
          .then(function (result) {
            if (failed) return;
            if (!result || !result.success) {
              failed = true;
              reject(new Error((result && result.error) || ('Source file part ' + (index + 1) + ' of ' + totalChunks + ' failed to upload.')));
              return;
            }
            completed++;
            if (onProgress) onProgress();
            if (completed >= chunks.length) {
              resolve();
            } else {
              launchNext();
            }
          })
          .catch(function (err) {
            if (failed) return;
            failed = true;
            reject(err);
          });
      }

      var starters = Math.min(SOURCE_CHUNK_UPLOAD_CONCURRENCY, chunks.length);
      for (var i = 0; i < starters; i++) launchNext();
    });
  }

  // ---------------------------------------------------------------------------
  // Fetch existing shared data from Drive on load & auto-refresh
  // ---------------------------------------------------------------------------
  function applyCloudData_(result, emptyState, isSilent) {
    if (result && result.success && result.needsClientConversion) {
      if (!isSilent) {
        showEmptyState(emptyState, 'sync', 'Processing 4.7 lakh+ row Excel file from Drive…');
      }
      processDriveExcelFileClientSide_(result.fileId, result.filename, result.sourceFileMime, result.base64, emptyState, isSilent);
      return;
    }

    if (result && result.success && Array.isArray(result.rows) && result.rows.length > 0) {
      var isFirstChunk = (!result.page || result.page === 1);
      if (isFirstChunk) {
        currentHeaders = result.headers || [];
        currentData = result.rows;
        if (!isSilent) {
          columnFilters = {};
        }
        buildTableHead_();
      } else {
        currentData = currentData.concat(result.rows);
      }

      var totalRows = result.totalRows || currentData.length;
      var isComplete = !result.hasMore || currentData.length >= totalRows;

      if (isComplete) {
        isFetchingFromCloud = false;
        saveToStorage(result.filename || 'Batch_Analysis.xlsx', currentData, currentHeaders, result.uploadTime);
        updateFileStatusUI(result.filename || 'Batch_Analysis.xlsx', currentData.length, result.uploadTime || 'Cloud');
        applyFiltersAndRender();
      } else {
        var statusLabel = currentData.length.toLocaleString() + ' / ' + totalRows.toLocaleString() + ' rows (Loading in parts...)';
        updateFileStatusUI(result.filename || 'Batch_Analysis.xlsx', statusLabel, result.uploadTime || 'Cloud');
        applyFiltersAndRender();
        fetchNextChunk_(result.page + 1, result.pageSize || 2000, result.filename, result.uploadTime, emptyState, isSilent);
      }
      return;
    }

    isFetchingFromCloud = false;
    if (isSilent) return; // Silent refresh ignores empty/error responses

    if (result && !result.success) {
      showEmptyState(emptyState, 'error_outline', result.error || 'Could not load the shared Batch Analysis data.');
      return;
    }

    var loaded = loadFromStorage();
    if (!loaded) showEmptyState(emptyState, 'cloud_upload', 'No Excel file found yet. Click above to open the shared Drive folder and drop your file in.');
  }

  function processDriveExcelFileClientSide_(fileId, filename, sourceMime, base64Data, emptyState, isSilent) {
    var XLSXLib = window.XLSX;
    if (!XLSXLib) {
      if (!isSilent) showEmptyState(emptyState, 'error_outline', 'SheetJS library missing.');
      return;
    }

    try {
      if (!base64Data) throw new Error('No Excel file data received from Drive.');

      var workbook = XLSXLib.read(base64Data, { type: 'base64' });
      if (!workbook.SheetNames.length) throw new Error('Excel file contains no worksheets.');

      var firstSheetName = workbook.SheetNames[0];
      var worksheet = workbook.Sheets[firstSheetName];
      var jsonRows = XLSXLib.utils.sheet_to_json(worksheet, { defval: '' });

      if (!jsonRows || jsonRows.length === 0) throw new Error('No data rows found in sheet "' + firstSheetName + '".');

      var headerMap = {};
      jsonRows.forEach(function (row) { Object.keys(row).forEach(function (k) { headerMap[k] = true; }); });
      currentHeaders = Object.keys(headerMap);
      currentData = jsonRows;
      columnFilters = {};
      buildTableHead_();

      var uploadTime = new Date().toLocaleString();
      saveToStorage(filename, currentData, currentHeaders, uploadTime);
      updateFileStatusUI(filename, currentData.length, uploadTime);
      applyFiltersAndRender();

      runChunkedSave_(filename, currentHeaders, currentData, base64Data, sourceMime);
      isFetchingFromCloud = false;
    } catch (err) {
      isFetchingFromCloud = false;
      if (!isSilent) {
        showEmptyState(emptyState, 'error_outline', 'Could not process Excel file — ' + (err.message || String(err)));
      }
    }
  }

  function fetchNextChunk_(nextPage, pageSize, filename, uploadTime, emptyState, isSilent) {
    var url = getGasUrl();
    var useAppsScript = canUseAppsScript_();

    if (useAppsScript) {
      google.script.run
        .withSuccessHandler(function (result) { applyCloudData_(result, emptyState, isSilent); })
        .withFailureHandler(function () {
          isFetchingFromCloud = false;
          saveToStorage(filename || 'Batch_Analysis.xlsx', currentData, currentHeaders, uploadTime);
          updateFileStatusUI(filename || 'Batch_Analysis.xlsx', currentData.length, uploadTime || 'Cloud');
          applyFiltersAndRender();
        })
        .getBatchAnalysisData(nextPage, pageSize);
      return;
    }

    var callbackName = 'fms_ba_chunk_' + nextPage + '_' + Date.now();
    var script = document.createElement('script');
    script.src = url + '?action=getBatchAnalysisData&page=' + nextPage + '&pageSize=' + pageSize + '&callback=' + callbackName + '&_=' + Date.now();

    window[callbackName] = function (result) {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
      applyCloudData_(result, emptyState, isSilent);
    };

    script.onerror = function () {
      isFetchingFromCloud = false;
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
      saveToStorage(filename || 'Batch_Analysis.xlsx', currentData, currentHeaders, uploadTime);
      updateFileStatusUI(filename || 'Batch_Analysis.xlsx', currentData.length, uploadTime || 'Cloud');
      applyFiltersAndRender();
    };

    document.head.appendChild(script);
  }

  function showEmptyState(emptyState, icon, message) {
    if (!emptyState) return;
    emptyState.style.display = '';
    var cleanMsg = esc(message || '').replace(/[\.…]+$/, '');
    if (icon === 'sync') {
      emptyState.innerHTML =
        '<div class="ba-loader-box">' +
          '<div class="ba-loader-ring">' +
            '<div class="ba-loader-icon-wrap">' +
              '<span class="material-icons-round ba-loader-spin-icon">sync</span>' +
            '</div>' +
          '</div>' +
          '<div class="ba-loader-text-wrap">' +
            '<p class="ba-loader-msg">' + cleanMsg + '</p>' +
            '<div class="ba-loader-dots"><span></span><span></span><span></span></div>' +
          '</div>' +
        '</div>';
    } else {
      emptyState.innerHTML =
        '<div class="ba-empty-box">' +
          '<div class="ba-empty-icon-wrap">' +
            '<span class="material-icons-round">' + (icon || 'info') + '</span>' +
          '</div>' +
          '<p class="ba-empty-msg">' + esc(message || '') + '</p>' +
          '</div>';
    }
  }

  function fetchFromCloud(isSilent) {
    if (isSilent && saving) return;              // Skip during active file upload
    if (isFetchingFromCloud && isSilent) return; // Skip duplicate silent fetch if already running

    var url = getGasUrl();
    var useAppsScript = canUseAppsScript_();
    var emptyState = el('batch-analysis-empty-state');

    if (!useAppsScript && !url) {
      if (!isSilent) loadFromStorage();
      return;
    }

    isFetchingFromCloud = true;

    if (!isSilent) {
      showEmptyState(emptyState, 'sync', 'Loading shared Batch Analysis data…');
    }

    if (useAppsScript) {
      google.script.run
        .withSuccessHandler(function (result) { applyCloudData_(result, emptyState, isSilent); })
        .withFailureHandler(function (error) {
          isFetchingFromCloud = false;
          if (isSilent) return;
          var loaded = loadFromStorage();
          if (!loaded) {
            var msg = (error && error.message) ? error.message : String(error || '');
            showEmptyState(emptyState, 'error_outline', 'Could not load the shared Batch Analysis data' + (msg ? ' — ' + msg : '') + '.');
          }
        })
        .syncBatchAnalysisFromDriveFolder(1, 2000);
      return;
    }

    var callbackName = 'fms_ba_fetch_' + Date.now();
    var script = document.createElement('script');
    script.src = url + '?action=syncBatchAnalysisFromDriveFolder&page=1&pageSize=2000&callback=' + callbackName + '&_=' + Date.now();

    window[callbackName] = function (result) {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
      applyCloudData_(result, emptyState, isSilent);
    };

    script.onerror = function () {
      isFetchingFromCloud = false;
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
      if (!isSilent) {
        var loaded = loadFromStorage();
        if (!loaded) showEmptyState(emptyState, 'error_outline', 'Could not load the shared Batch Analysis data.');
      }
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
    var filterKeys = Object.keys(columnFilters).filter(function (h) { return (columnFilters[h] || '').trim() !== ''; });

    filteredRows = currentData.filter(function (row) {
      if (q) {
        var rowMatch = currentHeaders.some(function (h) { return String(row[h] == null ? '' : row[h]).toLowerCase().indexOf(q) !== -1; });
        if (!rowMatch) return false;
      }
      for (var k = 0; k < filterKeys.length; k++) {
        var h = filterKeys[k];
        var f = columnFilters[h].trim().toLowerCase();
        var cellVal = String(row[h] == null ? '' : row[h]).toLowerCase();
        if (cellVal.indexOf(f) === -1) return false;
      }
      return true;
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

  // ---------------------------------------------------------------------------
  // Table header — built ONCE per dataset load (and on sort-click), separate
  // from renderTable() which only touches tbody/pagination. If the header
  // (with its per-column filter inputs) were rebuilt on every keystroke, the
  // filter input would lose focus after each character typed.
  // ---------------------------------------------------------------------------
  function buildTableHead_() {
    var thead = el('batch-analysis-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Sortable column-label row
    var trHead = document.createElement('tr');
    var thNum = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);

    currentHeaders.forEach(function (h) {
      var isSorted = sortCol === h;
      var th = document.createElement('th');
      th.className = 'dt-th dt-th-sortable' + (isSorted ? ' dt-th-sorted' : '');
      th.setAttribute('data-header', h);
      th.innerHTML = '<span>' + esc(h) + '</span>' +
        '<span class="material-icons-round dt-sort-icon">' + (isSorted ? (sortAsc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more') + '</span>';
      th.addEventListener('click', function () {
        if (sortCol === h) sortAsc = !sortAsc; else { sortCol = h; sortAsc = true; }
        buildTableHead_();
        applyFiltersAndRender();
      });
      trHead.appendChild(th);
    });

    // Per-column filter row — same markup/classes used for filters elsewhere
    // in the app (dt-filter-row / dt-filter-cell / dt-col-filter).
    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    currentHeaders.forEach(function (h) {
      var th = document.createElement('th');
      th.className = 'dt-filter-cell';
      var wrap = document.createElement('div');
      wrap.className = 'dt-col-filter-wrap';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'dt-col-filter';
      input.placeholder = 'Filter…';
      input.value = columnFilters[h] || '';
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'dt-col-filter-clear';
      clearBtn.title = 'Clear filter';
      clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
      clearBtn.style.display = input.value ? '' : 'none';
      input.addEventListener('input', function () {
        columnFilters[h] = input.value;
        clearBtn.style.display = input.value ? '' : 'none';
        applyFiltersAndRender();
      });
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        input.value = '';
        columnFilters[h] = '';
        clearBtn.style.display = 'none';
        applyFiltersAndRender();
        input.focus();
      });
      wrap.appendChild(input);
      wrap.appendChild(clearBtn);
      th.appendChild(wrap);
      trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
  }

  function renderTable() {
    var emptyState = el('batch-analysis-empty-state');
    var tableWrap = el('batch-analysis-table-wrap');
    var footer = el('batch-analysis-footer');
    var tbody = el('batch-analysis-tbody');
    var tableEl = el('batch-analysis-table');
    var excelBtn = el('btn-download-batch-analysis-excel');

    if (!currentHeaders.length || filteredRows.length === 0) {
      var hasActiveFilter = searchQuery || Object.keys(columnFilters).some(function (h) { return (columnFilters[h] || '').trim() !== ''; });
      showEmptyState(emptyState, 'search_off', hasActiveFilter ? 'No records match the current search/filter.' : 'No matching rows found.');
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
    var openDriveFolderZone = el('batch-analysis-open-drive-folder');
    var reuploadBtn = el('btn-reupload-batch-analysis');
    var clearBtn = el('btn-clear-batch-analysis');
    var saveBtn = el('btn-save-batch-analysis-drive');
    var refreshBtn = el('btn-refresh-batch-analysis');
    var excelBtn = el('btn-download-batch-analysis-excel');

    if (dropzone && fileInput) dropzone.addEventListener('click', function () { fileInput.click(); });
    if (openDriveFolderZone) {
      openDriveFolderZone.addEventListener('click', function () {
        openDriveFolderZone.style.opacity = '0.6';
        serverCall_('getBatchAnalysisDriveFolderUrl', [])
          .then(function (result) {
            openDriveFolderZone.style.opacity = '';
            if (result && result.success && result.url) {
              window.open(result.url, '_blank');
            } else {
              toast('error', 'Could Not Open Folder', (result && result.error) || 'Could not get the shared Drive folder link.');
            }
          })
          .catch(function (error) {
            openDriveFolderZone.style.opacity = '';
            toast('error', 'Could Not Open Folder', (error && error.message) || 'Could not get the shared Drive folder link.');
          });
      });
    }
    if (reuploadBtn && fileInput) reuploadBtn.addEventListener('click', function () { fileInput.click(); });
    if (saveBtn) saveBtn.addEventListener('click', openPasswordModal_);
    initPasswordModal_();
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

    if (refreshBtn) refreshBtn.addEventListener('click', function () { isFetchingFromCloud = false; fetchFromCloud(false); });
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

    // Load locally stored cache immediately so table isn't blank on startup
    loadFromStorage();

    // Attach sidebar nav click handler — if data is already loaded or actively
    // fetching in background, avoid resetting UI or restarting from chunk 1.
    var nav = document.querySelector('.nav-item[data-page="batch-analysis"]');
    if (nav) {
      nav.addEventListener('click', function () {
        if (currentData.length > 0 || isFetchingFromCloud) return;
        fetchFromCloud(false);
      });
    }

    // Start silent background fetch immediately on app startup / login
    fetchFromCloud(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
