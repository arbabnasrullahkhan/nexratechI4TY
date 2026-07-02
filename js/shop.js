/**
 * ==========================================================================
 * NEXRA TECH PK — SHOP PAGE ENGINE (js/shop.js)
 * ==========================================================================
 * Namespace: window.NexraShopEngine
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on shop/shop.html
 *
 * FIRESTORE COLLECTIONS:
 *   products           — main product grid (paginated)
 *   categories         — category swimlane pills
 *   banners            — promo banner carousel
 *   settings/global    — maintenance mode
 *   settings/shop      — page config (hero text, usdRate, etc.)
 *   users/{uid}/wishlist — per-user wishlist
 *
 * PUBLIC METHODS (called by HTML onclick attrs or loader.js):
 *   NexraShopEngine.init()
 *   NexraShopEngine.executeSearch()
 *   NexraShopEngine.startVoiceSearch()
 *   NexraShopEngine.applyFilters()
 *   NexraShopEngine.resetFilters()
 *   NexraShopEngine.loadMoreProducts()
 *   NexraShopEngine.retryLoad()
 *   NexraShopEngine.setView(type)           — 'grid' | 'list'
 *   NexraShopEngine.openFilterSheet()
 *   NexraShopEngine.closeFilterSheet()
 *   NexraShopEngine.scrollCats(dir)         — -1 | 1
 *   NexraShopEngine.toggleWishlist(e, id)
 *   NexraShopEngine.openProductDetail(id)
 * ==========================================================================
 */

window.NexraShopEngine = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */

    var _PAGE_SIZE      = 12;   // products per Firestore page
    var _state = {
        initialized:    false,
        view:           'grid',           // 'grid' | 'list'
        category:       'all',            // active category slug
        search:         '',               // current search string
        sort:           'newest',         // active sort key
        typeFilters:    [],               // ['SaaS','Digital','Physical']
        priceMin:       null,
        priceMax:       null,
        onSale:         false,
        isNew:          false,
        isTrending:     false,
        inStock:        false,
        lastDoc:        null,             // Firestore cursor for pagination
        hasMore:        false,
        loading:        false,
        totalLoaded:    0,
        usdRate:        280,              // fallback PKR/USD rate
        currentUser:    null,
        wishlistIds:    new Set(),
        voiceActive:    false,
        searchDebounce: null,
        recognition:    null,
    };

    /* Sort option definitions */
    var _SORT_OPTIONS = [
        { key: 'newest',       label: 'Newest First',    icon: 'fa-solid fa-clock' },
        { key: 'price-asc',    label: 'Price: Low → High', icon: 'fa-solid fa-arrow-up' },
        { key: 'price-desc',   label: 'Price: High → Low', icon: 'fa-solid fa-arrow-down' },
        { key: 'top-rated',    label: 'Top Rated',       icon: 'fa-solid fa-star' },
        { key: 'trending',     label: 'Trending',        icon: 'fa-solid fa-fire' },
        { key: 'name-asc',     label: 'Name A → Z',      icon: 'fa-solid fa-a' },
    ];

    /* Type filter definitions */
    var _TYPE_OPTIONS = [
        { value: 'SaaS',     label: 'SaaS Tools',    icon: 'fa-solid fa-cloud' },
        { value: 'Digital',  label: 'Digital Assets', icon: 'fa-solid fa-download' },
        { value: 'Physical', label: 'Physical Goods', icon: 'fa-solid fa-box' },
        { value: 'Bundle',   label: 'Bundles',        icon: 'fa-solid fa-cubes' },
        { value: 'Course',   label: 'Courses',        icon: 'fa-solid fa-graduation-cap' },
    ];

    /* ======================================================================
       INIT
       ====================================================================== */

    /**
     * Main entry point. Called by boot script after components mount.
     */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraShopEngine] Initializing...');

        _readURLParams();
        _loadPageConfig();
        _subscribeAuth();
        _loadCategories();
        _loadPromoBanners();
        _renderSortOptions();
        _renderTypeFilters();
        _initSearch();
        _loadProducts(false);

        console.log('[NexraShopEngine] Init complete. Search:', _state.search, 'Category:', _state.category);
    }

    /* ======================================================================
       URL PARAMETER HANDLING
       ====================================================================== */

    /**
     * Reads ?search= ?category= ?sort= ?type= from URL on load.
     * Also restores from sessionStorage if navigating back.
     */
    function _readURLParams() {
        var params = new URLSearchParams(window.location.search);

        _state.search   = params.get('search')   || '';
        _state.category = params.get('category') || 'all';
        _state.sort     = params.get('sort')      || 'newest';

        // If search term present, fill the input
        if (_state.search) {
            var input = document.getElementById('sp-search-input');
            if (input) input.value = _state.search;
        }
    }

    /**
     * Writes current filter state back to the URL (no full reload).
     */
    function _syncURL() {
        var params = new URLSearchParams();
        if (_state.search)   params.set('search',   _state.search);
        if (_state.category !== 'all') params.set('category', _state.category);
        if (_state.sort !== 'newest')  params.set('sort',     _state.sort);

        var newUrl = window.location.pathname;
        var qs = params.toString();
        if (qs) newUrl += '?' + qs;

        window.history.replaceState({ sp: true }, '', newUrl);
    }

    /* ======================================================================
       FIRESTORE — PAGE CONFIG (settings/shop)
       ====================================================================== */

    function _loadPageConfig() {
        if (!window.db) return;

        window.db.collection('settings').doc('shop').get()
            .then(function (doc) {
                if (!doc.exists) return;
                var d = doc.data();

                // Hero text
                var titleEl = document.getElementById('sp-hero-title');
                var subEl   = document.getElementById('sp-hero-subtitle');
                if (titleEl && d.heroTitle)    titleEl.textContent = d.heroTitle;
                if (subEl   && d.heroSubtitle) subEl.textContent   = d.heroSubtitle;

                // USD rate
                if (d.usdRate) {
                    _state.usdRate = Number(d.usdRate);
                    var rateEl = document.getElementById('sp-usd-rate');
                    if (rateEl) rateEl.textContent = _state.usdRate.toLocaleString();
                }

                // SEO
                _applySEO(d);
            })
            .catch(function (err) {
                console.warn('[NexraShopEngine] Settings load failed (non-fatal):', err.message);
            });
    }

    /**
     * Updates page meta tags from Firestore settings/shop
     * @param {Object} d - Firestore document data
     */
    function _applySEO(d) {
        if (!d) return;
        var set = function (id, val) {
            var el = document.getElementById(id);
            if (el && val) el.content = val;
        };
        if (d.metaTitle) {
            document.getElementById('sp-page-title').textContent = d.metaTitle;
        }
        set('sp-meta-desc', d.metaDesc);
        set('sp-og-title',  d.metaTitle);
        set('sp-og-desc',   d.metaDesc);
        set('sp-og-image',  d.ogImage);
        set('sp-tw-title',  d.metaTitle);
        set('sp-tw-desc',   d.metaDesc);
        set('sp-tw-image',  d.ogImage);

        // Canonical
        if (d.canonicalUrl) {
            var canEl = document.getElementById('sp-canonical');
            if (canEl) canEl.href = d.canonicalUrl;
        }
    }

    /* ======================================================================
       FIRESTORE — CATEGORIES (swimlane pills)
       ====================================================================== */

    function _loadCategories() {
        var track = document.getElementById('sp-cats-track');
        if (!track) return;

        if (!window.db) {
            track.innerHTML = '<div style="color:var(--text-300);font-size:12px;padding:8px;">Categories unavailable offline.</div>';
            return;
        }

        window.db.collection('categories')
            .where('active', '==', true)
            .orderBy('sortOrder', 'asc')
            .get()
            .then(function (snap) {
                var cats = [];
                snap.forEach(function (doc) {
                    cats.push(Object.assign({ id: doc.id }, doc.data()));
                });
                _renderCategories(cats);
            })
            .catch(function (err) {
                console.warn('[NexraShopEngine] Categories load failed:', err.message);
                // Render minimal fallback
                _renderCategories([]);
            });
    }

    function _renderCategories(cats) {
        var track = document.getElementById('sp-cats-track');
        var leftBtn  = document.getElementById('sp-cats-left');
        var rightBtn = document.getElementById('sp-cats-right');
        if (!track) return;

        // Always prepend "All" pill
        var allCats = [{ id: 'all', slug: 'all', label: 'All Products', icon: 'fa-solid fa-store' }].concat(cats);

        track.innerHTML = allCats.map(function (cat) {
            var isActive = cat.slug === _state.category || cat.id === _state.category;
            return '<button class="sp-cat-pill' + (isActive ? ' active' : '') + '" ' +
                   'role="listitem" ' +
                   'onclick="NexraShopEngine._selectCategory(\'' + (cat.slug || cat.id) + '\')" ' +
                   'aria-pressed="' + isActive + '" ' +
                   'aria-label="Filter by ' + _esc(cat.label) + '">' +
                   (cat.icon ? '<i class="' + cat.icon + '" aria-hidden="true"></i>' : '') +
                   _esc(cat.label) +
                   '</button>';
        }).join('');

        // Show arrow buttons on desktop
        if (leftBtn)  leftBtn.removeAttribute('hidden');
        if (rightBtn) rightBtn.removeAttribute('hidden');
    }

    /**
     * Called when a category pill is clicked.
     * @param {string} slug
     */
    function _selectCategory(slug) {
        _state.category = slug;
        _state.lastDoc  = null;

        // Update active pill UI
        document.querySelectorAll('.sp-cat-pill').forEach(function (el) {
            var active = el.textContent.trim().toLowerCase().replace(/ /g, '-') === slug ||
                         el.getAttribute('onclick').includes("'" + slug + "'");
            el.classList.toggle('active', active);
            el.setAttribute('aria-pressed', active);
        });

        _syncURL();
        _loadProducts(false);
    }

    /* ======================================================================
       FIRESTORE — PROMO BANNERS
       ====================================================================== */

    function _loadPromoBanners() {
        var track = document.getElementById('sp-banner-track');
        if (!track || !window.db) {
            if (track) track.innerHTML = '';
            return;
        }

        window.db.collection('banners')
            .where('active', '==', true)
            .orderBy('sortOrder', 'asc')
            .limit(6)
            .get()
            .then(function (snap) {
                if (snap.empty) {
                    // No banners — hide the section entirely
                    var section = document.getElementById('sp-banner-section');
                    if (section) section.style.display = 'none';
                    return;
                }

                var html = '';
                snap.forEach(function (doc) {
                    var b = doc.data();
                    html += '<div class="sp-banner-card" role="listitem" ' +
                            'onclick="NexraShopEngine._bannerCTA(\'' + _esc(b.ctaUrl || '') + '\')" ' +
                            'aria-label="' + _esc(b.badge || 'Promotion') + '">' +
                            '<img class="sp-banner-img" src="' + _esc(b.imageUrl || '') + '" ' +
                            'alt="' + _esc(b.badge || 'Promotional Banner') + '" loading="lazy">' +
                            '<div class="sp-banner-overlay">' +
                            '<div class="sp-banner-content">' +
                            (b.badge ? '<div class="sp-banner-badge"><i class="fa-solid fa-bolt" aria-hidden="true"></i>' + _esc(b.badge) + '</div>' : '') +
                            (b.title ? '<div class="sp-banner-title">' + _esc(b.title) + '</div>' : '') +
                            (b.ctaText ? '<button class="sp-banner-cta" onclick="event.stopPropagation(); NexraShopEngine._bannerCTA(\'' + _esc(b.ctaUrl || '') + '\')">' +
                            _esc(b.ctaText) + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>' : '') +
                            '</div></div></div>';
                });
                track.innerHTML = html;
            })
            .catch(function (err) {
                console.warn('[NexraShopEngine] Banners load failed:', err.message);
                var section = document.getElementById('sp-banner-section');
                if (section) section.style.display = 'none';
            });
    }

    function _bannerCTA(url) {
        if (url) window.location.href = url;
    }

    /* ======================================================================
       FIRESTORE — PRODUCTS (core query + pagination)
       ====================================================================== */

    /**
     * Build and execute the Firestore query based on current _state.
     * @param {boolean} append - if true, load next page; if false, reset
     */
    function _loadProducts(append) {
        if (_state.loading) return;
        _state.loading = true;

        var grid    = document.getElementById('sp-product-grid');
        var emptyEl = document.getElementById('sp-empty-state');
        var errorEl = document.getElementById('sp-error-state');
        var moreWrap = document.getElementById('sp-load-more-wrap');
        var moreBtn  = document.getElementById('sp-load-more-btn');
        var countEl  = document.getElementById('sp-count-text');

        if (!append) {
            // Reset — show skeletons
            _state.lastDoc     = null;
            _state.totalLoaded = 0;
            _state.hasMore     = false;

            if (grid) {
                grid.innerHTML = _buildSkeletonCards(8);
                grid.removeAttribute('hidden');
            }
            if (emptyEl) emptyEl.setAttribute('hidden', '');
            if (errorEl) errorEl.setAttribute('hidden', '');
            if (moreWrap) moreWrap.setAttribute('hidden', '');
            if (countEl)  countEl.textContent = 'Loading products...';
        } else {
            // Load more — show spinner on button
            if (moreBtn) {
                moreBtn.classList.add('loading');
                var icon = moreBtn.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-rotate-right';
            }
        }

        if (!window.db) {
            _handleProductsError({ message: 'Firebase not initialized' }, append);
            return;
        }

        // ── BUILD FIRESTORE QUERY ─────────────────────────────────────────
        var q = window.db.collection('products').where('active', '==', true);

        // Category filter
        if (_state.category && _state.category !== 'all') {
            q = q.where('category', '==', _state.category);
        }

        // Type filter (if multiple, we filter client-side after first type)
        if (_state.typeFilters.length === 1) {
            q = q.where('type', '==', _state.typeFilters[0]);
        }

        // Special boolean filters
        if (_state.onSale)      q = q.where('isSale', '==', true);
        if (_state.isNew)       q = q.where('isNew',  '==', true);
        if (_state.isTrending)  q = q.where('isTrending', '==', true);

        // Sort
        switch (_state.sort) {
            case 'price-asc':
                q = q.orderBy('price', 'asc');
                break;
            case 'price-desc':
                q = q.orderBy('price', 'desc');
                break;
            case 'top-rated':
                q = q.orderBy('rating', 'desc');
                break;
            case 'trending':
                q = q.orderBy('isTrending', 'desc').orderBy('publishedAt', 'desc');
                break;
            case 'name-asc':
                q = q.orderBy('title', 'asc');
                break;
            default: // 'newest'
                q = q.orderBy('publishedAt', 'desc');
        }

        // Pagination cursor
        if (append && _state.lastDoc) {
            q = q.startAfter(_state.lastDoc);
        }

        // Fetch one extra to detect hasMore
        q = q.limit(_PAGE_SIZE + 1);

        q.get()
            .then(function (snap) {
                _state.loading = false;

                var docs  = snap.docs;
                var hasMore = docs.length > _PAGE_SIZE;
                if (hasMore) docs = docs.slice(0, _PAGE_SIZE);
                _state.hasMore = hasMore;
                _state.lastDoc = docs.length > 0 ? docs[docs.length - 1] : _state.lastDoc;

                var products = docs.map(function (doc) {
                    return Object.assign({ id: doc.id }, doc.data());
                });

                // Client-side search filter (Firestore doesn't support full-text)
                if (_state.search) {
                    var q_ = _state.search.toLowerCase();
                    products = products.filter(function (p) {
                        return (p.title || '').toLowerCase().includes(q_) ||
                               (p.description || '').toLowerCase().includes(q_) ||
                               (p.category || '').toLowerCase().includes(q_) ||
                               (Array.isArray(p.keywords) && p.keywords.some(function (k) {
                                   return k.toLowerCase().includes(q_);
                               }));
                    });
                }

                // Client-side price range filter
                if (_state.priceMin !== null) {
                    products = products.filter(function (p) {
                        return Number(p.price) >= _state.priceMin;
                    });
                }
                if (_state.priceMax !== null) {
                    products = products.filter(function (p) {
                        return Number(p.price) <= _state.priceMax;
                    });
                }

                // Client-side stock filter
                if (_state.inStock) {
                    products = products.filter(function (p) {
                        return p.stock === undefined || p.stock === null || Number(p.stock) > 0;
                    });
                }

                // Multiple type filters
                if (_state.typeFilters.length > 1) {
                    products = products.filter(function (p) {
                        return _state.typeFilters.includes(p.type);
                    });
                }

                _renderProducts(products, append);
                _state.totalLoaded += products.length;
                _updateResultCount();

                // Load more
                if (moreWrap) {
                    if (hasMore && products.length > 0) {
                        moreWrap.removeAttribute('hidden');
                        var sub = document.getElementById('sp-load-more-sub');
                        if (sub) sub.textContent = 'Showing ' + _state.totalLoaded + ' products';
                    } else {
                        moreWrap.setAttribute('hidden', '');
                    }
                }
                if (moreBtn) {
                    moreBtn.classList.remove('loading');
                    var icon2 = moreBtn.querySelector('i');
                    if (icon2) icon2.className = 'fa-solid fa-chevron-down';
                }

                // Inject product schema for SEO
                _injectProductSchema(products);
            })
            .catch(function (err) {
                _state.loading = false;
                _handleProductsError(err, append);
            });
    }

    function _handleProductsError(err, append) {
        console.error('[NexraShopEngine] Product load error:', err.message);
        var grid    = document.getElementById('sp-product-grid');
        var errorEl = document.getElementById('sp-error-state');
        var errDesc = document.getElementById('sp-error-desc');
        var moreWrap = document.getElementById('sp-load-more-wrap');

        if (!append) {
            if (grid)    grid.innerHTML = '';
            if (errorEl) { errorEl.removeAttribute('hidden'); }
            if (errDesc) errDesc.textContent = err.message || 'Network error — please check your connection.';
        }
        if (moreWrap) moreWrap.setAttribute('hidden', '');
    }

    /* ======================================================================
       RENDER — PRODUCT CARDS
       ====================================================================== */

    function _renderProducts(products, append) {
        var grid    = document.getElementById('sp-product-grid');
        var emptyEl = document.getElementById('sp-empty-state');
        var emptyDesc = document.getElementById('sp-empty-desc');

        if (!grid) return;

        if (!append) {
            // Clear skeletons first
            grid.innerHTML = '';
        }

        if (products.length === 0 && !append) {
            // Show empty state
            emptyEl && emptyEl.removeAttribute('hidden');
            if (emptyDesc) {
                emptyDesc.textContent = _state.search
                    ? 'No products found for "' + _state.search + '". Try a different search or clear filters.'
                    : 'No products match your current filters. Try adjusting or clearing them.';
            }
            grid.setAttribute('hidden', '');
            return;
        }

        // Ensure grid visible
        grid.removeAttribute('hidden');
        if (emptyEl) emptyEl.setAttribute('hidden', '');

        // Apply view class
        grid.className = 'sp-product-grid' + (_state.view === 'list' ? ' sp-list-view' : '');

        var watermarkSrc = window.NexraBrand ? window.NexraBrand.getAsset('watermark') : '';

        var fragment = document.createDocumentFragment();
        products.forEach(function (p, idx) {
            var el = document.createElement('div');
            el.innerHTML = _buildProductCard(p, watermarkSrc, idx);
            // Append first child (the .sp-product-card)
            while (el.firstChild) {
                fragment.appendChild(el.firstChild);
            }
        });
        grid.appendChild(fragment);
    }

    /**
     * Build HTML string for a single product card.
     * @param {Object} p - product data from Firestore
     * @param {string} watermarkSrc - brand watermark URL
     * @param {number} idx - index for animation delay
     * @returns {string} HTML string
     */
    function _buildProductCard(p, watermarkSrc, idx) {
        var isWishlisted  = _state.wishlistIds.has(p.id);
        var isOutOfStock  = p.stock !== undefined && p.stock !== null && Number(p.stock) <= 0;
        var hasDiscount   = p.salePrice && Number(p.salePrice) < Number(p.price);
        var displayPrice  = hasDiscount ? Number(p.salePrice) : Number(p.price);
        var priceUSD      = (displayPrice / _state.usdRate).toFixed(2);
        var discountPct   = hasDiscount
            ? Math.round((1 - Number(p.salePrice) / Number(p.price)) * 100)
            : 0;
        var imageUrl      = p.imageUrl || p.imageBase64 || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjI1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjI1MCIgZmlsbD0iI2YxZjVmOSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTRhM2I4IiBmb250LXNpemU9IjE0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
        var stars         = _buildStars(p.rating || 0);
        var deliveryLabel = p.deliveryType === 'Instant' ? 'Instant Delivery'
                          : p.deliveryType === 'Manual'  ? 'Manual Delivery' : '';

        // Badges
        var badges = '';
        if (isOutOfStock) {
            badges += '<span class="sp-badge sp-badge-out"><i class="fa-solid fa-circle-xmark"></i> Out of Stock</span>';
        } else {
            if (p.isSale || hasDiscount) badges += '<span class="sp-badge sp-badge-sale"><i class="fa-solid fa-percent"></i> SALE</span>';
            if (p.isNew)       badges += '<span class="sp-badge sp-badge-new"><i class="fa-solid fa-sparkles"></i> NEW</span>';
            if (p.isTrending)  badges += '<span class="sp-badge sp-badge-trending"><i class="fa-solid fa-fire"></i> HOT</span>';
        }

        // Type badge
        var typeBadgeClass = {
            'SaaS':    'sp-badge-saas',
            'Digital': 'sp-badge-digital',
            'Physical':'sp-badge-physical',
            'Bundle':  'sp-badge-saas',
            'Course':  'sp-badge-digital',
        }[p.type] || 'sp-badge-digital';
        if (p.type) {
            badges += '<span class="sp-badge ' + typeBadgeClass + '">' + _esc(p.type) + '</span>';
        }

        var animDelay = Math.min(idx * 60, 400);

        return '<div class="sp-product-card' + (isOutOfStock ? ' sp-out-of-stock' : '') + '" ' +
               'style="animation-delay:' + animDelay + 'ms" ' +
               'data-id="' + p.id + '" ' +
               'onclick="NexraShopEngine.openProductDetail(\'' + p.id + '\')" ' +
               'role="article" ' +
               'aria-label="' + _esc(p.title || '') + '">' +

               // Image container
               '<div class="sp-card-img-wrap">' +
               '<img class="sp-card-img" src="' + _esc(imageUrl) + '" alt="' + _esc(p.title || '') + '" loading="lazy">' +

               // Badges overlay
               '<div class="sp-card-badges" aria-label="Product badges">' + badges + '</div>' +

               // Watermark
               (watermarkSrc ? '<img class="sp-card-watermark nx-brand-watermark" src="' + _esc(watermarkSrc) + '" alt="Nexra" aria-hidden="true">' : '') +

               // Wishlist button
               '<button class="sp-wishlist-btn' + (isWishlisted ? ' wishlisted' : '') + '" ' +
               'onclick="event.stopPropagation(); NexraShopEngine.toggleWishlist(event, \'' + p.id + '\')" ' +
               'aria-label="' + (isWishlisted ? 'Remove from wishlist' : 'Add to wishlist') + '" ' +
               'aria-pressed="' + isWishlisted + '">' +
               '<i class="fa-' + (isWishlisted ? 'solid' : 'regular') + ' fa-heart" aria-hidden="true"></i>' +
               '</button>' +

               '</div>' +

               // Card body
               '<div class="sp-card-body">' +

               // Category
               (p.category ? '<div class="sp-card-cat">' + _esc(p.category) + '</div>' : '') +

               // Title
               '<div class="sp-card-title">' + _esc(p.title || 'Untitled Product') + '</div>' +

               // Rating
               (p.rating ? '<div class="sp-card-rating">' +
               '<div class="sp-stars" aria-label="Rating: ' + p.rating + ' out of 5">' + stars + '</div>' +
               (p.reviewCount ? '<span class="sp-rating-count">(' + p.reviewCount + ')</span>' : '') +
               '</div>' : '') +

               // Pricing
               '<div class="sp-card-pricing">' +
               '<div class="sp-card-price-row">' +
               '<span class="sp-price tech-font">Rs. ' + displayPrice.toLocaleString() + '</span>' +
               (hasDiscount ? '<span class="sp-price-old">Rs. ' + Number(p.price).toLocaleString() + '</span>' : '') +
               (discountPct > 0 ? '<span class="sp-price-discount">-' + discountPct + '%</span>' : '') +
               '</div>' +
               '<span class="sp-price-usd">≈ $' + priceUSD + ' USD</span>' +
               (deliveryLabel ? '<div class="sp-delivery-badge"><i class="fa-solid fa-bolt" aria-hidden="true"></i>' + deliveryLabel + '</div>' : '') +
               '</div>' +

               '</div>' +

               // Action buttons
               '<div class="sp-card-actions">' +
               '<button class="sp-btn-cart" ' +
               'onclick="event.stopPropagation(); NexraApp.addToCart(event, \'' + p.id + '\', ' +
               '\'' + _escJs(p.title) + '\', ' + displayPrice + ', \'' + _escJs(imageUrl) + '\')" ' +
               'aria-label="Add ' + _esc(p.title) + ' to cart">' +
               '<i class="fa-solid fa-bag-shopping" aria-hidden="true"></i> CART' +
               '</button>' +
               '<button class="sp-btn-buy" ' +
               'onclick="event.stopPropagation(); NexraShopEngine._buyNow(\'' + p.id + '\')" ' +
               'aria-label="Buy ' + _esc(p.title) + ' now">' +
               '<i class="fa-solid fa-bolt" aria-hidden="true"></i> BUY NOW' +
               '</button>' +
               '</div>' +

               '</div>';
    }

    /** Build star HTML from 0-5 rating */
    function _buildStars(rating) {
        var html = '';
        for (var i = 1; i <= 5; i++) {
            if (rating >= i) {
                html += '<i class="fa-solid fa-star"></i>';
            } else if (rating >= i - 0.5) {
                html += '<i class="fa-solid fa-star-half-stroke"></i>';
            } else {
                html += '<i class="fa-regular fa-star sp-star-empty"></i>';
            }
        }
        return html;
    }

    /** Build skeleton card HTML (N times) */
    function _buildSkeletonCards(n) {
        var html = '';
        for (var i = 0; i < n; i++) {
            html += '<div class="sp-card-skeleton sp-skeleton-pulse" aria-hidden="true"></div>';
        }
        return html;
    }

    /* ======================================================================
       RESULT COUNT
       ====================================================================== */

    function _updateResultCount() {
        var el = document.getElementById('sp-count-text');
        if (!el) return;
        var txt = _state.totalLoaded + ' product' + (_state.totalLoaded !== 1 ? 's' : '');
        if (_state.search) txt += ' for "' + _state.search + '"';
        if (_state.category !== 'all') txt += ' in ' + _state.category;
        el.textContent = txt;
    }

    /* ======================================================================
       RENDER — SORT OPTIONS & TYPE FILTERS
       ====================================================================== */

    function _renderSortOptions() {
        var sidebarEl = document.getElementById('sp-sidebar-sort');
        var sheetEl   = document.getElementById('sp-sheet-sort-grid');

        var sidebarHtml = '';
        var sheetHtml   = '';

        _SORT_OPTIONS.forEach(function (opt) {
            var isActive = opt.key === _state.sort;
            var cls = 'sp-sort-item' + (isActive ? ' active' : '');

            sidebarHtml += '<button class="' + cls + '" ' +
                'data-sort="' + opt.key + '" ' +
                'onclick="NexraShopEngine._setSort(\'' + opt.key + '\')" ' +
                'aria-pressed="' + isActive + '" ' +
                'aria-label="Sort by ' + opt.label + '">' +
                '<i class="' + opt.icon + '" aria-hidden="true"></i>' +
                opt.label +
                '</button>';

            sheetHtml += '<button class="' + cls + '" ' +
                'data-sort="' + opt.key + '" ' +
                'onclick="NexraShopEngine._setSort(\'' + opt.key + '\')" ' +
                'aria-pressed="' + isActive + '">' +
                '<i class="' + opt.icon + '" aria-hidden="true"></i>' +
                opt.label +
                '</button>';
        });

        if (sidebarEl) sidebarEl.innerHTML = sidebarHtml;
        if (sheetEl)   sheetEl.innerHTML   = sheetHtml;
    }

    function _setSort(key) {
        _state.sort    = key;
        _state.lastDoc = null;
        _renderSortOptions();
        _syncURL();
        _loadProducts(false);
    }

    function _renderTypeFilters() {
        var sidebarEl = document.getElementById('sp-sidebar-type-list');
        var sheetEl   = document.getElementById('sp-sheet-type-list');
        var html = '';

        _TYPE_OPTIONS.forEach(function (opt) {
            var isChecked = _state.typeFilters.includes(opt.value);
            html += '<label class="sp-check-item">' +
                '<input type="checkbox" value="' + opt.value + '" ' +
                (isChecked ? 'checked' : '') +
                ' onchange="NexraShopEngine._toggleTypeFilter(\'' + opt.value + '\', this.checked)" ' +
                'aria-label="Filter by ' + opt.label + '">' +
                '<span class="sp-check-box" aria-hidden="true"></span>' +
                '<i class="' + opt.icon + '" aria-hidden="true" style="font-size:11px;color:var(--brand-main);"></i>' +
                opt.label +
                '</label>';
        });

        if (sidebarEl) sidebarEl.innerHTML = html;
        if (sheetEl)   sheetEl.innerHTML   = html;
    }

    function _toggleTypeFilter(value, checked) {
        if (checked && !_state.typeFilters.includes(value)) {
            _state.typeFilters.push(value);
        } else if (!checked) {
            _state.typeFilters = _state.typeFilters.filter(function (v) { return v !== value; });
        }
        applyFilters();
    }

    /* ======================================================================
       FILTER MANAGEMENT
       ====================================================================== */

    /**
     * Read all current filter values from DOM and trigger product reload.
     * Syncs both sidebar and sheet checkboxes.
     */
    function applyFilters() {
        // On sale
        var saleS = document.getElementById('sp-sidebar-sale');
        var saleH = document.getElementById('sp-sheet-sale');
        _state.onSale = (saleS && saleS.checked) || (saleH && saleH.checked);

        // New
        var newS = document.getElementById('sp-sidebar-new');
        var newH = document.getElementById('sp-sheet-new');
        _state.isNew = (newS && newS.checked) || (newH && newH.checked);

        // Trending
        var trendS = document.getElementById('sp-sidebar-trending');
        var trendH = document.getElementById('sp-sheet-trending');
        _state.isTrending = (trendS && trendS.checked) || (trendH && trendH.checked);

        // In stock
        var stockS = document.getElementById('sp-sidebar-instock');
        var stockH = document.getElementById('sp-sheet-instock');
        _state.inStock = (stockS && stockS.checked) || (stockH && stockH.checked);

        // Price
        var minS = document.getElementById('sp-sidebar-price-min');
        var maxS = document.getElementById('sp-sidebar-price-max');
        var minH = document.getElementById('sp-sheet-price-min');
        var maxH = document.getElementById('sp-sheet-price-max');

        var minVal = (minS && minS.value) || (minH && minH.value) || '';
        var maxVal = (maxS && maxS.value) || (maxH && maxH.value) || '';

        _state.priceMin = minVal !== '' ? Number(minVal) : null;
        _state.priceMax = maxVal !== '' ? Number(maxVal) : null;

        _state.lastDoc = null;
        _renderActiveFilterChips();
        _updateFilterIndicators();
        _loadProducts(false);
    }

    /**
     * Reset all filters to default state.
     */
    function resetFilters() {
        _state.onSale      = false;
        _state.isNew       = false;
        _state.isTrending  = false;
        _state.inStock     = false;
        _state.priceMin    = null;
        _state.priceMax    = null;
        _state.typeFilters = [];
        _state.search      = '';
        _state.sort        = 'newest';
        _state.category    = 'all';
        _state.lastDoc     = null;

        // Clear DOM inputs
        ['sp-sidebar-sale','sp-sidebar-new','sp-sidebar-trending','sp-sidebar-instock',
         'sp-sheet-sale','sp-sheet-new','sp-sheet-trending','sp-sheet-instock'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = false;
        });
        ['sp-sidebar-price-min','sp-sidebar-price-max','sp-sheet-price-min','sp-sheet-price-max'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });

        var searchInput = document.getElementById('sp-search-input');
        if (searchInput) searchInput.value = '';

        _renderSortOptions();
        _renderTypeFilters();
        _renderCategories([]);  // Re-render with all=active
        _loadCategories();

        _renderActiveFilterChips();
        _updateFilterIndicators();
        _syncURL();
        _loadProducts(false);
    }

    /** Show dismissible chips for active filters */
    function _renderActiveFilterChips() {
        var wrap    = document.getElementById('sp-active-filters');
        var chipRow = document.getElementById('sp-chip-row');
        if (!wrap || !chipRow) return;

        var chips = [];

        if (_state.search) {
            chips.push({ label: 'Search: ' + _state.search, action: '_removeChip(\'search\')' });
        }
        if (_state.category !== 'all') {
            chips.push({ label: 'Category: ' + _state.category, action: '_removeChip(\'category\')' });
        }
        if (_state.sort !== 'newest') {
            var sortLabel = (_SORT_OPTIONS.find(function (o) { return o.key === _state.sort; }) || {}).label || _state.sort;
            chips.push({ label: 'Sort: ' + sortLabel, action: '_removeChip(\'sort\')' });
        }
        _state.typeFilters.forEach(function (t) {
            chips.push({ label: 'Type: ' + t, action: '_removeChip(\'type\',\'' + t + '\')' });
        });
        if (_state.onSale)     chips.push({ label: 'On Sale', action: '_removeChip(\'sale\')' });
        if (_state.isNew)      chips.push({ label: 'New Arrivals', action: '_removeChip(\'new\')' });
        if (_state.isTrending) chips.push({ label: 'Trending', action: '_removeChip(\'trending\')' });
        if (_state.inStock)    chips.push({ label: 'In Stock', action: '_removeChip(\'instock\')' });
        if (_state.priceMin !== null || _state.priceMax !== null) {
            var priceLabel = 'Price: ' +
                (_state.priceMin !== null ? 'Rs.' + _state.priceMin : '0') +
                ' — ' +
                (_state.priceMax !== null ? 'Rs.' + _state.priceMax : '∞');
            chips.push({ label: priceLabel, action: '_removeChip(\'price\')' });
        }

        if (chips.length === 0) {
            wrap.setAttribute('hidden', '');
            return;
        }

        wrap.removeAttribute('hidden');
        chipRow.innerHTML = chips.map(function (c) {
            return '<button class="sp-filter-chip" onclick="NexraShopEngine.' + c.action + '" aria-label="Remove ' + _esc(c.label) + ' filter">' +
                   '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
                   _esc(c.label) +
                   '</button>';
        }).join('');
    }

    /** Remove a specific filter chip by type */
    function _removeChip(type, value) {
        switch (type) {
            case 'search':   _state.search = ''; var si = document.getElementById('sp-search-input'); if (si) si.value = ''; break;
            case 'category': _state.category = 'all'; break;
            case 'sort':     _state.sort = 'newest'; _renderSortOptions(); break;
            case 'type':     _state.typeFilters = _state.typeFilters.filter(function (v) { return v !== value; }); _renderTypeFilters(); break;
            case 'sale':     _state.onSale = false; var el = document.getElementById('sp-sidebar-sale'); if (el) el.checked = false; break;
            case 'new':      _state.isNew = false; break;
            case 'trending': _state.isTrending = false; break;
            case 'instock':  _state.inStock = false; break;
            case 'price':    _state.priceMin = null; _state.priceMax = null; break;
        }
        _state.lastDoc = null;
        _renderActiveFilterChips();
        _updateFilterIndicators();
        _syncURL();
        _loadProducts(false);
    }

    /** Update mobile filter button dot indicator */
    function _updateFilterIndicators() {
        var hasActive = _state.onSale || _state.isNew || _state.isTrending || _state.inStock ||
                        _state.priceMin !== null || _state.priceMax !== null ||
                        _state.typeFilters.length > 0;

        var dot = document.getElementById('sp-filter-active-dot');
        if (dot) {
            if (hasActive) dot.removeAttribute('hidden'); else dot.setAttribute('hidden', '');
        }

        // Update count badge in sheet footer
        var total = 0;
        if (_state.onSale)     total++;
        if (_state.isNew)      total++;
        if (_state.isTrending) total++;
        if (_state.inStock)    total++;
        if (_state.priceMin !== null || _state.priceMax !== null) total++;
        total += _state.typeFilters.length;

        var badge = document.getElementById('sp-sheet-count-badge');
        if (badge) {
            if (total > 0) {
                badge.textContent = total;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    /* ======================================================================
       FILTER BOTTOM SHEET (MOBILE)
       ====================================================================== */

    function openFilterSheet() {
        var sheet   = document.getElementById('sp-filter-sheet');
        var overlay = document.getElementById('sp-filter-overlay');
        var btn     = document.getElementById('sp-mobile-filter-btn');

        if (sheet)   sheet.classList.add('open');
        if (overlay) overlay.classList.add('open');
        if (btn)     btn.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    function closeFilterSheet() {
        var sheet   = document.getElementById('sp-filter-sheet');
        var overlay = document.getElementById('sp-filter-overlay');
        var btn     = document.getElementById('sp-mobile-filter-btn');

        if (sheet)   sheet.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
        if (btn)     btn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    /* ======================================================================
       SEARCH
       ====================================================================== */

    function _initSearch() {
        var input  = document.getElementById('sp-search-input');
        var submit = document.getElementById('sp-search-submit');

        if (!input) return;

        // Debounced keyup → live dropdown suggestions
        input.addEventListener('input', function () {
            clearTimeout(_state.searchDebounce);
            var q = input.value.trim();

            if (!q) {
                _hideSearchDropdown();
                return;
            }

            _state.searchDebounce = setTimeout(function () {
                _fetchSearchSuggestions(q);
            }, 280);
        });

        // Enter key → execute full search
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeSearch();
            }
            if (e.key === 'Escape') {
                _hideSearchDropdown();
                input.blur();
            }
        });

        // Close dropdown on outside click
        document.addEventListener('click', function (e) {
            var wrap = document.getElementById('sp-search-wrap');
            if (wrap && !wrap.contains(e.target)) {
                _hideSearchDropdown();
            }
        });
    }

    /**
     * Fetch product suggestions matching query from Firestore.
     * Uses 'keywords' array-contains for matching.
     * @param {string} q
     */
    function _fetchSearchSuggestions(q) {
        if (!window.db) return;

        // Search by keywords array-contains (Firestore limitation: single keyword)
        var qLower = q.toLowerCase().split(' ')[0]; // use first word for Firestore query

        window.db.collection('products')
            .where('active', '==', true)
            .where('keywords', 'array-contains', qLower)
            .limit(5)
            .get()
            .then(function (snap) {
                var results = [];
                snap.forEach(function (doc) {
                    var d = Object.assign({ id: doc.id }, doc.data());
                    // Also do client-side full q match for multi-word
                    if ((d.title || '').toLowerCase().includes(q.toLowerCase()) ||
                        (d.description || '').toLowerCase().includes(q.toLowerCase()) ||
                        results.length < 5) {
                        results.push(d);
                    }
                });
                _renderSearchDropdown(results, q);
            })
            .catch(function () {
                // Fallback: title prefix search
                window.db.collection('products')
                    .where('active', '==', true)
                    .orderBy('title')
                    .startAt(q)
                    .endAt(q + '\uf8ff')
                    .limit(5)
                    .get()
                    .then(function (snap2) {
                        var r = [];
                        snap2.forEach(function (d) { r.push(Object.assign({ id: d.id }, d.data())); });
                        _renderSearchDropdown(r, q);
                    })
                    .catch(function () {
                        _hideSearchDropdown();
                    });
            });
    }

    function _renderSearchDropdown(results, query) {
        var dropdown = document.getElementById('sp-search-dropdown');
        var input    = document.getElementById('sp-search-input');
        if (!dropdown) return;

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="sp-suggest-no-results"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> No results for "' + _esc(query) + '"</div>';
            dropdown.removeAttribute('hidden');
            if (input) input.setAttribute('aria-expanded', 'true');
            return;
        }

        dropdown.innerHTML = results.map(function (p) {
            var img = p.imageUrl || p.imageBase64 || '';
            var price = p.salePrice || p.price;
            return '<div class="sp-suggest-item" ' +
                   'onclick="NexraShopEngine.openProductDetail(\'' + p.id + '\')" ' +
                   'role="option" ' +
                   'aria-selected="false">' +
                   '<img class="sp-suggest-img" src="' + _esc(img) + '" alt="' + _esc(p.title || '') + '" loading="lazy">' +
                   '<div class="sp-suggest-info">' +
                   '<div class="sp-suggest-title">' + _esc(p.title || '') + '</div>' +
                   (price ? '<div class="sp-suggest-price">Rs. ' + Number(price).toLocaleString() + '</div>' : '') +
                   '</div>' +
                   '</div>';
        }).join('');

        dropdown.removeAttribute('hidden');
        if (input) input.setAttribute('aria-expanded', 'true');
    }

    function _hideSearchDropdown() {
        var dropdown = document.getElementById('sp-search-dropdown');
        var input    = document.getElementById('sp-search-input');
        if (dropdown) dropdown.setAttribute('hidden', '');
        if (input)    input.setAttribute('aria-expanded', 'false');
    }

    /**
     * Execute a full search: update state, reload products.
     */
    function executeSearch() {
        var input = document.getElementById('sp-search-input');
        if (!input) return;
        _state.search  = input.value.trim();
        _state.lastDoc = null;
        _hideSearchDropdown();
        _syncURL();
        _loadProducts(false);
    }

    /* ======================================================================
       VOICE SEARCH (Web Speech API)
       ====================================================================== */

    function startVoiceSearch() {
        var voiceBtn = document.getElementById('sp-voice-btn');
        var input    = document.getElementById('sp-search-input');

        var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
            NexraApp.showToast('Voice search not supported in this browser.', 'fa-solid fa-microphone-slash', 'default');
            return;
        }

        if (_state.voiceActive) {
            if (_state.recognition) _state.recognition.stop();
            return;
        }

        _state.voiceActive  = true;
        _state.recognition  = new SpeechRec();
        var rec = _state.recognition;

        rec.lang           = 'en-US';
        rec.interimResults = true;
        rec.maxAlternatives= 1;

        if (voiceBtn) {
            voiceBtn.classList.add('listening');
            voiceBtn.setAttribute('aria-label', 'Stop voice search');
        }
        NexraApp.showToast('Listening... speak now', 'fa-solid fa-microphone', 'success');

        rec.onresult = function (event) {
            var transcript = '';
            for (var i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            if (input) input.value = transcript;
        };

        rec.onend = function () {
            _state.voiceActive = false;
            if (voiceBtn) {
                voiceBtn.classList.remove('listening');
                voiceBtn.setAttribute('aria-label', 'Search by voice');
            }
            if (input && input.value.trim()) {
                executeSearch();
            }
        };

        rec.onerror = function (e) {
            _state.voiceActive = false;
            if (voiceBtn) voiceBtn.classList.remove('listening');
            NexraApp.showToast('Voice search error: ' + e.error, 'fa-solid fa-microphone-slash', 'default');
        };

        rec.start();
    }

    /* ======================================================================
       PAGINATION
       ====================================================================== */

    function loadMoreProducts() {
        if (!_state.hasMore || _state.loading) return;
        _loadProducts(true);
    }

    function retryLoad() {
        _loadProducts(false);
    }

    /* ======================================================================
       VIEW TOGGLE (grid / list)
       ====================================================================== */

    function setView(type) {
        _state.view = type;

        var grid = document.getElementById('sp-product-grid');
        if (grid) {
            grid.className = 'sp-product-grid' + (type === 'list' ? ' sp-list-view' : '');
        }

        var gBtn = document.getElementById('sp-view-grid');
        var lBtn = document.getElementById('sp-view-list');
        if (gBtn) gBtn.classList.toggle('active', type === 'grid');
        if (lBtn) lBtn.classList.toggle('active', type === 'list');

        localStorage.setItem('nexra_shop_view', type);
    }

    /* ======================================================================
       PRODUCT DETAIL NAVIGATION
       ====================================================================== */

    function openProductDetail(id) {
        NexraApp.navTo('product-detail', id);
    }

    function _buyNow(id) {
        // Add to cart then immediately go to checkout
        var grid = document.getElementById('sp-product-grid');
        if (!grid || !window.db) {
            NexraApp.navTo('product-detail', id);
            return;
        }

        window.db.collection('products').doc(id).get().then(function (doc) {
            if (!doc.exists) { NexraApp.navTo('product-detail', id); return; }
            var p = doc.data();
            var price = p.salePrice || p.price;
            var img   = p.imageUrl || p.imageBase64 || '';
            NexraApp.addToCart(null, id, p.title, price, img);
            NexraApp.navTo('checkout');
        }).catch(function () {
            NexraApp.navTo('product-detail', id);
        });
    }

    /* ======================================================================
       WISHLIST
       ====================================================================== */

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user) {
                _loadWishlist(user.uid);
            }
        });
    }

    function _loadWishlist(uid) {
        if (!window.db || !uid) return;
        window.db.collection('users').doc(uid).collection('wishlist').get()
            .then(function (snap) {
                _state.wishlistIds = new Set();
                snap.forEach(function (doc) { _state.wishlistIds.add(doc.id); });
                _refreshWishlistUI();
            })
            .catch(function () {});
    }

    function _refreshWishlistUI() {
        document.querySelectorAll('.sp-wishlist-btn').forEach(function (btn) {
            var card = btn.closest('.sp-product-card');
            if (!card) return;
            var id = card.getAttribute('data-id');
            var isW = _state.wishlistIds.has(id);
            btn.classList.toggle('wishlisted', isW);
            btn.setAttribute('aria-pressed', isW);
            var icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-' + (isW ? 'solid' : 'regular') + ' fa-heart';
        });
    }

    /**
     * Toggle wishlist state for a product.
     * Requires authentication — shows toast if guest.
     */
    function toggleWishlist(e, id) {
        if (e) e.stopPropagation();

        if (!_state.currentUser) {
            NexraApp.showToast('Please sign in to save to wishlist.', 'fa-solid fa-heart', 'default');
            return;
        }

        var uid = _state.currentUser.uid;
        var isW = _state.wishlistIds.has(id);
        var wishlistRef = window.db.collection('users').doc(uid).collection('wishlist').doc(id);

        if (isW) {
            _state.wishlistIds.delete(id);
            wishlistRef.delete().catch(function () {});
            NexraApp.showToast('Removed from wishlist.', 'fa-regular fa-heart', 'default');
        } else {
            _state.wishlistIds.add(id);
            wishlistRef.set({
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function () {});
            NexraApp.showToast('Added to wishlist!', 'fa-solid fa-heart', 'success');
        }
        _refreshWishlistUI();
    }

    /* ======================================================================
       CATEGORY SWIMLANE ARROWS (desktop scroll)
       ====================================================================== */

    function scrollCats(dir) {
        var track = document.getElementById('sp-cats-track');
        if (track) {
            track.scrollBy({ left: dir * 200, behavior: 'smooth' });
        }
    }

    /* ======================================================================
       JSON-LD PRODUCT SCHEMA INJECTION (SEO)
       ====================================================================== */

    /**
     * Inject Product schema into page for first N products.
     * Replaces the itemListElement array in the existing LD-JSON.
     */
    function _injectProductSchema(products) {
        try {
            var scriptEl = document.getElementById('sp-ld-website');
            if (!scriptEl) return;
            var graph = JSON.parse(scriptEl.textContent);

            // Find the ItemList entry
            var listEntry = graph['@graph'].find(function (e) { return e['@type'] === 'ItemList'; });
            if (!listEntry) return;

            listEntry.numberOfItems  = products.length;
            listEntry.itemListElement = products.slice(0, 10).map(function (p, idx) {
                return {
                    '@type':    'ListItem',
                    'position': idx + 1,
                    'url':      (window.NexraRoutes ? window.NexraRoutes.baseUrl : 'https://nexratech.pk') + '/shop/product-detail.html?id=' + p.id,
                    'name':     p.title || '',
                    'item': {
                        '@type':       'Product',
                        'name':        p.title || '',
                        'image':       p.imageUrl || '',
                        'description': p.description || '',
                        'offers': {
                            '@type':         'Offer',
                            'price':         p.salePrice || p.price,
                            'priceCurrency': 'PKR',
                            'availability':  (p.stock > 0 || p.stock === undefined)
                                             ? 'https://schema.org/InStock'
                                             : 'https://schema.org/OutOfStock'
                        }
                    }
                };
            });

            scriptEl.textContent = JSON.stringify(graph, null, 2);
        } catch (e) {
            // Non-critical — silent fail
        }
    }

    /* ======================================================================
       UTILITY FUNCTIONS
       ====================================================================== */

    /** HTML-escape a value for use in attribute/text contexts */
    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** JS-string-escape for use inside onclick='...' string args */
    function _escJs(str) {
        if (!str) return '';
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init:             init,
        executeSearch:    executeSearch,
        startVoiceSearch: startVoiceSearch,
        applyFilters:     applyFilters,
        resetFilters:     resetFilters,
        loadMoreProducts: loadMoreProducts,
        retryLoad:        retryLoad,
        setView:          setView,
        openFilterSheet:  openFilterSheet,
        closeFilterSheet: closeFilterSheet,
        scrollCats:       scrollCats,
        toggleWishlist:   toggleWishlist,
        openProductDetail:openProductDetail,
        // Internal methods exposed for onclick attrs
        _selectCategory:  _selectCategory,
        _removeChip:      _removeChip,
        _setSort:         _setSort,
        _toggleTypeFilter:_toggleTypeFilter,
        _bannerCTA:       _bannerCTA,
        _buyNow:          _buyNow,
    };

})();
