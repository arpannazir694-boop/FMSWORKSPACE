// =============================================================================
// FMS FORM — main.js
// =============================================================================
// This file holds NEW feature code only. app.js is kept as-is; from now on,
// new features are added here instead of growing app.js further.
//
// It relies on a small set of helpers that app.js exposes on window.FMS
// (jsonp, showSpinner/hideSpinner, showToast, esc, escapeRegex,
// parseCreatedAt, paginationRange, exportRowsToXlsx, showBatchListKpiView) —
// see the bottom of app.js. Load this file AFTER app.js.
// =============================================================================

(function () {
'use strict';

var FMS = window.FMS || {};
var jsonp            = FMS.jsonp;
var showSpinner       = FMS.showSpinner;
var hideSpinner        = FMS.hideSpinner;
var showToast          = FMS.showToast;
var esc                = FMS.esc;
var escapeRegex        = FMS.escapeRegex;
var parseCreatedAt     = FMS.parseCreatedAt;
var paginationRange    = FMS.paginationRange;
var exportRowsToXlsx   = FMS.exportRowsToXlsx;
var excelRowColor_     = FMS.excelRowColor_;
var showBatchListKpiView = FMS.showBatchListKpiView;
var currentSubmitter   = FMS.currentSubmitter;
var applyKpiCardAccess = FMS.applyKpiCardAccess || function () {}; // per-KPI-card access guard (falls back to a no-op if app.js is stale)

if (!jsonp || !exportRowsToXlsx || !showBatchListKpiView) {
    // app.js didn't expose window.FMS (e.g. an old cached app.js) — bail out
    // quietly instead of throwing errors all over the console.
    console.warn('main.js: window.FMS helpers not found — is app.js up to date?');
    return;
}

// ---------------------------------------------------------------------------
// End-Line QC Details — table state
// ---------------------------------------------------------------------------
var endLineQcTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table is assumed to start at column B, so the first
// column (FMS Upload Timestamp / date column) is index 0 — same convention
// used by the other Production Data subviews in app.js.
function getEndLineQcDateColIndex() { return 0; }

// ---------------------------------------------------------------------------
// POST-AQL Details — table state
// ---------------------------------------------------------------------------
var postAqlTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// Same convention as the other Production Data subviews: the Google Sheet
// table starts at column B, so the first column (FMS Upload Timestamp /
// date column) is index 0.
function getPostAqlDateColIndex() { return 0; }

// ---------------------------------------------------------------------------
// WAREHOUSE-FMS Details — table state
// ---------------------------------------------------------------------------
var warehouseFmsTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// Same convention as the other Production Data subviews: the Google Sheet
// table starts at column B, so the first column (FMS Upload Timestamp /
// date column) is index 0.
function getWarehouseFmsDateColIndex() { return 0; }

// ---------------------------------------------------------------------------
// Shipment Details — table state
// ---------------------------------------------------------------------------
var shipmentTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// Same convention as the other Production Data subviews: the Google Sheet
// table starts at column B, so the first column (FMS Upload Timestamp /
// date column) is index 0.
function getShipmentDateColIndex() { return 0; }

// ---------------------------------------------------------------------------
// Follow-Up Planned — table state
// ---------------------------------------------------------------------------
// NOTE: This sub-view is currently a front-end shell only — it is not wired
// up to a Google Sheet yet. Once a sheet/range is chosen, add a backend
// function (e.g. getFollowUpPlannedData(), following the same pattern as
// getEndLineQcDetailsData() / getShipmentDetailsData() in Code.gs, returning
// { success, headers, rows }) and flip FOLLOWUP_PLANNED_DATA_CONNECTED to
// true below — no other changes are required, this view already has full
// search / column-filter / date-range filter / sort / pagination / Excel
// export wiring identical to the other Production Data sub-views.
var FOLLOWUP_PLANNED_DATA_CONNECTED = false;

var followUpPlannedTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// Same convention as the other Production Data subviews: the Google Sheet
// table starts at column B, so the first column (the date column used for
// the date-range filter) is index 0.
function getFollowUpPlannedDateColIndex() { return 0; }

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
var OTHER_BATCH_LIST_VIEW_IDS = [
    'batch-list-kpi-view',
    'batch-list-cutting-view',
    'batch-list-bantala-view',
    'batch-list-floor-qc-view',
    'batch-list-edge-paint-view',
    'batch-list-pre-aql-view',
    'batch-list-endline-qc-view',
    'batch-list-post-aql-view',
    'batch-list-warehouse-fms-view',
    'batch-list-shipment-view',
    'batch-list-followup-planned-view'
];

function showBatchListEndLineQcView() {
    OTHER_BATCH_LIST_VIEW_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var view = document.getElementById('batch-list-endline-qc-view');
    if (view) view.style.display = '';
    if (endLineQcTableData.allRows.length === 0) {
        fetchEndLineQcDetailsAndRender();
    } else {
        renderEndLineQcTable();
    }
}

function backToBatchListKpiView() {
    var view = document.getElementById('batch-list-endline-qc-view');
    if (view) view.style.display = 'none';
    showBatchListKpiView();
}

function showBatchListPostAqlView() {
    OTHER_BATCH_LIST_VIEW_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var view = document.getElementById('batch-list-post-aql-view');
    if (view) view.style.display = '';
    if (postAqlTableData.allRows.length === 0) {
        fetchPostAqlDetailsAndRender();
    } else {
        renderPostAqlTable();
    }
}

function backToBatchListKpiViewFromPostAql() {
    var view = document.getElementById('batch-list-post-aql-view');
    if (view) view.style.display = 'none';
    showBatchListKpiView();
}

function showBatchListWarehouseFmsView() {
    OTHER_BATCH_LIST_VIEW_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var view = document.getElementById('batch-list-warehouse-fms-view');
    if (view) view.style.display = '';
    if (warehouseFmsTableData.allRows.length === 0) {
        fetchWarehouseFmsDetailsAndRender();
    } else {
        renderWarehouseFmsTable();
    }
}

function backToBatchListKpiViewFromWarehouseFms() {
    var view = document.getElementById('batch-list-warehouse-fms-view');
    if (view) view.style.display = 'none';
    showBatchListKpiView();
}

function showBatchListShipmentView() {
    OTHER_BATCH_LIST_VIEW_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var view = document.getElementById('batch-list-shipment-view');
    if (view) view.style.display = '';
    if (shipmentTableData.allRows.length === 0) {
        fetchShipmentDetailsAndRender();
    } else {
        renderShipmentTable();
    }
}

function backToBatchListKpiViewFromShipment() {
    var view = document.getElementById('batch-list-shipment-view');
    if (view) view.style.display = 'none';
    showBatchListKpiView();
}

function showBatchListFollowUpPlannedView() {
    // NOTE: This view was converted from a generic data table into the
    // "Follow-Up Planned — Report by Planned Date" PDF report generator.
    // Its fetch/render logic now lives in web.js (PlannedDate.gs backend),
    // wired to its own click handler on #kpi-pdf-followup-planned — so this
    // function only needs to handle showing/hiding the view shell.
    showPdfKpiView();
    var kpiView = document.getElementById('pdf-kpi-view');
    if (kpiView) kpiView.style.display = 'none';
    var view = document.getElementById('batch-list-followup-planned-view');
    if (view) view.style.display = '';
}

function backToBatchListKpiViewFromFollowUpPlanned() {
    var view = document.getElementById('batch-list-followup-planned-view');
    if (view) view.style.display = 'none';
    showPdfKpiView();
}

// ---------------------------------------------------------------------------
// Fetch + render
// ---------------------------------------------------------------------------
function updateEndLineQcDateClearBtn() {
    var btn = document.getElementById('endline-qc-date-clear');
    if (btn) btn.style.display = (endLineQcTableData.dateFrom || endLineQcTableData.dateTo) ? '' : 'none';
}

function updateEndLineQcSearchClearBtn() {
    var s = document.getElementById('endline-qc-data-search');
    var b = document.getElementById('endline-qc-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchEndLineQcDetailsAndRender() {
    var emptyEl  = document.getElementById('endline-qc-data-empty');
    var tableEl  = document.getElementById('endline-qc-data-table');
    var footerEl = document.getElementById('endline-qc-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching End-Line QC details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onEndLineQcDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onEndLineQcDataError(e.message || 'Failed to load data.'); })
            .getEndLineQcDetailsData();
        return;
    }
    jsonp({ action: 'getEndLineQcDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onEndLineQcDataError(err.message); return; }
        onEndLineQcDataLoaded(result);
    });
}

function onEndLineQcDataLoaded(result) {
    if (!result || !result.success) {
        onEndLineQcDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    endLineQcTableData.headers       = result.headers || [];
    endLineQcTableData.allRows       = result.rows    || [];
    endLineQcTableData.filteredRows  = endLineQcTableData.allRows.slice();
    endLineQcTableData.sortCol       = -1;
    endLineQcTableData.sortAsc       = true;
    endLineQcTableData.page          = 1;
    endLineQcTableData.searchQuery   = '';
    endLineQcTableData.columnFilters = {};
    endLineQcTableData.dateFrom      = '';
    endLineQcTableData.dateTo        = '';

    var s = document.getElementById('endline-qc-data-search');
    if (s) s.value = '';
    updateEndLineQcSearchClearBtn();

    var df = document.getElementById('endline-qc-date-from');
    var dt = document.getElementById('endline-qc-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateEndLineQcDateClearBtn();

    var labelEl = document.getElementById('endline-qc-date-col-label');
    var dateCol = getEndLineQcDateColIndex();
    if (labelEl && endLineQcTableData.headers[dateCol]) {
        labelEl.textContent = endLineQcTableData.headers[dateCol];
    }

    buildEndLineQcTableHeaders();
    renderEndLineQcTable();
}

function onEndLineQcDataError(msg) {
    var emptyEl = document.getElementById('endline-qc-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('endline-qc-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('endline-qc-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildEndLineQcTableHeaders() {
    var thead = document.getElementById('endline-qc-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    endLineQcTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-endline-qc-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onEndLineQcSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    endLineQcTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = endLineQcTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            endLineQcTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyEndLineQcFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            endLineQcTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyEndLineQcFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onEndLineQcSortColumn(colIndex) {
    if (endLineQcTableData.sortCol === colIndex) {
        endLineQcTableData.sortAsc = !endLineQcTableData.sortAsc;
    } else {
        endLineQcTableData.sortCol = colIndex;
        endLineQcTableData.sortAsc = true;
    }
    updateEndLineQcSortIcons();
    applyEndLineQcFilters();
}

function updateEndLineQcSortIcons() {
    document.querySelectorAll('[data-endline-qc-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-endline-qc-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === endLineQcTableData.sortCol) {
            icon.textContent = endLineQcTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyEndLineQcFilters() {
    var query      = endLineQcTableData.searchQuery;
    var colFilters = endLineQcTableData.columnFilters;
    var dateColIdx = getEndLineQcDateColIndex();
    var dateFrom = endLineQcTableData.dateFrom ? new Date(endLineQcTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = endLineQcTableData.dateTo ? new Date(endLineQcTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    endLineQcTableData.filteredRows = endLineQcTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (endLineQcTableData.sortCol >= 0) {
        var sc = endLineQcTableData.sortCol;
        endLineQcTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return endLineQcTableData.sortAsc ? cmp : -cmp;
        });
    }

    endLineQcTableData.page = 1;
    renderEndLineQcTable();
}

function applyEndLineQcSearch(query) {
    endLineQcTableData.searchQuery = (query || '').trim().toLowerCase();
    applyEndLineQcFilters();
}

function renderEndLineQcTable() {
    var tbody      = document.getElementById('endline-qc-data-tbody');
    var tableEl    = document.getElementById('endline-qc-data-table');
    var emptyEl    = document.getElementById('endline-qc-data-empty');
    var footerEl   = document.getElementById('endline-qc-data-footer');
    var countBadge = document.getElementById('endline-qc-data-count-badge');
    if (!tbody) return;

    var total      = endLineQcTableData.filteredRows.length;
    var pageSize   = endLineQcTableData.pageSize;
    var page       = endLineQcTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    endLineQcTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = endLineQcTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', endLineQcTableData.headers.length + 1);
        var hasFilter = Object.keys(endLineQcTableData.columnFilters).some(function (k) {
            return (endLineQcTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = endLineQcTableData.dateFrom || endLineQcTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (endLineQcTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (endLineQcTableData.allRows.length === 0 ? 'No data found in End-Line QC Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('endline-qc-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        endLineQcTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (endLineQcTableData.searchQuery && cellVal.toLowerCase().indexOf(endLineQcTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(endLineQcTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('endline-qc-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (endLineQcTableData.allRows.length !== total ? ' (filtered from ' + endLineQcTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildEndLineQcPagination(page, totalPages);
}

function buildEndLineQcPagination(current, total) {
    var container = document.getElementById('endline-qc-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                endLineQcTableData.page = page;
                renderEndLineQcTable();
                var wrap = document.getElementById('endline-qc-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === '\u2026') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadEndLineQcExcel() {
    var headers = endLineQcTableData.headers;
    var rows    = endLineQcTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'End-Line QC Details',
        filenamePrefix: 'End_Line_QC_Details'
    });
}

// ---------------------------------------------------------------------------
// POST-AQL Details — fetch + render
// ---------------------------------------------------------------------------
function updatePostAqlDateClearBtn() {
    var btn = document.getElementById('post-aql-date-clear');
    if (btn) btn.style.display = (postAqlTableData.dateFrom || postAqlTableData.dateTo) ? '' : 'none';
}

function updatePostAqlSearchClearBtn() {
    var s = document.getElementById('post-aql-data-search');
    var b = document.getElementById('post-aql-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchPostAqlDetailsAndRender() {
    var emptyEl  = document.getElementById('post-aql-data-empty');
    var tableEl  = document.getElementById('post-aql-data-table');
    var footerEl = document.getElementById('post-aql-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching POST-AQL details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onPostAqlDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onPostAqlDataError(e.message || 'Failed to load data.'); })
            .getPostAqlDetailsData();
        return;
    }
    jsonp({ action: 'getPostAqlDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onPostAqlDataError(err.message); return; }
        onPostAqlDataLoaded(result);
    });
}

function onPostAqlDataLoaded(result) {
    if (!result || !result.success) {
        onPostAqlDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    postAqlTableData.headers       = result.headers || [];
    postAqlTableData.allRows       = result.rows    || [];
    postAqlTableData.filteredRows  = postAqlTableData.allRows.slice();
    postAqlTableData.sortCol       = -1;
    postAqlTableData.sortAsc       = true;
    postAqlTableData.page          = 1;
    postAqlTableData.searchQuery   = '';
    postAqlTableData.columnFilters = {};
    postAqlTableData.dateFrom      = '';
    postAqlTableData.dateTo        = '';

    var s = document.getElementById('post-aql-data-search');
    if (s) s.value = '';
    updatePostAqlSearchClearBtn();

    var df = document.getElementById('post-aql-date-from');
    var dt = document.getElementById('post-aql-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updatePostAqlDateClearBtn();

    var labelEl = document.getElementById('post-aql-date-col-label');
    var dateCol = getPostAqlDateColIndex();
    if (labelEl && postAqlTableData.headers[dateCol]) {
        labelEl.textContent = postAqlTableData.headers[dateCol];
    }

    buildPostAqlTableHeaders();
    renderPostAqlTable();
}

function onPostAqlDataError(msg) {
    var emptyEl = document.getElementById('post-aql-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('post-aql-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('post-aql-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildPostAqlTableHeaders() {
    var thead = document.getElementById('post-aql-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    postAqlTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-post-aql-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onPostAqlSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    postAqlTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = postAqlTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            postAqlTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyPostAqlFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            postAqlTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyPostAqlFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onPostAqlSortColumn(colIndex) {
    if (postAqlTableData.sortCol === colIndex) {
        postAqlTableData.sortAsc = !postAqlTableData.sortAsc;
    } else {
        postAqlTableData.sortCol = colIndex;
        postAqlTableData.sortAsc = true;
    }
    updatePostAqlSortIcons();
    applyPostAqlFilters();
}

function updatePostAqlSortIcons() {
    document.querySelectorAll('[data-post-aql-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-post-aql-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === postAqlTableData.sortCol) {
            icon.textContent = postAqlTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyPostAqlFilters() {
    var query      = postAqlTableData.searchQuery;
    var colFilters = postAqlTableData.columnFilters;
    var dateColIdx = getPostAqlDateColIndex();
    var dateFrom = postAqlTableData.dateFrom ? new Date(postAqlTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = postAqlTableData.dateTo ? new Date(postAqlTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    postAqlTableData.filteredRows = postAqlTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (postAqlTableData.sortCol >= 0) {
        var sc = postAqlTableData.sortCol;
        postAqlTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return postAqlTableData.sortAsc ? cmp : -cmp;
        });
    }

    postAqlTableData.page = 1;
    renderPostAqlTable();
}

function applyPostAqlSearch(query) {
    postAqlTableData.searchQuery = (query || '').trim().toLowerCase();
    applyPostAqlFilters();
}

function renderPostAqlTable() {
    var tbody      = document.getElementById('post-aql-data-tbody');
    var tableEl    = document.getElementById('post-aql-data-table');
    var emptyEl    = document.getElementById('post-aql-data-empty');
    var footerEl   = document.getElementById('post-aql-data-footer');
    var countBadge = document.getElementById('post-aql-data-count-badge');
    if (!tbody) return;

    var total      = postAqlTableData.filteredRows.length;
    var pageSize   = postAqlTableData.pageSize;
    var page       = postAqlTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    postAqlTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = postAqlTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', postAqlTableData.headers.length + 1);
        var hasFilter = Object.keys(postAqlTableData.columnFilters).some(function (k) {
            return (postAqlTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = postAqlTableData.dateFrom || postAqlTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (postAqlTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (postAqlTableData.allRows.length === 0 ? 'No data found in POST-AQL Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('post-aql-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        postAqlTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (postAqlTableData.searchQuery && cellVal.toLowerCase().indexOf(postAqlTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(postAqlTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('post-aql-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (postAqlTableData.allRows.length !== total ? ' (filtered from ' + postAqlTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildPostAqlPagination(page, totalPages);
}

function buildPostAqlPagination(current, total) {
    var container = document.getElementById('post-aql-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                postAqlTableData.page = page;
                renderPostAqlTable();
                var wrap = document.getElementById('post-aql-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === '\u2026') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadPostAqlExcel() {
    var headers = postAqlTableData.headers;
    var rows    = postAqlTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'POST-AQL Details',
        filenamePrefix: 'POST_AQL_Details'
    });
}

// ---------------------------------------------------------------------------
// WAREHOUSE-FMS Details — fetch + render
// ---------------------------------------------------------------------------
function updateWarehouseFmsDateClearBtn() {
    var btn = document.getElementById('warehouse-fms-date-clear');
    if (btn) btn.style.display = (warehouseFmsTableData.dateFrom || warehouseFmsTableData.dateTo) ? '' : 'none';
}

function updateWarehouseFmsSearchClearBtn() {
    var s = document.getElementById('warehouse-fms-data-search');
    var b = document.getElementById('warehouse-fms-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchWarehouseFmsDetailsAndRender() {
    var emptyEl  = document.getElementById('warehouse-fms-data-empty');
    var tableEl  = document.getElementById('warehouse-fms-data-table');
    var footerEl = document.getElementById('warehouse-fms-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching WAREHOUSE-FMS details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onWarehouseFmsDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onWarehouseFmsDataError(e.message || 'Failed to load data.'); })
            .getWarehouseFmsDetailsData();
        return;
    }
    jsonp({ action: 'getWarehouseFmsDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onWarehouseFmsDataError(err.message); return; }
        onWarehouseFmsDataLoaded(result);
    });
}

function onWarehouseFmsDataLoaded(result) {
    if (!result || !result.success) {
        onWarehouseFmsDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    warehouseFmsTableData.headers       = result.headers || [];
    warehouseFmsTableData.allRows       = result.rows    || [];
    warehouseFmsTableData.filteredRows  = warehouseFmsTableData.allRows.slice();
    warehouseFmsTableData.sortCol       = -1;
    warehouseFmsTableData.sortAsc       = true;
    warehouseFmsTableData.page          = 1;
    warehouseFmsTableData.searchQuery   = '';
    warehouseFmsTableData.columnFilters = {};
    warehouseFmsTableData.dateFrom      = '';
    warehouseFmsTableData.dateTo        = '';

    var s = document.getElementById('warehouse-fms-data-search');
    if (s) s.value = '';
    updateWarehouseFmsSearchClearBtn();

    var df = document.getElementById('warehouse-fms-date-from');
    var dt = document.getElementById('warehouse-fms-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateWarehouseFmsDateClearBtn();

    var labelEl = document.getElementById('warehouse-fms-date-col-label');
    var dateCol = getWarehouseFmsDateColIndex();
    if (labelEl && warehouseFmsTableData.headers[dateCol]) {
        labelEl.textContent = warehouseFmsTableData.headers[dateCol];
    }

    buildWarehouseFmsTableHeaders();
    renderWarehouseFmsTable();
}

function onWarehouseFmsDataError(msg) {
    var emptyEl = document.getElementById('warehouse-fms-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('warehouse-fms-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('warehouse-fms-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildWarehouseFmsTableHeaders() {
    var thead = document.getElementById('warehouse-fms-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    warehouseFmsTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-warehouse-fms-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onWarehouseFmsSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    warehouseFmsTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = warehouseFmsTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            warehouseFmsTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyWarehouseFmsFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            warehouseFmsTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyWarehouseFmsFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onWarehouseFmsSortColumn(colIndex) {
    if (warehouseFmsTableData.sortCol === colIndex) {
        warehouseFmsTableData.sortAsc = !warehouseFmsTableData.sortAsc;
    } else {
        warehouseFmsTableData.sortCol = colIndex;
        warehouseFmsTableData.sortAsc = true;
    }
    updateWarehouseFmsSortIcons();
    applyWarehouseFmsFilters();
}

function updateWarehouseFmsSortIcons() {
    document.querySelectorAll('[data-warehouse-fms-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-warehouse-fms-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === warehouseFmsTableData.sortCol) {
            icon.textContent = warehouseFmsTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyWarehouseFmsFilters() {
    var query      = warehouseFmsTableData.searchQuery;
    var colFilters = warehouseFmsTableData.columnFilters;
    var dateColIdx = getWarehouseFmsDateColIndex();
    var dateFrom = warehouseFmsTableData.dateFrom ? new Date(warehouseFmsTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = warehouseFmsTableData.dateTo ? new Date(warehouseFmsTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    warehouseFmsTableData.filteredRows = warehouseFmsTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (warehouseFmsTableData.sortCol >= 0) {
        var sc = warehouseFmsTableData.sortCol;
        warehouseFmsTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return warehouseFmsTableData.sortAsc ? cmp : -cmp;
        });
    }

    warehouseFmsTableData.page = 1;
    renderWarehouseFmsTable();
}

function applyWarehouseFmsSearch(query) {
    warehouseFmsTableData.searchQuery = (query || '').trim().toLowerCase();
    applyWarehouseFmsFilters();
}

function renderWarehouseFmsTable() {
    var tbody      = document.getElementById('warehouse-fms-data-tbody');
    var tableEl    = document.getElementById('warehouse-fms-data-table');
    var emptyEl    = document.getElementById('warehouse-fms-data-empty');
    var footerEl   = document.getElementById('warehouse-fms-data-footer');
    var countBadge = document.getElementById('warehouse-fms-data-count-badge');
    if (!tbody) return;

    var total      = warehouseFmsTableData.filteredRows.length;
    var pageSize   = warehouseFmsTableData.pageSize;
    var page       = warehouseFmsTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    warehouseFmsTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = warehouseFmsTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', warehouseFmsTableData.headers.length + 1);
        var hasFilter = Object.keys(warehouseFmsTableData.columnFilters).some(function (k) {
            return (warehouseFmsTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = warehouseFmsTableData.dateFrom || warehouseFmsTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (warehouseFmsTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (warehouseFmsTableData.allRows.length === 0 ? 'No data found in WAREHOUSE-FMS Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('warehouse-fms-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        warehouseFmsTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (warehouseFmsTableData.searchQuery && cellVal.toLowerCase().indexOf(warehouseFmsTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(warehouseFmsTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('warehouse-fms-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (warehouseFmsTableData.allRows.length !== total ? ' (filtered from ' + warehouseFmsTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildWarehouseFmsPagination(page, totalPages);
}

function buildWarehouseFmsPagination(current, total) {
    var container = document.getElementById('warehouse-fms-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                warehouseFmsTableData.page = page;
                renderWarehouseFmsTable();
                var wrap = document.getElementById('warehouse-fms-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === '\u2026') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadWarehouseFmsExcel() {
    var headers = warehouseFmsTableData.headers;
    var rows    = warehouseFmsTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'WAREHOUSE-FMS Details',
        filenamePrefix: 'WAREHOUSE_FMS_Details'
    });
}

// ---------------------------------------------------------------------------
// Shipment Details — fetch + render
// ---------------------------------------------------------------------------
function updateShipmentDateClearBtn() {
    var btn = document.getElementById('shipment-date-clear');
    if (btn) btn.style.display = (shipmentTableData.dateFrom || shipmentTableData.dateTo) ? '' : 'none';
}

function updateShipmentSearchClearBtn() {
    var s = document.getElementById('shipment-data-search');
    var b = document.getElementById('shipment-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchShipmentDetailsAndRender() {
    var emptyEl  = document.getElementById('shipment-data-empty');
    var tableEl  = document.getElementById('shipment-data-table');
    var footerEl = document.getElementById('shipment-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Shipment details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onShipmentDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onShipmentDataError(e.message || 'Failed to load data.'); })
            .getShipmentDetailsData();
        return;
    }
    jsonp({ action: 'getShipmentDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onShipmentDataError(err.message); return; }
        onShipmentDataLoaded(result);
    });
}

function onShipmentDataLoaded(result) {
    if (!result || !result.success) {
        onShipmentDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    shipmentTableData.headers       = result.headers || [];
    shipmentTableData.allRows       = result.rows    || [];
    shipmentTableData.filteredRows  = shipmentTableData.allRows.slice();
    shipmentTableData.sortCol       = -1;
    shipmentTableData.sortAsc       = true;
    shipmentTableData.page          = 1;
    shipmentTableData.searchQuery   = '';
    shipmentTableData.columnFilters = {};
    shipmentTableData.dateFrom      = '';
    shipmentTableData.dateTo        = '';

    var s = document.getElementById('shipment-data-search');
    if (s) s.value = '';
    updateShipmentSearchClearBtn();

    var df = document.getElementById('shipment-date-from');
    var dt = document.getElementById('shipment-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateShipmentDateClearBtn();

    var labelEl = document.getElementById('shipment-date-col-label');
    var dateCol = getShipmentDateColIndex();
    if (labelEl && shipmentTableData.headers[dateCol]) {
        labelEl.textContent = shipmentTableData.headers[dateCol];
    }

    buildShipmentTableHeaders();
    renderShipmentTable();
}

function onShipmentDataError(msg) {
    var emptyEl = document.getElementById('shipment-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('shipment-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('shipment-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildShipmentTableHeaders() {
    var thead = document.getElementById('shipment-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    shipmentTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-shipment-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onShipmentSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    shipmentTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = shipmentTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            shipmentTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyShipmentFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            shipmentTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyShipmentFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onShipmentSortColumn(colIndex) {
    if (shipmentTableData.sortCol === colIndex) {
        shipmentTableData.sortAsc = !shipmentTableData.sortAsc;
    } else {
        shipmentTableData.sortCol = colIndex;
        shipmentTableData.sortAsc = true;
    }
    updateShipmentSortIcons();
    applyShipmentFilters();
}

function updateShipmentSortIcons() {
    document.querySelectorAll('[data-shipment-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-shipment-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === shipmentTableData.sortCol) {
            icon.textContent = shipmentTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyShipmentFilters() {
    var query      = shipmentTableData.searchQuery;
    var colFilters = shipmentTableData.columnFilters;
    var dateColIdx = getShipmentDateColIndex();
    var dateFrom = shipmentTableData.dateFrom ? new Date(shipmentTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = shipmentTableData.dateTo ? new Date(shipmentTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    shipmentTableData.filteredRows = shipmentTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (shipmentTableData.sortCol >= 0) {
        var sc = shipmentTableData.sortCol;
        shipmentTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return shipmentTableData.sortAsc ? cmp : -cmp;
        });
    }

    shipmentTableData.page = 1;
    renderShipmentTable();
}

function applyShipmentSearch(query) {
    shipmentTableData.searchQuery = (query || '').trim().toLowerCase();
    applyShipmentFilters();
}

function renderShipmentTable() {
    var tbody      = document.getElementById('shipment-data-tbody');
    var tableEl    = document.getElementById('shipment-data-table');
    var emptyEl    = document.getElementById('shipment-data-empty');
    var footerEl   = document.getElementById('shipment-data-footer');
    var countBadge = document.getElementById('shipment-data-count-badge');
    if (!tbody) return;

    var total      = shipmentTableData.filteredRows.length;
    var pageSize   = shipmentTableData.pageSize;
    var page       = shipmentTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    shipmentTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = shipmentTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', shipmentTableData.headers.length + 1);
        var hasFilter = Object.keys(shipmentTableData.columnFilters).some(function (k) {
            return (shipmentTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = shipmentTableData.dateFrom || shipmentTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (shipmentTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (shipmentTableData.allRows.length === 0 ? 'No data found in Shipment Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('shipment-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        shipmentTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (shipmentTableData.searchQuery && cellVal.toLowerCase().indexOf(shipmentTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(shipmentTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('shipment-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (shipmentTableData.allRows.length !== total ? ' (filtered from ' + shipmentTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildShipmentPagination(page, totalPages);
}

function buildShipmentPagination(current, total) {
    var container = document.getElementById('shipment-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                shipmentTableData.page = page;
                renderShipmentTable();
                var wrap = document.getElementById('shipment-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === '\u2026') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadShipmentExcel() {
    var headers = shipmentTableData.headers;
    var rows    = shipmentTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Shipment Details',
        filenamePrefix: 'Shipment_Details'
    });
}

// ---------------------------------------------------------------------------
// Follow-Up Planned — fetch + render
// ---------------------------------------------------------------------------
function updateFollowUpPlannedDateClearBtn() {
    var btn = document.getElementById('followup-planned-date-clear');
    if (btn) btn.style.display = (followUpPlannedTableData.dateFrom || followUpPlannedTableData.dateTo) ? '' : 'none';
}

function updateFollowUpPlannedSearchClearBtn() {
    var s = document.getElementById('followup-planned-data-search');
    var b = document.getElementById('followup-planned-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchFollowUpPlannedDetailsAndRender() {
    var emptyEl  = document.getElementById('followup-planned-data-empty');
    var tableEl  = document.getElementById('followup-planned-data-table');
    var footerEl = document.getElementById('followup-planned-data-footer');

    // Shell mode: no backend is wired up yet, so just show a friendly
    // "not connected" empty state instead of attempting a network call.
    // See the FOLLOWUP_PLANNED_DATA_CONNECTED note near the top of this
    // file for how to connect a real Google Sheet to this view.
    if (!FOLLOWUP_PLANNED_DATA_CONNECTED) {
        if (emptyEl) {
            emptyEl.innerHTML =
                '<span class="material-icons-round">event_repeat</span>' +
                '<p>This view isn\'t connected to a data source yet.</p>';
            emptyEl.style.display = '';
        }
        if (tableEl)  tableEl.style.display  = 'none';
        if (footerEl) footerEl.style.display = 'none';
        return;
    }

    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Follow-Up Planned data...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onFollowUpPlannedDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onFollowUpPlannedDataError(e.message || 'Failed to load data.'); })
            .getFollowUpPlannedData();
        return;
    }
    jsonp({ action: 'getFollowUpPlannedData' }, function (err, result) {
        hideSpinner();
        if (err) { onFollowUpPlannedDataError(err.message); return; }
        onFollowUpPlannedDataLoaded(result);
    });
}

function onFollowUpPlannedDataLoaded(result) {
    if (!result || !result.success) {
        onFollowUpPlannedDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    followUpPlannedTableData.headers       = result.headers || [];
    followUpPlannedTableData.allRows       = result.rows    || [];
    followUpPlannedTableData.filteredRows  = followUpPlannedTableData.allRows.slice();
    followUpPlannedTableData.sortCol       = -1;
    followUpPlannedTableData.sortAsc       = true;
    followUpPlannedTableData.page          = 1;
    followUpPlannedTableData.searchQuery   = '';
    followUpPlannedTableData.columnFilters = {};
    followUpPlannedTableData.dateFrom      = '';
    followUpPlannedTableData.dateTo        = '';

    var s = document.getElementById('followup-planned-data-search');
    if (s) s.value = '';
    updateFollowUpPlannedSearchClearBtn();

    var df = document.getElementById('followup-planned-date-from');
    var dt = document.getElementById('followup-planned-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateFollowUpPlannedDateClearBtn();

    var labelEl = document.getElementById('followup-planned-date-col-label');
    var dateCol = getFollowUpPlannedDateColIndex();
    if (labelEl && followUpPlannedTableData.headers[dateCol]) {
        labelEl.textContent = followUpPlannedTableData.headers[dateCol];
    }

    buildFollowUpPlannedTableHeaders();
    renderFollowUpPlannedTable();
}

function onFollowUpPlannedDataError(msg) {
    var emptyEl = document.getElementById('followup-planned-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('followup-planned-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('followup-planned-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildFollowUpPlannedTableHeaders() {
    var thead = document.getElementById('followup-planned-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    followUpPlannedTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-followup-planned-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onFollowUpPlannedSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    followUpPlannedTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = followUpPlannedTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            followUpPlannedTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyFollowUpPlannedFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            followUpPlannedTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyFollowUpPlannedFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onFollowUpPlannedSortColumn(colIndex) {
    if (followUpPlannedTableData.sortCol === colIndex) {
        followUpPlannedTableData.sortAsc = !followUpPlannedTableData.sortAsc;
    } else {
        followUpPlannedTableData.sortCol = colIndex;
        followUpPlannedTableData.sortAsc = true;
    }
    updateFollowUpPlannedSortIcons();
    applyFollowUpPlannedFilters();
}

function updateFollowUpPlannedSortIcons() {
    document.querySelectorAll('[data-followup-planned-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-followup-planned-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === followUpPlannedTableData.sortCol) {
            icon.textContent = followUpPlannedTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyFollowUpPlannedFilters() {
    var query      = followUpPlannedTableData.searchQuery;
    var colFilters = followUpPlannedTableData.columnFilters;
    var dateColIdx = getFollowUpPlannedDateColIndex();
    var dateFrom = followUpPlannedTableData.dateFrom ? new Date(followUpPlannedTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = followUpPlannedTableData.dateTo ? new Date(followUpPlannedTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    followUpPlannedTableData.filteredRows = followUpPlannedTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (followUpPlannedTableData.sortCol >= 0) {
        var sc = followUpPlannedTableData.sortCol;
        followUpPlannedTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return followUpPlannedTableData.sortAsc ? cmp : -cmp;
        });
    }

    followUpPlannedTableData.page = 1;
    renderFollowUpPlannedTable();
}

function applyFollowUpPlannedSearch(query) {
    followUpPlannedTableData.searchQuery = (query || '').trim().toLowerCase();
    applyFollowUpPlannedFilters();
}

function renderFollowUpPlannedTable() {
    var tbody      = document.getElementById('followup-planned-data-tbody');
    var tableEl    = document.getElementById('followup-planned-data-table');
    var emptyEl    = document.getElementById('followup-planned-data-empty');
    var footerEl   = document.getElementById('followup-planned-data-footer');
    var countBadge = document.getElementById('followup-planned-data-count-badge');
    if (!tbody) return;

    var total      = followUpPlannedTableData.filteredRows.length;
    var pageSize   = followUpPlannedTableData.pageSize;
    var page       = followUpPlannedTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    followUpPlannedTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = followUpPlannedTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', followUpPlannedTableData.headers.length + 1);
        var hasFilter = Object.keys(followUpPlannedTableData.columnFilters).some(function (k) {
            return (followUpPlannedTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = followUpPlannedTableData.dateFrom || followUpPlannedTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (followUpPlannedTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (followUpPlannedTableData.allRows.length === 0 ? 'No data found in Follow-Up Planned.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('followup-planned-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        followUpPlannedTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (followUpPlannedTableData.searchQuery && cellVal.toLowerCase().indexOf(followUpPlannedTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(followUpPlannedTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('followup-planned-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (followUpPlannedTableData.allRows.length !== total ? ' (filtered from ' + followUpPlannedTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildFollowUpPlannedPagination(page, totalPages);
}

function buildFollowUpPlannedPagination(current, total) {
    var container = document.getElementById('followup-planned-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                followUpPlannedTableData.page = page;
                renderFollowUpPlannedTable();
                var wrap = document.getElementById('followup-planned-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === '\u2026') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadFollowUpPlannedExcel() {
    var headers = followUpPlannedTableData.headers;
    var rows    = followUpPlannedTableData.filteredRows;
    if (!headers.length || !rows.length) {
        showToast('error', 'Nothing to Export', 'This view isn\'t connected to a data source yet.');
        return;
    }
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Follow-Up Planned',
        filenamePrefix: 'Follow_Up_Planned'
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function initEndLineQc() {
    var kpiCard = document.getElementById('kpi-endline-qc-details');
    if (kpiCard) {
        kpiCard.addEventListener('click', function () { showBatchListEndLineQcView(); });
        kpiCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListEndLineQcView(); }
        });
    }

    var backBtn = document.getElementById('btn-back-endline-qc');
    if (backBtn) backBtn.addEventListener('click', function () { backToBatchListKpiView(); });

    var excelBtn = document.getElementById('btn-download-endline-qc-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadEndLineQcExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-endline-qc-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            endLineQcTableData.allRows       = [];
            endLineQcTableData.columnFilters = {};
            fetchEndLineQcDetailsAndRender();
        });
    }

    var searchEl = document.getElementById('endline-qc-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updateEndLineQcSearchClearBtn();
            applyEndLineQcSearch(searchEl.value);
        });
    }
    var clearSearch = document.getElementById('endline-qc-data-search-clear');
    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            var s = document.getElementById('endline-qc-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateEndLineQcSearchClearBtn();
            applyEndLineQcSearch('');
        });
    }

    var dateFrom = document.getElementById('endline-qc-date-from');
    if (dateFrom) {
        dateFrom.addEventListener('change', function () {
            endLineQcTableData.dateFrom = dateFrom.value;
            updateEndLineQcDateClearBtn();
            applyEndLineQcFilters();
        });
    }
    var dateTo = document.getElementById('endline-qc-date-to');
    if (dateTo) {
        dateTo.addEventListener('change', function () {
            endLineQcTableData.dateTo = dateTo.value;
            updateEndLineQcDateClearBtn();
            applyEndLineQcFilters();
        });
    }
    var dateClear = document.getElementById('endline-qc-date-clear');
    if (dateClear) {
        dateClear.addEventListener('click', function () {
            endLineQcTableData.dateFrom = '';
            endLineQcTableData.dateTo   = '';
            var f = document.getElementById('endline-qc-date-from');
            var t = document.getElementById('endline-qc-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateEndLineQcDateClearBtn();
            applyEndLineQcFilters();
        });
    }

    var pageSize = document.getElementById('endline-qc-data-page-size');
    if (pageSize) {
        pageSize.addEventListener('change', function () {
            endLineQcTableData.pageSize = parseInt(pageSize.value, 10) || 25;
            endLineQcTableData.page = 1;
            renderEndLineQcTable();
        });
    }
}

function initFollowUpPlanned() {
    // The detail panel was originally created under Production Data. Move it
    // into the PDF page so its card and content stay in the same section.
    var detailView = document.getElementById('batch-list-followup-planned-view');
    var pdfPage = document.getElementById('page-pdf');
    if (detailView && pdfPage && detailView.parentNode !== pdfPage) {
        pdfPage.appendChild(detailView);
    }

    var excelBtn = document.getElementById('btn-download-followup-planned-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadFollowUpPlannedExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-followup-planned-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            followUpPlannedTableData.allRows       = [];
            followUpPlannedTableData.columnFilters = {};
            fetchFollowUpPlannedDetailsAndRender();
        });
    }

    var searchEl = document.getElementById('followup-planned-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updateFollowUpPlannedSearchClearBtn();
            applyFollowUpPlannedSearch(searchEl.value);
        });
    }
    var clearSearch = document.getElementById('followup-planned-data-search-clear');
    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            var s = document.getElementById('followup-planned-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateFollowUpPlannedSearchClearBtn();
            applyFollowUpPlannedSearch('');
        });
    }

    var dateFrom = document.getElementById('followup-planned-date-from');
    if (dateFrom) {
        dateFrom.addEventListener('change', function () {
            followUpPlannedTableData.dateFrom = dateFrom.value;
            updateFollowUpPlannedDateClearBtn();
            applyFollowUpPlannedFilters();
        });
    }
    var dateTo = document.getElementById('followup-planned-date-to');
    if (dateTo) {
        dateTo.addEventListener('change', function () {
            followUpPlannedTableData.dateTo = dateTo.value;
            updateFollowUpPlannedDateClearBtn();
            applyFollowUpPlannedFilters();
        });
    }
    var dateClear = document.getElementById('followup-planned-date-clear');
    if (dateClear) {
        dateClear.addEventListener('click', function () {
            followUpPlannedTableData.dateFrom = '';
            followUpPlannedTableData.dateTo   = '';
            var f = document.getElementById('followup-planned-date-from');
            var t = document.getElementById('followup-planned-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateFollowUpPlannedDateClearBtn();
            applyFollowUpPlannedFilters();
        });
    }

    var pageSize = document.getElementById('followup-planned-data-page-size');
    if (pageSize) {
        pageSize.addEventListener('change', function () {
            followUpPlannedTableData.pageSize = parseInt(pageSize.value, 10) || 25;
            followUpPlannedTableData.page = 1;
            renderFollowUpPlannedTable();
        });
    }
}

function initPostAql() {
    var kpiCard = document.getElementById('kpi-post-aql-details');
    if (kpiCard) {
        kpiCard.addEventListener('click', function () { showBatchListPostAqlView(); });
        kpiCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListPostAqlView(); }
        });
    }

    var backBtn = document.getElementById('btn-back-post-aql');
    if (backBtn) backBtn.addEventListener('click', function () { backToBatchListKpiViewFromPostAql(); });

    var excelBtn = document.getElementById('btn-download-post-aql-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadPostAqlExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-post-aql-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            postAqlTableData.allRows       = [];
            postAqlTableData.columnFilters = {};
            fetchPostAqlDetailsAndRender();
        });
    }

    var searchEl = document.getElementById('post-aql-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updatePostAqlSearchClearBtn();
            applyPostAqlSearch(searchEl.value);
        });
    }
    var clearSearch = document.getElementById('post-aql-data-search-clear');
    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            var s = document.getElementById('post-aql-data-search');
            if (s) { s.value = ''; s.focus(); }
            updatePostAqlSearchClearBtn();
            applyPostAqlSearch('');
        });
    }

    var dateFrom = document.getElementById('post-aql-date-from');
    if (dateFrom) {
        dateFrom.addEventListener('change', function () {
            postAqlTableData.dateFrom = dateFrom.value;
            updatePostAqlDateClearBtn();
            applyPostAqlFilters();
        });
    }
    var dateTo = document.getElementById('post-aql-date-to');
    if (dateTo) {
        dateTo.addEventListener('change', function () {
            postAqlTableData.dateTo = dateTo.value;
            updatePostAqlDateClearBtn();
            applyPostAqlFilters();
        });
    }
    var dateClear = document.getElementById('post-aql-date-clear');
    if (dateClear) {
        dateClear.addEventListener('click', function () {
            postAqlTableData.dateFrom = '';
            postAqlTableData.dateTo   = '';
            var f = document.getElementById('post-aql-date-from');
            var t = document.getElementById('post-aql-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updatePostAqlDateClearBtn();
            applyPostAqlFilters();
        });
    }

    var pageSize = document.getElementById('post-aql-data-page-size');
    if (pageSize) {
        pageSize.addEventListener('change', function () {
            postAqlTableData.pageSize = parseInt(pageSize.value, 10) || 25;
            postAqlTableData.page = 1;
            renderPostAqlTable();
        });
    }
}

function initWarehouseFms() {
    var kpiCard = document.getElementById('kpi-warehouse-fms-details');
    if (kpiCard) {
        kpiCard.addEventListener('click', function () { showBatchListWarehouseFmsView(); });
        kpiCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListWarehouseFmsView(); }
        });
    }

    var backBtn = document.getElementById('btn-back-warehouse-fms');
    if (backBtn) backBtn.addEventListener('click', function () { backToBatchListKpiViewFromWarehouseFms(); });

    var excelBtn = document.getElementById('btn-download-warehouse-fms-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadWarehouseFmsExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-warehouse-fms-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            warehouseFmsTableData.allRows       = [];
            warehouseFmsTableData.columnFilters = {};
            fetchWarehouseFmsDetailsAndRender();
        });
    }

    var searchEl = document.getElementById('warehouse-fms-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updateWarehouseFmsSearchClearBtn();
            applyWarehouseFmsSearch(searchEl.value);
        });
    }
    var clearSearch = document.getElementById('warehouse-fms-data-search-clear');
    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            var s = document.getElementById('warehouse-fms-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateWarehouseFmsSearchClearBtn();
            applyWarehouseFmsSearch('');
        });
    }

    var dateFrom = document.getElementById('warehouse-fms-date-from');
    if (dateFrom) {
        dateFrom.addEventListener('change', function () {
            warehouseFmsTableData.dateFrom = dateFrom.value;
            updateWarehouseFmsDateClearBtn();
            applyWarehouseFmsFilters();
        });
    }
    var dateTo = document.getElementById('warehouse-fms-date-to');
    if (dateTo) {
        dateTo.addEventListener('change', function () {
            warehouseFmsTableData.dateTo = dateTo.value;
            updateWarehouseFmsDateClearBtn();
            applyWarehouseFmsFilters();
        });
    }
    var dateClear = document.getElementById('warehouse-fms-date-clear');
    if (dateClear) {
        dateClear.addEventListener('click', function () {
            warehouseFmsTableData.dateFrom = '';
            warehouseFmsTableData.dateTo   = '';
            var f = document.getElementById('warehouse-fms-date-from');
            var t = document.getElementById('warehouse-fms-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateWarehouseFmsDateClearBtn();
            applyWarehouseFmsFilters();
        });
    }

    var pageSize = document.getElementById('warehouse-fms-data-page-size');
    if (pageSize) {
        pageSize.addEventListener('change', function () {
            warehouseFmsTableData.pageSize = parseInt(pageSize.value, 10) || 25;
            warehouseFmsTableData.page = 1;
            renderWarehouseFmsTable();
        });
    }
}

function initShipment() {
    var kpiCard = document.getElementById('kpi-shipment-details');
    if (kpiCard) {
        kpiCard.addEventListener('click', function () { showBatchListShipmentView(); });
        kpiCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListShipmentView(); }
        });
    }

    var backBtn = document.getElementById('btn-back-shipment');
    if (backBtn) backBtn.addEventListener('click', function () { backToBatchListKpiViewFromShipment(); });

    var excelBtn = document.getElementById('btn-download-shipment-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadShipmentExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-shipment-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            shipmentTableData.allRows       = [];
            shipmentTableData.columnFilters = {};
            fetchShipmentDetailsAndRender();
        });
    }

    var searchEl = document.getElementById('shipment-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updateShipmentSearchClearBtn();
            applyShipmentSearch(searchEl.value);
        });
    }
    var clearSearch = document.getElementById('shipment-data-search-clear');
    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            var s = document.getElementById('shipment-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateShipmentSearchClearBtn();
            applyShipmentSearch('');
        });
    }

    var dateFrom = document.getElementById('shipment-date-from');
    if (dateFrom) {
        dateFrom.addEventListener('change', function () {
            shipmentTableData.dateFrom = dateFrom.value;
            updateShipmentDateClearBtn();
            applyShipmentFilters();
        });
    }
    var dateTo = document.getElementById('shipment-date-to');
    if (dateTo) {
        dateTo.addEventListener('change', function () {
            shipmentTableData.dateTo = dateTo.value;
            updateShipmentDateClearBtn();
            applyShipmentFilters();
        });
    }
    var dateClear = document.getElementById('shipment-date-clear');
    if (dateClear) {
        dateClear.addEventListener('click', function () {
            shipmentTableData.dateFrom = '';
            shipmentTableData.dateTo   = '';
            var f = document.getElementById('shipment-date-from');
            var t = document.getElementById('shipment-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateShipmentDateClearBtn();
            applyShipmentFilters();
        });
    }

    var pageSize = document.getElementById('shipment-data-page-size');
    if (pageSize) {
        pageSize.addEventListener('change', function () {
            shipmentTableData.pageSize = parseInt(pageSize.value, 10) || 25;
            shipmentTableData.page = 1;
            renderShipmentTable();
        });
    }
}

// =============================================================================
// OT & LEAVE — OT Details / Leave Details / OT & Leave Analysis
// =============================================================================
// Unlike the Production Data sub-views above, this data lives in a SEPARATE
// Google Sheet powered by its own standalone Apps Script Web App (OT.gs —
// see that file for setup instructions), so we talk to it with a plain
// fetch() call — the same technique app.js already uses for the DICE_FORMA
// web app — instead of the shared jsonp()/GAS_URL helper.
//
// After deploying OT.gs as its own Web App, paste the resulting /exec URL
// below (it is already pre-filled with the URL supplied when this feature
// was built).
// =============================================================================

var OT_LEAVE_URL = 'https://script.google.com/macros/s/AKfycbxsJ1vRxzXNO-vQ2LG2PYGFy73SDCM2VxEo-cznzKYku_hbJ8B7uaFwCOPwMX3LPLsefw/exec';

// One config-driven implementation shared by all three sub-views — same
// approach app.js uses for the Dice/Forma "tracker summary" sub-views.
var otLeaveTableStates = {
    'ot-details': {
        headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true,
        page: 1, pageSize: 25, searchQuery: '', columnFilters: {}, dateFrom: '', dateTo: ''
    },
    'leave-details': {
        headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true,
        page: 1, pageSize: 25, searchQuery: '', columnFilters: {}, dateFrom: '', dateTo: ''
    },
    'ot-leave-analysis': {
        headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true,
        page: 1, pageSize: 25, searchQuery: '', columnFilters: {}, dateFrom: '', dateTo: ''
    }
};

function getOtLeaveState(type) { return otLeaveTableStates[type]; }

// `type` doubles as the DOM id prefix used throughout ot-details-view /
// leave-details-view / ot-leave-analysis-view in index.html.
function getOtLeaveConfig(type) {
    if (type === 'ot-details') {
        return {
            prefix: 'ot-details', viewId: 'ot-details-view', action: 'getOtDetailsData',
            label: 'Additional Work Details', emptyLabel: 'Additional Work Details',
            excelSheetName: 'Additional Work Details', excelFilePrefix: 'Additional_Work_Details'
        };
    }
    if (type === 'leave-details') {
        return {
            prefix: 'leave-details', viewId: 'leave-details-view', action: 'getLeaveDetailsData',
            label: 'Leave Details', emptyLabel: 'Leave Details',
            excelSheetName: 'Leave Details', excelFilePrefix: 'Leave_Details'
        };
    }
    return {
        prefix: 'ot-leave-analysis', viewId: 'ot-leave-analysis-view', action: 'getOtLeaveAnalysisData',
        label: 'Additional Work & Leave Analysis', emptyLabel: 'Additional Work & Leave Analysis',
        excelSheetName: 'Additional Work & Leave Analysis', excelFilePrefix: 'Additional_Work_Leave_Analysis'
    };
}

// Column B of the source sheet (index 0 of the loaded range) is assumed to
// be the date column for the "From/To" date-range filter, same convention
// used across the rest of the app.
function getOtLeaveDateColIndex() { return 0; }

function showOtLeaveKpiView() {
    var kpiView = document.getElementById('ot-leave-kpi-view');
    if (kpiView) kpiView.style.display = '';
    ['ot-details', 'leave-details', 'ot-leave-analysis'].forEach(function (type) {
        var view = document.getElementById(getOtLeaveConfig(type).viewId);
        if (view) view.style.display = 'none';
    });
    applyKpiCardAccess();
}

function showOtLeaveDetailView(type) {
    var config  = getOtLeaveConfig(type);
    var kpiView = document.getElementById('ot-leave-kpi-view');
    var view    = document.getElementById(config.viewId);
    if (kpiView) kpiView.style.display = 'none';
    ['ot-details', 'leave-details', 'ot-leave-analysis'].forEach(function (t) {
        var v = document.getElementById(getOtLeaveConfig(t).viewId);
        if (v) v.style.display = (t === type) ? '' : 'none';
    });
    if (view) view.style.display = '';

    var state = getOtLeaveState(type);
    if (state.allRows.length === 0) {
        fetchOtLeaveData(type);
    } else {
        renderOtLeaveTable(type);
    }
}

function fetchOtLeaveData(type) {
    var config   = getOtLeaveConfig(type);
    var prefix   = config.prefix;
    var emptyEl  = document.getElementById(prefix + '-data-empty');
    var tableEl  = document.getElementById(prefix + '-data-table');
    var footerEl = document.getElementById(prefix + '-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data…'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching ' + config.label + ' data…');

    fetch(OT_LEAVE_URL + '?action=' + encodeURIComponent(config.action) + '&_=' + Date.now())
        .then(function (response) {
            if (!response.ok) throw new Error('The Additional Work & Leave server returned HTTP ' + response.status + '.');
            return response.json();
        })
        .then(function (result) {
            hideSpinner();
            if (!result || !result.success) throw new Error((result && result.error) || 'Could not load data.');
            if (!Array.isArray(result.headers) || !Array.isArray(result.rows)) {
                throw new Error('The Additional Work & Leave web app needs to be redeployed with the latest OT.gs code.');
            }
            onOtLeaveDataLoaded(type, result);
        })
        .catch(function (err) {
            hideSpinner();
            onOtLeaveDataError(type, err.message || 'Could not load data.');
        });
}

function onOtLeaveDataLoaded(type, result) {
    var config = getOtLeaveConfig(type);
    var prefix = config.prefix;
    var state  = getOtLeaveState(type);

    state.headers       = result.headers || [];
    state.allRows       = result.rows    || [];
    state.filteredRows  = state.allRows.slice();
    state.sortCol       = -1;
    state.sortAsc       = true;
    state.page          = 1;
    state.searchQuery    = '';
    state.columnFilters = {};
    state.dateFrom       = '';
    state.dateTo         = '';

    var searchEl = document.getElementById(prefix + '-data-search');
    if (searchEl) searchEl.value = '';
    updateOtLeaveSearchClearBtn(type);

    var dFrom = document.getElementById(prefix + '-date-from');
    var dTo   = document.getElementById(prefix + '-date-to');
    if (dFrom) dFrom.value = '';
    if (dTo)   dTo.value   = '';
    updateOtLeaveDateClearBtn(type);

    var labelEl = document.getElementById(prefix + '-date-col-label');
    if (labelEl && state.headers[getOtLeaveDateColIndex()]) {
        labelEl.textContent = state.headers[getOtLeaveDateColIndex()];
    }

    buildOtLeaveTableHeaders(type);
    renderOtLeaveTable(type);
}

function onOtLeaveDataError(type, msg) {
    var config  = getOtLeaveConfig(type);
    var prefix  = config.prefix;
    var emptyEl = document.getElementById(prefix + '-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById(prefix + '-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById(prefix + '-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', config.label + ' Data Error', msg);
}

function buildOtLeaveTableHeaders(type) {
    var config = getOtLeaveConfig(type);
    var prefix = config.prefix;
    var state  = getOtLeaveState(type);
    var thead  = document.getElementById(prefix + '-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    state.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-' + prefix + '-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onOtLeaveSortColumn(type, i); });
        trHead.appendChild(th);
    });

    var trFilter    = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);
    state.headers.forEach(function (h, i) {
        var th   = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type        = 'text';
        input.className   = 'dt-col-filter';
        input.placeholder = 'Filter…';
        input.value       = state.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className     = 'dt-col-filter-clear';
        clearBtn.title         = 'Clear filter';
        clearBtn.innerHTML     = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            state.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyOtLeaveFilters(type);
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            state.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyOtLeaveFilters(type);
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onOtLeaveSortColumn(type, colIndex) {
    var state = getOtLeaveState(type);
    if (state.sortCol === colIndex) {
        state.sortAsc = !state.sortAsc;
    } else {
        state.sortCol = colIndex;
        state.sortAsc = true;
    }
    updateOtLeaveSortIcons(type);
    applyOtLeaveFilters(type);
}

function updateOtLeaveSortIcons(type) {
    var config = getOtLeaveConfig(type);
    var state  = getOtLeaveState(type);
    document.querySelectorAll('[data-' + config.prefix + '-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-' + config.prefix + '-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === state.sortCol) {
            icon.textContent = state.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function updateOtLeaveDateClearBtn(type) {
    var config   = getOtLeaveConfig(type);
    var state    = getOtLeaveState(type);
    var clearBtn = document.getElementById(config.prefix + '-date-clear');
    if (!clearBtn) return;
    clearBtn.style.display = (state.dateFrom || state.dateTo) ? '' : 'none';
}

function updateOtLeaveSearchClearBtn(type) {
    var config   = getOtLeaveConfig(type);
    var searchEl = document.getElementById(config.prefix + '-data-search');
    var clearBtn = document.getElementById(config.prefix + '-data-search-clear');
    if (!searchEl || !clearBtn) return;
    clearBtn.style.display = searchEl.value ? '' : 'none';
}

function applyOtLeaveFilters(type) {
    var state      = getOtLeaveState(type);
    var query      = state.searchQuery;
    var colFilters = state.columnFilters;
    var dateColIdx = getOtLeaveDateColIndex();

    var dateFrom = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00') : null;
    var dateTo   = state.dateTo   ? new Date(state.dateTo   + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    state.filteredRows = state.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0) {
            var rawDate = row[dateColIdx];
            var parsed  = parseCreatedAt(rawDate);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (state.sortCol >= 0) {
        var sc = state.sortCol;
        state.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return state.sortAsc ? cmp : -cmp;
        });
    }
    state.page = 1;
    renderOtLeaveTable(type);
}

function applyOtLeaveSearch(type, query) {
    var state = getOtLeaveState(type);
    state.searchQuery = (query || '').trim().toLowerCase();
    applyOtLeaveFilters(type);
}

function renderOtLeaveTable(type) {
    var config = getOtLeaveConfig(type);
    var prefix = config.prefix;
    var state  = getOtLeaveState(type);

    var tbody      = document.getElementById(prefix + '-data-tbody');
    var tableEl    = document.getElementById(prefix + '-data-table');
    var emptyEl    = document.getElementById(prefix + '-data-empty');
    var footerEl   = document.getElementById(prefix + '-data-footer');
    var countBadge = document.getElementById(prefix + '-data-count-badge');
    if (!tbody) return;

    var total      = state.filteredRows.length;
    var pageSize   = state.pageSize;
    var page       = state.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = state.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', state.headers.length + 1);
        var hasFilter = Object.keys(state.columnFilters).some(function (k) {
            return (state.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = state.dateFrom || state.dateTo;
        tdEmpty.innerHTML = '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (state.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (state.allRows.length === 0 ? 'No data found in ' + config.emptyLabel + '.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById(prefix + '-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    // OT & Leave Analysis: flag the entire row red when any of the LAST SIX
    // columns contains "YES" (case-insensitive, whitespace-tolerant).
    var flagLastSixYes = type === 'ot-leave-analysis';
    var flagStartCol = Math.max(0, state.headers.length - 6);

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        if (flagLastSixYes) {
            var isFlagged = false;
            for (var fc = flagStartCol; fc < state.headers.length; fc++) {
                var fv = row[fc];
                if (fv !== undefined && fv !== null && String(fv).trim().toUpperCase() === 'YES') {
                    isFlagged = true;
                    break;
                }
            }
            if (isFlagged) tr.className += ' dt-tr-flag-red';
        }
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        state.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (state.searchQuery && cellVal.toLowerCase().indexOf(state.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(state.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById(prefix + '-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (state.allRows.length !== total ? ' (filtered from ' + state.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildOtLeavePagination(type, page, totalPages);
}

function buildOtLeavePagination(type, current, total) {
    var config    = getOtLeaveConfig(type);
    var state     = getOtLeaveState(type);
    var container = document.getElementById(config.prefix + '-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                state.page = page;
                renderOtLeaveTable(type);
                var wrap = document.getElementById(config.prefix + '-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '…' || item === '...') {
            var el = document.createElement('span');
            el.className   = 'dt-page-ellipsis';
            el.textContent = '…';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadOtLeaveExcel(type) {
    var config  = getOtLeaveConfig(type);
    var state   = getOtLeaveState(type);
    // Mirrors the on-screen rule: OT & Leave Analysis rows are flagged red
    // when any of the LAST SIX columns contains "YES".
    var flagLastSixYes = type === 'ot-leave-analysis';
    var flagStartCol    = Math.max(0, state.headers.length - 6);
    exportRowsToXlsx({
        headers: state.headers,
        rows: state.filteredRows,
        sheetName: config.excelSheetName,
        filenamePrefix: config.excelFilePrefix,
        rowColor: flagLastSixYes ? function (row) {
            for (var fc = flagStartCol; fc < state.headers.length; fc++) {
                var fv = row[fc];
                if (fv !== undefined && fv !== null && String(fv).trim().toUpperCase() === 'YES') {
                    return excelRowColor_('flag-red');
                }
            }
            return null;
        } : null
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
// =============================================================================
// PURCHASE — Domestic Purchase Order Form / Import Purchase Order Form
// =============================================================================
// Uses its own separate Google Spreadsheet + Web App (see Purchase.gs).
// Follows the same KPI-card -> detail-view navigation pattern used by
// OT & Leave / Warehouse, and the same submit pattern used by the DICE/FORMA
// tracker forms in app.js.
// =============================================================================
var PURCHASE_URL = 'https://script.google.com/macros/s/AKfycbwjHUTJKOh3_P0mXD1Kk1dyeBJ_KuSRMjCjcm-YtJBDH9RMGUnkC_F4ELONFhkGefkI/exec';

var purchaseDropdownsLoaded = false;

function safeCurrentSubmitter() {
    if (typeof currentSubmitter === 'function') return currentSubmitter();
    try {
        return sessionStorage.getItem('fms_user') || (document.getElementById('topbar-username') || {}).textContent || 'User';
    } catch (e) { return 'User'; }
}

function postPurchase(payload) {
    return fetch(PURCHASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    }).then(function (response) {
        if (!response.ok) throw new Error('The form server returned HTTP ' + response.status + '.');
        return response.json();
    }).then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'The form server did not confirm the submission.');
        return result;
    });
}

function populatePurchaseSelect(select, values) {
    if (!select) return;
    var current = select.value;
    var placeholder = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (placeholder) select.appendChild(placeholder);
    (values || []).forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });
    if (current && values && values.indexOf(current) !== -1) select.value = current;
}

function fetchPurchaseDropdowns() {
    if (purchaseDropdownsLoaded) return;
    fetch(PURCHASE_URL + '?action=getPurchaseDropdowns&_=' + Date.now())
        .then(function (response) { return response.json(); })
        .then(function (result) {
            if (!result || !result.success) throw new Error((result && result.error) || 'Failed to load dropdown data.');
            purchaseDropdownsLoaded = true;
            var seasons = result.data.seasons || [];
            var categories = result.data.categories || [];
            populatePurchaseSelect(document.getElementById('domestic-season'), seasons);
            populatePurchaseSelect(document.getElementById('domestic-category'), categories);
            populatePurchaseSelect(document.getElementById('import-season'), seasons);
            populatePurchaseSelect(document.getElementById('import-category'), categories);
        })
        .catch(function (err) {
            showToast('error', 'Load Error', err.message || 'Failed to load Purchase dropdown data.');
        });
}

// ---------------------------------------------------------------------------
// PO Number duplicate check — mirrors the Batch (Auto) "already exists"
// pattern used by the DICE/FORMA form in app.js. While the user is typing a
// PO Number, we ask the server whether that PO Number has already been
// submitted for this form (Domestic or Import). If it has, every other
// field (and the Submit button) is disabled so the entry cannot be created,
// and an inline message is shown next to the PO Number field.
// ---------------------------------------------------------------------------
function purchasePoMsgEl(formType) {
    return document.getElementById(formType + '-po-number-msg');
}

function setPurchasePoMsg(formType, text, variant) {
    var msgEl = purchasePoMsgEl(formType);
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'batch-auto-msg' + (variant ? ' batch-auto-msg--' + variant : '');
}

function setPurchaseOtherFieldsDisabled(form, poInput, disabled) {
    form.querySelectorAll('input, select').forEach(function (el) {
        if (el === poInput) return;
        el.disabled = disabled;
    });
    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = disabled;
}

function checkPurchasePoNumber(formType, poNumber) {
    var url = PURCHASE_URL + '?action=checkPoNumber&formType=' + encodeURIComponent(formType) +
        '&poNumber=' + encodeURIComponent(poNumber) + '&_=' + Date.now();
    return fetch(url).then(function (response) { return response.json(); });
}

// Checks the current PO Number value for `formType` ('domestic' or 'import'),
// disables/enables the rest of the form accordingly, and resolves to `true`
// if the PO Number is a duplicate (so callers can block submission).
function validatePurchasePoNumber(formType) {
    var form = document.getElementById(formType + '-po-form');
    var poInput = document.getElementById(formType + '-po-number');
    if (!form || !poInput) return Promise.resolve(false);

    var poNumber = (poInput.value || '').trim();
    if (!poNumber) {
        setPurchasePoMsg(formType, '');
        setPurchaseOtherFieldsDisabled(form, poInput, false);
        return Promise.resolve(false);
    }

    setPurchasePoMsg(formType, 'Checking PO Number…', 'loading');

    return checkPurchasePoNumber(formType, poNumber)
        .then(function (result) {
            // The user may have changed the PO Number again while this
            // request was in flight — only act on the response if it still
            // matches what's currently in the field.
            if ((poInput.value || '').trim() !== poNumber) return null;

            if (result && result.success && result.exists) {
                setPurchaseOtherFieldsDisabled(form, poInput, true);
                setPurchasePoMsg(formType, 'This PO Number already exists. Please enter a different PO Number.', 'exists');
                return true;
            }
            setPurchaseOtherFieldsDisabled(form, poInput, false);
            if (result && result.success) {
                setPurchasePoMsg(formType, '');
            } else {
                setPurchasePoMsg(formType, (result && result.error) || 'Could not verify PO Number.', 'not-found');
            }
            return false;
        })
        .catch(function () {
            // Network error: don't lock the user out, but let them know the
            // check couldn't be completed. Server-side validation on submit
            // still guards against a duplicate slipping through.
            setPurchaseOtherFieldsDisabled(form, poInput, false);
            setPurchasePoMsg(formType, 'Could not verify PO Number — check your connection.', 'not-found');
            return false;
        });
}

function debouncePurchasePoCheck(formType, delay) {
    var timers = debouncePurchasePoCheck._timers || (debouncePurchasePoCheck._timers = {});
    return function () {
        clearTimeout(timers[formType]);
        timers[formType] = setTimeout(function () { validatePurchasePoNumber(formType); }, delay || 500);
    };
}

function clearPurchaseErrors(form) {
    form.querySelectorAll('.form-field').forEach(function (field) { field.classList.remove('has-error'); });
}

function validatePurchaseForm(form) {
    clearPurchaseErrors(form);
    var firstInvalid = null;
    form.querySelectorAll('[required]').forEach(function (input) {
        if (!input.checkValidity()) {
            var field = input.closest('.form-field');
            if (field) field.classList.add('has-error');
            if (!firstInvalid) firstInvalid = input;
        }
    });
    if (firstInvalid) {
        firstInvalid.focus();
        showToast('error', 'Required fields', 'Please complete all required fields with valid values.');
        return false;
    }
    return true;
}

function submitPurchaseForm(form, action) {
    var formType = (action === 'submitImportPO') ? 'import' : 'domestic';
    var poInput = document.getElementById(formType + '-po-number');
    var button = form.querySelector('[type="submit"]');
    var original = button.innerHTML;

    // Always re-check the PO Number right before submitting — this catches
    // a duplicate created by someone else since the last live check, as
    // well as the case where the user never blurred/typed after focusing
    // the field. Server-side (Purchase.gs) re-checks again regardless.
    button.disabled = true;
    validatePurchasePoNumber(formType).then(function (isDuplicate) {
        if (isDuplicate) {
            button.disabled = true; // stays locked along with the rest of the form
            showToast('error', 'Duplicate PO Number', 'This PO Number already exists. Please enter a different PO Number.');
            return;
        }

        if (!validatePurchaseForm(form)) {
            button.disabled = false;
            return;
        }

        button.innerHTML = '<span class="material-icons-round">hourglass_top</span>Submitting...';

        var data = {};
        form.querySelectorAll('input, select').forEach(function (field) { data[field.name] = (field.value || '').trim(); });
        data.createdBy = safeCurrentSubmitter().trim();

        postPurchase({ action: action, formData: data })
            .then(function () {
                form.reset();
                clearPurchaseErrors(form);
                setPurchaseOtherFieldsDisabled(form, poInput, false);
                setPurchasePoMsg(formType, '');
                showToast('success', 'Submitted', 'Purchase order details have been submitted successfully.');
            })
            .catch(function (err) {
                showToast('error', 'Submission failed', err && err.message ? err.message : 'Please check your internet connection and try again.');
            })
            .then(function () {
                button.disabled = false;
                button.innerHTML = original;
            });
    });
}

function showPurchaseKpiView() {
    var kpiView = document.getElementById('purchase-kpi-view');
    if (kpiView) kpiView.style.display = '';
    ['domestic-po-view', 'import-po-view'].forEach(function (id) {
        var view = document.getElementById(id);
        if (view) view.style.display = 'none';
    });
    applyKpiCardAccess();
}

function showPurchaseDetailView(viewId) {
    var kpiView = document.getElementById('purchase-kpi-view');
    if (kpiView) kpiView.style.display = 'none';
    ['domestic-po-view', 'import-po-view'].forEach(function (id) {
        var view = document.getElementById(id);
        if (view) view.style.display = (id === viewId) ? '' : 'none';
    });
}

function initPurchase() {
    var domesticCard = document.getElementById('kpi-domestic-po');
    if (domesticCard) {
        domesticCard.addEventListener('click', function () { showPurchaseDetailView('domestic-po-view'); });
        domesticCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPurchaseDetailView('domestic-po-view'); }
        });
    }

    var importCard = document.getElementById('kpi-import-po');
    if (importCard) {
        importCard.addEventListener('click', function () { showPurchaseDetailView('import-po-view'); });
        importCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPurchaseDetailView('import-po-view'); }
        });
    }

    var backDomestic = document.getElementById('btn-back-domestic-po');
    if (backDomestic) backDomestic.addEventListener('click', showPurchaseKpiView);

    var backImport = document.getElementById('btn-back-import-po');
    if (backImport) backImport.addEventListener('click', showPurchaseKpiView);

    // Reset to the KPI landing view whenever the Purchase nav item is clicked.
    document.querySelectorAll('.nav-item[data-page="purchase"]').forEach(function (item) {
        item.addEventListener('click', showPurchaseKpiView);
    });

    var domesticForm = document.getElementById('domestic-po-form');
    if (domesticForm) domesticForm.addEventListener('submit', function (event) {
        event.preventDefault();
        submitPurchaseForm(domesticForm, 'submitDomesticPO');
    });

    var importForm = document.getElementById('import-po-form');
    if (importForm) importForm.addEventListener('submit', function (event) {
        event.preventDefault();
        submitPurchaseForm(importForm, 'submitImportPO');
    });

    // Load Season / Category dropdown values the first time either form opens.
    if (domesticCard) domesticCard.addEventListener('click', fetchPurchaseDropdowns);
    if (importCard) importCard.addEventListener('click', fetchPurchaseDropdowns);

    // Live PO Number duplicate check: while typing (debounced) and on blur.
    // If the PO Number already exists, the rest of the form is locked so a
    // duplicate entry cannot be created (see validatePurchasePoNumber).
    ['domestic', 'import'].forEach(function (formType) {
        var form = document.getElementById(formType + '-po-form');
        var poInput = document.getElementById(formType + '-po-number');
        if (!form || !poInput) return;

        var debouncedCheck = debouncePurchasePoCheck(formType, 500);
        poInput.addEventListener('input', debouncedCheck);
        poInput.addEventListener('blur', function () { validatePurchasePoNumber(formType); });

        // Native form reset (the "Reset" button) clears field values but not
        // any disabled state / message this feature has applied — clear it
        // explicitly once the reset has taken effect.
        form.addEventListener('reset', function () {
            setTimeout(function () {
                setPurchaseOtherFieldsDisabled(form, poInput, false);
                setPurchasePoMsg(formType, '');
            }, 0);
        });
    });
}

function initOtLeave() {
    ['ot-details', 'leave-details', 'ot-leave-analysis'].forEach(function (type) {
        var config  = getOtLeaveConfig(type);
        var prefix  = config.prefix;
        var kpiId   = 'kpi-' + type;
        var kpiCard = document.getElementById(kpiId);
        if (kpiCard) {
            kpiCard.addEventListener('click', function () { showOtLeaveDetailView(type); });
            kpiCard.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOtLeaveDetailView(type); }
            });
        }

        var backBtn = document.getElementById('btn-back-' + prefix);
        if (backBtn) backBtn.addEventListener('click', function () { showOtLeaveKpiView(); });

        var excelBtn = document.getElementById('btn-download-' + prefix + '-excel');
        if (excelBtn) excelBtn.addEventListener('click', function () { downloadOtLeaveExcel(type); });

        var refreshBtn = document.getElementById('btn-refresh-' + prefix + '-data');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                var state = getOtLeaveState(type);
                state.allRows       = [];
                state.columnFilters = {};
                fetchOtLeaveData(type);
            });
        }

        var searchEl = document.getElementById(prefix + '-data-search');
        if (searchEl) {
            searchEl.addEventListener('input', function () {
                updateOtLeaveSearchClearBtn(type);
                applyOtLeaveSearch(type, searchEl.value);
            });
        }
        var clearSearch = document.getElementById(prefix + '-data-search-clear');
        if (clearSearch) {
            clearSearch.addEventListener('click', function () {
                var s = document.getElementById(prefix + '-data-search');
                if (s) { s.value = ''; s.focus(); }
                updateOtLeaveSearchClearBtn(type);
                applyOtLeaveSearch(type, '');
            });
        }

        var dateFrom = document.getElementById(prefix + '-date-from');
        if (dateFrom) {
            dateFrom.addEventListener('change', function () {
                getOtLeaveState(type).dateFrom = dateFrom.value;
                updateOtLeaveDateClearBtn(type);
                applyOtLeaveFilters(type);
            });
        }
        var dateTo = document.getElementById(prefix + '-date-to');
        if (dateTo) {
            dateTo.addEventListener('change', function () {
                getOtLeaveState(type).dateTo = dateTo.value;
                updateOtLeaveDateClearBtn(type);
                applyOtLeaveFilters(type);
            });
        }
        var dateClear = document.getElementById(prefix + '-date-clear');
        if (dateClear) {
            dateClear.addEventListener('click', function () {
                var state = getOtLeaveState(type);
                state.dateFrom = '';
                state.dateTo   = '';
                var f = document.getElementById(prefix + '-date-from');
                var t = document.getElementById(prefix + '-date-to');
                if (f) f.value = '';
                if (t) t.value = '';
                updateOtLeaveDateClearBtn(type);
                applyOtLeaveFilters(type);
            });
        }

        var pageSize = document.getElementById(prefix + '-data-page-size');
        if (pageSize) {
            pageSize.addEventListener('change', function () {
                var state = getOtLeaveState(type);
                state.pageSize = parseInt(pageSize.value, 10) || 25;
                state.page = 1;
                renderOtLeaveTable(type);
            });
        }
    });

    // Reset to the KPI card grid every time the "OT & Leave" sidebar item is
    // opened, same behaviour as Reports / Production Data / PDF. Added here
    // (rather than in app.js) as an extra listener on the existing nav item.
    document.querySelectorAll('.nav-item[data-page="ot-leave"]').forEach(function (item) {
        item.addEventListener('click', function () { showOtLeaveKpiView(); });
    });
}

// =============================================================================
// WAREHOUSE — Checking Details / Warehouse Received Details
// =============================================================================
// Like the OT & Leave sub-views above, this data lives in a SEPARATE Google
// Sheet powered by its own standalone Apps Script Web App (Warehouse.gs — see
// that file for setup instructions), so we talk to it with a plain fetch()
// call instead of the shared jsonp()/GAS_URL helper.
//
// After deploying Warehouse.gs as its own Web App, paste the resulting /exec
// URL below (it is already pre-filled with the URL supplied when this
// feature was built).
// =============================================================================

var WAREHOUSE_SECTION_URL = 'https://script.google.com/macros/s/AKfycbyfhDI6Yl4wI2N5n5IfaVuc6qu03VQdGIPtcjoGwfKQ_xpBKVlkaMw7PFnY0sZ8JWL5/exec';

// One config-driven implementation shared by both sub-views — same approach
// used above for the OT & Leave sub-views.
var warehouseSectionTableStates = {
    'checking-details': {
        headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true,
        page: 1, pageSize: 25, searchQuery: '', columnFilters: {}, dateFrom: '', dateTo: ''
    },
    'warehouse-received-details': {
        headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true,
        page: 1, pageSize: 25, searchQuery: '', columnFilters: {}, dateFrom: '', dateTo: ''
    }
};

function getWarehouseSectionState(type) { return warehouseSectionTableStates[type]; }

// `type` doubles as the DOM id prefix used throughout checking-details-view /
// warehouse-received-details-view in index.html.
function getWarehouseSectionConfig(type) {
    if (type === 'checking-details') {
        return {
            prefix: 'checking-details', viewId: 'checking-details-view', action: 'getCheckingDetailsData',
            label: 'Checking Details', emptyLabel: 'Checking Details',
            excelSheetName: 'Checking Details', excelFilePrefix: 'Checking_Details'
        };
    }
    return {
        prefix: 'warehouse-received-details', viewId: 'warehouse-received-details-view', action: 'getWarehouseReceivedDetailsData',
        label: 'Warehouse Received Details', emptyLabel: 'Warehouse Received Details',
        excelSheetName: 'Warehouse Received Details', excelFilePrefix: 'Warehouse_Received_Details'
    };
}

// Column A of the source sheet (index 0 of the loaded range) is assumed to
// be the date column for the "From/To" date-range filter, same convention
// used across the rest of the app.
function getWarehouseSectionDateColIndex() { return 0; }

function showWarehouseSectionKpiView() {
    var kpiView = document.getElementById('warehouse-section-kpi-view');
    if (kpiView) kpiView.style.display = '';
    ['checking-details', 'warehouse-received-details'].forEach(function (type) {
        var view = document.getElementById(getWarehouseSectionConfig(type).viewId);
        if (view) view.style.display = 'none';
    });
    applyKpiCardAccess();
}

function showWarehouseSectionDetailView(type) {
    var config  = getWarehouseSectionConfig(type);
    var kpiView = document.getElementById('warehouse-section-kpi-view');
    var view    = document.getElementById(config.viewId);
    if (kpiView) kpiView.style.display = 'none';
    ['checking-details', 'warehouse-received-details'].forEach(function (t) {
        var v = document.getElementById(getWarehouseSectionConfig(t).viewId);
        if (v) v.style.display = (t === type) ? '' : 'none';
    });
    if (view) view.style.display = '';

    var state = getWarehouseSectionState(type);
    if (state.allRows.length === 0) {
        fetchWarehouseSectionData(type);
    } else {
        renderWarehouseSectionTable(type);
    }
}

function fetchWarehouseSectionData(type) {
    var config   = getWarehouseSectionConfig(type);
    var prefix   = config.prefix;
    var emptyEl  = document.getElementById(prefix + '-data-empty');
    var tableEl  = document.getElementById(prefix + '-data-table');
    var footerEl = document.getElementById(prefix + '-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data…'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching ' + config.label + ' data…');

    fetch(WAREHOUSE_SECTION_URL + '?action=' + encodeURIComponent(config.action) + '&_=' + Date.now())
        .then(function (response) {
            if (!response.ok) throw new Error('The Warehouse server returned HTTP ' + response.status + '.');
            return response.json();
        })
        .then(function (result) {
            hideSpinner();
            if (!result || !result.success) throw new Error((result && result.error) || 'Could not load data.');
            if (!Array.isArray(result.headers) || !Array.isArray(result.rows)) {
                throw new Error('The Warehouse web app needs to be redeployed with the latest Warehouse.gs code.');
            }
            onWarehouseSectionDataLoaded(type, result);
        })
        .catch(function (err) {
            hideSpinner();
            onWarehouseSectionDataError(type, err.message || 'Could not load data.');
        });
}

function onWarehouseSectionDataLoaded(type, result) {
    var config = getWarehouseSectionConfig(type);
    var prefix = config.prefix;
    var state  = getWarehouseSectionState(type);

    state.headers       = result.headers || [];
    state.allRows       = result.rows    || [];
    state.filteredRows  = state.allRows.slice();
    state.sortCol       = -1;
    state.sortAsc       = true;
    state.page          = 1;
    state.searchQuery    = '';
    state.columnFilters = {};
    state.dateFrom       = '';
    state.dateTo         = '';

    var searchEl = document.getElementById(prefix + '-data-search');
    if (searchEl) searchEl.value = '';
    updateWarehouseSectionSearchClearBtn(type);

    var dFrom = document.getElementById(prefix + '-date-from');
    var dTo   = document.getElementById(prefix + '-date-to');
    if (dFrom) dFrom.value = '';
    if (dTo)   dTo.value   = '';
    updateWarehouseSectionDateClearBtn(type);

    var labelEl = document.getElementById(prefix + '-date-col-label');
    if (labelEl && state.headers[getWarehouseSectionDateColIndex()]) {
        labelEl.textContent = state.headers[getWarehouseSectionDateColIndex()];
    }

    buildWarehouseSectionTableHeaders(type);
    renderWarehouseSectionTable(type);
}

function onWarehouseSectionDataError(type, msg) {
    var config  = getWarehouseSectionConfig(type);
    var prefix  = config.prefix;
    var emptyEl = document.getElementById(prefix + '-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById(prefix + '-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById(prefix + '-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', config.label + ' Data Error', msg);
}

function buildWarehouseSectionTableHeaders(type) {
    var config = getWarehouseSectionConfig(type);
    var prefix = config.prefix;
    var state  = getWarehouseSectionState(type);
    var thead  = document.getElementById(prefix + '-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    state.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-' + prefix + '-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onWarehouseSectionSortColumn(type, i); });
        trHead.appendChild(th);
    });

    var trFilter    = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);
    state.headers.forEach(function (h, i) {
        var th   = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type        = 'text';
        input.className   = 'dt-col-filter';
        input.placeholder = 'Filter…';
        input.value       = state.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className     = 'dt-col-filter-clear';
        clearBtn.title         = 'Clear filter';
        clearBtn.innerHTML     = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            state.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyWarehouseSectionFilters(type);
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            state.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyWarehouseSectionFilters(type);
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onWarehouseSectionSortColumn(type, colIndex) {
    var state = getWarehouseSectionState(type);
    if (state.sortCol === colIndex) {
        state.sortAsc = !state.sortAsc;
    } else {
        state.sortCol = colIndex;
        state.sortAsc = true;
    }
    updateWarehouseSectionSortIcons(type);
    applyWarehouseSectionFilters(type);
}

function updateWarehouseSectionSortIcons(type) {
    var config = getWarehouseSectionConfig(type);
    var state  = getWarehouseSectionState(type);
    document.querySelectorAll('[data-' + config.prefix + '-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-' + config.prefix + '-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === state.sortCol) {
            icon.textContent = state.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function updateWarehouseSectionDateClearBtn(type) {
    var config   = getWarehouseSectionConfig(type);
    var state    = getWarehouseSectionState(type);
    var clearBtn = document.getElementById(config.prefix + '-date-clear');
    if (!clearBtn) return;
    clearBtn.style.display = (state.dateFrom || state.dateTo) ? '' : 'none';
}

function updateWarehouseSectionSearchClearBtn(type) {
    var config   = getWarehouseSectionConfig(type);
    var searchEl = document.getElementById(config.prefix + '-data-search');
    var clearBtn = document.getElementById(config.prefix + '-data-search-clear');
    if (!searchEl || !clearBtn) return;
    clearBtn.style.display = searchEl.value ? '' : 'none';
}

function applyWarehouseSectionFilters(type) {
    var state      = getWarehouseSectionState(type);
    var query      = state.searchQuery;
    var colFilters = state.columnFilters;
    var dateColIdx = getWarehouseSectionDateColIndex();

    var dateFrom = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00') : null;
    var dateTo   = state.dateTo   ? new Date(state.dateTo   + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    state.filteredRows = state.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0) {
            var rawDate = row[dateColIdx];
            var parsed  = parseCreatedAt(rawDate);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (state.sortCol >= 0) {
        var sc = state.sortCol;
        state.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return state.sortAsc ? cmp : -cmp;
        });
    }
    state.page = 1;
    renderWarehouseSectionTable(type);
}

function applyWarehouseSectionSearch(type, query) {
    var state = getWarehouseSectionState(type);
    state.searchQuery = (query || '').trim().toLowerCase();
    applyWarehouseSectionFilters(type);
}

function renderWarehouseSectionTable(type) {
    var config = getWarehouseSectionConfig(type);
    var prefix = config.prefix;
    var state  = getWarehouseSectionState(type);

    var tbody      = document.getElementById(prefix + '-data-tbody');
    var tableEl    = document.getElementById(prefix + '-data-table');
    var emptyEl    = document.getElementById(prefix + '-data-empty');
    var footerEl   = document.getElementById(prefix + '-data-footer');
    var countBadge = document.getElementById(prefix + '-data-count-badge');
    if (!tbody) return;

    var total      = state.filteredRows.length;
    var pageSize   = state.pageSize;
    var page       = state.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = state.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', state.headers.length + 1);
        var hasFilter = Object.keys(state.columnFilters).some(function (k) {
            return (state.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = state.dateFrom || state.dateTo;
        tdEmpty.innerHTML = '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (state.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (state.allRows.length === 0 ? 'No data found in ' + config.emptyLabel + '.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById(prefix + '-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        state.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (state.searchQuery && cellVal.toLowerCase().indexOf(state.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(state.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById(prefix + '-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (state.allRows.length !== total ? ' (filtered from ' + state.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildWarehouseSectionPagination(type, page, totalPages);
}

function buildWarehouseSectionPagination(type, current, total) {
    var config    = getWarehouseSectionConfig(type);
    var state     = getWarehouseSectionState(type);
    var container = document.getElementById(config.prefix + '-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                state.page = page;
                renderWarehouseSectionTable(type);
                var wrap = document.getElementById(config.prefix + '-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '…' || item === '...') {
            var el = document.createElement('span');
            el.className   = 'dt-page-ellipsis';
            el.textContent = '…';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadWarehouseSectionExcel(type) {
    var config  = getWarehouseSectionConfig(type);
    var state   = getWarehouseSectionState(type);
    exportRowsToXlsx({
        headers: state.headers,
        rows: state.filteredRows,
        sheetName: config.excelSheetName,
        filenamePrefix: config.excelFilePrefix
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function initWarehouseSection() {
    ['checking-details', 'warehouse-received-details'].forEach(function (type) {
        var config  = getWarehouseSectionConfig(type);
        var prefix  = config.prefix;
        var kpiId   = 'kpi-' + type;
        var kpiCard = document.getElementById(kpiId);
        if (kpiCard) {
            kpiCard.addEventListener('click', function () { showWarehouseSectionDetailView(type); });
            kpiCard.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showWarehouseSectionDetailView(type); }
            });
        }

        var backBtn = document.getElementById('btn-back-' + prefix);
        if (backBtn) backBtn.addEventListener('click', function () { showWarehouseSectionKpiView(); });

        var excelBtn = document.getElementById('btn-download-' + prefix + '-excel');
        if (excelBtn) excelBtn.addEventListener('click', function () { downloadWarehouseSectionExcel(type); });

        var refreshBtn = document.getElementById('btn-refresh-' + prefix + '-data');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                var state = getWarehouseSectionState(type);
                state.allRows       = [];
                state.columnFilters = {};
                fetchWarehouseSectionData(type);
            });
        }

        var searchEl = document.getElementById(prefix + '-data-search');
        if (searchEl) {
            searchEl.addEventListener('input', function () {
                updateWarehouseSectionSearchClearBtn(type);
                applyWarehouseSectionSearch(type, searchEl.value);
            });
        }
        var clearSearch = document.getElementById(prefix + '-data-search-clear');
        if (clearSearch) {
            clearSearch.addEventListener('click', function () {
                var s = document.getElementById(prefix + '-data-search');
                if (s) { s.value = ''; s.focus(); }
                updateWarehouseSectionSearchClearBtn(type);
                applyWarehouseSectionSearch(type, '');
            });
        }

        var dateFrom = document.getElementById(prefix + '-date-from');
        if (dateFrom) {
            dateFrom.addEventListener('change', function () {
                getWarehouseSectionState(type).dateFrom = dateFrom.value;
                updateWarehouseSectionDateClearBtn(type);
                applyWarehouseSectionFilters(type);
            });
        }
        var dateTo = document.getElementById(prefix + '-date-to');
        if (dateTo) {
            dateTo.addEventListener('change', function () {
                getWarehouseSectionState(type).dateTo = dateTo.value;
                updateWarehouseSectionDateClearBtn(type);
                applyWarehouseSectionFilters(type);
            });
        }
        var dateClear = document.getElementById(prefix + '-date-clear');
        if (dateClear) {
            dateClear.addEventListener('click', function () {
                var state = getWarehouseSectionState(type);
                state.dateFrom = '';
                state.dateTo   = '';
                var f = document.getElementById(prefix + '-date-from');
                var t = document.getElementById(prefix + '-date-to');
                if (f) f.value = '';
                if (t) t.value = '';
                updateWarehouseSectionDateClearBtn(type);
                applyWarehouseSectionFilters(type);
            });
        }

        var pageSize = document.getElementById(prefix + '-data-page-size');
        if (pageSize) {
            pageSize.addEventListener('change', function () {
                var state = getWarehouseSectionState(type);
                state.pageSize = parseInt(pageSize.value, 10) || 25;
                state.page = 1;
                renderWarehouseSectionTable(type);
            });
        }
    });

    // Reset to the KPI card grid every time the "Warehouse" sidebar item is
    // opened, same behaviour as Reports / Production Data / OT & Leave.
    // Added here (rather than in app.js) as an extra listener on the
    // existing nav item.
    document.querySelectorAll('.nav-item[data-page="warehouse"]').forEach(function (item) {
        item.addEventListener('click', function () { showWarehouseSectionKpiView(); });
    });
}

// =============================================================================
// MACHINE — Die-Less Knife Cutting Machine Details
// =============================================================================
var DIE_LESS_URL = 'https://script.google.com/macros/s/AKfycbxhrqvWSNWT62dk_nfAavlXAXYVIwM2qX4KSaLnP-mWyt98dAYgD-NpOuUEFn2jHyI/exec';
var MACHINE_URL  = 'https://script.google.com/macros/s/AKfycbxaXHeja3YObxODcH_vaYVnRwcg0XruJSFgbnPzq52-ZZ66DMfT3tW2VKlgLcTyNFTN/exec';
var dieLessConfigs = {
    'machine-data': { url: DIE_LESS_URL, script: 'DieLess.gs', action: 'getMachineData', label: 'Machine Data', sheet: 'Machine Data', file: 'Machine_Data' },
    'monthly-machine-inactivity-data': { url: DIE_LESS_URL, script: 'DieLess.gs', action: 'getMonthlyMachineInactivityData', label: 'Monthly Machine Inactivity (Data)', sheet: 'Monthly Machine Inactivity', file: 'Monthly_Machine_Inactivity_Data' },
    'machine-repairing-details': { url: MACHINE_URL, script: 'Machine.gs', action: 'getMachineRepairingDetails', label: 'Machine & Repairing Details', sheet: 'Machine Details', file: 'Machine_And_Repairing_Details' }
};
// Conditional row coloring for "Machine & Repairing Details" is driven by
// the column labelled SERVICE TYPE. Resolve it from the returned header so
// the coloring stays correct even if the sheet columns are rearranged.
var MACHINE_SERVICE_TYPE_HEADER = 'service type';
var MACHINE_ROW_COLOR_MAP = {
    'major problem':   'dt-tr-machine-major-problem',
    'minor problem':   'dt-tr-machine-minor-problem',
    'as usual repair': 'dt-tr-machine-usual-repair',
    'audit purpose':   'dt-tr-machine-audit-purpose',
    'breakdown':        'dt-tr-machine-breakdown',
    'install':          'dt-tr-machine-install',
    'preventive':       'dt-tr-machine-preventive'
};

var dieLessStates = {};
Object.keys(dieLessConfigs).forEach(function (type) { dieLessStates[type] = { headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true, page: 1, pageSize: 25, search: '', filters: {}, dateFrom: '', dateTo: '' }; });

function dieLessFetch(type) {
    var cfg = dieLessConfigs[type], state = dieLessStates[type], p = type + '-data', empty = document.getElementById(p + '-empty');
    if (empty) { empty.querySelector('p').textContent = 'Loading data…'; empty.style.display = ''; }
    document.getElementById(p + '-table').style.display = 'none'; document.getElementById(p + '-footer').style.display = 'none'; showSpinner('Fetching ' + cfg.label + '…');
    fetch(cfg.url + '?action=' + encodeURIComponent(cfg.action) + '&_=' + Date.now()).then(function (r) { if (!r.ok) throw new Error('The Machine server returned HTTP ' + r.status + '.'); return r.json(); }).then(function (result) {
        hideSpinner(); if (!result || !result.success || !Array.isArray(result.headers) || !Array.isArray(result.rows)) throw new Error((result && result.error) || 'Redeploy the ' + (cfg.script || 'Apps Script') + ' web app, then try again.');
        state.headers = result.headers; state.allRows = result.rows; state.filteredRows = result.rows.slice(); state.sortCol = -1; state.sortAsc = true; state.page = 1; state.search = ''; state.filters = {}; state.dateFrom = ''; state.dateTo = '';
        document.getElementById(p + '-search').value = ''; document.getElementById(type + '-date-from').value = ''; document.getElementById(type + '-date-to').value = '';
        var label = document.getElementById(type + '-date-col-label'); if (label && state.headers[0]) label.textContent = state.headers[0]; dieLessBuildHeaders(type); dieLessRender(type);
    }).catch(function (err) { hideSpinner(); if (empty) { empty.querySelector('p').textContent = 'Error: ' + err.message; empty.style.display = ''; } showToast('error', cfg.label + ' Data Error', err.message); });
}

function dieLessBuildHeaders(type) {
    var state = dieLessStates[type], p = type + '-data', thead = document.getElementById(p + '-thead'); thead.innerHTML = '';
    var filters = document.createElement('tr'); filters.className = 'dt-filter-row'; filters.innerHTML = '<th class="dt-filter-cell dt-filter-cell-num"></th>';
    var headings = document.createElement('tr'), number = document.createElement('th'); number.className = 'dt-th dt-th-num'; number.textContent = '#'; headings.appendChild(number);
    state.headers.forEach(function (header, i) {
        var fc = document.createElement('th'), input = document.createElement('input'); fc.className = 'dt-filter-cell'; input.className = 'dt-col-filter'; input.placeholder = 'Filter…'; input.addEventListener('input', function () { state.filters[i] = input.value; dieLessApply(type); }); fc.appendChild(input); filters.appendChild(fc);
        var th = document.createElement('th'); th.className = 'dt-th dt-th-sortable'; th.innerHTML = esc(header) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>'; th.addEventListener('click', function () { state.sortAsc = state.sortCol === i ? !state.sortAsc : true; state.sortCol = i; dieLessApply(type); }); headings.appendChild(th);
    }); thead.appendChild(filters); thead.appendChild(headings);
}

function dieLessApply(type) {
    var state = dieLessStates[type], from = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00') : null, to = state.dateTo ? new Date(state.dateTo + 'T23:59:59') : null;
    state.filteredRows = state.allRows.filter(function (row) {
        if (state.search && !row.some(function (cell) { return String(cell).toLowerCase().indexOf(state.search) !== -1; })) return false;
        if (!Object.keys(state.filters).every(function (key) { var f = String(state.filters[key] || '').trim().toLowerCase(); return !f || String(row[key] || '').toLowerCase().indexOf(f) !== -1; })) return false;
        if (from || to) { var d = parseCreatedAt(row[0]); if (!d || (from && d < from) || (to && d > to)) return false; } return true;
    });
    if (state.sortCol >= 0) state.filteredRows.sort(function (a, b) { var av = String(a[state.sortCol] || ''), bv = String(b[state.sortCol] || ''), an = parseFloat(av), bn = parseFloat(bv), c = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv); return state.sortAsc ? c : -c; }); state.page = 1; dieLessRender(type);
}

function dieLessRender(type) {
    var state = dieLessStates[type], p = type + '-data', tbody = document.getElementById(p + '-tbody'), total = state.filteredRows.length, pages = Math.max(1, Math.ceil(total / state.pageSize)); state.page = Math.min(state.page, pages); var start = (state.page - 1) * state.pageSize, end = Math.min(start + state.pageSize, total);
    tbody.innerHTML = ''; document.getElementById(p + '-table').style.display = ''; document.getElementById(p + '-empty').style.display = 'none'; document.getElementById(p + '-footer').style.display = total ? '' : 'none';
    if (!total) { var emptyRow = document.createElement('tr'), emptyCell = document.createElement('td'); emptyCell.className = 'dt-td-empty-msg'; emptyCell.colSpan = state.headers.length + 1; emptyCell.textContent = state.allRows.length ? 'No records match the current filter.' : 'No data found in ' + dieLessConfigs[type].label + '.'; emptyRow.appendChild(emptyCell); tbody.appendChild(emptyRow); }
    var machineServiceTypeIndex = type === 'machine-repairing-details' ? state.headers.map(function (header) { return String(header || '').trim().toLowerCase(); }).indexOf(MACHINE_SERVICE_TYPE_HEADER) : -1;
    state.filteredRows.slice(start, end).forEach(function (row, ri) { var tr = document.createElement('tr'), n = document.createElement('td'); tr.className = (start + ri) % 2 ? 'dt-tr-odd' : 'dt-tr-even'; if (type === 'monthly-machine-inactivity-data') { var statusVisibleColumn = 5, statusDataIndex = statusVisibleColumn - 2; /* subtract 1 for the # column and 1 for zero-based data indexes */ var statusVal = String(row[statusDataIndex] === undefined || row[statusDataIndex] === null ? '' : row[statusDataIndex]).trim().toLowerCase(); if (statusVal === 'week off') tr.className += ' dt-tr-flag-green'; else if (statusVal === 'inactive') tr.className += ' dt-tr-flag-red'; } else if (type === 'machine-data') { var col4VisibleColumn = 4, col4DataIndex = col4VisibleColumn - 2; /* subtract 1 for the # column and 1 for zero-based data indexes */ var col4Val = String(row[col4DataIndex] === undefined || row[col4DataIndex] === null ? '' : row[col4DataIndex]); if (col4Val.toLowerCase().indexOf('machine') !== -1) tr.className += ' dt-tr-flag-red'; } else if (type === 'machine-repairing-details' && machineServiceTypeIndex >= 0) { var machineStatusVal = String(row[machineServiceTypeIndex] === undefined || row[machineServiceTypeIndex] === null ? '' : row[machineServiceTypeIndex]).trim().toLowerCase(); var machineColorClass = MACHINE_ROW_COLOR_MAP[machineStatusVal]; if (machineColorClass) tr.className += ' ' + machineColorClass; } n.className = 'dt-td dt-td-num'; n.textContent = start + ri + 1; tr.appendChild(n); state.headers.forEach(function (_, ci) { var td = document.createElement('td'); td.className = 'dt-td'; td.textContent = row[ci] === undefined ? '' : row[ci]; tr.appendChild(td); }); tbody.appendChild(tr); });
    document.getElementById(p + '-count-badge').textContent = total + ' record' + (total === 1 ? '' : 's'); document.getElementById(p + '-info').textContent = total ? 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total + ' entries' : 'Showing 0 entries';
    var pager = document.getElementById(p + '-pagination'); pager.innerHTML = '';
    function addPageButton(label, page, disabled, active, icon) { var b = document.createElement('button'); b.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : ''); b.disabled = disabled; b.innerHTML = icon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label; if (!disabled) b.addEventListener('click', function () { state.page = page; dieLessRender(type); var wrap = document.getElementById(p + '-table-wrap'); if (wrap) wrap.scrollTop = 0; }); pager.appendChild(b); }
    addPageButton('first_page', 1, state.page <= 1, false, true); addPageButton('chevron_left', state.page - 1, state.page <= 1, false, true);
    paginationRange(state.page, pages).forEach(function (item) { if (item === '…' || item === '...') { var ellipsis = document.createElement('span'); ellipsis.className = 'dt-page-ellipsis'; ellipsis.textContent = '…'; pager.appendChild(ellipsis); return; } addPageButton(item, item, false, item === state.page, false); });
    addPageButton('chevron_right', state.page + 1, state.page >= pages, false, true); addPageButton('last_page', pages, state.page >= pages, false, true);
}

function initDieLessData() {
    Object.keys(dieLessConfigs).forEach(function (type) { var p = type + '-data', state = dieLessStates[type];
        document.getElementById('btn-refresh-' + p).addEventListener('click', function () { state.allRows = []; dieLessFetch(type); }); document.getElementById('btn-download-' + type + '-excel').addEventListener('click', function () {
            // Mirrors the on-screen conditional row coloring in dieLessRender()
            // above, so the exported .xlsx matches what's shown on screen.
            var machineServiceTypeIndex = type === 'machine-repairing-details' ? state.headers.map(function (header) { return String(header || '').trim().toLowerCase(); }).indexOf(MACHINE_SERVICE_TYPE_HEADER) : -1;
            exportRowsToXlsx({
                headers: state.headers,
                rows: state.filteredRows,
                sheetName: dieLessConfigs[type].sheet,
                filenamePrefix: dieLessConfigs[type].file,
                rowColor: function (row) {
                    if (type === 'monthly-machine-inactivity-data') {
                        var statusDataIndex = 3; // visible column 5 minus 2 (see dieLessRender)
                        var statusVal = String(row[statusDataIndex] === undefined || row[statusDataIndex] === null ? '' : row[statusDataIndex]).trim().toLowerCase();
                        if (statusVal === 'week off') return excelRowColor_('flag-green');
                        if (statusVal === 'inactive') return excelRowColor_('flag-red');
                    } else if (type === 'machine-data') {
                        var col4DataIndex = 2; // visible column 4 minus 2 (see dieLessRender)
                        var col4Val = String(row[col4DataIndex] === undefined || row[col4DataIndex] === null ? '' : row[col4DataIndex]);
                        if (col4Val.toLowerCase().indexOf('machine') !== -1) return excelRowColor_('flag-red');
                    } else if (type === 'machine-repairing-details' && machineServiceTypeIndex >= 0) {
                        var machineStatusVal = String(row[machineServiceTypeIndex] === undefined || row[machineServiceTypeIndex] === null ? '' : row[machineServiceTypeIndex]).trim().toLowerCase();
                        var machineColorClass = MACHINE_ROW_COLOR_MAP[machineStatusVal];
                        if (machineColorClass) return excelRowColor_(machineColorClass.replace(/^dt-tr-/, ''));
                    }
                    return null;
                }
            });
        });
        var search = document.getElementById(p + '-search'); search.addEventListener('input', function () { state.search = search.value.trim().toLowerCase(); dieLessApply(type); }); document.getElementById(p + '-search-clear').addEventListener('click', function () { search.value = ''; state.search = ''; dieLessApply(type); });
        ['from', 'to'].forEach(function (side) { var input = document.getElementById(type + '-date-' + side); input.addEventListener('change', function () { state[side === 'from' ? 'dateFrom' : 'dateTo'] = input.value; dieLessApply(type); }); }); document.getElementById(type + '-date-clear').addEventListener('click', function () { state.dateFrom = ''; state.dateTo = ''; document.getElementById(type + '-date-from').value = ''; document.getElementById(type + '-date-to').value = ''; dieLessApply(type); }); document.getElementById(p + '-page-size').addEventListener('change', function (e) { state.pageSize = parseInt(e.target.value, 10) || 25; state.page = 1; dieLessRender(type); });
    });
}

function showMachineKpiView() {
    var kpiView = document.getElementById('machine-kpi-view');
    if (kpiView) kpiView.style.display = '';
    var parentView = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (parentView) parentView.style.display = 'none';
    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (type) {
        var detailView = document.getElementById(type + '-view');
        if (detailView) detailView.style.display = 'none';
    });
    var repairView = document.getElementById('machine-repairing-details-view');
    if (repairView) repairView.style.display = 'none';
    applyKpiCardAccess();
}

function showDieLessKnifeCuttingMachineDetailsView() {
    var kpiView = document.getElementById('machine-kpi-view');
    var parentView = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (kpiView) kpiView.style.display = 'none';
    if (parentView) parentView.style.display = '';
    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (type) {
        var detailView = document.getElementById(type + '-view');
        if (detailView) detailView.style.display = 'none';
    });
    var repairView = document.getElementById('machine-repairing-details-view');
    if (repairView) repairView.style.display = 'none';
    applyKpiCardAccess();
}

function showMachineDetailView(type) {
    var kpiView = document.getElementById('machine-kpi-view');
    var parentView = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (kpiView) kpiView.style.display = 'none';
    if (parentView) parentView.style.display = 'none';
    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (viewType) {
        var detailView = document.getElementById(viewType + '-view');
        if (detailView) detailView.style.display = viewType === type ? '' : 'none';
    });
    var repairView = document.getElementById('machine-repairing-details-view');
    if (repairView) repairView.style.display = 'none';
    if (dieLessStates[type].allRows.length === 0) dieLessFetch(type);
    else dieLessRender(type);
}

function showMachineRepairingDetailsView() {
    var kpiView = document.getElementById('machine-kpi-view');
    if (kpiView) kpiView.style.display = 'none';
    var parentView = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (parentView) parentView.style.display = 'none';
    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (type) {
        var detailView = document.getElementById(type + '-view');
        if (detailView) detailView.style.display = 'none';
    });
    var repairView = document.getElementById('machine-repairing-details-view');
    if (repairView) repairView.style.display = '';
    var type = 'machine-repairing-details';
    if (dieLessStates[type].allRows.length === 0) dieLessFetch(type);
    else dieLessRender(type);
}

function initMachineSection() {
    var parentCard = document.getElementById('kpi-die-less-knife-cutting-machine-details');
    if (parentCard) {
        parentCard.addEventListener('click', showDieLessKnifeCuttingMachineDetailsView);
        parentCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showDieLessKnifeCuttingMachineDetailsView();
            }
        });
    }

    var parentBackButton = document.getElementById('btn-back-die-less-knife-cutting-machine-details');
    if (parentBackButton) parentBackButton.addEventListener('click', showMachineKpiView);

    ['machine-data', 'monthly-machine-inactivity-data'].forEach(function (type) {
        var card = document.getElementById('kpi-' + type);
        if (card) {
            card.addEventListener('click', function () { showMachineDetailView(type); });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showMachineDetailView(type);
                }
            });
        }

        var backButton = document.getElementById('btn-back-' + type);
        if (backButton) backButton.addEventListener('click', showDieLessKnifeCuttingMachineDetailsView);
    });

    var repairCard = document.getElementById('kpi-machine-repairing-details');
    if (repairCard) {
        repairCard.addEventListener('click', showMachineRepairingDetailsView);
        repairCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showMachineRepairingDetailsView();
            }
        });
    }

    var repairBackButton = document.getElementById('btn-back-machine-repairing-details');
    if (repairBackButton) repairBackButton.addEventListener('click', showMachineKpiView);

    document.querySelectorAll('.nav-item[data-page="machine"]').forEach(function (item) {
        item.addEventListener('click', showMachineKpiView);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEndLineQc);
    document.addEventListener('DOMContentLoaded', initPostAql);
    document.addEventListener('DOMContentLoaded', initWarehouseFms);
    document.addEventListener('DOMContentLoaded', initShipment);
    document.addEventListener('DOMContentLoaded', initFollowUpPlanned);
    document.addEventListener('DOMContentLoaded', initOtLeave);
    document.addEventListener('DOMContentLoaded', initWarehouseSection);
    document.addEventListener('DOMContentLoaded', initMachineSection);
    document.addEventListener('DOMContentLoaded', initDieLessData);
    document.addEventListener('DOMContentLoaded', initPurchase);
} else {
    initEndLineQc();
    initPostAql();
    initWarehouseFms();
    initShipment();
    initFollowUpPlanned();
    initOtLeave();
    initWarehouseSection();
    initMachineSection();
    initDieLessData();
    initPurchase();
}

})();
