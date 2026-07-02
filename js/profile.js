/**
 * ==========================================================================
 * NEXRA TECH PK — PROFILE DASHBOARD ENGINE (js/profile.js)
 * ==========================================================================
 * Namespace: window.NexraProfile
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on user/profile-dashboard.html
 * ==========================================================================
 */

window.NexraProfile = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        currentUser: null,
        userData: null,
        unsubOrders: null,
        unsubWallet: null,
        unsubTickets: null,
        refUrl: ''
    };

    var _DOM = {};

    /* ======================================================================
       INIT & AUTH GUARD
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraProfile] Initializing Secure Guard...');

        _cacheDOM();
        _bindTabs();
        _subscribeAuth();
    }

    function _cacheDOM() {
        _DOM.guard = document.getElementById('pr-auth-guard');
        _DOM.main = document.getElementById('pr-main');
        
        // Header
        _DOM.avatar = document.getElementById('pr-val-avatar');
        _DOM.name = document.getElementById('pr-val-name');
        _DOM.email = document.getElementById('pr-val-email');
        _DOM.tier = document.getElementById('pr-val-tier');
        
        // Modals
        _DOM.qrModal = document.getElementById('pr-qr-modal');
        _DOM.logoutModal = document.getElementById('pr-logout-modal');
        _DOM.qrImg = document.getElementById('pr-qr-img');
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            if (user) {
                // VALIDATED
                _state.currentUser = user;
                _bootDashboard();
            } else {
                // INTERCEPT & REDIRECT
                window.location.replace('/user/auth-gate.html?redirect=/user/profile-dashboard.html');
            }
        });
    }

    function _bootDashboard() {
        // Fetch Master User Doc
        if (!window.db) return;
        window.db.collection('users').doc(_state.currentUser.uid).onSnapshot(function(doc) {
            if (doc.exists) {
                _state.userData = doc.data();
                _renderHeader();
                _updateWalletStats();
            } else {
                // Create skeleton doc if first time hitting profile directly
                window.db.collection('users').doc(_state.currentUser.uid).set({
                    email: _state.currentUser.email,
                    displayName: _state.currentUser.displayName || '',
                    coins: 0,
                    role: 'standard',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        });

        // 1. Reveal UI
        _DOM.guard.style.opacity = '0';
        setTimeout(function() { 
            _DOM.guard.style.display = 'none'; 
            _DOM.main.removeAttribute('hidden');
        }, 500);

        // 2. Trigger active tab fetches
        _loadTab('vault');

        // 3. Generate Referral Link baseline
        _state.refUrl = window.location.origin + '/user/auth-gate.html?ref=' + _state.currentUser.uid;
        document.getElementById('pr-val-ref-link').value = _state.refUrl;
    }

    function _renderHeader() {
        var d = _state.userData || {};
        _DOM.name.textContent = d.displayName || _state.currentUser.displayName || 'Nexra Member';
        _DOM.email.textContent = _state.currentUser.email;
        if (d.photoURL || _state.currentUser.photoURL) {
            _DOM.avatar.src = d.photoURL || _state.currentUser.photoURL;
        }

        // Tier Badge Logic
        var role = (d.role || 'standard').toLowerCase();
        _DOM.tier.className = 'pr-tier-badge ' + role;
        
        if (role === 'diamond') _DOM.tier.innerHTML = '<i class="fa-solid fa-gem"></i> Diamond VIP';
        else if (role === 'gold') _DOM.tier.innerHTML = '<i class="fa-solid fa-crown"></i> Gold Member';
        else _DOM.tier.innerHTML = '<i class="fa-solid fa-medal"></i> Standard Member';
        
        // Pre-fill settings form
        var sn = document.getElementById('pr-set-name');
        var sp = document.getElementById('pr-set-phone');
        if (sn && !sn.value) sn.value = _DOM.name.textContent;
        if (sp && !sp.value) sp.value = d.phone || '';
    }

    /* ======================================================================
       TAB NAVIGATION
       ====================================================================== */
    function _bindTabs() {
        var btns = document.querySelectorAll('.pr-tab-btn');
        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                
                var target = this.getAttribute('data-target');
                var contents = document.querySelectorAll('.pr-tab-content');
                contents.forEach(function(c) { c.classList.remove('active'); });
                
                var tEl = document.getElementById('tab-' + target);
                if (tEl) tEl.classList.add('active');
                
                _loadTab(target);
            });
        });
    }

    function _loadTab(target) {
        if (!window.db) return;
        
        if (target === 'vault') _fetchVault();
        if (target === 'orders') _fetchOrders();
        if (target === 'support') _fetchTickets();
        if (target === 'wishlist') _fetchWishlist();
        // Wallet relies on user doc snapshot (already active)
    }

    /* ======================================================================
       1. DIGITAL VAULT
       ====================================================================== */
    function _fetchVault() {
        var grid = document.getElementById('pr-val-vault-grid');
        
        // For demonstration, we assume unlocked freebies are in userData.unlockedFreebies
        // and purchased keys are in a 'vault' subcollection.
        var unlocked = (_state.userData && _state.userData.unlockedFreebies) ? _state.userData.unlockedFreebies : [];
        
        // Fetch full docs for these IDs from 'freebies' (mocked loop)
        if (unlocked.length === 0) {
            grid.innerHTML = _emptyState('fa-vault', 'Your Vault is Empty', 'Unlock resources or purchase SaaS tools to see them here.');
            return;
        }

        // We batch read or Promise.all. For robust enterprise, we do chunks of 10.
        var promises = unlocked.map(function(id) {
            return window.db.collection('freebies').doc(id).get();
        });

        Promise.all(promises).then(function(docs) {
            var html = '';
            docs.forEach(function(doc) {
                if (doc.exists) {
                    var d = doc.data();
                    html += '<div class="pr-vault-card">' +
                            '<div class="pr-vault-img"><img src="' + (d.imgUrl || d.imgBase64 || '/assets/placeholder.jpg') + '"></div>' +
                            '<div class="pr-vault-body">' +
                            '<div class="pr-vault-title">' + _esc(d.title) + '</div>' +
                            '<div class="pr-vault-actions">' +
                            '<button class="pr-vault-btn primary" onclick="window.open(\'' + d.downloadUrl + '\', \'_blank\')"><i class="fa-solid fa-download"></i> Access</button>' +
                            '</div>' +
                            '</div>' +
                            '</div>';
                }
            });
            grid.innerHTML = html || _emptyState('fa-vault', 'Your Vault is Empty', '');
        });
    }

    /* ======================================================================
       2. ORDER HISTORY & INVOICING
       ====================================================================== */
    function _fetchOrders() {
        if (_state.unsubOrders) return; // already listening
        var list = document.getElementById('pr-val-orders-list');
        
        _state.unsubOrders = window.db.collection('users').doc(_state.currentUser.uid).collection('orders')
            .orderBy('createdAt', 'desc')
            .onSnapshot(function(snap) {
                if (snap.empty) {
                    list.innerHTML = _emptyState('fa-box-open', 'No Orders Yet', 'Visit the marketplace to place your first order.');
                    return;
                }
                
                var html = '';
                snap.forEach(function(doc) {
                    var d = doc.data();
                    var status = (d.status || 'pending').toLowerCase();
                    var dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString() : 'N/A';
                    
                    var step1 = status === 'pending' || status === 'processing' || status === 'completed' ? 'active' : '';
                    var step2 = status === 'processing' || status === 'completed' ? 'active' : '';
                    var step3 = status === 'completed' ? 'active' : '';

                    var invoiceDataStr = encodeURIComponent(JSON.stringify({ id: doc.id, date: dateStr, total: d.total, items: d.items }));

                    html += '<div class="pr-order-card">' +
                            '<div class="pr-order-head">' +
                            '<div><div class="pr-order-id">ORD-' + doc.id.substring(0,8).toUpperCase() + '</div><div class="pr-order-date">Placed: ' + dateStr + '</div></div>' +
                            '<div class="pr-order-status ' + status + '">' + status + '</div>' +
                            '</div>' +
                            '<div class="pr-stepper">' +
                            '<div class="pr-step ' + step1 + '"><div class="pr-step-icon"><i class="fa-solid fa-check"></i></div><div class="pr-step-label">Placed</div></div>' +
                            '<div class="pr-step ' + step2 + '"><div class="pr-step-icon"><i class="fa-solid fa-box"></i></div><div class="pr-step-label">Processing</div></div>' +
                            '<div class="pr-step ' + step3 + '"><div class="pr-step-icon"><i class="fa-solid fa-truck"></i></div><div class="pr-step-label">Completed</div></div>' +
                            '</div>' +
                            '<div class="pr-order-actions">' +
                            '<button class="btn btn-outline" style="height:36px; padding:0 16px; font-size:12px;" onclick="NexraProfile.printInvoice(\'' + invoiceDataStr + '\')"><i class="fa-solid fa-print"></i> Print Invoice</button>' +
                            '</div>' +
                            '</div>';
                });
                list.innerHTML = html;
            });
    }

    function printInvoice(dataStr) {
        try {
            var data = JSON.parse(decodeURIComponent(dataStr));
            var iframe = document.getElementById('pr-invoice-frame');
            var doc = iframe.contentWindow.document;
            
            // Generate basic printable HTML
            var html = '<html><head><title>Invoice ' + data.id + '</title>' +
                       '<style>body{font-family:sans-serif; padding:40px;} .header{border-bottom:2px solid #000; padding-bottom:20px; margin-bottom:40px;} h1{margin:0;} .tot{font-size:24px; font-weight:bold; margin-top:40px; text-align:right;}</style>' +
                       '</head><body>' +
                       '<div class="header"><h1>NEXRA TECH PK</h1><p>Invoice #ORD-' + data.id.substring(0,8).toUpperCase() + '<br>Date: ' + data.date + '</p></div>' +
                       '<h2>Order Summary</h2>' +
                       '<p>Total Paid: Rs ' + (data.total || 0).toLocaleString() + '</p>' +
                       '<div class="tot">TOTAL: Rs ' + (data.total || 0).toLocaleString() + '</div>' +
                       '</body></html>';
                       
            doc.open();
            doc.write(html);
            doc.close();
            
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            
        } catch(e) { console.error(e); }
    }

    /* ======================================================================
       3. WALLET & AFFILIATES
       ====================================================================== */
    function _updateWalletStats() {
        if (!_state.userData) return;
        var coinsEl = document.getElementById('pr-val-coins');
        var refEl = document.getElementById('pr-val-referrals');
        
        if (coinsEl) coinsEl.textContent = (_state.userData.coins || 0).toLocaleString();
        if (refEl) refEl.textContent = (_state.userData.referralCount || 0).toLocaleString();
    }

    function copyRefLink() {
        var inp = document.getElementById('pr-val-ref-link');
        inp.select();
        inp.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(inp.value).then(function() {
            window.NexraApp.showToast('Referral link copied!', 'fa-solid fa-link', 'success');
        });
    }

    function shareRef(platform) {
        if (platform === 'wa') {
            var text = encodeURIComponent("Join me on Nexra Tech PK! Sign up using my link: " + _state.refUrl);
            window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
        }
    }

    function showQRModal() {
        if (_DOM.qrImg && _state.refUrl) {
            _DOM.qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(_state.refUrl);
        }
        if (_DOM.qrModal) _DOM.qrModal.removeAttribute('hidden');
    }

    /* ======================================================================
       4. SUPPORT TICKETS
       ====================================================================== */
    function toggleTicketForm() {
        var fw = document.getElementById('pr-ticket-form-wrap');
        if (fw) {
            if (fw.hasAttribute('hidden')) fw.removeAttribute('hidden');
            else fw.setAttribute('hidden', '');
        }
    }

    function submitTicket(e) {
        e.preventDefault();
        var sub = document.getElementById('pr-ticket-subject').value.trim();
        var desc = document.getElementById('pr-ticket-desc').value.trim();
        var btn = document.getElementById('pr-ticket-submit-btn');
        
        if (!sub || !desc || !window.db) return;
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
        
        window.db.collection('users').doc(_state.currentUser.uid).collection('tickets').add({
            subject: sub,
            description: desc,
            status: 'open',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function() {
            window.NexraApp.showToast('Ticket submitted successfully!', 'fa-solid fa-check', 'success');
            document.getElementById('pr-ticket-form').reset();
            toggleTicketForm();
            btn.disabled = false;
            btn.innerHTML = 'Submit Ticket';
        });
    }

    function _fetchTickets() {
        if (_state.unsubTickets) return;
        var list = document.getElementById('pr-val-tickets-list');
        
        _state.unsubTickets = window.db.collection('users').doc(_state.currentUser.uid).collection('tickets')
            .orderBy('createdAt', 'desc')
            .onSnapshot(function(snap) {
                if (snap.empty) {
                    list.innerHTML = _emptyState('fa-headset', 'No Active Tickets', 'If you need help, submit a new ticket above.');
                    return;
                }
                
                var html = '';
                snap.forEach(function(doc) {
                    var d = doc.data();
                    var stat = (d.status || 'open').toLowerCase();
                    var dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString() : 'N/A';
                    
                    html += '<div class="pr-ticket-card">' +
                            '<div class="pr-ticket-info">' +
                            '<h4>' + _esc(d.subject) + '</h4>' +
                            '<p>Submitted: ' + dateStr + '</p>' +
                            '</div>' +
                            '<div class="pr-ticket-status ' + stat + '">' + stat + '</div>' +
                            '</div>';
                });
                list.innerHTML = html;
            });
    }

    /* ======================================================================
       5. WISHLIST
       ====================================================================== */
    function _fetchWishlist() {
        var grid = document.getElementById('pr-val-wishlist-grid');
        
        window.db.collection('users').doc(_state.currentUser.uid).collection('wishlist').get().then(function(snap) {
            if (snap.empty) {
                grid.innerHTML = _emptyState('fa-heart', 'Wishlist Empty', 'Items you save will appear here.');
                return;
            }
            // In a real app, we would cross-reference the IDs against 'products' or 'blogs'.
            // For now, render placeholders demonstrating the concept.
            grid.innerHTML = '<div class="pr-empty-state" style="grid-column:1/-1;">' +
                             '<i class="fa-solid fa-heart-circle-check"></i>' +
                             '<h3>' + snap.size + ' Items Saved</h3>' +
                             '<p>Cross-referencing engine active.</p></div>';
        });
    }

    /* ======================================================================
       6. SETTINGS & LOGOUT
       ====================================================================== */
    function updateSettings(e) {
        e.preventDefault();
        var n = document.getElementById('pr-set-name').value.trim();
        var p = document.getElementById('pr-set-phone').value.trim();
        var btn = document.getElementById('pr-settings-submit');
        
        if (!n || !window.db) return;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        btn.disabled = true;
        
        // Update Auth Profile
        _state.currentUser.updateProfile({ displayName: n }).then(function() {
            // Update Firestore Profile
            window.db.collection('users').doc(_state.currentUser.uid).update({
                displayName: n,
                phone: p
            }).then(function() {
                window.NexraApp.showToast('Settings saved successfully.', 'fa-solid fa-check', 'success');
                btn.innerHTML = 'Save Changes';
                btn.disabled = false;
            });
        });
    }

    function triggerPasswordReset() {
        if (!_state.currentUser || !window.auth) return;
        window.auth.sendPasswordResetEmail(_state.currentUser.email).then(function() {
            window.NexraApp.showToast('Password reset email sent!', 'fa-solid fa-envelope', 'success');
        });
    }

    function triggerLogoutModal() {
        if (_DOM.logoutModal) _DOM.logoutModal.removeAttribute('hidden');
    }

    function closeModals() {
        if (_DOM.qrModal) _DOM.qrModal.setAttribute('hidden', '');
        if (_DOM.logoutModal) _DOM.logoutModal.setAttribute('hidden', '');
    }

    function executeLogout() {
        if (!window.auth) return;
        window.auth.signOut().then(function() {
            window.location.replace('/user/auth-gate.html');
        });
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function _emptyState(iconClass, title, desc) {
        return '<div class="pr-empty-state" style="grid-column: 1 / -1;">' +
               '<i class="fa-solid ' + iconClass + '"></i>' +
               '<h3 class="tech-font">' + title + '</h3>' +
               '<p>' + desc + '</p>' +
               '</div>';
    }

    function _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        copyRefLink: copyRefLink,
        shareRef: shareRef,
        showQRModal: showQRModal,
        toggleTicketForm: toggleTicketForm,
        submitTicket: submitTicket,
        updateSettings: updateSettings,
        triggerPasswordReset: triggerPasswordReset,
        triggerLogoutModal: triggerLogoutModal,
        closeModals: closeModals,
        executeLogout: executeLogout,
        printInvoice: printInvoice
    };

})();
