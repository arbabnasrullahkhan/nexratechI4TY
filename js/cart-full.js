/* js/cart-full.js */
window.NexraFullCart = {
    db: null,
    auth: null,
    uid: null,
    localCart: [],
    BUNDLE_THRESHOLD: 5000,
    BUNDLE_DISCOUNT_PERCENT: 10,

    async init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.loadLocalCart();

        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.uid = user.uid;
                this.syncCloudCart();
            }
        });

        this.renderCart();
        this.loadUpsells();
    },

    loadLocalCart() {
        this.localCart = JSON.parse(localStorage.getItem('nexra_cart') || '[]');
    },

    saveLocalCart() {
        localStorage.setItem('nexra_cart', JSON.stringify(this.localCart));
        this.renderCart();
        
        // Background sync if logged in
        if (this.uid) {
            const batch = this.db.batch();
            const cartRef = this.db.collection(`users/${this.uid}/cart`);
            
            // Note: A true sync would check deletions too, but for speed we overwrite based on local
            this.localCart.forEach(item => {
                batch.set(cartRef.doc(item.id), {
                    productId: item.id,
                    qty: item.qty,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
            batch.commit().catch(e => console.error("Cloud cart sync failed", e));
        }

        // Notify global cart drawer if it exists
        if(window.NexraCartDrawer) window.NexraCartDrawer.loadCart();
    },

    async syncCloudCart() {
        // Fetch cloud cart and merge with local
        try {
            const snap = await this.db.collection(`users/${this.uid}/cart`).get();
            let merged = false;
            
            // In a real scenario, you'd fetch product details for cloud items missing locally.
            // For now, we assume local cart is the primary session truth unless empty.
            if(this.localCart.length === 0 && !snap.empty) {
                // If local is empty, pull cloud down (simplified)
                // Needs product details fetch ideally, but skipping for demo speed
                console.log("Local empty, but cloud has items. (Details fetch omitted)");
            }
        } catch(e) {
            console.error(e);
        }
    },

    renderCart() {
        const list = document.getElementById('cart-items-list');
        const empty = document.getElementById('cart-empty');
        const checkoutBtn = document.getElementById('btn-checkout');

        if (this.localCart.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'block';
            checkoutBtn.disabled = true;
            this.updateCalculator(0);
            return;
        }

        list.style.display = 'flex';
        empty.style.display = 'none';
        checkoutBtn.disabled = false;

        let html = '';
        let subtotal = 0;

        this.localCart.forEach((item, index) => {
            const itemTotal = item.price * item.qty;
            subtotal += itemTotal;

            html += `
                <div class="cf-item">
                    <img src="${item.image || '/assets/placeholder.jpg'}" alt="Product" class="cf-img">
                    <div class="cf-details">
                        <div class="cf-title">${item.title}</div>
                        <div class="cf-price">Rs. ${item.price}</div>
                        <button class="cf-remove" onclick="NexraFullCart.removeItem(${index})"><i class="fa-solid fa-trash"></i> Remove</button>
                    </div>
                    <div class="cf-actions">
                        <div style="font-weight:900; color:var(--text-100);">Rs. ${itemTotal}</div>
                        <div class="cf-qty-ctrl">
                            <button class="cf-qty-btn" onclick="NexraFullCart.updateQty(${index}, -1)"><i class="fa-solid fa-minus"></i></button>
                            <input type="text" class="cf-qty-input" value="${item.qty}" readonly>
                            <button class="cf-qty-btn" onclick="NexraFullCart.updateQty(${index}, 1)"><i class="fa-solid fa-plus"></i></button>
                        </div>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;
        this.updateCalculator(subtotal);
    },

    updateQty(index, change) {
        if (this.localCart[index].qty + change > 0) {
            this.localCart[index].qty += change;
            this.saveLocalCart();
        } else if (change < 0) {
            this.removeItem(index);
        }
    },

    removeItem(index) {
        // Also remove from cloud if auth'd
        if (this.uid) {
            const prodId = this.localCart[index].id;
            this.db.collection(`users/${this.uid}/cart`).doc(prodId).delete();
        }
        
        this.localCart.splice(index, 1);
        this.saveLocalCart();
        NexraApp.showToast('Item removed', 'success');
    },

    clearCart() {
        if(!confirm('Are you sure you want to empty your cart?')) return;
        
        if (this.uid) {
            this.localCart.forEach(item => {
                this.db.collection(`users/${this.uid}/cart`).doc(item.id).delete();
            });
        }
        
        this.localCart = [];
        this.saveLocalCart();
    },

    updateCalculator(subtotal) {
        document.getElementById('cs-subtotal').innerText = `Rs. ${subtotal.toLocaleString()}`;
        
        let discount = 0;
        const discountRow = document.getElementById('cs-discount-row');
        const cpText = document.getElementById('cp-text');
        const cpFill = document.getElementById('cp-fill');
        const diffSpan = document.getElementById('cp-diff');

        if (subtotal >= this.BUNDLE_THRESHOLD) {
            discount = subtotal * (this.BUNDLE_DISCOUNT_PERCENT / 100);
            discountRow.style.display = 'flex';
            document.getElementById('cs-discount').innerText = `- Rs. ${discount.toLocaleString()}`;
            
            cpText.innerHTML = `<strong style="color:#10b981;"><i class="fa-solid fa-check-circle"></i> 10% Bundle Discount Unlocked!</strong>`;
            cpFill.style.width = '100%';
            cpFill.classList.add('success');
        } else {
            discountRow.style.display = 'none';
            const diff = this.BUNDLE_THRESHOLD - subtotal;
            if(diffSpan) diffSpan.innerText = diff.toLocaleString();
            
            cpText.innerHTML = `Add Rs. <strong id="cp-diff">${diff.toLocaleString()}</strong> more to unlock a <strong style="color:var(--brand-main);">10% Bundle Discount!</strong>`;
            
            let pct = (subtotal / this.BUNDLE_THRESHOLD) * 100;
            if(pct > 100) pct = 100;
            cpFill.style.width = `${pct}%`;
            cpFill.classList.remove('success');
        }

        const grandTotal = subtotal - discount;
        document.getElementById('cs-total').innerText = `Rs. ${grandTotal.toLocaleString()}`;
    },

    async loadUpsells() {
        // Query 4 random/popular products
        try {
            const snap = await this.db.collection('products').limit(4).get();
            const section = document.getElementById('upsell-section');
            const slider = document.getElementById('upsell-slider');
            
            if (snap.empty) return;
            
            let html = '';
            snap.forEach(doc => {
                const d = doc.data();
                // Skip if already in cart
                if(this.localCart.find(c => c.id === doc.id)) return;

                const img = d.images && d.images.length > 0 ? d.images[0] : '/assets/placeholder.jpg';
                html += `
                    <div class="us-card">
                        <img src="${img}" alt="Upsell" class="us-img">
                        <div class="us-title">${d.title}</div>
                        <div class="us-price">Rs. ${d.price}</div>
                        <button class="us-btn" onclick="NexraFullCart.addUpsell('${doc.id}', '${d.title.replace(/'/g,"\\'")}', ${d.price}, '${img}')">
                            <i class="fa-solid fa-plus"></i> Add
                        </button>
                    </div>
                `;
            });

            if (html !== '') {
                slider.innerHTML = html;
                section.style.display = 'block';
            }
        } catch(e) {
            console.error("Upsell load failed", e);
        }
    },

    addUpsell(id, title, price, img) {
        this.localCart.push({ id, title, price, image: img, qty: 1 });
        this.saveLocalCart();
        NexraApp.showToast('Item added to cart!', 'success');
        this.loadUpsells(); // Refresh upsells to remove the added item
    },

    proceedToCheckout() {
        if(!this.uid) {
            window.location.href = '/user/auth-gate.html?redirect=/shop/checkout.html';
        } else {
            window.location.href = '/shop/checkout.html';
        }
    }
};
