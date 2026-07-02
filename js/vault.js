/**
 * ==========================================================================
 * NEXRA TECH PK — SECURE DIGITAL VAULT ENGINE (js/vault.js)
 * ==========================================================================
 */

window.NexraVault = (function () {
    'use strict';

    var _state = {
        initialized: false,
        user: null,
        assets: [],
        activeFilter: 'all',
        viewMode: 'grid', // 'grid' | 'list'
        unsubVault: null,
        unsubFreebies: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT & REAL-TIME AUTH GUARD
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _cacheDOM();
        
        // Restore view mode preference
        var savedView = localStorage.getItem('nexra_vault_view');
        if (savedView === 'list') switchView('list');

        _subscribeAuth();
    }

    function _cacheDOM() {
        _DOM.guard = document.getElementById('vt-pre-guard');
        _DOM.main = document.getElementById('vt-main');
        _DOM.grid = document.getElementById('vt-asset-grid');
        _DOM.btnGrid = document.getElementById('btn-grid');
        _DOM.btnList = document.getElementById('btn-list');
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function(user) {
            if (!user) {
                // Impenetrable routing to Auth Gate
                window.location.replace('/user/auth-gate.html?redirect=/user/digital-vault.html');
                return;
            }
            _state.user = user;
            
            // Unlock UI
            if (_DOM.guard.style.display !== 'none') {
                _DOM.guard.style.opacity = '0';
                setTimeout(function() { 
                    _DOM.guard.style.display = 'none'; 
                    _DOM.main.removeAttribute('hidden');
                    _initSecureListeners();
                }, 500);
            }
        });
    }

    /* ======================================================================
       SECURE FIRESTORE LISTENERS
       ====================================================================== */
    function _initSecureListeners() {
        if (!window.db || !_state.user) return;
        
        // 1. Listen to Purchased Assets / Software Keys (users/{uid}/vault)
        _state.unsubVault = window.db.collection('users').doc(_state.user.uid)
            .collection('vault')
            .onSnapshot(function(snap) {
                _handleSnapshot(snap, 'purchased');
            });

        // 2. Listen to Unlocked Freebies (users/{uid}/unlocked)
        _state.unsubFreebies = window.db.collection('users').doc(_state.user.uid)
            .collection('unlocked')
            .onSnapshot(function(snap) {
                _handleSnapshot(snap, 'freebie');
            });
    }

    function _handleSnapshot(snap, source) {
        snap.docChanges().forEach(function(change) {
            var data = change.doc.data();
            data.id = change.doc.id;
            
            // Derive asset classification type
            if (source === 'freebie') {
                data.filterType = 'freebie';
            } else if (data.licenseKey) {
                data.filterType = 'software';
            } else {
                data.filterType = 'download';
            }

            if (change.type === 'added') {
                _state.assets.push(data);
            }
            if (change.type === 'modified') {
                var idx = _state.assets.findIndex(function(a) { return a.id === data.id; });
                if (idx > -1) _state.assets[idx] = data;
            }
            if (change.type === 'removed') {
                _state.assets = _state.assets.filter(function(a) { return a.id !== data.id; });
            }
        });

        // Sort: newest first
        _state.assets.sort(function(a, b) {
            var tA = a.acquiredAt ? a.acquiredAt.toMillis() : 0;
            var tB = b.acquiredAt ? b.acquiredAt.toMillis() : 0;
            return tB - tA;
        });

        _renderAssets();
    }

    /* ======================================================================
       FILTERING & GRID RENDERING
       ====================================================================== */
    function switchView(mode) {
        _state.viewMode = mode;
        localStorage.setItem('nexra_vault_view', mode);

        if (mode === 'list') {
            _DOM.btnList.classList.add('active');
            _DOM.btnGrid.classList.remove('active');
            _DOM.grid.className = 'vt-asset-grid vt-asset-list';
        } else {
            _DOM.btnGrid.classList.add('active');
            _DOM.btnList.classList.remove('active');
            _DOM.grid.className = 'vt-asset-grid';
        }
    }

    function filterAssets(type, btnEl) {
        _state.activeFilter = type;
        
        var btns = document.querySelectorAll('.vt-filter-pill');
        btns.forEach(function(b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        _renderAssets();
    }

    function _renderAssets() {
        if (!_DOM.grid) return;

        var displayArr = _state.assets;
        if (_state.activeFilter !== 'all') {
            displayArr = _state.assets.filter(function(a) { return a.filterType === _state.activeFilter; });
        }

        if (displayArr.length === 0) {
            _DOM.grid.innerHTML = `
                <div class="vt-empty-state">
                    <i class="fa-solid fa-box-archive"></i>
                    <h3>Vault is Empty</h3>
                    <p>No secure assets found in this category. Visit the marketplace to acquire software or unlock community freebies.</p>
                    <a href="/discovery/home.html" class="vt-btn-outline"><i class="fa-solid fa-store"></i> Browse Catalog</a>
                </div>
            `;
            return;
        }

        var html = '';
        displayArr.forEach(function(a, i) {
            var delay = (i * 0.05) + 's';
            var metaTxt = a.filterType === 'freebie' ? 'Community Freebie' : 'Lifetime License';
            
            // Determine Action Button (License Key vs Download Link)
            var actionHtml = '';
            
            if (a.licenseKey) {
                // Secure Reveal Engine HTML
                var maskedKey = _maskKey(a.licenseKey);
                actionHtml = `
                <div class="vt-key-wrap" id="kw-${a.id}" onclick="NexraVault.revealKey('${a.id}', '${a.licenseKey}')">
                    <div class="vt-key-inner">
                        <div class="vt-key-front"><i class="fa-solid fa-eye-slash"></i> Reveal Key</div>
                        <div class="vt-key-back vt-key-reveal">${a.licenseKey}</div>
                    </div>
                </div>`;
            } else if (a.downloadUrl) {
                actionHtml = `
                <a href="${a.downloadUrl}" target="_blank" class="vt-btn-download">
                    <i class="fa-solid fa-cloud-arrow-down"></i> Secure Download
                </a>`;
            } else {
                actionHtml = `<div style="font-size:12px;color:var(--text-300);margin-top:auto;">Processing...</div>`;
            }

            html += `
            <div class="vt-card" style="animation-delay: ${delay}">
                <img src="${a.thumbnail || '/assets/placeholder.jpg'}" class="vt-card-img" alt="${a.title}">
                <div class="vt-card-body">
                    <div>
                        <div class="vt-card-title">${a.title}</div>
                        <div class="vt-card-meta"><span>${metaTxt}</span></div>
                    </div>
                    ${actionHtml}
                </div>
            </div>`;
        });
        
        _DOM.grid.innerHTML = html;
    }

    function _maskKey(key) {
        if (!key || key.length < 5) return '****';
        // e.g. XXXX-XXXX-XXXX-1234
        var visible = key.slice(-4);
        var masked = key.slice(0, -4).replace(/[a-zA-Z0-9]/g, 'X');
        return masked + visible;
    }

    /* ======================================================================
       SECURE REVEAL ENGINE
       ====================================================================== */
    function revealKey(id, fullKey) {
        var wrap = document.getElementById('kw-' + id);
        if (!wrap) return;

        // If already revealed, do nothing or just re-copy
        if (wrap.classList.contains('revealed')) {
            _copyToClipboard(fullKey);
            return;
        }

        // Execute 3D Flip
        wrap.classList.add('revealed');

        // Copy to clipboard
        _copyToClipboard(fullKey);

        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

        // Audit Log to Firestore (Fire & Forget)
        if (window.db && _state.user) {
            window.db.collection('users').doc(_state.user.uid).collection('vault').doc(id).update({
                lastRevealedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function(e) { console.log('Audit log suppressed.'); });
        }
    }

    function _copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(function() {
            if (window.NexraApp) NexraApp.showToast('License key copied to clipboard!', 'fa-solid fa-key', 'success');
        });
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        switchView: switchView,
        filterAssets: filterAssets,
        revealKey: revealKey
    };

})();
