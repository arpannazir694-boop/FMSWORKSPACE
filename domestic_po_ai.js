/**
 * =============================================================================
 * Domestic Purchase Order AI -- Pure Gemini API Integration
 * =============================================================================
 * Pure AI Assistant connected directly to Gemini API via API Key:
 * - Direct Gemini API integration with model failover
 * - Real-time context awareness of the active Domestic PO Form
 * - Multilingual conversation (English, Bengali, Hindi)
 * - Fixed size UI with custom narrow scroll bar
 * - Strict Requirements:
 *   - Square aesthetics (border-radius: 0)
 *   - Clean SVG and Google Material Icons only (NO emojis)
 * =============================================================================
 */

(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Gemini API Configuration
  // ---------------------------------------------------------------------------
  var GEMINI_API_KEY = "AQ.Ab8RN6JXysa0sQMKMgJo6wGznX8Kdfxk25cPA3z8x6Ie4ZmlFw";
  var GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash"
  ];

  var chatHistory = []; // [{ role: 'user'|'bot', text: string, time: string }]

  // ---------------------------------------------------------------------------
  // 2. Utilities
  // ---------------------------------------------------------------------------
  function getLoggedInUserName() {
    var raw = '';
    try {
      var u = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
      if (u && u.trim()) raw = u.trim();
    } catch (e) {}
    if (!raw) {
      var topbar = document.getElementById('topbar-username') || document.getElementById('topbar-user-name') || document.getElementById('profile-name');
      if (topbar && topbar.textContent && topbar.textContent.trim()) {
        var name = topbar.textContent.trim();
        if (name !== 'User' && name !== 'Admin') raw = name;
      }
    }
    if (!raw) return '';

    // Extract ONLY first name (e.g. "Md. Arpan" -> "Arpan", "Kamran Sohail" -> "Kamran")
    var parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      if (/^(mr\.?|ms\.?|mrs\.?|md\.?|dr\.?)$/i.test(parts[0])) {
        return parts[1] || parts[0];
      }
      return parts[0];
    }
    return raw;
  }

  function detectLang(text) {
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    var lower = (text || '').toLowerCase();
    if (/\b(namaste|kaisa|kaise|kya|aap|shukriya|dhanyawad|pranam|batao|kitna)\b/.test(lower)) return 'hi';
    if (/\b(kemon|acho|achen|ki|khobor|dhonnobad|thik|bolun|dekhao|koto|kobe|koro)\b/.test(lower)) return 'bn';
    return 'en';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    var escaped = escapeHtml(text);

    // Bold **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Inline code `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;font-family:monospace;font-size:11.5px;color:#0369a1;">$1</code>');

    // Bullet points (lines starting with •, *, -)
    var lines = escaped.split('\n');
    var inList = false;
    var out = [];

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (/^([•\*\-]|&#8226;)\s+(.*)/.test(l)) {
        var match = l.match(/^([•\*\-]|&#8226;)\s+(.*)/);
        if (!inList) {
          out.push('<ul style="margin:4px 0 6px 18px;padding:0;list-style-type:disc;">');
          inList = true;
        }
        out.push('<li style="margin-bottom:3px;line-height:1.4;">' + match[2] + '</li>');
      } else {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
        if (l.length > 0) {
          out.push('<div style="margin-bottom:4px;">' + l + '</div>');
        } else {
          out.push('<div style="height:6px;"></div>');
        }
      }
    }
    if (inList) out.push('</ul>');

    return out.join('');
  }

  function formatTime(date) {
    var d = date || new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    var mm = m < 10 ? '0' + m : m;
    return h + ':' + mm + ' ' + ampm;
  }

  // ---------------------------------------------------------------------------
  // 3. Live Form Context Extraction
  // ---------------------------------------------------------------------------
  function getLiveFormContext() {
    var val = function (id) {
      var el = document.getElementById(id);
      return el ? (el.value || '').trim() : '';
    };

    var msgEl = document.getElementById('domestic-po-number-msg');
    var poMsg = msgEl && msgEl.textContent ? msgEl.textContent.trim() : 'Not verified';

    return {
      poOrderDate: val('domestic-po-order-date'),
      poNumber: val('domestic-po-number'),
      poNumberStatus: poMsg,
      itb: val('domestic-itb'),
      indentDate: val('domestic-indent-date'),
      indentNumber: val('domestic-indent-number'),
      season: val('domestic-season'),
      supplierName: val('domestic-supplier-name'),
      category: val('domestic-category'),
      quantity: val('domestic-quantity'),
      etaDate: val('domestic-eta-date')
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Gemini Direct API Call
  // ---------------------------------------------------------------------------
  function buildSystemInstruction(userName, userQuery) {
    var ctx = getLiveFormContext();
    var lang = detectLang(userQuery);
    var langRule = "";

    if (lang === 'bn') {
      langRule = "MANDATORY: The user spoke in BENGALI. You MUST reply in fluent, professional BENGALI (বাংলা).";
    } else if (lang === 'hi') {
      langRule = "MANDATORY: The user spoke in HINDI. You MUST reply in fluent, professional HINDI (हिंदी).";
    } else {
      langRule = "MANDATORY: The user spoke in ENGLISH. You MUST reply in fluent, professional ENGLISH.";
    }

    return [
      "IDENTITY & CREATOR RULES:",
      "- You are Purchase Order AI, a specialized ERP Procurement and Purchase Order Specialist for the Domestic Purchase Order Form.",
      "- OWNER / CREATOR PRIVACY RULE: Do NOT volunteer or mention your owner's name (Arpan Nazir) or platform identity on simple greetings or regular answers.",
      "- ONLY IF the user specifically asks who created you or who owns you: state clearly in their active conversation language: 'I am Purchase Order AI, part of the AN AI platform created by Arpan Nazir.' (Bengali: 'আমি AN AI-এর পারচেজ অর্ডার এআই (Purchase Order AI), আমার প্রস্তুতকারক অর্পণ নাজির (Arpan Nazir)।', Hindi: 'मैं AN AI का परचेज ऑर्डर एआई हूँ, मेरे निर्माता अर्पण नाजिर (Arpan Nazir) हैं।').",
      "- ABSOLUTE RESTRICTION: NEVER mention or admit that you are Gemini, Google, OpenAI, ChatGPT, or Claude.",
      userName ? "- Address the logged-in user by their first name \"" + userName + "\" politely when appropriate." : "",
      "",
      "ROLE & CORE EXPERTISE:",
      "You specialize in Domestic Procurement, purchase orders, vendor evaluation, delivery lead times, indent validation, and order compliance.",
      "",
      "STRICT LANGUAGE DIRECTIVE:",
      langRule,
      "- Strictly maintain this language throughout your response.",
      "",
      "CURRENT DOMESTIC PURCHASE ORDER FORM (LIVE ACTIVE VALUES):",
      "- PO Order Date: " + (ctx.poOrderDate || 'Empty'),
      "- PO Number: " + (ctx.poNumber || 'Empty') + " [Duplicate Status: " + ctx.poNumberStatus + "]",
      "- ITB Reference: " + (ctx.itb || 'Empty'),
      "- Indent Date: " + (ctx.indentDate || 'Empty'),
      "- Indent Number: " + (ctx.indentNumber || 'Empty'),
      "- Season: " + (ctx.season || 'Empty'),
      "- Supplier Name: " + (ctx.supplierName || 'Empty'),
      "- Category: " + (ctx.category || 'Empty'),
      "- Quantity: " + (ctx.quantity ? ctx.quantity + ' units' : 'Empty'),
      "- ETA Delivery Date: " + (ctx.etaDate || 'Empty'),
      "",
      "INSTRUCTIONS:",
      "- Answer questions clearly, concisely, and intelligently using the live values when relevant.",
      "- If user asks about lead time, calculate the days between PO Order Date and ETA Date accurately.",
      "- If user asks for summary or compliance, check which fields are filled and which are pending.",
      "- NO EMOJIS: Do NOT use emojis under any circumstance. Use clean text and bullet points."
    ].filter(Boolean).join("\n");
  }

  function callGeminiAPI(promptText, historyArr, callback) {
    var userName = getLoggedInUserName();
    var systemInstructionText = buildSystemInstruction(userName, promptText);

    // Prepare contents with alternating roles
    var contents = [];
    if (historyArr && historyArr.length) {
      var recent = historyArr.slice(-6);
      var lastRole = null;
      recent.forEach(function (m) {
        if (m.text) {
          var role = (m.role === 'bot' || m.role === 'model') ? 'model' : 'user';
          if (role === lastRole) {
            if (contents.length > 0) {
              contents[contents.length - 1].parts.push({ text: m.text });
            }
          } else {
            contents.push({
              role: role,
              parts: [{ text: m.text }]
            });
            lastRole = role;
          }
        }
      });
    }

    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts.push({ text: promptText });
    } else {
      contents.push({
        role: 'user',
        parts: [{ text: promptText }]
      });
    }

    var payload = {
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      },
      contents: contents
    };

    function tryModel(modelIdx) {
      if (modelIdx >= GEMINI_MODELS.length) {
        callback(new Error('All AI models unavailable. Please check your connection.'));
        return;
      }

      var modelName = GEMINI_MODELS[modelIdx];
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + GEMINI_API_KEY;

      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      })
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var candidate = data && data.candidates && data.candidates[0];
        if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
          var reply = candidate.content.parts.map(function (p) { return p.text; }).join('\n');
          callback(null, reply);
        } else {
          tryModel(modelIdx + 1);
        }
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        console.warn('Gemini model ' + modelName + ' failed (' + (err && err.name === 'AbortError' ? 'timeout' : err.message) + '), trying fallback model...');
        tryModel(modelIdx + 1);
      });
    }

    tryModel(0);
  }

  // ---------------------------------------------------------------------------
  // 5. Chat UI Handling
  // ---------------------------------------------------------------------------
  function appendChatMessage(role, text) {
    var stream = document.getElementById('domestic-po-ai-chat-stream');
    if (!stream) return;

    var timeStr = formatTime();
    chatHistory.push({ role: role, text: text, time: timeStr });

    var msgDiv = document.createElement('div');
    msgDiv.className = 'po-ai-msg po-ai-msg--' + (role === 'user' ? 'user' : 'bot');

    var bubble = document.createElement('div');
    bubble.className = 'po-ai-msg-bubble';

    if (role === 'user') {
      bubble.textContent = text;
    } else {
      bubble.innerHTML = formatMarkdown(text);
    }

    var timeEl = document.createElement('span');
    timeEl.className = 'po-ai-msg-time';
    timeEl.textContent = timeStr;

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(timeEl);
    stream.appendChild(msgDiv);

    // Scroll to bottom (Same delayed scroll pattern as FMS Form AI)
    setTimeout(function () {
      stream.scrollTop = stream.scrollHeight;
    }, 30);
  }

  function showTypingIndicator() {
    var stream = document.getElementById('domestic-po-ai-chat-stream');
    if (!stream) return;

    removeTypingIndicator();

    var typingDiv = document.createElement('div');
    typingDiv.className = 'po-ai-msg po-ai-msg--bot';
    typingDiv.id = 'domestic-po-ai-typing-indicator';

    var bubble = document.createElement('div');
    bubble.className = 'po-ai-msg-bubble';
    bubble.innerHTML = '<span class="po-ai-typing-dot"></span><span class="po-ai-typing-dot"></span><span class="po-ai-typing-dot"></span>';

    typingDiv.appendChild(bubble);
    stream.appendChild(typingDiv);
    setTimeout(function () {
      stream.scrollTop = stream.scrollHeight;
    }, 30);
  }

  function removeTypingIndicator() {
    var el = document.getElementById('domestic-po-ai-typing-indicator');
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function sendUserQuery(userText) {
    if (!userText || !userText.trim()) return;
    var cleanText = userText.trim();

    appendChatMessage('user', cleanText);
    showTypingIndicator();

    var sendBtn = document.getElementById('domestic-po-ai-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    callGeminiAPI(cleanText, chatHistory, function (err, replyText) {
      removeTypingIndicator();
      if (sendBtn) sendBtn.disabled = false;

      if (err || !replyText) {
        appendChatMessage('bot', 'Network connection issue. Please verify your internet and try again.');
      } else {
        appendChatMessage('bot', replyText);
      }
    });
  }

  function resetChat() {
    chatHistory = [];
    var stream = document.getElementById('domestic-po-ai-chat-stream');
    if (!stream) return;
    stream.innerHTML = '';

    var userName = getLoggedInUserName();
    var greeting = userName
      ? 'Hello ' + userName + '! I am Purchase Order AI. How can I assist you with this domestic purchase order today?'
      : 'Hello! I am Purchase Order AI. You can ask me anything about purchase orders, procurement timelines, or vendor compliance.';

    appendChatMessage('bot', greeting);
  }

  // ---------------------------------------------------------------------------
  // 6. Event Bindings & Init
  // ---------------------------------------------------------------------------
  function bindEvents() {
    var sendBtn = document.getElementById('domestic-po-ai-chat-send');
    var inputEl = document.getElementById('domestic-po-ai-chat-input');
    var clearBtn = document.getElementById('domestic-po-ai-chat-clear');

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        resetChat();
      });
    }

    if (sendBtn && inputEl) {
      var handleSend = function () {
        var q = (inputEl.value || '').trim();
        if (q) {
          inputEl.value = '';
          sendUserQuery(q);
        }
      };

      sendBtn.addEventListener('click', handleSend);
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }
  }

  function syncCardHeights() {
    // Height is controlled 100% via CSS grid layout (identical to FMS Form AI)
    return;
  }

  function init() {
    resetChat();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  root.DomesticPoAI = {
    init: init,
    resetChat: resetChat,
    sendQuery: sendUserQuery,
    refreshStatus: function () {
      setTimeout(syncCardHeights, 60);
    },
    notifySubmitSuccess: function (poNumber) {
      appendChatMessage('bot', 'Purchase Order **#' + (poNumber || 'New') + '** has been submitted successfully to the system! Lead times and supplier logs are now active.');
    }
  };

})(window);
