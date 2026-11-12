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
    'batch-list-fms-production-view',
    'batch-list-edge-paint-view',
    'batch-list-pre-aql-view',
    'batch-list-endline-qc-view',
    'batch-list-post-aql-view',
    'batch-list-warehouse-fms-view',
    'batch-list-shipment-view',
    'batch-list-followup-planned-view',
    'batch-list-product-input-tracking-view',
    'batch-list-pms-view'
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
    if (window.WarehouseFmsSheetEngine && typeof window.WarehouseFmsSheetEngine.show === 'function') {
        window.WarehouseFmsSheetEngine.show();
    } else {
        var view = document.getElementById('batch-list-warehouse-fms-view');
        if (view) view.style.display = '';
        if (warehouseFmsTableData.allRows.length === 0) {
            fetchWarehouseFmsDetailsAndRender();
        } else {
            renderWarehouseFmsTable();
        }
    }
}

function backToBatchListKpiViewFromWarehouseFms() {
    if (window.WarehouseFmsSheetEngine && typeof window.WarehouseFmsSheetEngine.hide === 'function') {
        window.WarehouseFmsSheetEngine.hide();
        return;
    }
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
    if (window.FollowUpPlannedSheetEngine && typeof window.FollowUpPlannedSheetEngine.show === 'function') {
        window.FollowUpPlannedSheetEngine.show();
    }
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
            if (window.FollowUpPlannedSheetEngine && typeof window.FollowUpPlannedSheetEngine.sync === 'function') {
                window.FollowUpPlannedSheetEngine.sync(true);
                return;
            }
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
    if (window.AdditionalWorkSheetEngine && typeof window.AdditionalWorkSheetEngine.clearSelection === 'function') {
        window.AdditionalWorkSheetEngine.clearSelection();
    }
    if (window.LeaveDetailsSheetEngine && typeof window.LeaveDetailsSheetEngine.clearSelection === 'function') {
        window.LeaveDetailsSheetEngine.clearSelection();
    }
    if (window.OtLeaveAnalysisSheetEngine && typeof window.OtLeaveAnalysisSheetEngine.clearSelection === 'function') {
        window.OtLeaveAnalysisSheetEngine.clearSelection();
    }
    applyKpiCardAccess();
}

function showOtLeaveDetailView(type) {
    if (type === 'ot-details' && window.AdditionalWorkSheetEngine) {
        window.AdditionalWorkSheetEngine.show();
        return;
    }
    if (type === 'leave-details' && window.LeaveDetailsSheetEngine) {
        window.LeaveDetailsSheetEngine.show();
        return;
    }
    if (type === 'ot-leave-analysis' && window.OtLeaveAnalysisSheetEngine) {
        window.OtLeaveAnalysisSheetEngine.show();
        return;
    }
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
    if (typeof window.currentSubmitter === 'function') {
        var u = window.currentSubmitter();
        if (u && u !== 'User') return u;
    }
    try {
        var fromSession = sessionStorage.getItem('fms_user');
        if (fromSession && fromSession.trim()) return fromSession.trim();
        var fromLocal = localStorage.getItem('fms_user');
        if (fromLocal && fromLocal.trim()) return fromLocal.trim();
        var topbarEl = document.getElementById('topbar-username') || document.getElementById('topbar-user-name');
        if (topbarEl && topbarEl.textContent && topbarEl.textContent.trim() && topbarEl.textContent.trim() !== 'User') {
            return topbarEl.textContent.trim();
        }
    } catch (e) {}
    return 'User';
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

// =============================================================================
// Purchase Fast Engine: IndexedDB Dropdowns & 0.05s Instant Submissions
// Database: IndexedDB 'FMS_Purchase_Fast_DB'
// - Instant 0-wait local loading on page open/refresh via IndexedDB & localStorage
// - 0.05-second instant optimistic form submission (immediate UI reset & tactile feedback)
// - Silent background sync worker with retry and offline outbox queue
// =============================================================================
var PURCHASE_IDB_NAME = 'FMS_Purchase_Fast_DB';
var PURCHASE_IDB_VERSION = 3; // Bumped to 3 to ensure user last submissions store exists
var PURCHASE_IDB_STORE_DROPDOWNS = 'dropdowns';
var PURCHASE_IDB_STORE_QUEUE = 'submission_queue';
var PURCHASE_IDB_STORE_KNOWN_POS = 'known_pos';
var PURCHASE_IDB_STORE_USER_LAST = 'user_last_submissions';

var PURCHASE_LS_KEY = 'fms_purchase_dropdowns_cache';
var PURCHASE_QUEUE_LS_KEY = 'fms_purchase_pending_queue';
var PURCHASE_KNOWN_POS_KEY = 'fms_purchase_known_pos';
var PURCHASE_USER_LAST_LS_PREFIX = 'fms_last_po_sub_';
var PURCHASE_REVIEW_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes validity

var DEFAULT_PURCHASE_DROPDOWNS = {
    seasons: ['/25-26', '/26-27', '/27-28'],
    categories: ['Lining', 'Leather', 'Non-Leather', 'Outer Fabrics']
};

function openPurchaseIdb() {
    return new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
            return reject(new Error('IndexedDB not supported in this browser.'));
        }
        var req = indexedDB.open(PURCHASE_IDB_NAME, PURCHASE_IDB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(PURCHASE_IDB_STORE_DROPDOWNS)) {
                db.createObjectStore(PURCHASE_IDB_STORE_DROPDOWNS);
            }
            if (!db.objectStoreNames.contains(PURCHASE_IDB_STORE_QUEUE)) {
                db.createObjectStore(PURCHASE_IDB_STORE_QUEUE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(PURCHASE_IDB_STORE_KNOWN_POS)) {
                db.createObjectStore(PURCHASE_IDB_STORE_KNOWN_POS, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(PURCHASE_IDB_STORE_USER_LAST)) {
                db.createObjectStore(PURCHASE_IDB_STORE_USER_LAST, { keyPath: 'key' });
            }
        };
        req.onsuccess = function (e) {
            resolve(e.target.result);
        };
        req.onerror = function (e) {
            reject(e.target.error || new Error('Failed to open IndexedDB ' + PURCHASE_IDB_NAME));
        };
    });
}

// ---------------------------------------------------------------------------
// Dropdowns Engine: IndexedDB Cache + Background Revalidation
// ---------------------------------------------------------------------------
function getPurchaseDropdownsFromIdb() {
    return openPurchaseIdb().then(function (db) {
        return new Promise(function (resolve, reject) {
            try {
                var tx = db.transaction(PURCHASE_IDB_STORE_DROPDOWNS, 'readonly');
                var store = tx.objectStore(PURCHASE_IDB_STORE_DROPDOWNS);
                var req = store.get('purchase_dropdowns');
                req.onsuccess = function () {
                    resolve(req.result || null);
                };
                req.onerror = function (e) {
                    reject(e.target.error || new Error('Failed to read from IndexedDB'));
                };
            } catch (err) {
                reject(err);
            }
        });
    });
}

function savePurchaseDropdownsToIdb(data) {
    if (!data) return Promise.resolve();

    // 1. Instant sync to localStorage
    try {
        localStorage.setItem(PURCHASE_LS_KEY, JSON.stringify(data));
    } catch (e) {}

    // 2. Persistent save to IndexedDB
    return openPurchaseIdb().then(function (db) {
        return new Promise(function (resolve, reject) {
            try {
                var tx = db.transaction(PURCHASE_IDB_STORE_DROPDOWNS, 'readwrite');
                var store = tx.objectStore(PURCHASE_IDB_STORE_DROPDOWNS);
                store.put(data, 'purchase_dropdowns');
                tx.oncomplete = function () {
                    resolve(true);
                };
                tx.onerror = function (e) {
                    reject(e.target.error || new Error('Failed to save to IndexedDB'));
                };
            } catch (err) {
                reject(err);
            }
        });
    }).catch(function (err) {
        console.warn('[PurchaseDropdowns] IndexedDB save warning:', err);
    });
}

function populatePurchaseSelect(select, values) {
    if (!select || !Array.isArray(values) || values.length === 0) return;
    var current = select.value;
    var isSeason = select.id.indexOf('season') !== -1;
    var placeholderText = isSeason ? 'Select Season' : 'Select Category';

    // Prevent redundant DOM redraw if options are already populated with exact same values
    var existingValues = [];
    for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value !== '') {
            existingValues.push(select.options[i].value);
        }
    }
    var isSame = existingValues.length === values.length && existingValues.every(function (v, idx) { return v === values[idx]; });
    if (isSame && select.querySelector('option[value=""]')) {
        if (current && values.indexOf(current) !== -1) {
            select.value = current;
        }
        return;
    }

    var existingPlaceholder = select.querySelector('option[value=""]');
    var placeholder = existingPlaceholder ? existingPlaceholder.cloneNode(true) : null;
    select.innerHTML = '';
    if (placeholder) {
        select.appendChild(placeholder);
    } else {
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.disabled = true;
        defaultOpt.selected = !current;
        defaultOpt.textContent = placeholderText;
        select.appendChild(defaultOpt);
    }

    values.forEach(function (value) {
        if (!value) return;
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });

    if (current && values.indexOf(current) !== -1) {
        select.value = current;
    }
}

function applyPurchaseDropdowns(data) {
    if (!data) return;
    var seasons = data.seasons || [];
    var categories = data.categories || [];

    var dSeason = document.getElementById('domestic-season');
    var dCat = document.getElementById('domestic-category');
    var iSeason = document.getElementById('import-season');
    var iCat = document.getElementById('import-category');

    if (dSeason) populatePurchaseSelect(dSeason, seasons);
    if (dCat) populatePurchaseSelect(dCat, categories);
    if (iSeason) populatePurchaseSelect(iSeason, seasons);
    if (iCat) populatePurchaseSelect(iCat, categories);
}

var isFetchingPurchaseDropdowns = false;

function fetchPurchaseDropdowns(forceNetwork) {
    // Layer 0: Instant Synchronous cache from localStorage (0.00ms)
    var hasLocalData = false;
    try {
        var rawLs = localStorage.getItem(PURCHASE_LS_KEY);
        if (rawLs) {
            var lsData = JSON.parse(rawLs);
            if (lsData && Array.isArray(lsData.seasons) && lsData.seasons.length > 0) {
                applyPurchaseDropdowns(lsData);
                hasLocalData = true;
            }
        }
    } catch (e) {}

    if (!hasLocalData) {
        applyPurchaseDropdowns(DEFAULT_PURCHASE_DROPDOWNS);
    }

    // Layer 1: Fast asynchronous read from IndexedDB (~1-5ms)
    getPurchaseDropdownsFromIdb().then(function (cached) {
        if (cached && Array.isArray(cached.seasons) && cached.seasons.length > 0) {
            applyPurchaseDropdowns(cached);
            try {
                localStorage.setItem(PURCHASE_LS_KEY, JSON.stringify(cached));
            } catch (e) {}
        }
    }).catch(function (err) {
        console.warn('[PurchaseDropdowns] IDB read warning:', err);
    });

    // Layer 2: Stale-While-Revalidate network background sync
    if (isFetchingPurchaseDropdowns) return;
    isFetchingPurchaseDropdowns = true;

    fetch(PURCHASE_URL + '?action=getPurchaseDropdowns&_=' + Date.now())
        .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function (result) {
            isFetchingPurchaseDropdowns = false;
            if (result && result.success && result.data) {
                var freshData = {
                    seasons: result.data.seasons || [],
                    categories: result.data.categories || [],
                    updatedAt: Date.now()
                };
                savePurchaseDropdownsToIdb(freshData);
                applyPurchaseDropdowns(freshData);
                purchaseDropdownsLoaded = true;
            }
        })
        .catch(function (err) {
            isFetchingPurchaseDropdowns = false;
            console.warn('[PurchaseDropdowns] Background sync failed, using IndexedDB cache:', err);
        });
}

window.PurchaseDropdowns = {
    fetch: fetchPurchaseDropdowns,
    apply: applyPurchaseDropdowns,
    getFromIdb: getPurchaseDropdownsFromIdb,
    saveToIdb: savePurchaseDropdownsToIdb
};

// ---------------------------------------------------------------------------
// IndexedDB Fast Submission Queue & Known PO Numbers
// ---------------------------------------------------------------------------
function enqueuePurchaseSubmission(item) {
    if (!item || !item.id) return;

    // 1. Instant sync to localStorage queue
    try {
        var queue = JSON.parse(localStorage.getItem(PURCHASE_QUEUE_LS_KEY) || '[]');
        queue.push(item);
        localStorage.setItem(PURCHASE_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    // 2. Persistent save to IndexedDB queue
    openPurchaseIdb().then(function (db) {
        var tx = db.transaction(PURCHASE_IDB_STORE_QUEUE, 'readwrite');
        tx.objectStore(PURCHASE_IDB_STORE_QUEUE).put(item);
    }).catch(function (err) {
        console.warn('[PurchaseQueue] Enqueue error:', err);
    });
}

function getPendingFromLs() {
    try {
        var queue = JSON.parse(localStorage.getItem(PURCHASE_QUEUE_LS_KEY) || '[]');
        return queue.filter(function (it) {
            return it && (it.status === 'pending' || it.status === 'failed');
        });
    } catch (e) {
        return [];
    }
}

function getPendingPurchaseSubmissions() {
    return openPurchaseIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(PURCHASE_IDB_STORE_QUEUE, 'readonly');
                var store = tx.objectStore(PURCHASE_IDB_STORE_QUEUE);
                var req = store.getAll();
                req.onsuccess = function () {
                    var items = (req.result || []).filter(function (it) {
                        return it && (it.status === 'pending' || it.status === 'failed');
                    });
                    if (items.length > 0) {
                        resolve(items);
                    } else {
                        resolve(getPendingFromLs());
                    }
                };
                req.onerror = function () {
                    resolve(getPendingFromLs());
                };
            } catch (err) {
                resolve(getPendingFromLs());
            }
        });
    }).catch(function () {
        return getPendingFromLs();
    });
}

function markPurchaseSubmissionSynced(id) {
    // 1. Remove from localStorage
    try {
        var queue = JSON.parse(localStorage.getItem(PURCHASE_QUEUE_LS_KEY) || '[]');
        queue = queue.filter(function (it) { return it.id !== id; });
        localStorage.setItem(PURCHASE_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    // 2. Remove from IndexedDB queue
    return openPurchaseIdb().then(function (db) {
        var tx = db.transaction(PURCHASE_IDB_STORE_QUEUE, 'readwrite');
        tx.objectStore(PURCHASE_IDB_STORE_QUEUE).delete(id);
    }).catch(function () {});
}

function markPurchaseSubmissionFailed(id, errMsg) {
    try {
        var queue = JSON.parse(localStorage.getItem(PURCHASE_QUEUE_LS_KEY) || '[]');
        queue.forEach(function (it) {
            if (it.id === id) {
                it.status = 'failed';
                it.error = errMsg;
            }
        });
        localStorage.setItem(PURCHASE_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    return openPurchaseIdb().then(function (db) {
        var tx = db.transaction(PURCHASE_IDB_STORE_QUEUE, 'readwrite');
        var store = tx.objectStore(PURCHASE_IDB_STORE_QUEUE);
        var req = store.get(id);
        req.onsuccess = function () {
            var it = req.result;
            if (it) {
                it.status = 'failed';
                it.error = errMsg;
                store.put(it);
            }
        };
    }).catch(function () {});
}

var isSyncingPurchaseQueue = false;

function processPurchaseSyncQueue() {
    if (isSyncingPurchaseQueue) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    isSyncingPurchaseQueue = true;

    getPendingPurchaseSubmissions().then(function (items) {
        if (!items || items.length === 0) {
            isSyncingPurchaseQueue = false;
            return;
        }

        var chain = Promise.resolve();
        items.forEach(function (item) {
            chain = chain.then(function () {
                return postPurchase({
                    action: item.action,
                    formData: item.formData,
                    originalPoNumber: item.originalPoNumber || (item.formData && item.formData.originalPoNumber)
                })
                    .then(function () {
                        markPurchaseSubmissionSynced(item.id);
                        console.log('[PurchaseFastSync] PO #' + item.poNumber + ' synced to Google Sheets in background.');
                    })
                    .catch(function (err) {
                        var errMsg = (err && err.message) || String(err);
                        if (errMsg.toLowerCase().indexOf('already exists') !== -1) {
                            markPurchaseSubmissionFailed(item.id, errMsg);
                            showToast('error', 'Duplicate Warning', 'PO #' + item.poNumber + ' already exists on Google Sheets.');
                        } else {
                            console.warn('[PurchaseFastSync] Retrying PO #' + item.poNumber + ' later:', errMsg);
                        }
                    });
            });
        });

        return chain.then(function () {
            isSyncingPurchaseQueue = false;
        });
    }).catch(function () {
        isSyncingPurchaseQueue = false;
    });
}

function recordKnownPoNumber(formType, poNumber) {
    if (!poNumber) return;
    var norm = poNumber.trim().toLowerCase();
    try {
        var map = JSON.parse(localStorage.getItem(PURCHASE_KNOWN_POS_KEY) || '{}');
        if (!map[formType]) map[formType] = [];
        if (map[formType].indexOf(norm) === -1) {
            map[formType].push(norm);
            localStorage.setItem(PURCHASE_KNOWN_POS_KEY, JSON.stringify(map));
        }
    } catch (e) {}

    openPurchaseIdb().then(function (db) {
        var tx = db.transaction(PURCHASE_IDB_STORE_KNOWN_POS, 'readwrite');
        var store = tx.objectStore(PURCHASE_IDB_STORE_KNOWN_POS);
        var req = store.get(formType);
        req.onsuccess = function () {
            var rec = req.result || { key: formType, list: [] };
            if (rec.list.indexOf(norm) === -1) {
                rec.list.push(norm);
                store.put(rec);
            }
        };
    }).catch(function () {});
}

function isLocalDuplicatePo(formType, poNumber) {
    if (!poNumber) return false;
    var norm = poNumber.trim().toLowerCase();
    try {
        var map = JSON.parse(localStorage.getItem(PURCHASE_KNOWN_POS_KEY) || '{}');
        if (map[formType] && map[formType].indexOf(norm) !== -1) {
            return true;
        }
    } catch (e) {}
    return false;
}

function preloadKnownPurchasePos() {
    ['domestic', 'import'].forEach(function (formType) {
        var action = (formType === 'domestic') ? 'getDomesticPurchaseSummary' : 'getImportPurchaseSummary';
        fetch(PURCHASE_URL + '?action=' + action + '&_=' + Date.now())
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.success && Array.isArray(res.rows)) {
                    var poList = [];
                    res.rows.forEach(function (row) {
                        var p = (row[3] || '').trim().toLowerCase();
                        if (p) poList.push(p);
                    });
                    if (poList.length > 0) {
                        try {
                            var map = JSON.parse(localStorage.getItem(PURCHASE_KNOWN_POS_KEY) || '{}');
                            var merged = (map[formType] || []).concat(poList);
                            var unique = [];
                            merged.forEach(function (item) {
                                if (unique.indexOf(item) === -1) unique.push(item);
                            });
                            map[formType] = unique;
                            localStorage.setItem(PURCHASE_KNOWN_POS_KEY, JSON.stringify(map));
                        } catch (e) {}

                        openPurchaseIdb().then(function (db) {
                            var tx = db.transaction(PURCHASE_IDB_STORE_KNOWN_POS, 'readwrite');
                            var store = tx.objectStore(PURCHASE_IDB_STORE_KNOWN_POS);
                            store.put({ key: formType, list: poList });
                        }).catch(function () {});
                    }
                }
            })
            .catch(function () {});
    });
}

// ---------------------------------------------------------------------------
// User Last PO Submission Storage (Strict User Isolation & 15-Minute Expiry)
// ---------------------------------------------------------------------------
function getPurchaseUserKey(user) {
    var raw = (user || safeCurrentSubmitter() || 'default_user').toString().trim().toLowerCase();
    return raw.replace(/[^a-z0-9_-]/g, '_') || 'default_user';
}

function saveUserLastPurchaseSubmission(formType, data) {
    if (!data) return Promise.resolve();
    var currentUser = safeCurrentSubmitter().trim() || 'User';
    var uKey = getPurchaseUserKey(currentUser);
    var recordKey = uKey + '_' + formType;
    var record = {
        key: recordKey,
        user: currentUser,
        userKey: uKey,
        formType: formType,
        timestamp: Date.now(),
        submittedAt: new Date().toISOString(),
        data: Object.assign({}, data)
    };

    // 1. Instant 0ms sync to localStorage (scoped strictly to this user & formType)
    try {
        localStorage.setItem(PURCHASE_USER_LAST_LS_PREFIX + recordKey, JSON.stringify(record));
    } catch (e) {}

    // 2. Persistent save to IndexedDB 'user_last_submissions'
    return openPurchaseIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(PURCHASE_IDB_STORE_USER_LAST, 'readwrite');
                var store = tx.objectStore(PURCHASE_IDB_STORE_USER_LAST);
                store.put(record);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { resolve(false); };
            } catch (err) {
                resolve(false);
            }
        });
    }).catch(function (err) {
        console.warn('[PurchaseReview] IDB save warning:', err);
    });
}

function toPurchaseInputDate(val) {
    if (!val) return '';
    var str = String(val).trim();
    // Match DD/MM/YYYY or DD-MM-YYYY
    var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        var day = (dmy[1].length < 2 ? '0' : '') + dmy[1];
        var mon = (dmy[2].length < 2 ? '0' : '') + dmy[2];
        var yr = dmy[3];
        return yr + '-' + mon + '-' + day;
    }
    // Match YYYY-MM-DD
    var ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) {
        var yr = ymd[1];
        var mon = (ymd[2].length < 2 ? '0' : '') + ymd[2];
        var day = (ymd[3].length < 2 ? '0' : '') + ymd[3];
        return yr + '-' + mon + '-' + day;
    }
    return str;
}

function parsePurchaseSheetTimestamp(tsStr) {
    if (!tsStr) return Date.now();
    var parts = String(tsStr).trim().split(' ');
    if (parts.length >= 1) {
        var dParts = parts[0].split('/');
        if (dParts.length === 3) {
            var day = parseInt(dParts[0], 10);
            var month = parseInt(dParts[1], 10) - 1;
            var year = parseInt(dParts[2], 10);
            var hours = 0, mins = 0, secs = 0;
            if (parts[1]) {
                var tParts = parts[1].split(':');
                hours = parseInt(tParts[0] || 0, 10);
                mins = parseInt(tParts[1] || 0, 10);
                secs = parseInt(tParts[2] || 0, 10);
            }
            var d = new Date(year, month, day, hours, mins, secs);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }
    var d2 = new Date(tsStr);
    return isNaN(d2.getTime()) ? Date.now() : d2.getTime();
}

function getUserLastPurchaseSubmission(formType) {
    var currentUser = safeCurrentSubmitter().trim() || 'User';
    var uKey = getPurchaseUserKey(currentUser);
    var recordKey = uKey + '_' + formType;

    // Check localStorage first
    var localRecord = null;
    try {
        var raw = localStorage.getItem(PURCHASE_USER_LAST_LS_PREFIX + recordKey);
        if (raw) {
            localRecord = JSON.parse(raw);
        }
    } catch (e) {}

    // Check IndexedDB
    return openPurchaseIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(PURCHASE_IDB_STORE_USER_LAST, 'readonly');
                var store = tx.objectStore(PURCHASE_IDB_STORE_USER_LAST);
                var req = store.get(recordKey);
                req.onsuccess = function () {
                    resolve(req.result || localRecord || null);
                };
                req.onerror = function () {
                    resolve(localRecord || null);
                };
            } catch (err) {
                resolve(localRecord || null);
            }
        });
    }).catch(function () {
        return localRecord || null;
    }).then(function (cachedRec) {
        // If cached record exists and is within 15 minutes, return it immediately
        if (cachedRec && cachedRec.data && cachedRec.data.poNumber && (Date.now() - cachedRec.timestamp <= PURCHASE_REVIEW_EXPIRY_MS)) {
            return cachedRec;
        }

        // Multi-tier Level 3: Fetch latest row from Google Sheets for live accuracy
        var action = (formType === 'import') ? 'getImportPurchaseSummary' : 'getDomesticPurchaseSummary';
        return fetch(PURCHASE_URL + '?action=' + action + '&_=' + Date.now())
            .then(function (res) { return res.json(); })
            .then(function (sheetRes) {
                if (sheetRes && sheetRes.success && Array.isArray(sheetRes.rows) && sheetRes.rows.length > 0) {
                    var rows = sheetRes.rows;
                    var normUser = currentUser.toLowerCase();
                    var matchedRow = null;

                    // Match user from bottom up
                    if (normUser && normUser !== 'user') {
                        for (var i = rows.length - 1; i >= 0; i--) {
                            var rUser = String(rows[i][1] || '').trim().toLowerCase();
                            if (rUser === normUser) {
                                matchedRow = rows[i];
                                break;
                            }
                        }
                    }

                    // If no row matched current user, take the latest row overall
                    if (!matchedRow && rows.length > 0) {
                        matchedRow = rows[rows.length - 1];
                    }

                    if (matchedRow) {
                        var ts = parsePurchaseSheetTimestamp(matchedRow[0]);
                        var sheetRecord = {
                            key: recordKey,
                            user: matchedRow[1] || currentUser,
                            userKey: uKey,
                            formType: formType,
                            timestamp: ts,
                            submittedAt: matchedRow[0],
                            source: 'sheet',
                            data: {
                                poOrderDate: toPurchaseInputDate(matchedRow[2]),
                                poNumber: matchedRow[3] || '',
                                itb: matchedRow[4] || '',
                                indentDate: toPurchaseInputDate(matchedRow[5]),
                                indentNumber: matchedRow[6] || '',
                                season: matchedRow[7] || '',
                                supplierName: matchedRow[8] || '',
                                category: matchedRow[9] || '',
                                quantity: matchedRow[10] || '',
                                etaDate: toPurchaseInputDate(matchedRow[11]),
                                createdBy: matchedRow[1] || currentUser
                            }
                        };
                        saveUserLastPurchaseSubmission(formType, sheetRecord.data);
                        return sheetRecord;
                    }
                }
                return cachedRec || null;
            })
            .catch(function (err) {
                console.warn('[PurchaseReview] Sheet fallback fetch error:', err);
                return cachedRec || null;
            });
    });
}

// ---------------------------------------------------------------------------
// Purchase Order Pre-Submit Summary Review Modal Controller
// Supports both Domestic Purchase Order and Import Purchase Order Forms
// ---------------------------------------------------------------------------
var activePurchaseSummaryContext = null;

function formatPurchaseSummaryDate(val) {
    if (!val) return '-';
    var parts = String(val).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var monthIdx = parseInt(parts[1], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
            return parts[2] + ' ' + months[monthIdx] + ' ' + parts[0];
        }
    }
    return val;
}

function openPurchaseSummaryModal(formType, action, formData, formEl) {
    if (!formData) return;
    activePurchaseSummaryContext = {
        formType: formType,
        action: action,
        formData: formData,
        formEl: formEl
    };

    var isImport = (formType === 'import');
    var accentColor = isImport ? '#059669' : '#0284c7';
    var badgeBg = isImport ? '#ecfdf5' : '#e0f2fe';
    var badgeColor = isImport ? '#059669' : '#0284c7';
    var badgeBorder = isImport ? '#a7f3d0' : '#7dd3fc';
    var badgeText = isImport ? 'Import PO' : 'Domestic PO';
    var modalIcon = isImport ? 'flight_takeoff' : 'store';
    var highlightBg = isImport ? '#f0fdf4' : '#f0f9ff';
    var highlightBorder = isImport ? '#bbf7d0' : '#bae6fd';

    // Update modal card border accent
    var card = document.getElementById('po-summary-card');
    if (card) {
        card.style.setProperty('border-top', '4px solid ' + accentColor, 'important');
    }

    // Update icon box & icon
    var iconBox = document.getElementById('po-summary-icon-box');
    if (iconBox) iconBox.style.background = accentColor;
    var iconEl = document.getElementById('po-summary-icon');
    if (iconEl) iconEl.textContent = modalIcon;

    // Update badge
    var badge = document.getElementById('po-summary-badge');
    if (badge) {
        badge.textContent = badgeText;
        badge.style.background = badgeBg;
        badge.style.color = badgeColor;
        badge.style.borderColor = badgeBorder;
    }

    // Update highlight box styling
    var highlightBox = document.getElementById('po-sum-highlight-box');
    if (highlightBox) {
        highlightBox.style.background = highlightBg;
        highlightBox.style.borderColor = highlightBorder;
    }
    var labelPo = document.getElementById('po-sum-label-po');
    if (labelPo) labelPo.style.color = isImport ? '#047857' : '#0369a1';

    // Populate Key Highlights
    var numEl = document.getElementById('po-sum-number');
    if (numEl) numEl.textContent = formData.poNumber || '-';

    var qtyEl = document.getElementById('po-sum-quantity');
    if (qtyEl) {
        var numQty = Number(formData.quantity);
        qtyEl.textContent = (!isNaN(numQty) && numQty > 0) ? numQty.toLocaleString() : (formData.quantity || '0');
        qtyEl.style.color = isImport ? '#059669' : '#0284c7';
    }

    // Populate Structured Details Grid
    var mappings = [
        { id: 'po-sum-supplier', val: formData.supplierName },
        { id: 'po-sum-category', val: formData.category },
        { id: 'po-sum-season', val: formData.season },
        { id: 'po-sum-order-date', val: formatPurchaseSummaryDate(formData.poOrderDate) },
        { id: 'po-sum-itb', val: formData.itb },
        { id: 'po-sum-indent-date', val: formatPurchaseSummaryDate(formData.indentDate) },
        { id: 'po-sum-indent-number', val: formData.indentNumber },
        { id: 'po-sum-eta-date', val: formatPurchaseSummaryDate(formData.etaDate) }
    ];

    mappings.forEach(function (m) {
        var el = document.getElementById(m.id);
        if (el) {
            el.textContent = (m.val !== undefined && m.val !== null && String(m.val).trim()) ? String(m.val).trim() : '-';
        }
    });

    // Color icons in grid
    var iconIds = [
        'po-sum-icon-supplier', 'po-sum-icon-category', 'po-sum-icon-season',
        'po-sum-icon-order-date', 'po-sum-icon-itb', 'po-sum-icon-indent-date',
        'po-sum-icon-indent-num', 'po-sum-icon-eta'
    ];
    iconIds.forEach(function (icId) {
        var el = document.getElementById(icId);
        if (el) el.style.color = accentColor;
    });

    // Style Final Submit Button
    var finalBtn = document.getElementById('po-summary-btn-final-submit');
    if (finalBtn) {
        finalBtn.style.background = accentColor;
        finalBtn.style.boxShadow = isImport ? '0 4px 14px rgba(5, 150, 105, 0.35)' : '0 4px 14px rgba(2, 132, 199, 0.35)';
        finalBtn.disabled = false;
        finalBtn.innerHTML = '<span class="material-icons-round" style="font-size: 18px;">cloud_upload</span><span>Final Submit</span>';
    }

    // Display modal
    var modal = document.getElementById('po-summary-modal');
    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('data-visible', 'true');
        modal.style.setProperty('display', 'flex', 'important');
    }
}

function closePurchaseSummaryModal() {
    var modal = document.getElementById('po-summary-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('data-visible', 'false');
        modal.style.setProperty('display', 'none', 'important');
    }
    activePurchaseSummaryContext = null;
}

function handlePurchaseFinalSubmit() {
    if (!activePurchaseSummaryContext) {
        closePurchaseSummaryModal();
        return;
    }

    var ctx = activePurchaseSummaryContext;
    var formType = ctx.formType;
    var action = ctx.action;
    var data = Object.assign({}, ctx.formData);
    var form = ctx.formEl;

    var finalBtn = document.getElementById('po-summary-btn-final-submit');
    var origHtml = finalBtn ? finalBtn.innerHTML : '';

    if (finalBtn) {
        finalBtn.disabled = true;
        finalBtn.innerHTML = '<span class="material-icons-round" style="font-size: 18px;">autorenew</span><span>Submitting...</span>';
    }

    // 0.05s INSTANT OPTIMISTIC SUBMIT
    var queueItem = {
        id: 'po_' + formType + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        formType: formType,
        action: action,
        formData: data,
        poNumber: data.poNumber,
        status: 'pending',
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        retryCount: 0
    };

    // Save to local Outbox, record known PO, and save user's last submission cache
    enqueuePurchaseSubmission(queueItem);
    recordKnownPoNumber(formType, data.poNumber);
    saveUserLastPurchaseSubmission(formType, data);

    // Reset the target form and clear errors
    if (form) {
        var poInput = document.getElementById(formType + '-po-number');
        form.reset();
        clearPurchaseErrors(form);
        setPurchaseOtherFieldsDisabled(form, poInput, false);
        setPurchasePoMsg(formType, '');

        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
            var origSubmitHtml = submitBtn.innerHTML;
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span class="material-icons-round">check_circle</span> Submitted!';
            submitBtn.style.backgroundColor = (formType === 'import' ? '#047857' : '#0369a1');
            setTimeout(function () {
                submitBtn.innerHTML = origSubmitHtml;
                submitBtn.style.backgroundColor = '';
            }, 1200);
        }
    }

    // Modal button tactile feedback & quick dismiss
    if (finalBtn) {
        finalBtn.innerHTML = '<span class="material-icons-round" style="font-size: 18px;">check_circle</span><span>Submitted!</span>';
        finalBtn.style.backgroundColor = '#059669';
    }

    setTimeout(function () {
        closePurchaseSummaryModal();
        if (finalBtn) {
            finalBtn.disabled = false;
            finalBtn.innerHTML = origHtml;
            finalBtn.style.backgroundColor = '';
        }
    }, 200);

    // Instant Toast
    showToast('success', 'Submitted Instantly!', (formType === 'import' ? 'Import' : 'Domestic') + ' Purchase Order #' + data.poNumber + ' saved in 0.05s & syncing in background.');

    // Instant AI Notification
    if (formType === 'domestic' && window.DomesticPoAI && typeof window.DomesticPoAI.notifySubmitSuccess === 'function') {
        window.DomesticPoAI.notifySubmitSuccess(data.poNumber);
    } else if (formType === 'import' && window.ImportPoAI && typeof window.ImportPoAI.notifySubmitSuccess === 'function') {
        window.ImportPoAI.notifySubmitSuccess(data.poNumber);
    }

    // Optimistic Table Ingestion
    if (formType === 'domestic' && window.DomesticFormDataSheetEngine && typeof window.DomesticFormDataSheetEngine.addNewSubmission === 'function') {
        window.DomesticFormDataSheetEngine.addNewSubmission(data);
    } else if (formType === 'import' && window.ImportFormDataSheetEngine && typeof window.ImportFormDataSheetEngine.addNewSubmission === 'function') {
        window.ImportFormDataSheetEngine.addNewSubmission(data);
    }

    // Trigger silent background sync
    setTimeout(processPurchaseSyncQueue, 40);
}

function initPurchaseSummaryModal() {
    var btnClose = document.getElementById('po-summary-close-btn');
    if (btnClose && !btnClose._poBound) {
        btnClose._poBound = true;
        btnClose.addEventListener('click', closePurchaseSummaryModal);
    }

    var btnModify = document.getElementById('po-summary-btn-modify');
    if (btnModify && !btnModify._poBound) {
        btnModify._poBound = true;
        btnModify.addEventListener('click', closePurchaseSummaryModal);
    }

    var backdrop = document.getElementById('po-summary-backdrop');
    if (backdrop && !backdrop._poBound) {
        backdrop._poBound = true;
        backdrop.addEventListener('click', closePurchaseSummaryModal);
    }

    var btnFinalSubmit = document.getElementById('po-summary-btn-final-submit');
    if (btnFinalSubmit && !btnFinalSubmit._poBound) {
        btnFinalSubmit._poBound = true;
        btnFinalSubmit.addEventListener('click', handlePurchaseFinalSubmit);
    }

    if (!window._poSummaryKeyBound) {
        window._poSummaryKeyBound = true;
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var modal = document.getElementById('po-summary-modal');
                if (modal && (modal.classList.contains('active') || modal.getAttribute('data-visible') === 'true' || modal.style.display !== 'none')) {
                    closePurchaseSummaryModal();
                }
            }
        });
    }
}


// ---------------------------------------------------------------------------
// PO Number duplicate check — Instant Local + Debounced Server Check
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

    // Instant 0ms local duplicate check from IndexedDB/localStorage
    if (isLocalDuplicatePo(formType, poNumber)) {
        setPurchaseOtherFieldsDisabled(form, poInput, true);
        setPurchasePoMsg(formType, 'This PO Number already exists. Please enter a different PO Number.', 'exists');
        return Promise.resolve(true);
    }

    setPurchasePoMsg(formType, 'Checking PO Number…', 'loading');

    return checkPurchasePoNumber(formType, poNumber)
        .then(function (result) {
            if ((poInput.value || '').trim() !== poNumber) return null;

            if (result && result.success && result.exists) {
                recordKnownPoNumber(formType, poNumber);
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

// ---------------------------------------------------------------------------
// 0.05-Second Instant Optimistic Submit (IndexedDB Outbox Pattern)
// ---------------------------------------------------------------------------
function submitPurchaseForm(form, action) {
    var formType = (action === 'submitImportPO') ? 'import' : 'domestic';
    var poInput = document.getElementById(formType + '-po-number');
    var poNumber = (poInput && poInput.value || '').trim();

    // 1. Instant Synchronous Form Validation (0ms)
    if (!validatePurchaseForm(form)) {
        return;
    }

    // 2. Instant Local Duplicate PO Check (0ms)
    if (isLocalDuplicatePo(formType, poNumber)) {
        setPurchaseOtherFieldsDisabled(form, poInput, true);
        setPurchasePoMsg(formType, 'This PO Number already exists. Please enter a different PO Number.', 'exists');
        showToast('error', 'Duplicate PO Number', 'This PO Number already exists. Duplicate entries are not allowed.');
        return;
    }

    // 3. Extract Form Data
    var data = {};
    form.querySelectorAll('input, select').forEach(function (field) { data[field.name] = (field.value || '').trim(); });
    data.createdBy = safeCurrentSubmitter().trim();

    // 4. Open Pre-Submit Summary Review Modal for Domestic / Import PO
    openPurchaseSummaryModal(formType, action, data, form);
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
    if (viewId === 'domestic-po-view' || viewId === 'import-po-view') {
        fetchPurchaseDropdowns();
    }
    if (viewId === 'domestic-po-view' && window.DomesticPoAI && typeof window.DomesticPoAI.refreshStatus === 'function') {
        window.DomesticPoAI.refreshStatus();
    } else if (viewId === 'import-po-view' && window.ImportPoAI && typeof window.ImportPoAI.refreshStatus === 'function') {
        window.ImportPoAI.refreshStatus();
    }
}

function initPurchase() {
    // 1. Immediately pre-hydrate dropdowns from IndexedDB/localStorage with 0 wait time
    fetchPurchaseDropdowns();

    // 2. Preload known PO numbers from Google Sheets in background
    preloadKnownPurchasePos();

    // 3. Process any pending offline submissions from previous sessions
    setTimeout(processPurchaseSyncQueue, 500);

    // 4. Auto-sync on network reconnect and periodic interval
    window.addEventListener('online', function () {
        console.log('[PurchaseFastSync] Online detected — syncing queue...');
        processPurchaseSyncQueue();
    });
    setInterval(processPurchaseSyncQueue, 25000);

    var domesticCard = document.getElementById('kpi-domestic-po');
    if (domesticCard) {
        domesticCard.addEventListener('click', function () {
            showPurchaseDetailView('domestic-po-view');
            fetchPurchaseDropdowns();
        });
        domesticCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showPurchaseDetailView('domestic-po-view');
                fetchPurchaseDropdowns();
            }
        });
    }

    var importCard = document.getElementById('kpi-import-po');
    if (importCard) {
        importCard.addEventListener('click', function () {
            showPurchaseDetailView('import-po-view');
            fetchPurchaseDropdowns();
        });
        importCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showPurchaseDetailView('import-po-view');
                fetchPurchaseDropdowns();
            }
        });
    }

    var backDomestic = document.getElementById('btn-back-domestic-po');
    if (backDomestic) backDomestic.addEventListener('click', showPurchaseKpiView);

    var backImport = document.getElementById('btn-back-import-po');
    if (backImport) backImport.addEventListener('click', showPurchaseKpiView);

    // Reset to the KPI landing view whenever the Purchase nav item is clicked.
    document.querySelectorAll('.nav-item[data-page="purchase"]').forEach(function (item) {
        item.addEventListener('click', function () {
            showPurchaseKpiView();
            fetchPurchaseDropdowns();
        });
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

    // -----------------------------------------------------------------------
    // Purchase Order Pre-Submit Summary Review Modal Initialization
    // -----------------------------------------------------------------------
    initPurchaseSummaryModal();
}

function initOtLeave() {
    ['ot-details', 'leave-details', 'ot-leave-analysis'].forEach(function (type) {
        if (type === 'ot-details') {
            // Handled by additional_work_sheet.js (IndexedDB Engine)
            var otKpiCard = document.getElementById('kpi-ot-details');
            if (otKpiCard && !otKpiCard._awBound) {
                otKpiCard._awBound = true;
                otKpiCard.addEventListener('click', function () { showOtLeaveDetailView('ot-details'); });
                otKpiCard.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOtLeaveDetailView('ot-details'); }
                });
            }
            return;
        }
        if (type === 'leave-details') {
            // Handled by leave_details_sheet.js (IndexedDB Engine)
            var leaveKpiCard = document.getElementById('kpi-leave-details');
            if (leaveKpiCard && !leaveKpiCard._leaveBound) {
                leaveKpiCard._leaveBound = true;
                leaveKpiCard.addEventListener('click', function () { showOtLeaveDetailView('leave-details'); });
                leaveKpiCard.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOtLeaveDetailView('leave-details'); }
                });
            }
            return;
        }
        if (type === 'ot-leave-analysis') {
            // Handled by additional_work_leave_analysis_sheet.js (IndexedDB Engine)
            var analysisKpiCard = document.getElementById('kpi-ot-leave-analysis');
            if (analysisKpiCard && !analysisKpiCard._analysisBound) {
                analysisKpiCard._analysisBound = true;
                analysisKpiCard.addEventListener('click', function () { showOtLeaveDetailView('ot-leave-analysis'); });
                analysisKpiCard.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOtLeaveDetailView('ot-leave-analysis'); }
                });
            }
            return;
        }
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

var WAREHOUSE_SECTION_URL = 'https://script.google.com/macros/s/AKfycbxn0HE6tARPapjUHtl4i3TOLGEx0zMxf0lNoSGLY8Fs5nhEXMeCW6c8NGyfbCOO8yA_/exec';

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
    if (window.CheckingDetailsSheetEngine && window.CheckingDetailsSheetEngine.clearSelection) {
        window.CheckingDetailsSheetEngine.clearSelection();
    }
    applyKpiCardAccess();
}

function showWarehouseSectionDetailView(type) {
    if (type === 'checking-details' && window.CheckingDetailsSheetEngine && window.CheckingDetailsSheetEngine.show) {
        window.CheckingDetailsSheetEngine.show();
        return;
    }
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
        if (type === 'checking-details') {
            // Handled by checking_details_sheet.js (IndexedDB Engine)
            var checkingKpiCard = document.getElementById('kpi-checking-details');
            if (checkingKpiCard && !checkingKpiCard._checkingBound) {
                checkingKpiCard._checkingBound = true;
                checkingKpiCard.addEventListener('click', function () {
                    if (window.CheckingDetailsSheetEngine && window.CheckingDetailsSheetEngine.show) {
                        window.CheckingDetailsSheetEngine.show();
                    } else {
                        showWarehouseSectionDetailView('checking-details');
                    }
                });
                checkingKpiCard.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (window.CheckingDetailsSheetEngine && window.CheckingDetailsSheetEngine.show) {
                            window.CheckingDetailsSheetEngine.show();
                        } else {
                            showWarehouseSectionDetailView('checking-details');
                        }
                    }
                });
            }
            return;
        }
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
    'machine-data': { url: DIE_LESS_URL, script: 'DieLess.gs', action: 'getMachineData', label: 'Machine Details', sheet: 'Machine Data', file: 'Machine_Data' },
    'monthly-machine-inactivity-data': { url: DIE_LESS_URL, script: 'DieLess.gs', action: 'getMonthlyMachineInactivityData', label: 'Monthly Machine Inactivity Details', sheet: 'Monthly Machine Inactivity', file: 'Monthly_Machine_Inactivity_Details' },
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
    Object.keys(dieLessConfigs).forEach(function (type) {
        var p = type + '-data', state = dieLessStates[type];
        var refBtn = document.getElementById('btn-refresh-' + p);
        if (refBtn) {
            refBtn.addEventListener('click', function () { state.allRows = []; dieLessFetch(type); });
        }
        var dlBtn = document.getElementById('btn-download-' + type + '-excel');
        if (dlBtn) {
            dlBtn.addEventListener('click', function () {
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
        }
        var search = document.getElementById(p + '-search');
        if (search) {
            search.addEventListener('input', function () { state.search = search.value.trim().toLowerCase(); dieLessApply(type); });
        }
        var searchClear = document.getElementById(p + '-search-clear');
        if (searchClear) {
            searchClear.addEventListener('click', function () { if (search) search.value = ''; state.search = ''; dieLessApply(type); });
        }
        ['from', 'to'].forEach(function (side) {
            var input = document.getElementById(type + '-date-' + side);
            if (input) {
                input.addEventListener('change', function () { state[side === 'from' ? 'dateFrom' : 'dateTo'] = input.value; dieLessApply(type); });
            }
        });
        var dateClear = document.getElementById(type + '-date-clear');
        if (dateClear) {
            dateClear.addEventListener('click', function () {
                state.dateFrom = ''; state.dateTo = '';
                var fromEl = document.getElementById(type + '-date-from');
                if (fromEl) fromEl.value = '';
                var toEl = document.getElementById(type + '-date-to');
                if (toEl) toEl.value = '';
                dieLessApply(type);
            });
        }
        var pageSize = document.getElementById(p + '-page-size');
        if (pageSize) {
            pageSize.addEventListener('change', function (e) { state.pageSize = parseInt(e.target.value, 10) || 25; state.page = 1; dieLessRender(type); });
        }
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
    if (window.MachineRepairingDetailsSheetEngine && typeof window.MachineRepairingDetailsSheetEngine.hide === 'function') {
        window.MachineRepairingDetailsSheetEngine.hide();
    }
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
    if (type === 'machine-data' && window.DieLessCuttingSheetEngine && typeof window.DieLessCuttingSheetEngine.show === 'function') {
        window.DieLessCuttingSheetEngine.show();
        return;
    }
    if (type === 'monthly-machine-inactivity-data' && window.MonthlyMachineInactivitySheetEngine && typeof window.MonthlyMachineInactivitySheetEngine.show === 'function') {
        window.MonthlyMachineInactivitySheetEngine.show();
        return;
    }
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
    if (window.MachineRepairingDetailsSheetEngine && typeof window.MachineRepairingDetailsSheetEngine.show === 'function') {
        window.MachineRepairingDetailsSheetEngine.show();
        return;
    }
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

    // Topbar Sub-View switcher tabs
    var tabMachineToInactivity = document.getElementById('btn-tab-machine-to-monthly-inactivity');
    if (tabMachineToInactivity) {
        tabMachineToInactivity.addEventListener('click', function () {
            showMachineDetailView('monthly-machine-inactivity-data');
        });
    }

    var tabMonthlyToMachine = document.getElementById('btn-tab-monthly-to-machine-details');
    if (tabMonthlyToMachine) {
        tabMonthlyToMachine.addEventListener('click', function () {
            showMachineDetailView('machine-data');
        });
    }

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