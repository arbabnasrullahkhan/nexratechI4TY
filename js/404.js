/**
 * NEXRA TECH PK — 404 ENGINE (js/404.js)
 */
window.NexraNotFound = (function() {
    'use strict';

    var _state = { initialized: false, searchTimer: null };

    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _logBrokenUrl();
        _fetchPopularDestinations();
    }

    /* SILENT ANALYTICS: Log broken URL to Firestore */
    function _logBrokenUrl() {
        if (!window.db) return;
        var broken = window.location.href;
        var referrer = document.referrer || 'direct';
        window.db.collection('logs').doc('dead_links').collection('entries').add({
            url: broken, referrer: referrer,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            userAgent: navigator.userAgent.substring(0, 100)
        }).catch(function() {});
    }

    /* POPULAR DESTINATIONS: Fetch top products */
    function _fetchPopularDestinations() {
        if (!window.db) return;
        window.db.collection('products').where('active', '==', true).orderBy('views', 'desc').limit(4).get()
            .then(function(snap) {
                var grid = document.getElementById('e4-popular-grid');
                if (snap.empty) { grid.innerHTML = ''; return; }

                var html = '';
                snap.forEach(function(doc) {
                    var p = doc.data();
                    html += `<a href="/discovery/product-detail.html?id=${doc.id}" class="e4-pop-card">
                        <img src="${p.thumbnail || '/assets/placeholder.jpg'}" class="e4-pop-img" alt="${p.title}" loading="lazy">
                        <div class="e4-pop-name">${p.title}</div>
                        <div class="e4-pop-category">${p.category || 'Software'}</div>
                    </a>`;
                });
                grid.innerHTML = html;
            }).catch(function() {
                document.getElementById('e4-popular-grid').innerHTML = '';
            });
    }

    /* DEBOUNCED SEARCH */
    function debounceSearch(e) {
        clearTimeout(_state.searchTimer);
        _state.searchTimer = setTimeout(function() {
            var term = e.target.value.trim();
            if (term.length >= 2) {
                window.location.href = '/discovery/home.html?search=' + encodeURIComponent(term);
            }
        }, 600);
    }

    function triggerSearch() {
        var term = document.getElementById('e4-search').value.trim();
        if (term) window.location.href = '/discovery/home.html?search=' + encodeURIComponent(term);
    }

    return { init: init, debounceSearch: debounceSearch, triggerSearch: triggerSearch };
})();
