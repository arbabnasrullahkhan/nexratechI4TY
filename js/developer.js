/* js/developer.js */
window.NexraDev = {
    db: null,
    
    async init() {
        this.db = firebase.firestore();
        this.listenSystemStatus();
        this.setupScrollSpy();
    },

    listenSystemStatus() {
        const txt = document.getElementById('dsb-text');
        const lat = document.getElementById('dsb-latency');
        const bar = document.getElementById('dev-status-bar');

        // Initial Dummy Ping to measure latency
        const startPing = Date.now();
        this.db.collection('settings').doc('system_status').onSnapshot(doc => {
            const endPing = Date.now();
            const latency = endPing - startPing;
            
            lat.innerText = `${latency} ms`;

            if (doc.exists && doc.data().services) {
                const services = doc.data().services;
                const hasOutage = services.some(s => s.status === 'outage');
                const hasDegraded = services.some(s => s.status === 'degraded');

                if (hasOutage) {
                    txt.innerText = 'Partial API Outage';
                    txt.style.color = '#ef4444';
                    bar.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                    bar.style.background = 'rgba(239, 68, 68, 0.05)';
                    document.querySelector('.status-dot').style.background = '#ef4444';
                    document.querySelector('.status-dot').style.boxShadow = '0 0 10px #ef4444';
                } else if (hasDegraded) {
                    txt.innerText = 'API Degraded Performance';
                    txt.style.color = '#f59e0b';
                    bar.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                    bar.style.background = 'rgba(245, 158, 11, 0.05)';
                    document.querySelector('.status-dot').style.background = '#f59e0b';
                    document.querySelector('.status-dot').style.boxShadow = '0 0 10px #f59e0b';
                } else {
                    txt.innerText = 'API Systems Operational';
                    txt.style.color = '#10b981';
                    bar.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                    bar.style.background = 'rgba(16, 185, 129, 0.05)';
                    document.querySelector('.status-dot').style.background = '#10b981';
                    document.querySelector('.status-dot').style.boxShadow = '0 0 10px #10b981';
                }
            }
        });
    },

    copyCode(elementId) {
        const codeElement = document.getElementById(elementId);
        if(!codeElement) return;

        // Extract raw text without HTML tags
        const textToCopy = codeElement.innerText || codeElement.textContent;
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            NexraApp.showToast('Copied to clipboard', 'success');
            
            // Haptic feedback if available on mobile
            if(window.navigator && window.navigator.vibrate) {
                window.navigator.vibrate(50);
            }
        }).catch(err => {
            console.error('Copy failed', err);
            NexraApp.showToast('Failed to copy', 'error');
        });
    },

    setupScrollSpy() {
        const sections = document.querySelectorAll('.dc-section');
        const navLinks = document.querySelectorAll('.ds-nav a');

        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(sec => {
                const secTop = sec.offsetTop;
                const secHeight = sec.clientHeight;
                if (pageYOffset >= (secTop - 150)) {
                    current = sec.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href').substring(1) === current) {
                    link.classList.add('active');
                }
            });
        });
    }
};
