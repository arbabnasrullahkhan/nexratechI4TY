/**
 * ==========================================================================
 * NEXRA TECH PK — SECURE CHECKOUT ENGINE (js/checkout.js)
 * ==========================================================================
 * Namespace: window.NexraCheckout
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on shop/checkout.html
 * ==========================================================================
 */

window.NexraCheckout = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        step: 1, // 1: Identity, 2: Payment, 3: Verify
        cart: [],
        hasPhysical: false,
        currentUser: null,
        userCoins: 0,
        usdRate: 280,
        
        // Math
        subtotal: 0,
        shippingFee: 250,
        discountPct: 0,
        coinsUsed: 0,
        grandTotal: 0,
        
        // Form Data
        paymentMethod: 'easypaisa',
        promoCode: '',
        proofBase64: null,
        
        // Security
        isSubmitting: false,
        allowExit: false,
        
        // Gateway Details (Mocked for demo, should come from Firestore in prod)
        gateways: {
            easypaisa: { title: 'EasyPaisa', acct: '03001234567', name: 'Nexra Tech PK' },
            jazzcash:  { title: 'JazzCash',  acct: '03001234567', name: 'Nexra Tech PK' },
            bank:      { title: 'Bank Transfer (Meezan)', acct: '01234567890123', name: 'Nexra Tech PK' },
            crypto:    { title: 'Binance Pay (USDT)', acct: '123456789', name: 'NexraTech' } // ID for binance
        }
    };

    /* ======================================================================
       INIT
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraCheckout] Initializing...');

        // 1. Fetch Cart
        if (!window.NexraApp) {
            console.error('NexraApp core missing.');
            return;
        }
        _state.cart = window.NexraApp.getCart();
        if (_state.cart.length === 0) {
            window.location.href = '/shop/shop.html';
            return;
        }

        // 2. Fetch config & Render Cart
        _loadConfig();
        _subscribeAuth();
        _checkCartTypes();
        _renderCartSummary();
        _recalculateMath();
        selectGateway('easypaisa'); // default render

        // 3. Security: Exit Intent
        window.addEventListener('beforeunload', _handleBeforeUnload);
        
        // 4. Analytics: Capture UTMs
        _captureAnalytics();
    }

    /* ======================================================================
       FIREBASE AUTH & CONFIG
       ====================================================================== */
    function _loadConfig() {
        if (!window.db) return;
        window.db.collection('settings').doc('shop').get().then(function(doc) {
            if (doc.exists && doc.data().usdRate) {
                _state.usdRate = Number(doc.data().usdRate);
                _recalculateMath();
            }
        }).catch(function(){});
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        var banner = document.getElementById('co-auth-banner');
        
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user) {
                if (banner) {
                    banner.innerHTML = '<i class="fa-solid fa-circle-check"></i> Logged in securely as ' + _esc(user.email);
                    banner.style.background = 'rgba(16, 185, 129, 0.1)';
                    banner.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                    banner.style.color = 'var(--success)';
                }
                document.getElementById('co-name').value = user.displayName || '';
                document.getElementById('co-email').value = user.email || '';
                _loadUserCoins(user.uid);
            } else {
                if (banner) {
                    banner.innerHTML = '<i class="fa-solid fa-user-secret"></i> Guest Checkout (Optional: Sign in for loyalty coins)';
                    banner.style.background = 'rgba(245, 158, 11, 0.1)';
                    banner.style.borderColor = 'rgba(245, 158, 11, 0.2)';
                    banner.style.color = '#f59e0b';
                }
                var cb = document.getElementById('co-coins-box');
                if (cb) cb.setAttribute('hidden', '');
            }
        });
    }

    function _loadUserCoins(uid) {
        if (!window.db) return;
        window.db.collection('users').doc(uid).get().then(function(doc) {
            if (doc.exists && doc.data().coins) {
                _state.userCoins = Number(doc.data().coins);
                if (_state.userCoins > 0) {
                    var cb = document.getElementById('co-coins-box');
                    if (cb) cb.removeAttribute('hidden');
                    document.getElementById('co-user-coins').textContent = _state.userCoins;
                    document.getElementById('co-coins-value').textContent = _state.userCoins; // 1 coin = 1 PKR
                }
            }
        }).catch(function(){});
    }

    /* ======================================================================
       CART & TYPE CHECKING
       ====================================================================== */
    function _checkCartTypes() {
        // Need to check if any item is physical to show shipping.
        // Since cart only stores {id, title, price, img, qty}, we must fetch from Firestore to be secure,
        // or rely on a flag if added during addToCart. For simplicity in this engine, we fetch:
        
        if (!window.db) return;
        var promises = _state.cart.map(function(item) {
            return window.db.collection('products').doc(item.id).get();
        });

        Promise.all(promises).then(function(docs) {
            docs.forEach(function(doc) {
                if (doc.exists && doc.data().type === 'Physical') {
                    _state.hasPhysical = true;
                }
            });
            if (_state.hasPhysical) {
                var sMod = document.getElementById('co-shipping-module');
                var sRow = document.getElementById('co-row-shipping');
                if (sMod) sMod.removeAttribute('hidden');
                if (sRow) sRow.removeAttribute('hidden');
                
                // Make shipping required
                document.getElementById('co-address').required = true;
                document.getElementById('co-city').required = true;
            }
            _recalculateMath();
        }).catch(function(err) {
            console.warn('Type check fail, defaulting to digital:', err);
        });
    }

    function _renderCartSummary() {
        var list = document.getElementById('co-cart-list');
        if (!list) return;
        
        list.innerHTML = _state.cart.map(function(item) {
            return '<div class="co-item">' +
                   '<img src="' + _esc(item.img) + '" alt="' + _esc(item.title) + '">' +
                   '<div class="co-item-info">' +
                   '<div class="co-item-title">' + _esc(item.title) + '</div>' +
                   '<div class="co-item-meta">Qty: ' + item.qty + '</div>' +
                   '</div>' +
                   '<div class="co-item-price">Rs. ' + (item.price * item.qty).toLocaleString() + '</div>' +
                   '</div>';
        }).join('');
    }

    /* ======================================================================
       MATH ENGINE
       ====================================================================== */
    function _recalculateMath() {
        _state.subtotal = _state.cart.reduce(function(sum, item) {
            return sum + (item.price * item.qty);
        }, 0);

        var shipping = _state.hasPhysical ? _state.shippingFee : 0;
        var discount = Math.floor(_state.subtotal * (_state.discountPct / 100));
        
        // Ensure coins used doesn't exceed Subtotal - Discount
        var maxCoins = Math.max(0, _state.subtotal - discount);
        if (_state.coinsUsed > maxCoins) _state.coinsUsed = maxCoins;

        _state.grandTotal = _state.subtotal + shipping - discount - _state.coinsUsed;
        if (_state.grandTotal < 0) _state.grandTotal = 0;

        var usd = (_state.grandTotal / _state.usdRate).toFixed(2);
        var earned = Math.floor(_state.grandTotal * 0.01); // 1% back

        // Update DOM
        document.getElementById('co-val-sub').textContent = 'Rs. ' + _state.subtotal.toLocaleString();
        document.getElementById('co-val-shipping').textContent = 'Rs. ' + shipping.toLocaleString();
        
        var dRow = document.getElementById('co-row-discount');
        if (discount > 0) {
            dRow.removeAttribute('hidden');
            document.getElementById('co-val-discount').textContent = '- Rs. ' + discount.toLocaleString();
        } else {
            dRow.setAttribute('hidden', '');
        }

        document.getElementById('co-val-total').textContent = 'Rs. ' + _state.grandTotal.toLocaleString();
        document.getElementById('co-island-val-total').textContent = 'Rs. ' + _state.grandTotal.toLocaleString();
        document.getElementById('co-val-usd').textContent = '$' + usd;
        document.getElementById('co-earn-coins').textContent = earned;
    }

    function applyPromo() {
        var input = document.getElementById('co-promo-input');
        if (!input) return;
        var code = input.value.trim().toLowerCase();
        if (!code) return;

        // Mock Influencer Logic (@ prefix = 5% off)
        if (code.startsWith('@') && code.length > 2) {
            _state.promoCode = code;
            _state.discountPct = 5;
            document.getElementById('co-discount-label').textContent = '(' + code + ')';
            window.NexraApp.showToast('Influencer code applied!', 'fa-solid fa-check-circle', 'success');
        } else {
            _state.promoCode = '';
            _state.discountPct = 0;
            window.NexraApp.showToast('Invalid promo code.', 'fa-solid fa-xmark', 'default');
        }
        _recalculateMath();
    }

    function toggleCoins() {
        var toggle = document.getElementById('co-coins-toggle');
        var row = document.getElementById('co-row-coins');
        
        if (toggle && toggle.checked) {
            _state.coinsUsed = _state.userCoins;
            if (row) {
                row.removeAttribute('hidden');
                document.getElementById('co-val-coins-used').textContent = '- Rs. ' + _state.coinsUsed.toLocaleString();
            }
        } else {
            _state.coinsUsed = 0;
            if (row) row.setAttribute('hidden', '');
        }
        _recalculateMath();
    }

    /* ======================================================================
       STEP PROGRESSION
       ====================================================================== */
    function nextStep(stepNum) {
        // Validation before proceeding
        if (stepNum === 2 && _state.step === 1) {
            var form = document.getElementById('co-contact-form');
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
        
        if (stepNum === 3 && _state.step === 2) {
            if (!_state.paymentMethod) {
                window.NexraApp.showToast('Select a payment method.', 'fa-solid fa-wallet', 'default');
                return;
            }
        }

        // DOM Updates
        [1,2,3].forEach(function(i) {
            var card = document.getElementById('co-step-' + i);
            var nav = document.getElementById('step-' + i + '-nav');
            if (card) {
                if (i === stepNum) card.removeAttribute('hidden');
                else card.setAttribute('hidden', '');
            }
            if (nav) {
                if (i < stepNum) nav.classList.add('completed');
                else nav.classList.remove('completed');
                
                if (i === stepNum) nav.classList.add('active');
                else nav.classList.remove('active');
            }
        });
        
        var tracker = document.querySelector('.co-progress-tracker');
        if (tracker) tracker.setAttribute('data-step', stepNum);

        _state.step = stepNum;
        
        // Scroll to top of forms
        var forms = document.getElementById('co-forms-section');
        if (forms) {
            var top = forms.getBoundingClientRect().top + window.scrollY - 100;
            window.scrollTo({ top: top, behavior: 'smooth' });
        }
    }

    /* ======================================================================
       PAYMENT GATEWAY SELECTOR
       ====================================================================== */
    function selectGateway(method) {
        _state.paymentMethod = method;
        var data = _state.gateways[method];
        var details = document.getElementById('co-gateway-details');
        if (!details || !data) return;

        var html = '<div class="co-gd-row">' +
                   '<span class="co-gd-label">Send payment to:</span>' +
                   '<span class="co-gd-value">' + data.title + '</span>' +
                   '</div>' +
                   '<div class="co-gd-row">' +
                   '<span class="co-gd-label">Account Number:</span>' +
                   '<span class="co-gd-value" style="font-family: monospace; font-size:16px;">' + data.acct + 
                   ' <button class="co-copy-btn" onclick="NexraCheckout._copy(\'' + data.acct + '\')" aria-label="Copy"><i class="fa-solid fa-copy"></i></button></span>' +
                   '</div>' +
                   '<div class="co-gd-row">' +
                   '<span class="co-gd-label">Account Name:</span>' +
                   '<span class="co-gd-value">' + data.name + '</span>' +
                   '</div>';
        
        if (method === 'crypto') {
            html += '<div class="co-gd-row" style="flex-direction:column; align-items:center; gap:8px;">' +
                    '<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(data.acct) + '" alt="QR" style="border-radius:12px;">' +
                    '<span class="co-gd-label">Scan via Binance App</span></div>';
        }

        details.innerHTML = html;
    }

    function _copy(text) {
        navigator.clipboard.writeText(text).then(function() {
            window.NexraApp.showToast('Copied to clipboard', 'fa-solid fa-check', 'success');
            // Haptic
            if (navigator.vibrate) navigator.vibrate(50);
        });
    }

    /* ======================================================================
       BASE64 STORAGE-FREE IMAGE COMPRESSION ENGINE
       ====================================================================== */
    function handleProofUpload(event) {
        var file = event.target.files[0];
        if (!file) return;

        if (!file.type.match(/image.*/)) {
            window.NexraApp.showToast('Only images are allowed.', 'fa-solid fa-xmark', 'default');
            return;
        }

        var reader = new FileReader();
        reader.onload = function (readerEvent) {
            var img = new Image();
            img.onload = function () {
                var canvas = document.createElement('canvas');
                var max_size = 800; // Compression target
                var width = img.width;
                var height = img.height;

                if (width > height) {
                    if (width > max_size) {
                        height *= max_size / width;
                        width = max_size;
                    }
                } else {
                    if (height > max_size) {
                        width *= max_size / height;
                        height = max_size;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress to JPEG Base64
                _state.proofBase64 = canvas.toDataURL('image/jpeg', 0.7);
                
                // Update UI
                var preview = document.getElementById('co-upload-preview');
                var content = document.getElementById('co-upload-content');
                var clearBtn = document.getElementById('co-upload-clear');
                var zone = document.getElementById('co-upload-zone');
                
                if (preview) { preview.src = _state.proofBase64; preview.removeAttribute('hidden'); }
                if (content) content.setAttribute('hidden', '');
                if (clearBtn) clearBtn.removeAttribute('hidden');
                if (zone) { zone.style.padding = '0'; zone.style.border = 'none'; }
                
                window.NexraApp.showToast('Proof attached securely.', 'fa-solid fa-lock', 'success');
            };
            img.src = readerEvent.target.result;
        };
        reader.readAsDataURL(file);
    }

    function clearProof(e) {
        if (e) e.preventDefault();
        _state.proofBase64 = null;
        var input = document.getElementById('co-proof-file');
        var preview = document.getElementById('co-upload-preview');
        var content = document.getElementById('co-upload-content');
        var clearBtn = document.getElementById('co-upload-clear');
        var zone = document.getElementById('co-upload-zone');
        
        if (input) input.value = '';
        if (preview) { preview.src = ''; preview.setAttribute('hidden', ''); }
        if (content) content.removeAttribute('hidden');
        if (clearBtn) clearBtn.setAttribute('hidden', '');
        if (zone) { zone.style.padding = '32px'; zone.style.border = '2px dashed var(--glass-border)'; }
    }

    /* ======================================================================
       ATOMIC SUBMISSION ENGINE
       ====================================================================== */
    function submitOrder() {
        if (_state.isSubmitting) return;

        // Force user to reach step 3
        if (_state.step < 3) {
            window.NexraApp.showToast('Please complete all steps first.', 'fa-solid fa-triangle-exclamation', 'default');
            return;
        }

        if (!_state.proofBase64) {
            window.NexraApp.showToast('Payment proof is required.', 'fa-solid fa-file-shield', 'default');
            return;
        }

        if (!window.db) {
            window.NexraApp.showToast('Database connection failed.', 'fa-solid fa-xmark', 'default');
            return;
        }

        _state.isSubmitting = true;
        
        // Button Loading State
        var btns = ['co-submit-desktop', 'co-submit-mobile'];
        btns.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) { el.disabled = true; el.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Encrypting...'; }
        });

        // Construct Payload
        var payload = {
            userId: _state.currentUser ? _state.currentUser.uid : 'guest',
            customer: {
                name: document.getElementById('co-name').value,
                email: document.getElementById('co-email').value,
                phone: document.getElementById('co-phone').value,
                address: _state.hasPhysical ? document.getElementById('co-address').value : null,
                city: _state.hasPhysical ? document.getElementById('co-city').value : null,
                zip: _state.hasPhysical ? document.getElementById('co-zip').value : null
            },
            items: _state.cart,
            hasPhysical: _state.hasPhysical,
            financials: {
                subtotal: _state.subtotal,
                shipping: _state.hasPhysical ? _state.shippingFee : 0,
                discount: Math.floor(_state.subtotal * (_state.discountPct / 100)),
                coinsUsed: _state.coinsUsed,
                grandTotal: _state.grandTotal,
                usdRate: _state.usdRate
            },
            payment: {
                method: _state.paymentMethod,
                proofBase64: _state.proofBase64 // Stored directly as string
            },
            metadata: {
                promoCode: _state.promoCode,
                utmSource: sessionStorage.getItem('utm_source') || null,
                device: navigator.userAgent,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            }
        };

        // Push to Firestore
        window.db.collection('orders').add(payload).then(function(docRef) {
            _state.allowExit = true; // Release security guard
            
            // Clear Cart
            localStorage.removeItem('nexra_cart');
            if (window.NexraApp) window.NexraApp._state.cart = [];
            
            // Redirect to success
            window.location.href = '/shop/checkout-success.html?orderId=' + docRef.id;

        }).catch(function(err) {
            console.error('Order fail:', err);
            window.NexraApp.showToast('Order failed. Please try again.', 'fa-solid fa-xmark', 'default');
            _state.isSubmitting = false;
            btns.forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.disabled = false; el.innerHTML = '<i class="fa-solid fa-lock"></i> Retry Submission'; }
            });
        });
    }

    /* ======================================================================
       EXIT INTENT & SECURITY GUARD
       ====================================================================== */
    function _handleBeforeUnload(e) {
        if (_state.allowExit || _state.cart.length === 0) return undefined;
        
        // Trigger visual modal if possible, but browsers require standard return for alert
        var modal = document.getElementById('co-exit-modal');
        if (modal) modal.removeAttribute('hidden');

        var msg = "You have an active transaction. Are you sure you want to leave?";
        e.returnValue = msg;
        return msg;
    }

    function allowExit() {
        _state.allowExit = true;
        window.history.back(); // Or redirect to home
    }

    function closeExitModal() {
        var modal = document.getElementById('co-exit-modal');
        if (modal) modal.setAttribute('hidden', '');
    }

    /* ======================================================================
       ANALYTICS CAPTURE
       ====================================================================== */
    function _captureAnalytics() {
        // Parse URL params for UTMs, save to session
        var params = new URLSearchParams(window.location.search);
        var source = params.get('utm_source');
        if (source) sessionStorage.setItem('utm_source', source);
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        nextStep: nextStep,
        selectGateway: selectGateway,
        applyPromo: applyPromo,
        toggleCoins: toggleCoins,
        handleProofUpload: handleProofUpload,
        clearProof: clearProof,
        submitOrder: submitOrder,
        allowExit: allowExit,
        closeExitModal: closeExitModal,
        _copy: _copy
    };

})();
