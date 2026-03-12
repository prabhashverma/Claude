// DoINeedAVisa Chrome Extension — Content Script
// Injects CTA on Google Flights, shows visa check overlay with SSE streaming

(function () {
  'use strict';

  var CTA_ATTR = 'data-dinav-cta';
  var OVERLAY_ID = 'dinav-overlay-root';
  var DEBOUNCE_MS = 600;

  var EXTENSION_THEMES = {
    black: {
      pageBg: '#0A0A0A', cardBg: '#161616', headerBg: '#0E0E0E',
      border: '#2A2A2A', textPrimary: '#F5F5F5', textSecondary: '#A3A3A3',
      textDim: '#666666', accent: '#38BDF8', inputBg: 'rgba(255,255,255,0.06)',
      pillBg: 'rgba(255,255,255,0.05)', hoverBg: 'rgba(255,255,255,0.06)',
      ctaColor: '#38BDF8', ctaBg: 'rgba(56,189,248,0.12)', ctaBorder: '#38BDF8',
      ctaHover: 'rgba(56,189,248,0.2)',
    },
    blue: {
      pageBg: '#0F172A', cardBg: '#1E293B', headerBg: '#0D1424',
      border: '#334155', textPrimary: '#F1F5F9', textSecondary: '#94A3B8',
      textDim: '#64748B', accent: '#38BDF8', inputBg: 'rgba(255,255,255,0.06)',
      pillBg: 'rgba(255,255,255,0.04)', hoverBg: 'rgba(255,255,255,0.06)',
      ctaColor: '#38BDF8', ctaBg: 'rgba(56,189,248,0.12)', ctaBorder: '#38BDF8',
      ctaHover: 'rgba(56,189,248,0.2)',
    },
    light: {
      pageBg: '#F7F6F3', cardBg: '#FFFFFF', headerBg: '#EDECE9',
      border: '#E5E3DF', textPrimary: '#1C1C1C', textSecondary: '#6B6B6B',
      textDim: '#999999', accent: '#2563EB', inputBg: 'rgba(0,0,0,0.04)',
      pillBg: 'rgba(0,0,0,0.04)', hoverBg: 'rgba(0,0,0,0.04)',
      ctaColor: '#2563EB', ctaBg: 'rgba(37,99,235,0.08)', ctaBorder: '#2563EB',
      ctaHover: 'rgba(37,99,235,0.15)',
    }
  };

  var currentThemeId = 'blue';
  var currentTheme = EXTENSION_THEMES.blue;

  var lastUrl = location.href;
  var debounceTimer = null;
  var overlayHost = null;
  var shadowRoot = null;
  var currentPort = null;

  // Load saved theme
  chrome.storage.local.get(['dinav_theme'], function (data) {
    if (data.dinav_theme && EXTENSION_THEMES[data.dinav_theme]) {
      currentThemeId = data.dinav_theme;
      currentTheme = EXTENSION_THEMES[data.dinav_theme];
      updateCTATheme();
    }
  });

  function updateCTATheme() {
    var btns = document.querySelectorAll('[' + CTA_ATTR + ']');
    for (var i = 0; i < btns.length; i++) {
      btns[i].style.color = currentTheme.ctaColor;
      btns[i].style.background = currentTheme.ctaBg;
      btns[i].style.borderColor = currentTheme.ctaBorder;
    }
  }

  // ── Helpers ──

  function getCountryName(iso3) {
    var c = getCountryByIso3(iso3);
    return c ? c.name : iso3;
  }

  function iso3ToIso2(iso3) {
    var c = getCountryByIso3(iso3);
    return c ? c.code : '';
  }

  // ── SPA Navigation Detection ──

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'URL_CHANGED') {
      onUrlChange();
    }
  });

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    onUrlChange();
  };
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    onUrlChange();
  };
  window.addEventListener('popstate', onUrlChange);

  var observer = new MutationObserver(function () {
    if (location.href !== lastUrl) {
      onUrlChange();
    } else {
      debouncedInject();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function onUrlChange() {
    lastUrl = location.href;
    debouncedInject();
  }

  function debouncedInject() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryInjectCTA, DEBOUNCE_MS);
  }

  // ── CTA Injection ──

  function hasTfsParam() {
    try {
      return new URL(location.href).searchParams.has('tfs');
    } catch (e) {
      return false;
    }
  }

  function tryInjectCTA() {
    if (!hasTfsParam()) {
      removeCTA();
      return;
    }
    if (document.querySelector('[' + CTA_ATTR + ']')) return;

    var anchor = findBookAnchor();
    if (anchor) {
      var btn = createCTAButton(false);
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    } else {
      var floating = createCTAButton(true);
      document.body.appendChild(floating);
    }
  }

  function findBookAnchor() {
    // Strategy 1: buttons/links containing "Book" text near price elements
    var allButtons = document.querySelectorAll('button, a[role="link"], a[href]');
    for (var i = 0; i < allButtons.length; i++) {
      var el = allButtons[i];
      var text = (el.textContent || '').trim();
      if (/^Book(\s|$)/i.test(text) && el.offsetParent !== null) {
        return el;
      }
    }
    // Strategy 2: look for the main booking action area
    var bookingLinks = document.querySelectorAll('a[href*="book"], a[data-ved]');
    for (var j = 0; j < bookingLinks.length; j++) {
      if (bookingLinks[j].offsetParent !== null) {
        return bookingLinks[j];
      }
    }
    return null;
  }

  function createCTAButton(floating) {
    var btn = document.createElement('button');
    btn.setAttribute(CTA_ATTR, 'true');
    btn.className = 'dinav-cta-btn' + (floating ? ' dinav-cta-floating' : '');
    btn.textContent = 'Visa Check';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openOverlay();
    });
    return btn;
  }

  function removeCTA() {
    var existing = document.querySelectorAll('[' + CTA_ATTR + ']');
    for (var i = 0; i < existing.length; i++) {
      existing[i].remove();
    }
  }

  // ── Overlay ──

  function openOverlay() {
    if (document.getElementById(OVERLAY_ID)) {
      closeOverlay();
      return;
    }

    var parsed;
    try {
      parsed = parseGoogleFlightsUrl(location.href);
    } catch (err) {
      alert('Could not parse flight data: ' + err.message);
      return;
    }

    overlayHost = document.createElement('div');
    overlayHost.id = OVERLAY_ID;
    overlayHost.style.cssText = 'position:fixed;top:0;right:0;bottom:0;z-index:99999;pointer-events:none;';
    shadowRoot = overlayHost.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = getOverlayCSS();
    shadowRoot.appendChild(style);

    var container = document.createElement('div');
    container.className = 'dinav-overlay';
    container.style.pointerEvents = 'auto';

    container.innerHTML = buildOverlayHTML(parsed);
    shadowRoot.appendChild(container);
    document.body.appendChild(overlayHost);

    // Build passport list and visa pills
    buildPassportList('');
    renderVisaPills('');

    // Load saved preferences
    chrome.storage.local.get(['dinav_passport', 'dinav_visa'], function (data) {
      if (data.dinav_passport) {
        selectPassport(data.dinav_passport, true);
      }
      if (data.dinav_visa) {
        shadowRoot.querySelector('#dinav-visa').value = data.dinav_visa;
        // Re-render visa pills with saved selection
        renderVisaPills(data.dinav_passport || '');
        var pills = shadowRoot.querySelectorAll('.dinav-visa-pill');
        for (var i = 0; i < pills.length; i++) {
          if (pills[i].getAttribute('data-visa') === data.dinav_visa) {
            pills[i].classList.add('active');
          }
        }
      }
    });

    // Theme toggle
    renderThemeToggle();

    // Event listeners
    shadowRoot.querySelector('#dinav-close').addEventListener('click', closeOverlay);

    // Passport dropdown toggle
    shadowRoot.querySelector('#dinav-passport-trigger').addEventListener('click', function () {
      var menu = shadowRoot.querySelector('#dinav-passport-menu');
      var isOpen = menu.classList.contains('open');
      menu.classList.toggle('open');
      if (!isOpen) {
        var input = shadowRoot.querySelector('#dinav-passport-search');
        input.value = '';
        buildPassportList('');
        setTimeout(function () { input.focus(); }, 50);
      }
    });

    // Passport search
    shadowRoot.querySelector('#dinav-passport-search').addEventListener('input', function () {
      buildPassportList(this.value);
    });

    // Close passport menu when clicking outside
    container.addEventListener('click', function (e) {
      var dropdown = shadowRoot.querySelector('#dinav-passport-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        shadowRoot.querySelector('#dinav-passport-menu').classList.remove('open');
      }
    });

    shadowRoot.querySelector('#dinav-check').addEventListener('click', function () {
      runVisaCheck(parsed);
    });
  }

  function buildPassportList(query) {
    if (!shadowRoot) return;
    var list = shadowRoot.querySelector('#dinav-passport-list');
    if (!list) return;
    list.innerHTML = '';
    var q = (query || '').toLowerCase().trim();
    var currentVal = shadowRoot.querySelector('#dinav-passport').value;

    var POPULAR = ['IND', 'USA', 'GBR', 'CHN', 'PHL', 'NGA', 'BRA', 'MEX', 'PAK', 'CAN'];
    var popular = [];
    var rest = [];

    for (var i = 0; i < DINAV_COUNTRIES.length; i++) {
      var c = DINAV_COUNTRIES[i];
      if (q && c.name.toLowerCase().indexOf(q) === -1 && c.iso3.toLowerCase().indexOf(q) === -1 && c.code.toLowerCase().indexOf(q) === -1) continue;
      if (!q && POPULAR.indexOf(c.iso3) !== -1) {
        popular.push(c);
      } else {
        rest.push(c);
      }
    }

    // Sort popular by POPULAR order
    popular.sort(function (a, b) { return POPULAR.indexOf(a.iso3) - POPULAR.indexOf(b.iso3); });

    function renderRow(c) {
      var row = document.createElement('div');
      row.className = 'dinav-select-row' + (currentVal === c.iso3 ? ' selected' : '');
      row.innerHTML = '<img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" />'
        + '<span>' + c.name + '</span>';
      row.addEventListener('click', function () {
        selectPassport(c.iso3, false);
        shadowRoot.querySelector('#dinav-passport-menu').classList.remove('open');
      });
      return row;
    }

    if (popular.length > 0 && !q) {
      var header = document.createElement('div');
      header.className = 'dinav-select-group-label';
      header.textContent = 'POPULAR';
      list.appendChild(header);
      for (var p = 0; p < popular.length; p++) {
        list.appendChild(renderRow(popular[p]));
      }
      var divider = document.createElement('div');
      divider.className = 'dinav-select-divider';
      list.appendChild(divider);
    }

    for (var r = 0; r < rest.length; r++) {
      list.appendChild(renderRow(rest[r]));
    }
  }

  function selectPassport(iso3, silent) {
    if (!shadowRoot) return;
    var hidden = shadowRoot.querySelector('#dinav-passport');
    var label = shadowRoot.querySelector('#dinav-passport-label');
    hidden.value = iso3;
    var c = getCountryByIso3(iso3);
    if (c) {
      label.innerHTML = '<img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" /> ' + c.name;
    } else {
      label.textContent = iso3 || 'Select passport';
    }
    if (!silent) {
      renderVisaPills(iso3);
    }
  }

  function renderVisaPills(passportIso3) {
    if (!shadowRoot) return;
    var container = shadowRoot.querySelector('#dinav-visa-pills');
    var hiddenInput = shadowRoot.querySelector('#dinav-visa');
    if (!container) return;
    container.innerHTML = '';
    var filtered = getFilteredVisaOptions(passportIso3 || '');
    var currentVisa = hiddenInput ? hiddenInput.value : '';

    // "None" pill
    var nonePill = document.createElement('button');
    nonePill.className = 'dinav-visa-pill' + (!currentVisa ? ' active' : '');
    nonePill.textContent = 'None';
    nonePill.addEventListener('click', function () {
      hiddenInput.value = '';
      var all = container.querySelectorAll('.dinav-visa-pill');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      nonePill.classList.add('active');
    });
    container.appendChild(nonePill);

    for (var i = 0; i < filtered.length; i++) {
      (function (v) {
        var pill = document.createElement('button');
        pill.className = 'dinav-visa-pill' + (currentVisa === v.visaId ? ' active' : '');
        pill.setAttribute('data-visa', v.visaId);
        pill.innerHTML = '<img class="dinav-flag" src="' + flagUrl(v.iso2, 14) + '" alt="" /> ' + v.name;
        pill.addEventListener('click', function () {
          var wasActive = pill.classList.contains('active');
          var all = container.querySelectorAll('.dinav-visa-pill');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
          if (wasActive) {
            // Deselect — go back to None
            hiddenInput.value = '';
            nonePill.classList.add('active');
          } else {
            hiddenInput.value = v.visaId;
            pill.classList.add('active');
          }
        });
        container.appendChild(pill);
      })(filtered[i]);
    }

    if (filtered.length === 0 && passportIso3) {
      var msg = document.createElement('span');
      msg.className = 'dinav-visa-empty';
      msg.textContent = 'No door-opener visas for this passport';
      container.appendChild(msg);
    }
  }

  function closeOverlay() {
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
    }
    if (currentPort) {
      try { currentPort.postMessage({ type: 'ABORT' }); } catch (e) {}
      try { currentPort.disconnect(); } catch (e) {}
      currentPort = null;
    }
  }


  function flagUrl(iso2, size) {
    size = size || 20;
    return 'https://flagcdn.com/' + (size * 2) + 'x' + Math.round(size * 1.5) + '/' + iso2.toLowerCase() + '.png';
  }

  function buildOverlayHTML(parsed) {
    // Build flight tags
    var flightTags = '';
    for (var s = 0; s < parsed.slices.length; s++) {
      var slice = parsed.slices[s];
      var route = [];
      for (var f = 0; f < slice.flights.length; f++) {
        if (f === 0) route.push(slice.flights[f].departure);
        route.push(slice.flights[f].arrival);
      }
      var airlineInfo = '';
      if (slice.flights[0] && slice.flights[0].airline) {
        airlineInfo = ' (' + slice.flights[0].airline + (slice.flights[0].flightNum || '') + ')';
      }
      var dateInfo = '';
      if (slice.flights[0] && slice.flights[0].date) {
        dateInfo = ' <span class="dinav-date">' + slice.flights[0].date + '</span>';
      }
      flightTags += '<div class="dinav-flight-tag">'
        + '<span class="dinav-slice-label">Slice ' + (s + 1) + ':</span> '
        + route.join(' &rarr; ') + airlineInfo + dateInfo
        + '</div>';
    }

    return ''
      + '<div class="dinav-header">'
      + '  <span class="dinav-logo">do<span class="dinav-logo-accent">i</span>need<span class="dinav-logo-accent">a</span>visa</span>'
      + '  <div style="display:flex;align-items:center;gap:6px">'
      + '    <div id="dinav-theme-toggle" class="dinav-theme-toggle"></div>'
      + '    <button id="dinav-close" class="dinav-close-btn">&times;</button>'
      + '  </div>'
      + '</div>'
      + '<div class="dinav-body">'
      + '  <div class="dinav-flights">' + flightTags + '</div>'
      + '  <div class="dinav-form">'
      // Passport — custom dropdown with search + flags
      + '    <div class="dinav-field">'
      + '      <label>Passport</label>'
      + '      <input type="hidden" id="dinav-passport" value="" />'
      + '      <div class="dinav-custom-select" id="dinav-passport-dropdown">'
      + '        <div class="dinav-select-trigger" id="dinav-passport-trigger">'
      + '          <span class="dinav-select-value" id="dinav-passport-label">Select passport</span>'
      + '          <span class="dinav-select-arrow">&#9662;</span>'
      + '        </div>'
      + '        <div class="dinav-select-menu" id="dinav-passport-menu">'
      + '          <input type="text" class="dinav-select-search" id="dinav-passport-search" placeholder="Search countries..." />'
      + '          <div class="dinav-select-list" id="dinav-passport-list"></div>'
      + '        </div>'
      + '      </div>'
      + '    </div>'
      // Visa — pill buttons with flags
      + '    <div class="dinav-field">'
      + '      <label>Visa held</label>'
      + '      <input type="hidden" id="dinav-visa" value="" />'
      + '      <div class="dinav-visa-pills" id="dinav-visa-pills"></div>'
      + '    </div>'
      + '    <button id="dinav-check" class="dinav-btn-primary">Check Visa</button>'
      + '  </div>'
      + '  <div id="dinav-results" class="dinav-results" style="display:none">'
      + '    <div id="dinav-status" class="dinav-status"></div>'
      + '    <div id="dinav-slices" class="dinav-slices"></div>'
      + '    <div id="dinav-actions" class="dinav-actions" style="display:none"></div>'
      + '  </div>'
      + '</div>';
  }

  // ── Visa Check (API + SSE) ──

  function runVisaCheck(parsed) {
    var passportSel = shadowRoot.querySelector('#dinav-passport');
    var visaSel = shadowRoot.querySelector('#dinav-visa');
    var passportIso3 = passportSel ? passportSel.value : '';
    var visaId = visaSel ? visaSel.value : '';

    if (!passportIso3) {
      alert('Please select your passport country.');
      return;
    }

    // Save preferences
    chrome.storage.local.set({ dinav_passport: passportIso3, dinav_visa: visaId });

    // Build payload
    var payload = buildPayload(parsed, passportIso3, visaId);

    // Show results area
    var resultsDiv = shadowRoot.querySelector('#dinav-results');
    var statusDiv = shadowRoot.querySelector('#dinav-status');
    var slicesDiv = shadowRoot.querySelector('#dinav-slices');
    var actionsDiv = shadowRoot.querySelector('#dinav-actions');
    resultsDiv.style.display = 'block';
    statusDiv.textContent = 'Analysing your route...';
    statusDiv.className = 'dinav-status dinav-loading';
    slicesDiv.innerHTML = '';
    actionsDiv.style.display = 'none';
    actionsDiv.innerHTML = '';

    // Disable check button
    var checkBtn = shadowRoot.querySelector('#dinav-check');
    if (checkBtn) {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking...';
    }

    // Abort previous stream
    if (currentPort) {
      try { currentPort.postMessage({ type: 'ABORT' }); } catch (e) {}
      try { currentPort.disconnect(); } catch (e) {}
    }

    // Open port to background for SSE streaming
    var port = chrome.runtime.connect({ name: 'dinav-stream' });
    currentPort = port;

    port.onMessage.addListener(function (msg) {
      if (msg.type === 'SSE_EVENT') {
        handleSSEEvent(msg.event, msg.data, statusDiv, slicesDiv, actionsDiv, parsed, passportIso3, visaId);
      } else if (msg.type === 'SSE_DONE') {
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check Visa'; }
      } else if (msg.type === 'SSE_ERROR') {
        statusDiv.textContent = 'Error: ' + (msg.data || 'Connection failed');
        statusDiv.className = 'dinav-status dinav-error';
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check Visa'; }
      }
    });

    port.onDisconnect.addListener(function () {
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check Visa'; }
    });

    port.postMessage({ type: 'START_STREAM', payload: payload });
  }

  function buildPayload(parsed, passportIso3, visaId) {
    var passportIso2 = iso3ToIso2(passportIso3) || passportIso3;
    var slices = [];
    for (var i = 0; i < parsed.slices.length; i++) {
      var sl = parsed.slices[i];
      var segments = [];
      for (var j = 0; j < sl.flights.length; j++) {
        var f = sl.flights[j];
        segments.push({
          id: 's' + i + '_leg_' + (j + 1),
          departure_airport: f.departure,
          arrival_airport: f.arrival,
          airline: f.airline || '',
          flight_number: (f.airline || '') + (f.flightNum || ''),
          departure_time: f.date ? f.date + 'T00:00:00' : '',
          arrival_time: ''
        });
      }
      var label = sl.flights.length > 0
        ? sl.flights[0].departure + ' to ' + sl.flights[sl.flights.length - 1].arrival
        : 'Slice ' + (i + 1);
      slices.push({ id: 's' + i, label: label, segments: segments });
    }
    return {
      passengers: [{
        nationality: passportIso2,
        visas: visaId ? [visaId] : []
      }],
      slices: slices
    };
  }

  function handleSSEEvent(eventType, dataStr, statusDiv, slicesDiv, actionsDiv, parsed, passportIso3, visaId) {
    var data;
    try {
      data = JSON.parse(dataStr);
    } catch (e) {
      data = { message: dataStr };
    }

    switch (eventType) {
      case 'started':
        statusDiv.textContent = 'Connected, analysing...';
        break;

      case 'status':
        statusDiv.textContent = data.message || data.status || 'Processing...';
        break;

      case 'reasoning':
        // Show thinking indicator
        statusDiv.textContent = 'Thinking...';
        break;

      case 'slice_done':
        renderSliceResult(slicesDiv, data);
        statusDiv.textContent = 'Checking next segment...';
        break;

      case 'done':
        statusDiv.className = 'dinav-status';
        var verdict = '';
        if (data.structured && data.structured.global_verdict) {
          verdict = data.structured.global_verdict;
        } else if (data.response) {
          verdict = extractVerdict(data.response);
        }
        renderFinalVerdict(statusDiv, verdict);
        renderGoogleSearchButton(actionsDiv, parsed, passportIso3, visaId);
        actionsDiv.style.display = 'block';
        break;

      case 'error':
        statusDiv.textContent = 'Error: ' + (data.message || 'Unknown error');
        statusDiv.className = 'dinav-status dinav-error';
        break;
    }
  }

  function renderSliceResult(container, data) {
    var div = document.createElement('div');
    var verdictClass = 'dinav-verdict-' + (data.status || 'unknown').toLowerCase();
    div.className = 'dinav-slice-result ' + verdictClass;

    var header = '<div class="dinav-slice-header">'
      + '<strong>' + (data.slice_label || 'Segment') + '</strong>'
      + '<span class="dinav-verdict-badge">' + (data.status || '').toUpperCase() + '</span>'
      + '</div>';

    var sections = '';
    if (data.sections && data.sections.length) {
      for (var i = 0; i < data.sections.length; i++) {
        var sec = data.sections[i];
        sections += '<div class="dinav-section">'
          + '<span class="dinav-section-title">' + (sec.title || sec.type || '') + '</span>'
          + '<span class="dinav-section-text">' + (sec.content || sec.text || '') + '</span>'
          + '</div>';
      }
    }
    if (data.reason) {
      sections += '<div class="dinav-section"><span class="dinav-section-text">' + data.reason + '</span></div>';
    }

    div.innerHTML = header + sections;
    container.appendChild(div);
  }

  function renderFinalVerdict(statusDiv, verdict) {
    var verdictLower = (verdict || '').toLowerCase();
    var emoji = '';
    var label = verdict || 'Analysis complete';
    if (verdictLower === 'go' || verdictLower === 'green') {
      emoji = ' ';
      statusDiv.className = 'dinav-status dinav-verdict-go';
    } else if (verdictLower === 'caution' || verdictLower === 'yellow') {
      emoji = ' ';
      statusDiv.className = 'dinav-status dinav-verdict-caution';
    } else if (verdictLower === 'no-go' || verdictLower === 'red') {
      emoji = ' ';
      statusDiv.className = 'dinav-status dinav-verdict-nogo';
    }
    statusDiv.textContent = emoji + label;
  }

  function extractVerdict(text) {
    if (/\bGO\b/i.test(text) && !/NO.GO/i.test(text)) return 'GO';
    if (/NO.GO/i.test(text)) return 'NO-GO';
    if (/CAUTION/i.test(text)) return 'CAUTION';
    return 'See details';
  }

  function renderGoogleSearchButton(container, parsed, passportIso3, visaId) {
    var countryName = getCountryName(passportIso3);
    var airports = [];
    for (var i = 0; i < parsed.flights.length; i++) {
      var f = parsed.flights[i];
      if (airports.indexOf(f.departure) === -1) airports.push(f.departure);
      if (airports.indexOf(f.arrival) === -1) airports.push(f.arrival);
    }

    var visaName = '';
    if (visaId) {
      for (var j = 0; j < DINAV_DOOR_OPENER_VISAS.length; j++) {
        if (DINAV_DOOR_OPENER_VISAS[j].visaId === visaId) {
          visaName = DINAV_DOOR_OPENER_VISAS[j].name;
          break;
        }
      }
    }

    var query = countryName + ' passport'
      + (visaName ? ' ' + visaName + ' visa' : '')
      + ' ' + airports.join(' ')
      + ' visa requirements';

    var btn = document.createElement('button');
    btn.className = 'dinav-btn-google';
    btn.textContent = 'Google it';
    btn.addEventListener('click', function () {
      window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank');
    });
    container.appendChild(btn);
  }

  // ── Theme toggle ──

  var THEME_ORDER = ['black', 'blue', 'light'];
  var THEME_LABELS = { black: 'Dark', blue: 'Blue', light: 'Light' };

  // SVG icons for each theme state
  var THEME_ICONS = {
    // Sun icon for light mode
    light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    // Moon icon for blue (dark blue) mode
    blue: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    // Half icon for black mode
    black: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" opacity="0.4"/><path d="M21 12.79A9 9 0 1 1 11.21 3" opacity="0.4"/></svg>',
  };

  function renderThemeToggle() {
    var container = shadowRoot.querySelector('#dinav-theme-toggle');
    if (!container) return;
    container.innerHTML = '';
    var btn = document.createElement('button');
    btn.className = 'dinav-theme-btn';
    btn.title = 'Theme: ' + THEME_LABELS[currentThemeId] + ' — click to switch';
    btn.innerHTML = THEME_ICONS[currentThemeId];
    btn.addEventListener('click', function () {
      var idx = THEME_ORDER.indexOf(currentThemeId);
      var nextId = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      currentThemeId = nextId;
      currentTheme = EXTENSION_THEMES[nextId];
      chrome.storage.local.set({ dinav_theme: nextId });
      updateCTATheme();
      applyOverlayTheme();
      renderThemeToggle();
    });
    container.appendChild(btn);
  }

  function applyOverlayTheme() {
    if (!shadowRoot) return;
    var oldStyle = shadowRoot.querySelector('style');
    if (oldStyle) oldStyle.textContent = getOverlayCSS();
  }

  // ── Overlay CSS (inside Shadow DOM) ──

  function getOverlayCSS() {
    var t = currentTheme;
    var isDark = currentThemeId !== 'light';
    var accentSoft = isDark ? 'rgba(56,189,248,0.08)' : (t.accent + '12');
    var accentMed = isDark ? 'rgba(56,189,248,0.12)' : (t.accent + '1A');
    return ''
      + '@import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap");'
      + '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }'
      + '.dinav-overlay {'
      + '  position: fixed; top: 0; right: 0; width: 380px; height: 100vh;'
      + '  background: ' + t.pageBg + '; color: ' + t.textPrimary + ';'
      + '  font-family: "DM Mono", "SF Mono", "Fira Code", monospace; font-size: 13px;'
      + '  display: flex; flex-direction: column;'
      + '  box-shadow: -4px 0 20px rgba(0,0,0,0.3);'
      + '  overflow-y: auto;'
      + '}'
      + '.dinav-header {'
      + '  display: flex; justify-content: space-between; align-items: center;'
      + '  padding: 16px 20px; border-bottom: 1px solid ' + t.border + ';'
      + '  background: ' + t.headerBg + ';'
      + '}'
      + '.dinav-logo { font-family: "Syne", sans-serif; font-size: 16px; font-weight: 700; color: ' + t.textPrimary + '; letter-spacing: -0.02em; }'
      + '.dinav-logo-accent { color: ' + t.accent + '; }'
      + '.dinav-theme-toggle { display: flex; }'
      + '.dinav-theme-btn {'
      + '  all: unset; cursor: pointer; width: 28px; height: 28px;'
      + '  display: flex; align-items: center; justify-content: center;'
      + '  border-radius: 6px;'
      + '  color: ' + t.textSecondary + '; transition: color 0.2s;'
      + '}'
      + '.dinav-theme-btn:hover { color: ' + t.textPrimary + '; }'
      + '.dinav-close-btn {'
      + '  background: none; border: none; color: ' + t.textDim + '; font-size: 22px;'
      + '  cursor: pointer; padding: 4px 8px; border-radius: 4px; font-family: inherit;'
      + '}'
      + '.dinav-close-btn:hover { color: ' + t.textPrimary + '; background: ' + t.hoverBg + '; }'
      + '.dinav-body { padding: 16px 20px; flex: 1; }'
      + '.dinav-flights { margin-bottom: 16px; }'
      + '.dinav-flight-tag {'
      + '  background: ' + t.cardBg + '; border-radius: 8px; padding: 8px 12px;'
      + '  margin-bottom: 6px; font-size: 12px; line-height: 1.5;'
      + '}'
      + '.dinav-slice-label { color: ' + t.textDim + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-right: 4px; }'
      + '.dinav-date { color: ' + t.accent + '; font-size: 11px; margin-left: 6px; }'
      + '.dinav-form { margin-bottom: 16px; }'
      + '.dinav-field { margin-bottom: 14px; }'
      + '.dinav-field label {'
      + '  display: block; font-size: 10px; color: ' + t.textDim + ';'
      + '  margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.12em;'
      + '}'
      // Flag images
      + '.dinav-flag { width: 16px; height: 12px; border-radius: 2px; object-fit: cover; vertical-align: middle; flex-shrink: 0; }'
      // Custom passport dropdown
      + '.dinav-custom-select { position: relative; }'
      + '.dinav-select-trigger {'
      + '  display: flex; align-items: center; justify-content: space-between; gap: 8px;'
      + '  padding: 10px 14px; border-radius: 10px;'
      + '  border: 1px solid ' + t.border + '; background: ' + t.cardBg + ';'
      + '  cursor: pointer; font-family: inherit; font-size: 13px; color: ' + t.textPrimary + ';'
      + '  transition: border-color 0.2s;'
      + '}'
      + '.dinav-select-trigger:hover { border-color: ' + t.accent + '; }'
      + '.dinav-select-value { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }'
      + '.dinav-select-arrow { color: ' + t.textDim + '; font-size: 10px; flex-shrink: 0; }'
      + '.dinav-select-menu {'
      + '  display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;'
      + '  background: ' + t.cardBg + '; border: 1px solid ' + t.border + '; border-radius: 10px;'
      + '  z-index: 10; overflow: hidden;'
      + '  box-shadow: 0 8px 24px rgba(0,0,0,0.25);'
      + '}'
      + '.dinav-select-menu.open { display: block; }'
      + '.dinav-select-search {'
      + '  width: 100%; padding: 10px 14px; border: none; border-bottom: 1px solid ' + t.border + ';'
      + '  background: transparent; color: ' + t.textPrimary + '; font-size: 13px;'
      + '  font-family: inherit; outline: none;'
      + '}'
      + '.dinav-select-search::placeholder { color: ' + t.textDim + '; }'
      + '.dinav-select-list { max-height: 200px; overflow-y: auto; }'
      + '.dinav-select-list::-webkit-scrollbar { width: 6px; }'
      + '.dinav-select-list::-webkit-scrollbar-track { background: transparent; }'
      + '.dinav-select-list::-webkit-scrollbar-thumb { background: ' + t.border + '; border-radius: 3px; }'
      + '.dinav-select-row {'
      + '  display: flex; align-items: center; gap: 8px; padding: 8px 14px;'
      + '  cursor: pointer; font-size: 13px; color: ' + t.textPrimary + ';'
      + '  transition: background 0.15s;'
      + '}'
      + '.dinav-select-row:hover { background: ' + t.hoverBg + '; }'
      + '.dinav-select-row.selected { background: ' + accentSoft + '; }'
      + '.dinav-select-group-label {'
      + '  padding: 6px 14px; font-size: 9px; color: ' + t.textDim + ';'
      + '  letter-spacing: 0.1em; text-transform: uppercase;'
      + '}'
      + '.dinav-select-divider { height: 1px; background: ' + t.border + '; margin: 2px 0; }'
      // Visa pills
      + '.dinav-visa-pills { display: flex; flex-wrap: wrap; gap: 8px; }'
      + '.dinav-visa-pill {'
      + '  all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;'
      + '  padding: 8px 14px; border-radius: 20px; font-size: 12px;'
      + '  font-family: inherit;'
      + '  border: 1px solid ' + t.border + '; background: transparent;'
      + '  color: ' + t.textSecondary + '; transition: all 0.2s;'
      + '}'
      + '.dinav-visa-pill:hover { border-color: ' + t.accent + '; color: ' + t.textPrimary + '; }'
      + '.dinav-visa-pill.active {'
      + '  border-color: ' + t.accent + '; background: ' + accentMed + ';'
      + '  color: ' + t.accent + ';'
      + '}'
      + '.dinav-visa-empty { font-size: 12px; color: ' + t.textDim + '; }'
      // Primary button
      + '.dinav-btn-primary {'
      + '  width: 100%; padding: 12px; border: none; border-radius: 10px;'
      + '  background: ' + t.accent + '; color: #fff; font-size: 13px; font-weight: 600;'
      + '  cursor: pointer; font-family: "Syne", sans-serif; letter-spacing: -0.01em;'
      + '}'
      + '.dinav-btn-primary:hover { opacity: 0.9; }'
      + '.dinav-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }'
      + '.dinav-results { margin-top: 16px; }'
      + '.dinav-status {'
      + '  padding: 10px 14px; border-radius: 8px; margin-bottom: 12px;'
      + '  background: ' + t.cardBg + '; font-size: 13px;'
      + '}'
      + '.dinav-loading { color: ' + t.accent + '; }'
      + '.dinav-error { color: #ff6b6b; }'
      + '.dinav-verdict-go { color: #4caf50; }'
      + '.dinav-verdict-caution { color: #ffc107; }'
      + '.dinav-verdict-nogo { color: #ff5252; }'
      + '.dinav-slices { }'
      + '.dinav-slice-result {'
      + '  border-radius: 8px; padding: 12px; margin-bottom: 10px;'
      + '  border-left: 3px solid ' + t.border + ';'
      + '  background: ' + t.cardBg + ';'
      + '}'
      + '.dinav-slice-result.dinav-verdict-go { border-left-color: #4caf50; }'
      + '.dinav-slice-result.dinav-verdict-caution { border-left-color: #ffc107; }'
      + '.dinav-slice-result.dinav-verdict-nogo, .dinav-slice-result.dinav-verdict-no-go { border-left-color: #ff5252; }'
      + '.dinav-slice-header {'
      + '  display: flex; justify-content: space-between; align-items: center;'
      + '  margin-bottom: 8px; font-family: "Syne", sans-serif;'
      + '}'
      + '.dinav-verdict-badge {'
      + '  font-size: 11px; font-weight: 700; padding: 2px 8px;'
      + '  border-radius: 4px; text-transform: uppercase;'
      + '}'
      + '.dinav-verdict-go .dinav-verdict-badge { color: #4caf50; }'
      + '.dinav-verdict-caution .dinav-verdict-badge { color: #ffc107; }'
      + '.dinav-verdict-nogo .dinav-verdict-badge, .dinav-verdict-no-go .dinav-verdict-badge { color: #ff5252; }'
      + '.dinav-section { font-size: 12px; color: ' + t.textSecondary + '; margin-top: 6px; line-height: 1.6; }'
      + '.dinav-section-title { color: ' + t.accent + '; font-weight: 600; margin-right: 6px; }'
      + '.dinav-actions { margin-top: 12px; }'
      + '.dinav-btn-google {'
      + '  width: 100%; padding: 10px; border: 1px solid ' + t.border + '; border-radius: 10px;'
      + '  background: ' + t.cardBg + '; color: ' + t.textPrimary + '; font-size: 13px;'
      + '  cursor: pointer; font-family: inherit;'
      + '}'
      + '.dinav-btn-google:hover { border-color: ' + t.accent + '; }';
  }

  // ── Initial injection ──
  tryInjectCTA();

})();
