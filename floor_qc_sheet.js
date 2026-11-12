/**
 * =============================================================================
 * Floor Supervisor & In-Line QC Details Live Engine (IndexedDB + Fast GVIZ CSV)
 * =============================================================================
 * Sheet: Floor Supervisor & In-Line QC
 * Range: B7:BT (71 Columns)
 * Header Groups:
 *   Level 1: Part / Follow Up (17, 18, 18, 18)
 *   Level 2: When Production Time Complete (17, 9, 9, 9, 9, 9, 9)
 *   Level 3: Follow Up Role - Supervisor / QC (17, 9, 9, 9, 9, 9, 9)
 *   Level 4: 71 Base Column Headers
 * Database: IndexedDB 'FMS_Floor_QC_DB'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing from Google Sheet
 *   - 4-Level hierarchical sticky group headers with distinct color coding
 *   - Instant client-side Search across all 71 columns
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Precision table layout with cell borders & text wrapping
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with multi-row merged headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 *   - Slim scrollbar + elevated footer (no data overlap)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '1123597538';
  var SHEET_NAME = 'Floor Supervisor & In-Line QC';

  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B7:BT';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B7:BT';
  var GVIZ_CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Floor_QC_DB_v1';
  var DB_VERSION = 2;
  var STORE_NAME = 'floor_qc_store';

  // 3-Level Group Headers Specification (Col counts: (2 + 15) + 18 + 18 + 18 = 71)
  var HEADER_GROUPS = [
    // Level 1
    [
      { label: 'BATCH INFO', colspan: 2, isFrozen: true, theme: 'frozen' },
      { label: 'Floor Supervisor & In-Line QC Part', colspan: 15, theme: 'part' },
      { label: '1ST FOLLOW UP', colspan: 18, theme: 'fu1' },
      { label: '2ND FOLLOW UP', colspan: 18, theme: 'fu2' },
      { label: '3RD FOLLOW UP', colspan: 18, theme: 'fu3' }
    ],
    // Level 2
    [
      { label: 'FMS UPLOAD', colspan: 2, isFrozen: true, theme: 'frozen' },
      { label: 'FMS UPLOAD DETAILS', colspan: 15, theme: 'part' },
      { label: 'WHEN 20% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu1' },
      { label: 'WHEN 20% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu1' },
      { label: 'WHEN 45% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu2' },
      { label: 'WHEN 60% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu2' },
      { label: 'WHEN 75% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu3' },
      { label: 'WHEN 80% PRODUCTION TIME COMPLETE', colspan: 9, theme: 'fu3' }
    ],
    // Level 3
    [
      { label: 'BATCH / TIMESTAMP', colspan: 2, isFrozen: true, theme: 'frozen' },
      { label: 'FMS UPLOAD DETAILS', colspan: 15, theme: 'part' },
      { label: '1ST FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fu1' },
      { label: '1ST FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fu1' },
      { label: '2ND FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fu2' },
      { label: '2ND FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fu2' },
      { label: '3RD FOLLOW UP - FLOOR SUPERVISOR', colspan: 9, theme: 'fu3' },
      { label: '3RD FOLLOW UP - IN LINE QC', colspan: 9, theme: 'fu3' }
    ]
  ];

  // Helper to find Level 3 role context for any column index (0-70)
  function getColumnGroupLabel(colIdx) {
    if (colIdx < 17) return 'FMS Upload Details';
    if (colIdx < 26) return '1st Follow Up - Floor Supervisor';
    if (colIdx < 35) return '1st Follow Up - In Line QC';
    if (colIdx < 44) return '2nd Follow Up - Floor Supervisor';
    if (colIdx < 53) return '2nd Follow Up - In Line QC';
    if (colIdx < 62) return '3rd Follow Up - Floor Supervisor';
    return '3rd Follow Up - In Line QC';
  }

  // Base 71 default headers (fallback if offline initial)
  var defaultBaseHeaders = [
    'FMS UPLOAD TIMESTAMP', 'BACTCH NO.', 'LEATHER RECEIVED DATE', 'CREATOR (DOER)', 'UNIT',
    'FABRICATOR NAME (NO)', 'BRAND', 'SEASON', 'CATEGORY', 'SKU',
    'FAC / REF NO', 'COLOUR', 'QUANTITY', 'ETD AS PER ORDER', 'PO AS PER BUYER',
    'FLOOR SUPERVISOR NAME', 'INLINE QC NAME',
    // 1st Follow Up - Supervisor (17-25)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    // 1st Follow Up - In Line QC (26-34)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    // 2nd Follow Up - Supervisor (35-43)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    // 2nd Follow Up - In Line QC (44-52)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    // 3rd Follow Up - Supervisor (53-61)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY',
    // 3rd Follow Up - In Line QC (62-70)
    'PLANNED DATE', 'FOLLOWUP TIMESTAMP', 'STATUS', 'IF MATERIAL NOT RECEIVED', 'REMARKS', 'ACTUAL TIMESTAMP', 'STATUS (JYOTI)', 'REMARKS', 'DELAY'
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
          console.warn('[FloorQC] Store missing in ' + DB_NAME + ', auto-repairing...');
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
        reject(e.target.error || new Error('Could not open IndexedDB'));
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
          req.onerror = function (e) { resolve(null); };
        } catch (err) {
          console.warn('[FloorQC] getFromDB error:', err);
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
            return resolve();
          }
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var req = store.put(val, key);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) { resolve(); };
        } catch (err) {
          console.warn('[FloorQC] putToDB error:', err);
          dbInstance = null;
          resolve();
        }
      });
    }).catch(function () { return Promise.resolve(); });
  }

  // ---------------------------------------------------------------------------
  // 2. High-Performance CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    var p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
    for (l = text.length; i < l; i++) {
      var cc = text[i], nc = text[i + 1];
      if (cc === '"') {
        if (s && cc === p) {
          row[r] += cc;
        }
        s = !s;
      } else if (cc === ',' && s) {
        row[++r] = '';
      } else if ((cc === '\r' || cc === '\n') && s) {
        if (cc === '\r' && nc === '\n') { i++; }
        row = [''];
        ret.push(row);
        r = 0;
      } else {
        row[r] += cc;
      }
      p = cc;
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
    updateSyncUI(true, 'Fetching Floor Supervisor & In-Line QC data from Google Sheet...');

    fetchCSVWithFallback()
      .then(function (csvText) {
        if (!csvText || csvText.trim().length === 0) {
          throw new Error('Google Sheet returned empty response.');
        }

        var parsed = parseCSV(csvText);
        if (!parsed || parsed.length === 0) {
          throw new Error('Could not parse CSV data.');
        }

        // Header is row 0
        var rawHeaders = parsed[0];
        if (rawHeaders && rawHeaders.length > 0) {
          allHeaders = rawHeaders.map(function (h) {
            return String(h || '').trim();
          });
        }
        if (allHeaders.length < 71) {
          // Fill remainder with defaults if sheet range had empty trailing headers
          for (var fi = allHeaders.length; fi < 71; fi++) {
            allHeaders.push(defaultBaseHeaders[fi] || ('Col ' + (fi + 1)));
          }
        }

        var colLen = allHeaders.length;
        var dataRows = [];
        for (var i = 1; i < parsed.length; i++) {
          var row = parsed[i];
          // Check if row has any non-empty cell
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
          showToast('Floor Supervisor & QC data synced (' + allRows.length.toLocaleString() + ' rows)', 'success');
        }
      })
      .catch(function (err) {
        console.error('Sync error:', err);
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
  // 5. Multi-Level Hierarchical Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('floor-qc-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Level 1, 2, 3 Group Headers
    HEADER_GROUPS.forEach(function (groupRow, rowIndex) {
      var trGroup = document.createElement('tr');
      trGroup.className = 'floor-qc-thead-group floor-qc-thead-level-' + (rowIndex + 1);

      groupRow.forEach(function (group) {
        var th = document.createElement('th');
        th.className = 'floor-qc-th-group floor-qc-th-theme-' + (group.theme || 'part');
        if (group.isFrozen) {
          th.classList.add('floor-qc-th-frozen-group');
        }
        th.colSpan = Math.max(parseInt(group.colspan, 10) || 1, 1);
        th.textContent = group.label || '';
        trGroup.appendChild(th);
      });

      thead.appendChild(trGroup);
    });

    // Level 4: Base Column Headers (71 Columns)
    var trBase = document.createElement('tr');
    trBase.className = 'floor-qc-thead-base';

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'floor-qc-th-col';
      if (colIdx === 0) {
        th.classList.add('floor-qc-th-freeze-0');
      } else if (colIdx === 1) {
        th.classList.add('floor-qc-th-freeze-1');
      }
      th.setAttribute('data-col-idx', colIdx);

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'floor-qc-th-content';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'floor-qc-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = '[' + getColumnGroupLabel(colIdx) + '] ' + hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'floor-qc-col-filter-btn' + (hasFilter ? ' is-active' : '');
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
    var searchInput = document.getElementById('floor-qc-sheet-search-input');
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
          var val = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          if (!allowedSet.has(val)) {
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
    var thead = document.getElementById('floor-qc-sheet-thead');
    if (!thead) return;

    thead.querySelectorAll('.floor-qc-th-col').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.floor-qc-col-filter-btn');
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
    var bar = document.getElementById('floor-qc-sheet-active-filters-bar');
    var container = document.getElementById('floor-qc-sheet-active-filters-chips');
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
      chip.className = 'floor-qc-filter-chip';

      var fullLabel = groupLabel + ' \u203A ' + colName;

      var textSpan = document.createElement('span');
      textSpan.className = 'floor-qc-filter-chip-text';
      textSpan.textContent = fullLabel + ' (' + selectedCount + '/' + totalVals + ')';
      textSpan.title = fullLabel + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'floor-qc-filter-chip-remove';
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

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
    var groupLabel = getColumnGroupLabel(colIdx);

    var popover = document.getElementById('floor-qc-sheet-filter-popover');
    var titleEl = document.getElementById('floor-qc-sheet-filter-pop-title');
    var searchInput = document.getElementById('floor-qc-sheet-filter-search-input');
    var searchClear = document.getElementById('floor-qc-sheet-filter-search-clear');

    if (titleEl) {
      titleEl.textContent = 'Filter: [' + groupLabel + '] ' + colName;
      titleEl.title = groupLabel + ' \u203A ' + colName;
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
    var popover = document.getElementById('floor-qc-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('floor-qc-sheet-filter-list');
    var countEl = document.getElementById('floor-qc-sheet-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();

    var visibleValues = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      var label = (val === '' ? '(blanks)' : val).toLowerCase();
      return label.indexOf(q) !== -1;
    });

    if (countEl) {
      countEl.textContent = visibleValues.length + ' / ' + currentFilterUniqueValues.length + ' values';
    }

    if (visibleValues.length === 0) {
      listEl.innerHTML = '<div class="floor-qc-filter-empty">No matching values</div>';
      return;
    }

    visibleValues.forEach(function (val) {
      var count = currentFilterValueCounts[val] || 0;
      var isChecked = currentFilterSelectedSet.has(val);

      var item = document.createElement('label');
      item.className = 'floor-qc-filter-item';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', function () {
        if (cb.checked) {
          currentFilterSelectedSet.add(val);
        } else {
          currentFilterSelectedSet.delete(val);
        }
      });

      var span = document.createElement('span');
      span.className = 'floor-qc-filter-item-text';
      if (val === '') {
        span.innerHTML = '<em style="color:#94a3b8;">(Blanks)</em>';
      } else {
        span.textContent = val;
      }

      var countBadge = document.createElement('span');
      countBadge.className = 'floor-qc-filter-item-count';
      countBadge.textContent = count;

      item.appendChild(cb);
      item.appendChild(span);
      item.appendChild(countBadge);
      listEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Table Page & Cell Selection Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(message) {
    var tbody = document.getElementById('floor-qc-sheet-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="' + allHeaders.length + '" class="floor-qc-table-empty">' + (message || 'No records found.') + '</td></tr>';
    }
  }

  function renderTablePage() {
    var tbody = document.getElementById('floor-qc-sheet-tbody');
    var countLabel = document.getElementById('floor-qc-sheet-count-label');
    var showingRange = document.getElementById('floor-qc-sheet-showing-range');
    var totalPagesEl = document.getElementById('floor-qc-sheet-total-pages');
    var pageNumInput = document.getElementById('floor-qc-sheet-page-num');

    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + allHeaders.length + '" class="floor-qc-table-empty">' +
        (allRows.length === 0 ? 'No data in Floor Supervisor & In-Line QC sheet.' : 'No matching records found.') +
        '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (showingRange) showingRange.textContent = 'Showing 0 – 0 of 0';
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

      // 71 Data Columns (No serial number # column)
      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        if (colIdx === 0) {
          td.classList.add('floor-qc-td-freeze-0');
        } else if (colIdx === 1) {
          td.classList.add('floor-qc-td-freeze-1');
        }

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('floor-qc-cell-selected');
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
    var firstBtn = document.getElementById('floor-qc-sheet-first-page');
    var prevBtn = document.getElementById('floor-qc-sheet-prev-page');
    var nextBtn = document.getElementById('floor-qc-sheet-next-page');
    var lastBtn = document.getElementById('floor-qc-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('floor-qc-sheet-tbody');
    if (!tbody) return;

    var prevSelected = tbody.querySelector('.floor-qc-cell-selected');
    if (prevSelected) {
      prevSelected.classList.remove('floor-qc-cell-selected');
    }

    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('floor-qc-cell-selected');
      activeCellCoords = { r: r, c: c };

      // Ensure visible in scroll view
      targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      updateActiveCellBadge(r, c);
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('floor-qc-sheet-tbody');
    if (tbody) {
      var prevSelected = tbody.querySelector('.floor-qc-cell-selected');
      if (prevSelected) {
        prevSelected.classList.remove('floor-qc-cell-selected');
      }
    }
    activeCellCoords = null;
    var badge = document.getElementById('floor-qc-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '';
    }
  }

  function updateActiveCellBadge(r, c) {
    var badge = document.getElementById('floor-qc-sheet-active-cell-badge');
    if (!badge) return;

    var startIdx = (currentPage - 1) * pageSize;
    var globalRow = startIdx + r + 1;
    var colName = allHeaders[c] || ('Col ' + (c + 1));
    var group = getColumnGroupLabel(c);

    badge.style.display = 'inline-block';
    badge.textContent = 'Row ' + globalRow + ', ' + group + ' \u203A ' + colName;
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('floor-qc-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.floor-qc-cell-selected');
    if (!selectedCell) return false;

    var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        selectedCell.classList.remove('floor-qc-cell-copied');
        void selectedCell.offsetWidth;
        selectedCell.classList.add('floor-qc-cell-copied');
        setTimeout(function () {
          selectedCell.classList.remove('floor-qc-cell-copied');
        }, 500);

        var displayPreview = text;
        if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
        if (displayPreview === '') displayPreview = '(Blank)';
        showToast('Copied: "' + displayPreview + '"', 'copy');
      }).catch(function () {
        fallbackCopy(text, selectedCell);
      });
      return true;
    } else {
      fallbackCopy(text, selectedCell);
      return true;
    }
  }

  function fallbackCopy(text, cell) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (cell) {
        cell.classList.remove('floor-qc-cell-copied');
        void cell.offsetWidth;
        cell.classList.add('floor-qc-cell-copied');
        setTimeout(function () {
          cell.classList.remove('floor-qc-cell-copied');
        }, 500);
      }
      var displayPreview = text;
      if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
      if (displayPreview === '') displayPreview = '(Blank)';
      showToast('Copied: "' + displayPreview + '"', 'copy');
    } catch (e) {
      showToast('Could not copy to clipboard', 'error');
    }
    ta.remove();
  }

  // ---------------------------------------------------------------------------
  // 10. SheetJS Excel Export (.xlsx) with Multi-Level Merged Headers
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

        // Row 3: Level 3 Headers
        var r3 = [];
        HEADER_GROUPS[2].forEach(function (g) {
          r3.push(g.label);
          for (var p = 1; p < g.colspan; p++) r3.push('');
        });
        aoa.push(r3);

        // Row 4: Level 4 Base Column Headers
        var r4 = allHeaders.slice();
        aoa.push(r4);

        // Data Rows
        filteredRows.forEach(function (row) {
          var excelRow = [];
          for (var c = 0; c < allHeaders.length; c++) {
            excelRow.push(row[c] || '');
          }
          aoa.push(excelRow);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Header Merges
        var merges = [];

        var curCol = 0;
        HEADER_GROUPS[0].forEach(function (g) {
          merges.push({ s: { r: 0, c: curCol }, e: { r: 0, c: curCol + g.colspan - 1 } });
          curCol += g.colspan;
        });

        curCol = 0;
        HEADER_GROUPS[1].forEach(function (g) {
          merges.push({ s: { r: 1, c: curCol }, e: { r: 1, c: curCol + g.colspan - 1 } });
          curCol += g.colspan;
        });

        curCol = 0;
        HEADER_GROUPS[2].forEach(function (g) {
          merges.push({ s: { r: 2, c: curCol }, e: { r: 2, c: curCol + g.colspan - 1 } });
          curCol += g.colspan;
        });

        ws['!merges'] = merges;

        // Auto-width
        var colWidths = [];
        allHeaders.forEach(function (h) {
          colWidths.push({ wch: Math.min(Math.max((h || '').length + 4, 12), 40) });
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Floor Supervisor & QC');

        var filename = 'Floor_Supervisor_and_InLine_QC_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, filename);

        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to Excel', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error creating Excel file'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 11. Modern SVG Toasts & UI Badges (NO EMOJIS)
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('batch-list-kpi-view');
    var cutView = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');

    if (kpiView) kpiView.style.display = 'none';
    if (cutView) cutView.style.display = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = '';

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
      var searchInput = document.getElementById('floor-qc-sheet-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var kpiView = document.getElementById('batch-list-kpi-view');
    if (floorQcView) floorQcView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('floor-qc-sheet-db-badge');
    var syncText = document.getElementById('floor-qc-sheet-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;">bolt</span> ' +
        (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
        syncText.textContent = 'Last synced: ' + timeStr;
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('floor-qc-sheet-sync-banner');
    var syncMsg = document.getElementById('floor-qc-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('floor-qc-sheet-sync-icon');

    if (syncBanner) syncBanner.style.display = syncing ? 'flex' : 'none';
    if (syncMsg && msg) syncMsg.textContent = msg;
    if (syncBtnIcon) {
      if (syncing) {
        syncBtnIcon.classList.add('floor-qc-sheet-spin');
      } else {
        syncBtnIcon.classList.remove('floor-qc-sheet-spin');
      }
    }
  }

  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('floor-qc-sheet-toast');
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
    } else if (lower.indexOf('warning') !== -1) {
      type = 'warning';
      iconKey = 'warning';
    } else if (lower.indexOf('synced') !== -1 || lower.indexOf('exported') !== -1 || lower.indexOf('saved') !== -1) {
      type = 'success';
      iconKey = 'check';
    }

    var iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.info;

    var toast = document.createElement('div');
    toast.id = 'floor-qc-sheet-toast';
    toast.className = 'floor-qc-sheet-toast floor-qc-sheet-toast--' + type;
    toast.innerHTML = '<span class="floor-qc-sheet-toast-icon">' + iconSvg + '</span><span class="floor-qc-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 12. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in Production Data ("Floor Supervisor & In-Line QC Details")
    var kpiCard = document.getElementById('kpi-floor-qc-details');
    if (kpiCard) {
      kpiCard.addEventListener('click', function (e) {
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

    // Back button
    var backBtn = document.getElementById('btn-back-floor-qc');
    if (backBtn) {
      backBtn.addEventListener('click', hideView);
    }

    // Refresh / Sync button
    var syncBtn = document.getElementById('btn-refresh-floor-qc-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export Excel button
    var exportBtn = document.getElementById('btn-download-floor-qc-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcelXLSX);
    }

    // Global Search Input
    var searchInput = document.getElementById('floor-qc-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('floor-qc-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('floor-qc-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('floor-qc-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('floor-qc-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('floor-qc-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('floor-qc-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('floor-qc-sheet-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > totalPages) val = totalPages;
          currentPage = val;
          renderTablePage();
        }
      });
      pageNumInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('floor-qc-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('floor-qc-sheet-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('floor-qc-sheet-filter-search-input');
    var popSearchClear = document.getElementById('floor-qc-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('floor-qc-sheet-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (v) {
          if (!q || (v === '' ? '(blanks)' : v.toLowerCase()).indexOf(q) !== -1) {
            currentFilterSelectedSet.add(v);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('floor-qc-sheet-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (v) {
            if ((v === '' ? '(blanks)' : v.toLowerCase()).indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(v);
            }
          });
        }
        renderFilterList();
      });
    }

    // Sort in Popover
    var sortAscBtn = document.getElementById('floor-qc-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var valA = String(a[col] || '').trim();
          var valB = String(b[col] || '').trim();
          return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (A \u2192 Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('floor-qc-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var valA = String(a[col] || '').trim();
          var valB = String(b[col] || '').trim();
          return valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (Z \u2192 A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('floor-qc-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('floor-qc-sheet-filter-cancel-btn');
    if (popCancelBtn) {
      popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popOkBtn = document.getElementById('floor-qc-sheet-filter-ok-btn');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
          delete activeColumnFilters[currentFilterColIdx];
        } else {
          activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
        }
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter applied on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    // Click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('floor-qc-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.floor-qc-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Keyboard Navigation & Ctrl + C handler inside Floor QC View
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('batch-list-floor-qc-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;

      // Ctrl + C / Cmd + C
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) {
          e.preventDefault();
          return;
        }
      }

      // Arrow navigation
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter' || key === 'Tab') {
        var tbody = document.getElementById('floor-qc-sheet-tbody');
        if (!tbody) return;

        var rowsInPage = tbody.querySelectorAll('tr').length;
        if (rowsInPage === 0) return;
        var colsCount = allHeaders.length;

        var r = activeCellCoords ? activeCellCoords.r : 0;
        var c = activeCellCoords ? activeCellCoords.c : 0;

        if (key === 'ArrowUp') {
          e.preventDefault();
          r = Math.max(0, r - 1);
        } else if (key === 'ArrowDown' || key === 'Enter') {
          e.preventDefault();
          r = Math.min(rowsInPage - 1, r + 1);
        } else if (key === 'ArrowLeft') {
          e.preventDefault();
          c = Math.max(0, c - 1);
        } else if (key === 'ArrowRight') {
          e.preventDefault();
          c = Math.min(colsCount - 1, c + 1);
        } else if (key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) {
            c--;
            if (c < 0) {
              c = colsCount - 1;
              r = Math.max(0, r - 1);
            }
          } else {
            c++;
            if (c >= colsCount) {
              c = 0;
              r = Math.min(rowsInPage - 1, r + 1);
            }
          }
        }

        selectCellByCoords(r, c);
      }
    });

    // Native 'copy' event fallback
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('batch-list-floor-qc-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;

      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('floor-qc-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.floor-qc-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            selectedCell.classList.remove('floor-qc-cell-copied');
            void selectedCell.offsetWidth;
            selectedCell.classList.add('floor-qc-cell-copied');
            setTimeout(function () {
              selectedCell.classList.remove('floor-qc-cell-copied');
            }, 500);

            var displayPreview = text;
            if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
            if (displayPreview === '') displayPreview = '(Blank)';
            showToast('Copied: "' + displayPreview + '"', 'copy');
          }
        }
      }
    });

    // Click outside table: fade out selection and deactivate active cell so user can copy from anywhere else
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('floor-qc-sheet-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key to close popover or clear selection
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('floor-qc-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 13. Bootstrap Engine
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
  window.FloorQcSheetEngine = {
    init: start,
    showView: showView,
    hideView: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
