/* js/status.js */
window.NexraStatus = {
    db: null,
    
    // Fallback data if Firebase is empty
    defaultServices: [],

    async init() {
        this.db = firebase.firestore();
        this.loadStatus();
        this.loadIncidents();
    },

    async loadStatus() {
        try {
            const doc = await this.db.collection('settings').doc('system_status').get();
            let services = this.defaultServices;
            
            if (doc.exists && doc.data().services) {
                services = doc.data().services;
            }

            this.renderServices(services);
            this.updateGlobalBanner(services);
            this.injectSEOSchema(services);

        } catch (e) {
            console.error("Failed to load status:", e);
            // Fallback render
            this.renderServices(this.defaultServices);
            this.updateGlobalBanner(this.defaultServices);
        }
    },

    renderServices(services) {
        const grid = document.getElementById('services-grid');
        let html = '';

        services.forEach(s => {
            let badgeClass = 'badge-op';
            let badgeText = 'Operational';
            
            if (s.status === 'degraded') { badgeClass = 'badge-deg'; badgeText = 'Degraded'; }
            if (s.status === 'outage') { badgeClass = 'badge-out'; badgeText = 'Outage'; }

            html += `
                <div class="ss-card">
                    <div class="ssc-info">
                        <div class="ssc-name">${s.name}</div>
                        <div class="ssc-desc">${s.desc}</div>
                    </div>
                    <div class="ssc-badge ${badgeClass}">
                        <span class="status-dot"></span> ${badgeText}
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    },

    updateGlobalBanner(services) {
        const banner = document.getElementById('global-status-banner');
        const title = banner.querySelector('.sh-title');
        const sub = banner.querySelector('.sh-sub');
        const icon = banner.querySelector('.sh-icon i');

        const hasOutage = services.some(s => s.status === 'outage');
        const hasDegraded = services.some(s => s.status === 'degraded');

        banner.className = 'status-hero'; // reset

        if (hasOutage) {
            banner.classList.add('outage');
            icon.className = 'fa-solid fa-triangle-exclamation fa-beat';
            title.innerText = 'Partial System Outage';
            sub.innerText = 'We are currently experiencing issues with one or more services.';
        } else if (hasDegraded) {
            banner.classList.add('degraded');
            icon.className = 'fa-solid fa-bolt fa-fade';
            title.innerText = 'Degraded Performance';
            sub.innerText = 'Some services are experiencing slower than normal response times.';
        } else {
            banner.classList.add('operational');
            icon.className = 'fa-solid fa-check-circle';
            title.innerText = 'All Systems Operational';
            sub.innerText = 'All services are online and operating normally.';
        }
    },

    async loadIncidents() {
        try {
            const snap = await this.db.collection('incident_logs')
                .orderBy('timestamp', 'desc')
                .limit(10)
                .get();

            const tl = document.getElementById('incident-timeline');
            
            if (snap.empty) {
                // Generate a mock incident if none exist for UI demo purposes
                tl.innerHTML = `
                    <div class="inc-item">
                        <div class="inc-date">Oct 15, 2025 • 14:30 PKT</div>
                        <div class="inc-title">API Latency Spike Resolved</div>
                        <div class="inc-msg">We identified an issue causing elevated latency across our core API. A hotfix was deployed and monitoring confirms all metrics are back to normal.</div>
                        <div class="inc-status-tag tag-resolved">Resolved</div>
                    </div>
                `;
                return;
            }

            let html = '';
            snap.forEach(doc => {
                const d = doc.data();
                const date = d.timestamp ? new Date(d.timestamp.toMillis()).toLocaleString() : 'Recent';
                const tagClass = d.status === 'resolved' ? 'tag-resolved' : 'tag-investigating';
                const tagText = d.status === 'resolved' ? 'Resolved' : 'Investigating';

                html += `
                    <div class="inc-item">
                        <div class="inc-date">${date}</div>
                        <div class="inc-title">${d.title}</div>
                        <div class="inc-msg">${d.message}</div>
                        <div class="inc-status-tag ${tagClass}">${tagText}</div>
                    </div>
                `;
            });

            tl.innerHTML = html;
        } catch(e) {
            console.error("Failed to load incidents:", e);
        }
    },

    injectSEOSchema(services) {
        const schema = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "System Status - Nexra Tech PK",
            "description": "Real-time system status and incident logs.",
            "mainEntity": {
                "@type": "ItemList",
                "itemListElement": services.map((s, index) => ({
                    "@type": "ListItem",
                    "position": index + 1,
                    "item": {
                        "@type": "Thing",
                        "name": s.name,
                        "description": `${s.desc} - Current Status: ${s.status}`
                    }
                }))
            }
        };

        const scriptTag = document.getElementById('status-seo-schema');
        if (scriptTag) {
            scriptTag.textContent = JSON.stringify(schema, null, 2);
        }
    }
};
