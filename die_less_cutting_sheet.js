/**
 * =============================================================================
 * Die-Less Knife Cutting Machine Details Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Sheet: Machine Data (Spreadsheet ID: 1mEu7tllGicKVcbL-UWVis67uXnveXiLu1eBFljbThtU)
 * GID: 0
 * Range: A1:P (16 Columns: A to P)
 * Headers (Row 1):
 *   1. Date
 *   2. Month
 *   3. Batch No.
 *   4. Style Number
 *   5. Colour
 *   6. Quantity
 *   7. Description
 *   8. Start Time
 *   9. End Time
 *  10. Total Time Taken
 *  11. Minute
 *  12. Complete Date
 *  13. Remarks
 *  14. Hourly Production
 *  15. Duration
 *  16. HOUR
 * Database: IndexedDB 'FMS_Die_Less_Cutting_DB_v1'
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1mEu7tllGicKVcbL-UWVis67uXnveXiLu1eBFljbThtU';
  var SHEET_GID = '0';
  // Primary export endpoint fetches all underlying rows bypassing active Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:P';
  // Fallback to gviz endpoint if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:P';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_Die_Less_Cutting_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'die_less_cutting_store';

  var defaultHeaders = [
    'Date', 'Month', 'Batch No.', 'Style Number',
    'Colour', 'Quantity', 'Description', 'Start Time',
    'End Time', 'Total Time Taken', 'Minute', 'Complete Date',
    'Remarks', 'Hourly Production', 'Duration', 'HOUR'
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

  // Sorting State
  var sortColumn = -1;
  var sortAsc = true;

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
  // 2. High Performance CSV Stream Parser (16 Columns: A to P)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var NUM_COLS = 16;

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
        console.warn('[DieLessCuttingSheet] Primary export fetch failed, falling back to GViz:', err);
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
        console.error('Die-Less Machine Data sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Die-Less Machine Details from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 16) ? cached.headers : defaultHeaders.slice();
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
    var thead = document.getElementById('die-less-cutting-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // Serial # Column Header (Compact 36px)
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th-index';
    thIndex.textContent = '#';
    thIndex.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;padding:8px 2px!important;text-align:center!important;white-space:nowrap!important;background:#091729!important;color:#94a3b8!important;border-right:2px solid #334155!important;';
    tr.appendChild(thIndex);

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);
      th.style.cssText = 'white-space:nowrap!important;padding:8px 10px!important;vertical-align:middle!important;';
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) th.classList.add('has-active-filter');

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';
      inner.style.cssText = 'display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;width:100%!important;flex-wrap:nowrap!important;white-space:nowrap!important;box-sizing:border-box!important;';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;
      labelSpan.style.cssText = 'flex:1 1 auto!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;cursor:pointer!important;user-select:none!important;font-size:11px!important;font-weight:700!important;';
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

      // Filter Button
      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (hasFilter ? 'filter_alt' : 'filter_list') + '</span>';
      filterBtn.addEventListener('click', (function (ci, fb) {
        return function (e) { e.stopPropagation(); openColumnFilterPopover(ci, fb); };
      })(colIdx, filterBtn));

      iconsWrap.appendChild(sortIcon);
      iconsWrap.appendChild(filterBtn);

      inner.appendChild(labelSpan);
      inner.appendChild(iconsWrap);
      th.appendChild(inner);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 6. Sorting Engine
  // ---------------------------------------------------------------------------
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
    applyAllFiltersAndSearch();
  }

  function sortDataRows(rows) {
    if (sortColumn === -1) return rows;
    var ci = sortColumn;
    var asc = sortAsc;

    return rows.slice().sort(function (rowA, rowB) {
      var valA = (rowA[ci] !== undefined && rowA[ci] !== null) ? String(rowA[ci]).trim() : '';
      var valB = (rowB[ci] !== undefined && rowB[ci] !== null) ? String(rowB[ci]).trim() : '';

      if (valA === '' && valB === '') return 0;
      if (valA === '') return 1;
      if (valB === '') return -1;

      // Numeric check for Quantity, Minute, Hourly Production, HOUR
      var numA = parseFloat(valA.replace(/,/g, ''));
      var numB = parseFloat(valB.replace(/,/g, ''));
      if (!isNaN(numA) && !isNaN(numB)) {
        return asc ? numA - numB : numB - numA;
      }

      var cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return asc ? cmp : -cmp;
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('die-less-cutting-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];
    var activeFilterColKeys = Object.keys(activeColumnFilters);

    var matching = allRows.filter(function (row) {
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

    filteredRows = sortDataRows(matching);
    currentPage = 1;
    renderHeaderRow();
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('die-less-cutting-sheet-search-clear');
    if (searchClear) searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('die-less-cutting-sheet-thead');
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
    var bar = document.getElementById('die-less-cutting-sheet-active-filters-bar');
    var container = document.getElementById('die-less-cutting-sheet-active-filters-chips');
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
  // 8. Column Filter Popover
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
    var popover = document.getElementById('die-less-cutting-sheet-filter-popover');
    var titleEl = document.getElementById('die-less-cutting-sheet-filter-pop-title');
    var searchInput = document.getElementById('die-less-cutting-sheet-filter-search-input');
    var searchClear = document.getElementById('die-less-cutting-sheet-filter-search-clear');
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
    var popover = document.getElementById('die-less-cutting-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('die-less-cutting-sheet-filter-list');
    var countEl = document.getElementById('die-less-cutting-sheet-filter-items-count');
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
  // 9. Table Page & Cell Selection Rendering (16 Columns of Machine Data)
  // ---------------------------------------------------------------------------
  function renderEmptyState(message) {
    var tbody = document.getElementById('die-less-cutting-sheet-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' + (message || 'No records found.') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('die-less-cutting-sheet-tbody');
    var countLabel = document.getElementById('die-less-cutting-sheet-count-label');
    var showingRange = document.getElementById('die-less-cutting-sheet-showing-range');
    var totalPagesEl = document.getElementById('die-less-cutting-sheet-total-pages');
    var pageNumInput = document.getElementById('die-less-cutting-sheet-page-num');
    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in Machine Data sheet.' : 'No matching records found.') + '</td></tr>';
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

      // Serial # Cell (Compact 36px)
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index';
      tdNum.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;padding:6px 2px!important;text-align:center!important;white-space:nowrap!important;';
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

        // Column Specific Styling (16 Columns)
        // 0: Date, 1: Month, 2: Batch No., 3: Style Number, 4: Colour, 5: Quantity,
        // 6: Description, 7: Start Time, 8: End Time, 9: Total Time Taken, 10: Minute,
        // 11: Complete Date, 12: Remarks, 13: Hourly Production, 14: Duration, 15: HOUR
        if (colIdx === 0) { // Date
          td.style.fontWeight = '600';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 2) { // Batch No.
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '600';
          td.style.color = '#475569';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 3) { // Style Number
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 4) { // Colour
          td.style.fontWeight = '600';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 5) { // Quantity
          td.style.fontWeight = '700';
          td.style.color = '#b45309';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.background = 'rgba(255, 247, 237, 0.55)';
          td.textContent = strVal;
        } else if (colIdx === 7 || colIdx === 8) { // Start Time, End Time
          td.style.color = '#475569';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 9) { // Total Time Taken
          td.style.fontWeight = '600';
          td.style.color = '#0d9488';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 10) { // Minute
          td.style.fontWeight = '700';
          td.style.color = '#0369a1';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 13) { // Hourly Production
          td.style.fontWeight = '700';
          td.style.color = '#059669';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal;
        } else if (colIdx === 14 || colIdx === 15) { // Duration, HOUR
          td.style.color = '#475569';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
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
    var firstBtn = document.getElementById('die-less-cutting-sheet-first-page');
    var prevBtn = document.getElementById('die-less-cutting-sheet-prev-page');
    var nextBtn = document.getElementById('die-less-cutting-sheet-next-page');
    var lastBtn = document.getElementById('die-less-cutting-sheet-last-page');
    if (firstBtn) firstBtn.disabled = (current <= 1);
    if (prevBtn) prevBtn.disabled = (current <= 1);
    if (nextBtn) nextBtn.disabled = (current >= total);
    if (lastBtn) lastBtn.disabled = (current >= total);
  }

  // ---------------------------------------------------------------------------
  // 10. Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('die-less-cutting-sheet-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('.bai-cell-selected').forEach(function (el) { el.classList.remove('bai-cell-selected'); });
    activeCellCoords = { r: r, c: c };
    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('bai-cell-selected');
      targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateActiveCellBadge(r, c, targetCell.textContent);
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('die-less-cutting-sheet-tbody');
    if (tbody) tbody.querySelectorAll('.bai-cell-selected').forEach(function (el) { el.classList.remove('bai-cell-selected'); });
    activeCellCoords = null;
    var badge = document.getElementById('die-less-cutting-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function updateActiveCellBadge(r, c, val) {
    var badge = document.getElementById('die-less-cutting-sheet-active-cell-badge');
    if (!badge) return;
    var colName = allHeaders[c] || ('Col ' + (c + 1));
    var cleanVal = (val || '').trim();
    if (cleanVal.length > 28) cleanVal = cleanVal.slice(0, 28) + '...';
    badge.textContent = 'R' + (r + 1) + ':C' + (c + 1) + ' ' + colName + ': ' + (cleanVal || '(empty)');
    badge.style.display = 'inline-block';
  }

  function copySelectedCellToClipboard() {
    if (!activeCellCoords) return false;
    var tbody = document.getElementById('die-less-cutting-sheet-tbody');
    if (!tbody) return false;
    var cell = tbody.querySelector('.bai-cell-selected');
    if (!cell) return false;
    var text = (cell.innerText !== undefined ? cell.innerText : cell.textContent || '').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopiedCell(cell);
        showToast('Copied: "' + (text.length > 35 ? text.slice(0, 35) + '...' : text) + '"', 'copy');
      }).catch(function () { fallbackCopy(cell, text); });
    } else {
      fallbackCopy(cell, text);
    }
    return true;
  }

  function fallbackCopy(cell, text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      flashCopiedCell(cell);
      showToast('Copied: "' + (text.length > 35 ? text.slice(0, 35) + '...' : text) + '"', 'copy');
    } catch (e) {
      showToast('Copy not supported', 'warning');
    }
    document.body.removeChild(ta);
  }

  function flashCopiedCell(cell) {
    cell.classList.remove('bai-cell-copied');
    void cell.offsetWidth;
    cell.classList.add('bai-cell-copied');
    setTimeout(function () { cell.classList.remove('bai-cell-copied'); }, 500);
  }

  // ---------------------------------------------------------------------------
  // 11. Excel (.xlsx) Exporter
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('Excel library loading... please retry in a moment.', 'warning');
      return;
    }
    if (filteredRows.length === 0) {
      showToast('No records to export.', 'warning');
      return;
    }
    showToast('Preparing Excel download (' + filteredRows.length.toLocaleString() + ' rows)...', 'download');

    setTimeout(function () {
      try {
        var aoa = [];
        var headersRow = ['#'].concat(allHeaders);
        aoa.push(headersRow);
        filteredRows.forEach(function (row, idx) {
          var excelRow = [idx + 1];
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
        XLSX.utils.book_append_sheet(wb, ws, 'Machine Data');
        XLSX.writeFile(wb, 'Die_Less_Knife_Cutting_Machine_Details_' + new Date().toISOString().slice(0, 10) + '.xlsx');
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
    var kpiView = document.getElementById('machine-kpi-view');
    var dieLessSubmenu = document.getElementById('die-less-knife-cutting-machine-details-view');
    var machineDataView = document.getElementById('machine-data-view');
    var repairView = document.getElementById('machine-repairing-details-view');

    if (kpiView) kpiView.style.display = 'none';
    if (dieLessSubmenu) dieLessSubmenu.style.display = 'none';
    if (repairView) repairView.style.display = 'none';
    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (type) {
      var detailView = document.getElementById(type + '-view');
      if (detailView) detailView.style.display = type === 'machine-data' ? '' : 'none';
    });

    if (machineDataView) machineDataView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('die-less-cutting-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var machineDataView = document.getElementById('machine-data-view');
    var dieLessSubmenu = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (machineDataView) machineDataView.style.display = 'none';
    if (dieLessSubmenu) dieLessSubmenu.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('die-less-cutting-sheet-db-badge');
    var syncText = document.getElementById('die-less-cutting-sheet-last-sync-text');
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
    var syncBanner = document.getElementById('die-less-cutting-sheet-sync-banner');
    var syncMsg = document.getElementById('die-less-cutting-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('die-less-cutting-sheet-sync-icon');
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
    var existing = document.getElementById('die-less-cutting-sheet-toast');
    if (existing) existing.remove();
    var cleanMsg = String(msg || '').replace(/\s+/g, ' ').trim();
    if (!cleanMsg) return;

    var type = 'info';
    var lower = cleanMsg.toLowerCase();
    if (customType) type = customType;
    else if (lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1) type = 'error';
    else if (lower.indexOf('warn') !== -1) type = 'warning';
    else if (lower.indexOf('copied') !== -1) type = 'copy';
    else if (lower.indexOf('export') !== -1 || lower.indexOf('download') !== -1) type = 'download';
    else if (lower.indexOf('filter') !== -1) type = 'filter';
    else if (lower.indexOf('sync') !== -1 || lower.indexOf('ready') !== -1 || lower.indexOf('succ') !== -1) type = 'check';

    var toast = document.createElement('div');
    toast.id = 'die-less-cutting-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast-' + type;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:0;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.25);background:#0f172a;color:#ffffff;border-left:4px solid #10b981;animation:baiToastSlideIn 0.25s ease-out;';
    if (type === 'error') toast.style.borderLeftColor = '#ef4444';
    else if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';
    else if (type === 'copy' || type === 'filter') toast.style.borderLeftColor = '#38bdf8';

    var iconHtml = SVG_ICONS[type] || SVG_ICONS.info;
    toast.innerHTML = '<span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + iconHtml + '</span>' +
      '<span>' + cleanMsg + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 2800);
  }

  // ---------------------------------------------------------------------------
  // 13. DOM Event Listeners & Binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Back button
    var backBtn = document.getElementById('btn-back-machine-data');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hideView();
        if (typeof showDieLessKnifeCuttingMachineDetailsView === 'function') {
          showDieLessKnifeCuttingMachineDetailsView();
        }
      });
    }

    // Tab switcher to Monthly Machine Inactivity Details
    var tabToMonthly = document.getElementById('btn-tab-machine-to-monthly-inactivity');
    if (tabToMonthly) {
      tabToMonthly.addEventListener('click', function () {
        if (typeof showMachineDetailView === 'function') {
          showMachineDetailView('monthly-machine-inactivity-data');
        }
      });
    }

    // Refresh / Sync Button
    var refreshBtn = document.getElementById('btn-refresh-die-less-cutting-data');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () { syncFromGoogleSheet(true); });
    }

    // Excel Export Button
    var exportBtn = document.getElementById('btn-download-die-less-cutting-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () { exportExcelXLSX(); });
    }

    // Search Input
    var searchInput = document.getElementById('die-less-cutting-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        applyAllFiltersAndSearch();
      });
    }

    // Search Clear
    var searchClear = document.getElementById('die-less-cutting-sheet-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
          applyAllFiltersAndSearch();
        }
      });
    }

    // Page Size Select
    var pageSizeSelect = document.getElementById('die-less-cutting-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination buttons
    var firstBtn = document.getElementById('die-less-cutting-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('die-less-cutting-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('die-less-cutting-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('die-less-cutting-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    // Page Number Input Jump
    var pageNumInput = document.getElementById('die-less-cutting-sheet-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (val >= 1 && val <= totalPages) {
          currentPage = val;
          renderTablePage();
        } else {
          this.value = currentPage;
        }
      });
    }

    // Clear All Filters
    var clearAllFiltersBtn = document.getElementById('die-less-cutting-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover controls
    var popCloseBtn = document.getElementById('die-less-cutting-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('die-less-cutting-sheet-filter-search-input');
    var popSearchClear = document.getElementById('die-less-cutting-sheet-filter-search-clear');
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
          renderFilterList();
        }
      });
    }

    var popSelectAllBtn = document.getElementById('die-less-cutting-sheet-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (val) {
          if (!q || (val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1) {
            currentFilterSelectedSet.add(val);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('die-less-cutting-sheet-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (val) {
            if ((val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(val);
            }
          });
        }
        renderFilterList();
      });
    }

    var popResetBtn = document.getElementById('die-less-cutting-sheet-filter-reset');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          delete activeColumnFilters[currentFilterColIdx];
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
          showToast('Filter reset for column', 'filter');
        }
      });
    }

    var popOkBtn = document.getElementById('die-less-cutting-sheet-filter-ok');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
            delete activeColumnFilters[currentFilterColIdx];
          } else {
            activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
          }
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
          showToast('Filter applied', 'filter');
        }
      });
    }

    var popCancelBtn = document.getElementById('die-less-cutting-sheet-filter-cancel');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    // Click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('die-less-cutting-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('die-less-cutting-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard Navigation & Cell Selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('machine-data-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('die-less-cutting-sheet-tbody');
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
      var view = document.getElementById('machine-data-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('die-less-cutting-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
            flashCopiedCell(selectedCell);
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
        var popover = document.getElementById('die-less-cutting-sheet-filter-popover');
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
        allHeaders = (cached.headers && cached.headers.length === 16) ? cached.headers : defaultHeaders.slice();
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

  window.DieLessCuttingSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; },
    setRows: function (headers, rows) {
      if (headers) allHeaders = headers;
      if (rows) {
        allRows = rows;
        filteredRows = rows.slice();
        renderHeaderRow();
        renderTablePage();
        updateHeaderBadge();
      }
    }
  };

})();
