/**
 * ==========================================================================
 * NEXRA TECH PK — GLOBAL APP ENGINE (app.js)
 * ==========================================================================
 * Single source of truth for: Cart, Theme, Toast, Navigation, Sidebar.
 * Loaded on every page. Works alongside firebaseconfig.js.
 */

window.NexraApp = {

    cart: JSON.parse(localStorage.getItem('nexra_cart') || '[]'),

    /* ------------------------------------------------------------------
       NAVIGATION
       ------------------------------------------------------------------ */
    navTo: function(page, id) {
        const routes = {
            'home':           '/discovery/home.html',
            'shop':           '/shop/shop.html',
            'product-detail': '/shop/product-detail.html',
            'checkout':       '/shop/checkout.html',
            'freebies':       '/freebies/freebies.html',
            'freebie-detail': '/freebies/freebie-detail.html',
            'blog':           '/academy/blog.html',
            'blog-detail':    '/academy/blog-detail.html',
            'profile':        '/user/profile-dashboard.html',
            'support':        '/support/support-hub.html',
        };

        if (page === 'product-detail' && id) {
            window.location.href = routes['product-detail'] + '?id=' + id;
        } else if (page === 'blog-detail' && id) {
            window.location.href = routes['blog-detail'] + '?id=' + id;
        } else if (page === 'freebie-detail' && id) {
            window.location.href = routes['freebie-detail'] + '?id=' + id;
        } else {
            window.location.href = routes[page] || '/home.html';
        }
    },

    /* ------------------------------------------------------------------
       THEME TOGGLE
       ------------------------------------------------------------------ */
    toggleTheme: function() {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        if (newTheme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
        localStorage.setItem('nexra_theme', newTheme);
        const metaEl = document.getElementById('meta-theme-color');
        if (metaEl) metaEl.content = newTheme === 'dark' ? '#020202' : '#f8fafc';
        document.querySelectorAll('.theme-icon').forEach(i => {
            i.className = newTheme === 'dark' ? 'fa-solid fa-sun theme-icon' : 'fa-solid fa-moon theme-icon';
        });
    },

    /* ------------------------------------------------------------------
       CUSTOM THEME PICKER (Long Press)
       ------------------------------------------------------------------ */
    openThemeCustomizer: function() {
        let modal = document.getElementById('nx-theme-customizer-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'nx-theme-customizer-modal';
            modal.className = 'nx-customizer-overlay active';
            modal.innerHTML = `
                <div class="nx-customizer-box">
                    <button class="nx-customizer-close" onclick="NexraApp.closeThemeCustomizer()"><i class="fa-solid fa-xmark"></i></button>
                    <h3 style="font-family:'Space Grotesk'; font-size:18px; margin-bottom:8px;">Custom Theme Engine</h3>
                    <p style="font-size:12px; color:var(--text-200); margin-bottom:20px;">Personalize your Nexra Tech PK experience.</p>
                    
                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:8px; color:var(--text-300);">Primary Brand Color</label>
                        <input type="color" id="nx-color-brand" value="#FF4A17" style="width:100%; height:40px; border:none; border-radius:8px; cursor:pointer;">
                    </div>
                    
                    <div style="margin-bottom:24px;">
                        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:8px; color:var(--text-300);">Main Text Color</label>
                        <input type="color" id="nx-color-text" value="#0f172a" style="width:100%; height:40px; border:none; border-radius:8px; cursor:pointer;">
                    </div>
                    
                    <button class="btn btn-primary" style="width:100%;" onclick="NexraApp.applyCustomTheme()">Apply Custom Theme</button>
                    <button class="btn btn-outline" style="width:100%; margin-top:8px;" onclick="NexraApp.resetCustomTheme()">Reset to Default</button>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.classList.add('active');
        }
    },

    closeThemeCustomizer: function() {
        const modal = document.getElementById('nx-theme-customizer-modal');
        if (modal) modal.classList.remove('active');
    },

    applyCustomTheme: function() {
        const brand = document.getElementById('nx-color-brand').value;
        const text = document.getElementById('nx-color-text').value;
        document.documentElement.style.setProperty('--brand-main', brand);
        document.documentElement.style.setProperty('--text-100', text);
        // Set glow to 25% opacity of brand color roughly
        document.documentElement.style.setProperty('--brand-glow', brand + '40'); 
        
        localStorage.setItem('nexra_custom_brand', brand);
        localStorage.setItem('nexra_custom_text', text);
        this.closeThemeCustomizer();
        this.showToast('Custom theme applied successfully!', 'fa-solid fa-palette', 'success');
    },

    resetCustomTheme: function() {
        document.documentElement.style.removeProperty('--brand-main');
        document.documentElement.style.removeProperty('--text-100');
        document.documentElement.style.removeProperty('--brand-glow');
        localStorage.removeItem('nexra_custom_brand');
        localStorage.removeItem('nexra_custom_text');
        this.closeThemeCustomizer();
        this.showToast('Theme reset to default.', 'fa-solid fa-rotate-left', 'default');
    },

    /* ------------------------------------------------------------------
       SIDEBAR TOGGLE
       ------------------------------------------------------------------ */
    toggleSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active');
    },

    closeSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    },

    /* ------------------------------------------------------------------
       CART SYSTEM
       ------------------------------------------------------------------ */
    toggleCart: function() {
        const drawer = document.getElementById('cart-drawer');
        const overlay = document.getElementById('cart-overlay');
        if (drawer) drawer.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active');
        this.renderCartItems();
    },

    closeCart: function() {
        document.getElementById('cart-drawer')?.classList.remove('active');
        document.getElementById('cart-overlay')?.classList.remove('active');
    },

    addToCart: function(e, id, title, price, image) {
        if (e) e.stopPropagation();
        this.cart.push({ id, title, price: Number(price), image });
        localStorage.setItem('nexra_cart', JSON.stringify(this.cart));
        this.updateCartBadge();
        this.showToast(title + ' added to cart!', 'fa-solid fa-cart-arrow-down', 'success');
    },

    removeFromCart: function(index) {
        this.cart.splice(index, 1);
        localStorage.setItem('nexra_cart', JSON.stringify(this.cart));
        this.renderCartItems();
        this.updateCartBadge();
    },

    clearCart: function() {
        this.cart = [];
        localStorage.setItem('nexra_cart', JSON.stringify(this.cart));
        this.renderCartItems();
        this.updateCartBadge();
    },

    updateCartBadge: function() {
        document.querySelectorAll('.cart-count-badge').forEach(el => {
            el.innerText = this.cart.length;
            el.style.display = this.cart.length > 0 ? 'flex' : 'none';
        });
    },

    renderCartItems: function() {
        const container = document.getElementById('cart-items-container');
        const totalEl = document.getElementById('cart-drawer-total');
        if (!container) return;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:50px 20px; color:var(--text-300);">
                    <i class="fa-solid fa-basket-shopping" style="font-size:48px; margin-bottom:16px; opacity:0.3;"></i>
                    <h4 style="font-family:'Space Grotesk'; font-size:16px; margin-bottom:8px;">Cart is Empty</h4>
                    <p style="font-size:12px;">Explore the marketplace to add items.</p>
                </div>`;
            if (totalEl) totalEl.innerText = 'Rs. 0';
            return;
        }

        let subtotal = 0;
        container.innerHTML = this.cart.map((item, index) => {
            subtotal += item.price;
            return `
            <div class="cart-item">
                <img src="${item.image}" class="cart-item-img"/>
                <div class="cart-item-info">
                    <div class="cart-item-title">${item.title}</div>
                    <div class="cart-item-price">Rs. ${item.price.toLocaleString()}</div>
                </div>
                <button class="cart-item-remove" onclick="NexraApp.removeFromCart(${index})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>`;
        }).join('');

        if (totalEl) totalEl.innerText = 'Rs. ' + subtotal.toLocaleString();
    },

    /* ------------------------------------------------------------------
       TOAST NOTIFICATIONS
       ------------------------------------------------------------------ */
    showToast: function(message, icon = 'fa-solid fa-check', type = 'default') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'premium-toast toast-' + type;
        toast.innerHTML = `<i class="${icon}"></i> ${message}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }, 3200);
    },

    /* ------------------------------------------------------------------
       FIREBASE LIVE BRANDING SUBSCRIPTION
       ------------------------------------------------------------------ */
    subscribeToLiveBranding: function() {
        if (!window.db) return;
        window.db.collection('settings').doc('branding').onSnapshot(doc => {
            if (!doc.exists) return;
            const data = doc.data();

            // Handle Festival Override mapping
            if (window.NexraBrand) {
                window.NexraBrand.festivalMode.active = data.festivalActive || false;
                window.NexraBrand.festivalMode.priorityLogo = data.festivalLogo || null;
                window.NexraBrand.festivalMode.priorityFavicon = data.festivalFavicon || null;
                window.NexraBrand.festivalMode.themeColor = data.festivalThemeColor || null;
                window.NexraBrand.festivalMode.watermark = data.festivalWatermark || null;
                window.NexraBrand.festivalMode.siteTitle = data.festivalSiteTitle || null;
                window.NexraBrand.festivalMode.banner = data.festivalBanner || null;

                if (data.activeEdition) {
                    window.NexraBrand.activeEdition = data.activeEdition;
                }
                window.NexraBrand.refreshDOMAssets();
            }

            // Update announcement strip
            const announceText = document.getElementById('nh-announce-text');
            const announceLink = document.getElementById('nh-announce-link');
            if (announceText && data.announcementText) {
                announceText.innerText = data.announcementText;
            }
            if (announceLink && data.announcementLink) {
                announceLink.href = data.announcementLink;
            }

            // Update page title
            const targetTitle = (window.NexraBrand && window.NexraBrand.festivalMode.active && window.NexraBrand.festivalMode.siteTitle) 
                ? window.NexraBrand.festivalMode.siteTitle 
                : (data.siteTitle || document.title);
            document.title = targetTitle;

        }, err => {
            console.warn('[NexraApp] Live branding offline:', err);
        });
    }
};

/* ------------------------------------------------------------------
   INIT ON DOM READY
   ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
    // Apply saved mode theme
    const savedTheme = localStorage.getItem('nexra_theme');
    if (savedTheme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        document.querySelectorAll('.theme-icon').forEach(i => {
            i.className = 'fa-solid fa-sun theme-icon';
        });
    } else {
        document.body.removeAttribute('data-theme');
    }

    // Apply custom colors if exist
    const customBrand = localStorage.getItem('nexra_custom_brand');
    const customText = localStorage.getItem('nexra_custom_text');
    if (customBrand) {
        document.documentElement.style.setProperty('--brand-main', customBrand);
        document.documentElement.style.setProperty('--brand-glow', customBrand + '40');
    }
    if (customText) {
        document.documentElement.style.setProperty('--text-100', customText);
    }

    // Update cart badge
    NexraApp.updateCartBadge();

    // Bind Long Press for Theme Button dynamically since it's injected
    let pressTimer;
    let isLongPress = false;
    
    // We bind it globally and check target, since the header is mounted asynchronously via loader.js
    document.body.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('#nx-theme-toggle-btn');
        if (btn) {
            isLongPress = false;
            pressTimer = window.setTimeout(() => {
                isLongPress = true;
                NexraApp.openThemeCustomizer();
                if (navigator.vibrate) navigator.vibrate(50);
            }, 1000); // 1 second long press to feel responsive
        }
    });

    document.body.addEventListener('mouseup', (e) => {
        const btn = e.target.closest('#nx-theme-toggle-btn');
        if (btn) {
            clearTimeout(pressTimer);
            if (!isLongPress) {
                NexraApp.toggleTheme(); // normal click
            }
        }
    });

    document.body.addEventListener('touchstart', (e) => {
        const btn = e.target.closest('#nx-theme-toggle-btn');
        if (btn) {
            isLongPress = false;
            pressTimer = window.setTimeout(() => {
                isLongPress = true;
                NexraApp.openThemeCustomizer();
                if (navigator.vibrate) navigator.vibrate(50);
            }, 1000);
        }
    }, {passive: true});

    document.body.addEventListener('touchend', (e) => {
        const btn = e.target.closest('#nx-theme-toggle-btn');
        if (btn) {
            clearTimeout(pressTimer);
            if (!isLongPress) {
                NexraApp.toggleTheme(); // normal tap
            }
        }
    });
});
