/**
 * =============================================================================
 * Checking Details Live Engine (IndexedDB + Fast Google Sheets GVIZ CSV)
 * =============================================================================
 * Sheet: Checking Details (Spreadsheet ID: 1Yc_w9UqsB8H2MMpDnjEQx_YS6CeQ14r5vtt681PcARw)
 * GID: 0
 * Range: A1:L (12 Columns: A to L)
 * Headers (Row 1):
 *   1. DATE
 *   2. UNIT
 *   3. DESIGN REF & SKU
 *   4. CHECKED QTY
 *   5. REPAIR QTY
 *   6. Fabricator Name/No
 *   7. WORKMANSHIP QTY
 *   8. CONSTRUCTION QTY
 *   9. EDGE INKING & COLOUR QTY
 *   10. LEATHER & HARDWARE Defects QTY
 *   11. Other Defects QTY
 *   12. Rework at W/H Qty
 * Database: IndexedDB 'FMS_Checking_Details_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser
 *   - Real-time client-side search across all 12 columns
 *   - Google Sheets style parallel multi-column filtering with popover & value search
 *   - Active filter chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis)
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1Yc_w9UqsB8H2MMpDnjEQx_YS6CeQ14r5vtt681PcARw';
  var SHEET_GID = '0';
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=A1:N';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=A1:N';
  var CSV_URL = PRIMARY_CSV_URL;

  var DROPDOWN_PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&sheet=DROPDOWN&range=A:A';
  var DROPDOWN_FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=DROPDOWN&range=A:A';
  var DROPDOWN_CSV_URL = DROPDOWN_PRIMARY_CSV_URL;
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxn0HE6tARPapjUHtl4i3TOLGEx0zMxf0lNoSGLY8Fs5nhEXMeCW6c8NGyfbCOO8yA_/exec';

  var DB_NAME = 'FMS_Checking_Details_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'checking_details_store';

  var defaultHeaders = [
    'DATE',
    'UNIT',
    'DESIGN REF & SKU',
    'CHECKED QTY',
    'REPAIR QTY',
    'Fabricator Name/No',
    'WORKMANSHIP QTY',
    'CONSTRUCTION QTY',
    'EDGE INKING & COLOUR QTY',
    'LEATHER & HARDWARE Defects QTY',
    'Other Defects QTY',
    'Rework at W/H Qty',
    'ENTERED BY / TIME'
  ];

  var defaultUnitOptions = [
    'P-35', 'P-32', 'S-32', 'S-18', 'S-37', 'S-47 & 48', 'S-29', 'S-10',
    'BANTALA', 'P-17 & 18', 'S-28', 'P-38', '14-B', '114'
  ];
  var cachedUnitOptions = defaultUnitOptions.slice();

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
  // 1.1 Dropdown Options IndexedDB Cache (DROPDOWN Sheet Col A)
  // ---------------------------------------------------------------------------
  function loadDropdownFromCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.get('unit_dropdown_options');
          req.onsuccess = function () {
            if (req.result && Array.isArray(req.result) && req.result.length > 0) {
              resolve(req.result);
            } else {
              resolve(null);
            }
          };
          req.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    }).catch(function () { return null; });
  }

  function saveDropdownToCache(options) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          store.put(options, 'unit_dropdown_options');
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    }).catch(function () {});
  }

  function parseDropdownCSV(csvText) {
    var lines = (csvText || '').split(/\r?\n/);
    var units = [];
    lines.forEach(function (line) {
      var clean = line.replace(/^["'\s]+|["'\s]+$/g, '').trim();
      if (!clean) return;
      var tokens = clean.split(/\s+/);
      var i = 0;
      while (i < tokens.length) {
        if (i + 2 < tokens.length && tokens[i + 1] === '&') {
          var pair = tokens[i] + ' & ' + tokens[i + 2];
          if (units.indexOf(pair) === -1) units.push(pair);
          i += 3;
        } else {
          var u = tokens[i];
          if (u && units.indexOf(u) === -1) units.push(u);
          i++;
        }
      }
    });
    return units.length > 0 ? units : defaultUnitOptions.slice();
  }

  function syncDropdownFromGoogleSheet() {
    var ts = Date.now();
    var primaryUrl = DROPDOWN_PRIMARY_CSV_URL + '&_t=' + ts;
    var fallbackUrl = DROPDOWN_FALLBACK_CSV_URL + '&_t=' + ts;
    return fetch(primaryUrl, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary HTTP ' + res.status);
        return res.text();
      })
      .catch(function () {
        return fetch(fallbackUrl, { cache: 'no-cache' }).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP ' + res2.status);
          return res2.text();
        });
      })
      .then(function (csvText) {
        var parsed = parseDropdownCSV(csvText);
        if (parsed && parsed.length > 0) {
          cachedUnitOptions = parsed;
          saveDropdownToCache(parsed);
          populateUnitDropdown(parsed);
        }
        return parsed;
      })
      .catch(function (err) {
        console.warn('Silent sync of dropdown failed, using cache:', err);
        return cachedUnitOptions;
      });
  }

  function initDropdownOptions() {
    loadDropdownFromCache().then(function (cached) {
      if (cached && cached.length > 0) {
        cachedUnitOptions = cached;
        populateUnitDropdown(cached);
      } else {
        populateUnitDropdown(defaultUnitOptions);
      }
      syncDropdownFromGoogleSheet();
    }).catch(function () {
      populateUnitDropdown(defaultUnitOptions);
      syncDropdownFromGoogleSheet();
    });
  }

  function populateUnitDropdown(options) {
    var select = document.getElementById('chk-select-unit');
    if (!select) return;
    var currentVal = select.value;
    select.innerHTML = '<option value="" disabled ' + (!currentVal ? 'selected' : '') + '>-- Select Unit --</option>';
    (options || defaultUnitOptions).forEach(function (opt) {
      var optEl = document.createElement('option');
      optEl.value = opt;
      optEl.textContent = opt;
      if (opt === currentVal) optEl.selected = true;
      select.appendChild(optEl);
    });
  }

  function getActiveUser() {
    try {
      return sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user') || 'Admin';
    } catch (e) {
      return 'Admin';
    }
  }

  function getFormattedTimestamp() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear() + ' ' +
           pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }

  function formatDateToDDMMYYYY(val) {
    if (!val) return '';
    var clean = String(val).trim();
    // Already DD-MM-YYYY or DD/MM/YYYY
    var m1 = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m1) {
      return m1[1].padStart(2, '0') + '-' + m1[2].padStart(2, '0') + '-' + m1[3];
    }
    // YYYY-MM-DD
    var m2 = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m2) {
      return m2[3].padStart(2, '0') + '-' + m2[2].padStart(2, '0') + '-' + m2[1];
    }
    var d = new Date(clean);
    if (!isNaN(d.getTime())) {
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      return dd + '-' + mm + '-' + yyyy;
    }
    return clean;
  }

  function formatDDMMYYYYToISO(val) {
    if (!val) return '';
    var clean = String(val).trim();
    var m = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
      return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    return clean;
  }

  function parseDateForSort(val) {
    if (!val) return 0;
    var str = String(val).trim();
    var m1 = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m1) {
      return new Date(parseInt(m1[3], 10), parseInt(m1[2], 10) - 1, parseInt(m1[1], 10)).getTime();
    }
    var m2 = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m2) {
      return new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10)).getTime();
    }
    var t = new Date(str).getTime();
    return isNaN(t) ? 0 : t;
  }

  // ---------------------------------------------------------------------------
  // 1.2 Real-time Calculation & Strict Constraint Engine
  // ---------------------------------------------------------------------------
  function updateCheckingFormCalculations() {
    var checkedInput = document.getElementById('chk-input-checked-qty');
    var repairInput = document.getElementById('chk-input-repair-qty');
    var wmInput = document.getElementById('chk-input-workmanship');
    var cnInput = document.getElementById('chk-input-construction');
    var edInput = document.getElementById('chk-input-edge-inking');
    var lhInput = document.getElementById('chk-input-leather-hardware');
    var otInput = document.getElementById('chk-input-other-defects');
    var rwInput = document.getElementById('chk-input-rework-wh');

    var checkedVal = parseInt(checkedInput && checkedInput.value !== '' ? checkedInput.value : 0, 10);
    if (isNaN(checkedVal) || checkedVal < 0) checkedVal = 0;

    var repairVal = parseInt(repairInput && repairInput.value !== '' ? repairInput.value : 0, 10);
    if (isNaN(repairVal) || repairVal < 0) repairVal = 0;

    // Rule 1: Checked Qty er theke Repair Qty sobsomoy equal ba tar theke kom hbe
    var repairErrorEl = document.getElementById('chk-repair-qty-error');
    var isRepairValid = true;

    if (repairInput && repairInput.value !== '') {
      if (repairVal > checkedVal) {
        isRepairValid = false;
        if (repairErrorEl) {
          repairErrorEl.textContent = 'Repair Qty (' + repairVal + ') cannot exceed Checked Qty (' + checkedVal + ')';
          repairErrorEl.style.display = 'block';
        }
        repairInput.style.borderColor = '#dc2626';
        repairInput.style.background = '#fef2f2';
      } else {
        if (repairErrorEl) repairErrorEl.style.display = 'none';
        repairInput.style.borderColor = '#cbd5e1';
        repairInput.style.background = '#ffffff';
      }
    } else {
      if (repairErrorEl) repairErrorEl.style.display = 'none';
      if (repairInput) {
        repairInput.style.borderColor = '#cbd5e1';
        repairInput.style.background = '#ffffff';
      }
    }

    // Rule 2: Defects & Rework Breakdown fields sum == repairVal
    var wm = parseInt(wmInput && wmInput.value !== '' ? wmInput.value : 0, 10) || 0;
    var cn = parseInt(cnInput && cnInput.value !== '' ? cnInput.value : 0, 10) || 0;
    var ed = parseInt(edInput && edInput.value !== '' ? edInput.value : 0, 10) || 0;
    var lh = parseInt(lhInput && lhInput.value !== '' ? lhInput.value : 0, 10) || 0;
    var ot = parseInt(otInput && otInput.value !== '' ? otInput.value : 0, 10) || 0;
    var rw = parseInt(rwInput && rwInput.value !== '' ? rwInput.value : 0, 10) || 0;

    var defectSum = wm + cn + ed + lh + ot + rw;
    var isSumMatched = (defectSum === repairVal);
    var diff = repairVal - defectSum;

    var sumBadgeEl = document.getElementById('chk-defect-sum-badge');
    var sumTextEl = document.getElementById('chk-defect-sum-text');
    var balanceCard = document.getElementById('chk-defect-balance-card');
    var balanceStatusEl = document.getElementById('chk-balance-status-text');

    if (sumTextEl) {
      sumTextEl.textContent = defectSum + ' / ' + repairVal;
    }

    if (balanceStatusEl) {
      if (isSumMatched) {
        balanceStatusEl.textContent = 'Balanced (Defects Sum ' + defectSum + ' = Repair Qty ' + repairVal + ')';
        balanceStatusEl.style.color = '#059669';
      } else if (diff > 0) {
        balanceStatusEl.textContent = 'Need ' + diff + ' more in breakdown fields to match Repair Qty (' + repairVal + ')';
        balanceStatusEl.style.color = '#d97706';
      } else {
        balanceStatusEl.textContent = 'Breakdown sum exceeds Repair Qty by ' + Math.abs(diff) + ' (Sum: ' + defectSum + ', Max: ' + repairVal + ')';
        balanceStatusEl.style.color = '#dc2626';
      }
    }

    if (balanceCard) {
      if (isSumMatched) {
        balanceCard.style.borderLeftColor = '#059669';
        balanceCard.style.borderColor = '#bbf7d0';
        balanceCard.style.background = '#f0fdf4';
      } else if (diff > 0) {
        balanceCard.style.borderLeftColor = '#f59e0b';
        balanceCard.style.borderColor = '#fde68a';
        balanceCard.style.background = '#fffbeb';
      } else {
        balanceCard.style.borderLeftColor = '#ef4444';
        balanceCard.style.borderColor = '#fecaca';
        balanceCard.style.background = '#fef2f2';
      }
    }

    if (sumBadgeEl) {
      if (isSumMatched) {
        sumBadgeEl.style.background = '#059669';
        sumBadgeEl.style.color = '#ffffff';
        sumBadgeEl.textContent = 'Balanced: ' + defectSum + ' = ' + repairVal;
      } else {
        sumBadgeEl.style.background = diff > 0 ? '#d97706' : '#dc2626';
        sumBadgeEl.style.color = '#ffffff';
        sumBadgeEl.textContent = (diff > 0 ? 'Remaining: +' : 'Exceeded: -') + Math.abs(diff) + ' (Sum: ' + defectSum + ')';
      }
    }

    return {
      isRepairValid: isRepairValid,
      isSumMatched: isSumMatched,
      checkedVal: checkedVal,
      repairVal: repairVal,
      defectSum: defectSum,
      diff: diff
    };
  }

  function openCheckingFormModal() {
    var modal = document.getElementById('checking-details-form-modal');
    if (!modal) return;

    var dateInput = document.getElementById('chk-input-date');
    var dateNative = document.getElementById('chk-input-date-native');
    if (dateInput && !dateInput.value) {
      var d = new Date();
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      dateInput.value = dd + '-' + mm + '-' + yyyy;
      if (dateNative) dateNative.value = yyyy + '-' + mm + '-' + dd;
    }

    var userEl = document.getElementById('chk-display-username');
    if (userEl) userEl.textContent = getActiveUser();

    var timeEl = document.getElementById('chk-display-timestamp');
    if (timeEl) timeEl.textContent = getFormattedTimestamp();

    populateUnitDropdown(cachedUnitOptions);
    updateCheckingFormCalculations();

    modal.classList.add('active');

    setTimeout(function () {
      var unitSelect = document.getElementById('chk-select-unit');
      if (unitSelect && !unitSelect.value) unitSelect.focus();
      else {
        var skuInput = document.getElementById('chk-input-sku');
        if (skuInput) skuInput.focus();
      }
    }, 60);
  }

  function closeCheckingFormModal() {
    var modal = document.getElementById('checking-details-form-modal');
    if (modal) modal.classList.remove('active');
  }

  function resetCheckingForm() {
    var form = document.getElementById('checking-details-form');
    if (form) form.reset();

    var submitBtn = document.getElementById('btn-submit-checking-details-form');
    var submitIcon = document.getElementById('chk-submit-icon');
    var submitText = document.getElementById('chk-submit-text');
    if (submitBtn) submitBtn.disabled = false;
    if (submitIcon) {
      submitIcon.textContent = 'save';
      submitIcon.classList.remove('bai-sheet-spin');
    }
    if (submitText) submitText.textContent = 'Save Record';

    var dateInput = document.getElementById('chk-input-date');
    var dateNative = document.getElementById('chk-input-date-native');
    if (dateInput) {
      var d = new Date();
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      dateInput.value = dd + '-' + mm + '-' + yyyy;
      if (dateNative) dateNative.value = yyyy + '-' + mm + '-' + dd;
    }

    var userEl = document.getElementById('chk-display-username');
    if (userEl) userEl.textContent = getActiveUser();

    var timeEl = document.getElementById('chk-display-timestamp');
    if (timeEl) timeEl.textContent = getFormattedTimestamp();

    updateCheckingFormCalculations();
  }

  function handleCheckingFormSubmit(e) {
    e.preventDefault();

    var dateInput = document.getElementById('chk-input-date');
    var unitSelect = document.getElementById('chk-select-unit');
    var skuInput = document.getElementById('chk-input-sku');
    var fabInput = document.getElementById('chk-input-fabricator');
    var checkedQtyInput = document.getElementById('chk-input-checked-qty');
    var repairQtyInput = document.getElementById('chk-input-repair-qty');
    var workmanshipInput = document.getElementById('chk-input-workmanship');
    var constructionInput = document.getElementById('chk-input-construction');
    var edgeInkingInput = document.getElementById('chk-input-edge-inking');
    var leatherHwInput = document.getElementById('chk-input-leather-hardware');
    var otherDefectsInput = document.getElementById('chk-input-other-defects');
    var reworkWhInput = document.getElementById('chk-input-rework-wh');

    var vDate = dateInput ? formatDateToDDMMYYYY(dateInput.value.trim()) : '';
    var vUnit = unitSelect ? unitSelect.value.trim() : '';
    var vSku = skuInput ? skuInput.value.trim() : '';
    var vFab = fabInput ? fabInput.value.trim() : '';
    var vCheckedQty = checkedQtyInput ? checkedQtyInput.value.trim() : '';
    var vRepairQty = repairQtyInput ? repairQtyInput.value.trim() : '';
    var vWorkmanship = workmanshipInput ? workmanshipInput.value.trim() : '';
    var vConstruction = constructionInput ? constructionInput.value.trim() : '';
    var vEdgeInking = edgeInkingInput ? edgeInkingInput.value.trim() : '';
    var vLeatherHw = leatherHwInput ? leatherHwInput.value.trim() : '';
    var vOtherDefects = otherDefectsInput ? otherDefectsInput.value.trim() : '';
    var vReworkWh = reworkWhInput ? reworkWhInput.value.trim() : '';

    // Field Requirements (Fabricator Name/No is OPTIONAL; ALL OTHER FIELDS REQUIRED)
    if (!vDate) {
      showToast('Date is required (DD-MM-YYYY)', 'warning');
      if (dateInput) dateInput.focus();
      return;
    }
    if (!/^\d{2}-\d{2}-\d{4}$/.test(vDate)) {
      showToast('Date must be in DD-MM-YYYY format (e.g. 14-09-2026)', 'error');
      if (dateInput) dateInput.focus();
      return;
    }
    if (!vUnit) {
      showToast('Unit is required. Please select a unit.', 'warning');
      if (unitSelect) unitSelect.focus();
      return;
    }
    if (!vSku) {
      showToast('Design Ref & SKU is required', 'warning');
      if (skuInput) skuInput.focus();
      return;
    }
    if (vCheckedQty === '') {
      showToast('Checked Qty is required', 'warning');
      if (checkedQtyInput) checkedQtyInput.focus();
      return;
    }
    if (vRepairQty === '') {
      showToast('Repair Qty is required', 'warning');
      if (repairQtyInput) repairQtyInput.focus();
      return;
    }

    // Fabricator Name/No (vFab) is OPTIONAL - do not validate

    if (vWorkmanship === '') {
      showToast('Workmanship Qty is required (enter 0 if none)', 'warning');
      if (workmanshipInput) workmanshipInput.focus();
      return;
    }
    if (vConstruction === '') {
      showToast('Construction Qty is required (enter 0 if none)', 'warning');
      if (constructionInput) constructionInput.focus();
      return;
    }
    if (vEdgeInking === '') {
      showToast('Edge Inking & Colour Qty is required (enter 0 if none)', 'warning');
      if (edgeInkingInput) edgeInkingInput.focus();
      return;
    }
    if (vLeatherHw === '') {
      showToast('Leather & Hardware Defects Qty is required (enter 0 if none)', 'warning');
      if (leatherHwInput) leatherHwInput.focus();
      return;
    }
    if (vOtherDefects === '') {
      showToast('Other Defects Qty is required (enter 0 if none)', 'warning');
      if (otherDefectsInput) otherDefectsInput.focus();
      return;
    }
    if (vReworkWh === '') {
      showToast('Rework at W/H Qty is required (enter 0 if none)', 'warning');
      if (reworkWhInput) reworkWhInput.focus();
      return;
    }

    // Strict Calculation Checks
    var calc = updateCheckingFormCalculations();

    // Constraint 1: Checked Qty er theke Repair Qty sobsomoy equal ba tar theke kom hbe
    if (!calc.isRepairValid) {
      showToast('Repair Qty (' + calc.repairVal + ') cannot exceed Checked Qty (' + calc.checkedVal + ')', 'error');
      if (repairQtyInput) repairQtyInput.focus();
      return;
    }

    // Constraint 2: Defects & Rework Breakdown fields sum == Repair Qty
    if (!calc.isSumMatched) {
      var msg = calc.diff > 0
        ? 'Defects & Rework sum (' + calc.defectSum + ') is less than Repair Qty (' + calc.repairVal + '). Please allocate ' + calc.diff + ' more.'
        : 'Defects & Rework sum (' + calc.defectSum + ') exceeds Repair Qty (' + calc.repairVal + ') by ' + Math.abs(calc.diff) + '.';
      showToast(msg, 'error');
      if (workmanshipInput) workmanshipInput.focus();
      return;
    }

    var vUser = getActiveUser();
    var vTime = getFormattedTimestamp();

    // 14 columns total (A to L + Username + Timestamp)
    var rowData14 = [
      vDate,
      vUnit,
      vSku,
      vCheckedQty,
      vRepairQty,
      vFab,
      vWorkmanship,
      vConstruction,
      vEdgeInking,
      vLeatherHw,
      vOtherDefects,
      vReworkWh,
      vUser,
      vTime
    ];

    // 1. Instant local IndexedDB update: prepend to allRows and refresh table UI
    allRows.unshift(rowData14);
    saveToCache(allHeaders, allRows);
    applyAllFiltersAndSearch();

    // 2. Instant UI feedback: confirmation state and instant modal closure
    var submitBtn = document.getElementById('btn-submit-checking-details-form');
    var submitIcon = document.getElementById('chk-submit-icon');
    var submitText = document.getElementById('chk-submit-text');
    if (submitBtn) submitBtn.disabled = true;
    if (submitIcon) {
      submitIcon.textContent = 'check';
      submitIcon.classList.remove('bai-sheet-spin');
    }
    if (submitText) submitText.textContent = 'Saved!';

    // Close modal and reset form immediately
    setTimeout(function () {
      closeCheckingFormModal();
      resetCheckingForm();
    }, 120);

    // Instant toast notification
    showToast('Record saved successfully! Added by: ' + vUser, 'success');

    // 3. Asynchronously submit to Google Sheet via Apps Script Web App in the background
    var payload = {
      action: 'saveCheckingDetailsData',
      rowData: rowData14
    };

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    }).then(function () {
      console.log('Checking details background sync completed successfully.');
    }).catch(function (err) {
      console.warn('Checking details background submission notice:', err);
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
      if (curRow.length === 0) return;
      while (curRow.length < NUM_COLS) curRow.push('');
      if (curRow.length > NUM_COLS) curRow = curRow.slice(0, NUM_COLS);

      if (isFirstRow) {
        var h0 = curRow[0].toLowerCase();
        if (h0.indexOf('date') !== -1 || h0 === 'date') {
          allHeaders = defaultHeaders.slice();
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
    updateSyncUI(true, isManual ? 'Fetching latest Checking Details from Google Sheet...' : 'Updating Checking Details cache...');

    var ts = Date.now();
    fetch(PRIMARY_CSV_URL + '&_t=' + ts)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching primary CSV');
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 5) throw new Error('Primary CSV empty');
        return csvText;
      })
      .catch(function (primaryErr) {
        console.warn('Primary export CSV failed, trying GViz fallback...', primaryErr);
        return fetch(FALLBACK_CSV_URL + '&_t=' + ts).then(function (res2) {
          if (!res2.ok) throw new Error('HTTP ' + res2.status + ' fetching GViz fallback');
          return res2.text();
        });
      })
      .then(function (csvText) {
        var parsed = parseCSVStream(csvText);
        allRows = parsed || [];
        lastSyncTime = Date.now();
        return saveToCache(allHeaders, allRows);
      })
      .catch(function (csvErr) {
        console.warn('GVIZ CSV sync failed, trying Apps Script fallback...', csvErr);
        return fetch(APPS_SCRIPT_URL + '?action=getCheckingDetailsData&_=' + Date.now())
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' from Apps Script');
            return res.json();
          })
          .then(function (result) {
            if (!result || !result.success) throw new Error((result && result.error) || 'Failed to fetch from Apps Script');
            allHeaders = defaultHeaders.slice();
            allRows = Array.isArray(result.rows) ? result.rows : [];
            lastSyncTime = Date.now();
            return saveToCache(allHeaders, allRows);
          });
      })
      .then(function () {
        applyAllFiltersAndSearch();
        updateHeaderBadge();
        updateSyncUI(false);
        showToast('Successfully synced ' + allRows.length.toLocaleString() + ' records', 'success');
      })
      .catch(function (err) {
        console.error('Checking Details sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Checking Details from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 13) ? cached.headers : defaultHeaders.slice();
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
    var thead = document.getElementById('checking-details-sheet-thead');
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
    var searchInput = document.getElementById('checking-details-sheet-search-input');
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

      // 2. Global search across all 12 columns
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

    var searchClear = document.getElementById('checking-details-sheet-search-clear');
    if (searchClear) searchClear.style.display = rawSearch ? 'block' : 'none';

    // Update th active state
    var thead = document.getElementById('checking-details-sheet-thead');
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
    var bar = document.getElementById('checking-details-sheet-active-filters-bar');
    var chipsContainer = document.getElementById('checking-details-sheet-active-filters-chips');
    if (!bar || !chipsContainer) return;

    var filterKeys = Object.keys(activeColumnFilters);
    if (filterKeys.length === 0) {
      bar.style.display = 'none';
      chipsContainer.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    chipsContainer.innerHTML = '';

    filterKeys.forEach(function (colIdxStr) {
      var colIdx = parseInt(colIdxStr, 10);
      var selectedSet = activeColumnFilters[colIdx];
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));

      var chip = document.createElement('div');
      chip.className = 'floor-qc-filter-chip';
      chip.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:#e0f2fe; color:#0369a1; border:1px solid #7dd3fc; border-radius:4px; padding:3px 8px; font-size:11.5px; font-weight:600;';

      var chipLabel = document.createElement('span');
      chipLabel.textContent = colName + ': ' + selectedSet.size + ' selected';

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.style.cssText = 'background:none; border:none; cursor:pointer; color:#0284c7; padding:0; display:flex; align-items:center; line-height:1; font-size:14px;';
      removeBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">close</span>';
      removeBtn.title = 'Remove ' + colName + ' filter';
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
      });

      chip.appendChild(chipLabel);
      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Column Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
    var popover = document.getElementById('checking-details-sheet-filter-popover');
    var popTitle = document.getElementById('checking-details-sheet-filter-pop-title');
    var searchInput = document.getElementById('checking-details-sheet-filter-search-input');
    var searchClear = document.getElementById('checking-details-sheet-filter-search-clear');
    if (!popover) return;

    if (popTitle) popTitle.textContent = 'Filter: ' + colName;
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';
    currentFilterSearchQuery = '';

    // Calculate unique values and their frequencies across ALL rows
    var valCounts = {};
    allRows.forEach(function (row) {
      var val = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
      valCounts[val] = (valCounts[val] || 0) + 1;
    });

    currentFilterValueCounts = valCounts;
    var uniques = Object.keys(valCounts);
    uniques.sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    currentFilterUniqueValues = uniques;

    // Currently selected values
    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(uniques);
    }

    renderFilterList();

    // Position Popover
    var rect = anchorBtn.getBoundingClientRect();
    var popW = 285;
    var left = rect.left;
    if (left + popW > window.innerWidth - 12) {
      left = Math.max(10, window.innerWidth - popW - 14);
    }
    popover.style.left = left + 'px';
    popover.style.top = (rect.bottom + 6) + 'px';
    popover.style.display = 'block';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 60);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('checking-details-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('checking-details-sheet-filter-list');
    var countEl = document.getElementById('checking-details-sheet-filter-items-count');
    if (!listEl) return;
    listEl.innerHTML = '';

    var query = currentFilterSearchQuery.toLowerCase().trim();
    var displayValues = currentFilterUniqueValues.filter(function (val) {
      if (!query) return true;
      var str = val === '' ? '(blanks)' : val;
      return str.toLowerCase().indexOf(query) !== -1;
    });

    if (countEl) countEl.textContent = displayValues.length + ' items';

    if (displayValues.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#94a3b8;font-size:12px;">No values match search</div>';
      return;
    }

    displayValues.forEach(function (val) {
      var item = document.createElement('label');
      item.className = 'bai-sheet-filter-item';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.addEventListener('change', function () {
        if (chk.checked) currentFilterSelectedSet.add(val);
        else currentFilterSelectedSet.delete(val);
      });

      var span = document.createElement('span');
      span.className = 'bai-sheet-filter-val-text';
      span.textContent = val === '' ? '(Blanks)' : val;
      if (val === '') span.style.fontStyle = 'italic';

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-val-count';
      countBadge.textContent = currentFilterValueCounts[val] || 0;

      item.appendChild(chk);
      item.appendChild(span);
      item.appendChild(countBadge);
      listEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Table Page & Cell Selection Rendering (12 Columns: Checking Details)
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('checking-details-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="14" class="bai-sheet-table-empty">' +
      '<div class="bai-sheet-empty-wrap">' +
      '<span class="material-icons-round bai-sheet-spin" style="font-size:24px;color:#0284c7;">sync</span>' +
      '<span>' + msg + '</span>' +
      '</div></td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('checking-details-sheet-tbody');
    var countLabel = document.getElementById('checking-details-sheet-count-label');
    var showingRange = document.getElementById('checking-details-sheet-showing-range');
    var totalPagesEl = document.getElementById('checking-details-sheet-total-pages');
    var pageNumInput = document.getElementById('checking-details-sheet-page-num');
    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in Checking Details sheet.' : 'No matching records found.') + '</td></tr>';
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

      allHeaders.forEach(function (hName, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }
        var val = row[colIdx];
        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Columns:
        // 0: DATE
        // 1: UNIT
        // 2: DESIGN REF & SKU
        // 3: CHECKED QTY
        // 4: REPAIR QTY
        // 5: Fabricator Name/No
        // 6: WORKMANSHIP QTY
        // 7: CONSTRUCTION QTY
        // 8: EDGE INKING & COLOUR QTY
        // 9: LEATHER & HARDWARE Defects QTY
        // 10: Other Defects QTY
        // 11: Rework at W/H Qty
        // 12: ENTERED BY / TIME (User in row[12], Timestamp in row[13])

        if (colIdx === 0) { // DATE
          td.style.fontWeight = '700';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = formatDateToDDMMYYYY(strVal);
        } else if (colIdx === 1) { // UNIT
          td.style.whiteSpace = 'nowrap';
          if (strVal) {
            var unitBadge = document.createElement('span');
            unitBadge.style.cssText = 'display:inline-block; padding:2px 8px; font-weight:700; border-radius:0px; font-size:11.5px; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;';
            unitBadge.textContent = strVal;
            td.appendChild(unitBadge);
          } else {
            td.textContent = '';
          }
        } else if (colIdx === 2) { // DESIGN REF & SKU
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.style.letterSpacing = '0.2px';
          td.textContent = strVal;
        } else if (colIdx === 3) { // CHECKED QTY
          td.style.textAlign = 'right';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.style.fontWeight = '700';
          td.style.color = '#047857';
          td.textContent = strVal;
        } else if (colIdx === 4) { // REPAIR QTY
          td.style.textAlign = 'right';
          td.style.fontVariantNumeric = 'tabular-nums';
          var numRepair = parseFloat(strVal);
          if (!isNaN(numRepair) && numRepair > 0) {
            td.style.fontWeight = '700';
            td.style.color = '#be123c';
            var repairBadge = document.createElement('span');
            repairBadge.style.cssText = 'display:inline-block; padding:2px 7px; font-weight:700; border-radius:0px; font-size:11.5px; background:#fff1f2; color:#be123c; border:1px solid #fecdd3;';
            repairBadge.textContent = strVal;
            td.appendChild(repairBadge);
          } else {
            td.style.color = '#64748b';
            td.textContent = strVal || '0';
          }
        } else if (colIdx === 5) { // Fabricator Name/No
          td.style.whiteSpace = 'nowrap';
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.textContent = strVal;
        } else if (colIdx >= 6 && colIdx <= 11) { // Defect and Rework Quantities
          td.style.textAlign = 'right';
          td.style.fontVariantNumeric = 'tabular-nums';
          var numDefect = parseFloat(strVal);
          if (!isNaN(numDefect) && numDefect > 0) {
            td.style.fontWeight = '700';
            td.style.color = '#c2410c';
            td.textContent = strVal;
          } else {
            td.style.color = '#94a3b8';
            td.textContent = strVal || '—';
          }
        } else if (colIdx === 12) { // ENTERED BY / TIME
          td.style.whiteSpace = 'nowrap';
          td.style.verticalAlign = 'middle';
          var entryUser = (row[12] !== undefined && row[12] !== null) ? String(row[12]).trim() : '';
          var entryTime = (row[13] !== undefined && row[13] !== null) ? String(row[13]).trim() : '';

          if (entryUser || entryTime) {
            var auditCard = document.createElement('div');
            auditCard.className = 'bai-entry-audit-badge';

            if (entryUser) {
              var userRow = document.createElement('div');
              userRow.className = 'bai-entry-user-row';
              var userIcon = document.createElement('span');
              userIcon.className = 'material-icons-round';
              userIcon.textContent = 'account_circle';
              var userText = document.createElement('span');
              userText.textContent = entryUser;
              userRow.appendChild(userIcon);
              userRow.appendChild(userText);
              auditCard.appendChild(userRow);
            }

            if (entryTime) {
              var timeRow = document.createElement('div');
              timeRow.className = 'bai-entry-time-row';
              var timeIcon = document.createElement('span');
              timeIcon.className = 'material-icons-round';
              timeIcon.textContent = 'schedule';
              var timeText = document.createElement('span');
              timeText.textContent = entryTime;
              timeRow.appendChild(timeIcon);
              timeRow.appendChild(timeText);
              auditCard.appendChild(timeRow);
            }

            td.appendChild(auditCard);
          } else {
            var legacyBadge = document.createElement('div');
            legacyBadge.className = 'bai-entry-audit-badge bai-entry-audit-badge--legacy';
            var legacyIcon = document.createElement('span');
            legacyIcon.className = 'material-icons-round';
            legacyIcon.style.fontSize = '13px';
            legacyIcon.style.color = '#94a3b8';
            legacyIcon.textContent = 'history';
            var legacyText = document.createElement('span');
            legacyText.style.fontSize = '10.5px';
            legacyText.style.color = '#64748b';
            legacyText.style.fontWeight = '600';
            legacyText.textContent = 'Pre-existing';
            legacyBadge.appendChild(legacyIcon);
            legacyBadge.appendChild(legacyText);
            td.appendChild(legacyBadge);
          }
        } else {
          td.textContent = strVal;
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
    var firstBtn = document.getElementById('checking-details-sheet-first-page');
    var prevBtn = document.getElementById('checking-details-sheet-prev-page');
    var nextBtn = document.getElementById('checking-details-sheet-next-page');
    var lastBtn = document.getElementById('checking-details-sheet-last-page');
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
    var tbody = document.getElementById('checking-details-sheet-tbody');
    if (tbody) {
      var sel = tbody.querySelectorAll('.bai-cell-selected');
      sel.forEach(function (el) { el.classList.remove('bai-cell-selected'); });
    }
    var badge = document.getElementById('checking-details-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function selectCellByCoords(localRowIdx, colIdx) {
    var tbody = document.getElementById('checking-details-sheet-tbody');
    if (!tbody) return;
    var prevSel = tbody.querySelectorAll('.bai-cell-selected');
    prevSel.forEach(function (el) { el.classList.remove('bai-cell-selected'); });

    var target = tbody.querySelector('td[data-r="' + localRowIdx + '"][data-c="' + colIdx + '"]');
    if (target) {
      target.classList.add('bai-cell-selected');
      activeCellCoords = { r: localRowIdx, c: colIdx };
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      var badge = document.getElementById('checking-details-sheet-active-cell-badge');
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
    var tbody = document.getElementById('checking-details-sheet-tbody');
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
  // 9. Excel Export (.xlsx) via SheetJS
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS (XLSX) library not loaded yet', 'error');
      return;
    }
    if (filteredRows.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }

    showToast('Generating Checking Details Excel (.xlsx)...', 'clock');

    setTimeout(function () {
      try {
        var exportData = [allHeaders.slice()];
        filteredRows.forEach(function (row) {
          var exportRow = row.slice(0, 12);
          var entryUser = (row[12] !== undefined && row[12] !== null) ? String(row[12]).trim() : '';
          var entryTime = (row[13] !== undefined && row[13] !== null) ? String(row[13]).trim() : '';
          var auditStr = '';
          if (entryUser && entryTime) {
            auditStr = entryUser + ' (' + entryTime + ')';
          } else if (entryUser) {
            auditStr = entryUser;
          } else if (entryTime) {
            auditStr = entryTime;
          }
          exportRow.push(auditStr);
          exportData.push(exportRow);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(exportData);

        var colWidths = allHeaders.map(function (h, colIdx) {
          var maxLen = (h || '').length;
          for (var r = 0; r < Math.min(filteredRows.length, 250); r++) {
            var val = filteredRows[r][colIdx];
            if (val !== undefined && val !== null) {
              var s = String(val);
              if (s.length > maxLen) maxLen = s.length;
            }
          }
          return { wch: Math.min(Math.max(maxLen + 3, 11), 40) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Checking Details');

        var today = new Date().toISOString().slice(0, 10);
        var fileName = 'Checking_Details_' + today + '.xlsx';
        XLSX.writeFile(wb, fileName);
        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to ' + fileName, 'download');
      } catch (err) {
        console.error('Checking Details Excel export failed:', err);
        showToast('Excel export failed: ' + (err.message || 'Unknown error'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 10. View Transition
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('warehouse-section-kpi-view');
    var checkingView = document.getElementById('checking-details-view');
    var rcvdView = document.getElementById('warehouse-received-details-view');
    if (kpiView) kpiView.style.display = 'none';
    if (rcvdView) rcvdView.style.display = 'none';
    if (checkingView) {
      checkingView.style.display = '';
      if (typeof window.hideAccessDeniedCard === 'function') {
        window.hideAccessDeniedCard(checkingView);
      }
      var denied = checkingView.querySelector('.access-denied-card');
      if (denied) denied.remove();
    }

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('checking-details-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var checkingView = document.getElementById('checking-details-view');
    var kpiView = document.getElementById('warehouse-section-kpi-view');
    if (checkingView) checkingView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('checking-details-sheet-db-badge');
    var syncText = document.getElementById('checking-details-sheet-last-sync-text');
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
    var syncBanner = document.getElementById('checking-details-sheet-sync-banner');
    var syncMsg = document.getElementById('checking-details-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('checking-details-sheet-sync-icon');
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
    var existing = document.getElementById('checking-details-sheet-toast');
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
    toast.id = 'checking-details-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.style.zIndex = '99999999';
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 11. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in Warehouse page
    var kpiCard = document.getElementById('kpi-checking-details');
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
    var backBtn = document.getElementById('btn-back-checking-details');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Form Button
    var openFormBtn = document.getElementById('btn-open-checking-details-form');
    if (openFormBtn) {
      openFormBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openCheckingFormModal();
      }, true);
    }

    // Modal Close Buttons
    var closeFormBtn = document.getElementById('btn-close-checking-details-form');
    if (closeFormBtn) {
      closeFormBtn.addEventListener('click', function () {
        closeCheckingFormModal();
      });
    }

    var cancelFormBtn = document.getElementById('btn-cancel-checking-details-form');
    if (cancelFormBtn) {
      cancelFormBtn.addEventListener('click', function () {
        closeCheckingFormModal();
      });
    }

    // Modal Reset Button
    var resetFormBtn = document.getElementById('btn-reset-checking-details-form');
    if (resetFormBtn) {
      resetFormBtn.addEventListener('click', function () {
        resetCheckingForm();
      });
    }

    // Form Submit Event
    var formEl = document.getElementById('checking-details-form');
    if (formEl) {
      formEl.addEventListener('submit', handleCheckingFormSubmit);
    }

    // Date Input & Native Picker Synchronization
    var chkDateInput = document.getElementById('chk-input-date');
    var chkDateNative = document.getElementById('chk-input-date-native');
    if (chkDateNative && chkDateInput) {
      chkDateNative.addEventListener('change', function () {
        if (this.value) {
          chkDateInput.value = formatDateToDDMMYYYY(this.value);
        }
      });
      chkDateInput.addEventListener('change', function () {
        var iso = formatDDMMYYYYToISO(this.value);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          chkDateNative.value = iso;
        }
      });
      chkDateInput.addEventListener('input', function () {
        var v = this.value.replace(/[^0-9-]/g, '');
        if (/^\d{8}$/.test(v)) {
          this.value = v.slice(0, 2) + '-' + v.slice(2, 4) + '-' + v.slice(4, 8);
          var iso2 = formatDDMMYYYYToISO(this.value);
          if (iso2 && /^\d{4}-\d{2}-\d{2}$/.test(iso2)) chkDateNative.value = iso2;
        }
      });
    }

    // Live Calculation Event Watchers (Checked Qty, Repair Qty, and all 6 Breakdown fields)
    var chkCalcFieldIds = [
      'chk-input-checked-qty',
      'chk-input-repair-qty',
      'chk-input-workmanship',
      'chk-input-construction',
      'chk-input-edge-inking',
      'chk-input-leather-hardware',
      'chk-input-other-defects',
      'chk-input-rework-wh'
    ];
    chkCalcFieldIds.forEach(function (fId) {
      var inp = document.getElementById(fId);
      if (inp) {
        inp.addEventListener('input', updateCheckingFormCalculations);
        inp.addEventListener('change', updateCheckingFormCalculations);
      }
    });

    // Modal Backdrop Click
    var modalOverlay = document.getElementById('checking-details-form-modal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeCheckingFormModal();
      });
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-refresh-checking-details-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-checking-details-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportExcelXLSX();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('checking-details-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('checking-details-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('checking-details-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('checking-details-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('checking-details-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('checking-details-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('checking-details-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < tp) {
          currentPage = tp;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('checking-details-sheet-page-num');
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
    var clearAllFiltersBtn = document.getElementById('checking-details-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('checking-details-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('checking-details-sheet-filter-search-input');
    var popSearchClear = document.getElementById('checking-details-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('checking-details-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('checking-details-sheet-filter-clear-all');
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

    var sortAscBtn = document.getElementById('checking-details-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          if (col === 0) return parseDateForSort(a[0]) - parseDateForSort(b[0]);
          return String(a[col] || '').localeCompare(String(b[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (A to Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('checking-details-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          if (col === 0) return parseDateForSort(b[0]) - parseDateForSort(a[0]);
          return String(b[col] || '').localeCompare(String(a[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (Z to A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('checking-details-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('checking-details-sheet-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('checking-details-sheet-filter-ok-btn');
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
      var popover = document.getElementById('checking-details-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('checking-details-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard Navigation & Cell Selection
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('checking-details-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) { e.preventDefault(); return; }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].indexOf(key) !== -1) {
        var tbody = document.getElementById('checking-details-sheet-tbody');
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
      var view = document.getElementById('checking-details-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('checking-details-sheet-tbody');
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
        var formModal = document.getElementById('checking-details-form-modal');
        if (formModal && formModal.classList.contains('active')) {
          closeCheckingFormModal();
          return;
        }
        var popover = document.getElementById('checking-details-sheet-filter-popover');
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
    initDropdownOptions();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === 13) ? cached.headers : defaultHeaders.slice();
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

  window.CheckingDetailsSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; },
    clearSelection: clearCellSelection,
    openForm: openCheckingFormModal,
    closeForm: closeCheckingFormModal
  };

})();
