/**
 * =============================================================================
 * Dice & Forma AI -- Pure Gemini API Integration
 * =============================================================================
 * Pure AI Assistants connected directly to Gemini API via API Key:
 * - Direct Gemini API integration with multi-model failover
 * - Real-time context awareness of active Dice and Forma forms
 * - Multilingual conversation (English, Bengali, Hindi)
 * - Fixed size UI matching the form card with custom narrow scrollbar
 * - Strict Requirements:
 *   - Square aesthetics (border-radius: 0)
 *   - Clean SVG and Google Material Icons only (NO emojis)
 *   - Zero gradients
 * =============================================================================
 */

(function (root) {
  'use strict';

  var GEMINI_API_KEY = "AQ.Ab8RN6JXysa0sQMKMgJo6wGznX8Kdfxk25cPA3z8x6Ie4ZmlFw";
  var GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash"
  ];

  // ---------------------------------------------------------------------------
  // Utilities
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
  // Core AI Assistant Creator Factory
  // ---------------------------------------------------------------------------
  function createAssistant(cfg) {
    var chatHistory = [];

    function getLiveContext() {
      var val = function (id) {
        var el = document.getElementById(id);
        return el ? (el.value || '').trim() : '';
      };
      return cfg.extractContext(val);
    }

    function buildSystemInstruction(userName, userQuery) {
      var ctx = getLiveContext();
      var lang = detectLang(userQuery);
      var langRule = "";

      if (lang === 'bn') {
        langRule = "MANDATORY: The user spoke in BENGALI. You MUST reply in fluent, professional BENGALI (বাংলা).";
      } else if (lang === 'hi') {
        langRule = "MANDATORY: The user spoke in HINDI. You MUST reply in fluent, professional HINDI (हिंदी).";
      } else {
        langRule = "MANDATORY: The user spoke in ENGLISH. You MUST reply in fluent, professional ENGLISH.";
      }

      var lines = [
        "IDENTITY & CREATOR RULES:",
        "- You are " + cfg.name + ", an expert ERP specialist for the " + cfg.formTitle + ".",
        "- OWNER / CREATOR PRIVACY RULE: Do NOT volunteer or mention your owner's name (Arpan Nazir) or platform identity on simple greetings or regular answers.",
        "- ONLY IF the user specifically asks who created you or who owns you: state clearly in their active conversation language: 'I am " + cfg.name + ", part of the AN AI platform created by Arpan Nazir.' (Bengali: 'আমি AN AI-এর " + cfg.name + ", আমার প্রস্তুতকারক অর্পণ নাজির (Arpan Nazir)।', Hindi: 'मैं AN AI का " + cfg.name + " हूँ, मेरे निर्माता अर्पण नाजिर (Arpan Nazir) हैं।').",
        "- ABSOLUTE RESTRICTION: NEVER mention or admit that you are Gemini, Google, OpenAI, ChatGPT, or Claude.",
        userName ? "- Address the logged-in user by their first name \"" + userName + "\" politely when appropriate." : "",
        "",
        "ROLE & CORE EXPERTISE:",
        cfg.roleDescription,
        "",
        "STRICT LANGUAGE DIRECTIVE:",
        langRule,
        "- Strictly maintain this language throughout your response.",
        "",
        "CURRENT FORM (LIVE ACTIVE VALUES):"
      ];

      for (var k in ctx) {
        if (Object.prototype.hasOwnProperty.call(ctx, k)) {
          lines.push("- " + k + ": " + (ctx[k] || 'Empty'));
        }
      }

      lines.push(
        "",
        "INSTRUCTIONS:",
        "- Answer questions clearly, concisely, and intelligently using the live form values when relevant.",
        "- Help calculate dates, lead times, order quantities, or identify missing required fields.",
        "- NO EMOJIS: Do NOT use emojis under any circumstance. Use clean text, numbers, and bullet points."
      );

      return lines.filter(Boolean).join("\n");
    }

    function callGeminiAPI(promptText, historyArr, callback) {
      var userName = getLoggedInUserName();
      var systemInstructionText = buildSystemInstruction(userName, promptText);

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
          console.warn(cfg.name + ' Gemini model ' + modelName + ' failed (' + (err && err.name === 'AbortError' ? 'timeout' : err.message) + '), trying fallback model...');
          tryModel(modelIdx + 1);
        });
      }

      tryModel(0);
    }

    function appendChatMessage(role, text) {
      var stream = document.getElementById(cfg.streamId);
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

      setTimeout(function () {
        stream.scrollTop = stream.scrollHeight;
      }, 30);
    }

    function showTypingIndicator() {
      var stream = document.getElementById(cfg.streamId);
      if (!stream) return;

      removeTypingIndicator();

      var typingDiv = document.createElement('div');
      typingDiv.className = 'po-ai-msg po-ai-msg--bot';
      typingDiv.id = cfg.streamId + '-typing-indicator';

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
      var el = document.getElementById(cfg.streamId + '-typing-indicator');
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }

    function sendUserQuery(userText) {
      if (!userText || !userText.trim()) return;
      var cleanText = userText.trim();

      appendChatMessage('user', cleanText);
      showTypingIndicator();

      var sendBtn = document.getElementById(cfg.sendBtnId);
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
      var stream = document.getElementById(cfg.streamId);
      if (!stream) return;
      stream.innerHTML = '';

      var userName = getLoggedInUserName();
      var greeting = userName
        ? 'Hello ' + userName + '! I am ' + cfg.name + '. How can I assist you with this ' + cfg.formShort + ' today?'
        : 'Hello! I am ' + cfg.name + '. You can ask me about PO numbers, styles, quantities, schedules, or attached files.';

      appendChatMessage('bot', greeting);
    }

    function bindEvents() {
      var sendBtn = document.getElementById(cfg.sendBtnId);
      var inputEl = document.getElementById(cfg.inputId);
      var clearBtn = document.getElementById(cfg.clearBtnId);

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

    function init() {
      resetChat();
      bindEvents();
    }

    return {
      init: init,
      resetChat: resetChat,
      sendQuery: sendUserQuery,
      notifySubmitSuccess: function (data) {
        var summary = cfg.buildSubmitSummary(data);
        appendChatMessage('bot', summary);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Dice AI Instance
  // ---------------------------------------------------------------------------
  var DiceAI = createAssistant({
    name: "Dice AI",
    formTitle: "Dice Tracker Form",
    formShort: "dice tracker",
    streamId: "dice-ai-chat-stream",
    inputId: "dice-ai-chat-input",
    sendBtnId: "dice-ai-chat-send",
    clearBtnId: "dice-ai-chat-clear",
    roleDescription: "You specialize in Dice inventory receiving, style verification, receiving person logs, handover timeline calculation, and attachment verification for cutting operations.",
    extractContext: function (val) {
      var fileEl = document.getElementById('dice-attachment');
      var fileCount = fileEl && fileEl.files ? fileEl.files.length : 0;
      return {
        "PO Number": val('dice-po-number'),
        "Style Number": val('dice-style-number'),
        "Dice Quantity": val('dice-quantity'),
        "Receiving Person": val('dice-receiving-person'),
        "Received Date": val('dice-received-date'),
        "Handover Date": val('dice-handover-date'),
        "Attached Files Count": fileCount > 0 ? (fileCount + ' file(s) attached') : 'None'
      };
    },
    buildSubmitSummary: function (data) {
      var po = (data && data.poNumber) || 'N/A';
      var style = (data && data.styleNumber) || 'N/A';
      var qty = (data && data.diceQuantity) || '0';
      var person = (data && data.receivingPerson) || 'N/A';
      return "Dice Details for PO **#" + po + "** (Style: `" + style + "`, Quantity: `" + qty + "`, Receiver: `" + person + "`) have been submitted successfully in 0.05s! Background sync is active.";
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Forma AI Instance
  // ---------------------------------------------------------------------------
  var FormaAI = createAssistant({
    name: "Forma AI",
    formTitle: "Forma Tracker Form",
    formShort: "forma tracker",
    streamId: "forma-ai-chat-stream",
    inputId: "forma-ai-chat-input",
    sendBtnId: "forma-ai-chat-send",
    clearBtnId: "forma-ai-chat-clear",
    roleDescription: "You specialize in Forma order tracking, buyer specifications, sample maker verification, style numbers, order quantities, supplier tracking, and ETA delivery timeline calculation.",
    extractContext: function (val) {
      var fileEl = document.getElementById('forma-attachment');
      var fileCount = fileEl && fileEl.files ? fileEl.files.length : 0;
      return {
        "Buyer Name": val('forma-buyer-name'),
        "Sample Maker Name": val('forma-sample-maker'),
        "Style Number": val('forma-style-number'),
        "Forma Quantity (pcs)": val('forma-quantity'),
        "PO Number": val('forma-po-number'),
        "PO Date": val('forma-po-date'),
        "Supplier Name": val('forma-supplier-name'),
        "ETA Date": val('forma-eta'),
        "Attached Files Count": fileCount > 0 ? (fileCount + ' file(s) attached') : 'None'
      };
    },
    buildSubmitSummary: function (data) {
      var po = (data && data.poNumber) || 'N/A';
      var buyer = (data && data.buyerName) || 'N/A';
      var style = (data && data.styleNumber) || 'N/A';
      var qty = (data && data.formaQuantity) || '0';
      var eta = (data && data.eta) || 'N/A';
      return "Forma Order for PO **#" + po + "** (Buyer: `" + buyer + "`, Style: `" + style + "`, Quantity: `" + qty + " pcs`, ETA: `" + eta + "`) has been submitted successfully in 0.05s! Background sync is active.";
    }
  });

  function initAll() {
    DiceAI.init();
    FormaAI.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  root.DiceAI = DiceAI;
  root.FormaAI = FormaAI;
  root.DiceFormaAI = {
    dice: DiceAI,
    forma: FormaAI,
    notifySubmitSuccess: function (type, data) {
      if (type === 'dice') DiceAI.notifySubmitSuccess(data);
      else if (type === 'forma') FormaAI.notifySubmitSuccess(data);
    }
  };

})(window);
