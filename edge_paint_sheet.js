/**
 * =============================================================================
 * Edge-Paint Live Engine (IndexedDB + Fast Google Sheets CSV + Dual PDF Generator)
 * =============================================================================
 * Sheet: EDGE-PAINT PART (Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E)
 * GID: 632475563
 * Range: B7:AF (31 Columns)
 * Row 7: Header Row
 * Database: IndexedDB 'FMS_Edge_Paint_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser from Google Sheet export/gviz
 *   - Precision table layout with cell borders & text wrapping matching In-Line QC, Floor Supervisor & End-Line QC
 *   - Action Column (PDF FILE): One-click print/PDF download of official EDGE-PAINT INSPECTION REPORT
 *   - Instant client-side Search across all 31 columns with match highlighting
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Dual PDF Generation:
 *       1. Row-Level: Edge-Paint Inspection Report (Single-page print/PDF checklist with 25 blank reason rows, NO ISO 9001)
 *       2. Table-Level: Full landscape A4 PDF export of filtered table records via jsPDF + autoTable
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page) with numbered page pills
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '632475563';
  var SHEET_NAME = 'EDGE-PAINT PART';

  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B7:AF';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B7:AF';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Edge_Paint_DB_v1';
  var DB_VERSION = 2;
  var STORE_NAME = 'edge_paint_store';
  var NUM_COLS = 31;

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
    'FAC / REF NO',
    'COLOUR',
    'QUANTITY',
    'ETD AS PER ORDER',
    'PO AS PER BUYER',
    'FLOOR SUPERVISOR NAME',
    'INLINE QC NAME',
    'PLANNED DATE',
    'FOLLOWUP TIMESTAMP',
    'STATUS',
    'EDGE-PAINT FABRICATOR NAME',
    'EDGE-PAINT CHECKER NAME',
    'OVERLAPPING PARTS',
    'ISSUE PARTS',
    'CHECKED QTY',
    'REPAIR QTY',
    'REMARKS (FOLLOW UP)',
    'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)',
    'REMARKS',
    'TIME DELAY'
  ];

  // State
  var dbInstance = null;
  var allHeaders = defaultHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var lastSyncTime = null;
  var searchDebounceTimer = null;

  // Cell Selection State
  var selectedCell = null; // { r: localRowIdx, c: colIdx, el: tdElement }

  // Column Filters State
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Engine
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME)) {
        return resolve(dbInstance);
      }
      dbInstance = null;
      if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.warn('[EdgePaint] Store missing in ' + DB_NAME + ', auto-repairing...');
          db.close();
          var repairVersion = (db.version || DB_VERSION) + 1;
          var repairReq = indexedDB.open(DB_NAME, repairVersion);
          repairReq.onupgradeneeded = function (re) {
            var rdb = re.target.result;
            if (!rdb.objectStoreNames.contains(STORE_NAME)) {
              rdb.createObjectStore(STORE_NAME);
            }
          };
          repairReq.onsuccess = function (re) {
            dbInstance = re.target.result;
            resolve(dbInstance);
          };
          repairReq.onerror = function () {
            var del = indexedDB.deleteDatabase(DB_NAME);
            del.onsuccess = del.onerror = function () {
              var recReq = indexedDB.open(DB_NAME, 1);
              recReq.onupgradeneeded = function (ce) {
                ce.target.result.createObjectStore(STORE_NAME);
              };
              recReq.onsuccess = function (ce) {
                dbInstance = ce.target.result;
                resolve(dbInstance);
              };
              recReq.onerror = function (ce) {
                reject(ce.target.error || new Error('Failed to repair database'));
              };
            };
          };
          return;
        }
        dbInstance = db;
        resolve(dbInstance);
      };
      req.onerror = function (e) {
        reject(e.target.error || new Error('Failed to open ' + DB_NAME));
      };
    });
  }

  function saveToCache(headers, rows) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve();
          }
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          store.put(headers, 'headers');
          store.put(rows, 'rows');
          store.put(Date.now(), 'last_sync');
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function (e) {
            console.warn('[EdgePaint] saveToCache tx error:', e.target.error);
            resolve();
          };
        } catch (err) {
          console.warn('[EdgePaint] saveToCache error:', err);
          dbInstance = null;
          resolve();
        }
      });
    }).catch(function () { return Promise.resolve(); });
  }

  function loadFromCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve(null);
          }
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var reqH = store.get('headers');
          var reqR = store.get('rows');
          var reqS = store.get('last_sync');
          tx.oncomplete = function () {
            if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
              resolve({
                headers: reqH.result || allHeaders,
                rows: reqR.result,
                lastSync: reqS.result || null
              });
            } else {
              resolve(null);
            }
          };
          tx.onerror = function () { resolve(null); };
        } catch (err) {
          console.warn('[EdgePaint] loadFromCache error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function () { return Promise.resolve(null); });
  }

  // ---------------------------------------------------------------------------
  // 2. RFC-4180 In-Memory CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCsvString(csvText) {
    var rows = [];
    var currentRow = [];
    var currentField = '';
    var inQuotes = false;
    var len = csvText.length;

    for (var i = 0; i < len; i++) {
      var char = csvText[i];
      var nextChar = i + 1 < len ? csvText[i + 1] : '';

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            currentField += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentField);
          currentField = '';
        } else if (char === '\r') {
          if (nextChar === '\n') i++;
          currentRow.push(currentField);
          currentField = '';
          if (currentRow.some(function (c) { return c.trim() !== ''; })) {
            rows.push(currentRow);
          }
          currentRow = [];
        } else if (char === '\n') {
          currentRow.push(currentField);
          currentField = '';
          if (currentRow.some(function (c) { return c.trim() !== ''; })) {
            rows.push(currentRow);
          }
          currentRow = [];
        } else {
          currentField += char;
        }
      }
    }

    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      if (currentRow.some(function (c) { return c.trim() !== ''; })) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  // ---------------------------------------------------------------------------
  // 3. Fast Google Sheets Network Sync
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, 'Connecting to Google Sheets...');

    var fetchUrl = PRIMARY_CSV_URL + '&_t=' + Date.now();

    function tryFetch(url, isFallback) {
      return fetch(url, { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .catch(function (err) {
          if (!isFallback) {
            console.warn('Edge-Paint primary fetch failed, switching to gviz fallback:', err);
            return tryFetch(FALLBACK_CSV_URL + '&_t=' + Date.now(), true);
          }
          throw err;
        });
    }

    tryFetch(fetchUrl, false)
      .then(function (csvText) {
        if (!csvText || csvText.indexOf('<html') !== -1) {
          throw new Error('Google Sheet returned invalid non-CSV data');
        }

        var parsed = parseCsvString(csvText);
        if (!parsed || parsed.length === 0) {
          throw new Error('Google Sheet EDGE-PAINT PART is empty');
        }

        // Header row: index 0 (Row 7 in sheet)
        var rawHeaders = parsed[0];
        var cleanHeaders = [];
        for (var c = 0; c < NUM_COLS; c++) {
          cleanHeaders.push(
            (rawHeaders[c] !== undefined && rawHeaders[c] !== null && String(rawHeaders[c]).trim())
              ? String(rawHeaders[c]).trim()
              : (defaultHeaders[c] || ('Column ' + (c + 1)))
          );
        }

        // Data rows: index 1 onward
        var rawData = parsed.slice(1);
        var cleanRows = rawData.map(function (row) {
          var padded = [];
          for (var c = 0; c < NUM_COLS; c++) {
            padded.push((row[c] !== undefined && row[c] !== null) ? String(row[c]).trim() : '');
          }
          return padded;
        }).filter(function (row) {
          return row.some(function (cell) { return cell !== ''; });
        });

        allHeaders = cleanHeaders;
        allRows = cleanRows;
        lastSyncTime = Date.now();

        return saveToCache(allHeaders, allRows);
      })
      .then(function () {
        isSyncing = false;
        updateSyncUI(false);
        updateHeaderBadge();
        applyAllFiltersAndSearch();
        if (isManual) {
          showToast('Synced ' + allRows.length.toLocaleString() + ' records from Google Sheets', 'success');
        }
      })
      .catch(function (err) {
        isSyncing = false;
        updateSyncUI(false);
        console.error('Edge-Paint Sync Error:', err);
        if (isManual) {
          showToast('Sync failed: ' + err.message, 'error');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Data Engine Initialization & Local Cache Boot
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Edge-Paint records from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        updateSyncUI(false);
        updateHeaderBadge();
        renderHeaderRow();
        applyAllFiltersAndSearch();
        syncFromGoogleSheet(false);
      } else {
        syncFromGoogleSheet(false);
      }
    }).catch(function (err) {
      console.warn('Cache load error, syncing direct:', err);
      syncFromGoogleSheet(false);
    });
  }

  // ---------------------------------------------------------------------------
  // 5. CSS Styles Injection (Purple Accent Theme + Cell Selection + Popover)
  // ---------------------------------------------------------------------------
  function injectEdgePaintStyles() {
    if (document.getElementById('edge-paint-custom-styles')) return;
    var style = document.createElement('style');
    style.id = 'edge-paint-custom-styles';
    style.textContent = [
      '#pdf-edge-paint-view .bai-sheet-col-filter-btn {',
      '  background: transparent !important;',
      '  border: 1px solid rgba(255, 255, 255, 0.22) !important;',
      '  color: #94a3b8 !important;',
      '  width: 21px !important;',
      '  height: 21px !important;',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  border-radius: 4px !important;',
      '  cursor: pointer !important;',
      '  padding: 0 !important;',
      '  transition: all 0.2s ease !important;',
      '}',
      '#pdf-edge-paint-view .bai-sheet-col-filter-btn:hover {',
      '  background: rgba(124, 58, 237, 0.3) !important;',
      '  color: #ffffff !important;',
      '  border-color: #a78bfa !important;',
      '}',
      '#pdf-edge-paint-view .bai-sheet-col-filter-btn.is-active {',
      '  background: #7c3aed !important;',
      '  color: #ffffff !important;',
      '  border-color: #a78bfa !important;',
      '  box-shadow: 0 0 6px rgba(124, 58, 237, 0.8) !important;',
      '}',
      '#pdf-edge-paint-view .bai-sheet-th-filterable.has-active-filter {',
      '  background: #1e1b4b !important;',
      '}',
      '#pdf-edge-paint-view .bai-sheet-table tbody td.bai-cell-selected {',
      '  outline: 2.5px solid #7c3aed !important;',
      '  outline-offset: -2.5px !important;',
      '  box-shadow: inset 0 0 0 1px #ffffff, 0 0 0 1px #7c3aed !important;',
      '  background-color: #f5f3ff !important;',
      '  position: relative !important;',
      '  z-index: 2 !important;',
      '}',
      '#pdf-edge-paint-view .bai-sheet-table tbody td.bai-cell-copied {',
      '  animation: epCellFlash 0.5s ease-out !important;',
      '}',
      '@keyframes epCellFlash {',
      '  0% { background-color: #ddd6fe !important; }',
      '  100% { background-color: inherit; }',
      '}',
      '#edge-paint-filter-popover {',
      '  position: fixed !important;',
      '  z-index: 10005 !important;',
      '  width: 320px !important;',
      '  background: #ffffff !important;',
      '  border: 1px solid #94a3b8 !important;',
      '  border-top: 3px solid #7c3aed !important;',
      '  border-radius: 4px !important;',
      '  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28) !important;',
      '  overflow: hidden !important;',
      '}',
      '#edge-paint-page-pills {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 4px !important;',
      '}',
      '#edge-paint-footer .floor-supervisor-page-pill,',
      '#edge-paint-footer .edge-paint-page-pill {',
      '  min-width: 32px !important;',
      '  height: 32px !important;',
      '  padding: 0 8px !important;',
      '  border-radius: 0px !important;',
      '  background: #ffffff !important;',
      '  border: 1px solid #cbd5e1 !important;',
      '  color: #1e293b !important;',
      '  font-size: 12px !important;',
      '  font-weight: 700 !important;',
      '  font-family: "Poppins", sans-serif !important;',
      '  cursor: pointer !important;',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  transition: all 0.15s ease !important;',
      '}',
      '#edge-paint-footer .floor-supervisor-page-pill:hover:not(.active),',
      '#edge-paint-footer .edge-paint-page-pill:hover:not(.active) {',
      '  border-color: #0f172a !important;',
      '  color: #0f172a !important;',
      '  background: #f1f5f9 !important;',
      '}',
      '#edge-paint-footer .floor-supervisor-page-pill.active,',
      '#edge-paint-footer .edge-paint-page-pill.active {',
      '  background: #0f172a !important;',
      '  border-color: #0f172a !important;',
      '  color: #ffffff !important;',
      '  cursor: default !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // 6. Header Row Rendering & Sorting / Filter Icons
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('edge-paint-thead');
    if (!thead) return;

    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // 1. Row Index Column '#'
    var thIdx = document.createElement('th');
    thIdx.className = 'bai-sheet-th-index';
    thIdx.textContent = '#';
    thIdx.style.cssText = 'width:55px!important;min-width:55px!important;max-width:55px!important;text-align:center!important;background:#091729;color:#94a3b8;border-right:2px solid #334155;';
    tr.appendChild(thIdx);

    // 2. Action Column 'PDF FILE'
    var thPdf = document.createElement('th');
    thPdf.className = 'bai-sheet-th bai-sheet-th-action bai-th-pdf-action';
    thPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;white-space:nowrap!important;padding:8px 4px!important;background:#0f172a;color:#f8fafc;';
    thPdf.textContent = 'PDF FILE';
    tr.appendChild(thPdf);

    // 3. 31 Data Columns
    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';
      inner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (hasFilter ? 'filter_alt' : 'filter_list') + '</span>';

      filterBtn.addEventListener('click', (function (ci, fb) {
        return function (e) {
          e.stopPropagation();
          openColumnFilterPopover(ci, fb);
        };
      })(colIdx, filterBtn));

      inner.appendChild(labelSpan);
      inner.appendChild(filterBtn);
      th.appendChild(inner);

      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('edge-paint-thead');
    if (!thead) return;

    var thList = thead.querySelectorAll('th.bai-sheet-th-filterable');
    thList.forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.bai-sheet-col-filter-btn');
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;

      if (hasFilter) {
        th.classList.add('has-active-filter');
        if (btn) {
          btn.classList.add('is-active');
          btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_alt</span>';
        }
      } else {
        th.classList.remove('has-active-filter');
        if (btn) {
          btn.classList.remove('is-active');
          btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_list</span>';
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function getUniqueValuesForColumn(colIdx) {
    var map = {};
    for (var i = 0; i < allRows.length; i++) {
      var val = (allRows[i][colIdx] !== undefined && allRows[i][colIdx] !== null) ? String(allRows[i][colIdx]).trim() : '';
      map[val] = (map[val] || 0) + 1;
    }
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return { keys: keys, counts: map };
  }

  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('edge-paint-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];

    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Global Search across all 31 columns
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) {
            return false;
          }
        }
      }

      // 2. Multi-column filters
      for (var k = 0; k < activeFilterColKeys.length; k++) {
        var colIdx = parseInt(activeFilterColKeys[k], 10);
        var allowedSet = activeColumnFilters[colIdx];
        if (allowedSet) {
          var val = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          if (!allowedSet.has(val)) {
            return false;
          }
        }
      }

      return true;
    });

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('edge-paint-search-clear');
    if (searchClear) {
      searchClear.style.display = rawSearch ? 'block' : 'none';
    }
  }

  function renderActiveFilterChips() {
    var bar = document.getElementById('edge-paint-active-filters-bar');
    var container = document.getElementById('edge-paint-active-filters-chips');
    if (!bar || !container) return;

    var activeKeys = Object.keys(activeColumnFilters);
    if (activeKeys.length === 0) {
      bar.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    container.innerHTML = '';

    activeKeys.forEach(function (k) {
      var colIdx = parseInt(k, 10);
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var allowedSet = activeColumnFilters[colIdx];
      var totalVals = getUniqueValuesForColumn(colIdx).keys.length;
      var selectedCount = allowedSet.size;

      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-chip-text';
      textSpan.textContent = colName + ' (' + selectedCount + '/' + totalVals + ')';
      textSpan.title = colName + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter for ' + colName;
      removeBtn.innerHTML = '&#x2715;';
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        showToast('Filter removed on ' + colName, 'filter');
      });

      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Google Sheets Style Column Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));

    var popover = document.getElementById('edge-paint-filter-popover');
    var titleEl = document.getElementById('edge-paint-filter-pop-title');
    var searchInput = document.getElementById('edge-paint-filter-search-input');
    var searchClear = document.getElementById('edge-paint-filter-search-clear');

    if (titleEl) {
      titleEl.textContent = 'Filter: ' + colName;
      titleEl.title = colName;
    }
    if (searchInput) {
      searchInput.value = '';
      currentFilterSearchQuery = '';
    }
    if (searchClear) {
      searchClear.style.display = 'none';
    }

    var uv = getUniqueValuesForColumn(colIdx);
    currentFilterUniqueValues = uv.keys;
    currentFilterValueCounts = uv.counts;

    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterList();

    if (!popover) return;
    popover.style.display = 'block';

    // Smart Positioning
    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 320;
    var left = rect.left;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - popWidth - 16;
    }
    if (left < 16) left = 16;

    var top = rect.bottom + 6;
    var maxTop = window.innerHeight - 440;
    if (top > maxTop) {
      top = Math.max(16, rect.top - 410);
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 50);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('edge-paint-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('edge-paint-filter-list');
    var countEl = document.getElementById('edge-paint-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();

    var visibleVals = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      var label = val === '' ? '(blanks)' : val;
      return label.toLowerCase().indexOf(q) !== -1;
    });

    if (countEl) {
      countEl.textContent = visibleVals.length.toLocaleString() + ' items';
    }

    if (visibleVals.length === 0) {
      listEl.innerHTML = '<div class="bai-sheet-filter-empty">No matching values</div>';
      return;
    }

    visibleVals.forEach(function (val) {
      var isChecked = currentFilterSelectedSet.has(val);
      var displayLabel = val === '' ? '(Blanks)' : val;
      var count = currentFilterValueCounts[val] || 0;

      var item = document.createElement('label');
      item.className = 'bai-sheet-filter-item';

      var leftDiv = document.createElement('div');
      leftDiv.className = 'bai-sheet-filter-item-left';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', (function (v, checkbox) {
        return function () {
          if (checkbox.checked) currentFilterSelectedSet.add(v);
          else currentFilterSelectedSet.delete(v);
        };
      })(val, cb));

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = displayLabel;
      textSpan.title = displayLabel;
      if (val === '') {
        textSpan.style.fontStyle = 'italic';
        textSpan.style.color = '#94a3b8';
      }

      leftDiv.appendChild(cb);
      leftDiv.appendChild(textSpan);

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = '(' + count.toLocaleString() + ')';

      item.appendChild(leftDiv);
      item.appendChild(countBadge);
      listEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // 9. Text Match Highlighter
  // ---------------------------------------------------------------------------
  function highlightMatch(text, query) {
    if (!query || text === null || text === undefined) return escapeHtml(text);
    var str = String(text);
    var idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(str);
    var before = str.substring(0, idx);
    var match = str.substring(idx, idx + query.length);
    var after = str.substring(idx + query.length);
    return escapeHtml(before) + '<mark class="dt-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }

  // ---------------------------------------------------------------------------
  // 10. Table Page & Cell Selection Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('edge-paint-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="33" class="bai-sheet-table-empty">' +
      '<div class="bai-sheet-empty-wrap" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:40px 10px;">' +
      '<span class="material-icons-round bai-sheet-spin" style="font-size:24px;color:#7c3aed;">sync</span>' +
      '<span style="font-size:13px;font-weight:600;color:#64748b;">' + msg + '</span>' +
      '</div></td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('edge-paint-tbody');
    var countLabel = document.getElementById('edge-paint-record-count');
    var infoText = document.getElementById('edge-paint-info');
    var totalPagesEl = document.getElementById('edge-paint-total-pages');
    var pageInput = document.getElementById('edge-paint-page-input');

    if (!tbody) return;

    var searchInput = document.getElementById('edge-paint-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="33" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in EDGE-PAINT PART sheet.' : 'No matching records found.') +
        '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (infoText) infoText.textContent = 'Showing 0 - 0 of 0 entries';
      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageInput) pageInput.value = 1;
      updatePaginationControls(1, 1);
      clearCellSelection();
      return;
    }

    var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, filteredRows.length);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (countLabel) {
      countLabel.textContent = filteredRows.length.toLocaleString() + ' of ' + allRows.length.toLocaleString() + ' records';
    }
    if (infoText) {
      infoText.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' - ' + endIdx.toLocaleString() + ' of ' + filteredRows.length.toLocaleString() + ' entries';
    }
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (pageInput) {
      pageInput.value = currentPage;
      pageInput.max = totalPages;
    }

    updatePaginationControls(currentPage, totalPages);

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      // 1. Serial # Cell
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index';
      tdNum.textContent = (startIdx + localRowIdx + 1).toLocaleString();
      tdNum.style.cssText = 'text-align:center;color:#64748b;font-weight:700;background:#f8fafc;border-right:1px solid #e2e8f0;font-size:11px;';
      tr.appendChild(tdNum);

      // 2. PDF Download Action Button
      var tdPdf = document.createElement('td');
      tdPdf.className = 'bai-td-pdf-action bai-sheet-td-action';
      tdPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;vertical-align:middle!important;padding:4px!important;';

      var pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'bai-btn-row-pdf dt-pdf-download-btn';
      pdfBtn.title = 'Download Edge-Paint Inspection Report PDF for Batch: ' + (row[1] || 'Row ' + (startIdx + localRowIdx + 1));
      pdfBtn.innerHTML = '<span class="material-icons-round">picture_as_pdf</span>';

      (function (capturedRow) {
        pdfBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          downloadRowInspectionReportPdf(capturedRow);
        });
      })(row);

      tdPdf.appendChild(pdfBtn);
      tr.appendChild(tdPdf);

      // 3. 31 Data Columns
      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.className = 'bai-td-data';
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        // Highlight selected cell
        if (selectedCell && selectedCell.r === localRowIdx && selectedCell.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Style specific columns
        if (colIdx === 1) { // Batch No
          td.style.fontWeight = '700';
          td.style.color = '#0284c7';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 4) { // Unit
          td.style.fontWeight = '700';
          td.style.color = '#15803d';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 5) { // Fabricator Name (No)
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
        } else if (colIdx === 9) { // SKU
          td.style.fontWeight = '700';
          td.style.color = '#7e22ce';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 12) { // Quantity
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 19 || colIdx === 28) { // STATUS / STATUS (JYOTI)
          var upperStatus = strVal.toUpperCase();
          if (upperStatus === 'DONE' || upperStatus === 'COMPLETE' || upperStatus === 'COMPLETED') {
            td.innerHTML = '<span class="bai-sheet-badge-done" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:700;padding:1px 6px;font-size:10.5px;">' + escapeHtml(strVal) + '</span>';
            td.addEventListener('mousedown', function () { selectCell(td, localRowIdx, colIdx); });
            tr.appendChild(td);
            return;
          } else if (upperStatus === 'PENDING') {
            td.innerHTML = '<span style="background:#fef3c7;color:#b45309;border:1px solid #fcd34d;font-weight:700;padding:1px 6px;font-size:10.5px;border-radius:2px;">' + escapeHtml(strVal) + '</span>';
            td.addEventListener('mousedown', function () { selectCell(td, localRowIdx, colIdx); });
            tr.appendChild(td);
            return;
          }
        } else if (colIdx === 20) { // Edge-Paint Fabricator
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
        } else if (colIdx === 21) { // Edge-Paint Checker
          td.style.fontWeight = '700';
          td.style.color = '#7c3aed';
        } else if (colIdx === 24) { // Checked Qty
          td.style.fontWeight = '700';
          td.style.color = '#0284c7';
        } else if (colIdx === 25) { // Repair Qty
          var rq = parseInt(strVal, 10);
          if (!isNaN(rq) && rq > 0) {
            td.style.fontWeight = '700';
            td.style.color = '#ef4444';
          }
        } else if (colIdx === 30) { // Time Delay
          var delayNum = parseInt(strVal, 10);
          if (!isNaN(delayNum) && delayNum > 0) {
            td.style.fontWeight = '700';
            td.style.color = '#ef4444';
          }
        }

        if (rawSearch && strVal.toLowerCase().indexOf(rawSearch) !== -1) {
          td.innerHTML = highlightMatch(strVal, rawSearch);
        } else {
          td.textContent = strVal;
        }

        // Cell Selection on mousedown
        td.addEventListener('mousedown', function () {
          selectCell(td, localRowIdx, colIdx);
        });

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  // ---------------------------------------------------------------------------
  // 11. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCell(td, localRowIdx, colIdx) {
    var tbody = document.getElementById('edge-paint-tbody');
    if (!tbody) return;

    if (selectedCell && selectedCell.el) {
      selectedCell.el.classList.remove('bai-cell-selected');
    }

    selectedCell = { r: localRowIdx, c: colIdx, el: td };
    td.classList.add('bai-cell-selected');

    if (td.scrollIntoViewIfNeeded) {
      td.scrollIntoViewIfNeeded(false);
    } else {
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    var badge = document.getElementById('edge-paint-active-cell-badge');
    if (badge) {
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var startIdx = (currentPage - 1) * pageSize;
      var actualRow = startIdx + localRowIdx + 1;
      badge.textContent = 'Selected: Row ' + actualRow + ', Col: ' + colName;
      badge.style.display = 'inline-block';
    }
  }

  function clearCellSelection() {
    if (selectedCell && selectedCell.el) {
      selectedCell.el.classList.remove('bai-cell-selected');
    }
    selectedCell = null;
    var badge = document.getElementById('edge-paint-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function getPaginationRange(current, total, maxVisible) {
    if (total <= maxVisible) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var half = Math.floor(maxVisible / 2);
    var start = Math.max(1, current - half);
    var end = Math.min(total, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    var res = [];
    for (var j = start; j <= end; j++) res.push(j);
    return res;
  }

  function updatePaginationControls(current, total) {
    var firstBtn = document.getElementById('btn-first-page-ep');
    var prevBtn = document.getElementById('btn-prev-page-ep');
    var nextBtn = document.getElementById('btn-next-page-ep');
    var lastBtn = document.getElementById('btn-last-page-ep');
    var pillsContainer = document.getElementById('edge-paint-page-pills');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;

    if (pillsContainer) {
      pillsContainer.innerHTML = '';
      if (total > 1) {
        var pillRange = getPaginationRange(current, total, 5);
        pillRange.forEach(function (p) {
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'floor-supervisor-page-pill edge-paint-page-pill' + (p === current ? ' active' : '');
          pill.textContent = p;
          pill.setAttribute('aria-label', 'Page ' + p);
          pill.addEventListener('click', function () {
            if (p !== currentPage) {
              currentPage = p;
              renderTablePage();
            }
          });
          pillsContainer.appendChild(pill);
        });
      }
    }
  }

  function updateRecordCountBadge() {
    var countBadge = document.getElementById('edge-paint-record-count');
    if (countBadge) {
      countBadge.textContent = filteredRows.length.toLocaleString() + ' of ' + allRows.length.toLocaleString() + ' records';
    }
  }

  // ---------------------------------------------------------------------------
  // 12. Row Fields Extractor & Inspection Report Builder
  // ---------------------------------------------------------------------------
  function extractRowFields(row) {
    if (!row) return {};
    var byHdr = function (pattern, fallbackIdx) {
      for (var i = 0; i < allHeaders.length; i++) {
        if (pattern.test(allHeaders[i])) return row[i] || '';
      }
      return row[fallbackIdx] || '';
    };

    return {
      fmsTimestamp:     byHdr(/fms\s*upload/i, 0),
      batchId:          byHdr(/bact?ch\s*no/i, 1),
      leatherDate:      byHdr(/leather\s*received/i, 2),
      creator:          byHdr(/creator/i, 3),
      unit:             byHdr(/unit/i, 4),
      fabricator:       byHdr(/fabricator\s*name\s*\(no/i, 5),
      brand:            byHdr(/brand/i, 6),
      season:           byHdr(/season/i, 7),
      category:         byHdr(/category/i, 8),
      sku:              byHdr(/sku/i, 9),
      styleNo:          byHdr(/fac\s*\/\s*ref|style/i, 10),
      colour:           byHdr(/colou?r/i, 11),
      quantity:         byHdr(/quantity|^qty$/i, 12),
      etd:              byHdr(/etd/i, 13),
      po:               byHdr(/po\s*as\s*per/i, 14),
      floorSup:         byHdr(/floor\s*supervisor/i, 15),
      inLineQc:         byHdr(/in.?line\s*qc/i, 16),
      plannedDate:      byHdr(/planned\s*date/i, 17),
      followupTs:       byHdr(/followup\s*timestamp/i, 18),
      status:           byHdr(/^status$/i, 19),
      edgeFabricator:   byHdr(/edge.?paint\s*fabricator/i, 20),
      edgeChecker:      byHdr(/edge.?paint\s*checker/i, 21),
      overlappingParts: byHdr(/overlapping\s*parts/i, 22),
      issueParts:       byHdr(/issue\s*parts/i, 23),
      checkedQty:       byHdr(/checked\s*qty/i, 24),
      repairQty:        byHdr(/repair\s*qty/i, 25),
      remarksFu:        byHdr(/remarks\s*\(follow/i, 26),
      actualTs:         byHdr(/actual\s*timestamp/i, 27),
      statusJyoti:      byHdr(/status\s*\(jyoti/i, 28),
      remarks:          byHdr(/^remarks$/i, 29),
      timeDelay:        byHdr(/delay/i, 30)
    };
  }

  var EDGE_PAINT_PARTS = [
    'লেবেল (LEBEL)',
    'ইনসাইড জিপ লুপ (INSIDE ZIP LOOP)',
    '৩ নং টাই (3 NO. TIE)',
    '৫ নং টাই (5 NO. TIE)',
    'গ্র্যাসেট লুপ (GRASSET LOOP)',
    'গ্র্যাসেট (GRASSET)',
    'হ্যান্ডেল লুপ (HANDLE LOOP)',
    'আপার লুপ (UPPER LOOP)',
    'বাদি (WADI)',
    'জিপ গার্ড (ZIP GUARD)',
    'আপার টপ (UPPER TOP)',
    'আপার (UPPER)',
    'বোলা (BOLA)',
    'ডি-লুপ (D-LOOP)',
    'ম্যাগনেট লুপ (MAGNET LOOP)',
    'তলা (TOLA)',
    'ফাইনাল ব্যাগ (FINAL BAG)',
    'গ্র্যাব হ্যান্ডেল লুপ (GRAB HANDLE LOOP)',
    'গ্র্যাব হ্যান্ডেল ফাইনাল (GRAB HANDLE FINAL)',
    'স্মল শোল্ডার হ্যান্ডেল (SMALL SHOULDER HANDLE)',
    'বিগ শোল্ডার হ্যান্ডেল (BIG SHOULDER HANDLE)',
    'জিপার পট্টি ইনসাইড (ZIPPER POTTI INSIDE)',
    'জিপার পট্টি আউটসাইড (ZIPPER POTTI OUTSIDE)',
    'শোল্ডার হ্যান্ডেল লুপ (SHOULDER HANDLE LOOP)',
    'আপার ইনসাইড পট্টি (ফ্রন্ট & ব্যাক) (UPPER INSIDE POTTI (FRONT & BACK))'
  ];

  function formatPdfGeneratedTime() {
    var d = new Date();
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var day = ('0' + d.getDate()).slice(-2);
    var mon = months[d.getMonth()];
    var yr = d.getFullYear();
    var hours = d.getHours();
    var mins = ('0' + d.getMinutes()).slice(-2);
    var ampm = hours >= 12 ? 'pm' : 'am';
    var h12 = hours % 12;
    h12 = h12 ? ('0' + h12).slice(-2) : '12';
    return day + '-' + mon + '-' + yr + ' ' + h12 + ':' + mins + ' ' + ampm;
  }

  function buildEdgePaintInspectionReportHtml(f) {
    var companyName = 'Trio Trend Exports Pvt. Ltd.';
    var reportTitle = 'EDGE-PAINT INSPECTION REPORT';
    var genTimestamp = formatPdfGeneratedTime();

    var TOTAL_ROWS = 30;
    var rowsHtml = '';
    for (var i = 1; i <= TOTAL_ROWS; i++) {
      var slStr = ('0' + i).slice(-2);
      var partName = (i <= EDGE_PAINT_PARTS.length) ? EDGE_PAINT_PARTS[i - 1] : '&nbsp;';
      rowsHtml +=
        '<tr>' +
        '<td class="td-sl">' + slStr + '</td>' +
        '<td class="td-parts">' + partName + '</td>' +
        '<td class="td-empty">&nbsp;</td>' +
        '<td class="td-empty">&nbsp;</td>' +
        '<td class="td-empty">&nbsp;</td>' +
        '<td class="td-empty">&nbsp;</td>' +
        '</tr>';
    }

    var css =
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
      'html, body {' +
      '  background: #f1f5f9;' +
      '  color: #000000;' +
      '  font-family: "Poppins", "Noto Sans Bengali", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
      '  -webkit-font-smoothing: antialiased;' +
      '}' +
      '.doc-page {' +
      '  width: 794px;' +
      '  margin: 10px auto;' +
      '  background: #ffffff;' +
      '  padding: 16px 20px 20px 20px;' +
      '  box-shadow: 0 4px 20px rgba(0,0,0,0.12);' +
      '  border: 1.5px solid #000000;' +
      '  box-sizing: border-box;' +
      '}' +
      '.top-row {' +
      '  display: flex;' +
      '  justify-content: space-between;' +
      '  align-items: center;' +
      '  margin-bottom: 5px;' +
      '}' +
      '.company-name {' +
      '  font-size: 11px;' +
      '  font-weight: 800;' +
      '  color: #000000;' +
      '  letter-spacing: 0.2px;' +
      '}' +
      '.gen-time {' +
      '  font-size: 9.5px;' +
      '  font-weight: 600;' +
      '  color: #000000;' +
      '}' +
      '.report-title {' +
      '  text-align: center;' +
      '  font-size: 13.5px;' +
      '  font-weight: 900;' +
      '  letter-spacing: 0.6px;' +
      '  text-transform: uppercase;' +
      '  margin-bottom: 6px;' +
      '  color: #000000;' +
      '}' +
      '.info-table {' +
      '  width: 100%;' +
      '  border-collapse: collapse;' +
      '  border: 1.5px solid #000000;' +
      '  table-layout: fixed;' +
      '  margin-bottom: 4px;' +
      '}' +
      '.info-table td {' +
      '  border: 1px solid #000000;' +
      '  padding: 3px 6px;' +
      '  font-size: 9.5px;' +
      '  color: #000000;' +
      '  vertical-align: middle;' +
      '  line-height: 1.25;' +
      '}' +
      '.info-table td strong {' +
      '  font-weight: 800;' +
      '  letter-spacing: 0.2px;' +
      '}' +
      '.sub-box-table {' +
      '  width: 100%;' +
      '  border-collapse: collapse;' +
      '  border: 1.5px solid #000000;' +
      '  table-layout: fixed;' +
      '  margin-bottom: 4px;' +
      '}' +
      '.sub-box-table td {' +
      '  border: 1px solid #000000;' +
      '  padding: 3px 6px;' +
      '  font-size: 9.5px;' +
      '  color: #000000;' +
      '  vertical-align: middle;' +
      '  line-height: 1.25;' +
      '}' +
      '.sub-box-table td strong {' +
      '  font-weight: 800;' +
      '}' +
      '.checklist-table {' +
      '  width: 100%;' +
      '  border-collapse: collapse;' +
      '  border: 1.5px solid #000000;' +
      '  table-layout: fixed;' +
      '}' +
      '.checklist-table th {' +
      '  border: 1px solid #000000;' +
      '  padding: 2px 2px;' +
      '  font-size: 8.5px;' +
      '  font-weight: 900;' +
      '  color: #000000;' +
      '  text-align: center;' +
      '  vertical-align: middle;' +
      '  line-height: 1.15;' +
      '  text-transform: uppercase;' +
      '  background: #ffffff;' +
      '}' +
      '.checklist-table td {' +
      '  border: 1px solid #000000;' +
      '  padding: 1.5px 2px;' +
      '  height: 17px;' +
      '  vertical-align: middle;' +
      '  color: #000000;' +
      '  line-height: 1.15;' +
      '}' +
      '.td-sl {' +
      '  text-align: center;' +
      '  font-size: 8.5px;' +
      '  font-weight: 800;' +
      '}' +
      '.td-parts {' +
      '  text-align: center;' +
      '  font-size: 9px;' +
      '  font-weight: 800;' +
      '  font-family: "Noto Sans Bengali", "Poppins", sans-serif;' +
      '  letter-spacing: 0.15px;' +
      '  padding: 1.5px 4px !important;' +
      '}' +
      '.td-empty {' +
      '  text-align: center;' +
      '}' +
      '.signatures-row {' +
      '  display: flex;' +
      '  justify-content: space-between;' +
      '  align-items: center;' +
      '  margin-top: 22px;' +
      '  padding: 0 4px;' +
      '  font-size: 9px;' +
      '  font-weight: 800;' +
      '  color: #000000;' +
      '}' +
      '@media print {' +
      '  body {' +
      '    background: #ffffff !important;' +
      '    padding: 0 !important;' +
      '    margin: 0 !important;' +
      '  }' +
      '  .doc-page {' +
      '    margin: 0 auto !important;' +
      '    padding: 6px 12px 10px 12px !important;' +
      '    box-shadow: none !important;' +
      '    border: none !important;' +
      '    width: 100% !important;' +
      '    max-width: 100% !important;' +
      '  }' +
      '  @page {' +
      '    size: A4 portrait;' +
      '    margin: 4mm 5mm;' +
      '  }' +
      '  * {' +
      '    -webkit-print-color-adjust: exact !important;' +
      '    print-color-adjust: exact !important;' +
      '  }' +
      '}';

    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>Edge-Paint Inspection Report - ' + escapeHtml(f.batchId || 'Batch') + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800;900&family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">' +
      '<style>' + css + '</style>' +
      '</head><body><div class="doc doc-page">' +
      '  <div class="top-row">' +
      '    <div class="company-name">' + escapeHtml(companyName) + '</div>' +
      '    <div class="gen-time">Generated at : ' + escapeHtml(genTimestamp) + '</div>' +
      '  </div>' +

      '  <div class="report-title">' + escapeHtml(reportTitle) + '</div>' +

      '  <!-- Box 1: Batch & Production Details -->' +
      '  <table class="info-table">' +
      '    <tr>' +
      '      <td style="width:28%;"><strong>BATCH ID:</strong> ' + escapeHtml(f.batchId || '') + '</td>' +
      '      <td style="width:29%;"><strong>PO:</strong> ' + escapeHtml(f.po || '') + '</td>' +
      '      <td style="width:23%;"><strong>FLOOR NO.:</strong> ' + escapeHtml(f.floorSup || f.floorNo || '') + '</td>' +
      '      <td style="width:20%;"><strong>UNIT:</strong> ' + escapeHtml(f.unit || '') + '</td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td><strong>STYLE NO.:</strong> ' + escapeHtml(f.styleNo || '') + '</td>' +
      '      <td><strong>SKU:</strong> ' + escapeHtml(f.sku || '') + '</td>' +
      '      <td colspan="2"><strong>FABRICATOR NAME/ NO.:</strong> ' + escapeHtml(f.fabricator || '') + '</td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td colspan="2"><strong>COLOUR:</strong> ' + escapeHtml(f.colour || '') + '</td>' +
      '      <td colspan="2"><strong>QTY:</strong> ' + escapeHtml(f.quantity || '') + '</td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td colspan="2"><strong>ETD:</strong> ' + escapeHtml(f.etd || '') + '</td>' +
      '      <td colspan="2"><strong>CHECKING DATE:</strong> ' + escapeHtml(f.actualTs || f.plannedDate || '') + '</td>' +
      '    </tr>' +
      '    <tr>' +
      '      <td colspan="4"><strong>REMARKS (IF ANY):</strong> ' + escapeHtml(f.remarks || f.remarksFu || '') + '</td>' +
      '    </tr>' +
      '  </table>' +

      '  <!-- Box 2: Checker Name & Overlapping Check -->' +
      '  <table class="sub-box-table">' +
      '    <tr>' +
      '      <td style="width:40%;"><strong>EDGE PAINT CHECKER NAME:</strong> ' + escapeHtml(f.edgeChecker || '') + '</td>' +
      '      <td style="width:60%; text-align:center;"><strong>OVERLAPPING — PLEASE TICK (✓) HERE UNDER YES / NO</strong></td>' +
      '    </tr>' +
      '  </table>' +

      '  <!-- Box 3: Main Table with 25 Bengali/English Parts + 5 Blank Rows -->' +
      '  <table class="checklist-table">' +
      '    <thead>' +
      '      <tr>' +
      '        <th style="width:6%;">SL.<br>NO.</th>' +
      '        <th style="width:44%;">PARTS</th>' +
      '        <th style="width:11%;">CHECKED<br>QTY</th>' +
      '        <th style="width:11%;">REPAIR<br>QTY</th>' +
      '        <th style="width:14%;">OVERLAPPING<br>(YES/NO)</th>' +
      '        <th style="width:14%;">REMARKS</th>' +
      '      </tr>' +
      '    </thead>' +
      '    <tbody>' + rowsHtml + '</tbody>' +
      '  </table>' +

      '  <!-- Signatures Row -->' +
      '  <div class="signatures-row">' +
      '    <div>Signature of Edge Paint Inspector _________________________</div>' +
      '    <div>Signature of the Approving Authority _________________________</div>' +
      '  </div>' +
      '</div></body></html>'
    );
  }

  function downloadRowInspectionReportPdf(row) {
    try {
      var f = extractRowFields(row);
      var html = buildEdgePaintInspectionReportHtml(f);

      var win = window.open('', '_blank', 'width=920,height=800');
      if (!win) {
        showToast('Popup blocked. Please allow popups to download the PDF.', 'error');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();

      var triggerPrint = function () {
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
      };

      if (win.document.fonts && win.document.fonts.ready) {
        win.document.fonts.ready.then(function () {
          setTimeout(triggerPrint, 250);
        }).catch(function () {
          setTimeout(triggerPrint, 400);
        });
      } else {
        setTimeout(triggerPrint, 400);
      }
    } catch (err) {
      console.error('Edge-Paint Row PDF error:', err);
      showToast('Could not generate PDF: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Full Table Landscape PDF Export (AutoTable + Fallback)
  // ---------------------------------------------------------------------------
  function exportFilteredTablePdf() {
    if (filteredRows.length === 0) {
      showToast('No records available to export.', 'info');
      return;
    }

    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (jsPDFCtor) {
      try {
        var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        var fontFamily = 'helvetica';
        if (typeof registerPdfFonts_ === 'function') {
          try { registerPdfFonts_(doc); fontFamily = 'IBMPlexSans'; } catch (e) { fontFamily = 'helvetica'; }
        }
        doc.setFont(fontFamily, 'normal');

        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var marginX = 20;

        // Header Title
        doc.setFont(fontFamily, 'bold');
        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        doc.text('EDGE-PAINT - INSPECTION & PRODUCTION REPORT', marginX, 28);

        // Purple line accent
        doc.setDrawColor(124, 58, 237);
        doc.setLineWidth(1.5);
        doc.line(marginX, 32, pageWidth - marginX, 32);

        doc.setFont(fontFamily, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        var genDateStr = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB');
        doc.text('Trio Trend Exports Pvt. Ltd. · Quality Assurance Division · Generated: ' + genDateStr + ' · Records: ' + filteredRows.length.toLocaleString(), marginX, 44);

        var exportCols = [
          { title: '#', dataKey: 'idx' },
          { title: 'Batch No.', dataKey: 'batchNo' },
          { title: 'Unit', dataKey: 'unit' },
          { title: 'Fabricator', dataKey: 'fabricator' },
          { title: 'Brand', dataKey: 'brand' },
          { title: 'SKU', dataKey: 'sku' },
          { title: 'Style', dataKey: 'style' },
          { title: 'Colour', dataKey: 'colour' },
          { title: 'Order Qty', dataKey: 'qty' },
          { title: 'Checked', dataKey: 'checkedQty' },
          { title: 'Repair', dataKey: 'repairQty' },
          { title: 'Overlapping', dataKey: 'overlapping' },
          { title: 'Issue Parts', dataKey: 'issueParts' },
          { title: 'Status', dataKey: 'status' },
          { title: 'Supervisor', dataKey: 'floorSup' },
          { title: 'EP Checker', dataKey: 'edgeChecker' },
          { title: 'Time Delay', dataKey: 'delay' }
        ];

        var tableBody = filteredRows.map(function (row, i) {
          return {
            idx: String(i + 1),
            batchNo: String(row[1] || ''),
            unit: String(row[4] || ''),
            fabricator: String(row[5] || ''),
            brand: String(row[6] || ''),
            sku: String(row[9] || ''),
            style: String(row[10] || ''),
            colour: String(row[11] || ''),
            qty: String(row[12] || ''),
            checkedQty: String(row[24] || ''),
            repairQty: String(row[25] || ''),
            overlapping: String(row[22] || ''),
            issueParts: String(row[23] || ''),
            status: String(row[19] || ''),
            floorSup: String(row[15] || ''),
            edgeChecker: String(row[21] || ''),
            delay: String(row[30] || '')
          };
        });

        doc.autoTable({
          columns: exportCols,
          body: tableBody,
          startY: 52,
          margin: { left: marginX, right: marginX, bottom: 30 },
          styles: {
            font: fontFamily,
            fontSize: 7.2,
            cellPadding: 3.2,
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
            textColor: [15, 23, 42]
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7.5,
            halign: 'center'
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252]
          },
          columnStyles: {
            idx: { cellWidth: 20, halign: 'center' },
            batchNo: { cellWidth: 62, fontStyle: 'bold' },
            unit: { cellWidth: 30, halign: 'center' },
            fabricator: { cellWidth: 68 },
            brand: { cellWidth: 44 },
            sku: { cellWidth: 42 },
            style: { cellWidth: 54 },
            colour: { cellWidth: 48 },
            qty: { cellWidth: 35, halign: 'right' },
            checkedQty: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
            repairQty: { cellWidth: 38, halign: 'right' },
            overlapping: { cellWidth: 42, halign: 'center' },
            issueParts: { cellWidth: 42, halign: 'center' },
            status: { cellWidth: 48, halign: 'center' },
            floorSup: { cellWidth: 64 },
            edgeChecker: { cellWidth: 68, fontStyle: 'bold' },
            delay: { cellWidth: 38, halign: 'center' }
          },
          didDrawPage: function (data) {
            var pageCount = doc.internal.getNumberOfPages();
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text('Page ' + data.pageNumber + ' of ' + pageCount, pageWidth - marginX - 45, pageHeight - 12);
            doc.text('Trio Trend Exports Pvt. Ltd. · Edge-Paint Inspection & Production Report · Confidential', marginX, pageHeight - 12);
          }
        });

        var filename = 'Edge_Paint_Report_' + new Date().toISOString().slice(0, 10) + '.pdf';
        doc.save(filename);
        showToast('PDF Export complete: ' + filename, 'download');
        return;
      } catch (err) {
        console.error('jsPDF autoTable export error, falling back to print window:', err);
      }
    }

    // Fallback: Elegant HTML Landscape Print Window with Trio Trend Logo & Dark Header
    try {
      var printWin = window.open('', '_blank', 'width=1200,height=850');
      if (!printWin) {
        showToast('Popup blocked. Please allow popups for PDF download.', 'error');
        return;
      }

      var dateStr = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var title = 'EDGE-PAINT INSPECTION & PRODUCTION REPORT';
      var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';

      var theadThs = '<th style="width:30px;">#</th>';
      allHeaders.forEach(function (h) {
        theadThs += '<th>' + escapeHtml(h) + '</th>';
      });

      var tbodyRows = '';
      filteredRows.forEach(function (row, idx) {
        tbodyRows += '<tr><td style="text-align:center;font-weight:700;">' + (idx + 1) + '</td>';
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
        '.rpt-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; position: relative; }' +
        '.rpt-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #7c3aed 0%, #a855f7 50%, #d97706 100%); }' +
        '.rpt-brand { display: flex; align-items: center; gap: 10px; }' +
        '.rpt-logo { height: 34px; width: auto; max-width: 120px; object-fit: contain; }' +
        '.rpt-title { font-size: 15px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }' +
        '.rpt-sub { font-size: 9.5px; color: #475569; font-weight: 700; text-transform: uppercase; margin-top: 1px; }' +
        '.rpt-meta { font-size: 10px; color: #334155; font-weight: 700; text-align: right; }' +
        '.rpt-badge { display: inline-block; background: #0f172a; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 3px; margin-bottom: 3px; }' +
        'table { width: 100%; border-collapse: collapse; font-size: 7.2px; }' +
        'th, td { border: 1px solid #cbd5e1; padding: 2.5px 3.5px; text-align: left; word-break: break-word; }' +
        'th { background: #0f172a; color: #f8fafc; font-weight: 700; text-transform: uppercase; font-size: 7px; text-align: center; }' +
        'tr:nth-child(even) td { background: #f8fafc; }' +
        '.rpt-footer { margin-top: 10px; display: flex; justify-content: space-between; font-size: 8.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; font-weight: 600; }' +
        '@media print { body { padding: 0 !important; } }' +
        '</style></head><body>' +
        '<div class="rpt-header">' +
        '<div class="rpt-brand">' +
        '<img class="rpt-logo" src="' + companyLogoUrl + '" alt="Trio Group" />' +
        '<div>' +
        '<div class="rpt-title">' + title + '</div>' +
        '<div class="rpt-sub">TRIO TREND EXPORTS PVT. LTD. &bull; Quality Assurance Division</div>' +
        '</div>' +
        '</div>' +
        '<div class="rpt-meta">' +
        '<div class="rpt-badge">EXPORT REPORT</div>' +
        '<div>Date: <strong>' + dateStr + '</strong> &bull; Records: <strong>' + filteredRows.length + '</strong></div>' +
        '</div>' +
        '</div>' +
        '<table><thead><tr>' + theadThs + '</tr></thead><tbody>' + tbodyRows + '</tbody></table>' +
        '<div class="rpt-footer">' +
        '<span>Trio Trend Exports Pvt. Ltd. &bull; Edge-Paint Quality System &bull; Confidential Document</span>' +
        '<span>Form Ref: FMS-EP-01</span>' +
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
      console.error('Edge-Paint Table PDF Export Error:', err);
      showToast('Export error: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 14. Excel Export (.xlsx via SheetJS)
  // ---------------------------------------------------------------------------
  function exportFilteredTableExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS (XLSX) library is loading, please try again.', 'warning');
      return;
    }

    if (filteredRows.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }

    showToast('Generating Excel file...', 'clock');

    setTimeout(function () {
      try {
        var aoa = [];
        var headersRow = ['#'].concat(allHeaders);
        aoa.push(headersRow);

        filteredRows.forEach(function (row, idx) {
          var r = [idx + 1];
          for (var c = 0; c < NUM_COLS; c++) {
            var cellVal = row[c] !== undefined && row[c] !== null ? row[c] : '';
            r.push(cellVal);
          }
          aoa.push(r);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Auto column widths
        var colWidths = [{ wch: 6 }];
        for (var c = 0; c < NUM_COLS; c++) {
          var maxLen = String(allHeaders[c] || '').length;
          for (var r = 0; r < Math.min(filteredRows.length, 50); r++) {
            var valStr = String(filteredRows[r][c] || '');
            if (valStr.length > maxLen) maxLen = valStr.length;
          }
          colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 10), 40) });
        }
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Edge-Paint Data');

        var filename = 'Edge_Paint_Data_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, filename);

        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to ' + filename, 'success');
      } catch (e) {
        console.error('Edge-Paint Excel export error:', e);
        showToast('Excel export failed: ' + e.message, 'error');
      }
    }, 40);
  }

  // ---------------------------------------------------------------------------
  // 15. UI Feedback & Toast Notifications (NO Emojis)
  // ---------------------------------------------------------------------------
  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('edge-paint-sheet-sync-banner');
    var syncMsg = document.getElementById('edge-paint-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('edge-paint-sheet-sync-icon');

    if (syncBanner) syncBanner.style.display = syncing ? 'flex' : 'none';
    if (syncMsg && msg) syncMsg.textContent = msg;
    if (syncBtnIcon) {
      if (syncing) {
        syncBtnIcon.classList.add('bai-sheet-spin');
      } else {
        syncBtnIcon.classList.remove('bai-sheet-spin');
      }
    }
  }

  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('edge-paint-sheet-toast');
    if (existing) existing.remove();

    var cleanMsg = String(msg || '')
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    var type = customType || 'info';
    var iconKey = 'info';

    var lower = cleanMsg.toLowerCase();
    if (type === 'error' || lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1) {
      type = 'error';
      iconKey = 'error';
    } else if (lower.indexOf('no records') !== -1 || lower.indexOf('not ready') !== -1 || lower.indexOf('warning') !== -1) {
      type = 'warning';
      iconKey = 'warning';
    } else if (lower.indexOf('saved') !== -1 || lower.indexOf('synced') !== -1 || lower.indexOf('cached') !== -1 || lower.indexOf('ready') !== -1) {
      type = 'success';
      iconKey = 'check';
    } else if (lower.indexOf('exported') !== -1) {
      type = 'success';
      iconKey = 'download';
    } else if (lower.indexOf('generating') !== -1 || lower.indexOf('downloading') !== -1) {
      type = 'warning';
      iconKey = 'clock';
    } else if (lower.indexOf('filter') !== -1) {
      type = 'info';
      iconKey = 'filter';
    } else if (lower.indexOf('sort') !== -1) {
      type = 'info';
      iconKey = 'sort';
    }

    var iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.info;

    var toast = document.createElement('div');
    toast.id = 'edge-paint-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3600);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // 16. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in "PDF" page
    var kpiCard = document.getElementById('kpi-pdf-edge-paint');
    if (kpiCard) {
      kpiCard.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showView();
      }, true);
      kpiCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopImmediatePropagation();
          showView();
        }
      }, true);
    }

    // Back to PDF Button
    var backBtn = document.getElementById('btn-back-pdf-edge-paint');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-sync-edge-paint-sheet');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-edge-paint-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportFilteredTableExcel();
      }, true);
    }

    // Export Table PDF Button
    var exportPdfBtn = document.getElementById('btn-export-edge-paint-pdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportFilteredTablePdf();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('edge-paint-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('edge-paint-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        applyAllFiltersAndSearch();
      });
    }

    // Page Size Select
    var pageSizeSelect = document.getElementById('edge-paint-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('btn-first-page-ep');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('btn-prev-page-ep');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('btn-next-page-ep');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('btn-last-page-ep');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageInput = document.getElementById('edge-paint-page-input');
    if (pageInput) {
      pageInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > totalPages) val = totalPages;
          currentPage = val;
          renderTablePage();
        }
      });
      pageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('edge-paint-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('edge-paint-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('edge-paint-filter-search-input');
    var popSearchClear = document.getElementById('edge-paint-filter-search-clear');
    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClear) {
          popSearchClear.style.display = this.value ? 'block' : 'none';
        }
        renderFilterList();
      });
    }
    if (popSearchClear) {
      popSearchClear.addEventListener('click', function () {
        if (popSearchInput) {
          popSearchInput.value = '';
          currentFilterSearchQuery = '';
          popSearchClear.style.display = 'none';
          popSearchInput.focus();
        }
        renderFilterList();
      });
    }

    var popSelectAllBtn = document.getElementById('edge-paint-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase();
        currentFilterUniqueValues.forEach(function (val) {
          if (!q || val.toLowerCase().indexOf(q) !== -1) {
            currentFilterSelectedSet.add(val);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('edge-paint-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (val) {
            if (val.toLowerCase().indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(val);
            }
          });
        }
        renderFilterList();
      });
    }

    var sortAscBtn = document.getElementById('edge-paint-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var va = a[ci] !== undefined && a[ci] !== null ? String(a[ci]).trim() : '';
          var vb = b[ci] !== undefined && b[ci] !== null ? String(b[ci]).trim() : '';
          if (va === '' && vb !== '') return 1;
          if (va !== '' && vb === '') return -1;
          return va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted column ' + (allHeaders[ci] || '') + ' Ascending', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('edge-paint-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var va = a[ci] !== undefined && a[ci] !== null ? String(a[ci]).trim() : '';
          var vb = b[ci] !== undefined && b[ci] !== null ? String(b[ci]).trim() : '';
          if (va === '' && vb !== '') return 1;
          if (va !== '' && vb === '') return -1;
          return vb.localeCompare(va, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted column ' + (allHeaders[ci] || '') + ' Descending', 'sort');
      });
    }

    // Reset Column Filter
    var resetFilterBtn = document.getElementById('edge-paint-filter-reset-btn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          var colName = allHeaders[currentFilterColIdx];
          delete activeColumnFilters[currentFilterColIdx];
          applyAllFiltersAndSearch();
          closeColumnFilterPopover();
          showToast('Reset filter on ' + colName, 'filter');
        }
      });
    }

    // Cancel Popover
    var cancelFilterBtn = document.getElementById('edge-paint-filter-cancel-btn');
    if (cancelFilterBtn) {
      cancelFilterBtn.addEventListener('click', closeColumnFilterPopover);
    }

    // OK Apply Filter
    var okFilterBtn = document.getElementById('edge-paint-filter-ok-btn');
    if (okFilterBtn) {
      okFilterBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        var totalVals = currentFilterUniqueValues.length;

        if (currentFilterSelectedSet.size >= totalVals) {
          delete activeColumnFilters[ci];
        } else {
          activeColumnFilters[ci] = new Set(currentFilterSelectedSet);
        }

        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Applied filter on ' + (allHeaders[ci] || ''), 'filter');
      });
    }

    // Keyboard Navigation for Table Cells
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('pdf-edge-paint-view');
      if (!view || view.style.display === 'none') return;

      var popover = document.getElementById('edge-paint-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (e.key === 'Escape') closeColumnFilterPopover();
        return;
      }

      if (!selectedCell) return;

      var targetTag = e.target && e.target.tagName;
      if (targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA') {
        return;
      }

      var r = selectedCell.r;
      var c = selectedCell.c;
      var startIdx = (currentPage - 1) * pageSize;
      var pageRows = filteredRows.slice(startIdx, Math.min(startIdx + pageSize, filteredRows.length));
      var maxR = pageRows.length - 1;
      var maxC = NUM_COLS - 1;

      var handled = false;
      var nextR = r;
      var nextC = c;

      if (e.key === 'ArrowUp') {
        if (r > 0) { nextR = r - 1; handled = true; }
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        if (r < maxR) { nextR = r + 1; handled = true; }
      } else if (e.key === 'ArrowLeft') {
        if (c > 0) { nextC = c - 1; handled = true; }
      } else if (e.key === 'ArrowRight') {
        if (c < maxC) { nextC = c + 1; handled = true; }
      } else if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (c > 0) { nextC = c - 1; handled = true; }
          else if (r > 0) { nextR = r - 1; nextC = maxC; handled = true; }
        } else {
          if (c < maxC) { nextC = c + 1; handled = true; }
          else if (r < maxR) { nextR = r + 1; nextC = 0; handled = true; }
        }
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        var tbody = document.getElementById('edge-paint-tbody');
        if (tbody) {
          var targetTd = tbody.querySelector('td.bai-td-data[data-r="' + nextR + '"][data-c="' + nextC + '"]');
          if (targetTd) {
            selectCell(targetTd, nextR, nextC);
          }
        }
      }
    });

    // Copy to Clipboard (Ctrl+C / Cmd+C)
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('pdf-edge-paint-view');
      if (!view || view.style.display === 'none') return;

      if (window.getSelection && window.getSelection().toString().length > 0) {
        return;
      }

      if (selectedCell) {
        var startIdx = (currentPage - 1) * pageSize;
        var row = filteredRows[startIdx + selectedCell.r];
        if (row) {
          var val = row[selectedCell.c];
          var text = (val !== undefined && val !== null) ? String(val).trim() : '';

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            if (selectedCell.el) {
              selectedCell.el.classList.remove('bai-cell-copied');
              void selectedCell.el.offsetWidth;
              selectedCell.el.classList.add('bai-cell-copied');
              setTimeout(function () {
                if (selectedCell && selectedCell.el) selectedCell.el.classList.remove('bai-cell-copied');
              }, 500);
            }

            var displayPreview = text;
            if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
            if (displayPreview === '') displayPreview = '(Blank)';
            showToast('Copied: "' + displayPreview + '"', 'copy');
          }
        }
      }
    });

    // Click outside table: clear active selection
    document.addEventListener('mousedown', function (e) {
      if (!selectedCell) return;
      var table = document.getElementById('edge-paint-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key to close popover or clear selection
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('edge-paint-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (selectedCell) {
          clearCellSelection();
        }
      }
    });

    // Close popover on document click outside
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('edge-paint-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    window.addEventListener('resize', function () {
      closeColumnFilterPopover();
    });
  }

  // ---------------------------------------------------------------------------
  // 17. View Lifecycle: Show / Hide
  // ---------------------------------------------------------------------------
  function showView() {
    injectEdgePaintStyles();
    var kpiView = document.getElementById('pdf-kpi-view');
    var fsView  = document.getElementById('pdf-floor-supervisor-view');
    var iqcView = document.getElementById('pdf-inline-qc-view');
    var eqcView = document.getElementById('pdf-endline-qc-view');
    var epView  = document.getElementById('pdf-edge-paint-view');

    if (kpiView) kpiView.style.display = 'none';
    if (fsView)  fsView.style.display  = 'none';
    if (iqcView) iqcView.style.display = 'none';
    if (eqcView) eqcView.style.display = 'none';
    if (epView)  epView.style.display  = 'block';

    if (window.FloorSupervisorSheetEngine && typeof window.FloorSupervisorSheetEngine.clearSelection === 'function') {
      window.FloorSupervisorSheetEngine.clearSelection();
    }
    if (window.InLineQcSheetEngine && typeof window.InLineQcSheetEngine.clearSelection === 'function') {
      window.InLineQcSheetEngine.clearSelection();
    }
    if (window.EndLineQcSheetEngine && typeof window.EndLineQcSheetEngine.clearSelection === 'function') {
      window.EndLineQcSheetEngine.clearSelection();
    }

    if (typeof window.hideSpinner === 'function') window.hideSpinner();
    var overlay = document.getElementById('spinner-overlay');
    if (overlay) overlay.style.display = 'none';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) {
        filteredRows = allRows.slice();
      }
      renderHeaderRow();
      renderTablePage();
      updateHeaderBadge();
    } else {
      initDataEngine();
    }

    setTimeout(function () {
      var searchInput = document.getElementById('edge-paint-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var epView  = document.getElementById('pdf-edge-paint-view');
    if (epView)  epView.style.display  = 'none';
    if (kpiView) kpiView.style.display = 'block';
    closeColumnFilterPopover();
    clearCellSelection();
    if (typeof applyKpiCardAccess === 'function') {
      applyKpiCardAccess();
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('edge-paint-sheet-db-badge');
    var syncText = document.getElementById('edge-paint-sheet-sync-status');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#8b5cf6;">bolt</span> ' +
        (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
        syncText.textContent = 'Last synced: ' + timeStr;
      } else {
        syncText.textContent = 'Local Cache Ready';
      }
    }
    updateRecordCountBadge();
  }

  // ---------------------------------------------------------------------------
  // 18. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    injectEdgePaintStyles();
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        updateHeaderBadge();
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose global interface
  window.EdgePaintSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportFilteredTableExcel,
    exportPdf: exportFilteredTablePdf,
    downloadRowPdf: downloadRowInspectionReportPdf,
    buildReportHtml: buildEdgePaintInspectionReportHtml,
    extractRowFields: extractRowFields,
    clearSelection: clearCellSelection,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
