/**
 * =============================================================================
 * Batch Cutting Details Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Sheet: CUTTING DETAILS (Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E)
 * GID: 1625638521
 * Range: A1:N (14 Columns: A to N)
 * Headers (Row 1):
 *   1. CUTTING DATE
 *   2. CHALLAN NO.
 *   3. BUYER
 *   4. PO NO
 *   5. STYLE
 *   6. LEATHER
 *   7. COLOUR
 *   8. QUANTITY
 *   9. BATCH NO.
 *  10. ETD
 *  11. BATCH ID FORMAT
 *  12. CATEGORY
 *  13. BATCH
 *  14. Status
 * Database: IndexedDB 'FMS_Batch_Cutting_DB_v2'
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '1625638521';
  // Primary export endpoint fetches all rows bypassing Google Sheet UI filters (e.g. 1,335 rows instead of 7 filtered rows)
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:N';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:N';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Batch_Cutting_DB_v2';
  var DB_VERSION = 1;
  var STORE_NAME = 'batch_cutting_store';

  var defaultHeaders = [
    'CUTTING DATE', 'CHALLAN NO.', 'BUYER', 'PO NO',
    'STYLE', 'LEATHER', 'COLOUR', 'QUANTITY',
    'BATCH NO.', 'ETD', 'BATCH ID FORMAT', 'CATEGORY',
    'BATCH', 'Status'
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
  // 2. High Performance CSV Stream Parser (14 Columns: A to N)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var NUM_COLS = 14;

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
        console.warn('[BatchCuttingSheet] Primary export fetch failed, falling back to GViz:', err);
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
    if (isSyncing) return Promise.resolve(allRows);
    isSyncing = true;
    if (isManual) {
      updateSyncUI(true, 'Connecting to Google Sheets...');
    }

    return fetchGoogleSheetCSV()
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
        if (isManual) {
          showToast('Successfully synced ' + allRows.length.toLocaleString() + ' records', 'success');
        }
        try {
          window.dispatchEvent(new CustomEvent('batch-cutting-synced', { detail: { count: allRows.length, rows: allRows } }));
        } catch (e) {}
        return allRows;
      })
      .catch(function (err) {
        console.error('Batch Cutting sync error:', err);
        updateSyncUI(false);
        if (isManual) {
          showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
        }
        throw err;
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Batch Cutting Details from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 14) ? cached.headers : defaultHeaders.slice();
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
  // 5. Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('batch-cutting-sheet-thead');
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
  // 6. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('batch-cutting-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];
    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) return false;
        }
      }
      for (var f = 0; f < activeFilterColKeys.length; f++) {
        var colIdx = parseInt(activeFilterColKeys[f], 10);
        var allowedSet = activeColumnFilters[colIdx];
        if (allowedSet && allowedSet.size > 0) {
          var cellVal = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          if (!allowedSet.has(cellVal)) return false;
        }
      }
      return true;
    });

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('batch-cutting-sheet-search-clear');
    if (searchClear) searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('batch-cutting-sheet-thead');
    if (!thead) return;
    thead.querySelectorAll('th').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.bai-sheet-col-filter-btn');
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
        if (btn) { btn.classList.add('is-active'); btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_alt</span>'; }
      } else {
        th.classList.remove('has-active-filter');
        if (btn) { btn.classList.remove('is-active'); btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_list</span>'; }
      }
    });
  }

  function renderActiveFilterChips() {
    var bar = document.getElementById('batch-cutting-sheet-active-filters-bar');
    var container = document.getElementById('batch-cutting-sheet-active-filters-chips');
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
    var popover = document.getElementById('batch-cutting-sheet-filter-popover');
    var titleEl = document.getElementById('batch-cutting-sheet-filter-pop-title');
    var searchInput = document.getElementById('batch-cutting-sheet-filter-search-input');
    var searchClear = document.getElementById('batch-cutting-sheet-filter-search-clear');
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
    var popover = document.getElementById('batch-cutting-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('batch-cutting-sheet-filter-list');
    var countEl = document.getElementById('batch-cutting-sheet-filter-items-count');
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
  // 8. Table Page & Cell Selection Rendering (14 Columns of CUTTING DETAILS)
  // ---------------------------------------------------------------------------
  function renderEmptyState(message) {
    var tbody = document.getElementById('batch-cutting-sheet-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' + (message || 'No records found.') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('batch-cutting-sheet-tbody');
    var countLabel = document.getElementById('batch-cutting-sheet-count-label');
    var showingRange = document.getElementById('batch-cutting-sheet-showing-range');
    var totalPagesEl = document.getElementById('batch-cutting-sheet-total-pages');
    var pageNumInput = document.getElementById('batch-cutting-sheet-page-num');
    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in CUTTING DETAILS sheet.' : 'No matching records found.') + '</td></tr>';
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
      tr.appendChild(tdNum);

      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }
        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Column Specific Precision Styling (CUTTING DETAILS)
        // 0: CUTTING DATE, 1: CHALLAN NO., 2: BUYER, 3: PO NO, 4: STYLE, 5: LEATHER,
        // 6: COLOUR, 7: QUANTITY, 8: BATCH NO., 9: ETD, 10: BATCH ID FORMAT, 11: CATEGORY, 12: BATCH, 13: Status
        if (colIdx === 0) { // CUTTING DATE
          td.style.fontWeight = '600';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 1) { // CHALLAN NO.
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '600';
          td.style.color = '#475569';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 2) { // BUYER
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 3) { // PO NO
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '600';
          td.style.color = '#1e293b';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 4) { // STYLE
          td.style.fontWeight = '700';
          td.style.color = '#1e293b';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 5 || colIdx === 6) { // LEATHER, COLOUR
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 7) { // QUANTITY
          td.className = 'bai-sheet-td-num';
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.background = 'rgba(255, 247, 237, 0.55)';
          td.textContent = strVal;
        } else if (colIdx === 8) { // BATCH NO.
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '600';
          td.style.color = '#475569';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 9) { // ETD
          td.style.fontWeight = '600';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 10) { // BATCH ID FORMAT
          td.style.color = '#64748b';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 11) { // CATEGORY
          td.style.fontWeight = '700';
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          td.style.color = '#1e293b';
          td.textContent = strVal;
        } else if (colIdx === 12) { // BATCH (Full Batch ID)
          td.className = 'bai-sheet-td-batch';
          td.style.fontWeight = '700';
          td.style.color = '#0284c7';
          td.style.background = 'rgba(240, 249, 255, 0.65)';
          td.style.whiteSpace = 'nowrap';
          td.style.letterSpacing = '0.3px';
          td.textContent = strVal;
        } else if (colIdx === 13) { // Status
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          var lower = strVal.toLowerCase();
          if (lower === 'updated') {
            td.innerHTML = '<span style="display:inline-block;padding:2px 8px;background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:700;font-size:11px;border-radius:0;">Updated</span>';
          } else if (strVal) {
            td.innerHTML = '<span style="display:inline-block;padding:2px 8px;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:600;font-size:11px;border-radius:0;">' + escapeHtml(strVal) + '</span>';
          } else {
            td.textContent = '';
          }
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
    var firstBtn = document.getElementById('batch-cutting-sheet-first-page');
    var prevBtn = document.getElementById('batch-cutting-sheet-prev-page');
    var nextBtn = document.getElementById('batch-cutting-sheet-next-page');
    var lastBtn = document.getElementById('batch-cutting-sheet-last-page');
    if (firstBtn) firstBtn.disabled = (current <= 1);
    if (prevBtn) prevBtn.disabled = (current <= 1);
    if (nextBtn) nextBtn.disabled = (current >= total);
    if (lastBtn) lastBtn.disabled = (current >= total);
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('batch-cutting-sheet-tbody');
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
    var badge = document.getElementById('batch-cutting-sheet-active-cell-badge');
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
    var tbody = document.getElementById('batch-cutting-sheet-tbody');
    if (tbody) {
      var prev = tbody.querySelector('.bai-cell-selected');
      if (prev) prev.classList.remove('bai-cell-selected');
    }
    activeCellCoords = null;
    var badge = document.getElementById('batch-cutting-sheet-active-cell-badge');
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
    var tbody = document.getElementById('batch-cutting-sheet-tbody');
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
    if (filteredRows.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }
    showToast('Generating Excel file...', 'clock');
    setTimeout(function () {
      try {
        var aoa = [['#'].concat(allHeaders.slice())];
        filteredRows.forEach(function (row, rIdx) {
          var excelRow = [rIdx + 1];
          for (var c = 0; c < allHeaders.length; c++) excelRow.push(row[c] || '');
          aoa.push(excelRow);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var colWidths = [{ wch: 8 }].concat(allHeaders.map(function (h, idx) {
          var maxLen = (h || '').length;
          for (var r = 0; r < Math.min(filteredRows.length, 100); r++) {
            var s = String(filteredRows[r][idx] || '');
            if (s.length > maxLen) maxLen = s.length;
          }
          return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
        }));
        ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, 'Batch Cutting Details');
        XLSX.writeFile(wb, 'Batch_Cutting_Details_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to Excel', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error'), 'error');
      }
    }, 50);
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

    if (kpiView) kpiView.style.display = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (cutView) cutView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('batch-cutting-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var cutView = document.getElementById('batch-list-cutting-view');
    var kpiView = document.getElementById('batch-list-kpi-view');
    if (cutView) cutView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('batch-cutting-sheet-db-badge');
    var syncText = document.getElementById('batch-cutting-sheet-last-sync-text');
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
    var syncBanner = document.getElementById('batch-cutting-sheet-sync-banner');
    var syncMsg = document.getElementById('batch-cutting-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('batch-cutting-sheet-sync-icon');
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
    var existing = document.getElementById('batch-cutting-sheet-toast');
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
    toast.id = 'batch-cutting-sheet-toast';
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
    var kpiCard = document.getElementById('kpi-cutting-details');
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
    var backBtn = document.getElementById('btn-back-batch-list');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-refresh-cutting-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-cutting-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportExcelXLSX();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('batch-cutting-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('batch-cutting-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('batch-cutting-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('batch-cutting-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('batch-cutting-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('batch-cutting-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('batch-cutting-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage = tp;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('batch-cutting-sheet-page-num');
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
    var clearAllFiltersBtn = document.getElementById('batch-cutting-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('batch-cutting-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('batch-cutting-sheet-filter-search-input');
    var popSearchClear = document.getElementById('batch-cutting-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('batch-cutting-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('batch-cutting-sheet-filter-clear-all');
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

    var sortAscBtn = document.getElementById('batch-cutting-sheet-sort-asc');
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

    var sortDescBtn = document.getElementById('batch-cutting-sheet-sort-desc');
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

    var popResetBtn = document.getElementById('batch-cutting-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('batch-cutting-sheet-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('batch-cutting-sheet-filter-ok-btn');
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
      var popover = document.getElementById('batch-cutting-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('batch-cutting-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard Navigation & Cell Selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('batch-list-cutting-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('batch-cutting-sheet-tbody');
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
      var view = document.getElementById('batch-list-cutting-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('batch-cutting-sheet-tbody');
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
        var popover = document.getElementById('batch-cutting-sheet-filter-popover');
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
        allHeaders = (cached.headers && cached.headers.length === 14) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        updateHeaderBadge();
        try {
          window.dispatchEvent(new CustomEvent('batch-cutting-synced', { detail: { count: allRows.length, rows: allRows } }));
        } catch (e) {}
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.BatchCuttingSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { return syncFromGoogleSheet(true); },
    syncSilent: function () { return syncFromGoogleSheet(false); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
