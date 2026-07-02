/* js/creator.js */
window.NexraCreator = {
    db: null,
    auth: null,
    currentUser: null,

    init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.unlockPortal();
            } else {
                window.location.href = '/user/auth-gate.html?redirect=/academy/creator-portal.html';
            }
        });

        this.setupDropzone();
    },

    unlockPortal() {
        const guard = document.getElementById('cp-guard');
        guard.style.opacity = '0';
        setTimeout(() => guard.style.display = 'none', 500);
        
        document.getElementById('cp-main').style.display = 'flex';
    },

    setupDropzone() {
        const dropzone = document.getElementById('cp-dropzone');
        const fileInput = document.getElementById('cp-file');

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

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.getElementById('cp-canvas');
                const ctx = canvas.getContext('2d');
                
                // Max width/height 1600px for creator covers
                const MAX_DIM = 1600;
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

                // Compress heavily to keep Firestore payload lightweight (0.7 WebP)
                const base64Str = canvas.toDataURL('image/webp', 0.7);
                
                document.getElementById('cp-base64-payload').value = base64Str;
                document.getElementById('cp-img-preview').src = base64Str;
                document.getElementById('cp-preview-container').style.display = 'block';
                document.getElementById('cp-dropzone').style.display = 'none';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    clearImage() {
        document.getElementById('cp-file').value = '';
        document.getElementById('cp-base64-payload').value = '';
        document.getElementById('cp-preview-container').style.display = 'none';
        document.getElementById('cp-dropzone').style.display = 'flex';
    },

    async submitAsset() {
        const btn = document.getElementById('btn-submit-asset');
        const originalHTML = btn.innerHTML;
        
        const title = document.getElementById('cp-title').value.trim();
        const category = document.getElementById('cp-category').value;
        const link = document.getElementById('cp-link').value.trim();
        const desc = document.getElementById('cp-desc').value.trim();
        const base64 = document.getElementById('cp-base64-payload').value;

        if (!base64) {
            return NexraApp.showToast('A cover image is required.', 'error');
        }

        btn.innerHTML = 'Uploading Payload...';
        btn.classList.add('loading');

        const payload = {
            uid: this.currentUser.uid,
            title: title,
            category: category,
            downloadLink: link,
            description: desc,
            coverBase64: base64,
            status: 'pending_review',
            rewardCoins: 50,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await this.db.collection('community_submissions').add(payload);
            
            // Show Success Modal
            document.getElementById('cp-form').style.display = 'none';
            document.querySelector('.cp-info-panel').style.display = 'none';
            document.querySelector('.cp-hero').style.display = 'none';
            document.getElementById('cp-success-modal').style.display = 'flex';

        } catch (e) {
            console.error("Submission failed", e);
            NexraApp.showToast('Failed to submit asset. Please try again.', 'error');
            btn.innerHTML = originalHTML;
            btn.classList.remove('loading');
        }
    }
};
