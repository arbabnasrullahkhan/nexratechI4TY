/* js/troubleshoot.js */
window.NexraTroubleshoot = {
    auth: null,
    
    // Knowledge Base Tree
    kb: {
        'auth': {
            title: 'Authentication & Sign-In',
            content: 'Are you experiencing issues with Firebase Auth (e.g., Domain not authorized, API key expired)?',
            actions: [
                { label: 'Domain Error (auth/unauthorized-domain)', next: 'auth_domain' },
                { label: 'Invalid API Key', next: 'auth_key' }
            ]
        },
        'auth_domain': {
            title: 'Unauthorized Domain',
            content: 'Firebase blocks requests from domains not explicitly added to the whitelist. Please go to Firebase Console -> Authentication -> Settings -> Authorized Domains and add your domain.',
            actions: [
                { label: 'Run Auth Ping Test', action: 'pingAuth' },
                { label: 'Go Back', next: 'auth' }
            ]
        },
        'auth_key': {
            title: 'Invalid API Key',
            content: 'Your firebaseconfig.js contains an invalid or expired Web API Key. Verify the config matches your Firebase Console -> Project Settings -> General.',
            actions: [
                { label: 'Go Back', next: 'auth' }
            ]
        },
        'db': {
            title: 'Firestore Database Rules',
            content: 'Are users seeing "Missing or Insufficient Permissions" errors?',
            actions: [
                { label: 'Yes, permission denied', next: 'db_rules' },
                { label: 'No, data is just not loading', next: 'db_empty' }
            ]
        },
        'db_rules': {
            title: 'Security Rules Blocked',
            content: 'Your Firestore Security Rules are blocking the request. If you are in development, ensure rules are set to allow read/write for testing. For production, ensure authenticated routes are respected.',
            actions: [
                { label: 'View Documentation', action: 'goDocs' },
                { label: 'Go Back', next: 'db' }
            ]
        },
        'db_empty': {
            title: 'Empty Collection',
            content: 'The database query succeeded, but returned no documents. Check if the collection name matches your query exactly (case-sensitive).',
            actions: [
                { label: 'Go Back', next: 'db' }
            ]
        },
        'deploy': {
            title: 'Deployment / Hosting',
            content: 'Having trouble deploying your SaaS to Vercel, Netlify, or Firebase Hosting?',
            actions: [
                { label: 'Blank Screen on Build', next: 'deploy_blank' },
                { label: 'Routing 404 Errors', next: 'deploy_404' }
            ]
        },
        'deploy_blank': {
            title: 'Blank Screen',
            content: 'A blank screen usually means a JavaScript syntax error or missing firebaseconfig.js. Check the browser console (F12) for detailed error traces.',
            actions: [
                { label: 'Go Back', next: 'deploy' }
            ]
        },
        'deploy_404': {
            title: '404 on Page Refresh',
            content: 'For Single Page Applications (SPAs) or dynamic routing, you must configure your hosting provider to rewrite all traffic to index.html (or setup proper static routes).',
            actions: [
                { label: 'Go Back', next: 'deploy' }
            ]
        },
        'api': {
            title: 'API Integration',
            content: 'Are Nexra Ecosystem APIs (AI, Payments) failing to execute?',
            actions: [
                { label: 'CORS Error', next: 'api_cors' },
                { label: 'Rate Limit / 429', next: 'api_rate' }
            ]
        },
        'api_cors': {
            title: 'CORS Blocked',
            content: 'Cross-Origin Resource Sharing (CORS) is blocking the request. Ensure you are calling the API from an authorized domain or running a local proxy for development.',
            actions: [
                { label: 'Go Back', next: 'api' }
            ]
        },
        'api_rate': {
            title: 'Rate Limit Exceeded',
            content: 'You have hit the API rate limit for your current tier. Please check the VIP portal to upgrade your API limits.',
            actions: [
                { label: 'View Upgrade Options', action: 'goVIP' },
                { label: 'Go Back', next: 'api' }
            ]
        }
    },

    init() {
        this.auth = firebase.auth();
    },

    loadCategory(key, element) {
        // Update Sidebar
        document.querySelectorAll('.ts-cat').forEach(el => el.classList.remove('active'));
        if (element) {
            element.classList.add('active');
        }

        // Hide Welcome, Show Dynamic
        document.getElementById('wiz-welcome').style.display = 'none';
        document.getElementById('wiz-terminal').style.display = 'none';
        document.getElementById('wiz-dynamic').style.display = 'block';

        this.renderStep(key, key); // Path is just the key initially
    },

    renderStep(key, pathStr) {
        const step = this.kb[key];
        if (!step) return;

        document.getElementById('wiz-path').innerText = pathStr.toUpperCase().replace(/_/g, ' > ');
        document.getElementById('wiz-title').innerText = step.title;
        document.getElementById('wiz-content').innerHTML = step.content;

        const actionContainer = document.getElementById('wiz-actions');
        let html = '';

        if (step.actions && step.actions.length > 0) {
            step.actions.forEach((act, index) => {
                const btnClass = index === 0 ? 'btn-wiz-primary' : 'btn-wiz-secondary';
                if (act.next) {
                    html += `<button class="btn-wiz ${btnClass}" onclick="NexraTroubleshoot.renderStep('${act.next}', '${pathStr}_${act.next}')">${act.label}</button>`;
                } else if (act.action) {
                    html += `<button class="btn-wiz ${btnClass}" onclick="NexraTroubleshoot.executeAction('${act.action}')">${act.label}</button>`;
                }
            });
        }

        actionContainer.innerHTML = html;
    },

    executeAction(actionName) {
        if (actionName === 'goDocs') {
            window.location.href = '/system/developer-portal.html';
        } else if (actionName === 'goVIP') {
            window.location.href = '/vip/services.html';
        } else if (actionName === 'pingAuth') {
            this.runTerminalSim();
        }
    },

    async runTerminalSim() {
        const term = document.getElementById('wiz-terminal');
        const out = document.getElementById('term-output');
        
        term.style.display = 'block';
        out.innerHTML = '<span class="term-line">> Initializing Firebase Auth diagnostic...</span>';
        
        const delay = ms => new Promise(res => setTimeout(res, ms));

        await delay(800);
        out.innerHTML += '<span class="term-line">> Fetching current origin... ' + window.location.origin + '</span>';
        
        await delay(1200);
        try {
            // Check auth state directly to see if firebase app is alive
            if (this.auth.app) {
                out.innerHTML += '<span class="term-line term-success">> SUCCESS: Firebase App initialized.</span>';
                await delay(600);
                
                const user = this.auth.currentUser;
                if(user) {
                    out.innerHTML += `<span class="term-line term-success">> VALID: Current User [${user.uid}]</span>`;
                } else {
                    out.innerHTML += `<span class="term-line term-error">> WARNING: No user currently authenticated.</span>`;
                }
            } else {
                throw new Error("No App");
            }
        } catch (e) {
            out.innerHTML += '<span class="term-line term-error">> FAIL: Firebase Auth is unreachable. Check config.</span>';
        }

        out.innerHTML += '<span class="term-line">> Diagnostic sweep complete.</span>';
    }
};
