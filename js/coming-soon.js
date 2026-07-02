/* js/coming-soon.js */
window.NexraComingSoon = {
    db: null,

    init() {
        this.db = firebase.firestore();
    },

    async joinWaitlist() {
        const email = document.getElementById('cs-email').value.trim();
        const btn = document.getElementById('cs-btn-submit');

        if (!email) {
            return NexraApp.showToast('Please enter a valid email.', 'error');
        }

        btn.innerHTML = 'Connecting...';
        btn.classList.add('loading');

        try {
            // Check if already exists (Optional, depending on rules. We'll just write it for simplicity in this frontend module, rules can reject duplicates)
            await this.db.collection('waitlist').add({
                email: email,
                source: window.location.pathname,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            document.getElementById('cs-form').innerHTML = '<div style="color:#10b981; font-weight:800; font-size:18px; padding:16px;">✓ Authorization Granted. You will be notified.</div>';
            
            // Glitch effect on success
            const glitchText = document.querySelector('.glitch');
            glitchText.setAttribute('data-text', 'AUTHORIZED');
            glitchText.innerText = 'AUTHORIZED';
            glitchText.style.color = '#10b981';

        } catch (e) {
            console.error("Waitlist Error:", e);
            NexraApp.showToast('Failed to connect to waitlist endpoint.', 'error');
            btn.innerHTML = 'Initialize Waitlist';
            btn.classList.remove('loading');
        }
    }
};
