/* js/feedback.js */
window.NexraFeedback = {
    db: null,
    auth: null,
    currentUser: null,

    init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
            } else {
                window.location.href = '/user/auth-gate.html?redirect=/user/feedback.html';
            }
        });

        this.setupRating();
        this.setupDropzone();
    },

    setupRating() {
        const stars = document.querySelectorAll('.rate-star');
        const valInput = document.getElementById('fb-rating-val');

        stars.forEach(star => {
            star.addEventListener('mouseover', (e) => {
                const val = parseInt(e.target.dataset.val);
                this.fillStars(val, 'hover');
            });
            
            star.addEventListener('mouseout', () => {
                const currentVal = parseInt(valInput.value);
                this.fillStars(currentVal, 'active');
            });

            star.addEventListener('click', (e) => {
                const val = parseInt(e.target.dataset.val);
                valInput.value = val;
                this.fillStars(val, 'active');
            });
        });
    },

    fillStars(val, cls) {
        const stars = document.querySelectorAll('.rate-star');
        stars.forEach(s => {
            s.classList.remove('hover', 'active');
            if (parseInt(s.dataset.val) <= val) {
                s.classList.add(cls);
            }
        });
    },

    setupDropzone() {
        const dropzone = document.getElementById('fb-dropzone');
        const fileInput = document.getElementById('fb-file');

        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                fileInput.files = e.dataTransfer.files;
                this.handleImageUpload({ target: fileInput });
            }
        });
    },

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            return NexraApp.showToast('Please select a valid image file.', 'error');
        }

        // Limit initial file size before compression
        if (file.size > 5 * 1024 * 1024) {
            return NexraApp.showToast('Image must be under 5MB.', 'error');
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Compress via Canvas
                const canvas = document.getElementById('fb-canvas');
                const ctx = canvas.getContext('2d');
                
                // Max width/height 1200px
                const MAX_DIM = 1200;
                let width = img.width;
                let height = img.height;

                if (width > height && width > MAX_DIM) {
                    height *= MAX_DIM / width;
                    width = MAX_DIM;
                } else if (height > MAX_DIM) {
                    width *= MAX_DIM / height;
                    height = MAX_DIM;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to compressed webp base64
                const base64Str = canvas.toDataURL('image/webp', 0.8);
                
                document.getElementById('fb-base64-payload').value = base64Str;
                document.getElementById('fb-img-preview').src = base64Str;
                document.getElementById('fb-preview-container').style.display = 'block';
                document.getElementById('fb-dropzone').style.display = 'none';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    clearImage() {
        document.getElementById('fb-file').value = '';
        document.getElementById('fb-base64-payload').value = '';
        document.getElementById('fb-preview-container').style.display = 'none';
        document.getElementById('fb-dropzone').style.display = 'flex';
    },

    async submit() {
        const btn = document.getElementById('btn-submit-fb');
        const originalHTML = btn.innerHTML;
        
        // Validation
        const category = document.querySelector('input[name="fb_category"]:checked');
        const rating = document.getElementById('fb-rating-val').value;
        const details = document.getElementById('fb-details').value.trim();
        
        if (!category) return NexraApp.showToast('Please select a category.', 'error');
        if (rating === "0") return NexraApp.showToast('Please provide a rating.', 'error');

        btn.innerHTML = 'Sending...';
        btn.classList.add('loading');

        const payload = {
            uid: this.currentUser.uid,
            category: category.value,
            rating: parseInt(rating),
            details: details,
            screenshotBase64: document.getElementById('fb-base64-payload').value || null,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            // Atomic Batched Write
            const batch = this.db.batch();
            
            const fbRef = this.db.collection('feedback').doc();
            batch.set(fbRef, payload);

            // Reward User with 10 Coins
            const userRef = this.db.collection('users').doc(this.currentUser.uid);
            batch.update(userRef, {
                coins: firebase.firestore.FieldValue.increment(10)
            });

            await batch.commit();

            // Show Success Modal
            document.getElementById('fb-form').style.display = 'none';
            document.querySelector('.fb-hero').style.display = 'none';
            document.getElementById('fb-success-modal').style.display = 'flex';

        } catch (e) {
            console.error("Feedback submission failed", e);
            NexraApp.showToast('Failed to submit feedback. Try again.', 'error');
            btn.innerHTML = originalHTML;
            btn.classList.remove('loading');
        }
    }
};
