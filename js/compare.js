/* js/compare.js */
window.NexraCompare = {
    db: null,
    slots: [null, null, null], // Max 3 slots

    init() {
        this.db = firebase.firestore();
        this.setupSearch();
    },

    setupSearch() {
        const input = document.getElementById('comp-search');
        const dropdown = document.getElementById('comp-dropdown');
        let timeout = null;

        input.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const val = e.target.value.trim().toLowerCase();
            
            if(val.length < 2) {
                dropdown.style.display = 'none';
                return;
            }

            timeout = setTimeout(() => this.executeSearch(val), 400);
        });

        // Hide dropdown on click outside
        document.addEventListener('click', (e) => {
            if(!e.target.closest('.comp-search-wrapper')) {
                dropdown.style.display = 'none';
            }
        });
    },

    async executeSearch(query) {
        const dropdown = document.getElementById('comp-dropdown');
        dropdown.style.display = 'block';
        dropdown.innerHTML = '<div style="padding:16px; text-align:center; color:#a855f7;"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching catalog...</div>';

        try {
            // Note: Firestore doesn't support true full-text search natively without Algolia.
            // This is a client-friendly approximation using a prefix search approach or fetching a cached summary list.
            // For production with thousands of items, array-contains or Typesense is recommended.
            
            // Assuming products have a 'title_lower' field for prefix search
            const snapshot = await this.db.collection('products')
                .orderBy('title')
                .limit(5)
                .get();
                
            let results = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if(data.title && data.title.toLowerCase().includes(query)) {
                    results.push({id: doc.id, ...data});
                }
            });

            if(results.length === 0) {
                dropdown.innerHTML = '<div style="padding:16px; text-align:center; color:#71717a;">No matching products found.</div>';
                return;
            }

            let html = '';
            results.forEach(r => {
                const img = r.coverBase64 || '/assets/placeholder-box.png';
                // Pass minimal stringified data to avoid parsing issues
                const safeTitle = (r.title || '').replace(/'/g, "");
                html += `
                    <div class="cd-item" onclick="NexraCompare.addProductToSlot('${r.id}', '${safeTitle}', ${r.price || 0}, ${r.rating || 0}, '${r.updates || 'No'}', '${r.framework || 'None'}', '${img}')">
                        <img src="${img}" class="cd-img">
                        <div class="cd-info">
                            <span class="cd-title">${safeTitle}</span>
                            <span class="cd-price">$${r.price || 0}</span>
                        </div>
                    </div>
                `;
            });
            dropdown.innerHTML = html;

        } catch(e) {
            console.error("Search Error", e);
            dropdown.innerHTML = '<div style="padding:16px; text-align:center; color:#ef4444;">Search failed. Please try again.</div>';
        }
    },

    addProductToSlot(id, title, price, rating, updates, framework, img) {
        document.getElementById('comp-dropdown').style.display = 'none';
        document.getElementById('comp-search').value = '';

        // Check if already added
        if(this.slots.some(s => s && s.id === id)) {
            return NexraApp.showToast('Product is already in the comparison matrix.', 'error');
        }

        // Find empty slot
        const slotIndex = this.slots.findIndex(s => s === null);
        if(slotIndex === -1) {
            return NexraApp.showToast('Matrix is full. Remove a product first.', 'error');
        }

        this.slots[slotIndex] = { id, title, price, rating, updates, framework, img };
        this.renderMatrix();
    },

    removeProduct(slotIndex) {
        this.slots[slotIndex] = null;
        this.renderMatrix();
    },

    renderMatrix() {
        // Find best price (lowest non-zero) to highlight
        const validPrices = this.slots.filter(s => s && s.price > 0).map(s => s.price);
        const bestPrice = validPrices.length > 0 ? Math.min(...validPrices) : -1;

        // Find best rating
        const validRatings = this.slots.filter(s => s && s.rating > 0).map(s => s.rating);
        const bestRating = validRatings.length > 0 ? Math.max(...validRatings) : -1;

        for (let i = 0; i < 3; i++) {
            const s = this.slots[i];
            const colNum = i + 1;

            const headTh = document.getElementById(`slot-${colNum}`);
            const cellPrice = document.getElementById(`c${colNum}-price`);
            const cellRating = document.getElementById(`c${colNum}-rating`);
            const cellUpdates = document.getElementById(`c${colNum}-updates`);
            const cellFrame = document.getElementById(`c${colNum}-framework`);
            const cellAction = document.getElementById(`c${colNum}-action`);

            if (s) {
                // Populate
                headTh.className = '';
                headTh.innerHTML = `
                    <div class="filled-head">
                        <img src="${s.img}" class="fh-img">
                        <div class="fh-title">${s.title}</div>
                        <button class="fh-remove" title="Remove" onclick="NexraCompare.removeProduct(${i})"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;

                const priceClass = (s.price === bestPrice && s.price > 0) ? 'filled-cell comp-winner' : 'filled-cell';
                cellPrice.className = priceClass;
                cellPrice.innerHTML = `$${s.price}`;

                const rateClass = (s.rating === bestRating && s.rating > 0) ? 'filled-cell comp-winner' : 'filled-cell';
                cellRating.className = rateClass;
                cellRating.innerHTML = `${s.rating} <i class="fa-solid fa-star" style="color:#fbbf24; font-size:12px;"></i>`;

                cellUpdates.className = 'filled-cell';
                cellUpdates.innerHTML = s.updates;

                cellFrame.className = 'filled-cell';
                cellFrame.innerHTML = s.framework;

                cellAction.innerHTML = `<button class="comp-add-btn" onclick="NexraApp.showToast('Added ${s.title} to Cart!', 'success')"><i class="fa-solid fa-cart-plus"></i> Add to Cart</button>`;
            } else {
                // Reset to empty
                headTh.className = 'empty-slot';
                headTh.innerHTML = `<div class="es-box"><i class="fa-solid fa-plus"></i><br>Add Product</div>`;
                
                [cellPrice, cellRating, cellUpdates, cellFrame, cellAction].forEach(c => {
                    c.className = 'empty-cell';
                    c.innerHTML = c === cellAction ? '' : '--';
                });
            }
        }
    }
};
