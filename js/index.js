/**
 * ==========================================================================
 * NEXRA TECH PK - MASTER SPA CORE ENGINE
 * ==========================================================================
 */

window.NexraSPA = {
    // Current Active Route Key
    currentRoute: null,
    
    // Toast stacking system
    toastStack: [],

    /**
     * Initialize SPA Bootstrapping
     */
    init: function() {
        console.log("[Nexra SPA] Booting Engine...");
        
        // 1. Hook Network Events
        this.setupNetworkListeners();
        
        // 2. Set up live branding subscription (Firestore)
        this.subscribeToBranding();

        // 3. Centralized link interception (for client-side routing)
        this.interceptGlobalClicks();

        // 4. Listen to browser history navigation (back/forward keys)
        window.addEventListener('popstate', () => {
            this.routeFromURL();
        });
    },

    /**
     * Live listener to settings/branding document in Firestore
     */
    subscribeToBranding: function() {
        if (!window.db) {
            console.warn("[Nexra Core] Firestore not initialized. Using default local branding.");
            return;
        }

        window.db.collection('settings').doc('branding').onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                console.log("[Nexra Core] Live branding updated received:", data);
                
                // Set active edition
                if (data.activeEdition) {
                    window.NexraBrand.switchEdition(data.activeEdition);
                }
                
                // Festival Overrides
                if (data.festivalMode) {
                    window.NexraBrand.festivalMode = {
                        active: !!data.festivalMode.active,
                        priorityLogo: data.festivalMode.priorityLogo || null,
                        priorityFavicon: data.festivalMode.priorityFavicon || null
                    };
                    window.NexraBrand.refreshDOMAssets();
                }
            }
        }, (error) => {
            console.warn("[Nexra Core] Live branding subscription offline, falling back to cache.", error);
        });
    },

    /**
     * Intercept clicks on links with data-nav attributes or standard routing hrefs
     */
    interceptGlobalClicks: function() {
        document.addEventListener('click', (e) => {
            // Find closest anchor tag
            const anchor = e.target.closest('a');
            if (!anchor) return;
            
            // Check if link is intended for local SPA routing
            const href = anchor.getAttribute('href');
            const routeKey = anchor.getAttribute('data-nav');
            
            if (routeKey) {
                e.preventDefault();
                this.navTo(routeKey);
            } else if (href && href.startsWith('/')) {
                // If it's a relative path starting with /, intercept and map back to key
                e.preventDefault();
                const matchedKey = Object.keys(window.NexraRoutes.registry).find(
                    key => window.NexraRoutes.registry[key] === href
                );
                if (matchedKey) {
                    this.navTo(matchedKey);
                } else {
                    // Raw path fallback loading
                    this.loadRawPath(href);
                }
            }
        });
    },

    /**
     * Resolve route dynamically based on current query string
     */
    routeFromURL: function() {
        const params = new URLSearchParams(window.location.search);
        let routeKey = params.get('view') || 'home';
        
        // Handle direct subfolder path URL mappings if accessed
        const path = window.location.pathname;
        const segments = path.split('/').filter(Boolean);
        if (segments.length > 0 && segments[0] !== 'index.html') {
            routeKey = segments[0];
        }

        console.log(`[Nexra SPA] Routing URL to key: ${routeKey}`);
        this.navTo(routeKey, window.location.search, false);
    },

    /**
     * Load page dynamically without triggering browser reload
     * @param {string} routeKey - Route key name
     * @param {string} queryString - Optional url query parameters
     * @param {boolean} updateHistory - Whether to pushState in browser history
     */
    navTo: async function(routeKey, queryString = '', updateHistory = true) {
        if (this.currentRoute === routeKey && !queryString) return; // Already here
        
        console.log(`[Nexra SPA] Navigating to: ${routeKey}`);
        const loader = document.getElementById('spa-top-loader');
        const viewport = document.getElementById('spa-main');
        
        // Show progress indicator
        if(loader) {
            loader.style.opacity = '1';
            loader.style.width = '20%';
        }
        
        // Add fade transition class
        if(viewport) viewport.classList.add('page-transitioning');
        
        try {
            // Resolve URL path
            const pagePath = window.NexraRoutes.registry[routeKey] || window.NexraRoutes.registry['404'];
            const fetchUrl = `${window.location.origin}${pagePath}`;
            
            if(loader) loader.style.width = '50%';
            
            // Fetch target page
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            
            if(loader) loader.style.width = '75%';
            
            const htmlText = await response.text();
            
            // Parse fetched template
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            // Map components dynamically to avoid layout shifting
            this.mapComponent(doc, 'header', 'global-header');
            this.mapComponent(doc, 'aside', 'offcanvas-navigation');
            this.mapComponent(doc, 'nav', 'mobile-bottom-dock');
            this.mapComponent(doc, 'footer', 'global-footer');
            this.mapComponent(doc, 'main', 'spa-main');
            
            // Hot swap Style sheet block
            this.injectStyle(doc);
            
            // Hot swap Dynamic script block
            this.injectScript(doc);
            
            // Update browser state
            if (updateHistory) {
                const finalQuery = queryString || `?view=${routeKey}`;
                window.history.pushState({ routeKey }, '', finalQuery);
            }
            
            this.currentRoute = routeKey;
            
            // Update meta-tags and title dynamically if defined in the child page
            const pageTitle = doc.querySelector('title');
            if (pageTitle) {
                document.title = pageTitle.innerText;
            }
            
            // Refresh branding attributes on newly loaded templates
            window.NexraBrand.refreshDOMAssets();
            
            if(loader) loader.style.width = '100%';
            
        } catch (error) {
            console.error(`[Nexra SPA] Navigation to ${routeKey} failed:`, error);
            this.showToast("Navigation Failed", `Could not load standard page asset for ${routeKey.toUpperCase()}`, "danger");
            
            // Fallback load 404
            if (routeKey !== '404') {
                this.navTo('404');
            }
        } finally {
            // Transition out
            setTimeout(() => {
                if(viewport) viewport.classList.remove('page-transitioning');
                if(loader) {
                    loader.style.opacity = '0';
                    setTimeout(() => loader.style.width = '0%', 400);
                }
            }, 250);
        }
    },

    /**
     * Map visual components from child to shell DOM
     */
    mapComponent: function(sourceDoc, elementTag, mountId) {
        const sourceElement = sourceDoc.querySelector(`#${mountId}`) || sourceDoc.querySelector(elementTag);
        const targetElement = document.getElementById(mountId);
        
        if (targetElement) {
            if (sourceElement) {
                targetElement.innerHTML = sourceElement.innerHTML;
                targetElement.className = sourceElement.className;
                targetElement.style.display = sourceElement.style.display || '';
            } else {
                targetElement.innerHTML = '';
                targetElement.style.display = 'none'; // Hide if not used in child template
            }
        }
    },

    /**
     * Extract and inject styling block
     */
    injectStyle: function(sourceDoc) {
        const activeStyle = document.getElementById('active-page-style');
        if(activeStyle) activeStyle.remove();
        
        const childStyle = sourceDoc.querySelector('style');
        if (childStyle) {
            const newStyle = document.createElement('style');
            newStyle.id = 'active-page-style';
            newStyle.textContent = childStyle.textContent;
            document.head.appendChild(newStyle);
        }
    },

    /**
     * Extract and execute page-specific JavaScript code block
     */
    injectScript: function(sourceDoc) {
        const activeScript = document.getElementById('active-page-script');
        if(activeScript) activeScript.remove();
        
        const childScript = sourceDoc.querySelector('script:not([src])'); // Get page script block (exclude links)
        if (childScript) {
            const newScript = document.createElement('script');
            newScript.id = 'active-page-script';
            newScript.textContent = `
                (function() {
                    try {
                        ${childScript.textContent}
                    } catch(err) {
                        console.error("[Nexra Sandbox] Runtime Script Error in ${this.currentRoute}:", err);
                    }
                })();
            `;
            document.body.appendChild(newScript);
        }
        
        // Execute external script tags loaded by child page if any
        const srcScripts = sourceDoc.querySelectorAll('script[src]');
        srcScripts.forEach(script => {
            const src = script.getAttribute('src');
            if (src && !src.includes('firebaseconfig.js')) {
                const extScript = document.createElement('script');
                extScript.src = src;
                extScript.defer = true;
                document.body.appendChild(extScript);
            }
        });
    },

    /**
     * Live alert notification system
     */
    showToast: function(title, message, type = 'info', duration = 5000) {
        const stack = document.getElementById('notification-toast-stack');
        if (!stack) return;
        
        const toast = document.createElement('div');
        toast.className = `nx-toast toast-${type}`;
        
        // Setup icons
        let iconHtml = '<i class="fa-solid fa-circle-info"></i>';
        if (type === 'success') iconHtml = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i>';
        if (type === 'danger') iconHtml = '<i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i>';
        if (type === 'warning') iconHtml = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i>';
        
        toast.innerHTML = `
            <div class="nx-toast-icon">${iconHtml}</div>
            <div class="nx-toast-body">
                <div class="nx-toast-title">${title}</div>
                <div class="nx-toast-msg">${message}</div>
            </div>
            <button class="nx-toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
        `;
        
        stack.appendChild(toast);
        
        // Force reflow
        toast.offsetHeight;
        
        // Display toast
        toast.classList.add('show');
        
        // Remove timer
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },

    /**
     * Network Event Checkers
     */
    setupNetworkListeners: function() {
        const showOfflineOverlay = () => {
            const overlay = document.getElementById('nx-system-overlay');
            if (overlay) {
                document.getElementById('overlay-title').innerText = "Ecosystem Offline";
                document.getElementById('overlay-desc').innerText = "You have disconnected from the internet. Reconnecting to local cash parameters...";
                document.getElementById('overlay-icon').innerHTML = `<i class="fa-solid fa-wifi-slash"></i>`;
                overlay.style.display = 'flex';
                setTimeout(() => overlay.style.opacity = '1', 50);
            }
        };

        const hideOfflineOverlay = () => {
            const overlay = document.getElementById('nx-system-overlay');
            if (overlay && overlay.style.opacity === '1') {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.style.display = 'none', 500);
                this.showToast("Connection Restored", "Ecosystem verified, live parameters unlocked.", "success");
            }
        };

        window.addEventListener('offline', showOfflineOverlay);
        window.addEventListener('online', hideOfflineOverlay);
        
        // Initial state check
        if (!navigator.onLine) showOfflineOverlay();
    }
};
