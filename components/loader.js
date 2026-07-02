/**
 * ==========================================================================
 * NEXRA TECH PK — COMPONENT LOADER ENGINE
 * ==========================================================================
 * Fetches HTML fragment files and injects them into named mount points.
 * After all components are loaded, refreshes branding and subscribes
 * to Firebase live branding updates.
 * 
 * Usage in any page:
 *   NexraComponents.load([
 *     { file: '/components/header.html', mount: '#header-mount' },
 *     { file: '/components/footer.html', mount: '#footer-mount' },
 *   ]).then(() => { PageEngine.init(); });
 */

window.NexraComponents = {

    /**
     * Load and inject multiple components in parallel
     * @param {Array<{file: string, mount: string}>} components
     * @returns {Promise<void>}
     */
    load: async function(components) {
        const promises = components.map(({ file, mount }) =>
            this._loadOne(file, mount)
        );
        await Promise.allSettled(promises);

        // After all fragments injected, sync branding assets
        if (window.NexraBrand) {
            window.NexraBrand.refreshDOMAssets();
        }

        // Restore saved theme from localStorage
        const savedTheme = localStorage.getItem('nexra_theme');
        if (savedTheme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
            document.querySelectorAll('.theme-icon').forEach(i => {
                i.className = 'fa-solid fa-sun theme-icon';
            });
            const metaTheme = document.getElementById('meta-theme-color');
            if (metaTheme) metaTheme.content = '#020202';
        }

        // Update cart count badge
        if (window.NexraApp) {
            window.NexraApp.updateCartBadge();
            // Subscribe to live Firestore branding
            window.NexraApp.subscribeToLiveBranding();
        }

        // Mark active dock/nav item
        this._setActiveNav();

        console.log('[NexraComponents] All components mounted.');
    },

    /**
     * Fetch a single component and inject into mount element
     */
    _loadOne: async function(file, mountSelector) {
        try {
            const res = await fetch(file);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
            const html = await res.text();
            const el = document.querySelector(mountSelector);
            if (!el) {
                console.warn(`[NexraComponents] Mount not found: ${mountSelector}`);
                return;
            }
            el.innerHTML = html;
        } catch (err) {
            console.error(`[NexraComponents] Failed to load ${file}:`, err);
        }
    },

    /**
     * Mark active navigation item based on current URL
     */
    _setActiveNav: function() {
        const path = window.location.pathname;
        // Mark dock items active
        document.querySelectorAll('.dock-item[data-page]').forEach(item => {
            const page = item.getAttribute('data-page');
            if (path.includes(page)) {
                item.classList.add('active');
            }
        });
        // Mark desktop nav active
        document.querySelectorAll('.d-nav-item[data-page]').forEach(item => {
            const page = item.getAttribute('data-page');
            if (path.includes(page)) {
                item.classList.add('active');
            }
        });
    }
};
