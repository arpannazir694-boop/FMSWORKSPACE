// =============================================================================
// Warehouse.gs — deploy this file as its OWN standalone Apps Script project / Web App
// =============================================================================
// This is a SEPARATE Google Apps Script project from Code.gs, DICE_FORMA.gs and
// OT.gs. It is bound to a different Google Sheet and must be deployed as its
// own Web App. It powers the two "Warehouse" sub-views in the FMS FORM UI:
//
//   1. Checking Details            -> "CHECKING DETAILS" sheet, range A1:M
//   2. Warehouse Received Details  -> "WAREHOUSE RCVD" sheet,   range A1:V
//
// In every range above, row 1 (the FIRST row of the range) holds the table
// headers, and every row after that is data.
//
// SETUP
// -----
// 1. Create/open a new Apps Script project (Extensions > Apps Script) from
//    the Warehouse spreadsheet itself, OR create a standalone script and keep
//    WAREHOUSE_SPREADSHEET_ID pointed at the sheet below.
// 2. Paste this file in as Warehouse.gs.
// 3. Deploy > New deployment > Web app > Execute as: Me > Who has access:
//    Anyone (or "Anyone with Google account", matching the rest of the app).
// 4. Copy the resulting /exec URL into WAREHOUSE_SECTION_URL near the top of
//    main.js. (The URL already wired into main.js is the one supplied when
//    this integration was built: see main.js for the current value.)
// =============================================================================

var WAREHOUSE_SPREADSHEET_ID = '1oIhZ2pb_Y3JKp-GBrSaHxVdOBp5yDfF_92HsDB-vBck';

var CHECKING_DETAILS_SPREADSHEET_ID = '1Yc_w9UqsB8H2MMpDnjEQx_YS6CeQ14r5vtt681PcARw';
var CHECKING_DETAILS_SHEET          = 'Checking Details';
var CHECKING_DETAILS_RANGE          = 'A1:N';

var WAREHOUSE_RCVD_SPREADSHEET_ID   = '1oIhZ2pb_Y3JKp-GBrSaHxVdOBp5yDfF_92HsDB-vBck';
var WAREHOUSE_RCVD_SHEET            = 'WAREHOUSE RCVD';
var WAREHOUSE_RCVD_RANGE            = 'A1:V';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getCheckingDetailsData') {
    return jsonOutput_(getWarehouseRangeData_(CHECKING_DETAILS_SPREADSHEET_ID, CHECKING_DETAILS_SHEET, CHECKING_DETAILS_RANGE));
  }
  if (action === 'getWarehouseReceivedDetailsData') {
    return jsonOutput_(getWarehouseRangeData_(WAREHOUSE_RCVD_SPREADSHEET_ID, WAREHOUSE_RCVD_SHEET, WAREHOUSE_RCVD_RANGE));
  }
  if (action === 'saveCheckingDetailsData') {
    return jsonOutput_(saveCheckingDetailsRow_(e.parameter));
  }

  return jsonOutput_({ success: true, message: 'Warehouse web app endpoint is running.' });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    var data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (err) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    } else {
      data = {};
    }

    var action = (data && data.action) || (e && e.parameter && e.parameter.action) || '';

    if (action === 'saveCheckingDetailsData') {
      return jsonOutput_(saveCheckingDetailsRow_(data));
    }

    return jsonOutput_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ success: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Appends a single row to the Checking Details sheet (A:N: 12 fields + User + Time)
// ---------------------------------------------------------------------------
function saveCheckingDetailsRow_(params) {
  try {
    if (!params) return { success: false, error: 'No parameters provided.' };

    var ss = SpreadsheetApp.openById(CHECKING_DETAILS_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CHECKING_DETAILS_SHEET);
    if (!sheet) {
      return { success: false, error: 'Sheet "' + CHECKING_DETAILS_SHEET + '" was not found.' };
    }

    // Ensure headers in Row 1 for Column M (13: Username) and Column N (14: Timestamp)
    var headerValues = sheet.getRange(1, 1, 1, 14).getValues()[0];
    if (!headerValues[12] || String(headerValues[12]).trim() === '') {
      sheet.getRange(1, 13).setValue('Username');
    }
    if (!headerValues[13] || String(headerValues[13]).trim() === '') {
      sheet.getRange(1, 14).setValue('Timestamp');
    }

    var rowData = [];
    if (params.rowData && Array.isArray(params.rowData)) {
      rowData = params.rowData;
    } else if (typeof params.rowData === 'string') {
      try { rowData = JSON.parse(params.rowData); } catch (e) { rowData = []; }
    }

    if (!rowData || rowData.length === 0) {
      rowData = [
        params.date || '',
        params.unit || '',
        params.designRefSku || params.design_ref_sku || '',
        params.checkedQty !== undefined ? params.checkedQty : '',
        params.repairQty !== undefined ? params.repairQty : '',
        params.fabricatorNameNo || params.fabricator || '',
        params.workmanshipQty !== undefined ? params.workmanshipQty : '',
        params.constructionQty !== undefined ? params.constructionQty : '',
        params.edgeInkingColourQty !== undefined ? params.edgeInkingColourQty : '',
        params.leatherHardwareDefectsQty !== undefined ? params.leatherHardwareDefectsQty : '',
        params.otherDefectsQty !== undefined ? params.otherDefectsQty : '',
        params.reworkAtWhQty !== undefined ? params.reworkAtWhQty : '',
        params.username || '',
        params.timestamp || ''
      ];
    }

    sheet.appendRow(rowData);
    return { success: true, message: 'Checking details entry saved successfully.', row: rowData };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}


// ---------------------------------------------------------------------------
// Reads a sheet range where the FIRST row of the range is the header row and
// every subsequent row is data. Returns { success, headers: [...], rows: [[...]] }.
// Uses display values so dates/numbers appear formatted exactly as in the sheet.
// ---------------------------------------------------------------------------
function getWarehouseRangeData_(spreadsheetId, sheetName, rangeA1) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId || WAREHOUSE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { success: false, error: 'Sheet "' + sheetName + '" was not found in the Warehouse spreadsheet.' };
    }

    // rangeA1 is a column-bounded range like "A1:M" — pin it to the sheet's
    // actual last row so we don't read millions of empty cells.
    var lastRow = sheet.getLastRow();
    var colMatch = rangeA1.match(/^([A-Z]+)(\d+):([A-Z]+)$/i);
    if (!colMatch) {
      return { success: false, error: 'Invalid range configuration: ' + rangeA1 };
    }
    var startCol   = colMatch[1];
    var headerRow  = parseInt(colMatch[2], 10);
    var endCol     = colMatch[3];

    if (lastRow < headerRow) {
      return { success: true, headers: [], rows: [] };
    }

    var fullRange = startCol + headerRow + ':' + endCol + lastRow;
    var values = sheet.getRange(fullRange).getDisplayValues();

    var headers = values[0] || [];
    var rows    = values.slice(1).filter(function (row) {
      // Skip fully-blank trailing rows
      return row.some(function (cell) { return String(cell).trim() !== ''; });
    });

    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
