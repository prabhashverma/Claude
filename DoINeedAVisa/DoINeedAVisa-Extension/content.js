// DoINeedAVisa Chrome Extension — Content Script
// Injects CTA on Google Flights, shows visa check overlay with SSE streaming

(function () {
  'use strict';

  var CTA_ATTR = 'data-dinav-cta';
  var OVERLAY_ID = 'dinav-overlay-root';
  var DEBOUNCE_MS = 600;
  var MAX_HISTORY = 20;
  var searchHistory = [];

  // Dark themes match Google Flights dark mode (Material Design dark)
  var EXTENSION_THEMES = {
    black: {
      pageBg: '#1f1f1f', cardBg: '#28292a', headerBg: '#28292a',
      border: '#3c4043', textPrimary: '#e3e3e3', textSecondary: '#9aa0a6',
      textDim: '#70757a', accent: '#8ab4f8', inputBg: '#28292a',
      pillBg: 'rgba(255,255,255,0.05)', hoverBg: 'rgba(255,255,255,0.08)',
      ctaColor: '#8ab4f8', ctaBg: 'rgba(138,180,248,0.12)', ctaBorder: '#8ab4f8',
      ctaHover: 'rgba(138,180,248,0.2)',
    },
    blue: {
      pageBg: '#202124', cardBg: '#303134', headerBg: '#28292c',
      border: '#3c4043', textPrimary: '#e8eaed', textSecondary: '#9aa0a6',
      textDim: '#5f6368', accent: '#8ab4f8', inputBg: '#303134',
      pillBg: 'rgba(255,255,255,0.05)', hoverBg: 'rgba(255,255,255,0.08)',
      ctaColor: '#8ab4f8', ctaBg: 'rgba(138,180,248,0.12)', ctaBorder: '#8ab4f8',
      ctaHover: 'rgba(138,180,248,0.2)',
    },
    light: {
      pageBg: '#FFFFFF', cardBg: '#F1F3F4', headerBg: '#F8F9FA',
      border: '#DADCE0', textPrimary: '#202124', textSecondary: '#5f6368',
      textDim: '#80868b', accent: '#1a73e8', inputBg: '#F1F3F4',
      pillBg: 'rgba(0,0,0,0.04)', hoverBg: 'rgba(0,0,0,0.06)',
      ctaColor: '#1a73e8', ctaBg: 'rgba(26,115,232,0.08)', ctaBorder: '#1a73e8',
      ctaHover: 'rgba(26,115,232,0.15)',
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

  var FALLBACK_DELAY = 4000; // ms before giving up on native row and using floating CTA
  var fallbackTimer = null;

  function tryInjectCTA() {
    if (!hasTfsParam()) {
      removeCTA();
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
      return;
    }

    // Strategy 1: Insert as a native booking-option row in booking list
    var result = findBookingOptionsArea();
    if (result) {
      // If our CTA is already inside this container, don't recreate — avoids flicker
      if (result.container.querySelector('[' + CTA_ATTR + ']')) return;
      // Remove any floating CTA — we found the real spot
      removeCTA();
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
      var row = createBookingRow();
      result.container.insertBefore(row, result.insertBefore || null);
      return;
    }

    // Already have a CTA injected (native row or floating) — don't duplicate
    if (document.querySelector('[' + CTA_ATTR + ']')) return;

    // Booking options not in DOM yet — schedule floating fallback after delay
    if (!fallbackTimer) {
      fallbackTimer = setTimeout(function () {
        fallbackTimer = null;
        // Double-check: maybe booking options appeared in the meantime
        if (document.querySelector('[' + CTA_ATTR + ']')) return;
        var result2 = findBookingOptionsArea();
        if (result2) {
          if (result2.container.querySelector('[' + CTA_ATTR + ']')) return;
          var row2 = createBookingRow();
          result2.container.insertBefore(row2, result2.insertBefore || null);
          return;
        }
        // Still no booking options — use floating fallback
        var floating = createCTAButton(true);
        document.body.appendChild(floating);
      }, FALLBACK_DELAY);
    }
  }

  function findBookingOptionsArea() {
    // Find "Booking options" text on the page, then insert right after that heading section
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (/^Booking options$/i.test(node.textContent.trim())) {
        // Found the heading text — walk up to find the section wrapper
        var heading = node.parentElement;
        // The heading might be inside a wrapper (e.g. h2 > span > text)
        // Walk up until we find an element that has sibling(s) containing "Book with"
        var section = heading;
        for (var i = 0; i < 6; i++) {
          if (!section.parentElement) break;
          section = section.parentElement;
          var next = section.nextElementSibling;
          if (next && /Book with/i.test(next.textContent || '')) {
            // next is the first booking row — insert before it
            return { container: section.parentElement, insertBefore: next };
          }
          // Also check: does this section's parent contain "Book with" children?
          var kids = section.parentElement.children;
          for (var k = 0; k < kids.length; k++) {
            if (kids[k] !== section && /Book with/i.test(kids[k].textContent || '')) {
              // Insert right after the heading section, before the first booking row
              return { container: section.parentElement, insertBefore: kids[k] };
            }
          }
        }
        // Fallback: just append after the heading's parent
        if (heading.parentElement) {
          var parent = heading.parentElement;
          return { container: parent.parentElement || parent, insertBefore: parent.nextElementSibling };
        }
      }
    }
    return null;
  }

  function createBookingRow() {
    // Outer div for relative positioning (popover anchors here)
    var outerDiv = document.createElement('div');
    outerDiv.setAttribute(CTA_ATTR, 'true');
    outerDiv.style.cssText = 'position:relative;';

    var wrapper = document.createElement('div');
    wrapper.style.cssText = ''
      + 'display:flex; align-items:center; padding:16px 20px; cursor:pointer;'
      + 'border:1px solid var(--gm3-sys-color-outline-variant, #dadce0); border-radius:12px;'
      + 'margin:0 0 12px 0;'
      + 'font-family:"Google Sans",Roboto,Arial,sans-serif;'
      + 'transition:background 0.15s;';

    // Logo — gradient circle with arrow icon
    var logo = document.createElement('div');
    logo.style.cssText = ''
      + 'width:40px; height:40px; border-radius:50%; flex-shrink:0; margin-right:16px;'
      + 'background:linear-gradient(135deg,#8ab4f8,#1a73e8);'
      + 'display:flex; align-items:center; justify-content:center;'
      + 'font-size:18px; color:#fff;';
    logo.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

    // Text column
    var textCol = document.createElement('div');
    textCol.style.cssText = 'flex:1; min-width:0;';
    var title = document.createElement('div');
    title.style.cssText = ''
      + 'font-size:14px; font-weight:400; line-height:20px;'
      + 'color:var(--gm3-sys-color-on-surface, #202124);';
    title.textContent = 'Should I book this flight? Do I need a transit visa? Can I access lounge?';
    textCol.appendChild(title);

    // Profile bar — shows passport/visa/lounge or prompt
    var profileBar = document.createElement('div');
    profileBar.style.cssText = ''
      + 'background:var(--gm3-sys-color-surface-container, #f1f3f4);'
      + 'border-radius:8px; padding:4px 12px; font-size:12px; display:inline-flex;'
      + 'align-items:center; gap:6px; margin-top:4px; line-height:18px;';

    var editSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;opacity:0.6;flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    profileBar.innerHTML = '<span style="color:#70757a">Set your passport &amp; visa to get started</span> ' + editSvg;
    textCol.appendChild(profileBar);

    // Price — "Free"
    var price = document.createElement('div');
    price.style.cssText = ''
      + 'font-size:14px; font-weight:500; white-space:nowrap; margin-left:auto; padding-left:16px;'
      + 'color:var(--gm3-sys-color-on-surface, #202124);';
    price.textContent = 'Free';

    // "Check" outlined button
    var btn = document.createElement('button');
    btn.style.cssText = ''
      + 'margin-left:16px; padding:8px 24px; border-radius:20px;'
      + 'border:1px solid var(--gm3-sys-color-outline, #747775);'
      + 'background:transparent; color:var(--gm3-sys-color-primary, #1a73e8);'
      + 'font-size:14px; font-weight:500; cursor:pointer;'
      + 'font-family:"Google Sans",Roboto,Arial,sans-serif; white-space:nowrap;'
      + 'line-height:20px;';
    btn.textContent = 'Check';
    btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(26,115,232,0.04)'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; });

    wrapper.appendChild(logo);
    wrapper.appendChild(textCol);
    wrapper.appendChild(price);
    wrapper.appendChild(btn);
    outerDiv.appendChild(wrapper);

    // Track loaded prefs
    var loadedPassport = '';
    var loadedVisa = '';
    var loadedLounge = '';

    // Inline popover for editing prefs
    var popover = createPrefsPopover(outerDiv, function (p, v, l) {
      loadedPassport = p;
      loadedVisa = v;
      loadedLounge = l;
      updateProfileBar(p, v, l);
    });

    // Wire pencil click to toggle popover
    function attachEditClick() {
      var editIcon = profileBar.querySelector('svg');
      if (editIcon) {
        editIcon.addEventListener('click', function (e) {
          e.stopPropagation();
          if (popover.isVisible()) popover.hide(); else popover.show();
        });
      }
    }
    attachEditClick();

    function updateProfileBar(passport, visa, lounge) {
      if (!passport) {
        profileBar.innerHTML = '<span style="color:#70757a">Set your passport &amp; visa to get started</span> ' + editSvg;
      } else {
        var c = getCountryByIso3(passport);
        var passportHtml = c
          ? '<img src="' + flagUrl(c.code, 16) + '" style="width:16px;height:12px;border-radius:2px;object-fit:cover;vertical-align:middle" alt="" /> ' + c.name
          : passport;
        var visaName = 'None';
        if (visa) {
          for (var i = 0; i < DINAV_DOOR_OPENER_VISAS.length; i++) {
            if (DINAV_DOOR_OPENER_VISAS[i].visaId === visa) {
              visaName = '<img src="' + flagUrl(DINAV_DOOR_OPENER_VISAS[i].iso2, 14) + '" style="width:14px;height:10px;border-radius:2px;object-fit:cover;vertical-align:middle" alt="" /> ' + DINAV_DOOR_OPENER_VISAS[i].name;
              break;
            }
          }
        }
        var loungeName = 'None';
        if (lounge) {
          for (var j = 0; j < DINAV_LOUNGE_OPTIONS.length; j++) {
            if (DINAV_LOUNGE_OPTIONS[j].id === lounge) { loungeName = DINAV_LOUNGE_OPTIONS[j].name; break; }
          }
        }
        profileBar.innerHTML = ''
          + '<span style="color:#70757a">Passport:</span> <span style="color:#202124">' + passportHtml + '</span>'
          + ' <span style="color:#dadce0">|</span> '
          + '<span style="color:#70757a">Visa:</span> <span style="color:#202124">' + visaName + '</span>'
          + ' <span style="color:#dadce0">|</span> '
          + '<span style="color:#70757a">Lounge:</span> <span style="color:#202124">' + loungeName + '</span>'
          + ' ' + editSvg;
      }
      attachEditClick();
    }

    // Load prefs and update profile bar
    chrome.storage.local.get(['dinav_passport', 'dinav_visa', 'dinav_lounge'], function (data) {
      loadedPassport = data.dinav_passport || '';
      loadedVisa = data.dinav_visa || '';
      loadedLounge = data.dinav_lounge || '';
      updateProfileBar(loadedPassport, loadedVisa, loadedLounge);
    });

    // Check button click — open overlay
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (popover.isVisible()) popover.hide();
      if (!loadedPassport) {
        openOverlay({ expandPrefs: true });
      } else {
        openOverlay({ autoSearch: true });
      }
    });

    // Row click — same as check
    wrapper.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (popover.isVisible()) popover.hide();
      if (!loadedPassport) {
        openOverlay({ expandPrefs: true });
      } else {
        openOverlay({ autoSearch: true });
      }
    });
    wrapper.addEventListener('mouseenter', function () {
      wrapper.style.background = 'var(--gm3-sys-color-surface-container-low, rgba(0,0,0,0.02))';
    });
    wrapper.addEventListener('mouseleave', function () {
      wrapper.style.background = '';
    });

    return outerDiv;
  }

  // ── Inline Prefs Popover ──

  function getSharedPrefsCSS(t, isDark) {
    var accentSoft = isDark ? 'rgba(138,180,248,0.08)' : (t.accent + '12');
    var accentMed = isDark ? 'rgba(138,180,248,0.15)' : (t.accent + '1A');
    return ''
      + '.dinav-field { margin-bottom: 14px; }'
      + '.dinav-field label {'
      + '  display: block; font-size: 10px; color: ' + t.textDim + ';'
      + '  margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.12em;'
      + '}'
      + '.dinav-flag { width: 16px; height: 12px; border-radius: 2px; object-fit: cover; vertical-align: middle; flex-shrink: 0; }'
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
      + '.dinav-btn-primary {'
      + '  width: 100%; padding: 12px; border: none; border-radius: 10px;'
      + '  background: ' + t.accent + '; color: #fff; font-size: 13px; font-weight: 600;'
      + '  cursor: pointer; font-family: "Syne", sans-serif; letter-spacing: -0.01em;'
      + '}'
      + '.dinav-btn-primary:hover { opacity: 0.9; }'
      + '.dinav-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }';
  }

  function createPrefsPopover(anchorEl, onSave) {
    var popHost = null;
    var popShadow = null;
    var outsideListener = null;

    function buildPopoverHTML() {
      return ''
        + '<div class="dinav-pop-card">'
        + '  <div class="dinav-pop-header">'
        + '    <span class="dinav-pop-title">Travel Profile</span>'
        + '    <button class="dinav-pop-close">&times;</button>'
        + '  </div>'
        + '  <input type="hidden" id="dinav-pop-passport" value="" />'
        + '  <input type="hidden" id="dinav-pop-visa" value="" />'
        + '  <input type="hidden" id="dinav-pop-lounge" value="" />'
        + '  <div class="dinav-field">'
        + '    <label>Passport</label>'
        + '    <div class="dinav-custom-select" id="dinav-pop-passport-dropdown">'
        + '      <div class="dinav-select-trigger" id="dinav-pop-passport-trigger">'
        + '        <span class="dinav-select-value" id="dinav-pop-passport-label">Select passport</span>'
        + '        <span class="dinav-select-arrow">&#9662;</span>'
        + '      </div>'
        + '      <div class="dinav-select-menu" id="dinav-pop-passport-menu">'
        + '        <input type="text" class="dinav-select-search" id="dinav-pop-passport-search" placeholder="Search countries..." />'
        + '        <div class="dinav-select-list" id="dinav-pop-passport-list"></div>'
        + '      </div>'
        + '    </div>'
        + '  </div>'
        + '  <div class="dinav-field">'
        + '    <label>Visa held</label>'
        + '    <div class="dinav-visa-pills" id="dinav-pop-visa-pills"></div>'
        + '  </div>'
        + '  <div class="dinav-field">'
        + '    <label>Lounge access</label>'
        + '    <div class="dinav-lounge-pills" id="dinav-pop-lounge-pills"></div>'
        + '  </div>'
        + '  <button id="dinav-pop-save" class="dinav-btn-primary">Save</button>'
        + '</div>';
    }

    function getPopoverCSS() {
      var t = currentTheme;
      var isDark = currentThemeId !== 'light';
      return ''
        + '@import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap");'
        + '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }'
        + getSharedPrefsCSS(t, isDark)
        + '.dinav-pop-card {'
        + '  background: ' + t.cardBg + '; border: 1px solid ' + t.border + ';'
        + '  border-radius: 12px; padding: 16px 20px;'
        + '  box-shadow: 0 8px 32px rgba(0,0,0,0.25);'
        + '  font-family: "DM Mono", "SF Mono", "Fira Code", monospace; font-size: 13px;'
        + '  color: ' + t.textPrimary + '; margin-top: 4px;'
        + '}'
        + '.dinav-pop-header {'
        + '  display: flex; justify-content: space-between; align-items: center;'
        + '  margin-bottom: 14px;'
        + '}'
        + '.dinav-pop-title {'
        + '  font-family: "Syne", sans-serif; font-size: 14px; font-weight: 600;'
        + '  color: ' + t.textPrimary + ';'
        + '}'
        + '.dinav-pop-close {'
        + '  background: none; border: none; color: ' + t.textDim + '; font-size: 20px;'
        + '  cursor: pointer; padding: 2px 6px; border-radius: 4px; font-family: inherit; line-height: 1;'
        + '}'
        + '.dinav-pop-close:hover { color: ' + t.textPrimary + '; background: ' + t.hoverBg + '; }';
    }

    function show() {
      if (popHost) return;
      popHost = document.createElement('div');
      popHost.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:9999;';
      popShadow = popHost.attachShadow({ mode: 'closed' });

      var style = document.createElement('style');
      style.textContent = getPopoverCSS();
      popShadow.appendChild(style);

      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildPopoverHTML();
      popShadow.appendChild(wrapper);
      anchorEl.appendChild(popHost);

      buildPassportListIn(popShadow, 'dinav-pop-', '');
      renderVisaPillsIn(popShadow, 'dinav-pop-', '');
      renderLoungePillsIn(popShadow, 'dinav-pop-');

      chrome.storage.local.get(['dinav_passport', 'dinav_visa', 'dinav_lounge'], function (data) {
        if (!popShadow) return;
        if (data.dinav_passport) {
          selectPassportIn(popShadow, 'dinav-pop-', data.dinav_passport, true);
          renderVisaPillsIn(popShadow, 'dinav-pop-', data.dinav_passport);
        }
        if (data.dinav_visa) {
          var visaInput = popShadow.querySelector('#dinav-pop-visa');
          if (visaInput) visaInput.value = data.dinav_visa;
          renderVisaPillsIn(popShadow, 'dinav-pop-', data.dinav_passport || '');
        }
        if (data.dinav_lounge) {
          var loungeInput = popShadow.querySelector('#dinav-pop-lounge');
          if (loungeInput) loungeInput.value = data.dinav_lounge;
          renderLoungePillsIn(popShadow, 'dinav-pop-');
        }
      });

      popShadow.querySelector('#dinav-pop-passport-trigger').addEventListener('click', function () {
        var menu = popShadow.querySelector('#dinav-pop-passport-menu');
        var isOpen = menu.classList.contains('open');
        menu.classList.toggle('open');
        if (!isOpen) {
          var input = popShadow.querySelector('#dinav-pop-passport-search');
          input.value = '';
          buildPassportListIn(popShadow, 'dinav-pop-', '');
          setTimeout(function () { input.focus(); }, 50);
        }
      });

      popShadow.querySelector('#dinav-pop-passport-search').addEventListener('input', function () {
        buildPassportListIn(popShadow, 'dinav-pop-', this.value);
      });

      wrapper.addEventListener('click', function (e) {
        var dropdown = popShadow.querySelector('#dinav-pop-passport-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
          popShadow.querySelector('#dinav-pop-passport-menu').classList.remove('open');
        }
      });

      popShadow.querySelector('.dinav-pop-close').addEventListener('click', function () { hide(); });

      popShadow.querySelector('#dinav-pop-save').addEventListener('click', function () {
        var passport = popShadow.querySelector('#dinav-pop-passport').value;
        var visa = popShadow.querySelector('#dinav-pop-visa').value;
        var lounge = popShadow.querySelector('#dinav-pop-lounge').value;
        chrome.storage.local.set({ dinav_passport: passport, dinav_visa: visa, dinav_lounge: lounge });
        if (onSave) onSave(passport, visa, lounge);
        hide();
      });

      var searchInput = popShadow.querySelector('#dinav-pop-passport-search');
      var passportMenu = popShadow.querySelector('#dinav-pop-passport-menu');
      passportMenu.classList.add('open');
      setTimeout(function () { if (searchInput) searchInput.focus(); }, 100);

      outsideListener = function (e) {
        if (popHost && !popHost.contains(e.target)) hide();
      };
      setTimeout(function () {
        document.addEventListener('click', outsideListener, { capture: true });
      }, 0);
    }

    function hide() {
      if (outsideListener) {
        document.removeEventListener('click', outsideListener, { capture: true });
        outsideListener = null;
      }
      if (popHost) { popHost.remove(); popHost = null; popShadow = null; }
    }

    function isVisible() { return !!popHost; }

    return { show: show, hide: hide, isVisible: isVisible };
  }

  // ── Parameterized selection functions (work with any root + prefix) ──

  function buildPassportListIn(root, prefix, query) {
    if (!root) return;
    var list = root.querySelector('#' + prefix + 'passport-list');
    if (!list) return;
    list.innerHTML = '';
    var q = (query || '').toLowerCase().trim();
    var currentVal = root.querySelector('#' + prefix + 'passport').value;

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

    popular.sort(function (a, b) { return POPULAR.indexOf(a.iso3) - POPULAR.indexOf(b.iso3); });

    function renderRow(c) {
      var row = document.createElement('div');
      row.className = 'dinav-select-row' + (currentVal === c.iso3 ? ' selected' : '');
      row.innerHTML = '<img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" />'
        + '<span>' + c.name + '</span>';
      row.addEventListener('click', function () {
        selectPassportIn(root, prefix, c.iso3);
        root.querySelector('#' + prefix + 'passport-menu').classList.remove('open');
      });
      return row;
    }

    if (popular.length > 0 && !q) {
      var header = document.createElement('div');
      header.className = 'dinav-select-group-label';
      header.textContent = 'POPULAR';
      list.appendChild(header);
      for (var p = 0; p < popular.length; p++) list.appendChild(renderRow(popular[p]));
      var divider = document.createElement('div');
      divider.className = 'dinav-select-divider';
      list.appendChild(divider);
    }

    for (var r = 0; r < rest.length; r++) list.appendChild(renderRow(rest[r]));
  }

  function selectPassportIn(root, prefix, iso3, silent) {
    if (!root) return;
    var hidden = root.querySelector('#' + prefix + 'passport');
    var label = root.querySelector('#' + prefix + 'passport-label');
    hidden.value = iso3;
    var c = getCountryByIso3(iso3);
    if (c) {
      label.innerHTML = '<img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" /> ' + c.name;
    } else {
      label.textContent = iso3 || 'Select passport';
    }
    if (!silent) renderVisaPillsIn(root, prefix, iso3);
  }

  function renderVisaPillsIn(root, prefix, passportIso3) {
    if (!root) return;
    var container = root.querySelector('#' + prefix + 'visa-pills');
    var hiddenInput = root.querySelector('#' + prefix + 'visa');
    if (!container) return;
    container.innerHTML = '';
    var filtered = getFilteredVisaOptions(passportIso3 || '');
    var currentVisa = hiddenInput ? hiddenInput.value : '';

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
        pill.innerHTML = '<img class="dinav-flag" src="' + flagUrl(v.iso2, 14) + '" alt="" /> ' + v.name;
        pill.addEventListener('click', function () {
          var wasActive = pill.classList.contains('active');
          var all = container.querySelectorAll('.dinav-visa-pill');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
          if (wasActive) { hiddenInput.value = ''; nonePill.classList.add('active'); }
          else { hiddenInput.value = v.visaId; pill.classList.add('active'); }
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

  function renderLoungePillsIn(root, prefix) {
    if (!root) return;
    var container = root.querySelector('#' + prefix + 'lounge-pills');
    var hiddenInput = root.querySelector('#' + prefix + 'lounge');
    if (!container) return;
    container.innerHTML = '';
    var currentLounge = hiddenInput ? hiddenInput.value : '';

    var nonePill = document.createElement('button');
    nonePill.className = 'dinav-visa-pill' + (!currentLounge ? ' active' : '');
    nonePill.textContent = 'None';
    nonePill.addEventListener('click', function () {
      hiddenInput.value = '';
      var all = container.querySelectorAll('.dinav-visa-pill');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      nonePill.classList.add('active');
    });
    container.appendChild(nonePill);

    for (var i = 0; i < DINAV_LOUNGE_OPTIONS.length; i++) {
      (function (opt) {
        var pill = document.createElement('button');
        pill.className = 'dinav-visa-pill' + (currentLounge === opt.id ? ' active' : '');
        pill.textContent = opt.name;
        pill.addEventListener('click', function () {
          var wasActive = pill.classList.contains('active');
          var all = container.querySelectorAll('.dinav-visa-pill');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
          if (wasActive) { hiddenInput.value = ''; nonePill.classList.add('active'); }
          else { hiddenInput.value = opt.id; pill.classList.add('active'); }
        });
        container.appendChild(pill);
      })(DINAV_LOUNGE_OPTIONS[i]);
    }
  }

  function createCTAButton(floating) {
    var btn = document.createElement('button');
    btn.setAttribute(CTA_ATTR, 'true');
    btn.className = 'dinav-cta-btn' + (floating ? ' dinav-cta-floating' : '');
    // Branded logo: do[i]need[a]visa with accent-colored i and a
    btn.innerHTML = '<span class="dinav-cta-plane">\u2708</span>'
      + '<span class="dinav-cta-logo">do<span class="dinav-cta-accent">i</span>need<span class="dinav-cta-accent">a</span>visa</span>';
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

  function openOverlay(opts) {
    opts = opts || {};
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

    // Push page content left (like Gemini panel)
    document.body.style.transition = 'margin-right 0.3s ease';
    document.body.style.marginRight = '380px';

    // Build passport list, visa pills, and lounge pills
    buildPassportList('');
    renderVisaPills('');
    renderLoungePills();

    // Load saved preferences
    chrome.storage.local.get(['dinav_passport', 'dinav_visa', 'dinav_lounge'], function (data) {
      if (!shadowRoot) return; // panel was closed before storage callback
      if (data.dinav_passport) {
        selectPassport(data.dinav_passport, true);
      }
      if (data.dinav_visa) {
        shadowRoot.querySelector('#dinav-visa').value = data.dinav_visa;
        updateContextVisa(data.dinav_visa);
      }
      if (data.dinav_lounge) {
        var loungeInput = shadowRoot.querySelector('#dinav-lounge');
        if (loungeInput) loungeInput.value = data.dinav_lounge;
        updateContextLounge(data.dinav_lounge);
      }
      // Render visa pills with passport context + lounge pills
      renderVisaPills(data.dinav_passport || '');
      renderLoungePills();

      // Determine prefs expansion
      if (opts.expandPrefs || !data.dinav_passport) {
        var editor = shadowRoot.querySelector('#dinav-prefs-editor');
        if (editor) editor.classList.add('open');
        // Auto-focus passport search when prefs are expanded
        var passportMenu = shadowRoot.querySelector('#dinav-passport-menu');
        if (passportMenu) passportMenu.classList.add('open');
        var searchInput = shadowRoot.querySelector('#dinav-passport-search');
        if (searchInput) setTimeout(function () { searchInput.focus(); }, 100);
      }

      // Auto-search: fire immediately if passport is set
      if (opts.autoSearch && data.dinav_passport) {
        runVisaCheck(parsed);
      }
    });

    // Theme toggle
    renderThemeToggle();

    // Render search history
    loadHistory(function () { renderHistory(); });

    // Event listeners
    shadowRoot.querySelector('#dinav-close').addEventListener('click', closeOverlay);

    // Context bar click — toggle prefs editor
    shadowRoot.querySelector('#dinav-context-bar').addEventListener('click', function () {
      var editor = shadowRoot.querySelector('#dinav-prefs-editor');
      editor.classList.toggle('open');
    });

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
    var ctxPassport = shadowRoot.querySelector('#dinav-context-passport');
    hidden.value = iso3;
    var c = getCountryByIso3(iso3);
    if (c) {
      label.innerHTML = '<img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" /> ' + c.name;
      if (ctxPassport) ctxPassport.innerHTML = 'Passport: <img class="dinav-flag" src="' + flagUrl(c.code, 16) + '" alt="" /> ' + c.name;
    } else {
      label.textContent = iso3 || 'Select passport';
      if (ctxPassport) ctxPassport.textContent = 'Select passport';
    }
    if (!silent) {
      renderVisaPills(iso3);
    }
  }

  function updateContextVisa(visaId) {
    if (!shadowRoot) return;
    var ctxVisa = shadowRoot.querySelector('#dinav-context-visa');
    if (!ctxVisa) return;
    if (!visaId) {
      ctxVisa.textContent = 'None';
      return;
    }
    for (var i = 0; i < DINAV_DOOR_OPENER_VISAS.length; i++) {
      var v = DINAV_DOOR_OPENER_VISAS[i];
      if (v.visaId === visaId) {
        ctxVisa.innerHTML = '<img class="dinav-flag" src="' + flagUrl(v.iso2, 14) + '" alt="" /> ' + v.name;
        return;
      }
    }
    ctxVisa.textContent = visaId.replace(/_/g, ' ');
  }

  function renderVisaPills(passportIso3) {
    if (!shadowRoot) return;
    var container = shadowRoot.querySelector('#dinav-visa-pills');
    var hiddenInput = shadowRoot.querySelector('#dinav-visa');
    if (!container) return;
    container.innerHTML = '';
    var filtered = getFilteredVisaOptions(passportIso3 || '');
    var currentVisa = hiddenInput ? hiddenInput.value : '';

    // Update context bar
    updateContextVisa(currentVisa);

    // "None" pill
    var nonePill = document.createElement('button');
    nonePill.className = 'dinav-visa-pill' + (!currentVisa ? ' active' : '');
    nonePill.textContent = 'None';
    nonePill.addEventListener('click', function () {
      hiddenInput.value = '';
      var all = container.querySelectorAll('.dinav-visa-pill');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      nonePill.classList.add('active');
      updateContextVisa('');
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
            hiddenInput.value = '';
            nonePill.classList.add('active');
            updateContextVisa('');
          } else {
            hiddenInput.value = v.visaId;
            pill.classList.add('active');
            updateContextVisa(v.visaId);
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

  function updateContextLounge(loungeId) {
    if (!shadowRoot) return;
    var ctxLounge = shadowRoot.querySelector('#dinav-context-lounge');
    if (!ctxLounge) return;
    if (!loungeId) { ctxLounge.textContent = 'None'; return; }
    for (var i = 0; i < DINAV_LOUNGE_OPTIONS.length; i++) {
      if (DINAV_LOUNGE_OPTIONS[i].id === loungeId) {
        ctxLounge.textContent = DINAV_LOUNGE_OPTIONS[i].name;
        return;
      }
    }
    ctxLounge.textContent = loungeId.replace(/_/g, ' ');
  }

  function renderLoungePills() {
    if (!shadowRoot) return;
    var container = shadowRoot.querySelector('#dinav-lounge-pills');
    var hiddenInput = shadowRoot.querySelector('#dinav-lounge');
    if (!container) return;
    container.innerHTML = '';
    var currentLounge = hiddenInput ? hiddenInput.value : '';

    updateContextLounge(currentLounge);

    var nonePill = document.createElement('button');
    nonePill.className = 'dinav-visa-pill' + (!currentLounge ? ' active' : '');
    nonePill.textContent = 'None';
    nonePill.addEventListener('click', function () {
      hiddenInput.value = '';
      var all = container.querySelectorAll('.dinav-visa-pill');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      nonePill.classList.add('active');
      updateContextLounge('');
    });
    container.appendChild(nonePill);

    for (var i = 0; i < DINAV_LOUNGE_OPTIONS.length; i++) {
      (function (opt) {
        var pill = document.createElement('button');
        pill.className = 'dinav-visa-pill' + (currentLounge === opt.id ? ' active' : '');
        pill.textContent = opt.name;
        pill.addEventListener('click', function () {
          var wasActive = pill.classList.contains('active');
          var all = container.querySelectorAll('.dinav-visa-pill');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
          if (wasActive) { hiddenInput.value = ''; nonePill.classList.add('active'); updateContextLounge(''); }
          else { hiddenInput.value = opt.id; pill.classList.add('active'); updateContextLounge(opt.id); }
        });
        container.appendChild(pill);
      })(DINAV_LOUNGE_OPTIONS[i]);
    }
  }

  function closeOverlay() {
    // Restore page content position
    document.body.style.marginRight = '';
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

  // ── Search History ──

  function loadHistory(cb) {
    chrome.storage.local.get(['dinav_history'], function (data) {
      searchHistory = data.dinav_history || [];
      if (cb) cb();
    });
  }

  function saveHistory() {
    chrome.storage.local.set({ dinav_history: searchHistory.slice(0, MAX_HISTORY) });
  }

  function addHistoryEntry(passportIso3, visaId, parsed, verdict, summary) {
    var routes = [];
    for (var i = 0; i < parsed.slices.length; i++) {
      var sl = parsed.slices[i];
      if (sl.flights.length > 0) {
        routes.push(sl.flights[0].departure + ' \u2192 ' + sl.flights[sl.flights.length - 1].arrival);
      }
    }
    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      passport: passportIso3,
      visa: visaId || '',
      route: routes.join(' | '),
      verdict: verdict || '',
      summary: (summary || '').slice(0, 300),
    };
    searchHistory.unshift(entry);
    searchHistory = searchHistory.slice(0, MAX_HISTORY);
    saveHistory();
    renderHistory();
  }

  function verdictColor(v) {
    var vl = (v || '').toLowerCase().replace(/[_-]/g, '');
    if (vl === 'go' || vl === 'green') return '#4caf50';
    if (vl === 'caution' || vl === 'yellow') return '#ffc107';
    if (vl === 'nogo' || vl === 'red') return '#ff5252';
    return currentTheme.textDim;
  }

  function renderHistory() {
    if (!shadowRoot) return;
    var container = shadowRoot.querySelector('#dinav-history');
    if (!container) return;

    if (searchHistory.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.innerHTML = '';

    // Header row
    var header = document.createElement('div');
    header.className = 'dinav-history-header';
    header.innerHTML = '<span>Search History</span>';
    var clearBtn = document.createElement('button');
    clearBtn.className = 'dinav-history-clear';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', function () {
      searchHistory = [];
      saveHistory();
      renderHistory();
    });
    header.appendChild(clearBtn);
    container.appendChild(header);

    // Entries
    for (var i = 0; i < searchHistory.length; i++) {
      (function (entry) {
        var row = document.createElement('div');
        row.className = 'dinav-history-entry';

        var timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var vColor = verdictColor(entry.verdict);
        var passportC = getCountryByIso3(entry.passport);
        var passportFlag = passportC ? '<img class="dinav-flag" src="' + flagUrl(passportC.code, 14) + '" alt="" /> ' : '';
        var passportLabel = passportC ? passportC.iso3 : entry.passport;

        var visaHtml = '';
        if (entry.visa) {
          visaHtml = '<span class="dinav-history-visa">' + entry.visa.replace(/_/g, ' ') + '</span>';
        }

        row.innerHTML = ''
          + '<div class="dinav-history-row">'
          + '  <span class="dinav-history-time">' + timeStr + '</span>'
          + '  <span class="dinav-history-dot" style="background:' + vColor + '"></span>'
          + '  <span class="dinav-history-passport">' + passportFlag + passportLabel + '</span>'
          + visaHtml
          + '  <span class="dinav-history-route" style="color:' + vColor + '">' + (entry.route || '') + '</span>'
          + '  <span class="dinav-history-arrow">\u25BC</span>'
          + '</div>'
          + '<div class="dinav-history-detail">'
          + '  <div class="dinav-history-verdict">' + (entry.verdict || '').replace(/_/g, ' ') + '</div>'
          + '  <div class="dinav-history-summary">' + (entry.summary || 'No summary available.') + '</div>'
          + '</div>';

        var rowHeader = row.querySelector('.dinav-history-row');
        var detail = row.querySelector('.dinav-history-detail');
        var arrow = row.querySelector('.dinav-history-arrow');
        rowHeader.addEventListener('click', function () {
          var isOpen = detail.classList.contains('open');
          // Close all others
          var allDetails = container.querySelectorAll('.dinav-history-detail');
          var allArrows = container.querySelectorAll('.dinav-history-arrow');
          for (var j = 0; j < allDetails.length; j++) {
            allDetails[j].classList.remove('open');
            allArrows[j].textContent = '\u25BC';
          }
          if (!isOpen) {
            detail.classList.add('open');
            arrow.textContent = '\u25B2';
          }
        });
        container.appendChild(row);
      })(searchHistory[i]);
    }
  }

  // Load history on init
  loadHistory();

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
      // Passport & Visa context bar (clickable to expand editor)
      + '<div class="dinav-context-bar" id="dinav-context-bar">'
      + '  <span id="dinav-context-passport" class="dinav-context-text">Select passport</span>'
      + '  <span class="dinav-context-sep">|</span>'
      + '  <span class="dinav-context-label">Visa:</span>'
      + '  <span id="dinav-context-visa" class="dinav-context-text">None</span>'
      + '  <span class="dinav-context-sep">|</span>'
      + '  <span class="dinav-context-label">Lounge:</span>'
      + '  <span id="dinav-context-lounge" class="dinav-context-text">None</span>'
      + '  <svg class="dinav-context-edit" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      + '</div>'
      // Hidden inputs
      + '<input type="hidden" id="dinav-passport" value="" />'
      + '<input type="hidden" id="dinav-visa" value="" />'
      + '<input type="hidden" id="dinav-lounge" value="" />'
      // Collapsible passport/visa editor
      + '<div class="dinav-prefs-editor" id="dinav-prefs-editor">'
      + '  <div class="dinav-field">'
      + '    <label>Passport</label>'
      + '    <div class="dinav-custom-select" id="dinav-passport-dropdown">'
      + '      <div class="dinav-select-trigger" id="dinav-passport-trigger">'
      + '        <span class="dinav-select-value" id="dinav-passport-label">Select passport</span>'
      + '        <span class="dinav-select-arrow">&#9662;</span>'
      + '      </div>'
      + '      <div class="dinav-select-menu" id="dinav-passport-menu">'
      + '        <input type="text" class="dinav-select-search" id="dinav-passport-search" placeholder="Search countries..." />'
      + '        <div class="dinav-select-list" id="dinav-passport-list"></div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="dinav-field">'
      + '    <label>Visa held</label>'
      + '    <div class="dinav-visa-pills" id="dinav-visa-pills"></div>'
      + '  </div>'
      + '  <div class="dinav-field">'
      + '    <label>Lounge access</label>'
      + '    <div class="dinav-lounge-pills" id="dinav-lounge-pills"></div>'
      + '  </div>'
      + '</div>'
      + '<div class="dinav-body">'
      + '  <div class="dinav-flights">' + flightTags + '</div>'
      + '  <div class="dinav-form">'
      + '    <button id="dinav-check" class="dinav-btn-primary">Check Visa</button>'
      + '  </div>'
      + '  <div id="dinav-results" class="dinav-results" style="display:none">'
      + '    <div id="dinav-status" class="dinav-status"></div>'
      + '    <div id="dinav-slices" class="dinav-slices"></div>'
      + '    <div id="dinav-actions" class="dinav-actions" style="display:none"></div>'
      + '  </div>'
      + '  <div id="dinav-history" class="dinav-history" style="display:none"></div>'
      + '</div>';
  }

  // ── Visa Check (API + SSE) ──

  function runVisaCheck(parsed) {
    var passportSel = shadowRoot.querySelector('#dinav-passport');
    var visaSel = shadowRoot.querySelector('#dinav-visa');
    var loungeSel = shadowRoot.querySelector('#dinav-lounge');
    var passportIso3 = passportSel ? passportSel.value : '';
    var visaId = visaSel ? visaSel.value : '';
    var loungeId = loungeSel ? loungeSel.value : '';

    if (!passportIso3) {
      alert('Please select your passport country.');
      return;
    }

    // Save preferences
    chrome.storage.local.set({ dinav_passport: passportIso3, dinav_visa: visaId, dinav_lounge: loungeId });

    // Build payload
    var payload = buildPayload(parsed, passportIso3, visaId, loungeId);

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

  function buildPayload(parsed, passportIso3, visaId, loungeId) {
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
        visas: visaId ? [visaId] : [],
        lounge_access: loungeId ? [loungeId] : []
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
        var summary = '';
        if (data.structured && data.structured.global_verdict) {
          verdict = data.structured.global_verdict;
          summary = data.structured.overall_reasoning || '';
        } else if (data.response) {
          verdict = extractVerdict(data.response);
          summary = data.response;
        }
        renderFinalVerdict(statusDiv, verdict);
        renderGoogleSearchButton(actionsDiv, parsed, passportIso3, visaId);
        actionsDiv.style.display = 'block';
        // Save to search history
        addHistoryEntry(passportIso3, visaId, parsed, verdict, summary);
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
    var accentSoft = isDark ? 'rgba(138,180,248,0.08)' : (t.accent + '12');
    var accentMed = isDark ? 'rgba(138,180,248,0.15)' : (t.accent + '1A');
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
      // Context bar
      + '.dinav-context-bar {'
      + '  display: flex; align-items: center; justify-content: center; gap: 6px;'
      + '  padding: 8px 20px; cursor: pointer;'
      + '  font-size: 11px; color: ' + t.textDim + ';'
      + '  border-bottom: 1px solid ' + t.border + ';'
      + '  transition: background 0.2s;'
      + '}'
      + '.dinav-context-bar:hover { background: ' + t.hoverBg + '; }'
      + '.dinav-context-text { display: inline-flex; align-items: center; gap: 5px; color: ' + t.textPrimary + '; }'
      + '.dinav-context-label { color: ' + t.textDim + '; }'
      + '.dinav-context-sep { color: ' + t.border + '; }'
      + '.dinav-context-edit { color: ' + t.textDim + '; opacity: 0.6; margin-left: 4px; flex-shrink: 0; }'
      // Collapsible prefs editor
      + '.dinav-prefs-editor {'
      + '  max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease;'
      + '  padding: 0 20px; border-bottom: none;'
      + '}'
      + '.dinav-prefs-editor.open {'
      + '  max-height: 400px; padding: 14px 20px;'
      + '  border-bottom: 1px solid ' + t.border + ';'
      + '}'
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
      + '.dinav-btn-google:hover { border-color: ' + t.accent + '; }'
      // History
      + '.dinav-history { margin-top: 24px; padding-top: 16px; border-top: 1px solid ' + t.border + '; }'
      + '.dinav-history-header {'
      + '  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;'
      + '  font-size: 10px; color: ' + t.textDim + '; text-transform: uppercase; letter-spacing: 0.1em;'
      + '}'
      + '.dinav-history-clear {'
      + '  all: unset; cursor: pointer; font-size: 10px; color: ' + t.textDim + ';'
      + '  padding: 3px 8px; border-radius: 6px; border: 1px solid ' + t.border + ';'
      + '  font-family: inherit; transition: color 0.2s;'
      + '}'
      + '.dinav-history-clear:hover { color: #ff5252; }'
      + '.dinav-history-entry { margin-bottom: 4px; }'
      + '.dinav-history-row {'
      + '  display: flex; align-items: center; gap: 8px; padding: 8px 12px;'
      + '  background: ' + t.cardBg + '; border: 1px solid ' + t.border + '; border-radius: 8px;'
      + '  cursor: pointer; transition: background 0.15s; flex-wrap: wrap;'
      + '}'
      + '.dinav-history-row:hover { background: ' + t.hoverBg + '; }'
      + '.dinav-history-time { font-size: 10px; color: ' + t.textDim + '; flex-shrink: 0; min-width: 40px; }'
      + '.dinav-history-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }'
      + '.dinav-history-passport { font-size: 11px; color: ' + t.textPrimary + '; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }'
      + '.dinav-history-visa {'
      + '  font-size: 10px; color: ' + t.accent + '; background: ' + accentSoft + ';'
      + '  padding: 1px 6px; border-radius: 4px; flex-shrink: 0;'
      + '}'
      + '.dinav-history-route { font-size: 11px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'
      + '.dinav-history-arrow { font-size: 9px; color: ' + t.textDim + '; flex-shrink: 0; margin-left: auto; }'
      + '.dinav-history-detail {'
      + '  display: none; border: 1px solid ' + t.border + '; border-top: none;'
      + '  border-radius: 0 0 8px 8px; padding: 10px 12px; background: ' + t.cardBg + ';'
      + '}'
      + '.dinav-history-detail.open { display: block; }'
      + '.dinav-history-detail.open + .dinav-history-row,'
      + '.dinav-history-entry:has(.dinav-history-detail.open) .dinav-history-row { border-radius: 8px 8px 0 0; }'
      + '.dinav-history-verdict { font-size: 10px; color: ' + t.textDim + '; text-transform: uppercase; margin-bottom: 4px; }'
      + '.dinav-history-summary { font-size: 12px; color: ' + t.textSecondary + '; line-height: 1.6; }';
  }

  // ── Initial injection ──
  tryInjectCTA();

})();
