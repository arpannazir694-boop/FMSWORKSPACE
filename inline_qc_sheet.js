/**
 * =============================================================================
 * In-Line QC Live Engine (IndexedDB + Google Sheets GVIZ CSV + PDF Generator)
 * =============================================================================
 * Sheet: PLANNED DATE (Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E)
 * GID: 1364433470
 * Range: A1:X (Columns A-R [0..17] + Columns V-X [21..23] = 21 Columns)
 * Row 1: Header Row
 * Database: IndexedDB 'FMS_In_Line_QC_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser from Google Sheet
 *   - Full client-side Search across all 21 columns with match highlighting
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Dual PDF Generation:
 *       1. Row-Level: In-Line QC Inspection Report (Single-page print/PDF checklist with SKU)
 *       2. Table-Level: Full landscape PDF export of filtered table records
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page) with numbered page pills
 *   - Zero-radius geometry throughout
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '1364433470';
  // Primary export endpoint fetches all underlying rows bypassing active Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:X';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:X';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_In_Line_QC_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'inline_qc_store';
  var NUM_COLS = 21;

  var defaultHeaders = [
    'FMS UPLOAD TIMESTAMP',
    'BACTCH NO.',
    'LEATHER RECEIVED DATE',
    'CREATOR (DOER)',
    'UNIT',
    'FABRICATOR NAME (NO)',
    'BRAND',
    'SEASON',
    'CATEGORY',
    'SKU',
    'Style',
    'COLOUR',
    'QTY',
    'ETD',
    'PO',
    'FLOOR SUPERVISOR NAME',
    'INLINE QC NAME',
    'PRODUCTION DAYS',
    'IN-LINE QC - 1ST FOLLOW UP PLANNED',
    'IN-LINE QC - 2ND FOLLOW UP PLANNED',
    'IN-LINE QC - 3RD FOLLOW UP PLANNED'
  ];

  var IQC_CHECKLIST = [
    {
      title: '1ST FOLLOW UP',
      items: [
        'PP SAMPLE & YELLOW SEAL SAMPLE AVAILABLE',
        'CHELA SAMPLE',
        'LEATHER COLOUR (25%)',
        'LEATHER QUALITY (25%)',
        'GRAIN MATCHING (25%)',
        'LINING TYPE (10%)',
        'HARDWARE CHECKING (WITH COLOUR ) (10%)',
        'WEBBING CHECKING (10%)'
      ]
    },
    {
      title: '2ND FOLLOW UP',
      items: [
        'LINING ATTACHMENT (10%)',
        'EMBOSSING AS PER MRS/BRANDING',
        'SEW IN LABEL ATTACHMENT (5%)',
        'SCREEN PRINTING /IF ANY (25%)',
        'ASSAMBLE OF LEATHER COMPONENT (25%)',
        'STITCHING LENGTH (SPI) AS REUQUIRED BY BUYER (10%)',
        'PANEL /IF ANY REQUIRED (25%)',
        'PANEL JOINT THICKNESS (25%)',
        'PANEL ATTACHMENT (25%)',
        'GRAB HANDLE (25%)',
        'ATTACHMENT OF REINFORCEMENT (25%)',
        'IF ANY BINDING & PIPING ATTACHMENT (10%)',
        'LOOP ATTACHMENT (25%)',
        'SCREW FIXING (LOCKTITE) (100%)',
        'DECORATIVE STITCH /IF ANY (25%)'
      ]
    },
    {
      title: '3RD FOLLOW UP',
      items: [
        'FINAL STITCHING (25%)',
        'PULLER ATTACHMENT (5%)',
        'FINAL ASSEMBLE (25%)',
        'THREAD TRIMMING (10%)',
        'SHAPE (25%)',
        'EDGE PAINT QUALITY (25%)',
        'CLEANING (25%)',
        'WIP AQL (20%)'
      ]
    }
  ];

  // Engine state
  var allHeaders = defaultHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var sortColumn = -1;
  var sortAsc = true;
  var searchQuery = '';
  var activeFilters = {}; // colIdx -> Set of checked values
  var isSyncing = false;
  var selectedCell = null; // { r: pageRelativeRow, c: colIdx, el: td }
  var lastSyncTime = null;

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Helper Functions
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported in this browser'));
        return;
      }
      var req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function saveToIndexedDB(data) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put(data.headers, 'iqc_headers');
        store.put(data.rows, 'iqc_rows');
        store.put(data.syncTime || Date.now(), 'iqc_last_sync');
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadFromIndexedDB() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var reqRows = store.get('iqc_rows');
        var reqHeaders = store.get('iqc_headers');
        var reqSync = store.get('iqc_last_sync');

        tx.oncomplete = function () {
          if (reqRows.result && Array.isArray(reqRows.result) && reqRows.result.length > 0) {
            resolve({
              headers: reqHeaders.result || defaultHeaders,
              rows: reqRows.result,
              syncTime: reqSync.result || null
            });
          } else {
            resolve(null);
          }
        };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (A-R [0..17] + V-X [21..23] = 21 Cols)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;

    for (var i = 0; i < len; i++) {
      var c = csvText[i];
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < len && csvText[i + 1] === '"') { curVal += '"'; i++; }
          else { inQuotes = false; }
        } else { curVal += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { curRow.push(curVal.trim()); curVal = ''; }
        else if (c === '\r') {
          if (i + 1 < len && csvText[i + 1] === '\n') i++;
          curRow.push(curVal.trim()); curVal = '';
          processParsedRow();
        } else if (c === '\n') { curRow.push(curVal.trim()); curVal = ''; processParsedRow(); }
        else { curVal += c; }
      }
    }
    if (curVal || curRow.length) { curRow.push(curVal.trim()); processParsedRow(); }

    function processParsedRow() {
      if (isFirstRow) {
        if (curRow.length > 0 && curRow.some(function (h) { return h.length > 0; })) {
          var parsed = [];
          for (var h = 0; h < 18; h++) {
            parsed.push((curRow[h] && curRow[h].trim()) || defaultHeaders[h] || ('Col ' + (h + 1)));
          }
          parsed.push('IN-LINE QC - 1ST FOLLOW UP PLANNED');
          parsed.push('IN-LINE QC - 2ND FOLLOW UP PLANNED');
          parsed.push('IN-LINE QC - 3RD FOLLOW UP PLANNED');
          allHeaders = parsed;
        }
        isFirstRow = false;
      } else {
        var hasContent = curRow.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
        if (!hasContent) { curRow = []; return; }
        var normalized = new Array(NUM_COLS);
        // A to R (0 to 17)
        for (var j = 0; j < 18; j++) {
          normalized[j] = (curRow[j] !== undefined && curRow[j] !== null) ? curRow[j] : '';
        }
        // V to X (21 to 23)
        normalized[18] = (curRow[21] !== undefined && curRow[21] !== null) ? curRow[21] : '';
        normalized[19] = (curRow[22] !== undefined && curRow[22] !== null) ? curRow[22] : '';
        normalized[20] = (curRow[23] !== undefined && curRow[23] !== null) ? curRow[23] : '';
        rows.push(normalized);
      }
      curRow = [];
    }

    return { headers: allHeaders, rows: rows };
  }

  // ---------------------------------------------------------------------------
  // 3. Network Fetcher (Primary Export to bypass UI filters, with GViz fallback)
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetCSV() {
    var ts = Date.now();
    var primaryUrl = PRIMARY_CSV_URL + '&_=' + ts;
    return fetch(primaryUrl, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching In-Line QC Export CSV');
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) throw new Error('Primary payload empty');
        return csvText;
      })
      .catch(function (err) {
        console.warn('Primary export CSV fetch failed, trying GViz fallback...', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
          .then(function (fallbackRes) {
            if (!fallbackRes.ok) throw new Error('Fallback HTTP ' + fallbackRes.status);
            return fallbackRes.text();
          });
      })
      .then(function (validCsv) { return parseCSVStream(validCsv); });
  }

  // ---------------------------------------------------------------------------
  // 4. UI Status Updates (Inline, Non-Blocking, No Full Spinner)
  // ---------------------------------------------------------------------------
  function updateSyncStatusUI(status, label) {
    var badge = document.getElementById('iqc-sheet-db-badge');
    var statusText = document.getElementById('iqc-sheet-sync-status');
    var syncBtn = document.getElementById('btn-sync-iqc-sheet');

    if (badge) {
      if (status === 'syncing') {
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
        badge.style.borderColor = '#fde68a';
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;animation:spin 1s linear infinite;">sync</span> Syncing...';
      } else if (status === 'ready') {
        badge.style.background = '#f3e8ff';
        badge.style.color = '#6b21a8';
        badge.style.borderColor = '#d8b4fe';
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#7c3aed;">bolt</span> Database Ready';
      } else if (status === 'error') {
        badge.style.background = '#fee2e2';
        badge.style.color = '#991b1b';
        badge.style.borderColor = '#fca5a5';
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#ef4444;">error_outline</span> Sync Error';
      }
    }

    if (statusText && label) {
      statusText.textContent = label;
    }

    if (syncBtn) {
      if (status === 'syncing') {
        syncBtn.classList.add('is-loading');
        syncBtn.setAttribute('disabled', 'disabled');
      } else {
        syncBtn.classList.remove('is-loading');
        syncBtn.removeAttribute('disabled');
      }
    }
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';
    var diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return Math.floor(diffSec / 60) + ' min ago';
    if (diffSec < 86400) return Math.floor(diffSec / 3600) + ' hr ago';
    return new Date(timestamp).toLocaleDateString('en-GB');
  }

  // ---------------------------------------------------------------------------
  // 5. Filtering & Sorting Engine
  // ---------------------------------------------------------------------------
  function applyFiltersAndSort() {
    var query = searchQuery.trim().toLowerCase();
    var hasActiveColFilters = Object.keys(activeFilters).length > 0;

    filteredRows = allRows.filter(function (row) {
      // 1. Text Search across all 21 columns
      if (query) {
        var matchSearch = row.some(function (val) {
          return val && String(val).toLowerCase().indexOf(query) !== -1;
        });
        if (!matchSearch) return false;
      }

      // 2. Parallel Column Filters
      if (hasActiveColFilters) {
        for (var colIdxStr in activeFilters) {
          var colIdx = parseInt(colIdxStr, 10);
          var allowedSet = activeFilters[colIdx];
          var rawVal = row[colIdx];
          var cellStr = (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') ? '(Blank)' : String(rawVal).trim();
          if (!allowedSet.has(cellStr)) {
            return false;
          }
        }
      }

      return true;
    });

    // 3. Sorting
    if (sortColumn >= 0 && sortColumn < NUM_COLS) {
      filteredRows.sort(function (a, b) {
        var valA = String(a[sortColumn] || '').trim();
        var valB = String(b[sortColumn] || '').trim();

        var numA = parseFloat(valA.replace(/,/g, ''));
        var numB = parseFloat(valB.replace(/,/g, ''));
        var isNum = !isNaN(numA) && !isNaN(numB) && !valA.includes('/') && !valA.includes('-');

        if (isNum) {
          return sortAsc ? (numA - numB) : (numB - numA);
        }

        var dateA = parseDateToTimestamp(valA);
        var dateB = parseDateToTimestamp(valB);
        if (dateA !== null && dateB !== null) {
          return sortAsc ? (dateA - dateB) : (dateB - dateA);
        }

        var cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return sortAsc ? cmp : -cmp;
      });
    }

    currentPage = 1;
    renderActiveFilterChips();
    renderTablePage();
    updatePaginationControls();
  }

  function parseDateToTimestamp(str) {
    if (!str || typeof str !== 'string') return null;
    var dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
      return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10)).getTime();
    }
    var ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymdMatch) {
      return new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10)).getTime();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 6. Active Filter Chips Bar
  // ---------------------------------------------------------------------------
  function renderActiveFilterChips() {
    var bar = document.getElementById('inline-qc-active-filters-bar');
    if (!bar) return;

    var filterKeys = Object.keys(activeFilters);
    if (filterKeys.length === 0 && !searchQuery) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    var html = '<span class="bai-chip-label">Active Filters:</span>';

    if (searchQuery) {
      html += '<span class="bai-filter-chip" data-chip="search">' +
        '<span>Search: "' + escapeHtml(searchQuery) + '"</span>' +
        '<button type="button" class="bai-chip-remove" data-remove-search="true" title="Remove search filter">&#x2715;</button>' +
        '</span>';
    }

    filterKeys.forEach(function (colIdxStr) {
      var colIdx = parseInt(colIdxStr, 10);
      var headerName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var count = activeFilters[colIdx].size;
      html += '<span class="bai-filter-chip" data-col="' + colIdx + '">' +
        '<span>' + escapeHtml(headerName) + ' (' + count + ' selected)</span>' +
        '<button type="button" class="bai-chip-remove" data-remove-col="' + colIdx + '" title="Remove filter">&#x2715;</button>' +
        '</span>';
    });

    html += '<button type="button" class="bai-chip-clear-all" id="btn-clear-all-iqc-filters">Clear All</button>';
    bar.innerHTML = html;

    var clearAllBtn = document.getElementById('btn-clear-all-iqc-filters');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        activeFilters = {};
        searchQuery = '';
        var searchInput = document.getElementById('inline-qc-search-input');
        if (searchInput) searchInput.value = '';
        applyFiltersAndSort();
        updateFilterIconsState();
      });
    }

    bar.querySelectorAll('[data-remove-search="true"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        searchQuery = '';
        var searchInput = document.getElementById('inline-qc-search-input');
        if (searchInput) searchInput.value = '';
        applyFiltersAndSort();
      });
    });

    bar.querySelectorAll('[data-remove-col]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var col = parseInt(btn.getAttribute('data-remove-col'), 10);
        delete activeFilters[col];
        applyFiltersAndSort();
        updateFilterIconsState();
      });
    });
  }

  function updateFilterIconsState() {
    var thead = document.getElementById('inline-qc-thead');
    if (!thead) return;
    thead.querySelectorAll('.bai-sheet-col-filter-btn').forEach(function (btn) {
      var col = parseInt(btn.getAttribute('data-col'), 10);
      var isFiltered = (activeFilters[col] && activeFilters[col].size > 0);
      var icon = btn.querySelector('.material-icons-round');
      if (isFiltered) {
        btn.classList.add('is-active', 'active');
        if (icon) icon.textContent = 'filter_alt';
      } else {
        btn.classList.remove('is-active', 'active');
        if (icon) icon.textContent = 'filter_list';
      }
    });
    thead.querySelectorAll('.bai-sheet-th-filterable').forEach(function (th) {
      var col = parseInt(th.getAttribute('data-col'), 10);
      if (activeFilters[col] && activeFilters[col].size > 0) {
        th.classList.add('has-active-filter');
      } else {
        th.classList.remove('has-active-filter');
      }
    });
  }

  function toggleColumnSort(colIdx) {
    if (sortColumn === colIdx) {
      if (sortAsc) {
        sortAsc = false;
      } else {
        sortColumn = -1;
        sortAsc = true;
      }
    } else {
      sortColumn = colIdx;
      sortAsc = true;
    }
    applyFiltersAndSort();
    renderTableHeaders();
  }

  // ---------------------------------------------------------------------------
  // 7. Table Header Rendering (Strict single-line horizontal alignment)
  // ---------------------------------------------------------------------------
  function renderTableHeaders() {
    var thead = document.getElementById('inline-qc-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var tr = document.createElement('tr');

    // 1. # Serial Column (Narrow compact width)
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th bai-sheet-th-index bai-th-row-num';
    thIndex.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;text-align:center!important;white-space:nowrap!important;padding:8px 2px!important;';
    thIndex.textContent = '#';
    tr.appendChild(thIndex);

    // 2. PDF File Action Column (Strict Center Aligned)
    var thPdf = document.createElement('th');
    thPdf.className = 'bai-sheet-th bai-sheet-th-action bai-th-pdf-action';
    thPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;white-space:nowrap!important;padding:8px 4px!important;';
    thPdf.textContent = 'PDF FILE';
    tr.appendChild(thPdf);

    // 3. 21 Data Columns
    for (var ci = 0; ci < NUM_COLS; ci++) {
      (function (colIdx) {
        var headerText = allHeaders[colIdx] || defaultHeaders[colIdx] || ('Column ' + (colIdx + 1));
        var th = document.createElement('th');
        th.className = 'bai-sheet-th bai-sheet-th-filterable';
        th.setAttribute('data-col', colIdx);
        th.style.cssText = 'white-space:nowrap!important;padding:8px 10px!important;vertical-align:middle!important;';
        if (activeFilters[colIdx] && activeFilters[colIdx].size > 0) {
          th.classList.add('has-active-filter');
        }

        var thInner = document.createElement('div');
        thInner.className = 'bai-sheet-th-content';
        thInner.style.cssText = 'display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;width:100%!important;flex-wrap:nowrap!important;white-space:nowrap!important;box-sizing:border-box!important;';

        var labelSpan = document.createElement('span');
        labelSpan.className = 'bai-sheet-th-title';
        labelSpan.title = headerText;
        labelSpan.textContent = headerText;
        labelSpan.style.cssText = 'flex:1 1 auto!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;cursor:pointer!important;user-select:none!important;font-size:11px!important;font-weight:700!important;';

        // Click label to sort
        labelSpan.addEventListener('click', function () {
          toggleColumnSort(colIdx);
        });

        var iconsWrap = document.createElement('div');
        iconsWrap.className = 'bai-sheet-th-icons';
        iconsWrap.style.cssText = 'display:inline-flex!important;flex-direction:row!important;align-items:center!important;gap:4px!important;flex-shrink:0!important;white-space:nowrap!important;';

        // Sort indicator icon
        var sortIcon = document.createElement('span');
        sortIcon.className = 'material-icons-round bai-sheet-sort-icon';
        sortIcon.style.cssText = 'cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:18px!important;height:18px!important;font-size:16px!important;line-height:1!important;user-select:none!important;flex-shrink:0!important;';
        if (sortColumn === colIdx) {
          sortIcon.textContent = sortAsc ? 'arrow_upward' : 'arrow_downward';
          sortIcon.style.opacity = '1';
          sortIcon.style.color = '#c48b16';
        } else {
          sortIcon.textContent = 'unfold_more';
          sortIcon.style.opacity = '0.45';
          sortIcon.style.color = '#94a3b8';
        }
        sortIcon.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleColumnSort(colIdx);
        });

        // Filter button (opens Google Sheets style popover)
        var isFiltered = (activeFilters[colIdx] && activeFilters[colIdx].size > 0);
        var filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        filterBtn.setAttribute('data-col', colIdx);
        filterBtn.className = 'bai-sheet-col-filter-btn' + (isFiltered ? ' active is-active' : '');
        filterBtn.title = 'Filter ' + headerText;
        filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (isFiltered ? 'filter_alt' : 'filter_list') + '</span>';
        filterBtn.style.cssText = 'display:inline-flex!important;align-items:center!important;justify-content:center!important;width:21px!important;height:21px!important;flex-shrink:0!important;padding:0!important;background:transparent!important;border:1px solid rgba(255,255,255,0.22)!important;color:#94a3b8!important;cursor:pointer!important;border-radius:0px!important;';
        if (isFiltered) {
          filterBtn.style.background = '#059669!important';
          filterBtn.style.color = '#ffffff!important';
          filterBtn.style.borderColor = '#34d399!important';
        }
        filterBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openColumnFilterPopover(colIdx, filterBtn);
        });

        iconsWrap.appendChild(sortIcon);
        iconsWrap.appendChild(filterBtn);

        thInner.appendChild(labelSpan);
        thInner.appendChild(iconsWrap);
        th.appendChild(thInner);
        tr.appendChild(th);
      })(ci);
    }

    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 8. Table Body Rendering with Cell Selection & Copy
  // ---------------------------------------------------------------------------
  function renderTablePage() {
    var tbody = document.getElementById('inline-qc-tbody');
    var emptyEl = document.getElementById('inline-qc-empty-state');
    var countEl = document.getElementById('inline-qc-record-count');
    var infoEl = document.getElementById('inline-qc-info');

    if (!tbody) return;

    var total = filteredRows.length;
    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (countEl) countEl.textContent = total.toLocaleString() + ' records';
    if (infoEl) {
      if (total === 0) {
        infoEl.textContent = 'Showing 0 of 0 entries';
      } else {
        infoEl.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' \u2013 ' + endIdx.toLocaleString() + ' of ' + total.toLocaleString() + ' entries';
      }
    }

    if (total === 0) {
      tbody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('p').textContent = allRows.length === 0
          ? 'No data in In-Line QC sheet. Click "Sync Google Sheet" to load.'
          : 'No records match the current filter criteria.';
      }
      clearCellSelection();
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    var query = searchQuery.trim().toLowerCase();
    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, rowIdxOnPage) {
      var globalRowIdx = startIdx + rowIdxOnPage;
      var tr = document.createElement('tr');
      tr.className = (rowIdxOnPage % 2 === 0) ? 'bai-row-even' : 'bai-row-odd';
      tr.setAttribute('data-r', rowIdxOnPage);
      tr.setAttribute('data-global-r', globalRowIdx);

      // 1. Row Index Number (Compact width)
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-td-row-num bai-sheet-td-index';
      tdNum.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;text-align:center!important;padding:6px 2px!important;';
      tdNum.textContent = globalRowIdx + 1;
      tr.appendChild(tdNum);

      // 2. PDF Download Action Button (Strict Center Aligned)
      var tdPdf = document.createElement('td');
      tdPdf.className = 'bai-td-pdf-action bai-sheet-td-action';
      tdPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;vertical-align:middle!important;padding:6px 4px!important;';
      var pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'bai-btn-row-pdf dt-pdf-download-btn';
      pdfBtn.title = 'Download Inspection Report PDF for Batch: ' + (row[1] || 'Row ' + (globalRowIdx + 1));
      pdfBtn.innerHTML = '<span class="material-icons-round">picture_as_pdf</span>';
      (function (capturedRow) {
        pdfBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          downloadRowInspectionReportPdf(capturedRow);
        });
      })(row);
      tdPdf.appendChild(pdfBtn);
      tr.appendChild(tdPdf);

      // 3. 21 Data Columns
      for (var c = 0; c < NUM_COLS; c++) {
        var td = document.createElement('td');
        td.className = 'bai-td-data';
        td.setAttribute('data-r', rowIdxOnPage);
        td.setAttribute('data-c', c);

        var val = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';

        // Highlight matching search text
        if (query && val && val.toLowerCase().includes(query)) {
          td.innerHTML = highlightMatch(val, query);
        } else {
          td.textContent = val;
        }

        tr.appendChild(td);
      }

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    // Rebind cell click for interactive selection
    tbody.querySelectorAll('td.bai-td-data').forEach(function (td) {
      td.addEventListener('click', function (e) {
        selectCell(td);
      });
    });

    // Auto-select first cell on page render if not selected
    if (pageRows.length > 0 && (!selectedCell || !document.contains(selectedCell.el))) {
      var firstCell = tbody.querySelector('td.bai-td-data[data-r="0"][data-c="0"]');
      if (firstCell) selectCell(firstCell, true);
    }
  }

  function highlightMatch(text, query) {
    var idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    var before = text.substring(0, idx);
    var match = text.substring(idx, idx + query.length);
    var after = text.substring(idx + query.length);
    return escapeHtml(before) + '<mark class="bai-search-hl">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCell(tdEl, silent) {
    if (!tdEl) return;
    clearCellSelection();

    tdEl.classList.add('bai-cell-selected');
    var r = parseInt(tdEl.getAttribute('data-r'), 10);
    var c = parseInt(tdEl.getAttribute('data-c'), 10);
    selectedCell = { r: r, c: c, el: tdEl };

    if (!silent) {
      updateActiveCellBadge(r, c);
    }
  }

  function clearCellSelection() {
    if (selectedCell && selectedCell.el) {
      selectedCell.el.classList.remove('bai-cell-selected');
    }
    selectedCell = null;
    var badge = document.getElementById('inline-qc-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function updateActiveCellBadge(rowOnPage, colIdx) {
    var badge = document.getElementById('inline-qc-active-cell-badge');
    if (!badge) return;
    var startIdx = (currentPage - 1) * pageSize;
    var globalRow = startIdx + rowOnPage + 1;
    var header = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
    badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;vertical-align:middle;">pin_drop</span> Row ' + globalRow + ' \u2022 ' + escapeHtml(header);
    badge.style.display = 'inline-flex';
  }

  function setupKeyboardNavigation() {
    var wrapper = document.getElementById('inline-qc-table-wrapper');
    if (!wrapper) return;

    wrapper.setAttribute('tabindex', '0');
    wrapper.addEventListener('keydown', function (e) {
      // Copy shortcut
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (copySelectedCellContent()) {
          e.preventDefault();
        }
        return;
      }

      if (!selectedCell) return;
      var curR = selectedCell.r;
      var curC = selectedCell.c;
      var maxR = Math.min(pageSize, filteredRows.length - (currentPage - 1) * pageSize) - 1;
      var maxC = NUM_COLS - 1;

      var handled = false;
      var nextR = curR;
      var nextC = curC;

      switch (e.key) {
        case 'ArrowUp':
          if (curR > 0) { nextR = curR - 1; handled = true; }
          break;
        case 'ArrowDown':
        case 'Enter':
          if (curR < maxR) { nextR = curR + 1; handled = true; }
          break;
        case 'ArrowLeft':
          if (curC > 0) { nextC = curC - 1; handled = true; }
          break;
        case 'ArrowRight':
          if (curC < maxC) { nextC = curC + 1; handled = true; }
          break;
        case 'Tab':
          if (e.shiftKey) {
            if (curC > 0) { nextC = curC - 1; handled = true; }
            else if (curR > 0) { nextR = curR - 1; nextC = maxC; handled = true; }
          } else {
            if (curC < maxC) { nextC = curC + 1; handled = true; }
            else if (curR < maxR) { nextR = curR + 1; nextC = 0; handled = true; }
          }
          break;
      }

      if (handled) {
        e.preventDefault();
        var tbody = document.getElementById('inline-qc-tbody');
        if (tbody) {
          var targetTd = tbody.querySelector('td.bai-td-data[data-r="' + nextR + '"][data-c="' + nextC + '"]');
          if (targetTd) {
            selectCell(targetTd);
            targetTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
      }
    });
  }

  function copySelectedCellContent() {
    if (!selectedCell || !selectedCell.el) return false;
    var text = selectedCell.el.textContent || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    selectedCell.el.classList.add('bai-cell-copied');
    setTimeout(function () {
      if (selectedCell && selectedCell.el) selectedCell.el.classList.remove('bai-cell-copied');
    }, 500);

    var preview = text.length > 35 ? text.slice(0, 35) + '...' : text;
    showToast('Copied: "' + (preview || '(Blank)') + '"', 'copy');
    return true;
  }

  // ---------------------------------------------------------------------------
  // 10. PDF Generation 1: Row-Level In-Line QC Inspection Report (A4 Single Page)
  // ---------------------------------------------------------------------------
  function extractRowFields(row) {
    function get(idx) {
      return (row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : '';
    }
    function byHdr(regex, fallbackIdx) {
      if (allHeaders && allHeaders.length) {
        for (var i = 0; i < allHeaders.length; i++) {
          if (regex.test(String(allHeaders[i] || '').trim())) {
            var v = row[i];
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
          }
        }
      }
      return get(fallbackIdx);
    }
    return {
      topDate: byHdr(/^(date|fms\s*upload|planned\s*date)/i, 0),
      batchId: byHdr(/batch\s*(id|no\.?)/i, 1),
      leatherDate: byHdr(/leather\s*received/i, 2),
      creator: byHdr(/creator/i, 3),
      unit: byHdr(/^unit$/i, 4),
      fabricator: byHdr(/fabricator/i, 5),
      brand: byHdr(/^brand$/i, 6),
      season: byHdr(/^season$/i, 7),
      category: byHdr(/^category$/i, 8),
      sku: byHdr(/^sku$/i, 9),
      styleNo: byHdr(/^style/i, 10),
      colour: byHdr(/colo?ur/i, 11),
      quantity: byHdr(/(quantity|^qty$)/i, 12),
      etd: byHdr(/^etd$/i, 13),
      po: byHdr(/^po/i, 14),
      floorSup: byHdr(/floor\s*supervisor/i, 15),
      inLineQc: byHdr(/in.?line\s*qc/i, 16),
      productionDays: byHdr(/production\s*days/i, 17),
      followUp1: byHdr(/1st\s*follow\s*up/i, 18),
      followUp2: byHdr(/2nd\s*follow\s*up/i, 19),
      followUp3: byHdr(/3rd\s*follow\s*up/i, 20)
    };
  }

  function buildIqcInspectionReportHtml(f) {
    var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';
    var companyName = 'TRIO TREND EXPORTS PVT. LTD.';
    var reportTitle = 'IN-LINE QC INSPECTION REPORT';

    var fupSectionsHtml = IQC_CHECKLIST.map(function (section, i) {
      var dateVal = i === 0 ? f.followUp1 : (i === 1 ? f.followUp2 : f.followUp3);
      var ordLabel = (i === 0 ? '1ST' : (i === 1 ? '2ND' : '3RD')) + ' FOLLOW UP';

      var rowsHtml = section.items.map(function (item, idx) {
        return (
          '<tr>' +
          '<td class="col-sl">' + (idx + 1) + '</td>' +
          '<td class="col-cp">' + escapeHtml(item) + '</td>' +
          '<td class="col-check"><div class="chk-box"></div></td>' +
          '<td class="col-remarks"><div class="remark-line"></div></td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="fup-card">' +
        '<div class="fup-header">' +
        '<div class="fup-title-wrap">' +
        '<span class="fup-badge">' + (i + 1) + '</span>' +
        '<span class="fup-title-text">' + ordLabel + '</span>' +
        '</div>' +
        '<div class="fup-date-tag">' +
        '<span class="fup-date-lbl">PLANNED DATE:</span> ' +
        '<span class="fup-date-val">' + escapeHtml(dateVal || 'Not Scheduled') + '</span>' +
        '</div>' +
        '</div>' +
        '<table class="fup-table">' +
        '<thead><tr>' +
        '<th class="col-sl">#</th>' +
        '<th class="col-cp">CHECK POINTS &amp; QUALITY PARAMETERS</th>' +
        '<th class="col-check">STATUS</th>' +
        '<th class="col-remarks">OBSERVATIONS &amp; REMARKS</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
        '</div>'
      );
    }).join('');

    var css =
      '*,*::before,*::after{ box-sizing: border-box; margin: 0; padding: 0; }' +
      'html, body { background: #e2e8f0; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }' +
      '.doc-page { width: 794px; margin: 10px auto; background: #ffffff; padding: 10px 16px 8px 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); border: 1.5px solid #000000; box-sizing: border-box; }' +
      '.top-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #000000; padding-bottom: 4px; margin-bottom: 4px; position: relative; }' +
      '.top-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #c48b16 0%, #e2b342 50%, #c48b16 100%); }' +
      '.brand-col { display: flex; align-items: center; gap: 12px; }' +
      '.company-logo { height: 38px; width: auto; max-width: 140px; object-fit: contain; }' +
      '.brand-meta { display: flex; flex-direction: column; justify-content: center; }' +
      '.company-title { font-size: 15px; font-weight: 900; color: #0f2744; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.15; }' +
      '.company-sub { font-size: 9px; font-weight: 700; color: #475569; letter-spacing: 0.5px; margin-top: 1px; text-transform: uppercase; }' +
      '.report-title-col { text-align: right; }' +
      '.report-badge { display: inline-block; background: #f8fafc; color: #0f2744; border: 1.5px solid #0f2744; font-size: 12px; font-weight: 900; letter-spacing: 0.6px; padding: 3px 9px; border-radius: 0; }' +
      '.report-meta-sub { font-size: 9.5px; color: #1e293b; font-weight: 700; margin-top: 2px; }' +
      '.report-meta-sub strong { color: #000000; }' +
      '.info-card { background: #ffffff; border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 4px; }' +
      '.info-grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
      '.info-grid-table th, .info-grid-table td { border: 1px solid #000000; padding: 3.5px 5px; text-align: center; word-wrap: break-word; }' +
      '.info-grid-table th { background: #f1f5f9; color: #000000; font-weight: 900; font-size: 9px; letter-spacing: 0.4px; text-transform: uppercase; }' +
      '.info-grid-table td { font-weight: 800; color: #000000; font-size: 11.5px; line-height: 1.15; }' +
      '.val-highlight { color: #0f2744 !important; font-size: 12px !important; font-weight: 900 !important; }' +
      '.fup-card { border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 4px; background: #ffffff; }' +
      '.fup-header { background: #f1f5f9; color: #0f2744; display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; border-bottom: 1.5px solid #000000; }' +
      '.fup-title-wrap { display: flex; align-items: center; gap: 6px; }' +
      '.fup-badge { display: inline-flex; align-items: center; justify-content: center; background: #fef3c7; color: #92400e; border: 1.2px solid #b45309; font-size: 9px; font-weight: 900; width: 16px; height: 16px; border-radius: 0; }' +
      '.fup-title-text { font-size: 10.5px; font-weight: 900; color: #0f2744; letter-spacing: 0.5px; text-transform: uppercase; }' +
      '.fup-date-tag { font-size: 9px; color: #334155; font-weight: 700; }' +
      '.fup-date-lbl { color: #64748b; font-weight: 800; }' +
      '.fup-date-val { color: #0f2744; font-weight: 900; background: #ffffff; padding: 1px 6px; border-radius: 0; border: 1.2px solid #0f2744; }' +
      '.fup-table { width: 100%; border-collapse: collapse; }' +
      '.fup-table th, .fup-table td { border: 1px solid #000000; padding: 2px 6px; vertical-align: middle; }' +
      '.fup-table thead tr { background: #f1f5f9; }' +
      '.fup-table th { color: #000000; font-weight: 900; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; padding: 2.5px 5px; }' +
      '.fup-table tbody tr:nth-child(even) { background: #fbfcfe; }' +
      '.col-sl { width: 26px; text-align: center; font-weight: 900; color: #000000; font-size: 9.5px; }' +
      '.col-cp { color: #000000; font-weight: 700; font-size: 9.5px; line-height: 1.15; letter-spacing: 0.1px; }' +
      '.col-check { width: 50px; text-align: center; }' +
      '.chk-box { display: inline-block; width: 13px; height: 13px; border: 1.8px solid #000000; border-radius: 0; background: #ffffff; vertical-align: middle; }' +
      '.col-remarks { width: 260px; }' +
      '.remark-line { width: 100%; border-bottom: 1px dotted #475569; height: 12px; }' +
      '.sign-section { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; }' +
      '.sign-box { flex: 1; border: 1.5px solid #000000; border-radius: 0; padding: 4px 6px; background: #ffffff; text-align: center; }' +
      '.sign-title { font-size: 9.5px; font-weight: 900; color: #0f2744; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 18px; }' +
      '.sign-line { border-bottom: 1.5px solid #000000; margin: 0 10px 2px 10px; }' +
      '.sign-caption { font-size: 8px; color: #334155; font-weight: 700; }' +
      '.footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 2px; border-top: 1.5px solid #000000; font-size: 8px; color: #334155; font-weight: 700; }' +
      '@media print { body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; } .doc-page { margin: 0 auto !important; padding: 4px 10px !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; } @page { size: A4 portrait; margin: 3mm 4mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }';

    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>In-Line QC Inspection Report - ' + escapeHtml(f.batchId || 'Batch') + '</title>' +
      '<style>' + css + '</style>' +
      '</head><body><div class="doc doc-page">' +
      '<!-- Top Header Bar -->' +
      '<div class="top-header">' +
      '<div class="brand-col">' +
      '<img class="company-logo" src="' + companyLogoUrl + '" alt="Trio Group Logo" />' +
      '<div class="brand-meta">' +
      '<div class="company-title">' + escapeHtml(companyName) + '</div>' +
      '<div class="company-sub">Quality Assurance &amp; In-Line QC Inspection Division</div>' +
      '</div>' +
      '</div>' +
      '<div class="report-title-col">' +
      '<div class="report-badge">' + reportTitle + '</div>' +
      '<div class="report-meta-sub">' +
      '<strong>DATE:</strong> ' + escapeHtml(f.topDate || new Date().toLocaleDateString('en-GB')) + ' &nbsp;|&nbsp; ' +
      '<strong>BATCH:</strong> ' + escapeHtml(f.batchId || 'N/A') +
      '</div>' +
      '</div>' +
      '</div>' +

      '<!-- Batch Information Card -->' +
      '<div class="info-card">' +
      '<table class="info-grid-table">' +
      '<thead><tr>' +
      '<th style="width:14%;">BATCH ID</th>' +
      '<th style="width:14%;">PO / BUYER</th>' +
      '<th style="width:10%;">UNIT</th>' +
      '<th style="width:16%;">SKU</th>' +
      '<th style="width:17%;">STYLE NO.</th>' +
      '<th style="width:14%;">COLOUR</th>' +
      '<th style="width:15%;">QUANTITY</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td class="val-highlight">' + escapeHtml(f.batchId || '-') + '</td>' +
      '<td>' + escapeHtml(f.po || '-') + '</td>' +
      '<td>' + escapeHtml(f.unit || '-') + '</td>' +
      '<td class="val-highlight">' + escapeHtml(f.sku || '-') + '</td>' +
      '<td>' + escapeHtml(f.styleNo || '-') + '</td>' +
      '<td>' + escapeHtml(f.colour || '-') + '</td>' +
      '<td class="val-highlight">' + escapeHtml(f.quantity || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '<table class="info-grid-table" style="border-top:none;">' +
      '<thead><tr>' +
      '<th style="width:25%;">FABRICATOR NAME</th>' +
      '<th style="width:25%;">IN-LINE QC</th>' +
      '<th style="width:25%;">FLOOR SUPERVISOR</th>' +
      '<th style="width:25%;">ETD (EXP. DELIVERY)</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td>' + escapeHtml(f.fabricator || '-') + '</td>' +
      '<td>' + escapeHtml(f.inLineQc || '-') + '</td>' +
      '<td>' + escapeHtml(f.floorSup || '-') + '</td>' +
      '<td class="val-highlight">' + escapeHtml(f.etd || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '</div>' +

      '<!-- Follow Up Sections -->' +
      fupSectionsHtml +

      '<!-- Signatures -->' +
      '<div class="sign-section">' +
      '<div class="sign-box">' +
      '<div class="sign-title">In-Line QC Inspector</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">Floor Supervisor</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">WIP AQL Officer / QA Manager</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Verified &amp; Approved</div>' +
      '</div>' +
      '</div>' +

      '<!-- Footer Security Notice -->' +
      '<div class="footer-bar">' +
      '<span>Trio Trend Exports Pvt. Ltd. &bull; In-Line QC Inspection System &bull; Confidential Document</span>' +
      '<span>Form Ref: FMS-IQC-01</span>' +
      '</div>' +
      '</div></body></html>'
    );
  }

  function downloadRowInspectionReportPdf(row) {
    try {
      var f = extractRowFields(row);
      var html = buildIqcInspectionReportHtml(f);

      var win = window.open('', '_blank', 'width=920,height=800');
      if (!win) {
        showToast('Popup blocked. Please allow popups to download the PDF.', 'error');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();

      setTimeout(function () {
        try {
          var doc = win.document.querySelector('.doc-page, .doc');
          if (doc) {
            var PAGE_HEIGHT_PX = 1050;
            if (doc.scrollHeight > PAGE_HEIGHT_PX) {
              var ratio = Math.max(0.85, PAGE_HEIGHT_PX / doc.scrollHeight);
              doc.style.zoom = ratio;
            }
          }
        } catch (e) { }
        try { win.print(); } catch (e) { }
      }, 350);
    } catch (err) {
      console.error('In-Line QC Row PDF error:', err);
      showToast('Could not generate PDF: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 11. PDF Generation 2: Full Landscape Table PDF Export
  // ---------------------------------------------------------------------------
  function exportFilteredTablePdf() {
    if (filteredRows.length === 0) {
      showToast('No records available to export.', 'info');
      return;
    }

    try {
      var printWin = window.open('', '_blank', 'width=1200,height=850');
      if (!printWin) {
        showToast('Popup blocked. Please allow popups to download the table PDF.', 'error');
        return;
      }

      var dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      var title = 'IN-LINE QC DATA REPORT';

      var theadThs = '<th>#</th>';
      allHeaders.forEach(function (h) {
        theadThs += '<th>' + escapeHtml(h) + '</th>';
      });

      var tbodyRows = '';
      filteredRows.forEach(function (row, idx) {
        tbodyRows += '<tr><td>' + (idx + 1) + '</td>';
        for (var c = 0; c < NUM_COLS; c++) {
          var cell = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
          tbodyRows += '<td>' + escapeHtml(cell) + '</td>';
        }
        tbodyRows += '</tr>';
      });

      var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>' + title + ' - ' + dateStr + '</title>' +
        '<style>' +
        '@page { size: A4 landscape; margin: 6mm 8mm; }' +
        '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; background: #fff; padding: 12px; }' +
        '.rpt-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }' +
        '.rpt-title { font-size: 16px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }' +
        '.rpt-meta { font-size: 11px; color: #64748b; font-weight: 600; text-align: right; }' +
        'table { width: 100%; border-collapse: collapse; font-size: 8px; }' +
        'th, td { border: 1px solid #cbd5e1; padding: 3px 4px; text-align: left; word-break: break-word; }' +
        'th { background: #0f172a; color: #f8fafc; font-weight: 700; text-transform: uppercase; font-size: 7.5px; }' +
        'tr:nth-child(even) td { background: #f8fafc; }' +
        '.rpt-footer { margin-top: 10px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }' +
        '</style></head><body>' +
        '<div class="rpt-header">' +
        '<div>' +
        '<div class="rpt-title">' + title + '</div>' +
        '<div style="font-size:11px;color:#475569;font-weight:600;margin-top:2px;">TRIO TREND EXPORTS PVT. LTD. &bull; In-Line QC Quality System</div>' +
        '</div>' +
        '<div class="rpt-meta">' +
        '<div>Date: <strong>' + dateStr + '</strong></div>' +
        '<div>Total Filtered Records: <strong>' + filteredRows.length + '</strong></div>' +
        '</div>' +
        '</div>' +
        '<table><thead><tr>' + theadThs + '</tr></thead><tbody>' + tbodyRows + '</tbody></table>' +
        '<div class="rpt-footer">' +
        '<span>Generated from FMS Workspace &bull; Confidential</span>' +
        '<span>Quality Inspection Report</span>' +
        '</div>' +
        '</body></html>';

      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(function () {
        try { printWin.print(); } catch (e) { }
      }, 400);
    } catch (err) {
      console.error('In-Line QC Table PDF Export Error:', err);
      showToast('Export error: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 12. Excel (.xlsx) Export via SheetJS
  // ---------------------------------------------------------------------------
  function exportFilteredTableExcel() {
    if (filteredRows.length === 0) {
      showToast('No records available to export.', 'info');
      return;
    }
    if (typeof XLSX === 'undefined') {
      showToast('Excel library (SheetJS) is loading, please try again.', 'error');
      return;
    }

    try {
      var exportData = [];
      filteredRows.forEach(function (row, idx) {
        var rowObj = { '#': idx + 1 };
        allHeaders.forEach(function (h, colIdx) {
          rowObj[h] = row[colIdx] || '';
        });
        exportData.push(rowObj);
      });

      var ws = XLSX.utils.json_to_sheet(exportData);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'In-Line QC');

      // Auto column widths
      var colWidths = [{ wch: 6 }];
      allHeaders.forEach(function (h, colIdx) {
        var maxLen = h.length;
        for (var r = 0; r < Math.min(filteredRows.length, 50); r++) {
          var val = String(filteredRows[r][colIdx] || '');
          if (val.length > maxLen) maxLen = val.length;
        }
        colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 12), 40) });
      });
      ws['!cols'] = colWidths;

      var dateTag = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, 'In_Line_QC_' + dateTag + '.xlsx');
      showToast('Excel export downloaded successfully.', 'success');
    } catch (err) {
      console.error('In-Line QC Excel export error:', err);
      showToast('Excel export failed: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Column Filter Popover (Google Sheets Style)
  // ---------------------------------------------------------------------------
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterSelectedSet = new Set();
  var currentFilterValueCounts = {};
  var currentFilterSearchQuery = '';

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('inline-qc-filter-popover');
    var popTitle = document.getElementById('inline-qc-filter-pop-title');
    var searchInput = document.getElementById('inline-qc-filter-search-input');
    var searchClear = document.getElementById('inline-qc-filter-search-clear');

    if (popTitle) popTitle.textContent = allHeaders[colIdx] || ('Column ' + (colIdx + 1));
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';

    // Calculate unique values and their frequencies from allRows
    currentFilterValueCounts = {};
    allRows.forEach(function (row) {
      var val = String(row[colIdx] !== undefined && row[colIdx] !== null ? row[colIdx] : '').trim();
      currentFilterValueCounts[val] = (currentFilterValueCounts[val] || 0) + 1;
    });

    currentFilterUniqueValues = Object.keys(currentFilterValueCounts).sort(function (a, b) {
      var numA = parseFloat(a), numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (activeFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterPopoverValuesList();

    if (!popover) return;
    popover.style.display = 'block';

    // Smart position near button
    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 280;
    var left = rect.left + window.scrollX;
    var top = rect.bottom + window.scrollY + 6;
    if (left + popWidth > window.innerWidth - 12) {
      left = Math.max(10, window.innerWidth - popWidth - 16);
    }
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    if (searchInput) {
      setTimeout(function () { searchInput.focus(); }, 60);
    }
  }

  function renderFilterPopoverValuesList() {
    var listContainer = document.getElementById('inline-qc-filter-list');
    var itemsCountEl = document.getElementById('inline-qc-filter-items-count');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    var query = currentFilterSearchQuery.trim().toLowerCase();
    var visibleValues = currentFilterUniqueValues.filter(function (val) {
      if (!query) return true;
      var display = (val === '' ? '(blank)' : val).toLowerCase();
      return display.indexOf(query) !== -1;
    });

    if (itemsCountEl) {
      itemsCountEl.textContent = visibleValues.length + ' item' + (visibleValues.length === 1 ? '' : 's');
    }

    if (visibleValues.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'bai-sheet-filter-item-empty';
      emptyMsg.textContent = 'No matching values';
      listContainer.appendChild(emptyMsg);
      return;
    }

    visibleValues.forEach(function (val) {
      var itemLabel = document.createElement('label');
      itemLabel.className = 'bai-sheet-filter-item';

      var leftDiv = document.createElement('div');
      leftDiv.className = 'bai-sheet-filter-item-left';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.addEventListener('change', function () {
        if (chk.checked) currentFilterSelectedSet.add(val);
        else currentFilterSelectedSet.delete(val);
      });

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = val === '' ? '(Blank)' : val;
      if (val === '') textSpan.style.fontStyle = 'italic';

      leftDiv.appendChild(chk);
      leftDiv.appendChild(textSpan);

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = currentFilterValueCounts[val] || 0;

      itemLabel.appendChild(leftDiv);
      itemLabel.appendChild(countBadge);
      listContainer.appendChild(itemLabel);
    });
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('inline-qc-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function setupFilterPopoverEvents() {
    var popover = document.getElementById('inline-qc-filter-popover');
    if (!popover) return;

    var closeBtn = document.getElementById('inline-qc-filter-pop-close');
    var cancelBtn = document.getElementById('inline-qc-filter-cancel-btn');
    var okBtn = document.getElementById('inline-qc-filter-ok-btn');
    var resetBtn = document.getElementById('inline-qc-filter-reset-btn');
    var selectAllBtn = document.getElementById('inline-qc-filter-select-all');
    var clearAllBtn = document.getElementById('inline-qc-filter-clear-all');
    var searchInput = document.getElementById('inline-qc-filter-search-input');
    var searchClear = document.getElementById('inline-qc-filter-search-clear');
    var sortAscBtn = document.getElementById('inline-qc-sort-asc');
    var sortDescBtn = document.getElementById('inline-qc-sort-desc');

    if (closeBtn) closeBtn.addEventListener('click', closeColumnFilterPopover);
    if (cancelBtn) cancelBtn.addEventListener('click', closeColumnFilterPopover);

    if (okBtn) {
      okBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
          delete activeFilters[currentFilterColIdx];
        } else {
          activeFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
        }
        closeColumnFilterPopover();
        applyFiltersAndSort();
        updateFilterIconsState();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          delete activeFilters[currentFilterColIdx];
          closeColumnFilterPopover();
          applyFiltersAndSort();
          updateFilterIconsState();
        }
      });
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        currentFilterUniqueValues.forEach(function (v) { currentFilterSelectedSet.add(v); });
        renderFilterPopoverValuesList();
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        currentFilterSelectedSet.clear();
        renderFilterPopoverValuesList();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var v = searchInput.value;
        if (searchClear) searchClear.style.display = v ? 'block' : 'none';
        currentFilterSearchQuery = v;
        renderFilterPopoverValuesList();
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none';
        currentFilterSearchQuery = '';
        renderFilterPopoverValuesList();
      });
    }

    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          sortColumn = currentFilterColIdx;
          sortAsc = true;
          closeColumnFilterPopover();
          applyFiltersAndSort();
          renderTableHeaders();
        }
      });
    }

    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          sortColumn = currentFilterColIdx;
          sortAsc = false;
          closeColumnFilterPopover();
          applyFiltersAndSort();
          renderTableHeaders();
        }
      });
    }

    // Close when clicking outside
    document.addEventListener('mousedown', function (e) {
      if (currentFilterColIdx !== null && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && currentFilterColIdx !== null) {
        closeColumnFilterPopover();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Modern Pagination Controls with Dynamic Page Pills
  // ---------------------------------------------------------------------------
  function getPaginationRange(current, totalPages, maxVisible) {
    if (totalPages <= maxVisible) {
      var arr = [];
      for (var i = 1; i <= totalPages; i++) arr.push(i);
      return arr;
    }
    var start = Math.max(1, current - Math.floor(maxVisible / 2));
    var end = start + maxVisible - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - maxVisible + 1);
    }
    var pages = [];
    for (var p = start; p <= end; p++) pages.push(p);
    return pages;
  }

  function scrollTableToTop() {
    var wrap = document.getElementById('inline-qc-table-wrapper');
    if (wrap) wrap.scrollTop = 0;
  }

  function updatePaginationControls() {
    var total = filteredRows.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));

    var firstBtn = document.getElementById('btn-first-page-iqc');
    var prevBtn = document.getElementById('btn-prev-page-iqc');
    var nextBtn = document.getElementById('btn-next-page-iqc');
    var lastBtn = document.getElementById('btn-last-page-iqc');
    var inputEl = document.getElementById('inline-qc-page-input');
    var totalEl = document.getElementById('inline-qc-total-pages');
    var pillsContainer = document.getElementById('inline-qc-page-pills');

    if (totalEl) totalEl.textContent = totalPages;
    if (inputEl) {
      inputEl.value = currentPage;
      inputEl.max = totalPages;
    }

    if (firstBtn) firstBtn.disabled = (currentPage <= 1);
    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
    if (lastBtn) lastBtn.disabled = (currentPage >= totalPages);

    if (pillsContainer) {
      pillsContainer.innerHTML = '';
      if (totalPages > 1) {
        var pillRange = getPaginationRange(currentPage, totalPages, 5);
        pillRange.forEach(function (p) {
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'floor-supervisor-page-pill inline-qc-page-pill' + (p === currentPage ? ' active' : '');
          pill.textContent = p;
          pill.setAttribute('aria-label', 'Page ' + p);
          pill.addEventListener('click', function () {
            if (p !== currentPage) {
              currentPage = p;
              renderTablePage();
              updatePaginationControls();
              scrollTableToTop();
            }
          });
          pillsContainer.appendChild(pill);
        });
      }
    }
  }

  function setupPaginationEvents() {
    var firstBtn = document.getElementById('btn-first-page-iqc');
    var prevBtn = document.getElementById('btn-prev-page-iqc');
    var nextBtn = document.getElementById('btn-next-page-iqc');
    var lastBtn = document.getElementById('btn-last-page-iqc');
    var inputEl = document.getElementById('inline-qc-page-input');
    var sizeSelect = document.getElementById('inline-qc-page-size');

    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
          updatePaginationControls();
          scrollTableToTop();
        }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
          updatePaginationControls();
          scrollTableToTop();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize);
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
          updatePaginationControls();
          scrollTableToTop();
        }
      });
    }
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize);
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
          updatePaginationControls();
          scrollTableToTop();
        }
      });
    }
    if (inputEl) {
      inputEl.addEventListener('change', function () {
        var totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
        var val = parseInt(inputEl.value, 10);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
          currentPage = val;
        } else {
          inputEl.value = currentPage;
        }
        renderTablePage();
        updatePaginationControls();
        scrollTableToTop();
      });
    }
    if (sizeSelect) {
      sizeSelect.addEventListener('change', function () {
        pageSize = parseInt(sizeSelect.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
        updatePaginationControls();
        scrollTableToTop();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 15. Synchronization Controller
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncStatusUI('syncing', 'Syncing from Google Sheet...');

    fetchGoogleSheetCSV()
      .then(function (result) {
        if (result && result.rows && result.rows.length > 0) {
          allHeaders = result.headers;
          allRows = result.rows;
          lastSyncTime = Date.now();

          // Save to IndexedDB
          saveToIndexedDB({
            headers: allHeaders,
            rows: allRows,
            syncTime: lastSyncTime
          }).catch(function (dbErr) {
            console.warn('IndexedDB write error:', dbErr);
          });

          renderTableHeaders();
          applyFiltersAndSort();
          updateSyncStatusUI('ready', 'Synced: ' + formatTimeAgo(lastSyncTime));
          if (isManual) {
            showToast('Synchronized ' + allRows.length.toLocaleString() + ' In-Line QC records from Google Sheet.', 'success');
          }
        } else {
          updateSyncStatusUI('ready', 'Synced: ' + formatTimeAgo(lastSyncTime));
          if (isManual) showToast('No records found in In-Line QC sheet.', 'info');
        }
      })
      .catch(function (err) {
        console.error('In-Line QC sync error:', err);
        updateSyncStatusUI('error', 'Sync failed: ' + err.message);
        if (isManual) {
          showToast('Sync error: ' + err.message, 'error');
        }
      })
      .finally(function () {
        isSyncing = false;
        // Dismiss full-screen spinner if any legacy caller invoked it
        if (typeof window.hideSpinner === 'function') window.hideSpinner();
        var overlay = document.getElementById('spinner-overlay');
        if (overlay) overlay.style.display = 'none';
      });
  }

  // ---------------------------------------------------------------------------
  // 16. Engine Initialization
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    renderTableHeaders();
    setupKeyboardNavigation();
    setupFilterPopoverEvents();
    setupPaginationEvents();

    // Toolbar Search Input
    var searchInput = document.getElementById('inline-qc-search-input');
    var searchClear = document.getElementById('inline-qc-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchQuery = searchInput.value;
        if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
        applyFiltersAndSort();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        searchQuery = '';
        searchClear.style.display = 'none';
        applyFiltersAndSort();
      });
    }

    // Toolbar Action Buttons
    var syncBtn = document.getElementById('btn-sync-iqc-sheet');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }
    var excelBtn = document.getElementById('btn-download-iqc-excel');
    if (excelBtn) {
      excelBtn.addEventListener('click', exportFilteredTableExcel);
    }
    var pdfBtn = document.getElementById('btn-export-iqc-pdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', exportFilteredTablePdf);
    }

    // Back to PDF button
    var backBtn = document.getElementById('btn-back-pdf-iqc');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hideView();
      });
    }

    // Instant local loading from IndexedDB
    loadFromIndexedDB()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = cached.headers || defaultHeaders;
          allRows = cached.rows;
          lastSyncTime = cached.syncTime;

          renderTableHeaders();
          applyFiltersAndSort();
          updateSyncStatusUI('ready', 'Synced: ' + formatTimeAgo(lastSyncTime));

          // Background auto-refresh if cache is older than 5 minutes
          if (!lastSyncTime || (Date.now() - lastSyncTime > 5 * 60 * 1000)) {
            setTimeout(function () { syncFromGoogleSheet(false); }, 800);
          }
        } else {
          // No cache, immediate fetch
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('Could not read from In-Line QC IndexedDB:', err);
        syncFromGoogleSheet(false);
      });
  }

  function showView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var fsView = document.getElementById('pdf-floor-supervisor-view');
    var iqcView = document.getElementById('pdf-inline-qc-view');
    var eqcView = document.getElementById('pdf-endline-qc-view');
    var epView = document.getElementById('pdf-edge-paint-view');

    if (kpiView) kpiView.style.display = 'none';
    if (fsView) fsView.style.display = 'none';
    if (eqcView) eqcView.style.display = 'none';
    if (epView) epView.style.display = 'none';
    if (iqcView) iqcView.style.display = 'block';

    if (window.FloorSupervisorSheetEngine && typeof window.FloorSupervisorSheetEngine.clearSelection === 'function') {
      window.FloorSupervisorSheetEngine.clearSelection();
    }
    if (window.EndLineQcSheetEngine && typeof window.EndLineQcSheetEngine.clearSelection === 'function') {
      window.EndLineQcSheetEngine.clearSelection();
    }
    if (window.EdgePaintSheetEngine && typeof window.EdgePaintSheetEngine.clearSelection === 'function') {
      window.EdgePaintSheetEngine.clearSelection();
    }

    // Prevent full spinner overlay
    if (typeof window.hideSpinner === 'function') window.hideSpinner();
    var overlay = document.getElementById('spinner-overlay');
    if (overlay) overlay.style.display = 'none';

    // If rows already present, render page
    if (allRows.length > 0) {
      renderTableHeaders();
      applyFiltersAndSort();
    } else {
      loadFromIndexedDB().then(function (c) {
        if (!c || !c.rows || c.rows.length === 0) {
          syncFromGoogleSheet(false);
        }
      });
    }
  }

  function hideView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var iqcView = document.getElementById('pdf-inline-qc-view');

    if (iqcView) iqcView.style.display = 'none';
    if (kpiView) kpiView.style.display = 'block';
  }

  // ---------------------------------------------------------------------------
  // 17. Utilities
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(type || 'info', type === 'error' ? 'Error' : 'In-Line QC', msg);
      return;
    }
    var existing = document.getElementById('iqc-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'iqc-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:#0f172a;color:#f8fafc;padding:10px 18px;border-radius:0;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.3);border-left:4px solid #3b82f6;display:flex;align-items:center;gap:8px;';
    toast.innerHTML = '<span class="material-icons-round" style="font-size:18px;color:#3b82f6;">info</span><span>' + escapeHtml(msg) + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3200);
  }

  // DOMContentLoaded Hook
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDataEngine);
  } else {
    setTimeout(initDataEngine, 50);
  }

  // Global Engine Export
  window.InLineQcSheetEngine = {
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    getRows: function () { return allRows; },
    getFilteredRows: function () { return filteredRows; },
    extractRowFields: extractRowFields,
    buildReportHtml: buildIqcInspectionReportHtml,
    setRows: function (headers, rows) {
      if (headers && headers.length) allHeaders = headers;
      if (rows && rows.length) {
        allRows = rows;
        applyFiltersAndSort();
        saveToIndexedDB({ headers: allHeaders, rows: allRows, syncTime: Date.now() });
      }
    }
  };

})();
