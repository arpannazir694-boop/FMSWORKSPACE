/**
 * =============================================================================
 * Batch Analysis Bot -- Live Batch Status & Interactive Consultation
 * Strict Requirements:
 * - Pure English throughout: Status bar, executive briefing, chat, and responses
 * - Fast, deterministic Bot engine: Instant answers, no external API hanging
 * - Real-time batch status display with Deep Material Readiness & Start Verdict
 * - Exact Component Readiness Percentage (%) & Production Feasibility Ruling
 * - Itemized Pending Components & Blocker Breakdown (Store & PO status)
 * - NO ROUNDED CORNERS: All UI elements strictly square (border-radius: 0)
 * - NO EMOJIS: Clean SVG and Material Icons only
 * =============================================================================
 */

(function (root) {
  'use strict';

  var activeBatch = null;
  var activeRecord = null;
  var activeReadiness = null;
  var batchStatus = 'EMPTY'; // 'EMPTY' | 'VERIFIED' | 'EXISTS' | 'NOT_FOUND'
  var lastAnnouncedBatch = null;
  var lastAnnouncedStatus = null;
  var chatHistory = [];      // [{ role: 'user'|'bot', text: string, time: string }]

  // ---------------------------------------------------------------------------
  // 0. Batch Lookup Key Normalization (TT/TTF cross-prefix, financial year stripping)
  // ---------------------------------------------------------------------------
  function getBatchLookupKeys(str) {
    if (!str) return [];
    var raw = String(str).trim().toUpperCase();
    if (!raw || raw === '-' || raw === 'BATCH' || raw === 'BATCH NO' || raw === 'DATA NOT FOUND') return [];
    var keys = [raw];

    var clean = raw.replace(/[^A-Z0-9]/gi, '');
    if (clean && keys.indexOf(clean) === -1) keys.push(clean);

    // 1. TTF / TTEF / TT cross-prefix normalization
    var pfxMatch = raw.match(/^(TTF|TTEF|TT)([-_/]?.*)$/);
    if (pfxMatch) {
      var rest = pfxMatch[2];
      var ttVer = 'TT' + rest;
      var ttfVer = 'TTF' + rest;
      var cleanTt = ttVer.replace(/[^A-Z0-9]/gi, '');
      var cleanTtf = ttfVer.replace(/[^A-Z0-9]/gi, '');
      if (keys.indexOf(ttVer) === -1) keys.push(ttVer);
      if (keys.indexOf(ttfVer) === -1) keys.push(ttfVer);
      if (cleanTt && keys.indexOf(cleanTt) === -1) keys.push(cleanTt);
      if (cleanTtf && keys.indexOf(cleanTtf) === -1) keys.push(cleanTtf);
    }

    // 2. Financial year stripping (e.g. /26-27 or -26-27)
    var strippedYear = raw.replace(/[-_/]\d{2}[-_/]\d{2}$/, '');
    if (strippedYear && strippedYear !== raw && keys.indexOf(strippedYear) === -1) {
      keys.push(strippedYear);
      var cleanStripped = strippedYear.replace(/[^A-Z0-9]/gi, '');
      if (cleanStripped && keys.indexOf(cleanStripped) === -1) keys.push(cleanStripped);
    }

    return keys;
  }

  // ---------------------------------------------------------------------------
  // 0.1 Deep Material Readiness Calculation from Raw Connector Rows
  // ---------------------------------------------------------------------------
  function calculateReadinessFromRows(bNo, rows) {
    if (!rows || rows.length === 0) return null;

    var first = rows[0];
    var itb = '-';
    var styleNo = '-';
    var brand = '-';
    var plannedQty = first[13] || '-';
    var prodQty = first[14] || '-';
    var batchQty = first[15] || first[13] || '-';

    var readyItems = [];
    var pendingItems = [];
    var otherItems = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (itb === '-' && r[2] && r[2] !== '-' && String(r[2]).toLowerCase() !== 'itb') {
        itb = String(r[2]).trim();
      }
      if (styleNo === '-' && r[6] && r[6] !== '-' && String(r[6]).toLowerCase() !== 'style no') {
        styleNo = String(r[6]).trim();
      }
      if (brand === '-' && r[5] && r[5] !== '-' && String(r[5]).toLowerCase() !== 'comments') {
        brand = String(r[5]).trim();
      }

      var itemCode = r[3] || '-';
      var itemName = r[4] || 'Item #' + (i + 1);
      var supplierPo = r[9] || '-';
      var status = r[10] || '-';
      var storeStatus = r[11] || '';
      var remarksO = r[12] || '';
      var remarksJyoti = r[16] || '';
      var aiStatus = r[23] || 'No update from Store';

      var ssLower = String(storeStatus).trim().toLowerCase();
      var aiLower = String(aiStatus).trim().toLowerCase();

      var isStoreOk = ssLower === 'ok' || ssLower === 'okay' || ssLower === 'pass' || (ssLower.indexOf('ok') !== -1 && ssLower.indexOf('not') === -1);
      var isStoreNotOk = ssLower === 'not ok' || ssLower === 'notok' || ssLower === 'fail' || ssLower.indexOf('not ok') !== -1;

      var isAiReady = aiLower.indexOf('ready for production') !== -1 || aiLower.indexOf('in stock') !== -1 || aiLower.indexOf('ordered despite in stock') !== -1 || aiLower.indexOf('material received') !== -1;
      var isAiBlocked = aiLower.indexOf('cannot start production') !== -1 || isStoreNotOk;
      var isAiPending = aiLower.indexOf('material pending') !== -1 || aiLower.indexOf('po not created') !== -1 || aiLower.indexOf('po awaited') !== -1 || aiLower.indexOf('no update') !== -1;

      var itemObj = {
        index: i + 1,
        itemCode: itemCode,
        itemName: itemName,
        supplierPo: supplierPo,
        status: status,
        storeStatus: storeStatus || '(Blank)',
        remarks: remarksO || '-',
        remarksJyoti: remarksJyoti || '-',
        aiStatus: aiStatus
      };

      if (isStoreNotOk || isAiBlocked) {
        itemObj.blockerReason = 'Store Manager Sandip Chatterjee marked NOT OK';
        pendingItems.push(itemObj);
      } else if (isStoreOk || (isAiReady && !isStoreNotOk)) {
        readyItems.push(itemObj);
      } else if (isAiPending) {
        itemObj.blockerReason = aiStatus;
        pendingItems.push(itemObj);
      } else {
        itemObj.blockerReason = 'Material Pending';
        otherItems.push(itemObj);
      }
    }

    var totalCount = rows.length;
    var readyCount = readyItems.length;
    var allPending = pendingItems.concat(otherItems);
    var pendingCount = allPending.length;
    var readinessPct = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;

    return {
      batchNo: bNo,
      styleNo: styleNo,
      itb: itb,
      plannedQty: plannedQty,
      prodQty: prodQty,
      batchQty: batchQty,
      brand: brand,
      totalCount: totalCount,
      readyCount: readyCount,
      pendingCount: pendingCount,
      readinessPct: readinessPct,
      readyItems: readyItems,
      pendingItems: allPending,
      allRows: rows
    };
  }

  // ---------------------------------------------------------------------------
  // 0.2 Deep Batch Analysis Controller
  // ---------------------------------------------------------------------------
  function computeDeepBatchAnalysis(batchNo, optRecord) {
    if (!batchNo) return null;
    var bNo = String(batchNo).trim();

    var readiness = null;

    // A. Query ConnectorSheetEngine getBatchMaterialReadiness
    if (root.ConnectorSheetEngine && typeof root.ConnectorSheetEngine.getBatchMaterialReadiness === 'function') {
      try {
        readiness = root.ConnectorSheetEngine.getBatchMaterialReadiness(bNo);
      } catch (e) {
        console.warn('[FmsBaiSuggestions] ConnectorSheetEngine lookup error:', e);
      }
    }

    // B. Query ProductionLiveEngine pre-computed live batches
    if (!readiness && root.ProductionLiveEngine && typeof root.ProductionLiveEngine.getLiveBatches === 'function') {
      try {
        var liveBatches = root.ProductionLiveEngine.getLiveBatches();
        if (Array.isArray(liveBatches) && liveBatches.length > 0) {
          var keys = getBatchLookupKeys(bNo);
          for (var i = 0; i < liveBatches.length; i++) {
            var lb = liveBatches[i];
            if (!lb || !lb.batchNo) continue;
            var lbKeys = getBatchLookupKeys(lb.batchNo);
            var isMatch = keys.some(function (k) { return lbKeys.indexOf(k) !== -1; });
            if (isMatch) {
              readiness = lb;
              break;
            }
          }
        }
      } catch (e) {}
    }

    // C. Fallback: Search all rows directly in ConnectorSheetEngine using normalized keys
    if (!readiness && root.ConnectorSheetEngine && typeof root.ConnectorSheetEngine.getAllRows === 'function') {
      try {
        var allRows = root.ConnectorSheetEngine.getAllRows();
        if (Array.isArray(allRows) && allRows.length > 0) {
          var searchKeys = getBatchLookupKeys(bNo);
          var matchedRows = allRows.filter(function (r) {
            if (!r || !r[0]) return false;
            var rKeys = getBatchLookupKeys(r[0]);
            return searchKeys.some(function (k) { return rKeys.indexOf(k) !== -1; });
          });

          if (matchedRows.length > 0) {
            readiness = calculateReadinessFromRows(bNo, matchedRows);
          }
        }
      } catch (e) {}
    }

    // D. Bantala Details lookup for ERP Issue Date & Material Status
    var erpIssueDate = '';
    var bantalaStatus = '';
    if (root.ConnectorSheetEngine && typeof root.ConnectorSheetEngine.lookupBantalaData === 'function') {
      try {
        var bMatch = root.ConnectorSheetEngine.lookupBantalaData(bNo);
        if (bMatch) {
          var d0 = String(bMatch[0] || '').trim();
          if (d0 && d0 !== '-' && d0 !== '--' && d0.toLowerCase() !== 'data not found' && d0.toLowerCase() !== 'n/a') {
            erpIssueDate = d0;
          }
          bantalaStatus = bMatch[4] || '';
        }
      } catch (e) {}
    }

    // E. Assemble final formatted analysis
    if (readiness) {
      var rPct = typeof readiness.readinessPct === 'number' ? readiness.readinessPct : (readiness.totalCount > 0 ? Math.round((readiness.readyCount / readiness.totalCount) * 100) : 0);
      var pCount = readiness.pendingCount || (readiness.pendingItems ? readiness.pendingItems.length : 0);
      var rCount = readiness.readyCount || (readiness.readyItems ? readiness.readyItems.length : 0);
      var tCount = readiness.totalCount || (rCount + pCount);

      var hasCriticalBlocker = (readiness.pendingItems || []).some(function (it) {
        return (it.storeStatus && String(it.storeStatus).toLowerCase().indexOf('not ok') !== -1) ||
               (it.aiStatus && String(it.aiStatus).toLowerCase().indexOf('cannot start') !== -1);
      });

      var isIssued = false;
      var effErpDate = erpIssueDate || (readiness.erpIssueDate && readiness.erpIssueDate !== '-' ? readiness.erpIssueDate : '');
      if (effErpDate && effErpDate !== '-' && effErpDate !== '--' && effErpDate.toLowerCase() !== 'data not found') {
        isIssued = true;
      }

      var verdict = 'HOLD';
      var verdictText = 'HOLD / CANNOT START (Blockers Pending)';
      var verdictClass = 'verdict-hold';
      var canStartVerdict = 'NO';
      var canStartTitle = 'CANNOT START (HOLD)';
      var canStartSummary = 'DO NOT start production. Critical materials are missing or Store Manager has marked items NOT OK.';

      if (isIssued) {
        verdict = 'ISSUED';
        verdictText = 'ALREADY ISSUED (ERP Issue Date: ' + effErpDate + ')';
        verdictClass = 'verdict-issued';
        canStartVerdict = 'ISSUED';
        canStartTitle = 'ALREADY ISSUED';
        canStartSummary = 'Materials were already issued to the cutting floor on ' + effErpDate + '. Production is active.';
      } else if (hasCriticalBlocker) {
        verdict = 'HOLD';
        verdictText = 'HOLD / CANNOT START (Discrepancy: Store Manager Sandip Chatterjee marked NOT OK)';
        verdictClass = 'verdict-hold';
        canStartVerdict = 'NO';
        canStartTitle = 'CANNOT START (HOLD)';
        canStartSummary = 'Production cannot start right now. Store Manager Sandip Chatterjee flagged component discrepancy (NOT OK).';
      } else if (rPct === 100 && pCount === 0) {
        verdict = 'READY';
        verdictText = 'READY TO START (100% Cleared)';
        verdictClass = 'verdict-ready';
        canStartVerdict = 'YES';
        canStartTitle = 'READY TO START';
        canStartSummary = 'Production can start immediately. 100% of required materials are verified and in stock with zero blockers.';
      } else if (rPct >= 90 && rPct <= 99) {
        verdict = 'ALMOST READY';
        verdictText = 'ALMOST READY (90%–99% Materials Cleared)';
        verdictClass = 'verdict-almost';
        canStartVerdict = 'PREP_OK';
        canStartTitle = 'PRE-PRODUCTION ALLOWED';
        canStartSummary = 'Pre-production and cutting can begin now. Main body materials are in stock, only minor non-critical items pending.';
      } else if (rPct >= 60 && rPct <= 89) {
        verdict = 'CONDITIONAL';
        verdictText = 'CONDITIONAL START (60%–89% Ready - Cutting/Prep Allowed)';
        verdictClass = 'verdict-conditional';
        canStartVerdict = 'CONDITIONAL';
        canStartTitle = 'CONDITIONAL START';
        canStartSummary = 'Cutting and prep allowed on a conditional basis. Assembly and stitching must hold until pending components arrive.';
      } else {
        verdict = 'HOLD';
        verdictText = 'HOLD / CANNOT START (Below 60% Ready - Essential Raw Materials Pending)';
        verdictClass = 'verdict-hold';
        canStartVerdict = 'NO';
        canStartTitle = 'HOLD / DO NOT START';
        canStartSummary = 'Production cannot start right now. Material readiness is below 60%. Essential raw materials are pending receipt.';
      }

      var cuttingQty = (optRecord && optRecord.quantity) || readiness.batchQty || readiness.plannedQty || '-';
      var styleNo = (optRecord && optRecord.styleNo) || readiness.styleNo || '-';
      var brand = (optRecord && optRecord.brandName) || readiness.brand || '-';
      var colour = (optRecord && optRecord.colour) || '-';
      var category = (optRecord && optRecord.category) || '-';

      return {
        batchNo: bNo,
        hasConnectorData: true,
        readinessPct: rPct,
        totalCount: tCount,
        readyCount: rCount,
        pendingCount: pCount,
        verdict: verdict,
        verdictText: verdictText,
        verdictClass: verdictClass,
        canStartVerdict: canStartVerdict,
        canStartTitle: canStartTitle,
        canStartSummary: canStartSummary,
        hasCriticalBlocker: hasCriticalBlocker,
        isIssued: isIssued,
        erpIssueDate: effErpDate || '-',
        bantalaStatus: bantalaStatus,
        cuttingQty: cuttingQty,
        styleNo: styleNo,
        brand: brand,
        colour: colour,
        category: category,
        readyItems: readiness.readyItems || [],
        pendingItems: readiness.pendingItems || []
      };
    }

    // F. If no connector rows exist, but cutting record exists
    if (optRecord) {
      return {
        batchNo: bNo,
        hasConnectorData: false,
        readinessPct: null,
        totalCount: 0,
        readyCount: 0,
        pendingCount: 0,
        verdict: 'NO_CONNECTOR_DATA',
        verdictText: 'Cutting Details Found - Procurement Records Pending in Connector Sheet',
        verdictClass: 'verdict-empty',
        canStartVerdict: 'UNKNOWN',
        canStartTitle: 'AWAITING PROCUREMENT DATA',
        canStartSummary: 'Procurement records have not synced in Connector Sheet yet. Verify physical stock with Store Manager.',
        hasCriticalBlocker: false,
        isIssued: !!erpIssueDate,
        erpIssueDate: erpIssueDate || '-',
        bantalaStatus: bantalaStatus,
        cuttingQty: optRecord.quantity || '0',
        styleNo: optRecord.styleNo || '-',
        brand: optRecord.brandName || '-',
        colour: optRecord.colour || '-',
        category: optRecord.category || '-',
        readyItems: [],
        pendingItems: []
      };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // 1. Status Bar Rendering with Live Material Readiness Gauge & Verdict
  // ---------------------------------------------------------------------------
  function renderStatusBar() {
    var bar = document.getElementById('fms-bai-status-bar');
    if (!bar) return;

    if (!activeBatch || batchStatus === 'EMPTY') {
      bar.innerHTML = [
        '<div class="fms-bai-status-row">',
        '  <span class="fms-bai-batch-badge">',
        '    <span class="material-icons-round">radar</span> Batch Monitor',
        '  </span>',
        '  <span class="fms-bai-pill fms-bai-pill-empty">Waiting for Batch</span>',
        '</div>',
        '<div style="font-size:11.5px;color:#64748b;line-height:1.4;">',
        '  Select or type a Batch ID in the form on the left to monitor live material readiness and start-production feasibility.',
        '</div>'
      ].join('\n');
      return;
    }

    if (batchStatus === 'EXISTS') {
      bar.innerHTML = [
        '<div class="fms-bai-status-row">',
        '  <span class="fms-bai-batch-badge">',
        '    <span class="material-icons-round">qr_code_2</span> Batch ' + activeBatch,
        '  </span>',
        '  <span class="fms-bai-pill fms-bai-pill-exists">',
        '    <span class="material-icons-round" style="font-size:13px;">error_outline</span> Already Submitted',
        '  </span>',
        '</div>',
        '<div style="font-size:11.5px;color:#b91c1c;line-height:1.4;">',
        '  This batch already exists in FMS submitted records. Duplicate submission is blocked.',
        '</div>'
      ].join('\n');
      return;
    }

    if (batchStatus === 'VERIFIED') {
      var r = activeReadiness;
      var qty = (activeRecord && activeRecord.quantity) ? Number(activeRecord.quantity).toLocaleString() + ' pcs' : (r && r.cuttingQty ? Number(r.cuttingQty).toLocaleString() + ' pcs' : 'N/A');
      var brand = (activeRecord && activeRecord.brandName) || (r && r.brand) || 'N/A';
      var style = (activeRecord && activeRecord.styleNo) || (r && r.styleNo) || 'N/A';
      var col = (activeRecord && activeRecord.colour) || (r && r.colour) || 'N/A';
      var cat = (activeRecord && activeRecord.category) || (r && r.category) || 'N/A';

      if (r && r.hasConnectorData) {
        var pct = r.readinessPct;
        var barColor = '#ef4444';
        var pillIcon = 'block';

        if (r.isIssued) {
          barColor = '#3b82f6';
          pillIcon = 'local_shipping';
        } else if (r.verdict === 'READY') {
          barColor = '#10b981';
          pillIcon = 'check_circle';
        } else if (r.verdict === 'ALMOST READY') {
          barColor = '#14b8a6';
          pillIcon = 'hourglass_top';
        } else if (r.verdict === 'CONDITIONAL') {
          barColor = '#f59e0b';
          pillIcon = 'pending_actions';
        } else {
          barColor = '#ef4444';
          pillIcon = 'error';
        }

        var verdictChipClass = 'fms-bai-spec-chip--verdict-no';
        if (r.canStartVerdict === 'YES' || r.canStartVerdict === 'ISSUED') {
          verdictChipClass = 'fms-bai-spec-chip--verdict-yes';
        } else if (r.canStartVerdict === 'CONDITIONAL' || r.canStartVerdict === 'PREP_OK') {
          verdictChipClass = 'fms-bai-spec-chip--verdict-cond';
        }

        bar.innerHTML = [
          '<div class="fms-bai-status-row">',
          '  <span class="fms-bai-batch-badge">',
          '    <span class="material-icons-round">qr_code_2</span> Batch ' + activeBatch,
          '  </span>',
          '  <span class="fms-bai-pill ' + r.verdictClass + '">',
          '    <span class="material-icons-round" style="font-size:13px;">' + pillIcon + '</span> ' + pct + '% ' + (r.isIssued ? 'Issued' : r.verdict),
          '  </span>',
          '</div>',
          '<div class="fms-bai-progress-wrap">',
          '  <div class="fms-bai-progress-track">',
          '    <div class="fms-bai-progress-bar" style="width:' + pct + '%; background:' + barColor + ';"></div>',
          '  </div>',
          '  <span class="fms-bai-progress-label">' + pct + '% Ready</span>',
          '</div>',
          '<div class="fms-bai-quick-specs">',
          '  <span class="fms-bai-spec-chip ' + verdictChipClass + '">Production: <strong>' + r.canStartTitle + '</strong></span>',
          '  <span class="fms-bai-spec-chip">Components: <strong>' + r.readyCount + '/' + r.totalCount + ' Ready</strong> (' + r.pendingCount + ' Pending)</span>',
          '  <span class="fms-bai-spec-chip">Qty: <strong>' + qty + '</strong></span>',
          '  <span class="fms-bai-spec-chip">Style: <strong>' + style + '</strong></span>',
          '  <span class="fms-bai-spec-chip">Colour: <strong>' + col + '</strong></span>',
          r.isIssued ? '  <span class="fms-bai-spec-chip" style="border-color:#93c5fd;background:#eff6ff;color:#1e40af;">ERP Issued: <strong>' + r.erpIssueDate + '</strong></span>' : '',
          '</div>'
        ].join('\n');
        return;
      }

      // In cutting cache, waiting for connector records
      bar.innerHTML = [
        '<div class="fms-bai-status-row">',
        '  <span class="fms-bai-batch-badge">',
        '    <span class="material-icons-round">qr_code_2</span> Batch ' + activeBatch,
        '  </span>',
        '  <span class="fms-bai-pill fms-bai-pill-verified">',
        '    <span class="material-icons-round" style="font-size:13px;">verified</span> In Cutting Cache',
        '  </span>',
        '</div>',
        '<div class="fms-bai-quick-specs">',
        '  <span class="fms-bai-spec-chip">Qty: <strong>' + qty + '</strong></span>',
        '  <span class="fms-bai-spec-chip">Brand: <strong>' + brand + '</strong></span>',
        '  <span class="fms-bai-spec-chip">Style: <strong>' + style + '</strong></span>',
        '  <span class="fms-bai-spec-chip">Colour: <strong>' + col + '</strong></span>',
        '  <span class="fms-bai-spec-chip">Cat: <strong>' + cat + '</strong></span>',
        '</div>'
      ].join('\n');
      return;
    }

    // Not Found
    bar.innerHTML = [
      '<div class="fms-bai-status-row">',
      '  <span class="fms-bai-batch-badge">',
      '    <span class="material-icons-round">qr_code_2</span> Batch ' + activeBatch,
      '  </span>',
      '  <span class="fms-bai-pill fms-bai-pill-empty">Not In Cutting Cache</span>',
      '</div>',
      '<div style="font-size:11.5px;color:#64748b;line-height:1.4;">',
      '  No matching cutting record found. You can proceed with manual entry.',
      '</div>'
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // 2. Chat Stream Rendering & Executive Briefing Formatter (English)
  // ---------------------------------------------------------------------------
  function appendChatMessage(role, text) {
    var stream = document.getElementById('fms-bai-chat-stream');
    if (!stream) return;

    var now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    chatHistory.push({ role: role, text: text, time: now });

    var msgDiv = document.createElement('div');
    msgDiv.className = 'fms-bai-msg fms-bai-msg--' + role;

    var bubble = document.createElement('div');
    bubble.className = 'fms-bai-msg-bubble';

    // Format markdown bold, bullets, and breaks if plain text
    var formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\* (.*$)/gim, '• $1')
      .replace(/\n/g, '<br/>');

    bubble.innerHTML = formatted;

    var timeSpan = document.createElement('span');
    timeSpan.className = 'fms-bai-msg-time';
    timeSpan.textContent = now;

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(timeSpan);
    stream.appendChild(msgDiv);

    setTimeout(function () {
      stream.scrollTop = stream.scrollHeight;
    }, 30);
  }

  function renderExecutiveBriefing(r) {
    if (!r) return;

    var bannerClass = 'banner-hold';
    var bannerIcon = 'error';
    var headline = 'HOLD / CANNOT START PRODUCTION';

    if (r.isIssued) {
      bannerClass = 'banner-issued';
      bannerIcon = 'local_shipping';
      headline = 'MATERIALS ALREADY ISSUED TO FLOOR (ERP: ' + r.erpIssueDate + ')';
    } else if (r.canStartVerdict === 'YES') {
      bannerClass = 'banner-ready';
      bannerIcon = 'check_circle';
      headline = 'READY TO START PRODUCTION (100% Cleared)';
    } else if (r.canStartVerdict === 'PREP_OK') {
      bannerClass = 'banner-almost';
      bannerIcon = 'hourglass_top';
      headline = 'PRE-PRODUCTION / CUTTING CAN START (90%–99% Ready)';
    } else if (r.canStartVerdict === 'CONDITIONAL') {
      bannerClass = 'banner-conditional';
      bannerIcon = 'pending_actions';
      headline = 'CONDITIONAL START (Cutting Allowed / Assembly on Hold)';
    }

    var lines = [];
    lines.push('<div class="fms-bai-verdict-banner ' + bannerClass + '">');
    lines.push('  <span class="material-icons-round" style="font-size:16px;">' + bannerIcon + '</span>');
    lines.push('  <span>' + headline + '</span>');
    lines.push('</div>');

    lines.push('<div class="fms-bai-card-box">');
    lines.push('  <div style="font-size:12px;color:#334155;line-height:1.5;">');
    lines.push('    <strong>Batch:</strong> ' + r.batchNo + ' &nbsp;|&nbsp; <strong>Style:</strong> ' + r.styleNo + ' &nbsp;|&nbsp; <strong>Qty:</strong> ' + (r.cuttingQty ? Number(r.cuttingQty).toLocaleString() : 'N/A') + ' pcs &nbsp;|&nbsp; <strong>Brand:</strong> ' + r.brand);
    lines.push('  </div>');

    if (r.hasConnectorData) {
      lines.push('  <div style="font-size:12px;color:#0f172a;line-height:1.5;">');
      lines.push('    <strong>Material Readiness:</strong> <span style="font-size:13px;font-weight:700;color:' + (r.readinessPct >= 90 ? '#059669' : (r.readinessPct >= 60 ? '#d97706' : '#dc2626')) + ';">' + r.readinessPct + '%</span> (' + r.readyCount + ' of ' + r.totalCount + ' components ready in stock)');
      lines.push('  </div>');

      // Executive Verdict Summary
      lines.push('  <div style="font-size:11.5px;color:#1e293b;line-height:1.45;background:#f8fafc;padding:6px 8px;border-left:3px solid #059669;">');
      if (r.isIssued) {
        lines.push('    <strong>Floor Status:</strong> All required materials were issued on ' + r.erpIssueDate + ' to the cutting floor. Production is active.');
      } else if (r.canStartVerdict === 'YES') {
        lines.push('    <strong>Floor Status:</strong> 100% of required materials are in stock and confirmed OK by Store Manager Sandip Chatterjee. Production can start immediately.');
      } else if (r.canStartVerdict === 'PREP_OK') {
        lines.push('    <strong>Floor Status:</strong> Main body materials (leathers/fabrics) are in stock. Pattern cutting and preparation can start now. Remaining ' + r.pendingCount + ' item(s) are expected shortly.');
      } else if (r.canStartVerdict === 'CONDITIONAL') {
        lines.push('    <strong>Floor Status:</strong> Cutting and prep are authorized, but ' + r.pendingCount + ' component(s) are pending at store. Hold assembly/stitching until items arrive.');
      } else {
        lines.push('    <strong>Floor Status:</strong> <strong>DO NOT START PRODUCTION (HOLD).</strong> Critical materials are missing or Store Manager Sandip Chatterjee marked items NOT OK. Clear blockers before floor release.');
      }
      lines.push('  </div>');

      // Pending Components Table (if any)
      if (r.pendingItems && r.pendingItems.length > 0) {
        lines.push('  <div style="margin-top:2px;">');
        lines.push('    <div style="font-size:11px;font-weight:700;color:#991b1b;margin-bottom:4px;display:flex;align-items:center;gap:4px;">');
        lines.push('      <span class="material-icons-round" style="font-size:14px;">warning</span> Pending Materials & Blockers (' + r.pendingItems.length + ' items):');
        lines.push('    </div>');
        lines.push('    <table class="fms-bai-table-mini">');
        lines.push('      <thead><tr><th>Component Item</th><th>Supplier PO</th><th>Blocker / Store Status</th></tr></thead>');
        lines.push('      <tbody>');

        var maxShow = Math.min(r.pendingItems.length, 5);
        for (var p = 0; p < maxShow; p++) {
          var item = r.pendingItems[p];
          var ss = item.storeStatus || '(Blank)';
          var isNotOk = ss.toLowerCase().indexOf('not ok') !== -1;
          var tagClass = isNotOk ? 'fms-bai-status-tag--notok' : 'fms-bai-status-tag--pending';

          lines.push('        <tr>');
          lines.push('          <td><strong>' + (item.itemName || item.itemCode) + '</strong><br/><span style="font-size:10px;color:#64748b;">Code: ' + item.itemCode + '</span></td>');
          lines.push('          <td>' + (item.supplierPo && item.supplierPo !== '-' ? item.supplierPo : '<span style="color:#94a3b8;">Not Issued</span>') + '</td>');
          lines.push('          <td><span class="fms-bai-status-tag ' + tagClass + '">' + (item.blockerReason || ss) + '</span></td>');
          lines.push('        </tr>');
        }

        if (r.pendingItems.length > maxShow) {
          lines.push('        <tr><td colspan="3" style="text-align:center;font-size:10.5px;color:#64748b;background:#f8fafc;">+ ' + (r.pendingItems.length - maxShow) + ' more pending components</td></tr>');
        }

        lines.push('      </tbody>');
        lines.push('    </table>');
        lines.push('  </div>');
      }
    } else {
      lines.push('  <div style="font-size:11.5px;color:#64748b;line-height:1.45;">');
      lines.push('    Cutting details verified, but material procurement records have not synced yet in Connector Sheet. Verify physical stock with Store Manager Sandip Chatterjee.');
      lines.push('  </div>');
    }

    lines.push('</div>');

    appendChatMessage('bot', lines.join('\n'));
  }

  function showTypingIndicator() {
    var stream = document.getElementById('fms-bai-chat-stream');
    if (!stream) return null;

    var typingDiv = document.createElement('div');
    typingDiv.className = 'fms-bai-msg fms-bai-msg--bot';
    typingDiv.id = 'fms-bai-typing-indicator';

    var bubble = document.createElement('div');
    bubble.className = 'fms-bai-msg-bubble';
    bubble.innerHTML = '<span class="fms-bai-typing-dot"></span><span class="fms-bai-typing-dot"></span><span class="fms-bai-typing-dot"></span>';

    typingDiv.appendChild(bubble);
    stream.appendChild(typingDiv);
    setTimeout(function () {
      stream.scrollTop = stream.scrollHeight;
    }, 30);
    return typingDiv;
  }

  function removeTypingIndicator() {
    var el = document.getElementById('fms-bai-typing-indicator');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function getLoggedInUserName() {
    var raw = '';
    try {
      var u = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
      if (u && u.trim()) raw = u.trim();
    } catch (e) {}
    if (!raw) {
      var topbar = document.getElementById('topbar-user-name') || document.getElementById('profile-name');
      if (topbar && topbar.textContent && topbar.textContent.trim()) {
        var name = topbar.textContent.trim();
        if (name !== 'User' && name !== 'Admin') raw = name;
      }
    }
    if (!raw) return '';

    // Extract ONLY first name (e.g. "Arpan Nazir" -> "Arpan")
    var parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      if (/^(mr\.?|ms\.?|mrs\.?|md\.?|dr\.?)$/i.test(parts[0])) {
        return parts[1] || parts[0];
      }
      return parts[0];
    }
    return raw;
  }

  function resetChat(initialGreeting) {
    chatHistory = [];
    var stream = document.getElementById('fms-bai-chat-stream');
    if (!stream) return;
    stream.innerHTML = '';
    var uName = getLoggedInUserName();
    var greeting = initialGreeting || ((uName ? 'Hello ' + uName + '! ' : 'Hello! ') + 'I am the Batch Analysis Bot. Select or enter a Batch ID in the form on the left to inspect real-time material readiness (%) and determine whether production can start right now.');
    appendChatMessage('bot', greeting);
  }

  // ---------------------------------------------------------------------------
  // 3. Intelligent Deterministic Bot Response Engine (Pure English, Instant)
  // ---------------------------------------------------------------------------
  function generateBotReply(userPrompt) {
    var lower = (userPrompt || '').toLowerCase();
    var userName = getLoggedInUserName();
    var r = activeReadiness;
    var bNo = activeBatch;

    // Guard: No batch selected yet
    if (!bNo || batchStatus === 'EMPTY') {
      return (userName ? userName + ', ' : '') + 'No batch is currently selected. Please select or enter a Batch ID in the form on the left first, and I will analyze its material readiness and production start feasibility.';
    }

    var qty = (activeRecord && activeRecord.quantity) || (r && r.cuttingQty) || '0';
    var brand = (activeRecord && activeRecord.brandName) || (r && r.brand) || 'N/A';
    var style = (activeRecord && activeRecord.styleNo) || (r && r.styleNo) || 'N/A';
    var col = (activeRecord && activeRecord.colour) || (r && r.colour) || 'N/A';
    var cat = (activeRecord && activeRecord.category) || (r && r.category) || 'Standard';

    // A. Query: Can production start right now?
    if (lower.indexOf('start') !== -1 || lower.indexOf('begin') !== -1 || lower.indexOf('feasible') !== -1 || lower.indexOf('production') !== -1 || lower.indexOf('cutting start') !== -1) {
      if (!r || !r.hasConnectorData) {
        return (userName ? userName + ', ' : '') + 'Batch **' + bNo + '** has cutting details verified (' + Number(qty).toLocaleString() + ' pcs, Style: ' + style + '), but procurement rows have not yet synced in Connector Sheet. Verify physical stock with Store Manager Sandip Chatterjee before releasing to the floor.';
      }

      if (r.isIssued) {
        return (userName ? userName + ', ' : '') + 'YES, production is active. Materials for Batch **' + bNo + '** were already issued to the cutting floor on **' + r.erpIssueDate + '**.';
      }

      if (r.canStartVerdict === 'YES') {
        return (userName ? userName + ', ' : '') + 'YES, production can **start immediately** for Batch **' + bNo + '**.\n• Material Readiness: **100%** (' + r.readyCount + '/' + r.totalCount + ' components ready)\n• Status: All items are in stock and confirmed OK by Store Manager Sandip Chatterjee.\n• Zero blockers detected.';
      }

      if (r.canStartVerdict === 'PREP_OK') {
        return (userName ? userName + ', ' : '') + 'Pre-production and cutting can **start right now** for Batch **' + bNo + '**.\n• Material Readiness: **' + r.readinessPct + '%** (' + r.readyCount + '/' + r.totalCount + ' components ready)\n• Primary body materials (leather/fabric) are in stock. Only ' + r.pendingCount + ' non-critical accessory pending arrival.';
      }

      if (r.canStartVerdict === 'CONDITIONAL') {
        return (userName ? userName + ', ' : '') + 'Production can begin on a **CONDITIONAL** basis for Batch **' + bNo + '**:\n• Material Readiness: **' + r.readinessPct + '%** (' + r.readyCount + '/' + r.totalCount + ' components ready)\n• Cutting and pattern preparation are authorized to start, but stitching/assembly must hold until the ' + r.pendingCount + ' pending items arrive from store.';
      }

      return (userName ? userName + ', ' : '') + 'NO, production **cannot start right now (HOLD)** for Batch **' + bNo + '**.\n• Material Readiness: **' + r.readinessPct + '%** (' + r.pendingCount + ' items pending or blocked)\n• Blocker: ' + (r.hasCriticalBlocker ? 'Store Manager Sandip Chatterjee marked items as NOT OK.' : 'Essential raw materials are below the 60% readiness threshold.') + '\n• Do not release to floor until blockers are cleared to avoid assembly stoppage.';
    }

    // B. Query: Material readiness percentage & counts
    if (lower.indexOf('%') !== -1 || lower.indexOf('percent') !== -1 || lower.indexOf('readiness') !== -1 || lower.indexOf('how much') !== -1 || lower.indexOf('count') !== -1) {
      if (r && r.hasConnectorData) {
        return (userName ? userName + ', ' : '') + 'Material Readiness Analysis for Batch **' + bNo + '**:\n• Material Readiness: **' + r.readinessPct + '%**\n• Total Components: **' + r.totalCount + ' items**\n• Ready In-Stock: **' + r.readyCount + ' items**\n• Pending Arrival: **' + r.pendingCount + ' items**\n• Start Decision: **' + r.canStartTitle + '**';
      }
      return 'Batch **' + bNo + '** Cutting Quantity: ' + Number(qty).toLocaleString() + ' pcs. Connector sheet material readiness calculation is pending sync.';
    }

    // C. Query: Pending components / Blockers list
    if (lower.indexOf('pending') !== -1 || lower.indexOf('missing') !== -1 || lower.indexOf('blocker') !== -1 || lower.indexOf('shortage') !== -1 || lower.indexOf('not ok') !== -1 || lower.indexOf('item') !== -1) {
      if (r && r.pendingItems && r.pendingItems.length > 0) {
        var lines = r.pendingItems.slice(0, 5).map(function (it, idx) {
          return (idx + 1) + '. **' + (it.itemName || it.itemCode) + '** (PO: ' + (it.supplierPo || 'N/A') + ') — ' + (it.blockerReason || it.storeStatus);
        });
        return (userName ? userName + ', ' : '') + 'Pending Materials for Batch **' + bNo + '** (' + r.pendingItems.length + ' items):\n' + lines.join('\n') + (r.pendingItems.length > 5 ? '\n• And ' + (r.pendingItems.length - 5) + ' more pending components.' : '') + '\nCheck with Store Manager Sandip Chatterjee for updated delivery ETAs.';
      }
      if (r && r.hasConnectorData && r.pendingCount === 0) {
        return (userName ? userName + ', ' : '') + 'Batch **' + bNo + '** has ZERO pending materials! All 100% of required components are in stock and cleared.';
      }
      return 'Pending item details for Batch **' + bNo + '** will appear once connector sheet rows sync.';
    }

    // D. Query: Quality Inspection & Checkpoints
    if (lower.indexOf('quality') !== -1 || lower.indexOf('defect') !== -1 || lower.indexOf('qc') !== -1 || lower.indexOf('inspection') !== -1) {
      return 'Quality Inspection Checkpoints for Batch **' + bNo + '**:\n• Inspect colour shade uniformity and grain texture for Colour **"' + col + '"**.\n• Verify stitch density (7-8 stitches per inch) for Style **' + style + '**.\n• Verify hardware plating durability and edge paint application consistency.\n• Ensure lining cut matches approved pattern specifications.';
    }

    // E. Query: Production Pace & Timeline
    if (lower.indexOf('pace') !== -1 || lower.indexOf('timeline') !== -1 || lower.indexOf('throughput') !== -1 || lower.indexOf('days') !== -1 || lower.indexOf('how long') !== -1 || lower.indexOf('speed') !== -1) {
      var nQty = Number(qty) || 0;
      var workDays = Math.max(4, Math.ceil(nQty / 80) + 2);
      return 'Production Timeline Estimate for Batch **' + bNo + '**:\n• Cutting Quantity: **' + nQty.toLocaleString() + ' pcs** (' + cat + ')\n• Target Floor Pace: **~80 pcs/day**\n• Estimated Completion: **' + workDays + ' working days** (including cutting setup, stitching, hardware assembly, and final QC inspection).';
    }

    // F. Query: Batch Summary & Overview
    if (lower.indexOf('summary') !== -1 || lower.indexOf('detail') !== -1 || lower.indexOf('overview') !== -1 || lower.indexOf('specs') !== -1 || lower.indexOf('info') !== -1) {
      return (userName ? userName + ', ' : '') + 'Full Summary for Batch **' + bNo + '**:\n• Cutting Qty: **' + Number(qty).toLocaleString() + ' pcs**\n• Brand: **' + brand + '** | Category: **' + cat + '**\n• Style No: **' + style + '** | Colour: **' + col + '**\n• PO as per Buyer: **' + ((activeRecord && activeRecord.poAsPerBuyer) || 'N/A') + '**\n• Material Readiness: **' + (r && r.hasConnectorData ? r.readinessPct + '% (' + r.canStartTitle + ')' : 'Pending sync') + '**\n• All details are synchronized with the form fields.';
    }

    // G. Greetings / Help
    if (lower.indexOf('hi') !== -1 || lower.indexOf('hello') !== -1 || lower.indexOf('hey') !== -1 || lower.indexOf('help') !== -1) {
      return (userName ? 'Hello ' + userName + '! ' : 'Hello! ') + 'I am the Batch Analysis Bot. Here is what I can do for Batch **' + bNo + '**:\n• Check whether production can start right now\n• Calculate material readiness percentage (%)\n• List pending components & blockers\n• Review quality inspection checkpoints\n• Estimate production throughput & timeline.';
    }

    // Default contextual reply
    return (userName ? userName + ', ' : '') + 'Batch Analysis Bot (' + bNo + '):\n• Cutting Qty: **' + Number(qty).toLocaleString() + ' pcs**\n• Style: **' + style + '** | Colour: **' + col + '**\n• Material Readiness: **' + (r && r.hasConnectorData ? r.readinessPct + '% (' + r.canStartTitle + ')' : 'Pending sync') + '**\n• Production Feasibility: **' + (r ? r.canStartSummary : 'Pending material verification') + '**';
  }

  // ---------------------------------------------------------------------------
  // 4. Send User Query & Handle Bot Message Stream
  // ---------------------------------------------------------------------------
  function sendUserQuery(userText) {
    if (!userText || !userText.trim()) return;
    var cleanText = userText.trim();

    appendChatMessage('user', cleanText);
    showTypingIndicator();

    var sendBtn = document.getElementById('fms-bai-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    // Fast, deterministic Bot reply (250ms for natural UX)
    setTimeout(function () {
      removeTypingIndicator();
      if (sendBtn) sendBtn.disabled = false;
      var botReply = generateBotReply(cleanText);
      appendChatMessage('bot', botReply);
    }, 250);
  }

  // ---------------------------------------------------------------------------
  // 5. Initialization & Event Binding
  // ---------------------------------------------------------------------------
  function initEvents() {
    var sendBtn = document.getElementById('fms-bai-chat-send');
    var inputEl = document.getElementById('fms-bai-chat-input');
    var clearBtn = document.getElementById('fms-bai-chat-clear');

    if (sendBtn && inputEl) {
      sendBtn.addEventListener('click', function () {
        var text = inputEl.value.trim();
        if (text) {
          inputEl.value = '';
          sendUserQuery(text);
        }
      });

      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var text = inputEl.value.trim();
          if (text) {
            inputEl.value = '';
            sendUserQuery(text);
          }
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        resetChat();
      });
    }

    // Quick prompt buttons
    var promptBtns = document.querySelectorAll('.fms-bai-prompt-btn');
    promptBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-text');
        if (text) sendUserQuery(text);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Public Controller Interface
  // ---------------------------------------------------------------------------
  var FmsBaiSuggestions = {
    init: function () {
      initEvents();
      resetChat();

      var curBatch = (document.getElementById('hidden-batchId') || {}).value || (document.getElementById('batchAuto') || {}).value;
      if (curBatch) {
        FmsBaiSuggestions.onBatchChanged(curBatch);
      } else {
        renderStatusBar();
      }
    },

    onBatchChanged: function (batchVal) {
      if (!batchVal) {
        FmsBaiSuggestions.reset();
        return;
      }
      var b = String(batchVal).trim();
      if (b === activeBatch && lastAnnouncedBatch === b && lastAnnouncedStatus === batchStatus) {
        return;
      }
      activeBatch = b;

      // Check submitted
      if (root.CuttingDetailsEngine && typeof root.CuttingDetailsEngine.isBatchSubmitted === 'function') {
        if (root.CuttingDetailsEngine.isBatchSubmitted(activeBatch)) {
          FmsBaiSuggestions.onBatchExists(activeBatch);
          return;
        }
      }

      // Check cutting details
      if (root.CuttingDetailsEngine && typeof root.CuttingDetailsEngine.lookupBatchSync === 'function') {
        var rec = root.CuttingDetailsEngine.lookupBatchSync(activeBatch);
        if (rec) {
          FmsBaiSuggestions.onRecordFound(rec, activeBatch);
          return;
        }
      }

      // If not in cutting cache, still check if connector sheet has material records
      var rDirect = computeDeepBatchAnalysis(activeBatch, null);
      if (rDirect && rDirect.hasConnectorData) {
        activeRecord = null;
        activeReadiness = rDirect;
        batchStatus = 'VERIFIED';
        renderStatusBar();
        renderExecutiveBriefing(activeReadiness);
        return;
      }

      FmsBaiSuggestions.onRecordNotFound(activeBatch);
    },

    onRecordFound: function (record, batchVal) {
      var bVal = batchVal || (record && record.batch);
      activeBatch = bVal ? String(bVal).trim() : null;
      activeRecord = record;
      batchStatus = 'VERIFIED';

      // Perform deep material readiness calculation
      activeReadiness = computeDeepBatchAnalysis(activeBatch, activeRecord);
      renderStatusBar();

      // Guard against duplicate announcements for the exact same batch and status
      if (lastAnnouncedBatch === activeBatch && lastAnnouncedStatus === 'VERIFIED') {
        return;
      }
      lastAnnouncedBatch = activeBatch;
      lastAnnouncedStatus = 'VERIFIED';

      // Deliver automatic structured Executive Material Briefing in Chat Stream
      renderExecutiveBriefing(activeReadiness);

      // If Connector Sheet data is still initializing in the background, re-run once ready
      if ((!activeReadiness || !activeReadiness.hasConnectorData) && root.ConnectorSheetEngine && typeof root.ConnectorSheetEngine.ensureDataLoaded === 'function') {
        root.ConnectorSheetEngine.ensureDataLoaded().then(function (loaded) {
          if (loaded && activeBatch === bVal) {
            var reAnalysis = computeDeepBatchAnalysis(activeBatch, activeRecord);
            if (reAnalysis && reAnalysis.hasConnectorData) {
              activeReadiness = reAnalysis;
              renderStatusBar();
              renderExecutiveBriefing(activeReadiness);
            }
          }
        }).catch(function () {});
      }
    },

    onBatchExists: function (batchVal) {
      var bVal = batchVal ? String(batchVal).trim() : null;
      activeBatch = bVal;
      activeRecord = null;
      activeReadiness = null;
      batchStatus = 'EXISTS';
      renderStatusBar();

      if (lastAnnouncedBatch === activeBatch && lastAnnouncedStatus === 'EXISTS') {
        return;
      }
      lastAnnouncedBatch = activeBatch;
      lastAnnouncedStatus = 'EXISTS';

      appendChatMessage('bot', 'Notice: Batch **' + activeBatch + '** has already been submitted in FMS database records. Duplicate entry is blocked.');
    },

    onRecordNotFound: function (batchVal) {
      var bVal = batchVal ? String(batchVal).trim() : null;
      activeBatch = bVal;
      activeRecord = null;
      activeReadiness = null;
      batchStatus = 'NOT_FOUND';
      renderStatusBar();

      if (lastAnnouncedBatch === activeBatch && lastAnnouncedStatus === 'NOT_FOUND') {
        return;
      }
      lastAnnouncedBatch = activeBatch;
      lastAnnouncedStatus = 'NOT_FOUND';

      appendChatMessage('bot', 'Batch **' + activeBatch + '** was not found in the Cutting Details database. You can proceed with manual entry.');
    },

    reset: function () {
      activeBatch = null;
      activeRecord = null;
      activeReadiness = null;
      lastAnnouncedBatch = null;
      lastAnnouncedStatus = null;
      batchStatus = 'EMPTY';
      renderStatusBar();
      resetChat();
    },

    getDeepAnalysis: function () {
      return activeReadiness;
    }
  };

  root.FmsBaiSuggestions = FmsBaiSuggestions;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FmsBaiSuggestions.init);
  } else {
    FmsBaiSuggestions.init();
  }

})(window);
