/**
 * ==========================================================================
 * NEXRA TECH PK — CHECKOUT SUCCESS ENGINE (js/checkout-success.js)
 * ==========================================================================
 * Namespace: window.NexraSuccess
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on shop/checkout-success.html
 * ==========================================================================
 */

window.NexraSuccess = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        orderId: null,
        orderData: null,
        currentUser: null,
        timerVal: 15,
        timerInt: null,
        unsubOrder: null,
        confettiRunning: true
    };

    /* ======================================================================
       INIT
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraSuccess] Initializing...');

        // 1. Extract Order ID
        var params = new URLSearchParams(window.location.search);
        _state.orderId = params.get('orderId');

        if (!_state.orderId) {
            window.location.href = '/shop/shop.html';
            return;
        }

        // 2. Auth & Realtime Fetch
        _subscribeAuth();
        _listenOrder();
        
        // 3. Clear Carts
        _clearCarts();

        // 4. E-commerce Hooks
        _firePixels();

        // 5. FX & Timers
        _initConfetti();
        _startTimer();
    }

    /* ======================================================================
       FIREBASE AUTH & REAL-TIME LISTENER
       ====================================================================== */
    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user) {
                // Generate affiliate link
                var affLink = document.getElementById('cs-affiliate-link');
                if (affLink) {
                    affLink.value = window.location.origin + '?ref=' + user.uid;
                }
            } else {
                var dest = document.getElementById('cs-redirect-dest');
                if (dest) dest.textContent = 'home';
            }
        });
    }

    function _listenOrder() {
        if (!window.db) return;
        
        _state.unsubOrder = window.db.collection('orders').doc(_state.orderId)
            .onSnapshot(function(doc) {
                if (!doc.exists) {
                    window.location.href = '/shop/shop.html';
                    return;
                }
                
                var data = doc.data();
                var firstLoad = !_state.orderData;
                _state.orderData = data;
                
                _renderTicket();
                
                if (data.status === 'approved' && !firstLoad) {
                    // It just changed!
                    window.NexraApp.showToast('Payment Verified!', 'fa-solid fa-check', 'success');
                    _triggerBigConfetti();
                }

            }, function(error) {
                console.error('Order listen error:', error);
            });
    }

    /* ======================================================================
       TICKET RENDERING (MORPHING)
       ====================================================================== */
    function _renderTicket() {
        var d = _state.orderData;
        if (!d) return;

        // Header
        document.getElementById('cs-val-orderid').textContent = _state.orderId.substring(0, 8).toUpperCase();
        
        // Status Morphing
        var banner = document.getElementById('cs-status-banner');
        if (d.status === 'approved') {
            banner.className = 'cs-ticket-status approved';
            banner.innerHTML = '<i class="fa-solid fa-check-circle"></i> <span>Payment Approved</span>';
        } else {
            banner.className = 'cs-ticket-status pending';
            banner.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Verification Pending</span>';
        }

        // Body
        var dObj = d.metadata && d.metadata.createdAt ? d.metadata.createdAt.toDate() : new Date();
        document.getElementById('cs-val-date').textContent = dObj.toLocaleDateString() + ' ' + dObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        var methodMap = {
            easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', bank: 'Bank Transfer', crypto: 'Binance Pay'
        };
        document.getElementById('cs-val-method').textContent = methodMap[d.payment.method] || 'Transfer';
        document.getElementById('cs-val-name').textContent = d.customer.name;
        document.getElementById('cs-val-type').textContent = d.hasPhysical ? 'Physical + Digital' : 'Digital / SaaS';

        // Items
        var itemsEl = document.getElementById('cs-val-items');
        itemsEl.innerHTML = d.items.map(function(i) {
            return '<div class="cs-item-row">' +
                   '<div>' +
                   '<div class="cs-item-name">' + _esc(i.title) + '</div>' +
                   '<div class="cs-item-qty">Qty: ' + i.qty + '</div>' +
                   '</div>' +
                   '<div class="cs-item-price">Rs. ' + (i.price * i.qty).toLocaleString() + '</div>' +
                   '</div>';
        }).join('');

        // Totals
        var f = d.financials;
        document.getElementById('cs-val-sub').textContent = 'Rs. ' + f.subtotal.toLocaleString();
        
        if (f.shipping > 0) {
            document.getElementById('cs-row-shipping').removeAttribute('hidden');
            document.getElementById('cs-val-shipping').textContent = 'Rs. ' + f.shipping.toLocaleString();
        }
        
        var totalDisc = f.discount + f.coinsUsed;
        if (totalDisc > 0) {
            document.getElementById('cs-row-discount').removeAttribute('hidden');
            document.getElementById('cs-val-discount').textContent = '- Rs. ' + totalDisc.toLocaleString();
        }
        
        document.getElementById('cs-val-total').textContent = 'Rs. ' + f.grandTotal.toLocaleString();
        
        // Loyalty Earned
        document.getElementById('cs-val-coins').textContent = Math.floor(f.grandTotal * 0.01);

        // QR Code
        var qrStr = encodeURIComponent(window.location.origin + '/admin/verify.html?orderId=' + _state.orderId);
        var qrImg = document.getElementById('cs-val-qr');
        var qrSkel = document.getElementById('cs-qr-skeleton');
        qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=' + qrStr;
        qrImg.onload = function() {
            qrSkel.style.display = 'none';
            qrImg.removeAttribute('hidden');
        };

        // Delivery Box (Approved Reveal)
        var actionBox = document.getElementById('cs-delivery-action');
        if (d.status === 'approved') {
            if (d.hasPhysical) {
                actionBox.innerHTML = '<div class="cs-reveal-box">' +
                                      '<span>TCS: 1234567890</span>' +
                                      '<button class="cs-reveal-btn" onclick="window.open(\'https://tcsexpress.com\',\'_blank\')">Track</button>' +
                                      '</div>';
            } else {
                actionBox.innerHTML = '<div class="cs-reveal-box">' +
                                      '<span>Vault Access Granted</span>' +
                                      '<button class="cs-reveal-btn" onclick="window.location.href=\'/user-vault.html\'">Open Vault</button>' +
                                      '</div>';
            }
        }
    }

    /* ======================================================================
       CLEAR CARTS
       ====================================================================== */
    function _clearCarts() {
        // Local already cleared in checkout.js, but reinforce it
        localStorage.removeItem('nexra_cart');
        if (window.NexraApp) window.NexraApp._state.cart = [];
        
        // Clear Firestore cart if authenticated
        // Note: The checkout engine might not have done this.
        if (!window.auth || !window.db) return;
        window.auth.onAuthStateChanged(function (user) {
            if (user) {
                window.db.collection('users').doc(user.uid).collection('cart').get()
                    .then(function(snap) {
                        var batch = window.db.batch();
                        snap.forEach(function(doc) {
                            batch.delete(doc.ref);
                        });
                        batch.commit();
                    }).catch(function(){});
            }
        });
    }

    /* ======================================================================
       E-COMMERCE TRACKING HOOKS
       ====================================================================== */
    function _firePixels() {
        // Mock invisible pixel firing
        console.log('[Analytics] Fired Purchase Event: ' + _state.orderId);
        // dataLayer.push({ event: 'purchase', transaction_id: _state.orderId, value: ... });
        // fbq('track', 'Purchase', { value: ..., currency: 'PKR' });
    }

    /* ======================================================================
       COUNTDOWN TIMER (SVG Circle)
       ====================================================================== */
    function _startTimer() {
        var textEl = document.getElementById('cs-timer-text');
        var circle = document.getElementById('cs-timer-circle');
        
        // 45 radius = 2 * pi * 45 = ~283 circumference
        var circumference = 2 * Math.PI * 45;
        circle.style.strokeDasharray = circumference;
        circle.style.strokeDashoffset = 0;

        var maxTime = _state.timerVal;

        _state.timerInt = setInterval(function() {
            _state.timerVal--;
            if (textEl) textEl.textContent = _state.timerVal;
            
            var offset = circumference - (_state.timerVal / maxTime) * circumference;
            circle.style.strokeDashoffset = offset;

            if (_state.timerVal <= 0) {
                clearInterval(_state.timerInt);
                _state.confettiRunning = false;
                
                // Redirect
                if (_state.currentUser) {
                    window.location.href = '/user-vault.html';
                } else {
                    window.location.href = '/index.html';
                }
            }
        }, 1000);
    }

    function cancelTimer() {
        if (_state.timerInt) clearInterval(_state.timerInt);
        var textEl = document.getElementById('cs-timer-text');
        if (textEl) textEl.textContent = 'Paused';
        window.NexraApp.showToast('Redirection paused.', 'fa-solid fa-pause', 'default');
    }

    /* ======================================================================
       AFFILIATE COPY
       ====================================================================== */
    function copyAffiliate() {
        var input = document.getElementById('cs-affiliate-link');
        if (!input || input.value === 'Generating...') return;
        input.select();
        document.execCommand('copy');
        window.NexraApp.showToast('Link copied to clipboard!', 'fa-solid fa-check', 'success');
    }

    /* ======================================================================
       CONFETTI ENGINE (Zero Dependencies)
       ====================================================================== */
    var _particles = [];
    var _canvas, _ctx;

    function _initConfetti() {
        _canvas = document.getElementById('cs-confetti-canvas');
        if (!_canvas) return;
        _ctx = _canvas.getContext('2d');
        
        _resizeCanvas();
        window.addEventListener('resize', _resizeCanvas);

        for (var i = 0; i < 100; i++) {
            _particles.push(_createParticle());
        }

        requestAnimationFrame(_drawConfetti);
    }

    function _triggerBigConfetti() {
        for (var i = 0; i < 50; i++) {
            _particles.push(_createParticle(true));
        }
    }

    function _resizeCanvas() {
        _canvas.width = window.innerWidth;
        _canvas.height = window.innerHeight;
    }

    function _createParticle(isBurst) {
        var colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        return {
            x: Math.random() * _canvas.width,
            y: isBurst ? _canvas.height / 2 : Math.random() * -_canvas.height,
            r: Math.random() * 6 + 2,
            dx: Math.random() * 4 - 2,
            dy: Math.random() * 5 + 2,
            c: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.floor(Math.random() * 10) - 10,
            tiltAngle: 0,
            tiltAngleInc: (Math.random() * 0.07) + 0.05
        };
    }

    function _drawConfetti() {
        if (!_state.confettiRunning) return;
        requestAnimationFrame(_drawConfetti);
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

        _particles.forEach(function(p, index) {
            p.tiltAngle += p.tiltAngleInc;
            p.y += p.dy;
            p.x += p.dx;

            _ctx.beginPath();
            _ctx.lineWidth = p.r;
            _ctx.strokeStyle = p.c;
            _ctx.moveTo(p.x + p.tilt + p.r, p.y);
            _ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
            _ctx.stroke();

            // Reset particle
            if (p.y > _canvas.height) {
                _particles[index] = _createParticle();
                _particles[index].y = -10;
            }
        });
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        cancelTimer: cancelTimer,
        copyAffiliate: copyAffiliate
    };

})();
