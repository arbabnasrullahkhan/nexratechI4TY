/**
 * ==========================================================================
 * NEXRA TECH PK — PRODUCT DETAIL ENGINE (js/product-detail.js)
 * ==========================================================================
 * Namespace: window.NexraPDP
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on shop/product-detail.html
 *
 * FIRESTORE COLLECTIONS:
 *   products/{id}       — main product document
 *   users/{uid}/wishlist — per-user wishlist
 * ==========================================================================
 */

window.NexraPDP = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        productId:   null,
        productData: null,
        usdRate:     280,
        currentUser: null,
        wishlistIds: new Set(),
        aiChatOpen:  false,
        // OpenRouter config (stubbed key for security, replace in prod)
        openRouterKey: 'sk-or-v1-xxxxxxxxxxxx', 
        chatHistory: []
    };

    /* ======================================================================
       INIT
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraPDP] Initializing...');

        var params = new URLSearchParams(window.location.search);
        _state.productId = params.get('id');

        if (!_state.productId) {
            _showError('No product ID specified in URL.');
            return;
        }

        _loadConfigAndProduct();
        _subscribeAuth();
        _initAntiScraping();
        _startFOMOTickers();

        // Mobile island scroll observer
        window.addEventListener('scroll', _handleScrollIsland, { passive: true });
    }

    /* ======================================================================
       FIRESTORE FETCH & RENDER
       ====================================================================== */
    function _loadConfigAndProduct() {
        if (!window.db) {
            _showError('Firebase not initialized.');
            return;
        }

        // Parallel fetch for shop settings (for USD rate) and product data
        Promise.all([
            window.db.collection('settings').doc('shop').get(),
            window.db.collection('products').doc(_state.productId).get()
        ]).then(function (results) {
            var settingsDoc = results[0];
            var productDoc  = results[1];

            if (settingsDoc.exists && settingsDoc.data().usdRate) {
                _state.usdRate = Number(settingsDoc.data().usdRate);
            }

            if (!productDoc.exists || productDoc.data().active === false) {
                _showError('Product not found or inactive.');
                return;
            }

            _state.productData = Object.assign({ id: productDoc.id }, productDoc.data());
            _renderProduct();
            _applySEO();
            _injectJSONLD();
            
            // Pre-feed AI
            _state.chatHistory.push({
                role: 'system',
                content: 'You are Nexra AI, an assistant for Nexra Tech PK. You must answer questions about this product only. Product Name: ' + 
                         _state.productData.title + '. Description: ' + _state.productData.description + '. Price: Rs. ' + 
                         (_state.productData.salePrice || _state.productData.price) + '. Reply in English or Urdu.'
            });

        }).catch(function (err) {
            console.error('[NexraPDP] Load failed:', err);
            _showError('Failed to load product details.');
        });
    }

    function _renderProduct() {
        var p = _state.productData;

        // Breadcrumbs
        var bread = document.getElementById('pd-breadcrumbs');
        if (bread) {
            bread.innerHTML = '<a href="/index.html">Home</a> <span>/</span> ' +
                              '<a href="/shop/shop.html">Shop</a> <span>/</span> ' +
                              (p.category ? '<a href="/shop/shop.html?category=' + _esc(p.category) + '">' + _esc(p.category) + '</a> <span>/</span> ' : '') +
                              '<span style="color:var(--text-100)">' + _esc(p.title) + '</span>';
        }

        // Title
        var titleEl = document.getElementById('pd-title');
        if (titleEl) titleEl.textContent = p.title || 'Untitled Product';

        // Rating
        var ratingEl = document.getElementById('pd-rating-row');
        if (ratingEl) {
            var rHtml = _buildStars(p.rating || 0);
            rHtml += ' <span style="font-weight:600; color:var(--text-100);">' + (p.rating || '0.0') + '</span>';
            if (p.reviewCount) rHtml += ' <span>(' + p.reviewCount + ' reviews)</span>';
            ratingEl.innerHTML = rHtml;
        }

        // Badges
        var badgesEl = document.getElementById('pd-badges-row');
        if (badgesEl) {
            var badgesHtml = '';
            var typeClass = {
                'SaaS': 'sp-badge-saas', 'Digital': 'sp-badge-digital', 'Physical': 'sp-badge-physical'
            }[p.type] || 'sp-badge-digital';
            
            if (p.type) badgesHtml += '<span class="sp-badge ' + typeClass + '">' + _esc(p.type) + '</span>';
            if (p.isSale) badgesHtml += '<span class="sp-badge sp-badge-sale"><i class="fa-solid fa-percent"></i> SALE</span>';
            if (p.isNew) badgesHtml += '<span class="sp-badge sp-badge-new"><i class="fa-solid fa-sparkles"></i> NEW</span>';
            if (p.isTrending) badgesHtml += '<span class="sp-badge sp-badge-trending"><i class="fa-solid fa-fire"></i> HOT</span>';
            badgesEl.innerHTML = badgesHtml;
        }

        // Pricing
        var hasDiscount = p.salePrice && Number(p.salePrice) < Number(p.price);
        var displayPrice = hasDiscount ? Number(p.salePrice) : Number(p.price);
        var usdPrice = (displayPrice / _state.usdRate).toFixed(2);
        
        var priceBox = document.getElementById('pd-price-box');
        if (priceBox) {
            priceBox.innerHTML = '<div class="pd-price">Rs. ' + displayPrice.toLocaleString() +
                                 (hasDiscount ? '<span class="pd-old-price">Rs. ' + Number(p.price).toLocaleString() + '</span>' : '') +
                                 '</div>' +
                                 '<div class="pd-usd-price">≈ $' + usdPrice + ' USD</div>';
        }
        var islandPrice = document.getElementById('pd-island-price');
        if (islandPrice) islandPrice.textContent = 'Rs. ' + displayPrice.toLocaleString();

        // Loyalty (Nexra Coins = 1% of price roughly)
        var loyaltyStrip = document.getElementById('pd-loyalty-strip');
        var coinsEarned  = document.getElementById('pd-coins-earned');
        if (loyaltyStrip && coinsEarned) {
            var coins = Math.floor(displayPrice * 0.01);
            if (coins > 0) {
                coinsEarned.textContent = coins;
                loyaltyStrip.removeAttribute('hidden');
            }
        }

        // Short Desc
        var shortDesc = document.getElementById('pd-short-desc');
        if (shortDesc) shortDesc.textContent = p.description || '';

        // Long Desc (HTML)
        var longDesc = document.getElementById('pd-long-desc');
        if (longDesc) {
            longDesc.innerHTML = p.htmlDescription || '<p>' + _esc(p.description) + '</p>';
        }

        // Dynamic Type Info (Physical vs Digital)
        var typeInfo = document.getElementById('pd-type-info');
        if (typeInfo) {
            if (p.type === 'Physical') {
                typeInfo.innerHTML = '<div class="pd-type-info-title"><i class="fa-solid fa-truck-fast"></i> Shipping & Delivery</div>' +
                                     '<div class="pd-type-info-text">TCS/Leopards Courier. Delivery in 3-5 business days.</div>';
                if (p.stock > 0 && p.stock <= 5) {
                    typeInfo.innerHTML += '<div style="color:var(--danger); font-size:12px; font-weight:700; margin-top:8px;"><i class="fa-solid fa-triangle-exclamation"></i> Only ' + p.stock + ' left in stock!</div>';
                }
            } else {
                typeInfo.innerHTML = '<div class="pd-type-info-title"><i class="fa-solid fa-bolt"></i> Instant Digital Delivery</div>' +
                                     '<div class="pd-type-info-text">License key & access instructions sent to your email immediately upon payment.</div>';
            }
        }

        // Media Gallery
        var galleryMain = document.getElementById('pd-gallery-main');
        var mainImg = p.imageUrl || p.imageBase64 || '';
        if (galleryMain && mainImg) {
            // Check if it's an MP4 (simplified check)
            if (mainImg.toLowerCase().endsWith('.mp4')) {
                galleryMain.innerHTML = '<video src="' + _esc(mainImg) + '" autoplay loop muted playsinline></video>';
            } else {
                galleryMain.innerHTML = '<img src="' + _esc(mainImg) + '" id="pd-main-img-src" alt="' + _esc(p.title) + '">';
            }
        }

        // Download button logic
        var dlBtn = document.getElementById('pd-download-btn');
        if (dlBtn && (p.imageUrl || p.imageBase64)) {
            dlBtn.style.display = 'block';
        }

        // Thumbs (mock for now if array not provided, just repeat main)
        var thumbsEl = document.getElementById('pd-gallery-thumbs');
        if (thumbsEl) {
            var mediaArr = p.mediaGallery || [mainImg];
            thumbsEl.innerHTML = mediaArr.map(function(m, idx) {
                var isVid = m.toLowerCase().endsWith('.mp4');
                var active = idx === 0 ? 'active' : '';
                return '<div class="pd-thumb ' + active + '" onclick="NexraPDP._setMainMedia(\'' + _escJs(m) + '\', this)">' +
                       (isVid ? '<video src="' + _esc(m) + '" muted></video>' : '<img src="' + _esc(m) + '">') +
                       '</div>';
            }).join('');
        }

        // Enable buttons
        var isOutOfStock = p.stock !== undefined && p.stock !== null && Number(p.stock) <= 0;
        var btnBuy = document.getElementById('pd-btn-buy');
        var btnCart = document.getElementById('pd-btn-cart');
        var islandBuy = document.getElementById('pd-island-buy');

        if (isOutOfStock) {
            if (btnBuy) { btnBuy.innerHTML = 'OUT OF STOCK'; btnBuy.disabled = true; }
            if (btnCart) { btnCart.innerHTML = 'OUT OF STOCK'; btnCart.disabled = true; }
            if (islandBuy) { islandBuy.innerHTML = 'OUT OF STOCK'; islandBuy.disabled = true; }
        } else {
            if (btnBuy) btnBuy.disabled = false;
            if (btnCart) btnCart.disabled = false;
            if (islandBuy) islandBuy.disabled = false;
        }

        // Affiliate link
        var affLink = document.getElementById('pd-affiliate-link');
        if (affLink) {
            var uidPart = _state.currentUser ? '&ref=' + _state.currentUser.uid : '';
            affLink.value = window.location.origin + window.location.pathname + '?id=' + _state.productId + uidPart;
        }
    }

    function _setMainMedia(url, thumbEl) {
        var galleryMain = document.getElementById('pd-gallery-main');
        if (!galleryMain) return;
        
        if (url.toLowerCase().endsWith('.mp4')) {
            galleryMain.innerHTML = '<video src="' + _esc(url) + '" autoplay loop muted playsinline></video>';
        } else {
            galleryMain.innerHTML = '<img src="' + _esc(url) + '" id="pd-main-img-src" alt="Media">';
        }

        document.querySelectorAll('.pd-thumb').forEach(function(el) { el.classList.remove('active'); });
        thumbEl.classList.add('active');
    }
    window.NexraPDP._setMainMedia = _setMainMedia;

    function _buildStars(rating) {
        var html = '';
        for (var i = 1; i <= 5; i++) {
            if (rating >= i) html += '<i class="fa-solid fa-star"></i>';
            else if (rating >= i - 0.5) html += '<i class="fa-solid fa-star-half-stroke"></i>';
            else html += '<i class="fa-regular fa-star" style="color:var(--text-400);"></i>';
        }
        return html;
    }

    function _showError(msg) {
        var overlay = document.getElementById('pd-error-overlay');
        if (overlay) {
            overlay.removeAttribute('hidden');
            var desc = overlay.querySelector('p');
            if (desc) desc.textContent = msg;
        }
    }

    /* ======================================================================
       SEO & SCHEMA
       ====================================================================== */
    function _applySEO() {
        var p = _state.productData;
        var set = function(id, val, attr) {
            var el = document.getElementById(id);
            if (el && val) el.setAttribute(attr || 'content', val);
        };
        var title = p.title + ' | Nexra Tech PK';
        document.getElementById('pd-page-title').textContent = title;
        set('pd-meta-desc', p.description);
        set('pd-og-title', title);
        set('pd-og-desc', p.description);
        set('pd-tw-title', title);
        set('pd-tw-desc', p.description);
        
        var img = p.imageUrl || p.imageBase64 || '';
        set('pd-og-image', img);
        set('pd-tw-image', img);
        set('pd-og-price', p.salePrice || p.price);
        
        set('pd-canonical', window.location.href, 'href');
        set('pd-og-url', window.location.href);
    }

    function _injectJSONLD() {
        var p = _state.productData;
        var script = document.getElementById('pd-ld-schema');
        if (!script) return;
        
        var schema = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": p.title,
            "image": p.imageUrl || p.imageBase64 || "",
            "description": p.description,
            "brand": {
                "@type": "Brand",
                "name": "Nexra Tech PK"
            },
            "offers": {
                "@type": "Offer",
                "url": window.location.href,
                "priceCurrency": "PKR",
                "price": p.salePrice || p.price,
                "availability": (p.stock === undefined || p.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "itemCondition": "https://schema.org/NewCondition"
            }
        };
        if (p.rating) {
            schema.aggregateRating = {
                "@type": "AggregateRating",
                "ratingValue": p.rating,
                "reviewCount": p.reviewCount || 1
            };
        }
        script.textContent = JSON.stringify(schema);
    }

    /* ======================================================================
       ACTIONS
       ====================================================================== */
    function addToCart(e) {
        if (e) e.stopPropagation();
        var p = _state.productData;
        if (!p) return;
        var price = p.salePrice || p.price;
        var img = p.imageUrl || p.imageBase64 || '';
        window.NexraApp.addToCart(e, p.id, p.title, price, img);
    }

    function buyNow() {
        var p = _state.productData;
        if (!p) return;
        var price = p.salePrice || p.price;
        var img = p.imageUrl || p.imageBase64 || '';
        window.NexraApp.addToCart(null, p.id, p.title, price, img);
        window.NexraApp.navTo('checkout');
    }

    function openWhatsApp() {
        var p = _state.productData;
        if (!p) return;
        // Business WA number placeholder
        var phone = "923000000000"; 
        var text = encodeURIComponent("Hi Nexra Tech, I want to buy: " + p.title + " (URL: " + window.location.href + ")");
        window.open('https://wa.me/' + phone + '?text=' + text, '_blank');
    }

    function copyAffiliateLink() {
        var input = document.getElementById('pd-affiliate-link');
        if (!input || input.value === 'Loading...') return;
        input.select();
        document.execCommand('copy');
        window.NexraApp.showToast('Affiliate link copied!', 'fa-solid fa-link', 'success');
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
            // Update affiliate link if available
            var affLink = document.getElementById('pd-affiliate-link');
            if (affLink && _state.productData) {
                var uidPart = user ? '&ref=' + user.uid : '';
                affLink.value = window.location.origin + window.location.pathname + '?id=' + _state.productId + uidPart;
            }
        });
    }

    function _loadWishlist(uid) {
        if (!window.db) return;
        window.db.collection('users').doc(uid).collection('wishlist').doc(_state.productId).get()
            .then(function (doc) {
                if (doc.exists) {
                    _state.wishlistIds.add(_state.productId);
                    _refreshWishlistUI();
                }
            }).catch(function () {});
    }

    function _refreshWishlistUI() {
        var btn = document.getElementById('pd-btn-wishlist');
        if (!btn) return;
        var isW = _state.wishlistIds.has(_state.productId);
        btn.classList.toggle('active', isW);
        var icon = btn.querySelector('i');
        if (icon) icon.className = 'fa-' + (isW ? 'solid' : 'regular') + ' fa-heart';
    }

    function toggleWishlist(e) {
        if (e) e.stopPropagation();
        if (!_state.currentUser) {
            window.NexraApp.showToast('Please sign in to save to wishlist.', 'fa-solid fa-heart', 'default');
            return;
        }
        var uid = _state.currentUser.uid;
        var isW = _state.wishlistIds.has(_state.productId);
        var ref = window.db.collection('users').doc(uid).collection('wishlist').doc(_state.productId);

        if (isW) {
            _state.wishlistIds.delete(_state.productId);
            ref.delete().catch(function(){});
            window.NexraApp.showToast('Removed from wishlist.', 'fa-regular fa-heart', 'default');
        } else {
            _state.wishlistIds.add(_state.productId);
            ref.set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function(){});
            window.NexraApp.showToast('Added to wishlist!', 'fa-solid fa-heart', 'success');
        }
        _refreshWishlistUI();
    }

    /* ======================================================================
       ANTI-SCRAPING & WATERMARKING
       ====================================================================== */
    function _initAntiScraping() {
        // Handled via oncontextmenu/ondragstart on the HTML container,
        // but adding listener directly to images just in case.
        document.addEventListener('contextmenu', function(e) {
            if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
                e.preventDefault();
            }
        });
        document.addEventListener('dragstart', function(e) {
            if (e.target.tagName === 'IMG') e.preventDefault();
        });
    }

    function downloadWatermarkedImage() {
        var p = _state.productData;
        if (!p) return;
        var imgSrc = document.getElementById('pd-main-img-src');
        if (!imgSrc) {
            window.NexraApp.showToast('Cannot download this media type.', 'fa-solid fa-triangle-exclamation', 'default');
            return;
        }

        var canvas = document.getElementById('pd-watermark-canvas');
        var ctx = canvas.getContext('2d');
        
        var img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = imgSrc.src;
        
        img.onload = function() {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Watermark Logo
            var wmUrl = window.NexraBrand ? window.NexraBrand.getAsset('watermark') : '';
            if (wmUrl) {
                var wmImg = new Image();
                wmImg.crossOrigin = 'Anonymous';
                wmImg.src = wmUrl;
                wmImg.onload = function() {
                    var wmWidth = canvas.width * 0.2;
                    var wmHeight = (wmImg.height / wmImg.width) * wmWidth;
                    ctx.globalAlpha = 0.5;
                    ctx.drawImage(wmImg, canvas.width - wmWidth - 20, canvas.height - wmHeight - 20, wmWidth, wmHeight);
                    _triggerDownload(canvas, p.title);
                };
                wmImg.onerror = function() {
                    _drawTextWatermark(canvas, ctx);
                    _triggerDownload(canvas, p.title);
                };
            } else {
                _drawTextWatermark(canvas, ctx);
                _triggerDownload(canvas, p.title);
            }
        };
        img.onerror = function() {
            window.NexraApp.showToast('Error generating secure image (CORS).', 'fa-solid fa-triangle-exclamation', 'default');
        };
    }

    function _drawTextWatermark(canvas, ctx) {
        ctx.globalAlpha = 0.6;
        ctx.font = 'bold ' + (canvas.width * 0.05) + 'px Space Grotesk';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        ctx.fillText('NEXRA TECH PK', canvas.width - 20, canvas.height - 30);
    }

    function _triggerDownload(canvas, title) {
        var link = document.createElement('a');
        link.download = (title || 'nexra-product').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        window.NexraApp.showToast('Secure image downloaded', 'fa-solid fa-check', 'success');
    }

    /* ======================================================================
       FOMO MECHANICS
       ====================================================================== */
    function _startFOMOTickers() {
        // Random viewer count
        var vCount = document.getElementById('pd-viewer-count');
        if (vCount) {
            var updateViewers = function() {
                var current = parseInt(vCount.textContent) || Math.floor(Math.random() * 15) + 5;
                var change = Math.random() > 0.5 ? 1 : -1;
                var next = Math.max(3, current + change); // Keep minimum 3
                vCount.textContent = next;
            };
            updateViewers();
            setInterval(updateViewers, 7000);
        }

        // Live Sales Ticker Pop-up
        setTimeout(_triggerSalesTicker, 10000 + Math.random() * 10000);
    }

    function _triggerSalesTicker() {
        var ticker = document.getElementById('pd-sales-ticker');
        var p = _state.productData;
        if (!ticker || !p) return;

        var names = ['Ali R.', 'Sarah K.', 'Usman Q.', 'Fatima Z.', 'Ahmed M.'];
        var times = ['Just now', '2 minutes ago', '5 minutes ago'];
        var name = names[Math.floor(Math.random() * names.length)];
        var time = times[Math.floor(Math.random() * times.length)];

        document.getElementById('pd-ticker-img').src = p.imageUrl || p.imageBase64 || '';
        document.getElementById('pd-ticker-title').textContent = name + ' just bought this';
        document.getElementById('pd-ticker-time').textContent = 'Verified purchase • ' + time;

        ticker.classList.add('show');
        
        setTimeout(function() {
            ticker.classList.remove('show');
            setTimeout(_triggerSalesTicker, 30000 + Math.random() * 60000); // Schedule next
        }, 5000);
    }

    /* ======================================================================
       TRIPLE-AI CHAT WIDGET
       ====================================================================== */
    function toggleAIChat() {
        var panel = document.getElementById('pd-ai-chat-panel');
        if (!panel) return;
        _state.aiChatOpen = !_state.aiChatOpen;
        panel.classList.toggle('open', _state.aiChatOpen);
        if (_state.aiChatOpen) {
            var input = document.getElementById('pd-ai-input');
            if (input) input.focus();
        }
    }

    function sendAIMessage() {
        var input = document.getElementById('pd-ai-input');
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;
        
        input.value = '';
        _appendChatMessage('user', text);
        
        // Add user msg to history
        _state.chatHistory.push({ role: 'user', content: text });

        // Show typing indicator
        var typingId = 'typing-' + Date.now();
        _appendChatMessage('system', '<i class="fa-solid fa-ellipsis fa-fade"></i> AI is thinking...', typingId);

        // OpenRouter Fetch
        fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + _state.openRouterKey,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Nexra Tech PK',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/gemma-7b-it:free', // Using free tier model as fallback
                messages: _state.chatHistory
            })
        })
        .then(function(res) {
            if (!res.ok) throw new Error('API Error');
            return res.json();
        })
        .then(function(data) {
            var reply = data.choices[0].message.content;
            _state.chatHistory.push({ role: 'assistant', content: reply });
            _removeChatMessage(typingId);
            _appendChatMessage('system', _formatAIText(reply));
        })
        .catch(function(err) {
            console.error('AI Error:', err);
            _removeChatMessage(typingId);
            // Fallback mock response if API key is invalid/missing
            var mockReply = "I'm sorry, my AI backend is currently offline (Invalid API Key). But you can buy **" + 
                            (_state.productData ? _state.productData.title : 'this item') + 
                            "** by clicking the Buy Now button!";
            _state.chatHistory.push({ role: 'assistant', content: mockReply });
            _appendChatMessage('system', _formatAIText(mockReply));
        });
    }

    function _appendChatMessage(role, htmlContent, id) {
        var msgs = document.getElementById('pd-ai-messages');
        if (!msgs) return;
        var div = document.createElement('div');
        div.className = 'pd-ai-msg ' + role;
        if (id) div.id = id;
        div.innerHTML = htmlContent;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function _removeChatMessage(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    }

    function _formatAIText(text) {
        // Basic markdown formatting
        return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                   .replace(/\*(.*?)\*/g, '<em>$1</em>')
                   .replace(/\n/g, '<br>');
    }

    /* ======================================================================
       SCROLL OBSERVER (Mobile Island)
       ====================================================================== */
    function _handleScrollIsland() {
        var island = document.getElementById('pd-mobile-island');
        if (!island) return;
        
        // Show after scrolling down a bit (past the breadcrumbs)
        if (window.scrollY > 150) {
            island.classList.add('visible');
        } else {
            island.classList.remove('visible');
        }
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _escJs(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        addToCart: addToCart,
        buyNow: buyNow,
        openWhatsApp: openWhatsApp,
        copyAffiliateLink: copyAffiliateLink,
        toggleWishlist: toggleWishlist,
        downloadWatermarkedImage: downloadWatermarkedImage,
        toggleAIChat: toggleAIChat,
        sendAIMessage: sendAIMessage,
        _setMainMedia: _setMainMedia // For onclick attributes
    };

})();
