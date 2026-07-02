/**
 * ==========================================================================
 * NEXRA TECH PK — ORDER TRACKING ENGINE (js/order-tracking.js)
 * ==========================================================================
 */

window.NexraTracker = (function () {
    'use strict';

    var _state = {
        initialized: false,
        user: null,
        orderId: null,
        hash: null, // For guest tracking
        orderData: null,
        unsubOrder: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT & PARSING
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _cacheDOM();

        // 1. URL Parsing
        var params = new URLSearchParams(window.location.search);
        _state.orderId = params.get('orderId');
        _state.hash = params.get('hash'); // Optional cryptographic hash for guest verification

        if (!_state.orderId) {
            _showError('Invalid Link', 'No Order ID provided in the tracking URL.');
            return;
        }

        _subscribeAuth();
    }

    function _cacheDOM() {
        _DOM.skeleton = document.getElementById('trk-skeleton');
        _DOM.error = document.getElementById('trk-error');
        _DOM.content = document.getElementById('trk-content');
        
        _DOM.orderIdTxt = document.getElementById('trk-order-id');
        _DOM.orderDate = document.getElementById('trk-order-date');
        _DOM.globalBadge = document.getElementById('trk-global-badge');

        _DOM.stepper = document.getElementById('trk-stepper');
        _DOM.stepPlaced = document.getElementById('step-placed');
        _DOM.stepPayment = document.getElementById('step-payment');
        _DOM.stepProcessing = document.getElementById('step-processing');
        _DOM.stepFinal = document.getElementById('step-final');
        
        _DOM.txtProcessing = document.getElementById('txt-processing');
        _DOM.titleFinal = document.getElementById('title-final');
        _DOM.txtFinal = document.getElementById('txt-final');

        _DOM.actionBox = document.getElementById('trk-action-box');
        
        _DOM.itemsList = document.getElementById('trk-items-list');
        _DOM.subtotal = document.getElementById('trk-subtotal');
        _DOM.promoRow = document.getElementById('trk-promo-row');
        _DOM.discount = document.getElementById('trk-discount');
        _DOM.total = document.getElementById('trk-total');
    }

    function _subscribeAuth() {
        // We wait briefly for Auth, but allow Guest tracking if a hash is present
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function(user) {
            _state.user = user;
            _fetchOrderRealtime();
        });
    }

    /* ======================================================================
       REAL-TIME FIRESTORE LISTENER & SECURITY
       ====================================================================== */
    function _fetchOrderRealtime() {
        if (!window.db) return;

        _state.unsubOrder = window.db.collection('orders').doc(_state.orderId)
            .onSnapshot(function(doc) {
                if (!doc.exists) {
                    _showError('Order Not Found', 'This order ID does not exist in our system.');
                    return;
                }

                var data = doc.data();
                data.id = doc.id;

                // Strict Ownership Validation
                var isOwner = _state.user && data.uid === _state.user.uid;
                var isGuestVerified = _state.hash && data.trackingHash === _state.hash;

                if (!isOwner && !isGuestVerified) {
                    _showAuthRequired();
                    return;
                }

                _state.orderData = data;
                _renderTrackingUI();
                
            }, function(err) {
                console.error("Tracking Error", err);
                if (err.code === 'permission-denied') {
                    _showAuthRequired();
                } else {
                    _showError('Connection Error', 'Failed to securely connect to the tracking server.');
                }
            });
    }

    /* ======================================================================
       RENDER ENGINE & ANIMATED STEPPER
       ====================================================================== */
    function _renderTrackingUI() {
        var d = _state.orderData;
        
        // Hide Skeleton, Show Content
        _DOM.skeleton.style.display = 'none';
        _DOM.error.style.display = 'none';
        _DOM.content.style.display = 'block';

        // Header
        _DOM.orderIdTxt.innerText = '#' + d.id.substring(0, 8).toUpperCase();
        if (d.createdAt) {
            _DOM.orderDate.innerText = d.createdAt.toDate().toLocaleDateString() + ' ' + d.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        _DOM.globalBadge.innerText = d.status;
        if (d.status === 'delivered') _DOM.globalBadge.classList.add('success');

        // Logic branching: Digital vs Physical
        var isDigital = d.orderType === 'digital' || d.orderType === 'saas' || d.orderType === 'subscription';

        if (isDigital) {
            _DOM.txtProcessing.innerText = 'Encrypting keys & provisioning Vault access.';
            _DOM.titleFinal.innerText = 'Assets Delivered';
            _DOM.txtFinal.innerText = 'Your files & keys are securely stored in your Digital Vault.';
        } else {
            _DOM.txtProcessing.innerText = 'Warehouse packing & quality check.';
            _DOM.titleFinal.innerText = 'Shipped & Delivered';
            _DOM.txtFinal.innerText = 'Courier tracking details will be updated here.';
        }

        // Stepper State Machine (ordered chronologically)
        _DOM.stepPlaced.className = 'trk-step';
        _DOM.stepPayment.className = 'trk-step';
        _DOM.stepProcessing.className = 'trk-step';
        _DOM.stepFinal.className = 'trk-step';

        var s = d.status.toLowerCase();
        
        // Waterfall logic
        if (s === 'pending') {
            _DOM.stepPlaced.classList.add('completed');
            _DOM.stepPayment.classList.add('active');
        } 
        else if (s === 'paid' || s === 'processing') {
            _DOM.stepPlaced.classList.add('completed');
            _DOM.stepPayment.classList.add('completed');
            _DOM.stepProcessing.classList.add('active');
        }
        else if (s === 'shipped') {
            _DOM.stepPlaced.classList.add('completed');
            _DOM.stepPayment.classList.add('completed');
            _DOM.stepProcessing.classList.add('completed');
            _DOM.stepFinal.classList.add('active');
            if (!isDigital) _DOM.txtFinal.innerText = 'Package is with courier: ' + (d.courierId || 'Pending tracking code');
        }
        else if (s === 'delivered') {
            _DOM.stepPlaced.classList.add('completed');
            _DOM.stepPayment.classList.add('completed');
            _DOM.stepProcessing.classList.add('completed');
            _DOM.stepFinal.classList.add('completed');
            
            if (isDigital) {
                _DOM.actionBox.style.display = 'block'; // Show Vault Redirect Button
            }
        }

        _renderSummaryCard(d);
    }

    function _renderSummaryCard(d) {
        // Items
        var itemsHtml = '';
        if (d.items && Array.isArray(d.items)) {
            d.items.forEach(function(item) {
                itemsHtml += `
                <div class="trk-item-row">
                    <img src="${item.thumbnail || '/assets/placeholder.jpg'}" class="trk-item-img">
                    <div class="trk-item-info">
                        <div class="trk-item-title">${item.title}</div>
                        <div class="trk-item-meta">Qty: ${item.qty || 1}</div>
                    </div>
                    <div class="trk-item-price">Rs. ${(item.price * (item.qty || 1)).toLocaleString()}</div>
                </div>`;
            });
        }
        _DOM.itemsList.innerHTML = itemsHtml;

        // Math
        _DOM.subtotal.innerText = 'Rs. ' + (d.subtotal || d.total).toLocaleString();
        
        if (d.discountAmt > 0) {
            _DOM.promoRow.style.display = 'flex';
            _DOM.discount.innerText = '- Rs. ' + d.discountAmt.toLocaleString();
        } else {
            _DOM.promoRow.style.display = 'none';
        }

        _DOM.total.innerText = 'Rs. ' + d.total.toLocaleString();
    }

    /* ======================================================================
       ACTION ROUTING
       ====================================================================== */
    function routeAction() {
        if (!_state.user) {
            // Force auth if guest tracking a digital item to access vault
            sessionStorage.setItem('nexra_post_auth', '/user/digital-vault.html');
            window.location.href = '/user/auth-gate.html';
        } else {
            window.location.href = '/user/digital-vault.html';
        }
    }

    function _showError(title, desc) {
        if (_DOM.skeleton) _DOM.skeleton.style.display = 'none';
        if (_DOM.content) _DOM.content.style.display = 'none';
        
        if (_DOM.error) {
            _DOM.error.style.display = 'block';
            document.getElementById('trk-error-title').innerText = title;
            document.getElementById('trk-error-desc').innerText = desc;
        }
    }

    function _showAuthRequired() {
        _showError('Unauthorized Access', 'You must be logged into the account that placed this order to view tracking details.');
        var btn = document.getElementById('trk-btn-login');
        if (btn) {
            btn.style.display = 'inline-block';
            btn.href = '/user/auth-gate.html?redirect=' + encodeURIComponent(window.location.href);
        }
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        routeAction: routeAction
    };

})();
