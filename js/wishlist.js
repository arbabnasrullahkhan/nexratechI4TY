/* js/wishlist.js */
window.NexraWishlist = {
    db: null,
    auth: null,
    uid: null,
    wishlistItems: [],
    productsCache: {},

    async init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.uid = user.uid;
                this.loadWishlist();
            } else {
                window.location.href = '/user/auth-gate.html?redirect=/user/wishlist.html';
            }
        });
    },

    loadWishlist() {
        // Hide guard, show main container with skeleton
        const guard = document.getElementById('wl-guard');
        if (guard) {
            guard.style.opacity = '0';
            setTimeout(() => guard.style.display = 'none', 400);
        }
        document.getElementById('wl-main').removeAttribute('hidden');

        // Real-time listener on the user's wishlist
        this.db.collection(`users/${this.uid}/wishlist`)
            .orderBy('savedAt', 'desc')
            .onSnapshot(async snap => {
                const grid = document.getElementById('wl-grid');
                const empty = document.getElementById('wl-empty');
                const fomoBanner = document.getElementById('wl-fomo-banner');
                
                document.getElementById('wl-count-badge').innerText = `${snap.size} Items`;

                if (snap.empty) {
                    grid.style.display = 'none';
                    fomoBanner.style.display = 'none';
                    empty.style.display = 'block';
                    return;
                }

                grid.style.display = 'grid';
                empty.style.display = 'none';
                
                this.wishlistItems = [];
                let hasFomo = false;
                
                // We need to fetch product details for each wishlist item
                const fetchPromises = [];
                snap.forEach(doc => {
                    const data = doc.data();
                    data.id = doc.id;
                    this.wishlistItems.push(data);
                    
                    if (!this.productsCache[data.productId]) {
                        fetchPromises.push(this.db.collection('products').doc(data.productId).get());
                    }
                });

                // Resolve missing products
                if (fetchPromises.length > 0) {
                    const results = await Promise.all(fetchPromises);
                    results.forEach(res => {
                        if (res.exists) {
                            this.productsCache[res.id] = res.data();
                        }
                    });
                }

                // Render
                let html = '';
                this.wishlistItems.forEach(item => {
                    const prod = this.productsCache[item.productId];
                    if (!prod) return; // Product might have been deleted from catalog

                    let fomoHTML = '';
                    // Price Drop evaluation
                    if (prod.price < item.savedPrice) {
                        fomoHTML = `<div class="wl-fomo-badge badge-price-drop"><i class="fa-solid fa-arrow-trend-down"></i> Price Dropped</div>`;
                        hasFomo = true;
                    } 
                    // Low Stock evaluation
                    else if (prod.stock > 0 && prod.stock <= 5) {
                        fomoHTML = `<div class="wl-fomo-badge badge-low-stock"><i class="fa-solid fa-fire"></i> Low Stock (${prod.stock} left)</div>`;
                        hasFomo = true;
                    }

                    html += `
                        <div class="wl-card" id="wl-card-${item.id}">
                            ${fomoHTML}
                            <button class="wl-remove-btn" onclick="NexraWishlist.removeItem('${item.id}')" title="Remove from wishlist">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                            <div class="wl-img-wrapper" onclick="window.location.href='/shop/product-detail.html?id=${item.productId}'" style="cursor:pointer;">
                                <img src="${prod.images && prod.images.length > 0 ? prod.images[0] : '/assets/placeholder.jpg'}" alt="${prod.title}" loading="lazy">
                            </div>
                            <div class="wl-card-body">
                                <div class="wl-card-cat">${prod.category || 'Digital Asset'}</div>
                                <div class="wl-card-title">${prod.title}</div>
                                <div class="wl-price-row">
                                    <div class="wl-price">Rs. ${prod.price}</div>
                                    ${prod.price < item.savedPrice ? `<div class="wl-old-price">Rs. ${item.savedPrice}</div>` : ''}
                                </div>
                                <button class="wl-btn-primary" onclick="NexraWishlist.moveToCart('${item.id}', '${item.productId}')">
                                    <i class="fa-solid fa-cart-shopping"></i> Move to Cart
                                </button>
                            </div>
                        </div>
                    `;
                });

                grid.innerHTML = html;
                fomoBanner.style.display = hasFomo ? 'flex' : 'none';
            });
    },

    async removeItem(wishlistId) {
        try {
            await this.db.collection(`users/${this.uid}/wishlist`).doc(wishlistId).delete();
            NexraApp.showToast('Removed from wishlist', 'success');
        } catch (e) {
            NexraApp.showToast('Failed to remove item', 'error');
        }
    },

    async moveToCart(wishlistId, productId) {
        const prod = this.productsCache[productId];
        if (!prod) return;

        try {
            // 1. Add to LocalStorage Cart
            let cart = JSON.parse(localStorage.getItem('nexra_cart') || '[]');
            const existing = cart.find(c => c.id === productId);
            if (existing) {
                existing.qty += 1;
            } else {
                cart.push({
                    id: productId,
                    title: prod.title,
                    price: prod.price,
                    image: prod.images ? prod.images[0] : '',
                    qty: 1
                });
            }
            localStorage.setItem('nexra_cart', JSON.stringify(cart));

            // 2. Atomic Batch to update Firestore Cart and Remove from Wishlist
            const batch = this.db.batch();
            
            // Add to Firestore Cart
            const cartRef = this.db.collection(`users/${this.uid}/cart`).doc(productId);
            batch.set(cartRef, {
                productId: productId,
                qty: existing ? firebase.firestore.FieldValue.increment(1) : 1,
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // Remove from Wishlist
            const wlRef = this.db.collection(`users/${this.uid}/wishlist`).doc(wishlistId);
            batch.delete(wlRef);

            await batch.commit();

            NexraApp.showToast('Moved to cart!', 'success');
            
            // Trigger cart drawer refresh if it exists
            if (window.NexraCartDrawer) {
                window.NexraCartDrawer.loadCart();
                window.NexraCartDrawer.openDrawer();
            }

        } catch (e) {
            console.error(e);
            NexraApp.showToast('Error moving to cart', 'error');
        }
    }
};
