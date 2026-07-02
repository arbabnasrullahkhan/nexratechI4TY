/**
 * ==========================================================================
 * NEXRA TECH PK — HOME PAGE ENGINE (home.js)
 * ==========================================================================
 * 
 * RESPONSIBILITY:
 *   Populates every dynamic section on home.html with live Firebase data.
 *   Falls back to curated static data when Firestore is unavailable.
 *   Orchestrated by the inline boot script in home.html after all
 *   component fragments are mounted by NexraComponents.load().
 * 
 * DEPENDENCIES (must be loaded before this file):
 *   1. /firebaseconfig.js → window.db, window.auth, window.NexraBrand
 *   2. /js/app.js         → window.NexraApp (navTo, showToast, toggleCart)
 * 
 * PUBLIC API:
 *   NexraHomeEngine.init()               — Master orchestrator
 *   NexraHomeEngine.executeSearch()      — Trigger keyword search
 *   NexraHomeEngine.startVoiceSearch()   — Web Speech API voice input
 *   NexraHomeEngine.subscribeNewsletter()— Email capture to Firestore
 *   NexraHomeEngine.retryConnection()    — Offline retry handler
 *   NexraHomeEngine.filterByCategory()  — Category pill filter
 * 
 * FIRESTORE COLLECTIONS READ:
 *   settings/global        → maintenanceMode, maintenanceETA
 *   settings/branding      → activeEdition, announcementText, announcementLink,
 *                            heroWords[], heroDesc, heroVideoUrl, heroEyebrow
 *   settings/seo           → ogTitle, ogDescription, ogImage
 *   settings/announcements → text, link, bgColor, active
 *   stats/live             → activeUsers, totalDeliveries, trustScore, avgSupportMin
 *   categories/            → label, icon, sortOrder (all docs)
 *   products/              → where trending==true, orderBy sold_count DESC, limit 8
 *   freebies/              → orderBy created_at DESC, limit 3
 *   blogs/                 → where published==true, orderBy created_at DESC, limit 3
 *   testimonials/          → where approved==true, orderBy created_at DESC, limit 12
 *   faqs/                  → where published==true, orderBy sortOrder ASC, limit 8
 *   newsletters/           → checked for duplicate email on subscribe
 * 
 * ==========================================================================
 */

window.NexraHomeEngine = (function() {
    'use strict';

    /* =====================================================================
       PRIVATE STATE
       ===================================================================== */

    /** Words cycled through the kinetic headline. Overridden by Firestore. */
    let _kineticWords = ['ECOSYSTEM', 'MARKETPLACE', 'PLATFORM', 'EMPIRE', 'FUTURE'];
    let _kineticIndex = 0;
    let _kineticTimer = null;

    /** Cache to prevent duplicate Firestore listeners */
    let _statsUnsubscribe = null;
    let _brandingUnsubscribe = null;
    let _announceUnsubscribe = null;

    /** Track offline state */
    let _isOffline = !navigator.onLine;

    /* =====================================================================
       PRIVATE HELPERS
       ===================================================================== */

    /**
     * Render N skeleton placeholder cards into a container element.
     * Replaced by real content after Firestore responds.
     * @param {HTMLElement} el         — Target container
     * @param {number}      count      — Number of skeletons to render
     * @param {'product'|'blog'|'freebie'} type — Skeleton variant
     */
    function _renderSkeletons(el, count, type) {
        if (!el) return;
        let html = '';
        for (let i = 0; i < count; i++) {
            if (type === 'product') {
                html += `
                    <div class="nh-prod-skeleton" aria-hidden="true">
                        <div class="nh-prod-skeleton__img"></div>
                        <div class="nh-prod-skeleton__line" style="width:70%"></div>
                        <div class="nh-prod-skeleton__line nh-prod-skeleton__line--short"></div>
                        <div class="nh-prod-skeleton__line" style="width:40%; height:8px;"></div>
                    </div>`;
            } else if (type === 'blog') {
                html += `
                    <div class="nh-blog-skeleton" aria-hidden="true">
                        <div class="nh-blog-skeleton__img"></div>
                        <div class="nh-blog-skeleton__body">
                            <div class="nh-blog-skeleton__line" style="width:30%; height:8px;"></div>
                            <div class="nh-blog-skeleton__line" style="width:90%;"></div>
                            <div class="nh-blog-skeleton__line" style="width:70%;"></div>
                            <div class="nh-blog-skeleton__line" style="width:40%; height:8px; margin-top:20px;"></div>
                        </div>
                    </div>`;
            } else if (type === 'freebie') {
                html += `<div class="nh-freebie-skeleton" aria-hidden="true"></div>`;
            }
        }
        el.innerHTML = html;
    }

    /**
     * Render an empty state block when a section has no data.
     * @param {HTMLElement} el      — Target container
     * @param {string}      icon    — Font Awesome class (e.g. 'fa-box-open')
     * @param {string}      title   — Main empty state headline
     * @param {string}      sub     — Sub-text
     */
    function _renderEmptyState(el, icon, title, sub) {
        if (!el) return;
        el.innerHTML = `
            <div class="nh-empty-state" role="status">
                <i class="fa-solid ${icon}" aria-hidden="true"></i>
                <h4>${title}</h4>
                <p>${sub}</p>
            </div>`;
    }

    /**
     * Format a Firestore Timestamp or JS Date to a readable date string.
     * @param {*} timestamp — Firestore Timestamp | Date | string
     * @returns {string}    — e.g. "June 2025"
     */
    function _formatDate(timestamp) {
        try {
            const d = timestamp && timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return d.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
        } catch {
            return '';
        }
    }

    /**
     * Generate star rating HTML from a numeric rating (0-5).
     * @param {number} rating
     * @returns {string} HTML string of star icons
     */
    function _renderStars(rating) {
        const full  = Math.floor(rating || 5);
        const half  = (rating || 5) % 1 >= 0.5;
        let html = '';
        for (let i = 0; i < full; i++) html += '<i class="fa-solid fa-star" aria-hidden="true"></i>';
        if (half) html += '<i class="fa-solid fa-star-half-stroke" aria-hidden="true"></i>';
        return html;
    }

    /**
     * Format a PKR price with commas.
     * @param {number} price
     * @returns {string} e.g. "Rs. 1,200"
     */
    function _formatPrice(price) {
        return 'Rs. ' + (price || 0).toLocaleString('en-PK');
    }

    /**
     * Safely escape HTML to prevent XSS in injected Firestore strings.
     * @param {string} str
     * @returns {string}
     */
    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Determine badge class from a product's badgeType field.
     * @param {string} type — 'new', 'hot', 'saas', 'vip', 'sale', etc.
     * @returns {string}    — CSS class modifier
     */
    function _badgeClass(type) {
        const map = {
            'new':     'badge-new',
            'hot':     'badge-hot',
            'saas':    'badge-saas',
            'vip':     'badge-vip',
            'sale':    '',
            'premium': '',
        };
        return map[(type || '').toLowerCase()] || '';
    }

    /* =====================================================================
       MAINTENANCE MODE CHECK
       Reads Firestore settings/global.maintenanceMode before rendering
       any page content. If true, shows the maintenance overlay.
       ===================================================================== */

    /**
     * Check maintenance mode from Firestore.
     * Called first in init(). Resolves immediately so init continues.
     * @returns {Promise<boolean>} — true if maintenance mode is active
     */
    async function _checkMaintenanceMode() {
        if (!window.db) return false;
        try {
            const doc = await window.db.collection('settings').doc('global').get();
            if (!doc.exists) return false;
            const data = doc.data();
            if (data.maintenanceMode === true) {
                _showMaintenanceOverlay(data.maintenanceMessage, data.maintenanceETA);
                return true;
            }
        } catch (err) {
            console.warn('[HomeEngine] Could not check maintenance mode:', err.message);
        }
        return false;
    }

    /**
     * Show the maintenance overlay with optional custom message and ETA.
     * @param {string} [message] — Custom maintenance message from Firestore
     * @param {string} [eta]     — Expected return time string from Firestore
     */
    function _showMaintenanceOverlay(message, eta) {
        const overlay = document.getElementById('nh-maintenance-overlay');
        if (!overlay) return;
        // Remove aria-hidden so it becomes visible
        overlay.removeAttribute('aria-hidden');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (message) {
            const desc = document.getElementById('nh-maintenance-desc');
            if (desc) desc.textContent = message;
        }
        const etaEl = document.getElementById('nh-maintenance-eta');
        if (etaEl) {
            etaEl.textContent = eta
                ? 'Estimated time: ' + eta
                : 'We\'ll be back very soon — thank you for your patience!';
        }
    }

    /* =====================================================================
       LIVE STATS — onSnapshot subscription to stats/live document
       Updates trust bar numbers in real-time as orders/users are added.
       ===================================================================== */

    /**
     * Subscribe to Firestore stats/live document.
     * Updates #nh-stat-* elements whenever the document changes.
     */
    function _subscribeToLiveStats() {
        if (!window.db) return;
        // Unsubscribe if already listening
        if (_statsUnsubscribe) _statsUnsubscribe();

        _statsUnsubscribe = window.db
            .collection('stats')
            .doc('live')
            .onSnapshot(function(doc) {
                if (!doc.exists) return;
                const d = doc.data();

                const usersEl     = document.getElementById('nh-stat-users');
                const delivEl     = document.getElementById('nh-stat-deliveries');
                const trustEl     = document.getElementById('nh-stat-trust');
                const supportEl   = document.getElementById('nh-stat-support');

                if (usersEl && d.activeUsers) {
                    usersEl.textContent = d.activeUsers.toLocaleString('en-PK') + '+';
                }
                if (delivEl && d.totalDeliveries) {
                    delivEl.textContent = d.totalDeliveries.toLocaleString('en-PK') + '+';
                }
                if (trustEl && d.trustScore) {
                    trustEl.textContent = d.trustScore + '%';
                }
                if (supportEl && d.avgSupportMin) {
                    supportEl.textContent = d.avgSupportMin + ' Min';
                }
            }, function(err) {
                console.warn('[HomeEngine] Stats subscription error:', err.message);
            });
    }

    /* =====================================================================
       LIVE BRANDING SUBSCRIPTION
       Keeps logo, theme color, and edition in sync with Firestore changes.
       ===================================================================== */

    /**
     * Subscribe to Firestore settings/branding document.
     * Updates brand edition, kinetic words, and hero content live.
     */
    function _subscribeToLiveBranding() {
        if (!window.db) return;
        if (_brandingUnsubscribe) _brandingUnsubscribe();

        _brandingUnsubscribe = window.db
            .collection('settings')
            .doc('branding')
            .onSnapshot(function(doc) {
                if (!doc.exists) return;
                const d = doc.data();

                // 1. Switch brand edition (Alpha/Beta)
                if (d.activeEdition && window.NexraBrand) {
                    window.NexraBrand.switchEdition(d.activeEdition);
                }
                // 2. Update kinetic words
                if (Array.isArray(d.heroWords) && d.heroWords.length > 0) {
                    _kineticWords = d.heroWords;
                }
                // 3. Update hero eyebrow text
                if (d.heroEyebrow) {
                    const el = document.getElementById('nh-eyebrow-text');
                    if (el) el.textContent = d.heroEyebrow;
                }
                // 4. Update hero description
                if (d.heroDesc) {
                    const el = document.getElementById('nh-hero-desc');
                    if (el) el.textContent = d.heroDesc;
                }
                // 5. Update hero video source
                if (d.heroVideoUrl) {
                    const video = document.getElementById('nh-hero-video');
                    if (video && video.querySelector('source')) {
                        video.querySelector('source').src = d.heroVideoUrl;
                        video.load();
                    }
                }
                // 6. Update site title
                if (d.siteTitle) document.title = d.siteTitle;

            }, function(err) {
                console.warn('[HomeEngine] Branding subscription error:', err.message);
            });
    }

    /* =====================================================================
       SEO META TAG SYNC
       Reads settings/seo from Firestore and updates all meta tags.
       Admin can change OG title/description/image without code edits.
       ===================================================================== */

    /**
     * Apply live SEO meta tags from Firestore settings/seo.
     */
    async function _applyLiveSEO() {
        if (!window.db) return;
        try {
            const doc = await window.db.collection('settings').doc('seo').get();
            if (!doc.exists) return;
            const d = doc.data();

            const update = function(id, value) {
                const el = document.getElementById(id);
                if (el && value) el.setAttribute('content', value);
            };

            if (d.homeTitle) {
                document.title = d.homeTitle;
                const titleEl = document.getElementById('page-title');
                if (titleEl) titleEl.textContent = d.homeTitle;
            }
            update('meta-description',    d.homeDescription);
            update('og-title',            d.ogTitle || d.homeTitle);
            update('og-description',      d.ogDescription || d.homeDescription);
            update('og-image',            d.ogImage);
            update('tw-title',            d.ogTitle || d.homeTitle);
            update('tw-description',      d.ogDescription || d.homeDescription);
            update('tw-image',            d.ogImage);

            // Update canonical URL
            const canonical = document.getElementById('canonical-url');
            if (canonical && d.canonicalHome) {
                canonical.href = d.canonicalHome;
            }
        } catch (err) {
            console.warn('[HomeEngine] SEO sync failed:', err.message);
        }
    }

    /* =====================================================================
       ANNOUNCEMENT STRIP
       Reads Firestore settings/announcements and updates the strip.
       If admin marks it inactive, the strip is hidden.
       ===================================================================== */

    /**
     * Load live announcement from Firestore settings/announcements.
     * Falls back to settings/branding for legacy compatibility.
     */
    async function _loadAnnouncement() {
        // Check if user already dismissed this session
        if (sessionStorage.getItem('nexra_announce_dismissed')) {
            const strip = document.getElementById('nh-announce-strip');
            if (strip) strip.classList.add('dismissed');
            return;
        }

        // Bind dismiss button
        const closeBtn = document.getElementById('nh-announce-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                const strip = document.getElementById('nh-announce-strip');
                if (strip) strip.classList.add('dismissed');
                sessionStorage.setItem('nexra_announce_dismissed', '1');
            });
        }

        if (!window.db) return;

        // Subscribe to live announcements (onSnapshot for instant admin updates)
        if (_announceUnsubscribe) _announceUnsubscribe();
        _announceUnsubscribe = window.db
            .collection('settings')
            .doc('announcements')
            .onSnapshot(function(doc) {
                const strip = document.getElementById('nh-announce-strip');
                const textEl = document.getElementById('nh-announce-text');
                const linkEl = document.getElementById('nh-announce-link');

                if (!doc.exists) return;
                const d = doc.data();

                // If admin deactivated the announcement, hide the strip
                if (d.active === false) {
                    if (strip) strip.classList.add('dismissed');
                    return;
                }

                if (textEl && d.text)   textEl.textContent = d.text;
                if (linkEl && d.link)   linkEl.href        = d.link;
                if (strip  && d.bgColor) {
                    strip.style.background = d.bgColor;
                }
            }, function(err) {
                // Fallback: try settings/branding
                if (window.db) {
                    window.db.collection('settings').doc('branding').get()
                        .then(function(doc) {
                            if (!doc.exists) return;
                            const d = doc.data();
                            const textEl = document.getElementById('nh-announce-text');
                            const linkEl = document.getElementById('nh-announce-link');
                            if (textEl && d.announcementText) textEl.textContent = d.announcementText;
                            if (linkEl && d.announcementLink) linkEl.href        = d.announcementLink;
                        })
                        .catch(function() {
                            console.warn('[HomeEngine] Could not load announcement.');
                        });
                }
            });
    }

    /* =====================================================================
       KINETIC TYPOGRAPHY
       Cycles through hero headline words with CSS transition animation.
       ===================================================================== */

    /**
     * Start the kinetic word cycling animation on the hero headline.
     * Words are loaded from Firestore (or fallback static array).
     */
    function _startKinetic() {
        const wrap = document.getElementById('nh-kinetic-wrap');
        if (!wrap) return;

        // Clear any existing timer
        if (_kineticTimer) clearInterval(_kineticTimer);

        _kineticTimer = setInterval(function() {
            _kineticIndex = (_kineticIndex + 1) % _kineticWords.length;
            const nextWord = _esc(_kineticWords[_kineticIndex]);

            // Create new word element
            const newEl = document.createElement('span');
            newEl.className = 'nh-kinetic-word';
            newEl.textContent = _kineticWords[_kineticIndex];

            // Get current active element
            const currentEl = wrap.querySelector('.nh-kinetic-word.active');
            if (currentEl) {
                // Exit animation on current
                currentEl.classList.remove('active');
                currentEl.classList.add('exit');
                // Remove after transition completes
                setTimeout(function() {
                    if (currentEl.parentNode) currentEl.parentNode.removeChild(currentEl);
                }, 500);
            }

            // Append and activate new element
            wrap.appendChild(newEl);
            // Force reflow before adding active class for animation to play
            void newEl.offsetWidth;
            newEl.classList.add('active');

        }, 2800); // Rotate every 2.8 seconds
    }

    /* =====================================================================
       SCROLL REVEAL (IntersectionObserver)
       Adds .nh-revealed class to .nh-reveal elements on viewport entry.
       ===================================================================== */

    /**
     * Initialize IntersectionObserver for scroll-triggered section reveals.
     * All elements with class .nh-reveal fade up into view once.
     */
    function _initScrollReveal() {
        if (!('IntersectionObserver' in window)) {
            // Fallback: immediately reveal all for older browsers
            document.querySelectorAll('.nh-reveal').forEach(function(el) {
                el.classList.add('nh-revealed');
            });
            return;
        }

        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('nh-revealed');
                    // Unobserve after triggering — animation plays only once
                    observer.unobserve(entry.target);
                }
            });
        }, {
            rootMargin: '0px 0px -80px 0px',  // Trigger 80px before element enters viewport
            threshold: 0.08                     // 8% of element must be visible
        });

        document.querySelectorAll('.nh-reveal').forEach(function(el) {
            observer.observe(el);
        });
    }

    /* =====================================================================
       HERO VIDEO — onload state
       ===================================================================== */

    /**
     * Once the hero video can play, add .loaded class for fade-in.
     */
    function _initHeroVideo() {
        const video = document.getElementById('nh-hero-video');
        if (!video) return;
        video.addEventListener('canplay', function() {
            video.classList.add('loaded');
        });
        // Attempt play (handles autoplay policy on some browsers)
        video.play().catch(function() {
            // Autoplay blocked — still show the poster or static bg
            video.classList.add('loaded');
        });
    }

    /* =====================================================================
       CATEGORIES
       Source: Firestore 'categories' collection (all docs, ordered by sortOrder)
       Fallback: static local array
       ===================================================================== */

    /**
     * Fetch and render category pill swimlane.
     */
    async function _renderCategories() {
        const el = document.getElementById('nh-cats-row');
        if (!el) return;

        // Fallback categories
        const fallback = [];

        let cats = fallback;

        // Try Firestore
        if (window.db) {
            try {
                const snap = await window.db
                    .collection('categories')
                    .orderBy('sortOrder', 'asc')
                    .get();
                if (!snap.empty) {
                    cats = snap.docs.map(function(doc) {
                        const d = doc.data();
                        return {
                            label: d.label || 'Category',
                            icon:  d.icon  || 'fa-tag',
                            slug:  d.slug  || '',
                        };
                    });
                }
            } catch (err) {
                console.warn('[HomeEngine] Categories Firestore failed, using fallback.', err.message);
            }
        }

        // Render pills
        el.innerHTML = cats.map(function(c, i) {
            return `
                <button
                    class="nh-cat ${i === 0 ? 'active' : ''}"
                    onclick="NexraHomeEngine.filterByCategory('${_esc(c.slug)}', this)"
                    data-slug="${_esc(c.slug)}"
                    aria-label="Filter by ${_esc(c.label)}"
                    aria-pressed="${i === 0 ? 'true' : 'false'}"
                >
                    <div class="nh-cat-icon" aria-hidden="true">
                        <i class="fa-solid ${_esc(c.icon)}" style="color:var(--nh-brand);font-size:11px;"></i>
                    </div>
                    ${_esc(c.label)}
                </button>`;
        }).join('');
    }

    /* =====================================================================
       TRENDING PRODUCTS GRID
       Source: Firestore products where trending==true, sold_count DESC, limit 8
       Fallback: curated static product array
       ===================================================================== */

    /**
     * Fetch and render the trending products grid.
     */
    async function _renderTrending() {
        const el = document.getElementById('nh-trending-grid');
        if (!el) return;

        // Show skeletons while loading
        _renderSkeletons(el, 8, 'product');

        // Fallback products (shown if Firestore unavailable)
        const fallback = [];

        let products = fallback;

        // Try Firestore
        if (window.db) {
            try {
                const snap = await window.db
                    .collection('products')
                    .where('trending', '==', true)
                    .orderBy('sold_count', 'desc')
                    .limit(8)
                    .get();

                if (!snap.empty) {
                    products = snap.docs.map(function(doc) {
                        const d = doc.data();
                        return {
                            id:        doc.id,
                            title:     d.title     || 'Untitled Product',
                            price:     d.price     || 0,
                            oldPrice:  d.old_price || null,
                            image:     d.image_url || '',
                            badge:     (d.badge_label || d.type || 'SALE').toUpperCase(),
                            badgeType: (d.badge_type  || d.type || 'sale').toLowerCase(),
                            rating:    d.rating    || 5.0,
                            soldCount: d.sold_count || 0,
                            category:  d.category  || '',
                        };
                    });
                }
            } catch (err) {
                console.warn('[HomeEngine] Products Firestore failed, using fallback.', err.message);
            }
        }

        // Render cards (or empty state)
        if (products.length === 0) {
            _renderEmptyState(
                el,
                'fa-box-open',
                'No Products Yet',
                'Products are being added. Check back soon.'
            );
            return;
        }

        el.innerHTML = products.map(function(p) {
            const oldPriceHtml = p.oldPrice
                ? `<span class="nh-prod-price-old">${_formatPrice(p.oldPrice)}</span>`
                : '';
            return `
                <article
                    class="nh-prod"
                    role="listitem"
                    onclick="NexraApp.navTo('product-detail', '${_esc(p.id)}')"
                    aria-label="${_esc(p.title)} — ${_formatPrice(p.price)}"
                >
                    <span class="nh-prod-badge ${_esc(_badgeClass(p.badgeType))}" aria-label="${_esc(p.badge)} badge">
                        ${_esc(p.badge)}
                    </span>
                    <button
                        class="nh-prod-wish-btn"
                        id="wish-${_esc(p.id)}"
                        onclick="event.stopPropagation(); NexraHomeEngine.toggleWishlist(this, '${_esc(p.id)}')"
                        aria-label="Add to wishlist"
                        title="Wishlist"
                    >
                        <i class="fa-regular fa-heart" aria-hidden="true"></i>
                    </button>
                    <div class="nh-prod-img-wrap">
                        <img
                            src="${_esc(p.image)}"
                            class="nh-prod-img"
                            alt="${_esc(p.title)}"
                            loading="lazy"
                            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23f1f5f9%22/></svg>'"
                        >
                    </div>
                    <div style="flex:1; display:flex; flex-direction:column;">
                        <div class="nh-prod-meta">
                            <span class="stars" aria-label="${p.rating} stars">
                                ${_renderStars(p.rating)}
                                ${p.rating}
                            </span>
                            <span aria-label="${p.soldCount} sold">${(p.soldCount || 0).toLocaleString('en-PK')} Sold</span>
                        </div>
                        <h3 class="nh-prod-title">${_esc(p.title)}</h3>
                        <div class="nh-prod-price">
                            ${_formatPrice(p.price)}
                            ${oldPriceHtml}
                        </div>
                        <div class="nh-prod-actions">
                            <button
                                class="nh-prod-cart-btn"
                                id="cart-btn-${_esc(p.id)}"
                                onclick="NexraApp.addToCart(event, '${_esc(p.id)}', '${_esc(p.title)}', ${p.price}, '${_esc(p.image)}')"
                                aria-label="Add ${_esc(p.title)} to cart"
                                title="Add to Cart"
                            >
                                <i class="fa-solid fa-cart-plus" aria-hidden="true"></i>
                            </button>
                            <button
                                class="nh-prod-buy-btn"
                                onclick="event.stopPropagation(); NexraApp.navTo('checkout')"
                                aria-label="Buy ${_esc(p.title)} now"
                            >
                                BUY NOW
                            </button>
                        </div>
                    </div>
                </article>`;
        }).join('');
    }

    /* =====================================================================
       FREEBIES VAULT GRID
       Source: Firestore 'freebies' collection, created_at DESC, limit 3
       Fallback: curated static freebies
       ===================================================================== */

    /**
     * Fetch and render the freebies grid.
     */
    async function _renderFreebies() {
        const el = document.getElementById('nh-freebies-grid');
        if (!el) return;

        _renderSkeletons(el, 3, 'freebie');

        const fallback = [];

        let freebies = fallback;

        if (window.db) {
            try {
                const snap = await window.db
                    .collection('freebies')
                    .orderBy('created_at', 'desc')
                    .limit(3)
                    .get();

                if (!snap.empty) {
                    freebies = snap.docs.map(function(doc) {
                        const d = doc.data();
                        return {
                            id:     doc.id,
                            cat:    (d.category || 'FREE').toUpperCase(),
                            title:  d.title     || 'Free Resource',
                            sub:    d.subtitle  || '',
                            image:  d.image_url || '',
                            locked: d.locked    || false,
                        };
                    });
                }
            } catch (err) {
                console.warn('[HomeEngine] Freebies Firestore failed, using fallback.', err.message);
            }
        }

        if (freebies.length === 0) {
            _renderEmptyState(
                el,
                'fa-vault',
                'Vault Empty',
                'New free resources are added weekly. Check back soon!'
            );
            return;
        }

        el.innerHTML = freebies.map(function(f) {
            const lockHtml = f.locked
                ? `<div class="nh-freebie-lock" aria-label="Locked resource">
                       <div class="nh-freebie-lock-icon">
                           <i class="fa-solid fa-lock" aria-hidden="true"></i>
                       </div>
                   </div>`
                : '';
            return `
                <div
                    class="nh-freebie"
                    role="listitem"
                    onclick="NexraApp.navTo('freebie-detail', '${_esc(f.id)}')"
                    aria-label="${_esc(f.title)}${f.locked ? ' — Locked' : ''}"
                    style="cursor:pointer;"
                >
                    <img
                        src="${_esc(f.image)}"
                        class="nh-freebie-img"
                        alt="${_esc(f.title)}"
                        loading="lazy"
                        onerror="this.style.display='none'"
                    >
                    ${lockHtml}
                    <div class="nh-freebie-overlay">
                        <span class="nh-freebie-cat">${_esc(f.cat)}</span>
                        <div class="nh-freebie-title">${_esc(f.title)}</div>
                        <div class="nh-freebie-sub">
                            <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
                            ${_esc(f.sub)}
                        </div>
                    </div>
                </div>`;
        }).join('');
    }

    /* =====================================================================
       BLOG INSIGHTS GRID
       Source: Firestore 'blogs' where published==true, created_at DESC, limit 3
       ===================================================================== */

    /**
     * Fetch and render the blog insights grid.
     */
    async function _renderBlogs() {
        const el = document.getElementById('nh-blogs-grid');
        if (!el) return;

        _renderSkeletons(el, 3, 'blog');

        const fallback = [];

        let blogs = fallback;

        if (window.db) {
            try {
                const snap = await window.db
                    .collection('blogs')
                    .where('published', '==', true)
                    .orderBy('created_at', 'desc')
                    .limit(3)
                    .get();

                if (!snap.empty) {
                    blogs = snap.docs.map(function(doc) {
                        const d = doc.data();
                        return {
                            id:      doc.id,
                            cat:     (d.category || 'ARTICLE').toUpperCase(),
                            title:   d.title     || 'Untitled Article',
                            date:    _formatDate(d.created_at),
                            readMin: d.read_min  || 5,
                            image:   d.cover_url || d.image_url || '',
                        };
                    });
                }
            } catch (err) {
                console.warn('[HomeEngine] Blogs Firestore failed, using fallback.', err.message);
            }
        }

        if (blogs.length === 0) {
            _renderEmptyState(
                el,
                'fa-newspaper',
                'No Articles Yet',
                'Our learning academy is being built. Check back soon!'
            );
            return;
        }

        el.innerHTML = blogs.map(function(b) {
            return `
                <article
                    class="nh-blog"
                    role="listitem"
                    onclick="NexraApp.navTo('blog-detail', '${_esc(b.id)}')"
                    aria-label="${_esc(b.title)}"
                >
                    <div class="nh-blog-img-wrap">
                        <img
                            src="${_esc(b.image)}"
                            class="nh-blog-img"
                            alt="${_esc(b.title)}"
                            loading="lazy"
                            onerror="this.style.display='none'"
                        >
                        <div class="nh-blog-read-time" aria-label="${b.readMin} minute read">
                            ${b.readMin} MIN READ
                        </div>
                    </div>
                    <div class="nh-blog-body">
                        <div class="nh-blog-cat">${_esc(b.cat)}</div>
                        <h3 class="nh-blog-title">${_esc(b.title)}</h3>
                        <div class="nh-blog-meta">
                            <span><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${_esc(b.date)}</span>
                        </div>
                    </div>
                </article>`;
        }).join('');
    }

    /* =====================================================================
       TESTIMONIALS DUAL MARQUEE
       Source: Firestore 'testimonials' where approved==true, limit 12
       Renders both Row 1 (forward) and Row 2 (reverse) from same dataset.
       ===================================================================== */

    /**
     * Fetch and render the testimonial marquee rows.
     */
    async function _renderMarquee() {
        const track1 = document.getElementById('nh-marquee-track-1');
        const track2 = document.getElementById('nh-marquee-track-2');
        if (!track1 || !track2) return;

        const fallback = [];

        let reviews = fallback;

        if (window.db) {
            try {
                const snap = await window.db
                    .collection('testimonials')
                    .where('approved', '==', true)
                    .orderBy('created_at', 'desc')
                    .limit(12)
                    .get();

                if (!snap.empty) {
                    reviews = snap.docs.map(function(doc) {
                        const d = doc.data();
                        return {
                            name:     d.name     || 'Anonymous',
                            loc:      d.location || d.loc || 'Pakistan',
                            text:     d.text     || d.review || '',
                            rating:   d.rating   || 5,
                            avatar:   d.avatar_url || '',
                            verified: d.verified || false,
                        };
                    });
                }
            } catch (err) {
                console.warn('[HomeEngine] Testimonials Firestore failed, using fallback.', err.message);
            }
        }

        // Helper: build card HTML
        function _cardHtml(r) {
            const avatarContent = r.avatar
                ? `<img src="${_esc(r.avatar)}" alt="${_esc(r.name)}" loading="lazy">`
                : `${_esc(r.name.charAt(0))}`;
            const verifiedBadge = r.verified
                ? `<span class="nh-review-verified"><i class="fa-solid fa-circle-check"></i> Verified</span>`
                : '';
            return `
                <div class="nh-review-card" role="article">
                    <div class="nh-review-stars" aria-label="${r.rating} star rating">
                        ${_renderStars(r.rating)}
                    </div>
                    <div class="nh-review-text">${_esc(r.text)}</div>
                    <div class="nh-review-author">
                        <div class="nh-review-avatar" aria-hidden="true">${avatarContent}</div>
                        <div>
                            <div class="nh-review-name">${_esc(r.name)}</div>
                            <div class="nh-review-loc">
                                <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                                ${_esc(r.loc)}, PK
                            </div>
                        </div>
                        ${verifiedBadge}
                    </div>
                </div>`;
        }

        // Duplicate array twice for seamless infinite loop
        const doubled = [...reviews, ...reviews];
        const allCards = doubled.map(_cardHtml).join('');

        // Split reviews between the two rows for visual variety
        const half = Math.ceil(reviews.length / 2);
        const row1 = [...reviews.slice(0, half), ...reviews.slice(0, half)];
        const row2 = [...reviews.slice(half),    ...reviews.slice(half)];

        track1.innerHTML = row1.map(_cardHtml).join('');
        track2.innerHTML = row2.length > 0
            ? row2.map(_cardHtml).join('')
            : doubled.map(_cardHtml).join(''); // fallback: use all if not enough for two rows
    }

    /* =====================================================================
       FAQ ACCORDION
       Source: Firestore 'faqs' where published==true, sortOrder ASC, limit 8
       Falls back to static items already in markup — renderFAQs() only
       REPLACES the list if Firestore returns results.
       ===================================================================== */

    /**
     * Fetch and render FAQ items. Replaces static markup if Firestore data exists.
     */
    async function _renderFAQs() {
        if (!window.db) return;
        const container = document.getElementById('nh-faq-list');
        if (!container) return;

        try {
            const snap = await window.db
                .collection('faqs')
                .where('published', '==', true)
                .orderBy('sortOrder', 'asc')
                .limit(8)
                .get();

            if (snap.empty) return; // Keep static markup if Firestore returns nothing

            let html = '';
            snap.docs.forEach(function(doc, idx) {
                const d = doc.data();
                html += `
                    <details class="nh-faq-item" id="faq-${doc.id}">
                        <summary>${_esc(d.question || 'FAQ Item')}</summary>
                        <p>${_esc(d.answer || '')}</p>
                    </details>`;
            });
            container.innerHTML = html;

        } catch (err) {
            // Static markup remains — no action needed
            console.warn('[HomeEngine] FAQs Firestore failed, keeping static markup.', err.message);
        }
    }

    /**
     * Execute full global search — shows inline results on home page.
     * Queries Firestore products, blogs, and freebies collections.
     * Public method called by onclick in home.html.
     */
    let _searchResults = { products: [], blogs: [], freebies: [] };
    let _activeSearchTab = 'all';

    async function _executeSearch() {
        const input = document.getElementById('nh-search-input');
        const q = (input ? input.value : '').trim();
        if (!q) {
            if (window.NexraApp) {
                NexraApp.showToast('Please enter a search term.', 'fa-solid fa-magnifying-glass', 'default');
            }
            return;
        }

        _closeSearchDropdown();

        // Show search results section, hide homepage content sections
        const resultsSection = document.getElementById('nh-search-results');
        if (!resultsSection) return;

        // Hide main content sections
        document.querySelectorAll('.nh-section, .nh-section-sm').forEach(function(s) {
            if (s.id !== 'nh-search-results') s.style.display = 'none';
        });
        resultsSection.style.display = 'block';

        // Update query text display
        const queryText = document.getElementById('sr-query-text');
        if (queryText) queryText.innerText = '"' + q + '"';

        // Show loading state
        const grid = document.getElementById('sr-grid');
        if (grid) {
            grid.style.display = 'grid';
            grid.innerHTML = '<div class="sr-card skeleton"></div><div class="sr-card skeleton"></div><div class="sr-card skeleton"></div><div class="sr-card skeleton"></div>';
        }
        document.getElementById('sr-empty').style.display = 'none';

        // Perform full search
        if (!window.db) {
            // Fallback: redirect to shop search
            window.location.href = '/shop/shop.html?search=' + encodeURIComponent(q);
            return;
        }

        try {
            const keyword = q.toLowerCase();
            const [prodSnap, blogSnap, freeSnap] = await Promise.all([
                window.db.collection('products').limit(50).get(),
                window.db.collection('blogs').limit(50).get(),
                window.db.collection('freebies').limit(50).get()
            ]);

            _searchResults.products = _filterSearchLocally(prodSnap, keyword, 'product');
            _searchResults.blogs    = _filterSearchLocally(blogSnap, keyword, 'blog');
            _searchResults.freebies = _filterSearchLocally(freeSnap, keyword, 'freebie');

            _updateSearchCounts();
            _activeSearchTab = 'all';
            _renderSearchGrid();

            // Reset tab styling
            document.querySelectorAll('.sr-tab').forEach(function(btn) { btn.classList.remove('active'); });
            var allTab = document.querySelector('.sr-tab[data-filter="all"]');
            if (allTab) allTab.classList.add('active');

        } catch (e) {
            console.error('[HomeEngine] Search failed:', e);
            if (window.NexraApp) NexraApp.showToast('Search engine error. Please try again.', 'fa-solid fa-triangle-exclamation', 'danger');
            if (grid) grid.innerHTML = '';
        }
    }

    function _filterSearchLocally(snapshot, query, type) {
        var matches = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();
            var searchableText = ((d.title || '') + ' ' + (d.description || '') + ' ' + (d.keywords ? d.keywords.join(' ') : '')).toLowerCase();
            if (searchableText.includes(query)) {
                matches.push(Object.assign({ id: doc.id, type: type }, d));
            }
        });
        return matches;
    }

    function _updateSearchCounts() {
        var cp = document.getElementById('count-prod');
        var cb = document.getElementById('count-blog');
        var cf = document.getElementById('count-free');
        if (cp) cp.innerText = _searchResults.products.length;
        if (cb) cb.innerText = _searchResults.blogs.length;
        if (cf) cf.innerText = _searchResults.freebies.length;
    }

    function _switchSearchTab(tabName) {
        _activeSearchTab = tabName;
        document.querySelectorAll('.sr-tab').forEach(function(btn) { btn.classList.remove('active'); });
        var tab = document.querySelector('.sr-tab[data-filter="' + tabName + '"]');
        if (tab) tab.classList.add('active');
        _renderSearchGrid();
    }

    function _renderSearchGrid() {
        var grid  = document.getElementById('sr-grid');
        var empty = document.getElementById('sr-empty');
        if (!grid || !empty) return;

        var displayData = [];
        if (_activeSearchTab === 'all') {
            displayData = _searchResults.products.concat(_searchResults.blogs, _searchResults.freebies);
        } else {
            displayData = _searchResults[_activeSearchTab] || [];
        }

        if (displayData.length === 0) {
            grid.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        grid.style.display = 'grid';
        empty.style.display = 'none';

        var html = '';
        displayData.forEach(function(item) {
            var badgeClass = '';
            var badgeText  = '';
            var link       = '#';

            if (item.type === 'product') {
                badgeClass = 'b-prod'; badgeText = 'SaaS Tool'; link = '/shop/product-detail.html?id=' + item.id;
            } else if (item.type === 'blog') {
                badgeClass = 'b-blog'; badgeText = 'Article'; link = '/academy/blog-detail.html?id=' + item.id;
            } else if (item.type === 'freebie') {
                badgeClass = 'b-free'; badgeText = 'Freebie'; link = '/freebies/freebie-detail.html?id=' + item.id;
            }

            var img = item.coverBase64 || item.image_url || item.image || '';

            html += '<a href="' + link + '" class="sr-card">' +
                '<img src="' + _esc(img) + '" class="sc-img" loading="lazy" onerror="this.style.display=\'none\'">' +
                '<div class="sc-body">' +
                '<span class="sc-badge ' + badgeClass + '">' + badgeText + '</span>' +
                '<div class="sc-title">' + _esc(item.title || 'Untitled') + '</div>' +
                '<div class="sc-desc">' + _esc(item.description || 'No description available.') + '</div>' +
                '</div></a>';
        });

        grid.innerHTML = html;
    }

    function _closeSearchResults() {
        var resultsSection = document.getElementById('nh-search-results');
        if (resultsSection) resultsSection.style.display = 'none';
        // Show homepage content sections again
        document.querySelectorAll('.nh-section, .nh-section-sm').forEach(function(s) {
            s.style.display = '';
        });
    }

    /**
     * Initialize search input event listeners.
     * - Enter key triggers full search
     * - Input keyup fetches live dropdown suggestions
     * - Click outside closes dropdown
     */
    function _initSearch() {
        const input    = document.getElementById('nh-search-input');
        const dropdown = document.getElementById('nh-search-dropdown');
        if (!input) return;

        // Enter key → full search
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                _executeSearch();
            }
            if (e.key === 'Escape') {
                _closeSearchDropdown();
            }
        });

        // Debounced live dropdown
        let _debounce = null;
        input.addEventListener('input', function() {
            clearTimeout(_debounce);
            const q = input.value.trim();
            if (q.length < 2) {
                _closeSearchDropdown();
                return;
            }
            _debounce = setTimeout(function() {
                _fetchSearchDropdown(q);
            }, 300);
        });

        // Close dropdown on click outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#nh-search-wrap')) {
                _closeSearchDropdown();
            }
        });
    }

    /**
     * Fetch live search suggestions from Firestore products collection.
     * Uses keywords array-contains query.
     * @param {string} q — Search term
     */
    async function _fetchSearchDropdown(q) {
        const dropdown = document.getElementById('nh-search-dropdown');
        const input    = document.getElementById('nh-search-input');
        if (!dropdown) return;

        // Show dropdown
        dropdown.hidden = false;
        if (input) input.setAttribute('aria-expanded', 'true');
        dropdown.innerHTML = `
            <div class="nh-search-no-results">
                <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;" aria-hidden="true"></i>
                Searching...
            </div>`;

        if (!window.db) {
            _closeSearchDropdown();
            _executeSearch();
            return;
        }

        try {
            const keyword = q.toLowerCase().trim();
            const snap = await window.db
                .collection('products')
                .where('keywords', 'array-contains', keyword)
                .limit(5)
                .get();

            if (snap.empty) {
                dropdown.innerHTML = `
                    <div class="nh-search-no-results">
                        No results for "<strong>${_esc(q)}</strong>" — try the full search.
                    </div>`;
                return;
            }

            dropdown.innerHTML = snap.docs.map(function(doc) {
                const d = doc.data();
                return `
                    <div
                        class="nh-search-result-item"
                        onclick="_closeDropdownAndNavigate('${_esc(doc.id)}')"
                        role="option"
                        tabindex="0"
                        aria-label="${_esc(d.title)} — Rs. ${(d.price || 0).toLocaleString()}"
                    >
                        <img
                            src="${_esc(d.image_url || '')}"
                            class="nh-search-result-img"
                            alt="${_esc(d.title)}"
                            loading="lazy"
                            onerror="this.style.display='none'"
                        >
                        <div class="nh-search-result-info">
                            <div class="nh-search-result-title">${_esc(d.title)}</div>
                            <div class="nh-search-result-price">Rs. ${(d.price || 0).toLocaleString('en-PK')}</div>
                        </div>
                        <i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--nh-t3); font-size:11px;" aria-hidden="true"></i>
                    </div>`;
            }).join('');

        } catch (err) {
            _closeSearchDropdown();
            console.warn('[HomeEngine] Search dropdown error:', err.message);
        }
    }

    // Helper exposed to dropdown item onclick (needs window scope)
    window._closeDropdownAndNavigate = function(id) {
        _closeSearchDropdown();
        NexraApp.navTo('product-detail', id);
    };

    function _closeSearchDropdown() {
        const dropdown = document.getElementById('nh-search-dropdown');
        const input    = document.getElementById('nh-search-input');
        if (dropdown) dropdown.hidden = true;
        if (input)    input.setAttribute('aria-expanded', 'false');
    }

    /* =====================================================================
       VOICE SEARCH (Web Speech API)
       ===================================================================== */

    /**
     * Start Web Speech API voice input.
     * Populates the search field with recognized speech and triggers search.
     * Public method — called by onclick on .nh-search-voice-btn.
     */
    function _startVoiceSearch() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (window.NexraApp) {
                NexraApp.showToast('Voice search not supported on this browser.', 'fa-solid fa-microphone-slash', 'default');
            }
            return;
        }

        const btn    = document.getElementById('nh-voice-btn');
        const input  = document.getElementById('nh-search-input');
        const sr     = new SpeechRecognition();

        sr.lang = 'en-PK';
        sr.interimResults = false;
        sr.maxAlternatives = 1;

        // Visual: show pulsing animation while listening
        if (btn) btn.classList.add('listening');

        sr.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            if (input) {
                input.value = transcript;
                input.focus();
                // Auto-trigger search after voice input
                setTimeout(_executeSearch, 400);
            }
        };

        sr.onerror = function(event) {
            console.warn('[HomeEngine] Voice search error:', event.error);
            if (event.error !== 'no-speech' && window.NexraApp) {
                NexraApp.showToast('Voice search failed. Try again.', 'fa-solid fa-microphone-slash', 'default');
            }
        };

        sr.onend = function() {
            if (btn) btn.classList.remove('listening');
        };

        try {
            sr.start();
        } catch (e) {
            if (btn) btn.classList.remove('listening');
        }
    }

    /* =====================================================================
       NEWSLETTER SUBSCRIPTION
       Writes { email, subscribedAt, source } to Firestore 'newsletters'
       collection after checking for duplicates.
       ===================================================================== */

    /**
     * Handle newsletter form submission.
     * Public method — called by form onsubmit in home.html.
     */
    async function _subscribeNewsletter() {
        const emailInput = document.getElementById('nh-nl-email');
        const submitBtn  = document.getElementById('nh-nl-submit');
        if (!emailInput || !submitBtn) return;

        const email = emailInput.value.trim().toLowerCase();

        // Client-side validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if (window.NexraApp) {
                NexraApp.showToast('Please enter a valid email address.', 'fa-solid fa-circle-xmark', 'danger');
            }
            emailInput.focus();
            return;
        }

        // Button loading state
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subscribing...';
        submitBtn.disabled = true;

        if (!window.db) {
            // Offline graceful handling
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> JOIN FREE';
            submitBtn.disabled = false;
            if (window.NexraApp) {
                NexraApp.showToast('You\'re subscribed! Welcome to Nexra.', 'fa-solid fa-check-circle', 'success');
            }
            emailInput.value = '';
            return;
        }

        try {
            // Check for duplicate email
            const existing = await window.db
                .collection('newsletters')
                .where('email', '==', email)
                .limit(1)
                .get();

            if (!existing.empty) {
                if (window.NexraApp) {
                    NexraApp.showToast('You\'re already subscribed! 🎉', 'fa-solid fa-circle-check', 'success');
                }
                emailInput.value = '';
                return;
            }

            // Save new subscriber
            await window.db.collection('newsletters').add({
                email:        email,
                subscribedAt: firebase.firestore.FieldValue.serverTimestamp(),
                source:       'home-page',
                active:       true,
                utm_source:   new URLSearchParams(window.location.search).get('utm_source') || '',
                ref:          sessionStorage.getItem('nexra_ref') || '',
            });

            if (window.NexraApp) {
                NexraApp.showToast('Subscribed! Welcome to the Nexra ecosystem 🎉', 'fa-solid fa-party-horn', 'success');
            }
            emailInput.value = '';

        } catch (err) {
            console.error('[HomeEngine] Newsletter subscription error:', err);
            if (window.NexraApp) {
                NexraApp.showToast('Subscription failed. Please try again.', 'fa-solid fa-circle-xmark', 'danger');
            }
        } finally {
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> JOIN FREE';
            submitBtn.disabled = false;
        }
    }

    /* =====================================================================
       OFFLINE DETECTION
       ===================================================================== */

    /**
     * Initialize online/offline event listeners.
     * Shows/hides the overlay when connectivity changes.
     */
    function _initOfflineDetection() {
        function _updateOnlineState() {
            const overlay = document.getElementById('nh-offline-overlay');
            if (!overlay) return;

            if (!navigator.onLine) {
                _isOffline = true;
                overlay.removeAttribute('aria-hidden');
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
                if (window.NexraApp) {
                    NexraApp.showToast('No internet connection detected.', 'fa-solid fa-wifi-slash', 'danger');
                }
            } else {
                _isOffline = false;
                overlay.setAttribute('aria-hidden', 'true');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        window.addEventListener('online',  _updateOnlineState);
        window.addEventListener('offline', _updateOnlineState);

        // Check initial state
        if (!navigator.onLine) _updateOnlineState();
    }

    /* =====================================================================
       WISHLIST TOGGLE
       Reads/writes wishlist from localStorage, updates icon state.
       ===================================================================== */

    /**
     * Toggle wishlist state for a product.
     * @param {HTMLElement} btn — The wishlist button element
     * @param {string}      id  — Product ID
     */
    function _toggleWishlist(btn, id) {
        let wishlist = JSON.parse(localStorage.getItem('nexra_wishlist') || '[]');
        const idx = wishlist.indexOf(id);
        const icon = btn.querySelector('i');

        if (idx === -1) {
            wishlist.push(id);
            btn.classList.add('wished');
            if (icon) icon.className = 'fa-solid fa-heart';
            if (window.NexraApp) {
                NexraApp.showToast('Added to wishlist!', 'fa-solid fa-heart', 'success');
            }
        } else {
            wishlist.splice(idx, 1);
            btn.classList.remove('wished');
            if (icon) icon.className = 'fa-regular fa-heart';
            if (window.NexraApp) {
                NexraApp.showToast('Removed from wishlist.', 'fa-regular fa-heart', 'default');
            }
        }

        localStorage.setItem('nexra_wishlist', JSON.stringify(wishlist));

        // Sync to Firestore if user is logged in
        if (window.auth && window.auth.currentUser && window.db) {
            window.db
                .collection('users')
                .doc(window.auth.currentUser.uid)
                .collection('wishlist')
                .doc(id)
                .set(idx === -1 ? { addedAt: firebase.firestore.FieldValue.serverTimestamp() } : {})
                .catch(function() {}); // Silent fail — local state is source of truth
        }
    }

    /**
     * Restore wishlist heart states on page render.
     * Reads localStorage and marks all wished buttons.
     */
    function _restoreWishlistState() {
        const wishlist = JSON.parse(localStorage.getItem('nexra_wishlist') || '[]');
        wishlist.forEach(function(id) {
            const btn = document.getElementById('wish-' + id);
            if (btn) {
                btn.classList.add('wished');
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-heart';
            }
        });
    }

    /* =====================================================================
       PUBLIC API — exposed on window.NexraHomeEngine
       ===================================================================== */

    return {

        /**
         * Master initialization — called by boot script after all components mount.
         * Runs checks and section renders in optimal order.
         */
        init: async function() {
            console.log('[NexraHomeEngine] Initializing...');

            // 1. Check maintenance mode FIRST (blocks all else if active)
            const inMaintenance = await _checkMaintenanceMode();
            if (inMaintenance) {
                console.log('[NexraHomeEngine] Maintenance mode active. Halting page init.');
                return;
            }

            // 2. Offline detection setup
            _initOfflineDetection();

            // 3. Hero video
            _initHeroVideo();

            // 4. Kinetic headline
            _startKinetic();

            // 5. Scroll reveal observer
            _initScrollReveal();

            // 6. Search bar
            _initSearch();

            // 7. Live announcement strip
            _loadAnnouncement();

            // 8. Live branding subscription (keeps theme/logo in sync)
            _subscribeToLiveBranding();

            // 9. Live stats subscription
            _subscribeToLiveStats();

            // 10. SEO meta tags sync
            _applyLiveSEO();

            // 11. Render all content sections in parallel for fastest possible LCP
            await Promise.allSettled([
                _renderCategories(),
                _renderTrending(),
                _renderFreebies(),
                _renderBlogs(),
                _renderMarquee(),
                _renderFAQs(),
            ]);

            // 12. Restore wishlist state after products grid renders
            _restoreWishlistState();

            console.log('[NexraHomeEngine] All sections rendered.');
        },

        /** Public: execute search — called by search button onclick */
        executeSearch: function() {
            _executeSearch();
        },

        /** Public: start voice search — called by mic button onclick */
        startVoiceSearch: function() {
            _startVoiceSearch();
        },

        /** Public: switch search tab — called by tab onclick */
        switchSearchTab: function(tabName) {
            _switchSearchTab(tabName);
        },

        /** Public: close search results and return to home — called by back button */
        closeSearchResults: function() {
            _closeSearchResults();
        },

        /** Public: subscribe to newsletter — called by form onsubmit */
        subscribeNewsletter: function() {
            _subscribeNewsletter();
        },

        /** Public: retry connection after offline — called by retry button */
        retryConnection: function() {
            if (navigator.onLine) {
                const overlay = document.getElementById('nh-offline-overlay');
                if (overlay) {
                    overlay.setAttribute('aria-hidden', 'true');
                    overlay.classList.remove('active');
                    document.body.style.overflow = '';
                }
                // Re-init sections that may have failed
                _renderTrending();
                _renderFreebies();
                _renderBlogs();
                _renderMarquee();
            } else {
                if (window.NexraApp) {
                    NexraApp.showToast('Still offline. Please check your connection.', 'fa-solid fa-wifi-slash', 'danger');
                }
            }
        },

        /**
         * Public: filter products by category pill click.
         * Highlights the clicked pill and navigates to shop with filter.
         * @param {string}      slug — Category slug
         * @param {HTMLElement} btn  — Clicked button element
         */
        filterByCategory: function(slug, btn) {
            // Update active pill state
            document.querySelectorAll('.nh-cat').forEach(function(b) {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            if (btn) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            }

            // Navigate to shop with category filter
            if (slug) {
                window.location.href = '/shop/shop.html?category=' + encodeURIComponent(slug);
            } else {
                NexraApp.navTo('shop');
            }
        },

        /**
         * Public: toggle wishlist — called by product card heart button onclick.
         * @param {HTMLElement} btn — The wishlist button
         * @param {string}      id  — Product document ID
         */
        toggleWishlist: function(btn, id) {
            _toggleWishlist(btn, id);
        },

    };

})();
