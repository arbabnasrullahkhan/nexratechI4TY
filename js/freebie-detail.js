/**
 * ==========================================================================
 * NEXRA TECH PK — VIRAL FREEBIE DETAIL ENGINE (js/freebie-detail.js)
 * ==========================================================================
 * Namespace: window.NexraFreebieDetail
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on freebies/freebie-detail.html
 * ==========================================================================
 */

window.NexraFreebieDetail = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        itemId: null,
        itemData: null,
        currentUser: null,
        
        // Share to Unlock State
        shareTarget: 3,
        shareCount: 0,
        isUnlocked: false,
        
        // AI State
        aiOpen: false,
        aiContext: ''
    };

    var _DOM = {};

    /* ======================================================================
       INIT & CORE FETCHING
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraFreebieDetail] Initializing...');

        // 1. Extract URL param
        var params = new URLSearchParams(window.location.search);
        _state.itemId = params.get('id');

        if (!_state.itemId) {
            window.location.href = '/freebies/freebies.html';
            return;
        }

        // Cache DOM elements
        _cacheDOM();

        // 2. Setup Auth & Local Storage
        _subscribeAuth();
        
        // 3. Fetch Data
        _fetchItem();
    }

    function _cacheDOM() {
        _DOM.skeleton = document.getElementById('fd-skeleton-wrap');
        _DOM.content = document.getElementById('fd-content-wrap');
        
        _DOM.engine = document.getElementById('fd-unlock-engine');
        _DOM.progressBar = document.getElementById('fd-progress-fill');
        _DOM.shareCount = document.getElementById('fd-share-count');
        _DOM.shareActions = document.getElementById('fd-share-actions');
        _DOM.downloadBtn = document.getElementById('fd-download-btn');
        _DOM.docOverlay = document.getElementById('fd-doc-overlay');
        
        _DOM.aiWidget = document.getElementById('fd-ai-widget');
        _DOM.aiPanel = document.getElementById('fd-ai-panel');
        _DOM.aiChat = document.getElementById('fd-ai-chat');
        _DOM.aiInput = document.getElementById('fd-ai-input');
        
        // Meta Tags
        _DOM.mTitle = document.getElementById('fd-page-title');
        _DOM.mDesc = document.getElementById('fd-meta-desc');
        _DOM.ogTitle = document.getElementById('fd-og-title');
        _DOM.ogDesc = document.getElementById('fd-og-desc');
        _DOM.twTitle = document.getElementById('fd-tw-title');
        _DOM.twDesc = document.getElementById('fd-tw-desc');
        _DOM.schema = document.getElementById('fd-ld-schema');
    }

    function _fetchItem() {
        if (!window.db) return;
        
        window.db.collection('freebies').doc(_state.itemId).get().then(function(doc) {
            if (!doc.exists) {
                window.location.href = '/freebies/freebies.html';
                return;
            }
            _state.itemData = doc.data();
            _state.itemData.id = doc.id;
            
            // Build AI Context
            _state.aiContext = "You are Nexra AI. The user is looking at a freebie named '" + _state.itemData.title + "'. " +
                               "Category: " + _state.itemData.category + ". Description: " + _state.itemData.desc + ". " +
                               "Answer concisely and help them use this resource.";

            _injectSEO();
            _renderUI();
            _checkUnlockStatus();
            
            // Transition out skeleton
            if (_DOM.skeleton) _DOM.skeleton.style.display = 'none';
            if (_DOM.content) _DOM.content.removeAttribute('hidden');

            // Render Canvas Watermark after DOM reveals
            setTimeout(_renderCanvasWatermark, 100);

        }).catch(function(err) {
            console.error('Fetch error:', err);
        });
    }

    /* ======================================================================
       AUTH & UNLOCK STATE
       ====================================================================== */
    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (_state.itemData) _checkUnlockStatus();
        });
    }

    function _checkUnlockStatus() {
        // 1. Check if user is auth'd and has it in Firestore
        if (_state.currentUser && window.db) {
            window.db.collection('users').doc(_state.currentUser.uid).get().then(function(doc) {
                if (doc.exists && doc.data().unlockedFreebies) {
                    var unlocks = doc.data().unlockedFreebies;
                    if (unlocks.indexOf(_state.itemId) !== -1) {
                        _triggerUnlock(true); // silent unlock
                        return;
                    }
                }
                _checkLocalShares();
            });
        } else {
            _checkLocalShares();
        }
    }

    function _checkLocalShares() {
        // 2. Check localStorage for share counts or full unlock
        try {
            var fullUnlocks = JSON.parse(localStorage.getItem('nexra_unlocked_freebies') || '[]');
            if (fullUnlocks.indexOf(_state.itemId) !== -1) {
                _triggerUnlock(true);
                return;
            }
            
            var shareKey = 'nexra_shares_' + _state.itemId;
            var counts = parseInt(localStorage.getItem(shareKey) || '0', 10);
            _state.shareCount = counts;
            if (_state.shareCount >= _state.shareTarget) {
                _triggerUnlock(true);
            } else {
                _updateProgressUI();
            }
        } catch (e) {
            console.error(e);
        }
    }

    /* ======================================================================
       VIRAL UNLOCKING ENGINE
       ====================================================================== */
    function executeShare(platform) {
        if (!_state.currentUser) {
            _openAuthModal();
            return;
        }

        var shareUrl = window.location.origin + '/freebies/freebie-detail.html?id=' + _state.itemId + '&ref=' + _state.currentUser.uid;
        var text = encodeURIComponent('Check out this premium freebie: ' + _state.itemData.title + ' on Nexra Tech PK!');
        var url = encodeURIComponent(shareUrl);
        var link = '';

        if (platform === 'native' && navigator.share) {
            navigator.share({
                title: _state.itemData.title,
                text: 'Check out this freebie on Nexra Tech PK',
                url: shareUrl
            }).then(_incrementShare).catch(function(){});
            return;
        }

        if (platform === 'link' || platform === 'native') {
            navigator.clipboard.writeText(shareUrl).then(function() {
                window.NexraApp.showToast('Link copied to clipboard!', 'fa-solid fa-link', 'success');
                _incrementShare();
            });
            return;
        }

        if (platform === 'wa') link = 'https://api.whatsapp.com/send?text=' + text + ' ' + url;
        if (platform === 'fb') link = 'https://www.facebook.com/sharer/sharer.php?u=' + url;

        window.open(link, '_blank', 'width=600,height=400');
        
        // Optimistic increment after 2s
        setTimeout(_incrementShare, 2000);
    }

    function _incrementShare() {
        if (_state.isUnlocked) return;
        
        _state.shareCount++;
        var shareKey = 'nexra_shares_' + _state.itemId;
        localStorage.setItem(shareKey, _state.shareCount);
        
        _updateProgressUI();

        if (_state.shareCount >= _state.shareTarget) {
            _triggerUnlock(false);
        } else {
            window.NexraApp.showToast('Share recorded! (' + _state.shareCount + '/' + _state.shareTarget + ')', 'fa-solid fa-share', 'default');
        }
    }

    function _updateProgressUI() {
        if (!_DOM.progressBar || _state.isUnlocked) return;
        var pct = Math.min((_state.shareCount / _state.shareTarget) * 100, 100);
        _DOM.progressBar.style.width = pct + '%';
        if (_DOM.shareCount) _DOM.shareCount.textContent = _state.shareCount;
    }

    function _triggerUnlock(isSilent) {
        if (_state.isUnlocked) return;
        _state.isUnlocked = true;
        _state.shareCount = _state.shareTarget;
        _updateProgressUI();

        // 1. Sync to local storage complete list
        try {
            var fullUnlocks = JSON.parse(localStorage.getItem('nexra_unlocked_freebies') || '[]');
            if (fullUnlocks.indexOf(_state.itemId) === -1) {
                fullUnlocks.push(_state.itemId);
                localStorage.setItem('nexra_unlocked_freebies', JSON.stringify(fullUnlocks));
            }
        } catch(e){}

        // 2. Sync to Firestore if Auth'd
        if (_state.currentUser && window.db && !isSilent) {
            window.db.collection('users').doc(_state.currentUser.uid).set({
                unlockedFreebies: firebase.firestore.FieldValue.arrayUnion(_state.itemId)
            }, { merge: true });
        }

        // 3. UI Morph
        if (_DOM.engine) _DOM.engine.classList.add('unlocked');
        var icon = document.getElementById('fd-unlock-icon');
        var title = document.getElementById('fd-unlock-title');
        var desc = document.getElementById('fd-unlock-desc');
        var progWrap = document.getElementById('fd-progress-wrap');
        
        if (icon) icon.className = 'fa-solid fa-unlock';
        if (title) title.textContent = 'Resource Unlocked!';
        if (desc) desc.textContent = 'Thank you for sharing! Your download is ready. This asset is now permanently saved to your digital vault.';
        if (progWrap) progWrap.style.display = 'none';
        if (_DOM.shareActions) _DOM.shareActions.style.display = 'none';
        if (_DOM.downloadBtn) _DOM.downloadBtn.removeAttribute('hidden');
        
        // Dissolve Doc Blur
        if (_DOM.docOverlay) {
            _DOM.docOverlay.style.opacity = '0';
            setTimeout(function() { _DOM.docOverlay.style.display = 'none'; }, 500);
        }

        if (!isSilent) {
            window.NexraApp.showToast('Resource Unlocked!', 'fa-solid fa-unlock', 'success');
        }
    }

    function executeDownload() {
        if (!_state.isUnlocked) return;

        // Adsterra Pop-under trigger (mocked)
        console.log('[Adsterra] Triggering pop-under...');
        
        // Increment Download Counter
        if (window.db) {
            window.db.collection('freebies').doc(_state.itemId).update({
                downloads: firebase.firestore.FieldValue.increment(1)
            }).catch(function(){});
        }
        
        window.NexraApp.showToast('Starting secure download...', 'fa-solid fa-cloud-arrow-down', 'success');
        
        var link = document.createElement('a');
        link.href = _state.itemData.downloadUrl || '#';
        link.download = _state.itemData.title + '.zip';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /* ======================================================================
       RENDERING & WATERMARKING
       ====================================================================== */
    function _renderUI() {
        var d = _state.itemData;
        document.getElementById('fd-val-cat').textContent = d.category;
        document.getElementById('fd-val-bc-title').textContent = d.title;
        document.getElementById('fd-val-title').textContent = d.title;
        document.getElementById('fd-val-desc').textContent = d.desc;
        document.getElementById('fd-val-likes').textContent = d.likes || 0;
        document.getElementById('fd-val-downloads').textContent = d.downloads || 0;
        
        // Features
        var featEl = document.getElementById('fd-val-features');
        if (d.features && Array.isArray(d.features)) {
            featEl.innerHTML = d.features.map(function(f) {
                return '<div class="fd-feature-item"><i class="fa-solid fa-check"></i> ' + _esc(f) + '</div>';
            }).join('');
        }

        // Rich Doc
        var docEl = document.getElementById('fd-val-doc');
        if (d.documentationHtml) {
            docEl.innerHTML = d.documentationHtml; // Trusting backend for HTML
        }

        // Like Status from LocalStorage
        if (localStorage.getItem('nexra_liked_' + _state.itemId)) {
            document.getElementById('fd-like-icon').className = 'fa-solid fa-heart';
            document.querySelector('.fd-icon-btn').classList.add('liked');
        }
    }

    function _renderCanvasWatermark() {
        var cvs = document.getElementById('fd-canvas');
        if (!cvs || !_state.itemData) return;
        var ctx = cvs.getContext('2d');
        
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            cvs.width = img.width;
            cvs.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Draw Watermark Text via Canvas
            ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            ctx.font = "bold " + (cvs.width * 0.05) + "px sans-serif";
            ctx.textAlign = "right";
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 10;
            ctx.fillText("NEXRA TECH PK", cvs.width - 20, cvs.height - 20);
        };
        img.src = _state.itemData.imgUrl || _state.itemData.imgBase64;
    }

    /* ======================================================================
       INTERACTIONS
       ====================================================================== */
    function toggleLike() {
        var key = 'nexra_liked_' + _state.itemId;
        var isLiked = localStorage.getItem(key);
        var btn = document.querySelector('.fd-icon-btn');
        var icon = document.getElementById('fd-like-icon');
        var countEl = document.getElementById('fd-val-likes');
        var current = parseInt(countEl.textContent || '0', 10);

        if (isLiked) {
            localStorage.removeItem(key);
            btn.classList.remove('liked');
            icon.className = 'fa-regular fa-heart';
            countEl.textContent = current - 1;
            if (window.db) window.db.collection('freebies').doc(_state.itemId).update({ likes: firebase.firestore.FieldValue.increment(-1) });
        } else {
            localStorage.setItem(key, '1');
            btn.classList.add('liked');
            icon.className = 'fa-solid fa-heart';
            countEl.textContent = current + 1;
            if (window.db) window.db.collection('freebies').doc(_state.itemId).update({ likes: firebase.firestore.FieldValue.increment(1) });
            // Haptic
            if (navigator.vibrate) navigator.vibrate(50);
        }
    }

    function _openAuthModal() {
        var m = document.getElementById('fd-auth-modal');
        if (m) m.removeAttribute('hidden');
    }
    function closeAuthModal() {
        var m = document.getElementById('fd-auth-modal');
        if (m) m.setAttribute('hidden', '');
    }

    /* ======================================================================
       SEO & META INJECTION
       ====================================================================== */
    function _injectSEO() {
        var d = _state.itemData;
        var title = d.title + ' | Free Download | Nexra Tech PK';
        var desc = d.desc;

        if (_DOM.mTitle) _DOM.mTitle.textContent = title;
        if (_DOM.mDesc) _DOM.mDesc.content = desc;
        if (_DOM.ogTitle) _DOM.ogTitle.content = title;
        if (_DOM.ogDesc) _DOM.ogDesc.content = desc;
        if (_DOM.twTitle) _DOM.twTitle.content = title;
        if (_DOM.twDesc) _DOM.twDesc.content = desc;
        
        var imgUrl = d.imgUrl || '';
        if (_DOM.ogImage) _DOM.ogImage.content = imgUrl;
        if (_DOM.twImage) _DOM.twImage.content = imgUrl;

        if (_DOM.schema) {
            _DOM.schema.textContent = JSON.stringify({
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                "name": d.title,
                "operatingSystem": "Any",
                "applicationCategory": "DesignApplication",
                "offers": { "@type": "Offer", "price": "0.00", "priceCurrency": "PKR" },
                "description": d.desc
            });
        }
    }

    /* ======================================================================
       TRIPLE-AI ASSISTANT (OPENROUTER MOCK INTERFACE)
       ====================================================================== */
    function toggleAI() {
        _state.aiOpen = !_state.aiOpen;
        if (_DOM.aiPanel) {
            if (_state.aiOpen) _DOM.aiPanel.classList.add('active');
            else _DOM.aiPanel.classList.remove('active');
        }
    }

    function sendAIMessage() {
        var val = _DOM.aiInput.value.trim();
        if (!val) return;
        
        // Append user msg
        _appendAI('user', val);
        _DOM.aiInput.value = '';
        
        // Mocking OpenRouter API call delay
        var typingId = _appendAI('bot', '<i class="fa-solid fa-ellipsis fa-fade"></i>');
        
        setTimeout(function() {
            var msg = document.getElementById(typingId);
            if (msg) {
                msg.innerHTML = "I am powered by OpenRouter. Since I'm currently in demo mode, I can tell you that this freebie (" + _state.itemData.title + ") requires you to share it 3 times to unlock the documentation! How else can I help?";
            }
        }, 1500);
    }

    function _appendAI(role, html) {
        var id = 'msg_' + Math.random().toString(36).substr(2, 9);
        var div = document.createElement('div');
        div.className = 'fd-ai-msg ' + role;
        div.id = id;
        div.innerHTML = html;
        _DOM.aiChat.appendChild(div);
        _DOM.aiChat.scrollTop = _DOM.aiChat.scrollHeight;
        return id;
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        executeShare: executeShare,
        executeDownload: executeDownload,
        toggleLike: toggleLike,
        closeAuthModal: closeAuthModal,
        toggleAI: toggleAI,
        sendAIMessage: sendAIMessage
    };

})();
