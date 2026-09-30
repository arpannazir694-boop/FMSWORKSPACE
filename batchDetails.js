// =============================================================================
// batchDetails.js — Batch Details Module with Client-Side Excel Backup Source
// =============================================================================
(function () {
    'use strict';

    var STORAGE_KEY_DATA = 'FMS_BATCH_DETAILS_EXCEL_DATA';
    var STORAGE_KEY_META = 'FMS_BATCH_DETAILS_EXCEL_META';

    // Same GAS_URL used by the rest of the FMS app (defined in app.js)
    var GAS_URL = window.GAS_URL || '';
    function getGasUrl() {
        return window.GAS_URL || GAS_URL || '';
    }

    var currentData = [];        // Raw array of objects from Excel
    var currentHeaders = [];     // Array of column header strings
    var filteredRows = [];       // Filtered array of objects
    var currentPage = 1;
    var pageSize = 50;
    var searchQuery = '';
    var sortCol = null;
    var sortAsc = true;

    function el(id) { return document.getElementById(id); }
    function helpers() { return window.FMS || {}; }
    function toast(type, title, msg) { if (helpers().showToast) helpers().showToast(type, title, msg); else alert(title + ': ' + msg); }
    function esc(v) { return helpers().esc ? helpers().esc(v) : String(v == null ? '' : v); }
    function canUseAppsScript_() { return typeof google !== 'undefined' && google.script && google.script.run; }
    function arrayBufferToBase64_(buffer) {
        var bytes = new Uint8Array(buffer);
        var parts = [];
        var chunkSize = 0x8000;
        for (var i = 0; i < bytes.length; i += chunkSize) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
        }
        return btoa(parts.join(''));
    }

    // -------------------------------------------------------------------------
    // Persistence Helpers (localStorage)
    // -------------------------------------------------------------------------
    function saveToStorage(filename, rows, headers) {
        try {
            var meta = {
                filename: filename,
                uploadTime: new Date().toLocaleString(),
                totalRows: rows.length,
                totalCols: headers.length
            };
            localStorage.setItem(STORAGE_KEY_META, JSON.stringify(meta));
            localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify({ headers: headers, rows: rows }));
        } catch (e) {
            console.warn('Storage error:', e);
        }
    }

    function loadFromStorage() {
        try {
            var metaStr = localStorage.getItem(STORAGE_KEY_META);
            var dataStr = localStorage.getItem(STORAGE_KEY_DATA);
            if (!metaStr || !dataStr) return false;

            var meta = JSON.parse(metaStr);
            var data = JSON.parse(dataStr);

            if (data && Array.isArray(data.rows) && Array.isArray(data.headers)) {
                currentHeaders = data.headers;
                currentData = data.rows;
                updateFileStatusUI(meta.filename, meta.totalRows, meta.uploadTime);
                applyFiltersAndRender();
                return true;
            }
        } catch (e) {
            console.warn('Load storage error:', e);
        }
        return false;
    }

    function clearStorage() {
        try {
            localStorage.removeItem(STORAGE_KEY_META);
            localStorage.removeItem(STORAGE_KEY_DATA);
        } catch (e) {}
        currentData = [];
        currentHeaders = [];
        filteredRows = [];
        resetUI();
    }

    // -------------------------------------------------------------------------
    // Excel File Reader via SheetJS (xlsx)
    // -------------------------------------------------------------------------
    function processExcelFile(file) {
        if (!file) return;

        var XLSXLib = window.XLSX;
        if (!XLSXLib) {
            toast('error', 'Library Missing', 'SheetJS (xlsx) library failed to load. Check internet connection.');
            return;
        }

        if (helpers().showSpinner) helpers().showSpinner('Reading Excel file...');

        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSXLib.read(data, { type: 'array' });
                var sourceFileBase64 = arrayBufferToBase64_(e.target.result);

                if (!workbook.SheetNames.length) {
                    throw new Error('The uploaded Excel file contains no worksheets.');
                }

                var firstSheetName = workbook.SheetNames[0];
                var worksheet = workbook.Sheets[firstSheetName];

                // Convert sheet to array of objects
                var jsonRows = XLSXLib.utils.sheet_to_json(worksheet, { defval: '' });

                if (!jsonRows || jsonRows.length === 0) {
                    throw new Error('No data rows found in sheet "' + firstSheetName + '".');
                }

                // Extract all unique headers across rows
                var headerMap = {};
                jsonRows.forEach(function (row) {
                    Object.keys(row).forEach(function (k) { headerMap[k] = true; });
                });
                currentHeaders = Object.keys(headerMap);
                currentData = jsonRows;

                saveToStorage(file.name, currentData, currentHeaders);
                updateFileStatusUI(file.name, currentData.length, 'Just now');
                applyFiltersAndRender();

                toast('success', 'File Loaded', 'Loaded ' + currentData.length + ' rows locally. Syncing with Cloud...');
                syncToCloud(file.name, currentHeaders, currentData, sourceFileBase64, file.type || 'application/octet-stream');
            } catch (err) {
                toast('error', 'Parse Error', err.message || 'Could not parse the selected Excel file.');
            } finally {
                if (helpers().hideSpinner) helpers().hideSpinner();
            }
        };

        reader.onerror = function () {
            if (helpers().hideSpinner) helpers().hideSpinner();
            toast('error', 'Read Error', 'Failed to read the file.');
        };

        reader.readAsArrayBuffer(file);
    }

    // -------------------------------------------------------------------------
    // Cloud Sync (Google Sheets Integration)
    // -------------------------------------------------------------------------
    function syncToCloud(filename, headers, rows, sourceFileBase64, sourceFileMime) {
        // Native Apps Script calls provide a real success/failure result.
        // This is the shared-data path used by the deployed FMS application.
        if (canUseAppsScript_()) {
            google.script.run
                .withSuccessHandler(function (result) {
                    if (result && result.success) {
                        toast('success', 'Drive Saved', 'Batch data is stored in shared Google Drive and is available to all permitted users.');
                    } else {
                        toast('error', 'Drive Save Failed', (result && result.error) || 'The batch data could not be saved to shared Google Drive.');
                    }
                })
                .withFailureHandler(function (error) {
                    toast('error', 'Drive Save Failed', (error && error.message) || 'The batch data could not be saved to shared Google Drive.');
                })
                .saveBatchDetailsData(filename, headers, rows, sourceFileBase64, sourceFileMime);
            return;
        }

        var url = getGasUrl();
        if (!url) {
            console.warn('[BatchDetails] GAS_URL not found — cloud sync skipped.');
            return;
        }

        // Use JSONP-style approach since GAS doesn't support real CORS POST from standalone HTML
        // We encode the data as a GET request with callback for saving
        // For large datasets, we batch them
        var payload = JSON.stringify({
            action: 'saveBatchDetailsData',
            filename: filename,
            headers: headers,
            rows: rows,
            sourceFileBase64: sourceFileBase64,
            sourceFileMime: sourceFileMime
        });
        var callbackName = 'fms_bd_sync_' + Date.now();

        window[callbackName] = function (result) {
            delete window[callbackName];
            if (result && result.success) {
                toast('success', 'Cloud Synced', 'Batch data saved to Google Sheets cloud. All users can now access it.');
            } else {
                console.warn('[BatchDetails] Cloud sync response:', result);
            }
        };

        var script = document.createElement('script');
        // Build a short param — store payload in sessionStorage, retrieve via GAS
        // Fallback: use fetch with no-cors (fire-and-forget)
        fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: payload
        }).then(function () {
            toast('success', 'Saved to Drive', 'The batch data is saved to shared Google Drive.');
        }).catch(function (e) {
            console.warn('[BatchDetails] Cloud sync error:', e);
        });
    }

    function applyCloudBatchData_(result, emptyState) {
        if (result && result.success && Array.isArray(result.rows) && result.rows.length > 0) {
            currentHeaders = result.headers || [];
            currentData = result.rows;
            saveToStorage(result.filename || 'Cloud_Batch_Data', currentData, currentHeaders);
            updateFileStatusUI(
                (result.filename || 'Cloud_Batch_Data') + ' Cloud',
                currentData.length,
                result.uploadTime || 'Cloud'
            );
            applyFiltersAndRender();
            return;
        }

        if (result && !result.success) {
            if (emptyState) {
                emptyState.style.display = '';
                emptyState.innerHTML = '<span class="material-icons-round">error_outline</span><p>' +
                    esc(result.error || 'Could not load shared Batch Details data.') + '</p>';
            }
            return;
        }

        var loaded = loadFromStorage();
        if (!loaded && emptyState) {
            emptyState.style.display = '';
            emptyState.innerHTML = '<span class="material-icons-round">cloud_upload</span><p>No shared Batch Details data has been uploaded yet.</p>';
        }
    }

    function fetchFromCloud() {
        var url = getGasUrl();
        var useAppsScript = canUseAppsScript_();
        if (!useAppsScript && !url) {
            // No GAS URL available yet — try localStorage fallback
            loadFromStorage();
            return;
        }

        var emptyState = el('batch-details-empty-state');
        if (emptyState) {
            emptyState.style.display = '';
            emptyState.innerHTML = '<span class="material-icons-round" style="animation:spin 1s linear infinite;">sync</span><p>Loading Batch Details from cloud...</p>';
        }

        if (useAppsScript) {
            google.script.run
                .withSuccessHandler(function (result) { applyCloudBatchData_(result, emptyState); })
                .withFailureHandler(function () {
                    var loaded = loadFromStorage();
                    if (!loaded && emptyState) {
                        emptyState.style.display = '';
                        emptyState.innerHTML = '<span class="material-icons-round">error_outline</span><p>Could not load shared Batch Details data.</p>';
                    }
                })
                .getBatchDetailsData();
            return;
        }

        // Use JSONP — same pattern as rest of FMS app
        var callbackName = 'fms_bd_fetch_' + Date.now();
        var script = document.createElement('script');
        script.src = url + '?action=getBatchDetailsData&callback=' + callbackName + '&_=' + Date.now();

        window[callbackName] = function (result) {
            // Cleanup
            delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);

            if (result && result.success && Array.isArray(result.rows) && result.rows.length > 0) {
                currentHeaders = result.headers || [];
                currentData = result.rows;
                saveToStorage(result.filename || 'Cloud_Batch_Data', currentData, currentHeaders);
                updateFileStatusUI(
                    (result.filename || 'Cloud_Batch_Data') + ' ☁ Cloud',
                    currentData.length,
                    result.uploadTime || 'Cloud'
                );
                applyFiltersAndRender();
            } else {
                // Cloud empty — fall back to localStorage
                var loaded = loadFromStorage();
                if (!loaded) {
                    if (emptyState) {
                        emptyState.style.display = '';
                        emptyState.innerHTML = '<span class="material-icons-round">cloud_upload</span><p>No Batch Details data loaded yet. Upload an Excel file above to get started.</p>';
                    }
                }
            }
        };

        script.onerror = function () {
            if (script.parentNode) script.parentNode.removeChild(script);
            delete window[callbackName];
            // Fallback to localStorage
            loadFromStorage();
        };

        document.head.appendChild(script);
    }

    // Expose data globally for AI Bots (Bai.js / Trio.js)
    if (!window.FMS) window.FMS = {};
    window.FMS.getBatchDetailsData = function () {
        return {
            headers: currentHeaders,
            rows: currentData,
            totalRows: currentData.length
        };
    };

    // -------------------------------------------------------------------------
    // UI Render & Stats
    // -------------------------------------------------------------------------
    function updateFileStatusUI(filename, totalRows, uploadTime) {
        var statusBar = el('batch-file-status-bar');
        var nameEl    = el('batch-loaded-filename');
        var metaEl    = el('batch-loaded-meta');

        if (statusBar) statusBar.style.display = 'flex';
        if (nameEl) nameEl.textContent = filename || 'Batch_Data.xlsx';
        if (metaEl) metaEl.textContent = totalRows + ' row' + (totalRows === 1 ? '' : 's') + ' loaded (' + uploadTime + ')';
    }

    function resetUI() {
        var statusBar = el('batch-file-status-bar');
        if (statusBar) statusBar.style.display = 'none';

        var statsGrid = el('batch-details-stats-grid');
        if (statsGrid) statsGrid.style.display = 'none';

        var emptyState = el('batch-details-empty-state');
        if (emptyState) emptyState.style.display = '';

        var tableWrap = el('batch-details-table-wrap');
        if (tableWrap) tableWrap.style.display = 'none';

        var footer = el('batch-details-footer');
        if (footer) footer.style.display = 'none';

        var tableEl = el('batch-details-table');
        if (tableEl) tableEl.style.display = 'none';

        var countBadge = el('batch-details-count-badge');
        if (countBadge) countBadge.textContent = '— records';

        var excelBtn = el('btn-export-batch-details-excel');
        if (excelBtn) excelBtn.disabled = true;

        var pdfBtn = el('btn-export-batch-details-pdf');
        if (pdfBtn) pdfBtn.disabled = true;

        var fileInput = el('batch-excel-file-input');
        if (fileInput) fileInput.value = '';
    }

    function applyFiltersAndRender() {
        if (!currentData || currentData.length === 0) {
            resetUI();
            return;
        }

        // Apply Search
        var q = searchQuery.toLowerCase();
        filteredRows = currentData.filter(function (row) {
            if (!q) return true;
            return currentHeaders.some(function (h) {
                return String(row[h] || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        // Apply Sorting
        if (sortCol) {
            filteredRows.sort(function (a, b) {
                var av = String(a[sortCol] || '').toLowerCase();
                var bv = String(b[sortCol] || '').toLowerCase();
                var na = parseFloat(av), nb = parseFloat(bv);
                var isNum = !isNaN(na) && !isNaN(nb);
                var cmp = isNum ? (na - nb) : av.localeCompare(bv);
                return sortAsc ? cmp : -cmp;
            });
        }

        currentPage = 1;
        renderTable();
        renderStats();
    }

    function renderStats() {
        var statsGrid = el('batch-details-stats-grid');
        if (!statsGrid) return;

        statsGrid.style.display = 'grid';

        var totalRecordsEl = el('stat-batch-total-records');
        if (totalRecordsEl) totalRecordsEl.textContent = filteredRows.length;

        var totalColsEl = el('stat-batch-total-cols');
        if (totalColsEl) totalColsEl.textContent = currentHeaders.length;

        // Try finding quantity column
        var qtyKey = currentHeaders.find(function (h) { return /qty|quantity|count|pcs/i.test(h); });
        var totalQty = 0;
        if (qtyKey) {
            totalQty = filteredRows.reduce(function (sum, row) {
                var n = parseFloat(row[qtyKey]);
                return sum + (isNaN(n) ? 0 : n);
            }, 0);
        }
        var totalQtyEl = el('stat-batch-total-qty');
        if (totalQtyEl) totalQtyEl.textContent = qtyKey ? totalQty.toLocaleString() : '-';

        var excelBtn = el('btn-export-batch-details-excel');
        if (excelBtn) excelBtn.disabled = filteredRows.length === 0;

        var pdfBtn = el('btn-export-batch-details-pdf');
        if (pdfBtn) pdfBtn.disabled = filteredRows.length === 0;
    }

    function renderTable() {
        var emptyState = el('batch-details-empty-state');
        var tableWrap  = el('batch-details-table-wrap');
        var footer     = el('batch-details-footer');
        var thead      = el('batch-details-thead');
        var tbody      = el('batch-details-tbody');

        if (!currentHeaders.length || filteredRows.length === 0) {
            if (emptyState) {
                emptyState.style.display = '';
                emptyState.innerHTML = '<span class="material-icons-round">search_off</span><p>No matching batch details found.</p>';
            }
            if (tableWrap) tableWrap.style.display = 'none';
            if (footer) footer.style.display = 'none';
            return;
        }

        var tableEl = el('batch-details-table');
        if (emptyState) emptyState.style.display = 'none';
        if (tableWrap) tableWrap.style.display = '';
        if (tableEl) tableEl.style.display = '';
        if (footer) footer.style.display = 'flex';

        var countBadge = el('batch-details-count-badge');
        if (countBadge) countBadge.textContent = filteredRows.length + ' record' + (filteredRows.length === 1 ? '' : 's');

        // Render Table Headers
        var headHtml = '<tr><th class="dt-th dt-th-num">#</th>';
        currentHeaders.forEach(function (h) {
            var isSorted = sortCol === h;
            var icon = isSorted ? (sortAsc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
            headHtml += '<th class="dt-th dt-th-sortable ' + (isSorted ? 'dt-th-sorted' : '') + '" data-header="' + esc(h) + '" style="text-align:center; cursor:pointer;">' +
                '<span>' + esc(h) + '</span>' +
                '<span class="material-icons-round dt-sort-icon" style="font-size:14px; vertical-align:middle; margin-left:4px;">' + icon + '</span>' +
                '</th>';
        });
        headHtml += '</tr>';
        thead.innerHTML = headHtml;

        // Header click listeners for sorting
        thead.querySelectorAll('[data-header]').forEach(function (th) {
            th.addEventListener('click', function () {
                var h = th.getAttribute('data-header');
                if (sortCol === h) {
                    sortAsc = !sortAsc;
                } else {
                    sortCol = h;
                    sortAsc = true;
                }
                applyFiltersAndRender();
            });
        });

        // Pagination calculations
        var total = filteredRows.length;
        var totalPages = Math.ceil(total / pageSize) || 1;
        if (currentPage < 1) currentPage = 1;
        if (currentPage > totalPages) currentPage = totalPages;

        var start = (currentPage - 1) * pageSize;
        var end = Math.min(start + pageSize, total);
        var pageSlice = filteredRows.slice(start, end);

        // Render Rows
        var bodyHtml = '';
        pageSlice.forEach(function (row, idx) {
            bodyHtml += '<tr class="' + ((start + idx) % 2 ? 'dt-tr-odd' : 'dt-tr-even') + '">';
            bodyHtml += '<td class="dt-td dt-td-num">' + (start + idx + 1) + '</td>';
            currentHeaders.forEach(function (h) {
                var val = String(row[h] == null ? '' : row[h]);
                if (searchQuery && val.toLowerCase().indexOf(searchQuery.toLowerCase()) !== -1) {
                    var safeSearch = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    val = esc(val).replace(new RegExp('(' + safeSearch + ')', 'gi'), '<mark class="dt-highlight">$1</mark>');
                    bodyHtml += '<td class="dt-td">' + val + '</td>';
                } else {
                    bodyHtml += '<td class="dt-td">' + esc(val) + '</td>';
                }
            });
            bodyHtml += '</tr>';
        });
        tbody.innerHTML = bodyHtml;

        // Update Footer Info & Pagination Buttons
        var infoEl = el('batch-details-info');
        if (infoEl) {
            infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
                (currentData.length !== total ? ' (filtered from ' + currentData.length + ' total)' : '') + ' entries';
        }

        renderPagination(currentPage, totalPages);
    }

    function renderPagination(current, total) {
        var container = el('batch-details-pagination');
        if (!container) return;
        container.innerHTML = '';

        function mkBtn(label, page, disabled, active, isIcon) {
            var btn = document.createElement('button');
            btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
            btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
            btn.disabled = disabled;
            if (!disabled) {
                btn.addEventListener('click', function () {
                    currentPage = page;
                    renderTable();
                    var wrap = el('batch-details-table-wrap');
                    if (wrap) wrap.scrollTop = 0;
                });
            }
            return btn;
        }

        container.appendChild(mkBtn('first_page', 1, current <= 1, false, true));
        container.appendChild(mkBtn('chevron_left', current - 1, current <= 1, false, true));

        // Simplified range
        for (var p = 1; p <= total; p++) {
            if (p === 1 || p === total || (p >= current - 2 && p <= current + 2)) {
                container.appendChild(mkBtn(p, p, false, p === current, false));
            }
        }

        container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
        container.appendChild(mkBtn('last_page', total, current >= total, false, true));
    }

    // -------------------------------------------------------------------------
    // Exports (Excel & PDF)
    // -------------------------------------------------------------------------
    function exportExcel() {
        if (!filteredRows.length || !window.XLSX) {
            toast('error', 'Export Failed', 'No data available to export.');
            return;
        }

        var ws = window.XLSX.utils.json_to_sheet(filteredRows);
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Batch Details');

        var metaStr = localStorage.getItem(STORAGE_KEY_META);
        var filename = 'Batch_Details_Export.xlsx';
        if (metaStr) {
            try { filename = 'Export_' + JSON.parse(metaStr).filename; } catch (e) {}
        }

        window.XLSX.writeFile(wb, filename);
        toast('success', 'Downloaded', 'Batch details exported to ' + filename);
    }

    function exportPdf() {
        if (!filteredRows.length) return;
        var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFCtor) { toast('error', 'PDF Error', 'PDF library not loaded.'); return; }

        var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('BATCH DETAILS REPORT (EXCEL DATA SOURCE)', 14, 30);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Total Records: ' + filteredRows.length + '   |   Generated: ' + new Date().toLocaleString(), 14, 46);
        doc.line(14, 54, doc.internal.pageSize.getWidth() - 14, 54);

        var tableHead = [currentHeaders];
        var tableBody = filteredRows.map(function (row) {
            return currentHeaders.map(function (h) { return row[h] == null ? '' : String(row[h]); });
        });

        doc.autoTable({
            head: tableHead,
            body: tableBody,
            startY: 64,
            margin: { left: 14, right: 14, bottom: 30 },
            styles: { fontSize: 7, cellPadding: 4, overflow: 'linebreak' },
            headStyles: { fillColor: [31, 78, 120], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            theme: 'grid'
        });

        doc.save('Batch_Details_Report.pdf');
    }

    // -------------------------------------------------------------------------
    // Event Wiring & Navigation
    // -------------------------------------------------------------------------
    function initBatchDetails() {
        // Module Navigation
        var kpiCard = el('kpi-batch-details');
        var kpiGrid = el('batch-analysis-kpi-grid-wrap');
        var detailView = el('batch-details-view');
        var backBtn = el('btn-back-batch-details');

        if (kpiCard) {
            kpiCard.addEventListener('click', function () {
                if (kpiGrid) kpiGrid.style.display = 'none';
                if (detailView) detailView.style.display = 'block';
            });
        }
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                if (detailView) detailView.style.display = 'none';
                if (kpiGrid) kpiGrid.style.display = 'block';
            });
        }

        // File Input & Dropzone
        var fileInput  = el('batch-excel-file-input');
        var dropzone   = el('batch-excel-dropzone');
        var browseBtn  = el('btn-trigger-excel-browse');
        var reuploadBtn= el('btn-reupload-batch-excel');
        var clearBtn   = el('btn-clear-batch-excel');

        if (browseBtn && fileInput) browseBtn.addEventListener('click', function () { fileInput.click(); });
        if (reuploadBtn && fileInput) reuploadBtn.addEventListener('click', function () { fileInput.click(); });
        if (fileInput) {
            fileInput.addEventListener('change', function (e) {
                if (e.target.files && e.target.files[0]) {
                    processExcelFile(e.target.files[0]);
                }
            });
        }

        if (dropzone) {
            dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('dragover'); });
            dropzone.addEventListener('drop', function (e) {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    processExcelFile(e.dataTransfer.files[0]);
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (confirm('Are you sure you want to clear the uploaded batch details data?')) {
                    clearStorage();
                    toast('info', 'Cleared', 'Batch details data removed.');
                }
            });
        }

        // Search & Pagination controls
        var searchInput = el('batch-details-search');
        var searchClear = el('batch-details-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                searchQuery = searchInput.value.trim();
                if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
                applyFiltersAndRender();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', function () {
                searchQuery = '';
                if (searchInput) searchInput.value = '';
                searchClear.style.display = 'none';
                applyFiltersAndRender();
            });
        }

        var pageSizeSelect = el('batch-details-page-size');
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', function () {
                pageSize = parseInt(pageSizeSelect.value, 10) || 50;
                currentPage = 1;
                renderTable();
            });
        }

        // Export Buttons
        var exportExcelBtn = el('btn-export-batch-details-excel');
        var exportPdfBtn   = el('btn-export-batch-details-pdf');
        if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportExcel);
        if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportPdf);

        // Always fetch from cloud first (for cross-device, cross-ID access)
        // Falls back to localStorage if cloud is empty or unavailable
        fetchFromCloud();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBatchDetails);
    } else {
        initBatchDetails();
    }
})();
