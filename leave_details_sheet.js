/**
 * =============================================================================
 * Leave Details Live Engine (IndexedDB + Fast Google Sheets GVIZ CSV)
 * =============================================================================
 * Sheet: Leave Attendance Details (Spreadsheet ID: 1JwMG1jv7_rVUC4zx3EJy9Do7P1qRJdZWiWpqxRKGzFs)
 * GID: 0
 * Range: B1:H (7 Columns: B to H)
 * Headers (Row 1):
 *   1. Date
 *   2. Name
 *   3. Unit
 *   4. Leave Reason
 *   5. Leave Application Status
 *   6. Application Date
 *   7. Remarks
 * Database: IndexedDB 'FMS_Leave_Details_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser
 *   - Real-time client-side search across all 7 columns
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

  var SHEET_ID = '1JwMG1jv7_rVUC4zx3EJy9Do7P1qRJdZWiWpqxRKGzFs';
  var SHEET_GID = '0';
  // Primary export endpoint fetches all underlying rows bypassing active Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B1:H';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B1:H';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Leave_Details_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'leave_details_store';

  var defaultHeaders = [
    'Date',
    'Name',
    'Unit',
    'Leave Reason',
    'Leave Application Status',
    'Application Date',
    'Remarks'
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
  // 2. High Performance CSV Stream Parser (7 Columns: B to H)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var NUM_COLS = 7;

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
      if (curRow.length === 0) return;
      while (curRow.length < NUM_COLS) curRow.push('');
      if (curRow.length > NUM_COLS) curRow = curRow.slice(0, NUM_COLS);

      if (isFirstRow) {
        var h0 = curRow[0].toLowerCase();
        if (h0.indexOf('date') !== -1 || h0 === 'date') {
          allHeaders = curRow.map(function (h, idx) { return h || defaultHeaders[idx]; });
          isFirstRow = false;
          curRow = [];
          return;
        }
        isFirstRow = false;
      }
      var hasAny = false;
      for (var k = 0; k < NUM_COLS; k++) {
        if (curRow[k] !== '') { hasAny = true; break; }
      }
      if (hasAny) rows.push(curRow);
      curRow = [];
    }

    return rows;
  }

  // ---------------------------------------------------------------------------
  // 3. Fast Google Sheets Sync
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Fetching latest Leave Details from Google Sheet...' : 'Updating Leave Details cache...');

    var ts = Date.now();
    var primaryUrl = PRIMARY_CSV_URL + '&_t=' + ts;
    var fallbackUrl = FALLBACK_CSV_URL + '&_t=' + ts;

    fetch(primaryUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('Primary HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) throw new Error('Primary payload empty');
        return csvText;
      })
      .catch(function (err) {
        console.warn('Primary export CSV fetch failed, trying GViz fallback...', err);
        return fetch(fallbackUrl).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP ' + res2.status);
          return res2.text();
        });
      })
      .then(function (csvText) {
        var parsed = parseCSVStream(csvText);
        if (!parsed || parsed.length === 0) {
          throw new Error('Empty data received from Google Sheet');
        }
        allRows = parsed;
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
        console.error('Leave Details sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Leave Details from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 7) ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
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
  // 4. Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('leave-details-sheet-thead');
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

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) th.classList.add('has-active-filter');

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';

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
        return function (e) { e.stopPropagation(); openColumnFilterPopover(ci, fb); };
      })(colIdx, filterBtn));

      inner.appendChild(labelSpan);
      inner.appendChild(filterBtn);
      th.appendChild(inner);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 5. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('leave-details-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';

    filteredRows = allRows.filter(function (row) {
      // 1. Column-specific filters
      for (var colIdxStr in activeColumnFilters) {
        var colIdx = parseInt(colIdxStr, 10);
        var allowedValues = activeColumnFilters[colIdx];
        if (allowedValues && allowedValues.size > 0) {
          var cellVal = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          if (!allowedValues.has(cellVal)) return false;
        }
      }

      // 2. Global search across all 7 columns
      if (rawSearch) {
        var matched = false;
        for (var c = 0; c < row.length; c++) {
          var val = String(row[c] || '').toLowerCase();
          if (val.indexOf(rawSearch) !== -1) { matched = true; break; }
        }
        if (!matched) return false;
      }

      return true;
    });

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();

    var searchClear = document.getElementById('leave-details-sheet-search-clear');
    if (searchClear) searchClear.style.display = rawSearch ? 'block' : 'none';

    // Update th active state
    var thead = document.getElementById('leave-details-sheet-thead');
    if (thead) {
      var ths = thead.querySelectorAll('th.bai-sheet-th-filterable');
      ths.forEach(function (th) {
        var ci = parseInt(th.getAttribute('data-col-idx'), 10);
        var hasF = activeColumnFilters[ci] && activeColumnFilters[ci].size > 0;
        if (hasF) th.classList.add('has-active-filter');
        else th.classList.remove('has-active-filter');
        var btn = th.querySelector('.bai-sheet-col-filter-btn');
        if (btn) {
          if (hasF) {
            btn.classList.add('is-active');
            btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_alt</span>';
          } else {
            btn.classList.remove('is-active');
            btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_list</span>';
          }
        }
      });
    }
  }

  function renderActiveFilterChips() {
    var bar = document.getElementById('leave-details-sheet-active-filters-bar');
    var container = document.getElementById('leave-details-sheet-active-filters-chips');
    if (!bar || !container) return;

    var filterColIndices = Object.keys(activeColumnFilters);
    if (filterColIndices.length === 0) {
      bar.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    container.innerHTML = '';

    filterColIndices.forEach(function (colIdxStr) {
      var colIdx = parseInt(colIdxStr, 10);
      var selectedSet = activeColumnFilters[colIdx];
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));

      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';

      var textSpan = document.createElement('span');
      textSpan.textContent = colName + ' (' + selectedSet.size + ')';

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-chip-remove';
      removeBtn.title = 'Remove filter on ' + colName;
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', (function (ci, cn) {
        return function () {
          delete activeColumnFilters[ci];
          applyAllFiltersAndSearch();
          showToast('Filter removed on ' + cn, 'filter');
        };
      })(colIdx, colName));

      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Column Filter Popover
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
    var popover = document.getElementById('leave-details-sheet-filter-popover');
    var titleEl = document.getElementById('leave-details-sheet-filter-pop-title');
    var searchInput = document.getElementById('leave-details-sheet-filter-search-input');
    var searchClear = document.getElementById('leave-details-sheet-filter-search-clear');
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
    var popover = document.getElementById('leave-details-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('leave-details-sheet-filter-list');
    var countEl = document.getElementById('leave-details-sheet-filter-items-count');
    if (!listEl) return;
    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();
    var visibleVals = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      return (val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1;
    });
    if (countEl) countEl.textContent = visibleVals.length.toLocaleString() + ' items';
    if (visibleVals.length === 0) { listEl.innerHTML = '<div class="bai-sheet-filter-empty">No matching values</div>'; return; }

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
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Table Page & Cell Selection Rendering (7 Columns: Leave Attendance Details)
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('leave-details-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="bai-sheet-table-empty">' +
      '<div class="bai-sheet-empty-wrap">' +
      '<span class="material-icons-round bai-sheet-spin" style="font-size:24px;color:#0284c7;">sync</span>' +
      '<span>' + msg + '</span>' +
      '</div></td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('leave-details-sheet-tbody');
    var countLabel = document.getElementById('leave-details-sheet-count-label');
    var showingRange = document.getElementById('leave-details-sheet-showing-range');
    var totalPagesEl = document.getElementById('leave-details-sheet-total-pages');
    var pageNumInput = document.getElementById('leave-details-sheet-page-num');
    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in Leave Attendance Details sheet.' : 'No matching records found.') + '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records';
      if (showingRange) showingRange.textContent = 'Showing 0 - 0 of 0';
      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageNumInput) pageNumInput.value = 1;
      updatePaginationButtons(1, 1);
      clearCellSelection();
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
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
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
      tdNum.style.textAlign = 'center';
      tdNum.style.color = '#64748b';
      tdNum.style.fontWeight = '600';
      tdNum.style.background = '#f8fafc';
      tdNum.style.borderRight = '1px solid #e2e8f0';
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
        // 0: Date
        // 1: Name
        // 2: Unit
        // 3: Leave Reason
        // 4: Leave Application Status
        // 5: Application Date
        // 6: Remarks

        if (colIdx === 0) { // Date
          td.style.fontWeight = '700';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 1) { // Name
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.style.letterSpacing = '0.2px';
          td.textContent = strVal;
        } else if (colIdx === 2) { // Unit
          td.style.whiteSpace = 'nowrap';
          if (strVal) {
            var unitBadge = document.createElement('span');
            unitBadge.style.cssText = 'display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:11.5px; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;';
            unitBadge.textContent = strVal;
            td.appendChild(unitBadge);
          } else {
            td.textContent = '';
          }
        } else if (colIdx === 3) { // Leave Reason
          td.style.whiteSpace = 'normal';
          td.style.minWidth = '180px';
          td.style.maxWidth = '260px';
          if (!strVal || strVal.toLowerCase().indexOf('not provided') !== -1) {
            td.style.fontStyle = 'italic';
            td.style.color = '#94a3b8';
            td.textContent = strVal || 'Reason Not Provided';
          } else {
            td.style.fontWeight = '600';
            td.style.color = '#334155';
            td.textContent = strVal;
          }
        } else if (colIdx === 4) { // Leave Application Status
          td.style.whiteSpace = 'nowrap';
          if (strVal) {
            var statusBadge = document.createElement('span');
            var lower = strVal.toLowerCase();
            if (lower.indexOf('without') !== -1) {
              statusBadge.style.cssText = 'display:inline-block; padding:2px 9px; font-weight:700; border-radius:4px; font-size:11.5px; background:#fff1f2; color:#be123c; border:1px solid #fecdd3;';
            } else if (lower.indexOf('with') !== -1) {
              statusBadge.style.cssText = 'display:inline-block; padding:2px 9px; font-weight:700; border-radius:4px; font-size:11.5px; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;';
            } else {
              statusBadge.style.cssText = 'display:inline-block; padding:2px 9px; font-weight:700; border-radius:4px; font-size:11.5px; background:#f8fafc; color:#475569; border:1px solid #cbd5e1;';
            }
            statusBadge.textContent = strVal;
            td.appendChild(statusBadge);
          } else {
            td.textContent = '';
          }
        } else if (colIdx === 5) { // Application Date
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          if (strVal) {
            td.style.fontWeight = '600';
            td.style.color = '#475569';
            td.textContent = strVal;
          } else {
            td.style.color = '#cbd5e1';
            td.textContent = '—';
          }
        } else if (colIdx === 6) { // Remarks
          td.style.whiteSpace = 'normal';
          td.style.minWidth = '160px';
          if (strVal) {
            var remBadge = document.createElement('span');
            var remLower = strVal.toLowerCase();
            if (remLower.indexOf('without') !== -1) {
              remBadge.style.cssText = 'display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:11px; background:#fff7ed; color:#c2410c; border:1px solid #fed7aa;';
            } else if (remLower.indexOf('inform') !== -1) {
              remBadge.style.cssText = 'display:inline-block; padding:2px 8px; font-weight:700; border-radius:4px; font-size:11px; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;';
            } else {
              remBadge.style.cssText = 'color:#475569; font-weight:500;';
            }
            remBadge.textContent = strVal;
            td.appendChild(remBadge);
          } else {
            td.textContent = '';
          }
        }

        td.addEventListener('mousedown', (function (r, c) {
          return function (e) {
            e.stopPropagation();
            selectCellByCoords(r, c);
          };
        })(localRowIdx, colIdx));

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function updatePaginationButtons(current, total) {
    var firstBtn = document.getElementById('leave-details-sheet-first-page');
    var prevBtn = document.getElementById('leave-details-sheet-prev-page');
    var nextBtn = document.getElementById('leave-details-sheet-next-page');
    var lastBtn = document.getElementById('leave-details-sheet-last-page');
    if (firstBtn) firstBtn.disabled = (current <= 1);
    if (prevBtn) prevBtn.disabled = (current <= 1);
    if (nextBtn) nextBtn.disabled = (current >= total);
    if (lastBtn) lastBtn.disabled = (current >= total);
  }

  // ---------------------------------------------------------------------------
  // 8. Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function clearCellSelection() {
    activeCellCoords = null;
    var tbody = document.getElementById('leave-details-sheet-tbody');
    if (tbody) {
      var sel = tbody.querySelectorAll('.bai-cell-selected');
      sel.forEach(function (el) { el.classList.remove('bai-cell-selected'); });
    }
    var badge = document.getElementById('leave-details-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function selectCellByCoords(localRowIdx, colIdx) {
    var tbody = document.getElementById('leave-details-sheet-tbody');
    if (!tbody) return;
    var prevSel = tbody.querySelectorAll('.bai-cell-selected');
    prevSel.forEach(function (el) { el.classList.remove('bai-cell-selected'); });

    var target = tbody.querySelector('td[data-r="' + localRowIdx + '"][data-c="' + colIdx + '"]');
    if (target) {
      target.classList.add('bai-cell-selected');
      activeCellCoords = { r: localRowIdx, c: colIdx };
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      var badge = document.getElementById('leave-details-sheet-active-cell-badge');
      if (badge) {
        var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
        var globalRow = (currentPage - 1) * pageSize + localRowIdx + 1;
        badge.textContent = 'Row ' + globalRow.toLocaleString() + ' • ' + colName;
        badge.style.display = 'inline-block';
      }
    }
  }

  function copySelectedCellToClipboard() {
    if (!activeCellCoords) return false;
    var tbody = document.getElementById('leave-details-sheet-tbody');
    if (!tbody) return false;
    var target = tbody.querySelector('td.bai-cell-selected');
    if (!target) return false;

    var textToCopy = (target.innerText !== undefined ? target.innerText : target.textContent || '').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).catch(function () {});
    }

    target.classList.remove('bai-cell-copied');
    void target.offsetWidth;
    target.classList.add('bai-cell-copied');
    setTimeout(function () { target.classList.remove('bai-cell-copied'); }, 500);

    var preview = textToCopy.length > 35 ? textToCopy.slice(0, 35) + '...' : textToCopy;
    if (preview === '') preview = '(Blank)';
    showToast('Copied: "' + preview + '"', 'copy');
    return true;
  }

  // ---------------------------------------------------------------------------
  // 9. Excel Export (.xlsx via SheetJS)
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (!allRows || allRows.length === 0) {
      showToast('No Leave Details records available to export', 'warning');
      return;
    }
    showToast('Preparing Leave Details Excel (.xlsx)...', 'download');

    setTimeout(function () {
      try {
        var exportData = [allHeaders.slice()];
        var srcRows = (filteredRows && filteredRows.length > 0) ? filteredRows : allRows;
        srcRows.forEach(function (row) {
          exportData.push(row.slice());
        });

        if (typeof XLSX === 'undefined') {
          throw new Error('SheetJS library (xlsx.full.min.js) is not loaded');
        }

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(exportData);

        var colWidths = allHeaders.map(function (h, i) {
          var maxLen = String(h || '').length;
          var sampleLimit = Math.min(srcRows.length, 300);
          for (var r = 0; r < sampleLimit; r++) {
            var vLen = String(srcRows[r][i] || '').length;
            if (vLen > maxLen) maxLen = vLen;
          }
          return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Leave Details');
        XLSX.writeFile(wb, 'Leave_Details_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        showToast('Excel exported successfully (' + srcRows.length.toLocaleString() + ' rows)', 'success');
      } catch (err) {
        console.error('Export error:', err);
        showToast('Excel export failed: ' + (err.message || 'Unknown error'), 'error');
      }
    }, 80);
  }

  // ---------------------------------------------------------------------------
  // 10. View Transition
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('ot-leave-kpi-view');
    var otView = document.getElementById('ot-details-view');
    var leaveView = document.getElementById('leave-details-view');
    var analysisView = document.getElementById('ot-leave-analysis-view');
    if (kpiView) kpiView.style.display = 'none';
    if (otView) otView.style.display = 'none';
    if (analysisView) analysisView.style.display = 'none';
    if (leaveView) leaveView.style.display = '';

    if (window.AdditionalWorkSheetEngine && typeof window.AdditionalWorkSheetEngine.clearSelection === 'function') {
      window.AdditionalWorkSheetEngine.clearSelection();
    }
    if (window.OtLeaveAnalysisSheetEngine && typeof window.OtLeaveAnalysisSheetEngine.clearSelection === 'function') {
      window.OtLeaveAnalysisSheetEngine.clearSelection();
    }

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('leave-details-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var leaveView = document.getElementById('leave-details-view');
    var kpiView = document.getElementById('ot-leave-kpi-view');
    if (leaveView) leaveView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('leave-details-sheet-db-badge');
    var syncText = document.getElementById('leave-details-sheet-last-sync-text');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#38bdf8;">bolt</span> ' +
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
    var syncBanner = document.getElementById('leave-details-sheet-sync-banner');
    var syncMsg = document.getElementById('leave-details-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('leave-details-sheet-sync-icon');
    if (syncBanner) syncBanner.style.display = syncing ? 'flex' : 'none';
    if (syncMsg && msg) syncMsg.textContent = msg;
    if (syncBtnIcon) {
      if (syncing) syncBtnIcon.classList.add('bai-sheet-spin');
      else syncBtnIcon.classList.remove('bai-sheet-spin');
    }
  }

  var SVG_ICONS = {
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning:'<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error:'<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy:'<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download:'<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter:'<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort:'<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('leave-details-sheet-toast');
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
    toast.id = 'leave-details-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 11. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in Additional Work & Leave page
    var kpiCard = document.getElementById('kpi-leave-details');
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
    var backBtn = document.getElementById('btn-back-leave-details');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-refresh-leave-details-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-leave-details-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportExcelXLSX();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('leave-details-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('leave-details-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('leave-details-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('leave-details-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('leave-details-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('leave-details-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('leave-details-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage = tp;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('leave-details-sheet-page-num');
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
    var clearAllFiltersBtn = document.getElementById('leave-details-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('leave-details-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('leave-details-sheet-filter-search-input');
    var popSearchClear = document.getElementById('leave-details-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('leave-details-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('leave-details-sheet-filter-clear-all');
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

    var sortAscBtn = document.getElementById('leave-details-sheet-sort-asc');
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

    var sortDescBtn = document.getElementById('leave-details-sheet-sort-desc');
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

    var popResetBtn = document.getElementById('leave-details-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('leave-details-sheet-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('leave-details-sheet-filter-ok-btn');
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
      var popover = document.getElementById('leave-details-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('leave-details-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard Navigation & Cell Selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('leave-details-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('leave-details-sheet-tbody');
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
      var view = document.getElementById('leave-details-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('leave-details-sheet-tbody');
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
        var popover = document.getElementById('leave-details-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') closeColumnFilterPopover();
        else if (activeCellCoords) clearCellSelection();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 12. Bootstrap
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === 7) ? cached.headers : defaultHeaders.slice();
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

  window.LeaveDetailsSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; },
    clearSelection: clearCellSelection
  };

})();
