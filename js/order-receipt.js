/**
 * ==========================================================================
 * NEXRA TECH PK — ORDER RECEIPT ENGINE (js/order-receipt.js)
 * ==========================================================================
 */

window.NexraReceipt = (function () {
    'use strict';

    // Approximate PKR → USD conversion rate
    var _PKR_TO_USD = 0.0036;

    var _state = {
        initialized: false,
        user: null,
        orderId: null,
        orderData: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT & URL PARSING
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _cacheDOM();

        var params = new URLSearchParams(window.location.search);
        _state.orderId = params.get('orderId');

        if (!_state.orderId) {
            _showError('Invalid Link', 'No Order ID supplied in the receipt URL.');
            return;
        }

        _subscribeAuth();
    }

    function _cacheDOM() {
        _DOM.skeleton = document.getElementById('rc-skeleton');
        _DOM.error = document.getElementById('rc-error');
        _DOM.invoice = document.getElementById('rc-invoice');
        _DOM.island = document.getElementById('rc-action-island');
        _DOM.reportBtn = document.getElementById('rc-btn-report');
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function(user) {
            _state.user = user;
            _fetchOrder();
        });
    }

    /* ======================================================================
       FIRESTORE FETCH & OWNERSHIP GUARD
       ====================================================================== */
    function _fetchOrder() {
        window.db.collection('orders').doc(_state.orderId).get()
            .then(function(doc) {
                if (!doc.exists) {
                    _showError('Receipt Not Found', 'This order ID does not exist in our records.');
                    return;
                }

                var data = doc.data();
                data.id = doc.id;

                // Strict Ownership Validation
                if (!_state.user || data.uid !== _state.user.uid) {
                    _showError('Unauthorized', 'You must be logged in as the account that placed this order to view this receipt.');
                    return;
                }

                _state.orderData = data;
                _renderReceipt(data);
            })
            .catch(function(err) {
                _showError('Connection Error', 'Could not fetch receipt securely. Please try again.');
            });
    }

    /* ======================================================================
       RECEIPT RENDERER
       ====================================================================== */
    function _renderReceipt(d) {
        // Swap UI
        _DOM.skeleton.style.display = 'none';
        _DOM.invoice.style.display = 'block';

        // ── Invoice Meta ──
        var invoiceId = '#NX-' + d.id.substring(0, 8).toUpperCase();
        document.getElementById('rc-inv-id').innerText = invoiceId;
        document.title = 'Receipt ' + invoiceId + ' | Nexra Tech PK';

        if (d.createdAt) {
            var dt = d.createdAt.toDate();
            document.getElementById('rc-inv-date').innerText = dt.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
        }

        var statusPill = document.getElementById('rc-status');
        statusPill.innerText = (d.status || 'Paid').toUpperCase();

        // ── Billing Info ──
        document.getElementById('rc-customer-name').innerText = d.customerName || _state.user.displayName || 'Valued Customer';
        document.getElementById('rc-customer-email').innerText = d.customerEmail || _state.user.email || '—';

        // ── Itemized Table ──
        _renderItemsTable(d.items || []);

        // ── Math Breakdown ──
        _renderTotals(d);

        // ── Generated Timestamp ──
        document.getElementById('rc-generated-ts').innerText = new Date().toLocaleString('en-PK');

        // ── Action Island ──
        _DOM.island.style.opacity = '1';
        _DOM.island.style.pointerEvents = 'auto';

        // Deep-link to support with Order ID pre-filled
        if (_DOM.reportBtn) {
            _DOM.reportBtn.href = '/support/support-hub.html?orderId=' + d.id + '&subject=' + encodeURIComponent('Issue with Order ' + invoiceId);
        }
    }

    function _renderItemsTable(items) {
        var tbody = document.getElementById('rc-tbody');
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-300); padding:24px;">No items found</td></tr>';
            return;
        }

        var html = '';
        items.forEach(function(item) {
            var lineTotal = (item.price || 0) * (item.qty || 1);
            var keyHtml = item.licenseKey ? `<div class="rc-td-item-key rc-key-cell">${item.licenseKey}</div>` : '';

            html += `
            <tr>
                <td class="rc-td-item">
                    <div class="rc-td-item-name">${item.title || 'Unnamed Item'}</div>
                    ${keyHtml}
                </td>
                <td>${item.qty || 1}</td>
                <td>Rs. ${(item.price || 0).toLocaleString()}</td>
                <td>Rs. ${lineTotal.toLocaleString()}</td>
            </tr>`;
        });

        tbody.innerHTML = html;
    }

    function _renderTotals(d) {
        var subtotal = d.subtotal || d.total || 0;
        var discount = d.discountAmt || 0;
        var coins = d.coinsDiscount || 0;
        var total = d.total || 0;
        var usd = (total * _PKR_TO_USD).toFixed(2);

        document.getElementById('rc-subtotal').innerText = 'Rs. ' + subtotal.toLocaleString();

        if (discount > 0) {
            document.getElementById('rc-promo-row').style.display = 'flex';
            document.getElementById('rc-promo-code').innerText = d.promoCode || 'CODE';
            document.getElementById('rc-promo-amt').innerText = '- Rs. ' + discount.toLocaleString();
        }

        if (coins > 0) {
            document.getElementById('rc-coins-row').style.display = 'flex';
            document.getElementById('rc-coins-amt').innerText = '- Rs. ' + coins.toLocaleString();
        }

        document.getElementById('rc-grand-pkr').innerText = 'Rs. ' + total.toLocaleString();
        document.getElementById('rc-usd-note').innerText = '≈ $' + usd + ' USD (estimated)';
    }

    /* ======================================================================
       ACTION ISLAND
       ====================================================================== */
    function downloadPDF() {
        window.print();
    }

    function copyLink() {
        var url = window.location.href;
        navigator.clipboard.writeText(url).then(function() {
            if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
            if (window.NexraApp) NexraApp.showToast('Receipt link copied!', 'fa-solid fa-link', 'success');
        });
    }

    function _showError(title, desc) {
        if (_DOM.skeleton) _DOM.skeleton.style.display = 'none';
        if (_DOM.invoice) _DOM.invoice.style.display = 'none';
        if (_DOM.error) {
            _DOM.error.style.display = 'block';
            document.getElementById('rc-error-title').innerText = title;
            document.getElementById('rc-error-desc').innerText = desc;
        }
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        downloadPDF: downloadPDF,
        copyLink: copyLink
    };

})();
