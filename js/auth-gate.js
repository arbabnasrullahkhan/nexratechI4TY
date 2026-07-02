/* js/auth-gate.js */
window.NexraAuth = {
    db: null,
    auth: null,
    redirectUrl: null,
    isProcessing: false,

    init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        // Capture redirect intent from URL
        const params = new URLSearchParams(window.location.search);
        this.redirectUrl = params.get('redirect') || '/user/profile-dashboard.html';

        // Pre-auth Guard: Check if already logged in
        this.auth.onAuthStateChanged(user => {
            if (user && !this.isProcessing) {
                window.location.replace(this.redirectUrl);
            } else {
                // Not logged in (or we are in the middle of processing a new signup)
                setTimeout(() => {
                    const guard = document.getElementById('ag-guard');
                    if(guard) {
                        guard.style.opacity = '0';
                        setTimeout(() => guard.style.display = 'none', 400);
                    }
                    document.getElementById('ag-main').removeAttribute('hidden');
                    this.adjustWrapperHeight('login');
                }, 500);
            }
        });
    },

    // --- 3D UI Logic ---
    flipTo(face) {
        const flipper = document.getElementById('ag-flipper');
        flipper.className = 'ag-card-flipper'; // Reset
        
        if (face === 'register') {
            flipper.classList.add('show-register');
        } else if (face === 'forgot') {
            flipper.classList.add('show-forgot');
        }
        this.adjustWrapperHeight(face);
    },

    adjustWrapperHeight(face) {
        // Obsolete in 2D layout, handled natively by CSS position:relative
    },

    togglePwd(inputId, btn) {
        const input = document.getElementById(inputId);
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    },

    checkStrength(pwd) {
        const fill = document.getElementById('str-fill');
        const text = document.getElementById('str-text');
        let strength = 0;
        
        if (pwd.length >= 8) strength++;
        if (/[A-Z]/.test(pwd)) strength++;
        if (/[0-9]/.test(pwd)) strength++;
        if (/[^A-Za-z0-9]/.test(pwd)) strength++;

        if (pwd.length === 0) {
            fill.style.width = '0%';
            text.innerText = 'Password Strength';
        } else if (strength <= 1) {
            fill.style.width = '25%';
            fill.style.background = 'var(--danger)';
            text.innerText = 'Weak';
            text.style.color = 'var(--danger)';
        } else if (strength === 2) {
            fill.style.width = '50%';
            fill.style.background = '#f59e0b';
            text.innerText = 'Fair';
            text.style.color = '#f59e0b';
        } else if (strength === 3) {
            fill.style.width = '75%';
            fill.style.background = '#3b82f6';
            text.innerText = 'Good';
            text.style.color = '#3b82f6';
        } else {
            fill.style.width = '100%';
            fill.style.background = '#10b981';
            text.innerText = 'Strong';
            text.style.color = '#10b981';
        }
    },

    setLoading(btnId, isLoading, originalHtml) {
        const btn = document.getElementById(btnId);
        if(!btn) return;
        if (isLoading) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    // --- Authentication Core ---
    
    // Create new user document securely in Firestore
    async buildUserDocument(user, nameStr) {
        const userRef = this.db.collection('users').doc(user.uid);
        const docSnap = await userRef.get();
        
        if (!docSnap.exists) {
            const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            await userRef.set({
                uid: user.uid,
                email: user.email,
                displayName: nameStr || user.displayName || 'Nexra User',
                avatarUrl: user.photoURL || '',
                role: 'user',
                tier: 'Free',
                nexraCoins: 0,
                referralCode: refCode,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    },

    async signInGoogle() {
        this.isProcessing = true;
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            const result = await this.auth.signInWithPopup(provider);
            await this.buildUserDocument(result.user, result.user.displayName);
            window.location.replace(this.redirectUrl);
        } catch (error) {
            this.handleAuthError(error);
            this.isProcessing = false;
        }
    },

    async registerEmail(e) {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const pwd = document.getElementById('reg-pwd').value;
        
        if(pwd.length < 6) {
            return window.NexraApp ? NexraApp.showToast('Password must be at least 6 characters', 'fa-solid fa-triangle-exclamation', 'error') : alert('Password must be at least 6 characters');
        }

        this.isProcessing = true;
        this.setLoading('btn-reg', true);

        try {
            const result = await this.auth.createUserWithEmailAndPassword(email, pwd);
            await result.user.updateProfile({ displayName: name });
            await this.buildUserDocument(result.user, name);
            window.location.replace(this.redirectUrl);
        } catch (error) {
            this.handleAuthError(error);
            this.setLoading('btn-reg', false, 'Create Account <i class="fa-solid fa-user-plus"></i>');
            this.isProcessing = false;
        }
    },

    async signInEmail(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pwd = document.getElementById('login-pwd').value;

        this.isProcessing = true;
        this.setLoading('btn-login', true);

        try {
            await this.auth.signInWithEmailAndPassword(email, pwd);
            window.location.replace(this.redirectUrl);
        } catch (error) {
            this.handleAuthError(error);
            this.setLoading('btn-login', false, 'Log In <i class="fa-solid fa-arrow-right"></i>');
            this.isProcessing = false;
        }
    },

    async resetPassword(e) {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        
        this.setLoading('btn-forgot', true);
        try {
            await this.auth.sendPasswordResetEmail(email);
            NexraApp.showToast('Password reset link sent to your email.', 'fa-solid fa-check', 'success');
            setTimeout(() => this.flipTo('login'), 2000);
        } catch (error) {
            this.handleAuthError(error);
        } finally {
            this.setLoading('btn-forgot', false, 'Send Reset Link <i class="fa-solid fa-paper-plane"></i>');
        }
    },

    handleAuthError(error) {
        console.error("Auth Error:", error.code, error.message);
        let msg = "An authentication error occurred.";
        switch (error.code) {
            case 'auth/user-not-found':
                msg = "No account found with this email.";
                break;
            case 'auth/wrong-password':
                msg = "Incorrect password. Please try again.";
                break;
            case 'auth/email-already-in-use':
                msg = "This email is already registered. Try logging in.";
                break;
            case 'auth/weak-password':
                msg = "Password is too weak.";
                break;
            case 'auth/invalid-email':
                msg = "Please enter a valid email address.";
                break;
            case 'auth/popup-closed-by-user':
                msg = "Google sign-in was cancelled.";
                break;
        }
        if (window.NexraApp && NexraApp.showToast) {
            NexraApp.showToast(msg, 'fa-solid fa-circle-exclamation', 'error');
        } else {
            alert(msg);
        }
    }
};
