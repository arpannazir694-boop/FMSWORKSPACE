// =============================================================================
// DieLess.gs — standalone Apps Script Web App for the Machine section
// =============================================================================
// Deploy this file from an Apps Script project as a Web App, then retain its
// /exec URL in main.js. The configured spreadsheet contains:
//   1. "Machine Data"                         columns A:J and L:M (row 1 header)
//   2. "Monthly Machine Inactivity (Data)"   columns B:E, from row 3 (row 3 header)
// =============================================================================

var DIE_LESS_SPREADSHEET_ID = '1mEu7tllGicKVcbL-UWVis67uXnveXiLu1eBFljbThtU';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getMachineData') {
    return jsonOutput_(getMachineData_());
  }
  if (action === 'getMonthlyMachineInactivityData') {
    return jsonOutput_(getContiguousRangeData_('Monthly Machine Inactivity (Data)', 'B', 3, 'E'));
  }

  return jsonOutput_({ success: true, message: 'Die-Less Knife Cutting Machine endpoint is running.' });
}

// "Machine Data" deliberately skips column K, so read the two requested
// ranges separately and merge their headers and each matching data row.
function getMachineData_() {
  try {
    var ss = SpreadsheetApp.openById(DIE_LESS_SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Machine Data');
    if (!sheet) return { success: false, error: 'Sheet "Machine Data" was not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return { success: true, headers: [], rows: [] };

    var leftValues  = sheet.getRange('A1:J' + lastRow).getDisplayValues();
    var rightValues = sheet.getRange('L1:M' + lastRow).getDisplayValues();
    var headers = (leftValues[0] || []).concat(rightValues[0] || []);
    var rows = [];
    for (var i = 1; i < lastRow; i++) {
      var row = (leftValues[i] || []).concat(rightValues[i] || []);
      if (row.some(function (cell) { return String(cell).trim() !== ''; })) rows.push(row);
    }
    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function getContiguousRangeData_(sheetName, startColumn, headerRow, endColumn) {
  try {
    var ss = SpreadsheetApp.openById(DIE_LESS_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: 'Sheet "' + sheetName + '" was not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < headerRow) return { success: true, headers: [], rows: [] };

    var values = sheet.getRange(startColumn + headerRow + ':' + endColumn + lastRow).getDisplayValues();
    var headers = values[0] || [];
    var rows = values.slice(1).filter(function (row) {
      return row.some(function (cell) { return String(cell).trim() !== ''; });
    });
    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
