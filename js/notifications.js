/**
 * ==========================================================================
 * NEXRA TECH PK — PERSONAL ALERTS ENGINE (js/notifications.js)
 * ==========================================================================
 */

window.NexraNotif = (function () {
    'use strict';

    var _state = {
        initialized: false,
        user: null,
        alerts: [],
        activeFilter: 'all',
        unsubAlerts: null,
        unsubGlobal: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT & AUTH GUARD
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _cacheDOM();
        _subscribeAuth();
    }

    function _cacheDOM() {
        _DOM.guard = document.getElementById('nt-pre-guard');
        _DOM.main = document.getElementById('nt-main');
        _DOM.feed = document.getElementById('nt-inbox-feed');
        _DOM.unreadBadge = document.getElementById('nt-unread-count');
        _DOM.btnMarkRead = document.getElementById('nt-btn-markread');
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function(user) {
            if (!user) {
                window.location.replace('/user/auth-gate.html?redirect=/user/notifications.html');
                return;
            }

            _state.user = user;
            
            // Unlock UI
            if (_DOM.guard.style.display !== 'none') {
                _DOM.guard.style.opacity = '0';
                setTimeout(function() { 
                    _DOM.guard.style.display = 'none'; 
                    _DOM.main.removeAttribute('hidden');
                    _initRealtimeFeeds();
                }, 500);
            }
        });
    }

    /* ======================================================================
       REAL-TIME FEEDS (Personal + Global)
       ====================================================================== */
    function _initRealtimeFeeds() {
        if (!window.db) return;
        
        // 1. Personal Alerts (targeted directly to user's UID)
        _state.unsubAlerts = window.db.collection('notifications')
            .where('uid', '==', _state.user.uid)
            .onSnapshot(function(snap) {
                _handleSnapshotChange(snap, false);
            });

        // 2. Global Broadcasts (where uid == 'ALL')
        _state.unsubGlobal = window.db.collection('notifications')
            .where('uid', '==', 'ALL')
            .onSnapshot(function(snap) {
                _handleSnapshotChange(snap, true);
            });
    }

    function _handleSnapshotChange(snap, isGlobal) {
        snap.docChanges().forEach(function(change) {
            var data = change.doc.data();
            data.id = change.doc.id;
            data.isGlobal = isGlobal;

            if (change.type === 'added') {
                // If global, we check a local tracker array in the user doc to see if read,
                // but for simplicity, we map it locally.
                _state.alerts.push(data);
            }
            if (change.type === 'modified') {
                var idx = _state.alerts.findIndex(function(a) { return a.id === data.id; });
                if (idx > -1) _state.alerts[idx] = data;
            }
            if (change.type === 'removed') {
                _state.alerts = _state.alerts.filter(function(a) { return a.id !== data.id; });
            }
        });

        // Sort by timestamp desc
        _state.alerts.sort(function(a, b) {
            var tA = a.createdAt ? a.createdAt.toMillis() : 0;
            var tB = b.createdAt ? b.createdAt.toMillis() : 0;
            return tB - tA;
        });

        _renderFeed();
    }

    /* ======================================================================
       FILTERING & RENDERING
       ====================================================================== */
    function filterAlerts(type, btnEl) {
        _state.activeFilter = type;
        
        var btns = document.querySelectorAll('.nt-filter-pill');
        btns.forEach(function(b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        _renderFeed();
    }

    function _renderFeed() {
        if (!_DOM.feed) return;

        var displayArr = _state.alerts;
        if (_state.activeFilter !== 'all') {
            displayArr = _state.alerts.filter(function(a) { return a.type === _state.activeFilter; });
        }

        // Unread logic
        var unreadCount = _state.alerts.filter(function(a) { return !a.read && !a.isGlobal; }).length;
        _DOM.unreadBadge.innerText = unreadCount + ' Unread';
        _DOM.btnMarkRead.disabled = (unreadCount === 0);

        if (displayArr.length === 0) {
            _DOM.feed.innerHTML = `
                <div class="nt-empty-state">
                    <i class="fa-solid fa-inbox"></i>
                    <h3>Inbox Empty</h3>
                    <p>You're all caught up! Check back later for exclusive promos and security alerts.</p>
                </div>
            `;
            return;
        }

        var html = '';
        displayArr.forEach(function(a) {
            var dateStr = a.createdAt ? a.createdAt.toDate().toLocaleDateString() : 'Just now';
            var readCls = (!a.read && !a.isGlobal) ? 'unread' : '';
            
            // Icon mapping
            var iconHtml = '<i class="fa-solid fa-bell"></i>';
            var iconCls = 'global';
            if (a.type === 'promo') { iconHtml = '<i class="fa-solid fa-tags"></i>'; iconCls = 'promo'; }
            if (a.type === 'order') { iconHtml = '<i class="fa-solid fa-box-open"></i>'; iconCls = 'order'; }
            if (a.type === 'security') { iconHtml = '<i class="fa-solid fa-shield-halved"></i>'; iconCls = 'security'; }

            // Promo Code Logic
            var promoHtml = '';
            if (a.type === 'promo' && a.couponCode) {
                promoHtml = `
                <div class="nt-coupon-wrap" onclick="NexraNotif.revealCoupon('${a.couponCode}', this)">
                    <span class="nt-coupon-code">${a.couponCode}</span>
                    <div class="nt-coupon-blur"><i class="fa-solid fa-hand-pointer" style="margin-right:6px;"></i> Tap to Reveal</div>
                </div>`;
            }

            html += `
            <div style="position:relative;">
                <div class="nt-swipe-bg"><i class="fa-solid fa-trash-can"></i></div>
                <div class="nt-alert-card ${readCls}" id="alert-${a.id}">
                    <div class="nt-icon-box ${iconCls}">${iconHtml}</div>
                    <div class="nt-alert-content">
                        <div class="nt-alert-header">
                            <div class="nt-alert-title">${a.title}</div>
                            <div class="nt-alert-time">${dateStr}</div>
                        </div>
                        <div class="nt-alert-body">${a.message}</div>
                        ${promoHtml}
                    </div>
                </div>
            </div>`;
        });
        
        _DOM.feed.innerHTML = html;
        _bindSwipeEvents();
    }

    /* ======================================================================
       INTERACTIONS (Reveal, Mark Read, Delete)
       ====================================================================== */
    function revealCoupon(code, el) {
        var blurEl = el.querySelector('.nt-coupon-blur');
        if (blurEl) blurEl.classList.add('revealed');

        // Copy to clipboard
        navigator.clipboard.writeText(code).then(function() {
            if (window.NexraApp) NexraApp.showToast('Coupon copied to clipboard!', 'fa-solid fa-tags', 'success');
            
            // Haptic feedback if available
            if (navigator.vibrate) navigator.vibrate(50);
        });
    }

    function markAllAsRead() {
        if (!_state.user || !window.db) return;
        
        _DOM.btnMarkRead.disabled = true;
        _DOM.btnMarkRead.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';

        var batch = window.db.batch();
        var toUpdate = _state.alerts.filter(function(a) { return !a.read && !a.isGlobal; });

        toUpdate.forEach(function(a) {
            var ref = window.db.collection('notifications').doc(a.id);
            batch.update(ref, { read: true });
        });

        batch.commit().then(function() {
            if (window.NexraApp) NexraApp.showToast('All alerts marked as read.', 'fa-solid fa-check-double', 'success');
        }).catch(function(err) {
            console.error('Batch update failed:', err);
        }).finally(function() {
            _DOM.btnMarkRead.innerHTML = '<i class="fa-solid fa-check-double"></i> Mark All Read';
        });
    }

    function deleteAlert(id) {
        if (!_state.user || !window.db) return;
        
        // Optimistic UI removal
        var cardContainer = document.getElementById('alert-' + id).parentElement;
        if (cardContainer) {
            cardContainer.style.height = cardContainer.offsetHeight + 'px';
            cardContainer.style.transition = '0.3s';
            cardContainer.style.opacity = '0';
            cardContainer.style.transform = 'scale(0.9)';
            setTimeout(function() { cardContainer.remove(); }, 300);
        }

        window.db.collection('notifications').doc(id).delete().catch(function(err) {
            console.error("Delete failed", err);
            // In a real app, rollback the optimistic deletion here
        });
    }

    /* ======================================================================
       SWIPE-TO-DELETE MECHANICS
       ====================================================================== */
    function _bindSwipeEvents() {
        var cards = document.querySelectorAll('.nt-alert-card');
        
        cards.forEach(function(card) {
            var id = card.id.replace('alert-', '');
            // Skip global alerts from deletion if needed, but allowing for demo
            
            var startX = 0;
            var currentX = 0;
            var isSwiping = false;

            card.addEventListener('touchstart', function(e) {
                startX = e.touches[0].clientX;
                isSwiping = true;
                card.style.transition = 'none';
            }, { passive: true });

            card.addEventListener('touchmove', function(e) {
                if (!isSwiping) return;
                var x = e.touches[0].clientX;
                currentX = x - startX;
                
                // Only allow swiping left
                if (currentX < 0) {
                    card.style.transform = 'translateX(' + currentX + 'px)';
                }
            }, { passive: true });

            card.addEventListener('touchend', function(e) {
                isSwiping = false;
                card.style.transition = 'transform 0.3s var(--ease)';
                
                if (currentX < -100) {
                    // Trigger delete
                    card.style.transform = 'translateX(-100%)';
                    deleteAlert(id);
                } else {
                    // Snap back
                    card.style.transform = 'translateX(0)';
                }
                currentX = 0;
            });
        });
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        filterAlerts: filterAlerts,
        revealCoupon: revealCoupon,
        markAllAsRead: markAllAsRead
    };

})();
