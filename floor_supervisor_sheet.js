/**
 * =============================================================================
 * Floor Supervisor Live Engine (IndexedDB + Google Sheets GVIZ CSV + PDF Generator)
 * =============================================================================
 * Sheet: PLANNED DATE (Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E)
 * GID: 1364433470
 * Range: A1:U (21 Columns: A to U)
 * Row 1: Header Row
 * Database: IndexedDB 'FMS_Floor_Supervisor_DB_v2'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser from Google Sheet
 *   - Full client-side Search across all 21 columns with match highlighting
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Dual PDF Generation:
 *       1. Row-Level: Floor Supervisor Inspection Report (Single-page print/PDF checklist)
 *       2. Table-Level: Full landscape PDF export of filtered table records
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '1364433470';
  // Primary export endpoint fetches all underlying rows bypassing active Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:U';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:U';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Floor_Supervisor_DB_v2';
  var DB_VERSION = 1;
  var STORE_NAME = 'floor_supervisor_store';
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
    'FLOOR SUPERVISOR - 1ST FOLLOW UP PLANNED',
    'FLOOR SUPERVISOR - 2ND FOLLOW UP PLANNED',
    'FLOOR SUPERVISOR - 3RD FOLLOW UP PLANNED'
  ];

  var FS_CHECKLIST = [
    {
      title: '1ST FOLLOW UP',
      items: [
        'PP SAMPLE AVAILABLE',
        'CHELA SAMPLE',
        'LEATHER PART RECEVIED',
        'LINING PART RECEVIED',
        'RE-INFORCEMENT PART RECEVIED',
        'ALL FITTINGS RECEIVED',
        'FORMA RECEIVED',
        'JIG RECEIVED ( IF REQUIRED)',
        'SEW IN LABEL',
        'GLUEING'
      ]
    },
    {
      title: '2ND FOLLOW UP',
      items: [
        'EMBOSSING RECEIVED FROM BIMAN',
        'STITCHING MACHINE',
        'DURING PRODUCTION CHECKING EVERY ITEMS(25%)',
        'EDGE INKING PART RECEIVED (EDGE INKING DEPT)',
        'CHECK MANPOWER AVAILABILITY WITH EACH FABRICATOR',
        'FOLLOW UP WITH INLINE QC TO SEE ALL MATERIAL CHECKED/NOT CHECKED',
        '1 PC FOR LOT APPROVAL'
      ]
    },
    {
      title: '3RD FOLLOW UP',
      items: [
        'ASSEMBLE OF LEATHER COMPONENT',
        'FINAL ASSAMBLE',
        'PRODUCTION ONTIME FOLLOW UP',
        '10% W.I.P GOODS QUALITY CHECKING(WHEN PRODUCTION 80% DONE)',
        'CLEANING AND CHECKING/AQL DONE'
      ]
    }
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
  var searchQuery = '';
  var sortColIdx = -1;
  var sortAsc = true;

  // Column Filters State
  var activeColumnFilters = {}; // colIdx -> Set of allowed values
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
      if (dbInstance) return resolve(dbInstance);
      if (!window.indexedDB) return reject(new Error('IndexedDB not supported in this browser.'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = function (e) { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = function (e) { reject(e.target.error || new Error('Failed to open ' + DB_NAME)); };
    });
  }

  function saveToCache(headers, rows) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put(headers, 'headers');
        store.put(rows, 'rows');
        store.put(Date.now(), 'last_sync');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadFromCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var reqH = store.get('headers');
        var reqR = store.get('rows');
        var reqS = store.get('last_sync');
        tx.oncomplete = function () {
          if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
            resolve({ headers: reqH.result || allHeaders, rows: reqR.result, lastSync: reqS.result || null });
          } else {
            resolve(null);
          }
        };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (21 Columns: A to U)
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
          var parsed = curRow.slice(0, NUM_COLS);
          while (parsed.length < NUM_COLS) parsed.push(defaultHeaders[parsed.length] || ('Col ' + (parsed.length + 1)));
          allHeaders = parsed;
        }
        isFirstRow = false;
      } else {
        var hasContent = curRow.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
        if (!hasContent) { curRow = []; return; }
        var normalized = new Array(NUM_COLS);
        for (var j = 0; j < NUM_COLS; j++) {
          normalized[j] = (curRow[j] !== undefined && curRow[j] !== null) ? curRow[j] : '';
        }
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
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching Floor Supervisor Export CSV');
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
  // 4. Background Sync & Cache Orchestration
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    var spinner = document.getElementById('spinner-overlay');
    if (spinner) spinner.classList.add('hidden');

    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for sheet updates...');

    fetchGoogleSheetCSV()
      .then(function (result) {
        allHeaders = result.headers;
        allRows = result.rows;
        lastSyncTime = Date.now();
        return saveToCache(allHeaders, allRows);
      })
      .then(function () {
        applyAllFiltersAndSearch();
        updateHeaderBadge();
        updateSyncUI(false);
        showToast('Successfully synced ' + allRows.length.toLocaleString() + ' records', 'success');
      })
      .catch(function (err) {
        console.error('Floor Supervisor sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    var spinner = document.getElementById('spinner-overlay');
    if (spinner) spinner.classList.add('hidden');

    renderHeaderRow();
    renderEmptyState('Loading Floor Supervisor records from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
          setTimeout(function () { syncFromGoogleSheet(false); }, 700);
        } else {
          updateSyncUI(true, 'First-time cache building from Google Sheet...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('Cache read error, falling back to direct fetch:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Toast & Helpers
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    if (window.FMS && window.FMS.showToast) {
      window.FMS.showToast(type === 'error' ? 'error' : (type === 'copy' ? 'info' : 'success'), 'Floor Supervisor', msg);
      return;
    }
    var toast = document.getElementById('floor-supervisor-sheet-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'floor-supervisor-sheet-toast';
      toast.className = 'bai-sheet-toast';
      document.body.appendChild(toast);
    }
    var iconSvg = type === 'copy'
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
      : (type === 'error'
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>');

    toast.innerHTML = iconSvg + '<span>' + escapeHtml(msg) + '</span>';
    toast.className = 'bai-sheet-toast bai-sheet-toast-show bai-sheet-toast-' + (type || 'info');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.className = toast.className.replace('bai-sheet-toast-show', '');
    }, 2800);
  }

  function escapeHtml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Never';
    var diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return diffSec + 's ago';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var d = new Date(timestamp);
    return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('floor-supervisor-db-badge');
    var syncText = document.getElementById('floor-supervisor-last-sync-text');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#c48b16;">bolt</span> Database Ready';
    }
    if (syncText) {
      syncText.textContent = lastSyncTime ? ('Synced: ' + formatRelativeTime(lastSyncTime)) : 'Synced: Never';
    }
  }

  function updateSyncUI(syncing, message) {
    var banner = document.getElementById('floor-supervisor-sync-banner');
    var bannerMsg = document.getElementById('floor-supervisor-sync-msg');
    var syncBtn = document.getElementById('btn-refresh-fs-data');
    var syncIcon = syncBtn ? syncBtn.querySelector('.material-icons-round') : null;

    if (banner) {
      banner.style.display = syncing ? 'flex' : 'none';
      if (bannerMsg && message) bannerMsg.textContent = message;
    }
    if (syncIcon) {
      if (syncing) syncIcon.classList.add('bai-sheet-spin');
      else syncIcon.classList.remove('bai-sheet-spin');
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Header Row Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('floor-supervisor-thead');
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
    thPdf.textContent = 'PDF File';
    tr.appendChild(thPdf);

    // 3. 21 Data Columns (A through U)
    allHeaders.forEach(function (headerText, ci) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th bai-sheet-th-filterable';
      if (activeColumnFilters[ci] && activeColumnFilters[ci].size > 0) {
        th.classList.add('has-active-filter');
      }

      var thInner = document.createElement('div');
      thInner.className = 'bai-sheet-th-content';
      thInner.style.cssText = 'display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;width:100%!important;flex-wrap:nowrap!important;';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.title = headerText;
      labelSpan.textContent = headerText;
      labelSpan.style.cssText = 'flex:1 1 auto!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;cursor:pointer!important;user-select:none!important;font-size:11px!important;font-weight:700!important;';

      // Click label to sort
      labelSpan.addEventListener('click', function () {
        toggleColumnSort(ci);
      });

      var iconsWrap = document.createElement('div');
      iconsWrap.className = 'bai-sheet-th-icons';
      iconsWrap.style.cssText = 'display:inline-flex!important;flex-direction:row!important;align-items:center!important;gap:4px!important;flex-shrink:0!important;';

      // Sort indicator icon
      var sortIcon = document.createElement('span');
      sortIcon.className = 'material-icons-round bai-sheet-sort-icon';
      sortIcon.style.cssText = 'cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:18px!important;height:18px!important;font-size:16px!important;line-height:1!important;user-select:none!important;';
      if (sortColIdx === ci) {
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
        toggleColumnSort(ci);
      });

      // Filter button (opens Google Sheets style popover)
      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (activeColumnFilters[ci] ? ' active is-active' : '');
      filterBtn.title = 'Filter ' + headerText;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (activeColumnFilters[ci] ? 'filter_alt' : 'filter_list') + '</span>';
      filterBtn.style.cssText = 'display:inline-flex!important;align-items:center!important;justify-content:center!important;width:21px!important;height:21px!important;flex-shrink:0!important;padding:0!important;';
      filterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openColumnFilterPopover(ci, filterBtn);
      });

      iconsWrap.appendChild(sortIcon);
      iconsWrap.appendChild(filterBtn);

      thInner.appendChild(labelSpan);
      thInner.appendChild(iconsWrap);
      th.appendChild(thInner);
      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 7. Column Sorting
  // ---------------------------------------------------------------------------
  function toggleColumnSort(ci) {
    if (sortColIdx === ci) {
      if (sortAsc) {
        sortAsc = false;
      } else {
        sortColIdx = -1; // Reset sort
        sortAsc = true;
      }
    } else {
      sortColIdx = ci;
      sortAsc = true;
    }
    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 8. Google Sheets Style Column Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('floor-supervisor-filter-popover');
    var popTitle = document.getElementById('floor-supervisor-filter-pop-title');
    var searchInput = document.getElementById('floor-supervisor-filter-search-input');
    var searchClear = document.getElementById('floor-supervisor-filter-search-clear');

    if (popTitle) popTitle.textContent = allHeaders[colIdx] || ('Column ' + (colIdx + 1));
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';

    // Calculate unique values and their frequencies from current rows
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

    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
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
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('floor-supervisor-filter-popover');
    if (popover) popover.style.display = 'none';
  }

  function renderFilterPopoverValuesList() {
    var listContainer = document.getElementById('floor-supervisor-filter-list');
    var itemsCountEl = document.getElementById('floor-supervisor-filter-items-count');
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

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = currentFilterValueCounts[val] || 0;

      itemLabel.appendChild(chk);
      itemLabel.appendChild(textSpan);
      itemLabel.appendChild(countBadge);
      listContainer.appendChild(itemLabel);
    });
  }

  function applyPopoverFilter() {
    if (currentFilterColIdx === null) return;
    if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
      delete activeColumnFilters[currentFilterColIdx];
    } else {
      activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
    }
    closeColumnFilterPopover();
    applyAllFiltersAndSearch();
  }

  function resetCurrentColumnFilter() {
    if (currentFilterColIdx === null) return;
    delete activeColumnFilters[currentFilterColIdx];
    closeColumnFilterPopover();
    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 9. Filtering, Searching, and Sorting Pipeline
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var query = searchQuery.trim().toLowerCase();
    var filterCols = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Column-specific filters
      for (var f = 0; f < filterCols.length; f++) {
        var ci = parseInt(filterCols[f], 10);
        var allowedSet = activeColumnFilters[ci];
        if (allowedSet) {
          var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '').trim();
          if (!allowedSet.has(cellVal)) return false;
        }
      }

      // 2. Global search query across all 21 columns
      if (query) {
        var rowMatches = false;
        for (var c = 0; c < NUM_COLS; c++) {
          var cellStr = String(row[c] !== undefined && row[c] !== null ? row[c] : '').toLowerCase();
          if (cellStr.indexOf(query) !== -1) {
            rowMatches = true;
            break;
          }
        }
        if (!rowMatches) return false;
      }

      return true;
    });

    // 3. Sorting
    if (sortColIdx >= 0) {
      var sc = sortColIdx;
      var asc = sortAsc;
      filteredRows.sort(function (a, b) {
        var av = String(a[sc] !== undefined && a[sc] !== null ? a[sc] : '').trim();
        var bv = String(b[sc] !== undefined && b[sc] !== null ? b[sc] : '').trim();
        var numA = parseFloat(av), numB = parseFloat(bv);
        if (!isNaN(numA) && !isNaN(numB)) {
          return asc ? (numA - numB) : (numB - numA);
        }
        var cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return asc ? cmp : -cmp;
      });
    }

    currentPage = 1;
    renderHeaderRow();
    renderActiveFilterChips();
    renderTablePage();
  }

  // ---------------------------------------------------------------------------
  // 10. Active Filter Chips Bar
  // ---------------------------------------------------------------------------
  function renderActiveFilterChips() {
    var bar = document.getElementById('floor-supervisor-active-filters-bar');
    var chipsContainer = document.getElementById('floor-supervisor-active-filters-chips');
    if (!bar || !chipsContainer) return;

    var filterKeys = Object.keys(activeColumnFilters);
    if (filterKeys.length === 0) {
      bar.style.display = 'none';
      chipsContainer.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    chipsContainer.innerHTML = '';

    filterKeys.forEach(function (key) {
      var ci = parseInt(key, 10);
      var allowed = activeColumnFilters[ci];
      var headerName = allHeaders[ci] || ('Col ' + (ci + 1));

      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';

      var label = document.createElement('span');
      label.className = 'bai-sheet-filter-chip-text';
      label.innerHTML = '<strong>' + escapeHtml(headerName) + ':</strong> ' + allowed.size + ' selected';

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[ci];
        applyAllFiltersAndSearch();
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });
  }

  function clearAllFilters() {
    activeColumnFilters = {};
    searchQuery = '';
    var searchInput = document.getElementById('floor-supervisor-search-input');
    var searchClear = document.getElementById('floor-supervisor-search-clear');
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';
    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 11. Table Page & Pagination Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(message) {
    var tbody = document.getElementById('floor-supervisor-tbody');
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="' + (NUM_COLS + 2) + '" class="bai-sheet-table-empty">' +
      '<span class="material-icons-round">hourglass_empty</span>' +
      '<p>' + escapeHtml(message || 'No records found') + '</p>' +
      '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('floor-supervisor-tbody');
    var countLabel = document.getElementById('floor-supervisor-count-label');
    var infoLabel = document.getElementById('floor-supervisor-info');
    if (!tbody) return;

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;

    if (countLabel) {
      countLabel.textContent = total.toLocaleString() + ' record' + (total === 1 ? '' : 's');
    }

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
    var pageSlice = filteredRows.slice(startIdx, endIdx);

    if (infoLabel) {
      if (total === 0) {
        infoLabel.textContent = 'Showing 0 entries';
      } else {
        infoLabel.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' – ' + endIdx.toLocaleString() + ' of ' + total.toLocaleString() +
          (allRows.length !== total ? ' (filtered from ' + allRows.length.toLocaleString() + ' total)' : '') + ' entries';
      }
    }

    tbody.innerHTML = '';

    if (total === 0) {
      var isFiltered = Object.keys(activeColumnFilters).length > 0 || searchQuery.trim() !== '';
      renderEmptyState(isFiltered ? 'No records match the active search or column filters.' : 'No data available.');
      updatePaginationControls(totalPages);
      return;
    }

    var query = searchQuery.trim().toLowerCase();

    pageSlice.forEach(function (row, rowIdxInPage) {
      var tr = document.createElement('tr');
      tr.className = (startIdx + rowIdxInPage) % 2 === 0 ? 'bai-sheet-tr-even' : 'bai-sheet-tr-odd';

      // 1. Serial No. (Narrow compact width)
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index bai-td-row-num';
      tdNum.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;text-align:center!important;padding:6px 2px!important;';
      tdNum.textContent = startIdx + rowIdxInPage + 1;
      tr.appendChild(tdNum);

      // 2. Action: Download PDF Checklist (Strict Center Aligned)
      var tdPdf = document.createElement('td');
      tdPdf.className = 'bai-sheet-td-action bai-td-pdf-action';
      tdPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;vertical-align:middle!important;padding:6px 4px!important;';

      var pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'dt-pdf-download-btn bai-btn-row-pdf';
      pdfBtn.title = 'Download Floor Supervisor Inspection Report PDF';
      pdfBtn.innerHTML = '<span class="material-icons-round">picture_as_pdf</span>';
      pdfBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        downloadRowInspectionReportPdf(row);
      });
      tdPdf.appendChild(pdfBtn);
      tr.appendChild(tdPdf);

      // 3. 21 Data Columns (A to U)
      allHeaders.forEach(function (header, ci) {
        var td = document.createElement('td');
        td.className = 'bai-sheet-td';
        td.setAttribute('data-r', rowIdxInPage);
        td.setAttribute('data-c', ci);

        var rawVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');

        if (query && rawVal.toLowerCase().indexOf(query) !== -1) {
          td.innerHTML = escapeHtml(rawVal).replace(
            new RegExp(escapeRegex(escapeHtml(query)), 'gi'),
            '<mark class="dt-highlight">$&</mark>'
          );
        } else {
          td.textContent = rawVal;
        }

        // Cell Selection on click
        td.addEventListener('click', function (e) {
          selectCell(rowIdxInPage, ci, td);
        });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    updatePaginationControls(totalPages);
  }

  function getPaginationRange(current, total) {
    if (total <= 7) {
      var res = [];
      for (var i = 1; i <= total; i++) res.push(i);
      return res;
    }
    if (current <= 4) {
      return [1, 2, 3, 4, 5, '…', total];
    }
    if (current >= total - 3) {
      return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    }
    return [1, '…', current - 1, current, current + 1, '…', total];
  }

  function updatePaginationControls(totalPages) {
    var pageNumInput = document.getElementById('floor-supervisor-page-num');
    var totalPagesEl = document.getElementById('floor-supervisor-total-pages');
    var firstBtn = document.getElementById('floor-supervisor-first-page');
    var prevBtn = document.getElementById('floor-supervisor-prev-page');
    var nextBtn = document.getElementById('floor-supervisor-next-page');
    var lastBtn = document.getElementById('floor-supervisor-last-page');

    if (pageNumInput) {
      pageNumInput.value = currentPage;
      pageNumInput.max = totalPages;
    }
    if (totalPagesEl) totalPagesEl.textContent = totalPages;

    if (firstBtn) firstBtn.disabled = currentPage <= 1;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (lastBtn) lastBtn.disabled = currentPage >= totalPages;

    var pillsContainer = document.getElementById('floor-supervisor-page-pills');
    if (pillsContainer) {
      pillsContainer.innerHTML = '';
      if (totalPages > 1) {
        var range = getPaginationRange(currentPage, totalPages);
        range.forEach(function (p) {
          if (p === '…') {
            var ell = document.createElement('span');
            ell.className = 'bai-sheet-page-ellipsis';
            ell.style.cssText = 'font-size:12px;color:#94a3b8;padding:0 3px;font-weight:700;user-select:none;';
            ell.textContent = '…';
            pillsContainer.appendChild(ell);
          } else {
            var pBtn = document.createElement('button');
            pBtn.type = 'button';
            pBtn.className = 'floor-supervisor-page-pill' + (p === currentPage ? ' active' : '');
            pBtn.textContent = p;
            pBtn.title = 'Go to page ' + p;
            pBtn.addEventListener('click', function () {
              if (currentPage !== p) {
                currentPage = p;
                renderTablePage();
                var wrap = document.getElementById('floor-supervisor-table-wrapper');
                if (wrap) wrap.scrollTop = 0;
              }
            });
            pillsContainer.appendChild(pBtn);
          }
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 12. Interactive Cell Selection & Clipboard Copy
  // ---------------------------------------------------------------------------
  function clearCellSelection() {
    var prev = document.querySelector('#floor-supervisor-tbody .bai-cell-selected');
    if (prev) prev.classList.remove('bai-cell-selected');
    activeCellCoords = null;
    var badge = document.getElementById('floor-supervisor-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function selectCell(r, c, tdEl) {
    clearCellSelection();
    activeCellCoords = { r: r, c: c };
    if (tdEl) tdEl.classList.add('bai-cell-selected');

    var badge = document.getElementById('floor-supervisor-active-cell-badge');
    if (badge) {
      var colName = allHeaders[c] || ('Col ' + (c + 1));
      var globalRow = (currentPage - 1) * pageSize + r + 1;
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#0284c7;">pin_drop</span> Row ' + globalRow.toLocaleString() + ' &bull; ' + escapeHtml(colName);
      badge.style.display = 'inline-flex';
    }
  }

  function selectCellByCoords(r, c) {
    var target = document.querySelector('#floor-supervisor-tbody td[data-r="' + r + '"][data-c="' + c + '"]');
    if (target) {
      selectCell(r, c, target);
      try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
    }
  }

  function copySelectedCellToClipboard() {
    var selectedCell = document.querySelector('#floor-supervisor-tbody .bai-cell-selected');
    if (!selectedCell) return false;

    var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { });
    }

    selectedCell.classList.remove('bai-cell-copied');
    void selectedCell.offsetWidth;
    selectedCell.classList.add('bai-cell-copied');
    setTimeout(function () { selectedCell.classList.remove('bai-cell-copied'); }, 500);

    var preview = text.length > 35 ? text.slice(0, 35) + '...' : text;
    showToast('Copied: "' + (preview || '(Blank)') + '"', 'copy');
    return true;
  }

  // ---------------------------------------------------------------------------
  // 13. PDF Generation 1: Row-Level Floor Supervisor Inspection Report
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

  function buildFsInspectionReportHtml(f) {
    var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';
    var companyName = 'TRIO TREND EXPORTS PVT. LTD.';
    var reportTitle = 'FLOOR SUPERVISOR INSPECTION REPORT';

    var fupSectionsHtml = FS_CHECKLIST.map(function (section, i) {
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
      '.doc-page { width: 794px; margin: 12px auto; background: #ffffff; padding: 12px 18px 10px 18px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); border: 1.5px solid #000000; box-sizing: border-box; }' +
      '.top-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #000000; padding-bottom: 5px; margin-bottom: 5px; position: relative; }' +
      '.top-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #c48b16 0%, #e2b342 50%, #c48b16 100%); }' +
      '.brand-col { display: flex; align-items: center; gap: 12px; }' +
      '.company-logo { height: 40px; width: auto; max-width: 140px; object-fit: contain; }' +
      '.brand-meta { display: flex; flex-direction: column; justify-content: center; }' +
      '.company-title { font-size: 15.5px; font-weight: 900; color: #0f2744; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.15; }' +
      '.company-sub { font-size: 9.5px; font-weight: 700; color: #475569; letter-spacing: 0.5px; margin-top: 1px; text-transform: uppercase; }' +
      '.report-title-col { text-align: right; }' +
      '.report-badge { display: inline-block; background: #f8fafc; color: #0f2744; border: 1.5px solid #0f2744; font-size: 12.5px; font-weight: 900; letter-spacing: 0.6px; padding: 3px 10px; border-radius: 0; }' +
      '.report-meta-sub { font-size: 10px; color: #1e293b; font-weight: 700; margin-top: 3px; }' +
      '.report-meta-sub strong { color: #000000; }' +
      '.info-card { background: #ffffff; border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 5px; }' +
      '.info-grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
      '.info-grid-table th, .info-grid-table td { border: 1px solid #000000; padding: 4.5px 6px; text-align: center; word-wrap: break-word; }' +
      '.info-grid-table th { background: #f1f5f9; color: #000000; font-weight: 900; font-size: 9.5px; letter-spacing: 0.4px; text-transform: uppercase; }' +
      '.info-grid-table td { font-weight: 800; color: #000000; font-size: 12px; line-height: 1.2; }' +
      '.val-highlight { color: #0f2744 !important; font-size: 12.5px !important; font-weight: 900 !important; }' +
      '.fup-card { border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 5px; background: #ffffff; }' +
      '.fup-header { background: #f1f5f9; color: #0f2744; display: flex; align-items: center; justify-content: space-between; padding: 3.5px 10px; border-bottom: 1.5px solid #000000; }' +
      '.fup-title-wrap { display: flex; align-items: center; gap: 7px; }' +
      '.fup-badge { display: inline-flex; align-items: center; justify-content: center; background: #fef3c7; color: #92400e; border: 1.2px solid #b45309; font-size: 9.5px; font-weight: 900; width: 17px; height: 17px; border-radius: 0; }' +
      '.fup-title-text { font-size: 11px; font-weight: 900; color: #0f2744; letter-spacing: 0.5px; text-transform: uppercase; }' +
      '.fup-date-tag { font-size: 9.5px; color: #334155; font-weight: 700; }' +
      '.fup-date-lbl { color: #64748b; font-weight: 800; }' +
      '.fup-date-val { color: #0f2744; font-weight: 900; background: #ffffff; padding: 1px 7px; border-radius: 0; border: 1.2px solid #0f2744; }' +
      '.fup-table { width: 100%; border-collapse: collapse; }' +
      '.fup-table th, .fup-table td { border: 1px solid #000000; padding: 3px 7px; vertical-align: middle; }' +
      '.fup-table thead tr { background: #f1f5f9; }' +
      '.fup-table th { color: #000000; font-weight: 900; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 6px; }' +
      '.fup-table tbody tr:nth-child(even) { background: #fbfcfe; }' +
      '.col-sl { width: 28px; text-align: center; font-weight: 900; color: #000000; font-size: 10px; }' +
      '.col-cp { color: #000000; font-weight: 700; font-size: 10.5px; line-height: 1.2; letter-spacing: 0.1px; }' +
      '.col-check { width: 50px; text-align: center; }' +
      '.chk-box { display: inline-block; width: 14px; height: 14px; border: 1.8px solid #000000; border-radius: 0; background: #ffffff; vertical-align: middle; }' +
      '.col-remarks { width: 260px; }' +
      '.remark-line { width: 100%; border-bottom: 1px dotted #475569; height: 13px; }' +
      '.sign-section { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px; }' +
      '.sign-box { flex: 1; border: 1.5px solid #000000; border-radius: 0; padding: 5px 8px; background: #ffffff; text-align: center; }' +
      '.sign-title { font-size: 10px; font-weight: 900; color: #0f2744; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 20px; }' +
      '.sign-line { border-bottom: 1.5px solid #000000; margin: 0 10px 3px 10px; }' +
      '.sign-caption { font-size: 8.5px; color: #334155; font-weight: 700; }' +
      '.footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; padding-top: 3px; border-top: 1.5px solid #000000; font-size: 8.5px; color: #334155; font-weight: 700; }' +
      '@media print { body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; } .doc-page { margin: 0 auto !important; padding: 6px 12px !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; } @page { size: A4 portrait; margin: 4mm 5mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }';

    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>Floor Supervisor Inspection Report - ' + escapeHtml(f.batchId || 'Batch') + '</title>' +
      '<style>' + css + '</style>' +
      '</head><body><div class="doc doc-page">' +
      '<!-- Top Header Bar -->' +
      '<div class="top-header">' +
      '<div class="brand-col">' +
      '<img class="company-logo" src="' + companyLogoUrl + '" alt="Trio Group Logo" />' +
      '<div class="brand-meta">' +
      '<div class="company-title">' + escapeHtml(companyName) + '</div>' +
      '<div class="company-sub">Quality Assurance &amp; Floor Operations Division</div>' +
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
      '<th style="width:25%;">FLOOR SUPERVISOR</th>' +
      '<th style="width:25%;">IN-LINE QC</th>' +
      '<th style="width:25%;">ETD (EXP. DELIVERY)</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td>' + escapeHtml(f.fabricator || '-') + '</td>' +
      '<td>' + escapeHtml(f.floorSup || '-') + '</td>' +
      '<td>' + escapeHtml(f.inLineQc || '-') + '</td>' +
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
      '<div class="sign-title">QA / Operations Manager</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Verified &amp; Approved</div>' +
      '</div>' +
      '</div>' +

      '<!-- Footer Security Notice -->' +
      '<div class="footer-bar">' +
      '<span>Trio Trend Exports Pvt. Ltd. &bull; Floor Supervisor Inspection System</span>' +
      '<span>Form Ref: FMS-FS-01</span>' +
      '</div>' +
      '</div></body></html>'
    );
  }

  function downloadRowInspectionReportPdf(row) {
    try {
      var f = extractRowFields(row);
      var html = buildFsInspectionReportHtml(f);

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
              var ratio = Math.max(0.92, PAGE_HEIGHT_PX / doc.scrollHeight);
              doc.style.zoom = ratio;
            }
          }
        } catch (e) { }
        try { win.print(); } catch (e) { }
      }, 350);
    } catch (err) {
      console.error('Row PDF error:', err);
      showToast('Could not generate PDF: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 14. PDF Generation 2: Full Landscape Table PDF Export
  // ---------------------------------------------------------------------------
  function exportFilteredTableToPdf() {
    if (filteredRows.length === 0) {
      showToast('No records available to export to PDF.', 'error');
      return;
    }

    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      showToast('jsPDF library is not loaded. Check internet connection.', 'error');
      return;
    }

    try {
      var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });

      // Embed custom font if available
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
      doc.text('FLOOR SUPERVISOR - PLANNED DATE REPORT', marginX, 28);

      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      var genDateStr = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB');
      doc.text('Trio Trend Exports Pvt. Ltd. · Generated: ' + genDateStr + ' · Records: ' + filteredRows.length.toLocaleString(), marginX, 42);

      // Pick clean set of primary columns for crisp table fit
      // Columns: #, Batch No., Leather Date, Unit, Fabricator, Brand, Style, Colour, QTY, ETD, PO, Floor Supervisor, 1st FU, 2nd FU, 3rd FU
      var exportCols = [
        { title: '#', dataKey: 'idx' },
        { title: 'Batch No.', dataKey: 'batchNo' },
        { title: 'Unit', dataKey: 'unit' },
        { title: 'Fabricator', dataKey: 'fabricator' },
        { title: 'Brand', dataKey: 'brand' },
        { title: 'SKU', dataKey: 'sku' },
        { title: 'Style', dataKey: 'style' },
        { title: 'Colour', dataKey: 'colour' },
        { title: 'QTY', dataKey: 'qty' },
        { title: 'ETD', dataKey: 'etd' },
        { title: 'PO', dataKey: 'po' },
        { title: 'Floor Supervisor', dataKey: 'floorSup' },
        { title: '1st Follow Up', dataKey: 'fu1' },
        { title: '2nd Follow Up', dataKey: 'fu2' },
        { title: '3rd Follow Up', dataKey: 'fu3' }
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
          etd: String(row[13] || ''),
          po: String(row[14] || ''),
          floorSup: String(row[15] || ''),
          fu1: String(row[18] || ''),
          fu2: String(row[19] || ''),
          fu3: String(row[20] || '')
        };
      });

      doc.autoTable({
        columns: exportCols,
        body: tableBody,
        startY: 52,
        margin: { left: marginX, right: marginX, bottom: 30 },
        styles: {
          font: fontFamily,
          fontSize: 7.5,
          cellPadding: 3.5,
          lineColor: [203, 213, 225],
          lineWidth: 0.5,
          textColor: [15, 23, 42]
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          halign: 'center'
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          idx: { cellWidth: 24, halign: 'center' },
          batchNo: { cellWidth: 70, fontStyle: 'bold' },
          unit: { cellWidth: 38, halign: 'center' },
          fabricator: { cellWidth: 80 },
          brand: { cellWidth: 50 },
          sku: { cellWidth: 46 },
          style: { cellWidth: 62 },
          colour: { cellWidth: 58 },
          qty: { cellWidth: 35, halign: 'right' },
          etd: { cellWidth: 52, halign: 'center' },
          po: { cellWidth: 62 },
          floorSup: { cellWidth: 78 },
          fu1: { cellWidth: 52, halign: 'center' },
          fu2: { cellWidth: 52, halign: 'center' },
          fu3: { cellWidth: 52, halign: 'center' }
        },
        didDrawPage: function (data) {
          // Footer page number
          var pageCount = doc.internal.getNumberOfPages();
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(
            'Page ' + data.pageNumber + ' of ' + pageCount,
            pageWidth - marginX - 45,
            pageHeight - 12
          );
          doc.text('Floor Supervisor Inspection & Planned Date Report', marginX, pageHeight - 12);
        }
      });

      var filename = 'Floor_Supervisor_Report_' + new Date().toISOString().slice(0, 10) + '.pdf';
      doc.save(filename);
      showToast('PDF Export complete: ' + filename, 'success');
    } catch (err) {
      console.error('Landscape PDF export error:', err);
      showToast('Failed to export PDF: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 15. Excel Export
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (filteredRows.length === 0) {
      showToast('No records available to export.', 'error');
      return;
    }
    if (!window.XLSX) {
      showToast('SheetJS (XLSX) library is missing.', 'error');
      return;
    }

    try {
      var exportData = [allHeaders];
      filteredRows.forEach(function (r) { exportData.push(r); });

      var ws = XLSX.utils.aoa_to_sheet(exportData);

      // Auto width
      var colWidths = allHeaders.map(function (h, i) {
        var maxLen = String(h).length;
        for (var r = 0; r < Math.min(filteredRows.length, 100); r++) {
          var cellVal = String(filteredRows[r][i] || '');
          if (cellVal.length > maxLen) maxLen = cellVal.length;
        }
        return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
      });
      ws['!cols'] = colWidths;

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Floor Supervisor');

      var filename = 'Floor_Supervisor_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      XLSX.writeFile(wb, filename);
      showToast('Excel file exported successfully: ' + filename, 'success');
    } catch (err) {
      console.error('Excel export error:', err);
      showToast('Failed to export Excel: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 16. Event Listeners & Binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Back to PDF Button
    var backBtn = document.getElementById('btn-back-pdf-fs');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hideView();
      });
    }

    // Refresh / Sync Button
    var syncBtn = document.getElementById('btn-refresh-fs-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export Excel Button
    var excelBtn = document.getElementById('btn-download-fs-excel');
    if (excelBtn) {
      excelBtn.addEventListener('click', exportExcelXLSX);
    }

    // Export PDF Button
    var pdfExportBtn = document.getElementById('btn-download-fs-pdf');
    if (pdfExportBtn) {
      pdfExportBtn.addEventListener('click', exportFilteredTableToPdf);
    }

    // Global Search Input with debounce
    var searchInput = document.getElementById('floor-supervisor-search-input');
    var searchClear = document.getElementById('floor-supervisor-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var val = searchInput.value;
        if (searchClear) searchClear.style.display = val ? 'block' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          searchQuery = val;
          applyAllFiltersAndSearch();
        }, 150);
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none';
        searchQuery = '';
        applyAllFiltersAndSearch();
        if (searchInput) searchInput.focus();
      });
    }

    // Page Size Selector
    var pageSizeSelect = document.getElementById('floor-supervisor-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(pageSizeSelect.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Clear All Filters Button
    var clearFiltersBtn = document.getElementById('floor-supervisor-clear-all-filters-btn');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', clearAllFilters);
    }

    // Pagination Buttons
    var firstBtn = document.getElementById('floor-supervisor-first-page');
    var prevBtn = document.getElementById('floor-supervisor-prev-page');
    var nextBtn = document.getElementById('floor-supervisor-next-page');
    var lastBtn = document.getElementById('floor-supervisor-last-page');
    var pageNumInput = document.getElementById('floor-supervisor-page-num');

    function scrollTableToTop() {
      var wrap = document.getElementById('floor-supervisor-table-wrapper');
      if (wrap) wrap.scrollTop = 0;
    }

    if (firstBtn) firstBtn.addEventListener('click', function () { currentPage = 1; renderTablePage(); scrollTableToTop(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; renderTablePage(); scrollTableToTop(); } });
    if (nextBtn) nextBtn.addEventListener('click', function () { var totalPages = Math.ceil(filteredRows.length / pageSize) || 1; if (currentPage < totalPages) { currentPage++; renderTablePage(); scrollTableToTop(); } });
    if (lastBtn) lastBtn.addEventListener('click', function () { var totalPages = Math.ceil(filteredRows.length / pageSize) || 1; currentPage = totalPages; renderTablePage(); scrollTableToTop(); });

    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var p = parseInt(pageNumInput.value, 10) || 1;
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        currentPage = Math.min(Math.max(1, p), totalPages);
        renderTablePage();
        scrollTableToTop();
      });
    }

    // Popover Close & Actions
    var popCloseBtn = document.getElementById('floor-supervisor-filter-pop-close');
    var popCancelBtn = document.getElementById('floor-supervisor-filter-cancel-btn');
    var popOkBtn = document.getElementById('floor-supervisor-filter-ok-btn');
    var popResetBtn = document.getElementById('floor-supervisor-filter-reset-btn');
    var popSortAsc = document.getElementById('floor-supervisor-sort-asc');
    var popSortDesc = document.getElementById('floor-supervisor-sort-desc');
    var popSelectAll = document.getElementById('floor-supervisor-filter-select-all');
    var popClearAll = document.getElementById('floor-supervisor-filter-clear-all');
    var popSearchInput = document.getElementById('floor-supervisor-filter-search-input');
    var popSearchClear = document.getElementById('floor-supervisor-filter-search-clear');

    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    if (popOkBtn) popOkBtn.addEventListener('click', applyPopoverFilter);
    if (popResetBtn) popResetBtn.addEventListener('click', resetCurrentColumnFilter);

    if (popSortAsc) {
      popSortAsc.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          sortColIdx = currentFilterColIdx;
          sortAsc = true;
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
        }
      });
    }
    if (popSortDesc) {
      popSortDesc.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          sortColIdx = currentFilterColIdx;
          sortAsc = false;
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
        }
      });
    }

    if (popSelectAll) {
      popSelectAll.addEventListener('click', function () {
        currentFilterUniqueValues.forEach(function (v) { currentFilterSelectedSet.add(v); });
        renderFilterPopoverValuesList();
      });
    }
    if (popClearAll) {
      popClearAll.addEventListener('click', function () {
        currentFilterSelectedSet.clear();
        renderFilterPopoverValuesList();
      });
    }

    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        var v = popSearchInput.value;
        if (popSearchClear) popSearchClear.style.display = v ? 'block' : 'none';
        currentFilterSearchQuery = v;
        renderFilterPopoverValuesList();
      });
    }
    if (popSearchClear) {
      popSearchClear.addEventListener('click', function () {
        if (popSearchInput) popSearchInput.value = '';
        popSearchClear.style.display = 'none';
        currentFilterSearchQuery = '';
        renderFilterPopoverValuesList();
      });
    }

    // Click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('floor-supervisor-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Keyboard navigation & cell selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('pdf-floor-supervisor-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('floor-supervisor-tbody');
        if (!tbody) return;
        var rowsInPage = tbody.querySelectorAll('tr').length;
        if (rowsInPage === 0) return;
        var colsCount = NUM_COLS;
        var r = activeCellCoords ? activeCellCoords.r : 0;
        var c = activeCellCoords ? activeCellCoords.c : 0;

        if (key === 'ArrowUp') { e.preventDefault(); r = Math.max(0, r - 1); }
        else if (key === 'ArrowDown' || key === 'Enter') { e.preventDefault(); r = Math.min(rowsInPage - 1, r + 1); }
        else if (key === 'ArrowLeft') { e.preventDefault(); c = Math.max(0, c - 1); }
        else if (key === 'ArrowRight') { e.preventDefault(); c = Math.min(colsCount - 1, c + 1); }
        else if (key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) { c--; if (c < 0) { c = colsCount - 1; r = Math.max(0, r - 1); } }
          else { c++; if (c >= colsCount) { c = 0; r = Math.min(rowsInPage - 1, r + 1); } }
        }
        selectCellByCoords(r, c);
      } else if (key === 'Escape') {
        var popover = document.getElementById('floor-supervisor-filter-popover');
        if (popover && popover.style.display !== 'none') closeColumnFilterPopover();
        else if (activeCellCoords) clearCellSelection();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 17. View Lifecycle: Show / Hide
  // ---------------------------------------------------------------------------
  function showView() {
    var spinner = document.getElementById('spinner-overlay');
    if (spinner) spinner.classList.add('hidden');

    var kpi = document.getElementById('pdf-kpi-view');
    var fsv = document.getElementById('pdf-floor-supervisor-view');
    var iqc = document.getElementById('pdf-inline-qc-view');
    var eqc = document.getElementById('pdf-endline-qc-view');
    var epv = document.getElementById('pdf-edge-paint-view');

    if (kpi) kpi.style.display = 'none';
    if (iqc) iqc.style.display = 'none';
    if (eqc) eqc.style.display = 'none';
    if (epv) epv.style.display = 'none';
    if (fsv) fsv.style.display = 'block';

    if (window.InLineQcSheetEngine && typeof window.InLineQcSheetEngine.clearSelection === 'function') {
      window.InLineQcSheetEngine.clearSelection();
    }
    if (window.EndLineQcSheetEngine && typeof window.EndLineQcSheetEngine.clearSelection === 'function') {
      window.EndLineQcSheetEngine.clearSelection();
    }
    if (window.EdgePaintSheetEngine && typeof window.EdgePaintSheetEngine.clearSelection === 'function') {
      window.EdgePaintSheetEngine.clearSelection();
    }

    if (allRows.length === 0) {
      initDataEngine();
    } else {
      renderHeaderRow();
      renderTablePage();
      updateHeaderBadge();
    }
  }

  function hideView() {
    var kpi = document.getElementById('pdf-kpi-view');
    var fsv = document.getElementById('pdf-floor-supervisor-view');
    if (fsv) fsv.style.display = 'none';
    if (kpi) kpi.style.display = 'block';
  }

  // ---------------------------------------------------------------------------
  // 18. Bootstrap
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    // Eagerly hydrate from local IndexedDB cache so it's instantly ready
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        updateHeaderBadge();
      }
    }).catch(function () { });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.FloorSupervisorSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    exportPdf: exportFilteredTableToPdf,
    downloadRowPdf: downloadRowInspectionReportPdf,
    buildReportHtml: buildFsInspectionReportHtml,
    extractRowFields: extractRowFields,
    setRows: function (headers, rows) {
      if (headers && headers.length) allHeaders = headers;
      if (rows && rows.length) allRows = rows;
      applyAllFiltersAndSearch();
      updateHeaderBadge();
    },
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
