/**
 * NEXRA TECH PK — POLICIES ENGINE (js/policies.js)
 */
window.NexraPolicies = (function() {
    'use strict';

    var _state = { initialized: false, cache: {}, activeTab: 'privacy' };

    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        _fetchLegalDoc();
        _drawWatermark();
        _injectSchema();
    }

    function _fetchLegalDoc() {
        if (!window.db) return;
        window.db.collection('settings').doc('legal').get().then(function(doc) {
            if (!doc.exists) { _showEmpty(); return; }
            var data = doc.data();
            // Cache all tabs
            _state.cache['privacy']  = data.privacyHtml  || '';
            _state.cache['terms']    = data.termsHtml    || '';
            _state.cache['refund']   = data.refundHtml   || '';
            _state.cache['license']  = data.licenseHtml  || '';
            
            // Last Updated
            if (data.lastUpdated) {
                var d = data.lastUpdated.toDate ? data.lastUpdated.toDate() : new Date(data.lastUpdated);
                document.getElementById('pl-last-updated').innerText = d.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
            }
            // Render active tab
            _renderTab(_state.activeTab);
        }).catch(_showEmpty);
    }

    function switchTab(tab, btnEl) {
        if (_state.activeTab === tab && Object.keys(_state.cache).length) return;
        _state.activeTab = tab;

        // Update buttons
        document.querySelectorAll('.pl-tab').forEach(function(b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        // If data is cached, render immediately; otherwise show skeleton & wait
        if (_state.cache[tab] !== undefined) {
            _renderTab(tab);
        } else {
            _showSkeleton();
        }
    }

    function _renderTab(tab) {
        var content = _state.cache[tab] || '';
        var doc = document.getElementById('pl-doc');
        var skel = document.getElementById('pl-skeleton');
        var empty = document.getElementById('pl-empty');

        if (!content) { _showEmpty(); return; }

        skel.style.display = 'none';
        empty.style.display = 'none';
        doc.innerHTML = content;
        doc.style.display = 'block';
    }

    function _showSkeleton() {
        document.getElementById('pl-skeleton').style.display = 'flex';
        document.getElementById('pl-doc').style.display = 'none';
        document.getElementById('pl-empty').style.display = 'none';
    }

    function _showEmpty() {
        document.getElementById('pl-skeleton').style.display = 'none';
        document.getElementById('pl-doc').style.display = 'none';
        document.getElementById('pl-empty').style.display = 'block';
    }

    function _drawWatermark() {
        var canvas = document.getElementById('pl-watermark-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        canvas.width = 800; canvas.height = 600;
        ctx.fillStyle = 'rgba(124,58,237,0.6)';
        ctx.font = 'bold 18px Space Grotesk, sans-serif';
        ctx.save();
        ctx.translate(400, 300); ctx.rotate(-30 * Math.PI / 180);
        for (var y = -400; y < 400; y += 80) {
            for (var x = -500; x < 500; x += 220) {
                ctx.fillText('NEXRA TECH PK', x, y);
            }
        }
        ctx.restore();
    }

    function _injectSchema() {
        var schema = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "Legal & Policies | Nexra Tech PK",
            "description": "Official Privacy Policy, Terms, Refund, and License documentation.",
            "url": "https://nexratech.pk/system/policies.html",
            "publisher": { "@type": "Organization", "name": "Nexra Tech PK", "url": "https://nexratech.pk" }
        };
        var el = document.getElementById('pl-json-ld');
        if (el) el.innerText = JSON.stringify(schema);
    }

    return { init: init, switchTab: switchTab };
})();
