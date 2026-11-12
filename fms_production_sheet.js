/**
 * =============================================================================
 * FMS-Production Details Live Engine (IndexedDB + Fast GVIZ CSV)
 * =============================================================================
 * Sheet: PRODUCTION
 * Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E
 * GID: 551938618
 * Range: B7:ES (148 Columns)
 * Header Groups:
 *   Level 1: 13 Groups (148 Columns)
 *   Level 2: 15 Groups (148 Columns)
 *   Level 3: 148 Base Column Headers (B7:ES7)
 * Database: IndexedDB 'FMS_Production_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing from Google Sheet
 *   - 3-Level hierarchical sticky group headers with distinct color coding
 *   - Instant client-side Search across all 148 columns
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - High performance table layout with cell borders, text wrapping, and freeze
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with multi-row merged headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '551938618';
  var SHEET_NAME = 'PRODUCTION';

  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B7:ES';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B7:ES';

  var DB_NAME = 'FMS_Production_DB_v1';
  var DB_VERSION = 2;
  var STORE_NAME = 'fms_production_store';

  // 2-Level Group Headers Specification (Col counts: 7+18+14+18+9+9+9+9+12+10+14+14+5 = 148)
  var HEADER_GROUPS = [
    // Level 1 (Row 5 in Sheet)
    [
      { label: 'BATCH CUTTING DETAILS', colspan: 7, theme: 'fp-bantala' },
      { label: 'AFTER ERP ISSUE', colspan: 18, theme: 'fp-erp' },
      { label: 'AFTER MATERIAL HANDOVER TO FABRICATOR', colspan: 14, theme: 'fp-edge' },
      { label: 'WHEN 20% PRODUCTION TIME COMPLETE', colspan: 18, theme: 'fp-20' },
      { label: 'WHEN 45% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fp-45' },
      { label: 'WHEN 60% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fp-60' },
      { label: 'WHEN 75% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fp-75' },
      { label: 'WHEN 80% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fp-80' },
      { label: 'WHEN 90% PRODUCTION TIME COMPLETE', colspan: 12, theme: 'fp-90' },
      { label: 'WHEN 92% PRODUCTION TIME COMPLETE', colspan: 10, theme: 'fp-92' },
      { label: 'WHEN 95% PRODUCTION TIME COMPLETE', colspan: 14, theme: 'fp-95' },
      { label: 'WHEN 98% PRODUCTION TIME COMPLETE', colspan: 14, theme: 'fp-98' },
      { label: 'WHEN 100% PRODUCTION TIME COMPLETE', colspan: 5, theme: 'fp-100' }
    ],
    // Level 2 (Row 6 in Sheet)
    [
      { label: 'BANTALA DETAILS', colspan: 7, theme: 'fp-bantala' },
      { label: 'FMS UPLOAD DETAILS', colspan: 17, theme: 'fp-erp' },
      { label: 'SHYAMA DA', colspan: 1, theme: 'fp-shyama' },
      { label: 'EDGE-PAINT PART', colspan: 14, theme: 'fp-edge' },
      { label: '1ST FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fp-20' },
      { label: '1ST FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fp-20-qc' },
      { label: '2ND FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fp-45' },
      { label: '2ND FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fp-60' },
      { label: '3RD FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fp-75' },
      { label: '3RD FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fp-80' },
      { label: 'END-LINE QC PART', colspan: 12, theme: 'fp-90' },
      { label: 'WAREHOUSE PART', colspan: 10, theme: 'fp-92' },
      { label: 'PRE-AQL PART', colspan: 14, theme: 'fp-95' },
      { label: 'POST AQL PART', colspan: 14, theme: 'fp-98' },
      { label: 'SHIPMENT', colspan: 5, theme: 'fp-100' }
    ]
  ];

  // Helper to find Level 2 role context for any column index (0-147)
  function getColumnGroupLabel(colIdx) {
    if (colIdx < 7) return 'Bantala Details';
    if (colIdx < 24) return 'FMS Upload Details';
    if (colIdx === 24) return 'Shyama Da (Production Days)';
    if (colIdx < 39) return 'Edge-Paint Part';
    if (colIdx < 48) return '1st Follow Up - Floor Supervisor (20%)';
    if (colIdx < 57) return '1st Follow Up - In Line QC (20%)';
    if (colIdx < 66) return '2nd Follow Up - Floor Supervisor (45%)';
    if (colIdx < 75) return '2nd Follow Up - In Line QC (60%)';
    if (colIdx < 84) return '3rd Follow Up - Floor Supervisor (75%)';
    if (colIdx < 93) return '3rd Follow Up - In Line QC (80%)';
    if (colIdx < 105) return 'End-Line QC Part (90%)';
    if (colIdx < 115) return 'Warehouse Part (92%)';
    if (colIdx < 129) return 'Pre-AQL Part (95%)';
    if (colIdx < 143) return 'Post AQL Part (98%)';
    return 'Shipment (100%)';
  }

  // Base 148 default headers (fallback if offline initial)
  var defaultBaseHeaders = [
    'CUTTING DATE', 'SENDING DATE', 'ERP DATE', 'MATERIAL ISSUED DATE', 'MATERIAL HANDOVER TO FEBRICATOR DATE',
    '100% MATERIAL COMPLETED DATE', 'Material Due or OK Status', 'FMS UPLOAD TIMESTAMP', 'BACTCH NO.', 'LEATHER RECEIVED DATE',
    'CREATOR (DOER)', 'UNIT', 'FABRICATOR NAME (NO)', 'BRAND', 'SEASON',
    'CATEGORY', 'SKU', 'FAC / REF NO', 'COLOUR', 'QUANTITY',
    'ETD AS PER ORDER', 'PO AS PER BUYER', 'FLOOR SUPERVISOR NAME', 'INLINE QC NAME', 'PRODUCTION DAYS',
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'EDGE-PAINT FABRICATOR NAME', 'EDGE-PAINT CHECKER NAME',
    'OVERLAPPING PARTS', 'ISSUE PARTS', 'CHECKED QTY', 'REPAIR QTY', 'REMARKS (FOLLOW UP)',
    'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'TIME DELAY', 'PLANNED DATE',
    'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)', 'REMARKS', 'DELAY', 'PLANNED DATE', 'FOLLOWUP TIMESTAMP',
    'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)',
    'REMARKS', 'DELAY', 'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS',
    'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS',
    'DELAY', 'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED',
    'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS',
    'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY', 'PLANNED DATE',
    'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)', 'REMARKS', 'DELAY', 'PLANNED DATE', 'FOLLOWUP TIMESTAMP',
    'STATUS', 'TOTAL CHECKED QTY', 'QUANTITY SEND TO WAREHOUSE', 'TOTAL REPAIR QTY', 'PENDING QTY',
    'REMARKS (FOLLOW UP)', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    'PLANNED DATE', 'WAREHOUSE RECEIVED DATE', 'RECEIVE QTY', 'CHALLAN NO.', 'DUE QTY',
    'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'RECEIVE QTY', 'CHECK QTY',
    'CHECKED %', 'ISSUE PARTS', 'REPAIR QTY', 'RE-WORK AT WAREHOUSE STATUS', 'REMARKS',
    'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS (FOLLOW UP)', 'DELAY', 'PLANNED DATE',
    'FOLLOWUP TIMESTAMP', 'STATUS', 'RECEIVE QTY', 'CHECK QTY', 'CHECKED %',
    'ISSUE PARTS', 'REPAIR QTY', 'RE-WORK AT WAREHOUSE STATUS', 'REMARKS', 'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)', 'Remarks (Follow Up)', 'DELAY', 'PLANNED DATE', 'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)', 'REMARKS', 'DELAY'
  ];

  // State
  var dbInstance = null;
  var allHeaders = defaultBaseHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var lastSyncTime = null;
  var searchDebounceTimer = null;

  // Column Filters State
  var activeColumnFilters = {}; // colIdx -> Set of allowed string values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: rowIndex, c: colIndex }

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Engine
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME)) {
        return resolve(dbInstance);
      }
      dbInstance = null;
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this browser.'));
      }
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
          console.warn('[FMSProduction] Store missing in ' + DB_NAME + ', auto-repairing...');
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
        reject(e.target.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  function getFromDB(key) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve(null);
          }
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(null); };
        } catch (err) {
          console.warn('[FMSProduction] getFromDB error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function () { return Promise.resolve(null); });
  }

  function putToDB(key, val) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve(false);
          }
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var req = store.put(val, key);
          req.onsuccess = function () { resolve(true); };
          req.onerror = function () { resolve(false); };
        } catch (err) {
          console.warn('[FMSProduction] putToDB error:', err);
          dbInstance = null;
          resolve(false);
        }
      });
    }).catch(function () { return Promise.resolve(false); });
  }

  // ---------------------------------------------------------------------------
  // 2. High Speed In-Memory RFC-4180 CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    var ret = [];
    var row = [''];
    var inQuotes = false;
    var p = '';
    var r = 0;
    var len = text.length;

    for (var i = 0; i < len; i++) {
      var cc = text[i];
      var nc = text[i + 1];

      if (cc === '"') {
        if (inQuotes && nc === '"') {
          row[r] += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (cc === ',' && !inQuotes) {
        r++;
        row[r] = '';
      } else if ((cc === '\r' || cc === '\n') && !inQuotes) {
        if (cc === '\r' && nc === '\n') i++;
        ret.push(row);
        row = [''];
        r = 0;
      } else {
        row[r] += cc;
      }
      p = cc;
    }
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      ret.push(row);
    }
    // Clean trailing empty rows
    return ret.filter(function (rw, idx) {
      if (idx === ret.length - 1 && rw.length === 1 && rw[0] === '') return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Fast Network Sync from Google Sheet (Primary Export, GViz Fallback)
  // ---------------------------------------------------------------------------
  function fetchCSVWithFallback() {
    var ts = Date.now();
    return fetch(PRIMARY_CSV_URL + '&_=' + ts, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary export HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) throw new Error('Primary payload empty');
        return csvText;
      })
      .catch(function (err) {
        console.warn('Primary export fetch failed, trying GViz fallback...', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { cache: 'no-cache' }).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP status ' + res2.status);
          return res2.text();
        });
      });
  }

  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, 'Fetching FMS-Production data from Google Sheet...');

    fetchCSVWithFallback()
      .then(function (csvText) {
        if (!csvText || csvText.trim().length === 0) {
          throw new Error('Google Sheet returned empty response.');
        }

        var parsed = parseCSV(csvText);
        if (!parsed || parsed.length === 0) {
          throw new Error('Could not parse CSV data.');
        }

        // Header is row 0 (Row 7 of Sheet)
        var rawHeaders = parsed[0];
        if (rawHeaders && rawHeaders.length > 0) {
          allHeaders = rawHeaders.map(function (h) {
            return String(h || '').trim();
          });
        }
        if (allHeaders.length < 148) {
          for (var fi = allHeaders.length; fi < 148; fi++) {
            allHeaders.push(defaultBaseHeaders[fi] || ('Col ' + (fi + 1)));
          }
        }

        var colLen = allHeaders.length;
        var dataRows = [];
        for (var i = 1; i < parsed.length; i++) {
          var row = parsed[i];
          var hasContent = false;
          for (var c = 0; c < row.length; c++) {
            if (row[c] && String(row[c]).trim() !== '') {
              hasContent = true;
              break;
            }
          }
          if (hasContent) {
            var normalizedRow = new Array(colLen);
            for (var k = 0; k < colLen; k++) {
              normalizedRow[k] = (row[k] !== undefined && row[k] !== null) ? String(row[k]).trim() : '';
            }
            dataRows.push(normalizedRow);
          }
        }

        allRows = dataRows;
        lastSyncTime = Date.now();

        // Save to IndexedDB
        return Promise.all([
          putToDB('headers', allHeaders),
          putToDB('rows', allRows),
          putToDB('lastSyncTime', lastSyncTime)
        ]);
      })
      .then(function () {
        isSyncing = false;
        updateSyncUI(false);
        updateHeaderBadge();
        applyAllFiltersAndSearch();
        if (isManual) {
          showToast('FMS-Production data synced (' + allRows.length.toLocaleString() + ' rows)', 'success');
        }
      })
      .catch(function (err) {
        console.error('FMS-Production sync error:', err);
        isSyncing = false;
        updateSyncUI(false);
        updateHeaderBadge();
        if (allRows.length === 0) {
          renderEmptyState('Failed to load data: ' + (err.message || 'Network error'));
        }
        if (isManual) {
          showToast('Sync failed: ' + (err.message || 'Network error'), 'error');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Initial Engine Setup
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    Promise.all([
      getFromDB('headers'),
      getFromDB('rows'),
      getFromDB('lastSyncTime')
    ])
      .then(function (results) {
        var cachedHeaders = results[0];
        var cachedRows = results[1];
        var cachedSync = results[2];

        if (cachedHeaders && cachedHeaders.length > 0) {
          allHeaders = cachedHeaders;
        }
        if (cachedRows && cachedRows.length > 0) {
          allRows = cachedRows;
          lastSyncTime = cachedSync || null;
          updateHeaderBadge();
          renderHeaderRow();
          applyAllFiltersAndSearch();
          // Silently refresh in background
          syncFromGoogleSheet(false);
        } else {
          // No cache yet, fetch immediately
          renderHeaderRow();
          renderEmptyState('Initializing Database cache...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('IndexedDB initial read error:', err);
        renderHeaderRow();
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Dynamic Hierarchical Header Builder
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('fms-prod-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Level 1 & Level 2 Group Headers
    HEADER_GROUPS.forEach(function (groupRow, rowIndex) {
      var trGroup = document.createElement('tr');
      trGroup.className = 'fms-prod-thead-group fms-prod-thead-level-' + (rowIndex + 1);

      groupRow.forEach(function (group) {
        var th = document.createElement('th');
        th.className = 'fms-prod-th-group fms-prod-th-theme-' + (group.theme || 'fp-bantala');
        th.colSpan = Math.max(parseInt(group.colspan, 10) || 1, 1);
        th.textContent = group.label || '';
        trGroup.appendChild(th);
      });

      thead.appendChild(trGroup);
    });

    // Level 3: Base Column Headers (148 Columns)
    var trBase = document.createElement('tr');
    trBase.className = 'fms-prod-thead-base';

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'fms-prod-th-col';
      if (colIdx === 0) {
        th.classList.add('fms-prod-th-freeze-0');
      }
      th.setAttribute('data-col-idx', colIdx);

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'fms-prod-th-content';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'fms-prod-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = '[' + getColumnGroupLabel(colIdx) + '] ' + hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'fms-prod-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (hasFilter ? 'filter_alt' : 'filter_list') + '</span>';

      filterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openColumnFilterPopover(colIdx, filterBtn);
      });

      inner.appendChild(labelSpan);
      inner.appendChild(filterBtn);
      th.appendChild(inner);

      trBase.appendChild(th);
    });

    thead.appendChild(trBase);
  }

  // ---------------------------------------------------------------------------
  // 6. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('fms-prod-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];

    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Global Search across all columns
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) {
            return false;
          }
        }
      }

      // 2. Parallel Column Filters
      for (var f = 0; f < activeFilterColKeys.length; f++) {
        var colIdx = parseInt(activeFilterColKeys[f], 10);
        var allowedSet = activeColumnFilters[colIdx];
        if (allowedSet && allowedSet.size > 0) {
          var cellVal = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          var lookupKey = cellVal === '' ? '(Blanks)' : cellVal;
          if (!allowedSet.has(lookupKey)) {
            return false;
          }
        }
      }

      return true;
    });

    currentPage = 1;
    renderActiveFilterChips();
    renderHeaderFilterIndicators();
    renderTablePage();
  }

  function renderHeaderFilterIndicators() {
    var thead = document.getElementById('fms-prod-sheet-thead');
    if (!thead) return;

    thead.querySelectorAll('.fms-prod-th-col').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.fms-prod-col-filter-btn');
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

  function renderActiveFilterChips() {
    var bar = document.getElementById('fms-prod-sheet-active-filters-bar');
    var container = document.getElementById('fms-prod-sheet-active-filters-chips');
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
      var groupLabel = getColumnGroupLabel(colIdx);
      var allowedSet = activeColumnFilters[colIdx];
      var totalVals = getUniqueValuesForColumn(colIdx).length;
      var selectedCount = allowedSet.size;

      var chip = document.createElement('div');
      chip.className = 'fms-prod-filter-chip';

      var fullLabel = groupLabel + ' \u203A ' + colName;

      var textSpan = document.createElement('span');
      textSpan.className = 'fms-prod-filter-chip-text';
      textSpan.textContent = fullLabel + ' (' + selectedCount + '/' + totalVals + ')';
      textSpan.title = fullLabel + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'fms-prod-filter-chip-remove';
      removeBtn.title = 'Remove filter for ' + fullLabel;
      removeBtn.innerHTML = '✕';
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
  // 7. Column Filter Popover
  // ---------------------------------------------------------------------------
  function getUniqueValuesForColumn(colIdx) {
    var valCounts = {};
    allRows.forEach(function (row) {
      var raw = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
      var val = raw === '' ? '(Blanks)' : raw;
      valCounts[val] = (valCounts[val] || 0) + 1;
    });

    var keys = Object.keys(valCounts);
    keys.sort(function (a, b) {
      if (a === '(Blanks)') return 1;
      if (b === '(Blanks)') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    return keys.map(function (k) {
      return { val: k, count: valCounts[k] };
    });
  }

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('fms-prod-sheet-filter-popover');
    var titleEl = document.getElementById('fms-prod-sheet-filter-pop-title');
    var searchInput = document.getElementById('fms-prod-sheet-filter-search-input');
    var clearSearchBtn = document.getElementById('fms-prod-sheet-filter-search-clear');

    if (!popover) return;

    var colName = allHeaders[colIdx] || ('Column ' + (colIdx + 1));
    var groupLabel = getColumnGroupLabel(colIdx);
    if (titleEl) {
      titleEl.textContent = 'Filter: ' + colName;
      titleEl.title = groupLabel + ' \u203A ' + colName;
    }

    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    var uniquesWithCounts = getUniqueValuesForColumn(colIdx);
    currentFilterUniqueValues = uniquesWithCounts.map(function (x) { return x.val; });
    currentFilterValueCounts = {};
    uniquesWithCounts.forEach(function (x) {
      currentFilterValueCounts[x.val] = x.count;
    });

    if (activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterValuesList();

    // Position Popover safely within viewport
    popover.style.display = 'flex';
    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 310;
    var left = rect.left;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - popWidth - 16;
    }
    if (left < 16) left = 16;

    var top = rect.bottom + 6;
    if (top + 420 > window.innerHeight) {
      top = Math.max(16, rect.top - 426);
    }

    popover.style.top = top + 'px';
    popover.style.left = left + 'px';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 50);
  }

  function renderFilterValuesList() {
    var listEl = document.getElementById('fms-prod-sheet-filter-list');
    var countEl = document.getElementById('fms-prod-sheet-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';

    var query = currentFilterSearchQuery.toLowerCase().trim();
    var filtered = currentFilterUniqueValues.filter(function (v) {
      if (!query) return true;
      return v.toLowerCase().indexOf(query) !== -1;
    });

    if (countEl) {
      countEl.textContent = currentFilterSelectedSet.size + ' / ' + currentFilterUniqueValues.length + ' selected';
    }

    if (filtered.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'fms-prod-filter-empty-search';
      emptyDiv.textContent = 'No matching items';
      listEl.appendChild(emptyDiv);
      return;
    }

    var frag = document.createDocumentFragment();

    filtered.forEach(function (v) {
      var itemLabel = document.createElement('label');
      itemLabel.className = 'fms-prod-filter-item';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'fms-prod-filter-checkbox';
      chk.checked = currentFilterSelectedSet.has(v);

      chk.addEventListener('change', function () {
        if (chk.checked) {
          currentFilterSelectedSet.add(v);
        } else {
          currentFilterSelectedSet.delete(v);
        }
        if (countEl) {
          countEl.textContent = currentFilterSelectedSet.size + ' / ' + currentFilterUniqueValues.length + ' selected';
        }
      });

      var spanText = document.createElement('span');
      spanText.className = 'fms-prod-filter-item-text';
      spanText.textContent = v;
      if (v === '(Blanks)') {
        spanText.style.fontStyle = 'italic';
        spanText.style.color = '#94a3b8';
      }

      var spanCount = document.createElement('span');
      spanCount.className = 'fms-prod-filter-item-count';
      spanCount.textContent = currentFilterValueCounts[v] || 0;

      itemLabel.appendChild(chk);
      itemLabel.appendChild(spanText);
      itemLabel.appendChild(spanCount);

      frag.appendChild(itemLabel);
    });

    listEl.appendChild(frag);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('fms-prod-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function applyColumnFilterAndClose() {
    if (currentFilterColIdx === null) return;

    var colIdx = currentFilterColIdx;
    var totalUnique = currentFilterUniqueValues.length;
    var selectedCount = currentFilterSelectedSet.size;

    if (selectedCount === 0) {
      // Empty set means show nothing matching
      activeColumnFilters[colIdx] = new Set(['__NO_MATCH__']);
    } else if (selectedCount === totalUnique) {
      // All selected means filter is cleared/inactive
      delete activeColumnFilters[colIdx];
    } else {
      activeColumnFilters[colIdx] = new Set(currentFilterSelectedSet);
    }

    closeColumnFilterPopover();
    applyAllFiltersAndSearch();

    var colName = allHeaders[colIdx] || ('Column ' + (colIdx + 1));
    showToast('Filter updated on ' + colName, 'filter');
  }

  // ---------------------------------------------------------------------------
  // 8. Sorting Helper from Popover
  // ---------------------------------------------------------------------------
  function sortFilteredByColumn(colIdx, isAsc) {
    if (!allRows || allRows.length === 0) return;

    allRows.sort(function (rowA, rowB) {
      var a = (rowA[colIdx] !== undefined && rowA[colIdx] !== null) ? String(rowA[colIdx]).trim() : '';
      var b = (rowB[colIdx] !== undefined && rowB[colIdx] !== null) ? String(rowB[colIdx]).trim() : '';

      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      if (a === '' && b === '') return 0;

      var res = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      return isAsc ? res : -res;
    });

    closeColumnFilterPopover();
    applyAllFiltersAndSearch();

    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
    showToast('Sorted ' + (isAsc ? 'A \u2192 Z' : 'Z \u2192 A') + ' by ' + colName, 'sort');
  }

  // ---------------------------------------------------------------------------
  // 9. Table Page Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('fms-prod-sheet-tbody');
    var countLabel = document.getElementById('fms-prod-sheet-count-label');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="' + allHeaders.length + '" class="fms-prod-table-empty">' + (msg || 'No data available.') + '</td></tr>';
    }
    if (countLabel) countLabel.textContent = '0 records';
  }

  function renderTablePage() {
    var tbody = document.getElementById('fms-prod-sheet-tbody');
    var countLabel = document.getElementById('fms-prod-sheet-count-label');
    var showingRange = document.getElementById('fms-prod-sheet-showing-range');
    var totalPagesEl = document.getElementById('fms-prod-sheet-total-pages');
    var pageNumInput = document.getElementById('fms-prod-sheet-page-num');

    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + allHeaders.length + '" class="fms-prod-table-empty">' +
        (allRows.length === 0 ? 'No data in PRODUCTION sheet.' : 'No matching records found.') +
        '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (showingRange) showingRange.textContent = 'Showing 0 \u2013 0 of 0';
      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageNumInput) pageNumInput.value = 1;
      updatePaginationButtons(1, 1);
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
    if (showingRange) {
      showingRange.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' \u2013 ' + endIdx.toLocaleString() + ' of ' + filteredRows.length.toLocaleString();
    }
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (pageNumInput) {
      pageNumInput.value = currentPage;
      pageNumInput.max = totalPages;
    }

    updatePaginationButtons(currentPage, totalPages);

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      // 148 Data Columns
      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        if (colIdx === 0) {
          td.classList.add('fms-prod-td-freeze-0');
        }

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('fms-prod-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';
        td.textContent = strVal;

        // Conditional cell colors: Pending -> Yellow, Done -> Green
        var valLower = strVal.toLowerCase();
        if (valLower === 'pending' || valLower.indexOf('pending') !== -1) {
          td.classList.add('bai-cell-yellow');
        } else if (valLower === 'done' || valLower.indexOf('done') !== -1) {
          td.classList.add('bai-cell-green');
        }

        // Click to select
        td.addEventListener('mousedown', function () {
          selectCellByCoords(localRowIdx, colIdx);
        });

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function updatePaginationButtons(current, total) {
    var firstBtn = document.getElementById('fms-prod-sheet-first-page');
    var prevBtn = document.getElementById('fms-prod-sheet-prev-page');
    var nextBtn = document.getElementById('fms-prod-sheet-next-page');
    var lastBtn = document.getElementById('fms-prod-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 10. Interactive Cell Selection, Arrow Navigation & Keyboard Copy
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('fms-prod-sheet-tbody');
    if (!tbody) return;

    var prevSelected = tbody.querySelectorAll('.fms-prod-cell-selected');
    prevSelected.forEach(function (el) {
      el.classList.remove('fms-prod-cell-selected');
    });

    activeCellCoords = { r: r, c: c };

    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('fms-prod-cell-selected');

      var cellValue = (targetCell.innerText !== undefined ? targetCell.innerText : targetCell.textContent || '').trim();
      var colHeader = allHeaders[c] || ('Col ' + (c + 1));
      var groupLabel = getColumnGroupLabel(c);

      var badge = document.getElementById('fms-prod-sheet-active-cell-badge');
      if (badge) {
        badge.style.display = 'inline-flex';
        badge.textContent = groupLabel + ' \u203A ' + colHeader + ' (Row ' + (r + 1) + ')';
      }

      scrollCellIntoViewIfNeeded(targetCell);
    }
  }

  function clearCellSelection() {
    activeCellCoords = null;
    var tbody = document.getElementById('fms-prod-sheet-tbody');
    if (tbody) {
      tbody.querySelectorAll('.fms-prod-cell-selected').forEach(function (el) {
        el.classList.remove('fms-prod-cell-selected');
      });
    }
    var badge = document.getElementById('fms-prod-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function scrollCellIntoViewIfNeeded(cell) {
    var wrapper = document.getElementById('fms-prod-sheet-table-wrapper');
    if (!wrapper || !cell) return;

    var cellRect = cell.getBoundingClientRect();
    var wrapRect = wrapper.getBoundingClientRect();

    if (cellRect.top < wrapRect.top + 70) {
      wrapper.scrollTop -= (wrapRect.top + 70 - cellRect.top);
    } else if (cellRect.bottom > wrapRect.bottom - 20) {
      wrapper.scrollTop += (cellRect.bottom - wrapRect.bottom + 20);
    }

    if (cellRect.left < wrapRect.left + 130) {
      wrapper.scrollLeft -= (wrapRect.left + 130 - cellRect.left);
    } else if (cellRect.right > wrapRect.right - 20) {
      wrapper.scrollLeft += (cellRect.right - wrapRect.right + 20);
    }
  }

  function moveCellSelection(dr, dc) {
    if (!activeCellCoords) {
      selectCellByCoords(0, 0);
      return;
    }

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, filteredRows.length);
    var pageRowCount = endIdx - startIdx;
    var colCount = allHeaders.length;

    var newR = activeCellCoords.r + dr;
    var newC = activeCellCoords.c + dc;

    if (newR < 0) {
      if (currentPage > 1) {
        currentPage--;
        renderTablePage();
        selectCellByCoords(pageSize - 1, newC);
      }
      return;
    }
    if (newR >= pageRowCount) {
      var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < totalPages) {
        currentPage++;
        renderTablePage();
        selectCellByCoords(0, newC);
      }
      return;
    }

    if (newC < 0) newC = 0;
    if (newC >= colCount) newC = colCount - 1;

    selectCellByCoords(newR, newC);
  }

  // ---------------------------------------------------------------------------
  // 11. SheetJS Excel Export (.xlsx) with Multi-Level Merged Headers
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library is not available for Excel export', 'error');
      return;
    }

    if (!filteredRows || filteredRows.length === 0) {
      showToast('No records to export', 'warning');
      return;
    }

    showToast('Generating Excel (.xlsx)...', 'warning');

    setTimeout(function () {
      try {
        var aoa = [];

        // Row 1: Level 1 Headers
        var r1 = [];
        HEADER_GROUPS[0].forEach(function (g) {
          r1.push(g.label);
          for (var p = 1; p < g.colspan; p++) r1.push('');
        });
        aoa.push(r1);

        // Row 2: Level 2 Headers
        var r2 = [];
        HEADER_GROUPS[1].forEach(function (g) {
          r2.push(g.label);
          for (var p = 1; p < g.colspan; p++) r2.push('');
        });
        aoa.push(r2);

        // Row 3: Base Column Headers (148 Columns)
        var r3 = allHeaders.slice();
        aoa.push(r3);

        // Row 4 onwards: Data Rows
        filteredRows.forEach(function (row) {
          aoa.push(row.slice());
        });

        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Setup Header Merges
        var merges = [];

        // Level 1 Merges (Row 0 in 0-indexed aoa)
        var colIdx1 = 0;
        HEADER_GROUPS[0].forEach(function (g) {
          if (g.colspan > 1) {
            merges.push({
              s: { r: 0, c: colIdx1 },
              e: { r: 0, c: colIdx1 + g.colspan - 1 }
            });
          }
          colIdx1 += g.colspan;
        });

        // Level 2 Merges (Row 1 in 0-indexed aoa)
        var colIdx2 = 0;
        HEADER_GROUPS[1].forEach(function (g) {
          if (g.colspan > 1) {
            merges.push({
              s: { r: 1, c: colIdx2 },
              e: { r: 1, c: colIdx2 + g.colspan - 1 }
            });
          }
          colIdx2 += g.colspan;
        });

        ws['!merges'] = merges;

        // Auto column widths
        var colWidths = [];
        for (var c = 0; c < allHeaders.length; c++) {
          var maxLen = String(allHeaders[c] || '').length;
          for (var r = 0; r < Math.min(filteredRows.length, 30); r++) {
            var valStr = String(filteredRows[r][c] || '');
            if (valStr.length > maxLen) maxLen = valStr.length;
          }
          colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 12), 40) });
        }
        ws['!cols'] = colWidths;

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'FMS_PRODUCTION');

        var filename = 'FMS_Production_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, filename);

        showToast('Excel exported (' + filteredRows.length.toLocaleString() + ' rows)', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Unknown error'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 12. Modern SVG Toasts & UI Badges (NO EMOJIS)
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('batch-list-kpi-view');
    var prodView = document.getElementById('batch-list-fms-production-view');

    // Hide other views in batch-list
    var allSubViews = document.querySelectorAll('#page-batch-list > div, .batch-list-extra-view');
    allSubViews.forEach(function (v) {
      if (v.id !== 'page-header' && v.id !== 'batch-list-fms-production-view') {
        v.style.display = 'none';
      }
    });

    if (kpiView) kpiView.style.display = 'none';
    if (prodView) prodView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) {
        filteredRows = allRows;
      }
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var searchInput = document.getElementById('fms-prod-sheet-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var prodView = document.getElementById('batch-list-fms-production-view');
    var kpiView = document.getElementById('batch-list-kpi-view');
    if (prodView) prodView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('fms-prod-sheet-db-badge');
    var syncText = document.getElementById('fms-prod-sheet-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#fb7185;">bolt</span> Database Ready';
    }

    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        syncText.textContent = 'Last synced: ' + timeStr + ' (' + allRows.length.toLocaleString() + ' rows)';
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var banner = document.getElementById('fms-prod-sheet-sync-banner');
    var syncBtn = document.getElementById('btn-refresh-fms-production-data');
    var syncIcon = document.getElementById('fms-prod-sheet-sync-icon');
    var msgEl = document.getElementById('fms-prod-sheet-sync-msg');

    if (syncing) {
      if (banner) banner.style.display = 'flex';
      if (msgEl && msg) msgEl.textContent = msg;
      if (syncIcon) syncIcon.classList.add('fms-prod-sheet-spin');
      if (syncBtn) syncBtn.disabled = true;
    } else {
      if (banner) banner.style.display = 'none';
      if (syncIcon) syncIcon.classList.remove('fms-prod-sheet-spin');
      if (syncBtn) syncBtn.disabled = false;
    }
  }

  var SVG_ICONS = {
    success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
    filter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>',
    sort: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('fms-prod-sheet-toast');
    if (existing) existing.remove();

    var cleanMsg = String(msg || '')
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    var type = customType || 'info';
    var iconKey = 'info';

    var lower = cleanMsg.toLowerCase();
    if (customType) {
      iconKey = customType;
    } else if (lower.indexOf('copied') !== -1) {
      type = 'info';
      iconKey = 'copy';
    } else if (lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1) {
      type = 'error';
      iconKey = 'error';
    } else if (lower.indexOf('success') !== -1 || lower.indexOf('synced') !== -1) {
      type = 'success';
      iconKey = 'success';
    }

    var toast = document.createElement('div');
    toast.id = 'fms-prod-sheet-toast';
    toast.className = 'fms-prod-toast fms-prod-toast-' + type;

    var iconSpan = document.createElement('span');
    iconSpan.className = 'fms-prod-toast-icon';
    iconSpan.innerHTML = SVG_ICONS[iconKey] || SVG_ICONS.info;

    var textSpan = document.createElement('span');
    textSpan.className = 'fms-prod-toast-text';
    textSpan.textContent = cleanMsg;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('fms-prod-toast-visible');
    });

    setTimeout(function () {
      toast.classList.remove('fms-prod-toast-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, 2800);
  }

  // ---------------------------------------------------------------------------
  // 13. DOM Event Listeners & Keyboard Hook
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Refresh / Sync Button
    var syncBtn = document.getElementById('btn-refresh-fms-production-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-fms-production-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportExcelXLSX();
      });
    }

    // Search Input
    var searchInput = document.getElementById('fms-prod-sheet-search-input');
    var clearSearchBtn = document.getElementById('fms-prod-sheet-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var val = searchInput.value;
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          applyAllFiltersAndSearch();
        }, 150);
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        clearSearchBtn.style.display = 'none';
        applyAllFiltersAndSearch();
      });
    }

    // Rows per page
    var pageSizeSelect = document.getElementById('fms-prod-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(pageSizeSelect.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Controls
    var firstBtn = document.getElementById('fms-prod-sheet-first-page');
    var prevBtn = document.getElementById('fms-prod-sheet-prev-page');
    var nextBtn = document.getElementById('fms-prod-sheet-next-page');
    var lastBtn = document.getElementById('fms-prod-sheet-last-page');
    var pageNumInput = document.getElementById('fms-prod-sheet-page-num');

    if (firstBtn) firstBtn.addEventListener('click', function () {
      if (currentPage > 1) { currentPage = 1; renderTablePage(); }
    });
    if (prevBtn) prevBtn.addEventListener('click', function () {
      if (currentPage > 1) { currentPage--; renderTablePage(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var total = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < total) { currentPage++; renderTablePage(); }
    });
    if (lastBtn) lastBtn.addEventListener('click', function () {
      var total = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < total) { currentPage = total; renderTablePage(); }
    });
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var p = parseInt(pageNumInput.value, 10) || 1;
        var total = Math.ceil(filteredRows.length / pageSize) || 1;
        if (p < 1) p = 1;
        if (p > total) p = total;
        currentPage = p;
        renderTablePage();
      });
    }

    // Clear All Filters Button in Chips Bar
    var clearAllFiltersBtn = document.getElementById('fms-prod-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Column Filter Popover Controls
    var popCloseBtn = document.getElementById('fms-prod-sheet-filter-pop-close');
    var popCancelBtn = document.getElementById('fms-prod-sheet-filter-cancel-btn');
    var popOkBtn = document.getElementById('fms-prod-sheet-filter-ok-btn');
    var popResetBtn = document.getElementById('fms-prod-sheet-filter-reset-btn');
    var popSelectAll = document.getElementById('fms-prod-sheet-filter-select-all');
    var popClearAll = document.getElementById('fms-prod-sheet-filter-clear-all');
    var popSearchInput = document.getElementById('fms-prod-sheet-filter-search-input');
    var popClearSearch = document.getElementById('fms-prod-sheet-filter-search-clear');
    var sortAscBtn = document.getElementById('fms-prod-sheet-sort-asc');
    var sortDescBtn = document.getElementById('fms-prod-sheet-sort-desc');

    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    if (popOkBtn) popOkBtn.addEventListener('click', applyColumnFilterAndClose);

    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          delete activeColumnFilters[currentFilterColIdx];
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
          showToast('Filter reset', 'filter');
        }
      });
    }

    if (popSelectAll) {
      popSelectAll.addEventListener('click', function () {
        var query = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (v) {
          if (!query || v.toLowerCase().indexOf(query) !== -1) {
            currentFilterSelectedSet.add(v);
          }
        });
        renderFilterValuesList();
      });
    }

    if (popClearAll) {
      popClearAll.addEventListener('click', function () {
        var query = currentFilterSearchQuery.toLowerCase().trim();
        if (!query) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (v) {
            if (v.toLowerCase().indexOf(query) !== -1) {
              currentFilterSelectedSet.delete(v);
            }
          });
        }
        renderFilterValuesList();
      });
    }

    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = popSearchInput.value;
        if (popClearSearch) popClearSearch.style.display = currentFilterSearchQuery ? 'block' : 'none';
        renderFilterValuesList();
      });
    }

    if (popClearSearch) {
      popClearSearch.addEventListener('click', function () {
        if (popSearchInput) {
          popSearchInput.value = '';
          popSearchInput.focus();
        }
        currentFilterSearchQuery = '';
        popClearSearch.style.display = 'none';
        renderFilterValuesList();
      });
    }

    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) sortFilteredByColumn(currentFilterColIdx, true);
      });
    }
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) sortFilteredByColumn(currentFilterColIdx, false);
      });
    }

    // Close Popover when clicked outside
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('fms-prod-sheet-filter-popover');
      if (!popover || popover.style.display === 'none') return;
      if (!popover.contains(e.target) && !e.target.closest('.fms-prod-col-filter-btn')) {
        closeColumnFilterPopover();
      }
    });

    // Keyboard Navigation for Selected Cell
    document.addEventListener('keydown', function (e) {
      var prodView = document.getElementById('batch-list-fms-production-view');
      if (!prodView || prodView.style.display === 'none') return;

      var popover = document.getElementById('fms-prod-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') return;

      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveCellSelection(-1, 0);
          break;
        case 'ArrowDown':
        case 'Enter':
          e.preventDefault();
          moveCellSelection(1, 0);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveCellSelection(0, -1);
          break;
        case 'ArrowRight':
        case 'Tab':
          e.preventDefault();
          moveCellSelection(0, 1);
          break;
      }
    });

    // Ctrl + C / Cmd + C Copy Cell Value with Flash & Toast
    document.addEventListener('copy', function (e) {
      var prodView = document.getElementById('batch-list-fms-production-view');
      if (!prodView || prodView.style.display === 'none') return;

      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('fms-prod-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.fms-prod-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            selectedCell.classList.remove('fms-prod-cell-copied');
            void selectedCell.offsetWidth;
            selectedCell.classList.add('fms-prod-cell-copied');
            setTimeout(function () {
              selectedCell.classList.remove('fms-prod-cell-copied');
            }, 500);

            var displayPreview = text;
            if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
            if (displayPreview === '') displayPreview = '(Blank)';
            showToast('Copied: "' + displayPreview + '"', 'copy');
          }
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('fms-prod-sheet-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key to close popover or clear selection
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('fms-prod-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    initDataEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose global controller
  window.FmsProductionSheetEngine = {
    init: start,
    showView: showView,
    hideView: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
