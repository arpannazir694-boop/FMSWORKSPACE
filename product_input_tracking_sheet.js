/**
 * =============================================================================
 * Product Input Tracking Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Sheet: Product Input Tracking (Spreadsheet ID: 1wpW9Nh_b-EFyahhXUXKHJ7ZcRx1oF-4h6AG0LitNtg0)
 * GID: 0
 * Range: A1:E (5 Columns: A to E)
 * Headers (Row 1):
 *   1. PRODNUM
 *   2. PROD QTY
 *   3. MASTERPRODNUM
 *   4. Style No.
 *   5. Colour
 * Database: IndexedDB 'FMS_Product_Input_Tracking_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser
 *   - Real-time client-side search across all 5 columns
 *   - Google Sheets style parallel multi-column filtering with popover & value search
 *   - Active filter chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1wpW9Nh_b-EFyahhXUXKHJ7ZcRx1oF-4h6AG0LitNtg0';
  var SHEET_GID = '0';
  // Primary export endpoint fetches all underlying rows regardless of active Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:E';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:E';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Product_Input_Tracking_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'product_input_tracking_store';

  var defaultHeaders = [
    'PRODNUM', 'PROD QTY', 'MASTERPRODNUM', 'Style No.', 'Colour'
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

  // Column Filters State
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null;

  // SVG Icons for clean professional UI (NO emojis)
  var SVG_ICONS = {
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Engine
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance) return resolve(dbInstance);
      if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));
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
  // 2. High Performance CSV Stream Parser (5 Columns: A to E)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var NUM_COLS = 5;

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
    var primaryWithTs = PRIMARY_CSV_URL + '&_=' + ts;
    return fetch(primaryWithTs, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary export HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) {
          throw new Error('Primary export returned incomplete payload');
        }
        return csvText;
      })
      .catch(function (err) {
        console.warn('[ProductInputTracking] Primary export fetch failed, falling back to GViz:', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
          .then(function (res2) {
            if (!res2.ok) throw new Error('GViz fallback HTTP ' + res2.status);
            return res2.text();
          });
      })
      .then(function (validCsv) { return parseCSVStream(validCsv); });
  }

  // ---------------------------------------------------------------------------
  // 4. Background Sync & Cache Orchestration
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
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
        console.error('Product Input Tracking sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Product Input Tracking from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 5) ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
          // Run background refresh if data exists
          setTimeout(function () { syncFromGoogleSheet(false); }, 800);
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
  // 5. Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('product-input-tracking-thead');
    if (!thead) return;
    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // Serial # Column Header
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th-index';
    thIndex.textContent = '#';
    thIndex.style.width = '55px';
    thIndex.style.minWidth = '55px';
    thIndex.style.maxWidth = '55px';
    thIndex.style.textAlign = 'center';
    thIndex.style.background = '#091729';
    thIndex.style.color = '#94a3b8';
    thIndex.style.borderRight = '2px solid #334155';
    tr.appendChild(thIndex);

    // Data Column Headers
    allHeaders.forEach(function (headerText, colIdx) {
      var th = document.createElement('th');
      th.setAttribute('data-col', colIdx);

      // Width presets
      if (colIdx === 0) th.style.minWidth = '140px';      // PRODNUM
      else if (colIdx === 1) th.style.minWidth = '110px'; // PROD QTY
      else if (colIdx === 2) th.style.minWidth = '220px'; // MASTERPRODNUM
      else if (colIdx === 3) th.style.minWidth = '160px'; // Style No.
      else if (colIdx === 4) th.style.minWidth = '140px'; // Colour

      var wrap = document.createElement('div');
      wrap.className = 'bai-sheet-th-content';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.justifyContent = 'space-between';
      wrap.style.gap = '6px';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'bai-sheet-th-title';
      titleSpan.textContent = headerText;
      titleSpan.title = headerText;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (activeColumnFilters[colIdx] ? ' active' : '');
      filterBtn.title = 'Filter ' + headerText;
      filterBtn.setAttribute('data-col', colIdx);
      filterBtn.innerHTML = '<span class="material-icons-round">filter_alt</span>';

      filterBtn.addEventListener('click', (function (cIdx, btn) {
        return function (e) {
          e.stopPropagation();
          openColumnFilterPopover(cIdx, btn);
        };
      })(colIdx, filterBtn));

      wrap.appendChild(titleSpan);
      wrap.appendChild(filterBtn);
      th.appendChild(wrap);
      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 6. Active Filters Bar
  // ---------------------------------------------------------------------------
  function renderActiveFilterChips() {
    var bar = document.getElementById('product-input-tracking-active-filters-bar');
    var container = document.getElementById('product-input-tracking-active-filters-chips');
    if (!bar || !container) return;
    var activeKeys = Object.keys(activeColumnFilters);
    if (activeKeys.length === 0) { bar.style.display = 'none'; container.innerHTML = ''; return; }
    bar.style.display = 'flex';
    container.innerHTML = '';
    activeKeys.forEach(function (k) {
      var colIdx = parseInt(k, 10);
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var allowedSet = activeColumnFilters[colIdx];
      var totalVals = getUniqueValuesForColumn(colIdx).keys.length;
      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';
      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-chip-text';
      textSpan.textContent = colName + ' (' + allowedSet.size + '/' + totalVals + ')';
      textSpan.title = colName + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter for ' + colName;
      removeBtn.innerHTML = 'x';
      removeBtn.addEventListener('click', (function (ci, cn) {
        return function () { delete activeColumnFilters[ci]; applyAllFiltersAndSearch(); showToast('Filter removed on ' + cn, 'filter'); };
      })(colIdx, colName));
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
      if (a === '') return 1; if (b === '') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return { keys: keys, counts: map };
  }

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
    var popover = document.getElementById('product-input-tracking-filter-popover');
    var titleEl = document.getElementById('product-input-tracking-filter-pop-title');
    var searchInput = document.getElementById('product-input-tracking-filter-search-input');
    var searchClear = document.getElementById('product-input-tracking-filter-search-clear');
    if (titleEl) { titleEl.textContent = 'Filter: ' + colName; titleEl.title = colName; }
    if (searchInput) { searchInput.value = ''; currentFilterSearchQuery = ''; }
    if (searchClear) searchClear.style.display = 'none';

    var uv = getUniqueValuesForColumn(colIdx);
    currentFilterUniqueValues = uv.keys;
    currentFilterValueCounts = uv.counts;
    currentFilterSelectedSet = activeColumnFilters[colIdx] ? new Set(activeColumnFilters[colIdx]) : new Set(currentFilterUniqueValues);
    renderFilterList();

    if (!popover) return;
    popover.style.display = 'block';
    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 320;
    var left = rect.left;
    if (left + popWidth > window.innerWidth - 16) left = window.innerWidth - popWidth - 16;
    if (left < 16) left = 16;
    var top = rect.bottom + 6;
    var maxTop = window.innerHeight - 440;
    if (top > maxTop) top = Math.max(16, rect.top - 410);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    setTimeout(function () { if (searchInput) searchInput.focus(); }, 50);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('product-input-tracking-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('product-input-tracking-filter-list');
    var countEl = document.getElementById('product-input-tracking-filter-items-count');
    if (!listEl) return;
    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();
    var visibleVals = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      return (val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1;
    });
    if (countEl) countEl.textContent = visibleVals.length.toLocaleString() + ' items';
    if (visibleVals.length === 0) { listEl.innerHTML = '<div class="bai-sheet-filter-empty">No matching values</div>'; return; }

    // Cap DOM rendering to first 250 items to keep UI ultra responsive with 20k+ unique items
    var maxToRender = Math.min(visibleVals.length, 250);
    if (visibleVals.length > 250) {
      var hint = document.createElement('div');
      hint.style.cssText = 'padding:5px 10px; font-size:11px; color:#64748b; background:#f8fafc; border-bottom:1px solid #e2e8f0;';
      hint.textContent = 'Showing first 250 of ' + visibleVals.length.toLocaleString() + ' values. Use search to filter.';
      listEl.appendChild(hint);
    }

    for (var idx = 0; idx < maxToRender; idx++) {
      var val = visibleVals[idx];
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
        return function () { if (checkbox.checked) currentFilterSelectedSet.add(v); else currentFilterSelectedSet.delete(v); };
      })(val, cb));
      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = displayLabel;
      textSpan.title = displayLabel;
      if (val === '') { textSpan.style.fontStyle = 'italic'; textSpan.style.color = '#94a3b8'; }
      leftDiv.appendChild(cb);
      leftDiv.appendChild(textSpan);
      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = '(' + count.toLocaleString() + ')';
      item.appendChild(leftDiv);
      item.appendChild(countBadge);
      listEl.appendChild(item);
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Table Page & Cell Selection Rendering (5 Columns of Product Input Tracking)
  // ---------------------------------------------------------------------------
  function renderEmptyState(message) {
    var tbody = document.getElementById('product-input-tracking-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' + (message || 'No records found.') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('product-input-tracking-tbody');
    var countLabel = document.getElementById('product-input-tracking-count-label');
    var showingRange = document.getElementById('product-input-tracking-showing-range');
    var totalPagesEl = document.getElementById('product-input-tracking-total-pages');
    var pageNumInput = document.getElementById('product-input-tracking-page-num');
    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in Product Input Tracking sheet.' : 'No matching records found.') + '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (showingRange) showingRange.textContent = 'Showing 0 - 0 of 0';
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

    if (countLabel) countLabel.textContent = filteredRows.length.toLocaleString() + ' of ' + allRows.length.toLocaleString() + ' records';
    if (showingRange) showingRange.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' - ' + endIdx.toLocaleString() + ' of ' + filteredRows.length.toLocaleString();
    if (totalPagesEl) totalPagesEl.textContent = totalPages.toLocaleString();
    if (pageNumInput) { pageNumInput.value = currentPage; pageNumInput.max = totalPages; }
    updatePaginationButtons(currentPage, totalPages);

    var fragment = document.createDocumentFragment();
    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      // Serial # Cell
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index';
      tdNum.textContent = (startIdx + localRowIdx + 1).toLocaleString();
      tr.appendChild(tdNum);

      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }
        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Columns:
        // 0: PRODNUM
        // 1: PROD QTY
        // 2: MASTERPRODNUM
        // 3: Style No.
        // 4: Colour
        if (colIdx === 0) { // PRODNUM
          td.style.fontWeight = '700';
          td.style.color = '#0369a1';
          td.style.fontFamily = 'monospace';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 1) { // PROD QTY
          td.className = 'bai-sheet-td-num';
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.background = 'rgba(255, 247, 237, 0.55)';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 2) { // MASTERPRODNUM
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '600';
          td.style.color = '#1e293b';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 3) { // Style No.
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 4) { // Colour
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else {
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        }

        td.addEventListener('mousedown', (function (r, c) {
          return function () { selectCellByCoords(r, c); };
        })(localRowIdx, colIdx));
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function updatePaginationButtons(current, total) {
    var firstBtn = document.getElementById('product-input-tracking-first-page');
    var prevBtn = document.getElementById('product-input-tracking-prev-page');
    var nextBtn = document.getElementById('product-input-tracking-next-page');
    var lastBtn = document.getElementById('product-input-tracking-last-page');
    if (firstBtn) firstBtn.disabled = (current <= 1);
    if (prevBtn) prevBtn.disabled = (current <= 1);
    if (nextBtn) nextBtn.disabled = (current >= total);
    if (lastBtn) lastBtn.disabled = (current >= total);
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('product-input-tracking-tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    if (r < 0 || r >= rows.length) return;
    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!targetCell) return;
    var prev = tbody.querySelector('.bai-cell-selected');
    if (prev) prev.classList.remove('bai-cell-selected');
    targetCell.classList.add('bai-cell-selected');
    activeCellCoords = { r: r, c: c };
    targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    var badge = document.getElementById('product-input-tracking-active-cell-badge');
    if (badge) {
      var rowNum = (currentPage - 1) * pageSize + r + 1;
      var colHeader = allHeaders[c] || ('Col ' + c);
      var text = (targetCell.innerText !== undefined ? targetCell.innerText : targetCell.textContent || '').trim();
      if (text.length > 25) text = text.slice(0, 25) + '...';
      badge.style.display = 'inline-flex';
      badge.innerHTML = '<span class="material-icons-round">my_location</span> Cell [' + colHeader + ', Row ' + rowNum.toLocaleString() + ']: <span style="color:#0284c7;margin-left:4px;">' + escapeHtml(text) + '</span>';
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('product-input-tracking-tbody');
    if (tbody) {
      var prev = tbody.querySelector('.bai-cell-selected');
      if (prev) prev.classList.remove('bai-cell-selected');
    }
    activeCellCoords = null;
    var badge = document.getElementById('product-input-tracking-active-cell-badge');
    if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // 10. Clipboard Copy Engine (Ctrl + C / Cmd + C)
  // ---------------------------------------------------------------------------
  function copyTextToClipboard(text, onSuccess, onFail) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { if (onSuccess) onSuccess(); }).catch(function () { fallbackCopyText(text, onSuccess, onFail); });
    } else { fallbackCopyText(text, onSuccess, onFail); }
  }

  function fallbackCopyText(text, onSuccess, onFail) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.left = '-9999px'; ta.style.opacity = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { if (onSuccess) onSuccess(); } else { if (onFail) onFail(); }
    } catch (err) { if (onFail) onFail(); }
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('product-input-tracking-tbody');
    if (!tbody) return false;
    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;
    var cellText = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
    copyTextToClipboard(cellText, function () {
      selectedCell.classList.remove('bai-cell-copied');
      void selectedCell.offsetWidth;
      selectedCell.classList.add('bai-cell-copied');
      setTimeout(function () { selectedCell.classList.remove('bai-cell-copied'); }, 500);
      var preview = cellText.length > 35 ? cellText.slice(0, 35) + '...' : cellText;
      if (preview === '') preview = '(Blank)';
      showToast('Copied: "' + preview + '"', 'copy');
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // 11. Excel Export (SheetJS)
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library is loading, please try again.', 'warning');
      return;
    }
    if (!filteredRows || filteredRows.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }
    var totalCount = filteredRows.length;
    // Excel supports up to 1,048,576 rows per worksheet (1 header row + 1,048,575 data rows)
    var maxExport = Math.min(totalCount, 1048575);
    showToast('Generating Excel file (' + maxExport.toLocaleString() + ' records)...', 'clock');
    setTimeout(function () {
      try {
        var aoa = [['#'].concat(allHeaders.slice())];
        for (var rIdx = 0; rIdx < maxExport; rIdx++) {
          var row = filteredRows[rIdx];
          var excelRow = [rIdx + 1];
          for (var c = 0; c < allHeaders.length; c++) excelRow.push(row[c] || '');
          aoa.push(excelRow);
        }
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var colWidths = [{ wch: 8 }].concat(allHeaders.map(function (h, idx) {
          var maxLen = (h || '').length;
          for (var r = 0; r < Math.min(maxExport, 100); r++) {
            var s = String(filteredRows[r][idx] || '');
            if (s.length > maxLen) maxLen = s.length;
          }
          return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
        }));
        ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, 'Product Input Tracking');
        XLSX.writeFile(wb, 'Product_Input_Tracking_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        var exportMsg = 'Exported ' + maxExport.toLocaleString() + ' records to Excel';
        if (totalCount > maxExport) {
          exportMsg += ' (capped at 1,048,575 rows - Excel sheet limit)';
        }
        showToast(exportMsg, 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error'), 'error');
      }
    }, 100);
  }

  // ---------------------------------------------------------------------------
  // 12. View Navigation & UI Badges
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('batch-list-kpi-view');
    var cutView = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    var trackingView = document.getElementById('batch-list-product-input-tracking-view');

    if (kpiView) kpiView.style.display = 'none';
    if (cutView) cutView.style.display = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (trackingView) trackingView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('product-input-tracking-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var trackingView = document.getElementById('batch-list-product-input-tracking-view');
    var kpiView = document.getElementById('batch-list-kpi-view');
    if (trackingView) trackingView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('product-input-tracking-db-badge');
    var syncText = document.getElementById('product-input-tracking-last-sync-text');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;">bolt</span> ' +
        (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        syncText.textContent = 'Last synced: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('product-input-tracking-sync-banner');
    var syncMsg = document.getElementById('product-input-tracking-sync-msg');
    var syncIcon = document.getElementById('product-input-tracking-sync-icon');
    if (syncBanner && syncMsg) {
      if (syncing) {
        syncMsg.textContent = msg || 'Syncing with Google Sheet...';
        syncBanner.style.display = 'flex';
      } else {
        syncBanner.style.display = 'none';
      }
    }
    if (syncIcon) {
      if (syncing) syncIcon.classList.add('bai-sheet-spin');
      else syncIcon.classList.remove('bai-sheet-spin');
    }
  }

  function applyAllFiltersAndSearch() {
    var sInput = document.getElementById('product-input-tracking-search-input');
    var q = sInput ? sInput.value.toLowerCase().trim() : '';
    var clearBtn = document.getElementById('product-input-tracking-search-clear');
    if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

    var activeFilterKeys = Object.keys(activeColumnFilters);
    var hasFilters = activeFilterKeys.length > 0;

    if (!q && !hasFilters) {
      filteredRows = allRows.slice();
    } else {
      filteredRows = allRows.filter(function (row) {
        if (hasFilters) {
          for (var k = 0; k < activeFilterKeys.length; k++) {
            var cIdx = parseInt(activeFilterKeys[k], 10);
            var allowed = activeColumnFilters[cIdx];
            var cellVal = (row[cIdx] !== undefined && row[cIdx] !== null) ? String(row[cIdx]).trim() : '';
            if (!allowed.has(cellVal)) return false;
          }
        }
        if (q) {
          var matched = false;
          for (var c = 0; c < row.length; c++) {
            var v = (row[c] !== undefined && row[c] !== null) ? String(row[c]).toLowerCase() : '';
            if (v.indexOf(q) !== -1) { matched = true; break; }
          }
          if (!matched) return false;
        }
        return true;
      });
    }

    currentPage = 1;
    clearCellSelection();
    renderActiveFilterChips();
    renderHeaderRow();
    renderTablePage();
  }

  function showToast(msg, customType) {
    var existing = document.getElementById('product-input-tracking-toast');
    if (existing) existing.remove();
    var cleanMsg = String(msg || '').replace(/\s+/g, ' ').trim();
    var type = customType || 'info';
    var iconKey = customType || 'info';
    var lower = cleanMsg.toLowerCase();
    if (!customType) {
      if (lower.indexOf('copied') !== -1) { type = 'info'; iconKey = 'copy'; }
      else if (lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1) { type = 'error'; iconKey = 'error'; }
      else if (lower.indexOf('warning') !== -1 || lower.indexOf('no records') !== -1) { type = 'warning'; iconKey = 'warning'; }
      else if (lower.indexOf('synced') !== -1 || lower.indexOf('ready') !== -1) { type = 'success'; iconKey = 'check'; }
      else if (lower.indexOf('exported') !== -1) { type = 'success'; iconKey = 'download'; }
      else if (lower.indexOf('generating') !== -1) { type = 'warning'; iconKey = 'clock'; }
      else if (lower.indexOf('filter') !== -1) { type = 'info'; iconKey = 'filter'; }
      else if (lower.indexOf('sort') !== -1) { type = 'info'; iconKey = 'sort'; }
    }
    var iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.info;
    var toast = document.createElement('div');
    toast.id = 'product-input-tracking-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 13. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in Production Data page (capture phase takes priority)
    var kpiCard = document.getElementById('kpi-product-input-tracking');
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

    // Back Button
    var backBtn = document.getElementById('btn-back-product-input-tracking');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-refresh-product-input-tracking-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-product-input-tracking-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportExcelXLSX();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('product-input-tracking-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('product-input-tracking-search-clear');
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
    var pageSizeSelect = document.getElementById('product-input-tracking-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('product-input-tracking-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('product-input-tracking-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('product-input-tracking-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('product-input-tracking-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage = tp;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('product-input-tracking-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > tp) val = tp;
          currentPage = val;
          renderTablePage();
        }
      });
      pageNumInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('product-input-tracking-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('product-input-tracking-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('product-input-tracking-filter-search-input');
    var popSearchClear = document.getElementById('product-input-tracking-filter-search-clear');
    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClear) popSearchClear.style.display = this.value ? 'block' : 'none';
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

    var popSelectAllBtn = document.getElementById('product-input-tracking-filter-select-all');
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

    var popClearAllBtn = document.getElementById('product-input-tracking-filter-clear-all');
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

    var sortAscBtn = document.getElementById('product-input-tracking-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          return String(a[col] || '').localeCompare(String(b[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (A to Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('product-input-tracking-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          return String(b[col] || '').localeCompare(String(a[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (Z to A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('product-input-tracking-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('product-input-tracking-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('product-input-tracking-filter-ok-btn');
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
      var popover = document.getElementById('product-input-tracking-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('product-input-tracking-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard Navigation & Cell Selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('batch-list-product-input-tracking-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('product-input-tracking-tbody');
        if (!tbody) return;
        var rowsInPage = tbody.querySelectorAll('tr').length;
        if (rowsInPage === 0) return;
        var colsCount = allHeaders.length;
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
      }
    });

    // Native copy event
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('batch-list-product-input-tracking-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('product-input-tracking-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
            selectedCell.classList.remove('bai-cell-copied');
            void selectedCell.offsetWidth;
            selectedCell.classList.add('bai-cell-copied');
            setTimeout(function () { selectedCell.classList.remove('bai-cell-copied'); }, 500);
            var preview = text.length > 35 ? text.slice(0, 35) + '...' : text;
            if (preview === '') preview = '(Blank)';
            showToast('Copied: "' + preview + '"', 'copy');
          }
        }
      }
    });

    // Escape Key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('product-input-tracking-filter-popover');
        if (popover && popover.style.display !== 'none') closeColumnFilterPopover();
        else if (activeCellCoords) clearCellSelection();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Bootstrap
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === 5) ? cached.headers : defaultHeaders.slice();
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

  window.ProductInputTrackingSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
