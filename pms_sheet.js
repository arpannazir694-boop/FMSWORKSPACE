/**
 * =============================================================================
 * PMS (Production Monitoring System) Live Engine
 * =============================================================================
 * High-Performance Client-Side Engine with IndexedDB Fast Cache, Live Telemetry,
 * 106 Columns (A3:DC with Column P Excluded), Multi-Level Hierarchical Group Headers,
 * Parallel Multi-Column Filter Popovers, Active Filter Chips, Interactive Cell Selection,
 * Keyboard Navigation, Ctrl+C Copy with SVG Toast, and SheetJS Excel Export.
 * =============================================================================
 * Sheet: PMS (Spreadsheet ID: 1O7hR0VrIRXhg-IXJvBL-Qn9MG-v2Jig5GH7OiD5-kCo)
 * GID: 1753511709
 * Range: A3:DC (Row 3: Header Row, Row 4+: Data Rows)
 * Total Columns: 106 (Col P 'UNIQUE ID' excluded)
 * Database: IndexedDB 'FMS_PMS_Live_DB_v2'
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1O7hR0VrIRXhg-IXJvBL-Qn9MG-v2Jig5GH7OiD5-kCo';
  var SHEET_GID = '1753511709';
  var SHEET_NAME = 'PMS';

  // Primary export endpoint & Fallback GViz endpoint
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A3:DC';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A3:DC';

  var DB_NAME = 'FMS_PMS_Live_DB_v2';
  var DB_VERSION = 2;
  var STORE_NAME = 'pms_live_store';
  var NUM_COLS = 106;

  // Multi-Level Group Headers Specification (106 Total Columns)
  var HEADER_GROUPS = [
    // Level 1: 13 High-Level Production Phases
    [
      { label: 'COMPANY & BUYER', colspan: 2, isFrozen: true, theme: 'frozen' },
      { label: 'ORDER DETAILS & PRE-PLANNED', colspan: 13, theme: 'order' },
      { label: 'PRE-PRODUCTION / WIP', colspan: 8, theme: 'wip' },
      { label: 'PRODUCTION UNIT (PART)', colspan: 4, theme: 'unit' },
      { label: 'MATERIAL', colspan: 4, theme: 'mat' },
      { label: 'PRODUCTION DETAILS', colspan: 8, theme: 'prod' },
      { label: '1ST PRODUCTION FOLLOW UP', colspan: 10, theme: 'fu1' },
      { label: '2ND PRODUCTION FOLLOW UP', colspan: 10, theme: 'fu2' },
      { label: '3RD PRODUCTION FOLLOW UP', colspan: 10, theme: 'fu3' },
      { label: 'END LINE QC CHECKING', colspan: 9, theme: 'endline' },
      { label: '10% PRE-AQL PASSED', colspan: 5, theme: 'aql1' },
      { label: 'CHECKING & PACKING', colspan: 12, theme: 'pack' },
      { label: 'POST AQL', colspan: 6, theme: 'aql2' },
      { label: 'SHIPMENT', colspan: 5, theme: 'ship' }
    ],
    // Level 2: Sub-category / Role Breakdown
    [
      { label: 'IDENTIFIERS', colspan: 2, isFrozen: true, theme: 'frozen' },
      { label: 'ORDER SPECIFICATIONS', colspan: 8, theme: 'order' },
      { label: 'EX-FACTORY & PRODUCTION MONTH', colspan: 4, theme: 'order' },
      { label: 'TOTAL QTY', colspan: 1, theme: 'order' },
      { label: 'WIP & BATCH DETAILS', colspan: 8, theme: 'wip' },
      { label: 'CUTTING & LEAD TIME', colspan: 4, theme: 'unit' },
      { label: 'MATERIAL STATUS', colspan: 4, theme: 'mat' },
      { label: 'ASSIGNMENT & FMS DETAILS', colspan: 8, theme: 'prod' },
      { label: 'FLOOR SUPERVISOR', colspan: 5, theme: 'fu1' },
      { label: 'IN-LINE QC', colspan: 5, theme: 'fu1' },
      { label: 'FLOOR SUPERVISOR', colspan: 5, theme: 'fu2' },
      { label: 'IN-LINE QC', colspan: 5, theme: 'fu2' },
      { label: 'FLOOR SUPERVISOR', colspan: 5, theme: 'fu3' },
      { label: 'IN-LINE QC', colspan: 5, theme: 'fu3' },
      { label: 'END LINE INSPECTION', colspan: 9, theme: 'endline' },
      { label: 'PRE-AQL AUDIT', colspan: 5, theme: 'aql1' },
      { label: 'PACKING & REPAIRING DISPATCH', colspan: 12, theme: 'pack' },
      { label: 'POST-AQL FINAL AUDIT', colspan: 6, theme: 'aql2' },
      { label: 'FINAL ETD & DISPATCH', colspan: 5, theme: 'ship' }
    ]
  ];

  // Helper to find Phase/Role context for any column index (0 to 105)
  function getColumnGroupLabel(colIdx) {
    if (colIdx < 2) return 'Company & Buyer';
    if (colIdx < 10) return 'Order Details';
    if (colIdx < 14) return 'Ex-Factory & Prod Month';
    if (colIdx === 14) return 'Order Qty';
    if (colIdx < 23) return 'Pre-Production / WIP';
    if (colIdx < 27) return 'Production Unit (Part)';
    if (colIdx < 31) return 'Material Status';
    if (colIdx < 39) return 'Production Details';
    if (colIdx < 44) return '1st Follow Up - Floor Supervisor';
    if (colIdx < 49) return '1st Follow Up - In-Line QC';
    if (colIdx < 54) return '2nd Follow Up - Floor Supervisor';
    if (colIdx < 59) return '2nd Follow Up - In-Line QC';
    if (colIdx < 64) return '3rd Follow Up - Floor Supervisor';
    if (colIdx < 69) return '3rd Follow Up - In-Line QC';
    if (colIdx < 78) return 'End Line QC Checking';
    if (colIdx < 83) return '10% Pre-AQL Passed';
    if (colIdx < 95) return 'Checking & Packing';
    if (colIdx < 101) return 'Post AQL';
    return 'Shipment';
  }

  // Base 106 Default Column Headers (Clean fallback list without Column P)
  var defaultBaseHeaders = [
    'Company', 'BUYER', 'PO', 'ITB NAME', 'DESIGN REF', 'SKU', 'SEASON', 'COLOUR', 'RANGE NAME', 'LEATHERS',
    'PROD-LOCATION', 'PROD-MONTH', 'BUYER ETD', 'PULL FORWARD ETD', 'QTY',
    'BATCH ID', 'SEASON (BATCH ID)', 'BATCH ID PRIMERY KEY', 'ACTUAL DATE', 'LEAD TIME', 'REMARKS',
    'REMARKS FOR PRE-PRODUCTION PENDING MATERIALS', 'INDENT NO.',
    'PLANED RECEIVED DATE', 'ACTUAL CUTTING RECEIVE DATE', 'PRODUCTION LEAD TIME GET', 'ERP ENTRY DATE',
    'MATERIAL ISSUED DATE', 'MATERIAL HANDOVER TO FABRICATOR DATE', '100 % MATERIAL COMPLETED DATE', 'REMARKS',
    'FMS UPLOAD DATE', 'BATCH ID', 'UNIT', 'FABRICATOR NAME', 'QUANTITY', 'P O AS PER BUYER',
    'FLOOR SUPERVISOR NAME', 'IN-LINE QC NAME',
    // 1st Follow Up: Supervisor (39-43) & QC (44-48)
    '1ST SUPERVISOR FOLLOW UP PLANNED DATE', '1ST SUPERVISOR FOLLOW UP Actual', '1ST SUPERVISOR FOLLOW UP Status',
    '1ST SUPERVISOR FOLLOW UP REMARKS IF ANY', '1ST SUPERVISOR FOLLOW UP Time Delay',
    '1ST IN-LINE QC FOLLOW UP DATE', '1ST IN-LINE QC FOLLOW UP Actual', '1ST IN-LINE QC FOLLOW UP Status',
    '1ST IN-LINE QC FOLLOW UP REMARKS IF ANY', '1ST IN-LINE QC FOLLOW UP Time Delay',
    // 2nd Follow Up: Supervisor (49-53) & QC (54-58)
    '2ND SUPERVISOR FOLLOW UP DATE', '2ND SUPERVISOR FOLLOW UP Actual', '2ND SUPERVISOR FOLLOW UP Status',
    '2ND SUPERVISOR FOLLOW UP REMARKS IF ANY', '2ND SUPERVISOR FOLLOW UP Time Delay',
    '2ND IN LINE FOLLOW UP DATE', '2ND IN LINE FOLLOW UP Actual', '2ND IN LINE FOLLOW UP Status',
    '2ND IN LINE FOLLOW UP REMARKS IF ANY', '2ND IN LINE FOLLOW UP Time Delay',
    // 3rd Follow Up: Supervisor (59-63) & QC (64-68)
    '3RD SUPERVISOR FOLLOW UP DATE', '3RD SUPERVISOR FOLLOW UP Actual', '3RD SUPERVISOR FOLLOW UP Status',
    '3RD SUPERVISOR FOLLOW UP REMARKS IF ANY', '3RD SUPERVISOR FOLLOW UP Time Delay',
    '3RD IN LINE QC FOLLOW UP DATE', '3RD IN LINE QC FOLLOW UP Actual', '3RD IN LINE QC FOLLOW UP Status',
    '3RD IN LINE QC FOLLOW UP REMARKS IF ANY', '3RD IN LINE QC FOLLOW UP Time Delay',
    // End Line QC Checking (69-77)
    'END LINE Planned', 'END LINE Actual', 'END LINE Status', 'TOTAL CHECK QUANTITY', 'Quantity Send to Warehouse',
    'TOTAL REPAIR QTY', 'PENDING QTY', 'END LINE REMARKS IF ANY', 'END LINE Time Delay',
    // 10% Pre-AQL Passed (78-82)
    'PRE AQL Planned', 'PRE AQL Actual', 'PRE AQL Status', 'PRE AQL REMARKS IF ANY', 'PRE AQL Time Delay',
    // Checking & Packing (83-94)
    'CHECKING & PACKING Planned', 'CHECKING & PACKING Actual', 'CHECKING & PACKING Status', 'ACTUAL RCV QTY',
    'LOT RECEIVED DATE', 'CHECKING & PACKING DUE QTY', 'REPAIRING QTY SENT TO UNIT DATE', 'REPAIRING QTY SENT TO UNIT',
    'REPAIRING QTY SENT TO WAREHOUSE DATE', 'REPAIRING QTY SENT TO WAREHOUSE', 'CHECKING & PACKING REMARKS IF ANY',
    'CHECKING & PACKING Time Delay',
    // Post AQL (95-100)
    'POST AQL Planned', 'POST AQL Actual', 'POST AQL Status', 'POST AQL PENDING QTY', 'REMARKS IF ANY', 'POST AQL Time Delay',
    // Shipment (101-105)
    'ETD', 'ETD Actual', 'ETD Status', 'ETD REMARKS IF ANY', 'Time Delay IN ETD'
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
  var autoRefreshTimer = null;
  var isAutoRefreshActive = true;

  // Column Filters State
  var activeColumnFilters = {}; // colIdx -> Set of allowed values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: localRowIndex, c: colIndex }

  // Sorting State
  var currentSortColIdx = null;
  var currentSortDir = 'asc';

  // SVG Icons
  var SVG_ICONS = {
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Cache Storage
  // ---------------------------------------------------------------------------
  function cleanupOldDatabase() {
    try {
      if (window.indexedDB && window.indexedDB.deleteDatabase) {
        window.indexedDB.deleteDatabase('FMS_PMS_DB_v1');
      }
    } catch (e) {
      console.warn('Could not purge old sample DB:', e);
    }
  }

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
          console.warn('[PMS] Store missing in ' + DB_NAME + ', auto-repairing...');
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
        reject(e.target.error || new Error('Could not open IndexedDB ' + DB_NAME));
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
          console.warn('[PMS] getFromDB error:', err);
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
          console.warn('[PMS] putToDB error:', err);
          dbInstance = null;
          resolve();
        }
      });
    }).catch(function () { return Promise.resolve(); });
  }

  // ---------------------------------------------------------------------------
  // 2. High-Performance Zero-Allocation RFC-4180 Stream CSV Parser (Drops Col P)
  // ---------------------------------------------------------------------------
  function parsePMSStreamCSV(csvText, skipColIdx, targetCols) {
    var rows = [];
    var headers = [];
    var length = csvText.length;
    var row = [];
    var inQuotes = false;
    var tokenStart = 0;
    var colIdx = 0;
    var hasContent = false;
    var isHeader = true;

    for (var i = 0; i < length; i++) {
      var c = csvText.charCodeAt(i);
      if (c === 34) { // '"'
        inQuotes = !inQuotes;
      } else if (c === 44 && !inQuotes) { // ','
        if (colIdx !== skipColIdx && (isHeader || row.length < targetCols)) {
          var val = csvText.substring(tokenStart, i).trim();
          if (val.length >= 2 && val.charCodeAt(0) === 34 && val.charCodeAt(val.length - 1) === 34) {
            val = val.substring(1, val.length - 1).replace(/""/g, '"').trim();
          }
          if (val !== '') hasContent = true;
          row.push(val);
        }
        colIdx++;
        tokenStart = i + 1;
      } else if ((c === 10 || c === 13) && !inQuotes) { // \r or \n
        if (colIdx !== skipColIdx && (isHeader || row.length < targetCols)) {
          var val = csvText.substring(tokenStart, i).trim();
          if (val.length >= 2 && val.charCodeAt(0) === 34 && val.charCodeAt(val.length - 1) === 34) {
            val = val.substring(1, val.length - 1).replace(/""/g, '"').trim();
          }
          if (val !== '') hasContent = true;
          row.push(val);
        }
        if (c === 13 && i + 1 < length && csvText.charCodeAt(i + 1) === 10) {
          i++;
        }
        tokenStart = i + 1;

        if (isHeader) {
          headers = row.slice(0, targetCols);
          while (headers.length < targetCols) {
            headers.push(defaultBaseHeaders[headers.length] || ('Col ' + (headers.length + 1)));
          }
          if (headers[0] && headers[0].toLowerCase() === 'comapny') {
            headers[0] = 'Company';
          }
          isHeader = false;
        } else if (hasContent && row.length > 0) {
          while (row.length < targetCols) {
            row.push('');
          }
          rows.push(row);
        }

        row = [];
        colIdx = 0;
        hasContent = false;
      }
    }

    if (row.length > 0 && !isHeader && hasContent) {
      while (row.length < targetCols) {
        row.push('');
      }
      rows.push(row);
    }

    return { headers: headers, rows: rows };
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
        console.warn('PMS primary export fetch failed, trying GViz fallback...', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { cache: 'no-cache' }).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP status ' + res2.status);
          return res2.text();
        });
      });
  }

  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, 'Connecting to Live PMS Google Sheet stream...');

    fetchCSVWithFallback()
      .then(function (csvText) {
        if (!csvText || csvText.trim().length === 0) {
          throw new Error('Google Sheet returned empty response.');
        }

        var result = parsePMSStreamCSV(csvText, 15, NUM_COLS);
        csvText = null; // Release 4.2MB text string immediately

        if (!result.rows || result.rows.length === 0) {
          throw new Error('Could not parse valid records from sheet.');
        }

        if (result.headers && result.headers.length === NUM_COLS) {
          allHeaders = result.headers;
        }
        allRows = result.rows;
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
        renderHeaderRows();
        applyAllFiltersAndSearch();
        if (isManual) {
          showToast('Live PMS data synced (' + allRows.length.toLocaleString() + ' records)', 'check');
        }
      })
      .catch(function (err) {
        console.error('PMS sync error:', err);
        isSyncing = false;
        updateSyncUI(false);
        updateHeaderBadge();
        if (allRows.length === 0) {
          renderEmptyState('Failed to load PMS data: ' + (err.message || 'Network error'));
        }
        if (isManual) {
          showToast('Sync failed: ' + (err.message || 'Network error'), 'error');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Initial Engine Setup & Cache Restore (Lazy on Demand)
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    cleanupOldDatabase();

    return Promise.all([
      getFromDB('headers'),
      getFromDB('rows'),
      getFromDB('lastSyncTime')
    ])
      .then(function (results) {
        var cachedHeaders = results[0];
        var cachedRows = results[1];
        var cachedSync = results[2];

        if (cachedHeaders && cachedHeaders.length === NUM_COLS) {
          allHeaders = cachedHeaders;
        }
        if (cachedRows && cachedRows.length > 0) {
          allRows = cachedRows;
          lastSyncTime = cachedSync || null;
          updateHeaderBadge();
          renderHeaderRows();
          applyAllFiltersAndSearch();
          // Silently sync latest in background only if cache is older than 5 minutes
          if (!lastSyncTime || (Date.now() - lastSyncTime > 300000)) {
            syncFromGoogleSheet(false);
          }
        } else {
          // No cache yet, fetch immediately
          renderHeaderRows();
          renderEmptyState('Connecting to Google Sheet & caching 14,600+ PMS records...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('IndexedDB initial read error:', err);
        renderHeaderRows();
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Multi-Level Sticky Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRows() {
    var thead = document.getElementById('pms-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Level 1 & 2 Group Headers
    HEADER_GROUPS.forEach(function (groupRow, rowIndex) {
      var trGroup = document.createElement('tr');
      trGroup.className = 'pms-thead-group pms-thead-level-' + (rowIndex + 1);

      groupRow.forEach(function (group) {
        var th = document.createElement('th');
        th.className = 'pms-th-group pms-th-theme-' + (group.theme || 'order');
        if (group.isFrozen) {
          th.classList.add('pms-th-frozen-group');
        }
        th.colSpan = Math.max(parseInt(group.colspan, 10) || 1, 1);
        th.textContent = group.label || '';
        trGroup.appendChild(th);
      });

      thead.appendChild(trGroup);
    });

    // Level 3: Base Column Headers (106 Columns)
    var trBase = document.createElement('tr');
    trBase.className = 'pms-thead-base';

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'pms-th-col';
      if (colIdx === 0) {
        th.classList.add('pms-th-freeze-0');
      } else if (colIdx === 1) {
        th.classList.add('pms-th-freeze-1');
      }
      th.setAttribute('data-col-idx', colIdx);

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'pms-th-content';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'pms-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = '[' + getColumnGroupLabel(colIdx) + '] ' + hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'pms-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter & Sort: ' + hName;
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
    var searchInput = document.getElementById('pms-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];

    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Global Multi-Token Search across all 106 columns without string join allocation
      if (searchTokens.length > 0) {
        for (var t = 0; t < searchTokens.length; t++) {
          var tok = searchTokens[t];
          var tokFound = false;
          for (var c = 0; c < row.length; c++) {
            if (row[c] && String(row[c]).toLowerCase().indexOf(tok) !== -1) {
              tokFound = true;
              break;
            }
          }
          if (!tokFound) return false;
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

    // 3. Sorting (if active)
    if (currentSortColIdx !== null) {
      var sortIdx = currentSortColIdx;
      var isAsc = currentSortDir === 'asc';
      filteredRows.sort(function (a, b) {
        var valA = (a[sortIdx] || '').trim();
        var valB = (b[sortIdx] || '').trim();
        var numA = parseFloat(valA.replace(/,/g, ''));
        var numB = parseFloat(valB.replace(/,/g, ''));
        if (!isNaN(numA) && !isNaN(numB)) {
          return isAsc ? numA - numB : numB - numA;
        }
        return isAsc ? valA.localeCompare(valB, undefined, { numeric: true }) : valB.localeCompare(valA, undefined, { numeric: true });
      });
    }

    currentPage = 1;
    renderActiveFilterChips();
    renderHeaderFilterIndicators();
    renderTablePage();
  }

  function renderHeaderFilterIndicators() {
    var thead = document.getElementById('pms-thead');
    if (!thead) return;

    thead.querySelectorAll('.pms-th-col').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.pms-col-filter-btn');
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
    var bar = document.getElementById('pms-active-filters-bar');
    var container = document.getElementById('pms-active-filters-chips');
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
      var totalVals = getUniqueValuesForColumn(colIdx).keys.length;
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
      removeBtn.innerHTML = '&#x2715;';
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        showToast('Filter removed on ' + colName, 'check');
      });

      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Column Filter Popover Engine
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

    var popover = document.getElementById('pms-filter-popover');
    var titleEl = document.getElementById('pms-filter-pop-title');
    var searchInput = document.getElementById('pms-filter-search-input');
    var searchClear = document.getElementById('pms-filter-search-clear');

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

    // Smart Positioning relative to anchor button
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
    var popover = document.getElementById('pms-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('pms-filter-list');
    var countEl = document.getElementById('pms-filter-items-count');
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

    var frag = document.createDocumentFragment();

    visibleValues.forEach(function (val) {
      var item = document.createElement('div');
      item.className = 'floor-qc-filter-item';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.style.cursor = 'pointer';

      var isBlank = (val === '');
      var labelSpan = document.createElement('span');
      labelSpan.className = 'floor-qc-filter-item-text';
      labelSpan.textContent = isBlank ? '(Blanks)' : val;
      if (isBlank) {
        labelSpan.style.fontStyle = 'italic';
        labelSpan.style.color = '#94a3b8';
      }

      var countSpan = document.createElement('span');
      countSpan.className = 'floor-qc-filter-item-count';
      countSpan.textContent = currentFilterValueCounts[val] || 0;

      item.addEventListener('click', function (e) {
        if (e.target !== chk) {
          chk.checked = !chk.checked;
        }
        if (chk.checked) {
          currentFilterSelectedSet.add(val);
        } else {
          currentFilterSelectedSet.delete(val);
        }
      });

      item.appendChild(chk);
      item.appendChild(labelSpan);
      item.appendChild(countSpan);
      frag.appendChild(item);
    });

    listEl.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // 8. Pagination & Table Page Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('pms-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="' + NUM_COLS + '" class="floor-qc-table-empty">' + (msg || 'No matching records found') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('pms-tbody');
    var countLabel = document.getElementById('pms-count-label');
    var rangeLabel = document.getElementById('pms-showing-range');
    var pageNumInput = document.getElementById('pms-page-num');
    var totalPagesEl = document.getElementById('pms-total-pages');

    if (!tbody) return;

    var total = filteredRows.length;
    var totalAll = allRows.length;

    if (total === 0) {
      renderEmptyState(totalAll === 0 ? 'Loading records from Google Sheet...' : 'No records match the current filters and search.');
      if (countLabel) countLabel.textContent = '0 of ' + totalAll.toLocaleString() + ' records';
      if (rangeLabel) rangeLabel.textContent = 'Showing 0 - 0 of 0';
      if (pageNumInput) pageNumInput.value = 1;
      if (totalPagesEl) totalPagesEl.textContent = '1';
      updatePaginationButtons(1, 1);
      clearCellSelection();
      return;
    }

    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (countLabel) {
      countLabel.textContent = total.toLocaleString() + (total !== totalAll ? ' (filtered from ' + totalAll.toLocaleString() + ')' : '') + ' records';
    }
    if (rangeLabel) {
      rangeLabel.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' \u2013 ' + endIdx.toLocaleString() + ' of ' + total.toLocaleString();
    }
    if (pageNumInput) {
      pageNumInput.value = currentPage;
      pageNumInput.max = totalPages;
    }
    if (totalPagesEl) {
      totalPagesEl.textContent = totalPages;
    }

    updatePaginationButtons(currentPage, totalPages);

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        if (colIdx === 0) {
          td.classList.add('pms-td-freeze-0');
        } else if (colIdx === 1) {
          td.classList.add('pms-td-freeze-1');
        }

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('pms-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';
        td.textContent = strVal;

        // Conditional status highlighting
        var valLower = strVal.toLowerCase();
        if (valLower === 'completed' || valLower === 'done' || valLower === 'passed' || valLower === 'approved') {
          td.classList.add('pms-cell-done');
        } else if (valLower === 'pending' || valLower === 'running' || valLower === 'in progress' || valLower === 'wip') {
          td.classList.add('pms-cell-pending');
        } else if (valLower === 'delay' || valLower === 'alert' || valLower === 'rejected' || valLower === 'failed') {
          td.classList.add('pms-cell-delay');
        }

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function updatePaginationButtons(current, total) {
    var firstBtn = document.getElementById('pms-first-page');
    var prevBtn = document.getElementById('pms-prev-page');
    var nextBtn = document.getElementById('pms-next-page');
    var lastBtn = document.getElementById('pms-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('pms-tbody');
    if (!tbody) return;

    var prevSelected = tbody.querySelector('.pms-cell-selected');
    if (prevSelected) {
      prevSelected.classList.remove('pms-cell-selected');
    }

    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('pms-cell-selected');
      activeCellCoords = { r: r, c: c };
      targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateActiveCellBadge(r, c);
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('pms-tbody');
    if (tbody) {
      var prevSelected = tbody.querySelector('.pms-cell-selected');
      if (prevSelected) {
        prevSelected.classList.remove('pms-cell-selected');
      }
    }
    activeCellCoords = null;
    var badge = document.getElementById('pms-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '';
    }
  }

  function updateActiveCellBadge(r, c) {
    var badge = document.getElementById('pms-active-cell-badge');
    if (!badge) return;

    var startIdx = (currentPage - 1) * pageSize;
    var globalRow = startIdx + r + 1;
    var colName = allHeaders[c] || ('Col ' + (c + 1));
    var group = getColumnGroupLabel(c);

    badge.style.display = 'inline-block';
    badge.textContent = 'Row ' + globalRow + ' \u2022 [' + group + '] \u203A ' + colName;
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('pms-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.pms-cell-selected');
    if (!selectedCell) return false;

    var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        selectedCell.classList.remove('pms-cell-copied');
        void selectedCell.offsetWidth;
        selectedCell.classList.add('pms-cell-copied');
        setTimeout(function () {
          selectedCell.classList.remove('pms-cell-copied');
        }, 500);

        var displayPreview = text;
        if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
        if (displayPreview === '') displayPreview = '(Blank)';
        showToast('Copied: "' + displayPreview + '"', 'copy');
      }).catch(function () {
        fallbackClipboardCopy(text);
      });
      return true;
    } else {
      fallbackClipboardCopy(text);
      return true;
    }
  }

  function fallbackClipboardCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard', 'copy');
    } catch (e) {
      showToast('Copy failed', 'error');
    }
    document.body.removeChild(ta);
  }

  // ---------------------------------------------------------------------------
  // 10. Excel (.xlsx) Export Engine
  // ---------------------------------------------------------------------------
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library not loaded. Cannot export.', 'error');
      return;
    }

    var exportData = [];

    // Header Row
    exportData.push(allHeaders);

    // Data rows (current filtered rows or all rows if none filtered)
    var rowsToExport = filteredRows.length > 0 ? filteredRows : allRows;
    for (var i = 0; i < rowsToExport.length; i++) {
      exportData.push(rowsToExport[i]);
    }

    var ws = XLSX.utils.aoa_to_sheet(exportData);

    // Column widths
    var colWidths = [];
    for (var c = 0; c < NUM_COLS; c++) {
      var maxL = (allHeaders[c] || '').length;
      colWidths.push({ wch: Math.max(maxL + 4, 14) });
    }
    ws['!cols'] = colWidths;

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PMS Data');

    var dateStr = new Date().toISOString().slice(0, 10);
    var filename = 'PMS_Production_Data_' + dateStr + '.xlsx';
    XLSX.writeFile(wb, filename);

    showToast('Exported ' + rowsToExport.length.toLocaleString() + ' rows to ' + filename, 'check');
  }

  // ---------------------------------------------------------------------------
  // 12. Toast & Sync UI Notification (SVG Icons, No Emojis)
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    var toast = document.getElementById('pms-sheet-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pms-sheet-toast';
      toast.className = 'floor-qc-sheet-toast';
      toast.innerHTML = '<span class="floor-qc-sheet-toast-icon"></span><span class="floor-qc-sheet-toast-text"></span>';
      document.body.appendChild(toast);
    }

    var iconEl = toast.querySelector('.floor-qc-sheet-toast-icon');
    var textEl = toast.querySelector('.floor-qc-sheet-toast-text');

    toast.className = 'floor-qc-sheet-toast floor-qc-sheet-toast--' + (type || 'info');
    if (iconEl) {
      iconEl.innerHTML = SVG_ICONS[type] || SVG_ICONS.info || SVG_ICONS.check;
    }
    if (textEl) {
      textEl.textContent = msg;
    }

    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('show');
    }, 2800);
  }

  function updateSyncUI(syncing, msg) {
    var banner = document.getElementById('pms-sync-banner');
    var bannerMsg = document.getElementById('pms-sync-msg');
    var syncIcon = document.getElementById('pms-sync-icon');

    if (banner) {
      banner.style.display = syncing ? 'flex' : 'none';
    }
    if (bannerMsg && msg) {
      bannerMsg.textContent = msg;
    }
    if (syncIcon) {
      if (syncing) {
        syncIcon.classList.add('floor-qc-sheet-spin');
      } else {
        syncIcon.classList.remove('floor-qc-sheet-spin');
      }
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('pms-db-badge');
    var syncText = document.getElementById('pms-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#06b6d4;">bolt</span> Live Stream Ready (' + allRows.length.toLocaleString() + ')';
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        syncText.textContent = 'Synced ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        syncText.textContent = 'Live Telemetry';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Event Listeners & Lifecycle
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // 1. Sync button
    var refreshBtn = document.getElementById('btn-refresh-pms-data');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // 2. Export Excel
    var exportBtn = document.getElementById('btn-download-pms-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportToExcel();
      });
    }

    // 3. Search Input with debounce
    var searchInput = document.getElementById('pms-search-input');
    var searchClear = document.getElementById('pms-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        if (searchClear) {
          searchClear.style.display = searchInput.value ? 'block' : 'none';
        }
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          applyAllFiltersAndSearch();
        }, 220);
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchClear.style.display = 'none';
          applyAllFiltersAndSearch();
        }
      });
    }

    // 4. Page Size Selector
    var pageSizeSelect = document.getElementById('pms-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // 5. Pagination Buttons
    var firstBtn = document.getElementById('pms-first-page');
    var prevBtn = document.getElementById('pms-prev-page');
    var nextBtn = document.getElementById('pms-next-page');
    var lastBtn = document.getElementById('pms-last-page');
    var pageNumInput = document.getElementById('pms-page-num');

    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (isNaN(val) || val < 1) val = 1;
        if (val > totalPages) val = totalPages;
        currentPage = val;
        renderTablePage();
      });
    }

    // 6. Clear All Filters Button
    var clearAllBtn = document.getElementById('pms-clear-all-filters-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        currentSortColIdx = null;
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'check');
      });
    }

    // 7. Popover Controls
    var popClose = document.getElementById('pms-filter-pop-close');
    var popCancel = document.getElementById('pms-filter-cancel-btn');
    var popOk = document.getElementById('pms-filter-ok-btn');
    var popReset = document.getElementById('pms-filter-reset-btn');
    var popSelectAll = document.getElementById('pms-filter-select-all');
    var popClearAll = document.getElementById('pms-filter-clear-all');
    var popSearch = document.getElementById('pms-filter-search-input');
    var popSearchClear = document.getElementById('pms-filter-search-clear');
    var sortAscBtn = document.getElementById('pms-sort-asc');
    var sortDescBtn = document.getElementById('pms-sort-desc');

    if (popClose) popClose.addEventListener('click', closeColumnFilterPopover);
    if (popCancel) popCancel.addEventListener('click', closeColumnFilterPopover);

    if (popOk) {
      popOk.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          if (currentFilterSelectedSet.size >= currentFilterUniqueValues.length) {
            delete activeColumnFilters[currentFilterColIdx];
          } else {
            activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
          }
          applyAllFiltersAndSearch();
        }
        closeColumnFilterPopover();
      });
    }

    if (popReset) {
      popReset.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          delete activeColumnFilters[currentFilterColIdx];
          applyAllFiltersAndSearch();
        }
        closeColumnFilterPopover();
      });
    }

    if (popSelectAll) {
      popSelectAll.addEventListener('click', function () {
        currentFilterSelectedSet = new Set(currentFilterUniqueValues);
        renderFilterList();
      });
    }

    if (popClearAll) {
      popClearAll.addEventListener('click', function () {
        currentFilterSelectedSet.clear();
        renderFilterList();
      });
    }

    if (popSearch) {
      popSearch.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClear) {
          popSearchClear.style.display = this.value ? 'block' : 'none';
        }
        renderFilterList();
      });
    }

    if (popSearchClear) {
      popSearchClear.addEventListener('click', function () {
        if (popSearch) {
          popSearch.value = '';
          currentFilterSearchQuery = '';
          popSearchClear.style.display = 'none';
          renderFilterList();
        }
      });
    }

    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          currentSortColIdx = currentFilterColIdx;
          currentSortDir = 'asc';
          applyAllFiltersAndSearch();
          showToast('Sorted A \u2192 Z', 'check');
        }
        closeColumnFilterPopover();
      });
    }

    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          currentSortColIdx = currentFilterColIdx;
          currentSortDir = 'desc';
          applyAllFiltersAndSearch();
          showToast('Sorted Z \u2192 A', 'check');
        }
        closeColumnFilterPopover();
      });
    }

    // Auto Refresh Toggle
    var autoRefreshBtn = document.getElementById('pms-auto-refresh-toggle');
    if (autoRefreshBtn) {
      autoRefreshBtn.addEventListener('click', function () {
        isAutoRefreshActive = !isAutoRefreshActive;
        if (isAutoRefreshActive) {
          autoRefreshBtn.classList.add('active');
          autoRefreshBtn.querySelector('span:last-child').textContent = 'Live Telemetry ON';
          startAutoRefresh();
          showToast('Live telemetry polling activated (60s)', 'check');
        } else {
          autoRefreshBtn.classList.remove('active');
          autoRefreshBtn.querySelector('span:last-child').textContent = 'Live Telemetry OFF';
          stopAutoRefresh();
          showToast('Live telemetry polling paused', 'info');
        }
      });
    }

    // Keyboard Navigation & Copying
    document.addEventListener('keydown', function (e) {
      var pmsView = document.getElementById('batch-list-pms-view');
      if (!pmsView || pmsView.style.display === 'none') return;

      // Close popover on Escape
      if (e.key === 'Escape') {
        closeColumnFilterPopover();
        return;
      }

      // Clipboard Copy (Ctrl + C / Cmd + C)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (activeCellCoords) {
          var didCopy = copySelectedCellToClipboard();
          if (didCopy) e.preventDefault();
        }
        return;
      }

      // Arrow Key Navigation
      if (activeCellCoords) {
        var r = activeCellCoords.r;
        var c = activeCellCoords.c;
        var pageRowsCount = Math.min(pageSize, filteredRows.length - (currentPage - 1) * pageSize);

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (r > 0) selectCellByCoords(r - 1, c);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (r < pageRowsCount - 1) selectCellByCoords(r + 1, c);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (c > 0) selectCellByCoords(r, c - 1);
        } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault();
          if (c < NUM_COLS - 1) selectCellByCoords(r, c + 1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (r < pageRowsCount - 1) selectCellByCoords(r + 1, c);
        }
      }
    });

    // Event delegation on tbody for cell selection (avoids thousands of individual listeners)
    var tbodyEl = document.getElementById('pms-tbody');
    if (tbodyEl) {
      tbodyEl.addEventListener('mousedown', function (e) {
        var td = e.target.closest('td');
        if (!td) return;
        var r = parseInt(td.getAttribute('data-r'), 10);
        var c = parseInt(td.getAttribute('data-c'), 10);
        if (!isNaN(r) && !isNaN(c)) {
          selectCellByCoords(r, c);
        }
      });
    }

    // Close popover when clicking outside
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('pms-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.pms-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible') {
        var pmsView = document.getElementById('batch-list-pms-view');
        if (pmsView && pmsView.style.display !== 'none') {
          syncFromGoogleSheet(false);
        }
      }
    }, 120000); // 120s smart background stream sync
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 14. Initialization on DOM Ready (Lazy & Lightweight)
  // ---------------------------------------------------------------------------
  var isEngineInitialized = false;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindEvents();
    });
  } else {
    bindEvents();
  }

  // ---------------------------------------------------------------------------
  // 15. Global Controller Export
  // ---------------------------------------------------------------------------
  window.PmsSheetEngine = {
    init: function () {
      if (!isEngineInitialized) {
        isEngineInitialized = true;
        bindEvents();
        initDataEngine();
      }
    },
    show: function () {
      var kpiView = document.getElementById('batch-list-kpi-view');
      var pmsView = document.getElementById('batch-list-pms-view');
      if (kpiView) kpiView.style.display = 'none';
      document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
      if (pmsView) pmsView.style.display = '';

      if (!isEngineInitialized) {
        isEngineInitialized = true;
        bindEvents();
        initDataEngine();
      } else {
        if (allRows.length > 0) {
          renderTablePage();
        }
      }
      if (isAutoRefreshActive) {
        startAutoRefresh();
      }
    },
    hide: function () {
      var kpiView = document.getElementById('batch-list-kpi-view');
      var pmsView = document.getElementById('batch-list-pms-view');
      if (pmsView) pmsView.style.display = 'none';
      if (kpiView) kpiView.style.display = '';
      stopAutoRefresh();
    },
    sync: function () {
      syncFromGoogleSheet(true);
    },
    exportExcel: exportToExcel,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
