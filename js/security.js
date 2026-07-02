/* js/security.js */
window.NexraSecurity = {
    db: null,
    auth: null,
    uid: null,
    userDoc: null,

    async init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.uid = user.uid;
                this.checkProvider();
            } else {
                window.location.href = '/user/auth-gate.html?redirect=/user/security.html';
            }
        });
    },

    checkProvider() {
        const user = this.auth.currentUser;
        const providers = user.providerData.map(p => p.providerId);
        if (providers.includes('google.com')) {
            document.getElementById('sec-guard-google').style.display = 'block';
            document.getElementById('sec-reauth-pwd').style.display = 'none';
            document.querySelector('.sec-guard-box .sec-btn-primary').style.display = 'none';
        }
    },

    async verifyIdentity() {
        const pwd = document.getElementById('sec-reauth-pwd').value;
        if (!pwd) return NexraApp.showToast('Enter password', 'error');

        const cred = firebase.auth.EmailAuthProvider.credential(this.auth.currentUser.email, pwd);
        try {
            await this.auth.currentUser.reauthenticateWithCredential(cred);
            this.unlockDashboard();
        } catch(e) {
            NexraApp.showToast('Verification failed. Wrong password.', 'error');
        }
    },

    async verifyGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await this.auth.currentUser.reauthenticateWithPopup(provider);
            this.unlockDashboard();
        } catch(e) {
            NexraApp.showToast('Google verification failed.', 'error');
        }
    },

    async unlockDashboard() {
        document.getElementById('sec-guard').style.opacity = '0';
        setTimeout(() => document.getElementById('sec-guard').style.display = 'none', 400);
        document.getElementById('sec-main').style.display = 'flex';
        
        this.loadProfile();
        this.loadProviders();
        this.logSession();
    },

    async loadProfile() {
        try {
            const doc = await this.db.collection('users').doc(this.uid).get();
            if (doc.exists) {
                this.userDoc = doc.data();
                document.getElementById('prof-name').value = this.userDoc.displayName || '';
                document.getElementById('prof-wa').value = this.userDoc.whatsapp || '';
            }
        } catch(e) {
            console.error("Profile load failed");
        }
    },

    async saveProfile() {
        const name = document.getElementById('prof-name').value;
        const wa = document.getElementById('prof-wa').value;
        
        try {
            await this.db.collection('users').doc(this.uid).update({
                displayName: name,
                whatsapp: wa
            });
            // Update auth profile
            await this.auth.currentUser.updateProfile({ displayName: name });
            NexraApp.showToast('Profile updated securely.', 'success');
        } catch(e) {
            NexraApp.showToast('Failed to update profile.', 'error');
        }
    },

    loadProviders() {
        const providers = this.auth.currentUser.providerData.map(p => p.providerId);
        const status = document.getElementById('sso-google-status');
        const btn = document.getElementById('btn-sso-google');

        if (providers.includes('google.com')) {
            status.innerText = 'Linked';
            status.className = 'sec-status linked';
            btn.innerText = 'Unlink';
            btn.style.background = 'rgba(239, 68, 68, 0.1)';
            btn.style.color = 'var(--danger)';
        } else {
            status.innerText = 'Not Linked';
            status.className = 'sec-status unlinked';
            btn.innerText = 'Link Account';
            btn.style.background = 'rgba(255,255,255,0.1)';
            btn.style.color = '#fff';
        }
    },

    async toggleGoogleLink() {
        const providers = this.auth.currentUser.providerData.map(p => p.providerId);
        const isLinked = providers.includes('google.com');

        try {
            if (isLinked) {
                if(providers.length === 1) return NexraApp.showToast('Cannot unlink only provider.', 'error');
                await this.auth.currentUser.unlink('google.com');
                NexraApp.showToast('Google account unlinked.', 'success');
            } else {
                const provider = new firebase.auth.GoogleAuthProvider();
                await this.auth.currentUser.linkWithPopup(provider);
                NexraApp.showToast('Google account linked successfully.', 'success');
            }
            this.loadProviders();
        } catch(e) {
            console.error(e);
            NexraApp.showToast('Operation failed.', 'error');
        }
    },

    togglePwd(inputId, icon) {
        const input = document.getElementById(inputId);
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    },

    checkPwdStrength(pwd) {
        const fill = document.getElementById('pwd-str-fill');
        const text = document.getElementById('pwd-str-text');
        let str = 0;
        if(pwd.length >= 8) str++;
        if(/[A-Z]/.test(pwd)) str++;
        if(/[0-9]/.test(pwd)) str++;
        if(/[^A-Za-z0-9]/.test(pwd)) str++;

        if(pwd.length === 0) {
            fill.style.width = '0%'; text.innerText = 'Strength';
        } else if(str <= 1) {
            fill.style.width = '25%'; fill.style.background = 'var(--danger)'; text.innerText = 'Weak';
        } else if(str === 2) {
            fill.style.width = '50%'; fill.style.background = '#f59e0b'; text.innerText = 'Fair';
        } else if(str === 3) {
            fill.style.width = '75%'; fill.style.background = '#3b82f6'; text.innerText = 'Good';
        } else {
            fill.style.width = '100%'; fill.style.background = '#10b981'; text.innerText = 'Strong';
        }
    },

    async updatePassword() {
        const pwd = document.getElementById('pwd-new').value;
        const confirm = document.getElementById('pwd-confirm').value;

        if (pwd !== confirm) return NexraApp.showToast('Passwords do not match.', 'error');
        if (pwd.length < 8) return NexraApp.showToast('Password must be at least 8 chars.', 'error');

        try {
            await this.auth.currentUser.updatePassword(pwd);
            NexraApp.showToast('Password updated securely.', 'success');
            document.getElementById('pwd-new').value = '';
            document.getElementById('pwd-confirm').value = '';
            this.checkPwdStrength('');
        } catch(e) {
            NexraApp.showToast('Failed to update password.', 'error');
        }
    },

    // Session Management (Simulated via Firestore for UI display)
    async logSession() {
        const parser = navigator.userAgent;
        let os = 'Unknown OS', browser = 'Unknown Browser';
        if(parser.includes('Win')) os = 'Windows';
        else if(parser.includes('Mac')) os = 'macOS';
        else if(parser.includes('Linux')) os = 'Linux';
        else if(parser.includes('Android')) os = 'Android';
        else if(parser.includes('iPhone')) os = 'iOS';

        if(parser.includes('Chrome')) browser = 'Chrome';
        else if(parser.includes('Safari')) browser = 'Safari';
        else if(parser.includes('Firefox')) browser = 'Firefox';

        const sessionId = localStorage.getItem('nx_session') || this.db.collection('users').doc().id;
        localStorage.setItem('nx_session', sessionId);

        await this.db.collection(`users/${this.uid}/sessions`).doc(sessionId).set({
            os, browser,
            lastActive: firebase.firestore.FieldValue.serverTimestamp(),
            ipHash: Math.random().toString(36).substring(2,10) // Mock IP hash
        });

        this.listenSessions();
    },

    listenSessions() {
        this.db.collection(`users/${this.uid}/sessions`).orderBy('lastActive', 'desc').onSnapshot(snap => {
            const list = document.getElementById('sessions-list');
            if(snap.empty) {
                list.innerHTML = '<div style="color:var(--text-300); font-size:13px;">No active sessions.</div>';
                return;
            }

            const currentSessionId = localStorage.getItem('nx_session');
            let html = '';
            snap.forEach(doc => {
                const d = doc.data();
                const isCurrent = doc.id === currentSessionId;
                const icon = d.os === 'Android' || d.os === 'iOS' ? 'fa-mobile-screen' : 'fa-laptop';
                const date = d.lastActive ? new Date(d.lastActive.toMillis()).toLocaleString() : 'Just now';

                html += `
                    <div class="sec-session-item">
                        <div style="display:flex; gap:12px; align-items:center;">
                            <div class="sec-sess-icon"><i class="fa-solid ${icon}"></i></div>
                            <div class="sec-sess-meta">
                                <strong>${d.os} - ${d.browser} ${isCurrent ? '<span style="color:#10b981; display:inline;">(Current)</span>' : ''}</strong>
                                <span>Hash: ${d.ipHash} | ${date}</span>
                            </div>
                        </div>
                        ${!isCurrent ? `<button class="sec-btn-danger-sm" onclick="NexraSecurity.revokeSession('${doc.id}')">Revoke</button>` : ''}
                    </div>
                `;
            });
            list.innerHTML = html;
        });
    },

    async revokeSession(id) {
        await this.db.collection(`users/${this.uid}/sessions`).doc(id).delete();
        NexraApp.showToast('Session revoked remotely.', 'success');
    },

    async revokeAllSessions() {
        if(!confirm('Sign out of all other devices?')) return;
        const snap = await this.db.collection(`users/${this.uid}/sessions`).get();
        const currentId = localStorage.getItem('nx_session');
        const batch = this.db.batch();
        snap.forEach(doc => {
            if(doc.id !== currentId) batch.delete(doc.ref);
        });
        await batch.commit();
        NexraApp.showToast('All other sessions terminated.', 'success');
    },

    // Danger Zone
    openDeleteModal() {
        document.getElementById('del-modal').style.display = 'flex';
    },

    async executeAccountWipe() {
        const confirmStr = document.getElementById('del-confirm-input').value;
        if (confirmStr !== 'DELETE') return NexraApp.showToast('Type DELETE to confirm.', 'error');

        try {
            // 1. Delete Firestore user document (triggers backend cleanup rules)
            await this.db.collection('users').doc(this.uid).delete();
            // 2. Delete Auth User
            await this.auth.currentUser.delete();
            
            NexraApp.showToast('Account permanently erased.', 'success');
            setTimeout(() => window.location.href = '/', 2000);
        } catch(e) {
            console.error(e);
            NexraApp.showToast('Deletion failed. You may need to log out and log back in to verify identity first.', 'error');
            document.getElementById('del-modal').style.display = 'none';
        }
    }
};
