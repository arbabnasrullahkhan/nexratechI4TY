/**
 * NEXRA TECH PK — ABOUT PAGE ENGINE (js/about.js)
 */
window.NexraAbout = (function() {
    'use strict';

    var _state = { initialized: false };

    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _fetchMission();
        _fetchLiveStats();
        _fetchTimeline();
        _fetchTeam();
        _drawWatermark();
        _initStickyCTA();
        _injectSchema();
    }

    /* MISSION */
    function _fetchMission() {
        if (!window.db) return;
        window.db.collection('settings').doc('about').get().then(function(doc) {
            if (!doc.exists) return;
            var d = doc.data();
            var el = document.getElementById('ab-mission-title');
            var body = document.getElementById('ab-mission-body');
            if (el) el.innerText = d.missionTitle || 'Empowering Pakistan\'s Digital Economy';
            if (body) body.innerText = d.missionBody || 'A unified SaaS marketplace for creators, entrepreneurs, and resellers.';
        });
    }

    /* LIVE STATS with ANIMATED COUNTERS */
    function _fetchLiveStats() {
        if (!window.db) return;
        window.db.collection('stats').doc('live').get().then(function(doc) {
            var grid = document.getElementById('ab-stats-grid');
            var data = doc.exists ? doc.data() : {};

            var stats = [
                { icon: 'fa-users', number: data.totalUsers || 12400, label: 'Active Users', suffix: '+' },
                { icon: 'fa-handshake', number: data.activeCreators || 340, label: 'Content Creators', suffix: '+' },
                { icon: 'fa-truck-fast', number: data.deliveries || 48000, label: 'Deliveries Made', suffix: '+' },
                { icon: 'fa-star', number: data.rating || 4.9, label: 'Avg. Rating', suffix: '' }
            ];

            var html = '';
            stats.forEach(function(s, i) {
                html += `<div class="ab-stat-card" style="animation: abFadeUp 0.4s both; animation-delay: ${i*0.08}s;">
                    <div class="ab-stat-icon"><i class="fa-solid ${s.icon}"></i></div>
                    <div class="ab-stat-number" id="ab-stat-${i}" data-target="${s.number}" data-suffix="${s.suffix}">0</div>
                    <div class="ab-stat-label">${s.label}</div>
                </div>`;
            });
            grid.innerHTML = html;

            // Animated counter
            stats.forEach(function(s, i) {
                _animateCounter('ab-stat-' + i, s.number, s.suffix, s.number < 10 ? 1 : Math.floor(s.number / 60));
            });
        });
    }

    function _animateCounter(id, target, suffix, step) {
        var el = document.getElementById(id);
        if (!el) return;
        var current = 0;
        var isDecimal = target < 10;
        var interval = setInterval(function() {
            current = isDecimal ? Math.min((current + 0.1), target) : Math.min(current + step, target);
            el.innerText = isDecimal ? current.toFixed(1) + suffix : Math.floor(current).toLocaleString() + suffix;
            if (current >= target) clearInterval(interval);
        }, 16);
    }

    /* TIMELINE */
    function _fetchTimeline() {
        if (!window.db) return;
        window.db.collection('settings').doc('about').get().then(function(doc) {
            var container = document.getElementById('ab-timeline');
            var milestones = doc.exists && doc.data().timeline ? doc.data().timeline : [
                { year: '2021', title: 'The Spark', desc: 'Nexra Tech PK founded with a single SaaS product and a bold vision.' },
                { year: '2022', title: 'Marketplace Launch', desc: 'Full catalog launched with 50+ products and instant delivery.' },
                { year: '2023', title: 'Community Growth', desc: 'Free vault, learning academy, and support hub deployed.' },
                { year: '2024', title: 'Scale & Beyond', desc: 'Reached 10,000+ users and expanded to international markets.' }
            ];

            var html = '';
            milestones.forEach(function(m, i) {
                html += `<div class="ab-timeline-item" style="animation-delay:${i*0.1}s;">
                    <div class="ab-tl-year">${m.year}</div>
                    <div class="ab-tl-title">${m.title}</div>
                    <div class="ab-tl-desc">${m.desc}</div>
                </div>`;
            });
            container.innerHTML = html;
        });
    }

    /* TEAM */
    function _fetchTeam() {
        if (!window.db) return;
        window.db.collection('team').orderBy('order', 'asc').limit(6).get().then(function(snap) {
            var grid = document.getElementById('ab-team-grid');
            if (snap.empty) { grid.innerHTML = '<p style="color:var(--text-300);">Team info coming soon.</p>'; return; }

            var html = '';
            snap.forEach(function(doc) {
                var m = doc.data();
                html += `<div class="ab-team-card">
                    <img src="${m.avatarUrl || '/assets/placeholder.jpg'}" class="ab-team-avatar" alt="${m.name}">
                    <div class="ab-team-name">${m.name}</div>
                    <div class="ab-team-role">${m.role}</div>
                </div>`;
            });
            grid.innerHTML = html;
        });
    }

    /* CANVAS WATERMARK */
    function _drawWatermark() {
        var canvas = document.getElementById('ab-watermark-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.fillStyle = 'rgba(124,58,237,0.3)';
        ctx.font = 'bold 14px sans-serif';
        ctx.save();
        ctx.rotate(-25 * Math.PI / 180);
        for (var y = -canvas.height; y < canvas.height * 2; y += 100) {
            for (var x = -canvas.width; x < canvas.width * 2; x += 250) {
                ctx.fillText('NEXRA TECH PK', x, y);
            }
        }
        ctx.restore();
    }

    /* STICKY CTA (shows after 3s) */
    function _initStickyCTA() {
        setTimeout(function() {
            var cta = document.getElementById('ab-sticky-cta');
            if (cta) cta.style.display = 'flex';
        }, 3000);
    }

    /* JSON-LD */
    function _injectSchema() {
        var schema = {
            "@context": "https://schema.org",
            "@type": ["AboutPage", "WebPage"],
            "name": "About Nexra Tech PK",
            "description": "Company story, vision, and team behind Nexra Tech PK.",
            "url": "https://nexratech.pk/system/about.html",
            "publisher": {
                "@type": "Organization",
                "name": "Nexra Tech PK",
                "url": "https://nexratech.pk",
                "sameAs": ["https://www.facebook.com/nexratech", "https://wa.me/923001234567"]
            }
        };
        var el = document.getElementById('ab-json-ld');
        if (el) el.innerText = JSON.stringify(schema);
    }

    return { init: init };
})();
