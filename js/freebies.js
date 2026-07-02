/**
 * ==========================================================================
 * NEXRA TECH PK — FREEBIES ENGINE (js/freebies.js)
 * ==========================================================================
 * Namespace: window.NexraFreebies
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on freebies/freebies.html
 * ==========================================================================
 */

window.NexraFreebies = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        items: [],
        categories: [],
        activeCat: 'All',
        searchQuery: '',
        lastDoc: null,
        isLoading: true,
        hasMore: true,
        currentUser: null,
        unlockedItems: [], // Array of IDs unlocked via share
        speechRec: null
    };

    var _DOM = {
        grid: null,
        catTrack: null,
        emptyState: null,
        loadMoreWrap: null,
        searchInp: null,
        suggestDrop: null,
        voiceBtn: null
    };

    /* ======================================================================
       INIT
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraFreebies] Initializing...');

        // Cache DOM
        _DOM.grid = document.getElementById('fr-grid');
        _DOM.catTrack = document.getElementById('fr-cats-track');
        _DOM.emptyState = document.getElementById('fr-empty-state');
        _DOM.loadMoreWrap = document.getElementById('fr-load-more-wrap');
        _DOM.searchInp = document.getElementById('fr-search-input');
        _DOM.suggestDrop = document.getElementById('fr-search-dropdown');
        _DOM.voiceBtn = document.getElementById('fr-voice-btn');

        // Setup Auth & Storage
        _loadLocalUnlocks();
        _subscribeAuth();

        // Setup Search Listeners
        if (_DOM.searchInp) {
            _DOM.searchInp.addEventListener('input', _debounce(_handleSearchInput, 300));
            _DOM.searchInp.addEventListener('focus', function() {
                if (_DOM.searchInp.value.length > 1) _DOM.suggestDrop.removeAttribute('hidden');
            });
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#fr-search-wrap')) {
                    if (_DOM.suggestDrop) _DOM.suggestDrop.setAttribute('hidden', '');
                }
            });
        }

        // Initialize Speech
        _initSpeech();

        // Initial Fetch
        _fetchCategories();
        _fetchItems(true);
    }

    /* ======================================================================
       AUTH & UNLOCK STATE
       ====================================================================== */
    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user && window.db) {
                // Sync unlocks from Firestore
                window.db.collection('users').doc(user.uid).get().then(function(doc) {
                    if (doc.exists && doc.data().unlockedFreebies) {
                        var cloudUnlocks = doc.data().unlockedFreebies;
                        _state.unlockedItems = Array.from(new Set(_state.unlockedItems.concat(cloudUnlocks)));
                        localStorage.setItem('nexra_unlocked_freebies', JSON.stringify(_state.unlockedItems));
                        _renderGrid(); // Re-render to update lock badges
                    }
                });
            }
        });
    }

    function _loadLocalUnlocks() {
        try {
            var local = localStorage.getItem('nexra_unlocked_freebies');
            if (local) _state.unlockedItems = JSON.parse(local);
        } catch (e) {
            _state.unlockedItems = [];
        }
    }

    function _saveUnlock(itemId) {
        if (_state.unlockedItems.indexOf(itemId) === -1) {
            _state.unlockedItems.push(itemId);
            localStorage.setItem('nexra_unlocked_freebies', JSON.stringify(_state.unlockedItems));
            
            if (_state.currentUser && window.db) {
                window.db.collection('users').doc(_state.currentUser.uid).set({
                    unlockedFreebies: firebase.firestore.FieldValue.arrayUnion(itemId)
                }, { merge: true });
            }
            
            // Re-render specifically this card
            _renderGrid();
        }
    }

    /* ======================================================================
       FIRESTORE FETCHING
       ====================================================================== */
    function _fetchCategories() {
        // Since it's a pure ecosystem without dummy data, we extract unique cats or rely on a config doc.
        // For production, pulling from a config doc is 100x faster than aggregating.
        if (!window.db) return;
        window.db.collection('settings').doc('freebies').get().then(function(doc) {
            var cats = ['All'];
            if (doc.exists && doc.data().categories) {
                cats = cats.concat(doc.data().categories);
            } else {
                cats = ['All', 'UI Kits', 'Templates', 'Mockups', 'Icons', 'Fonts', 'Scripts'];
            }
            _state.categories = cats;
            _renderCategories();
        }).catch(function() {
            _state.categories = ['All', 'UI Kits', 'Templates', 'Mockups'];
            _renderCategories();
        });
    }

    function _fetchItems(isFirstLoad) {
        if (!window.db) return;
        _state.isLoading = true;
        
        if (isFirstLoad) {
            _state.lastDoc = null;
            _state.items = [];
            _DOM.grid.innerHTML = _getSkeletons();
        }

        var ref = window.db.collection('freebies').where('active', '==', true);
        
        if (_state.activeCat !== 'All') {
            ref = ref.where('category', '==', _state.activeCat);
        }
        
        // Sorting
        ref = ref.orderBy('createdAt', 'desc');

        if (_state.lastDoc) {
            ref = ref.startAfter(_state.lastDoc);
        }

        ref.limit(10).get().then(function(snap) {
            if (snap.empty) {
                _state.hasMore = false;
                if (isFirstLoad) {
                    _DOM.grid.innerHTML = '';
                    _DOM.emptyState.removeAttribute('hidden');
                }
                if (_DOM.loadMoreWrap) _DOM.loadMoreWrap.setAttribute('hidden', '');
            } else {
                _DOM.emptyState.setAttribute('hidden', '');
                _state.lastDoc = snap.docs[snap.docs.length - 1];
                _state.hasMore = snap.docs.length === 10;
                
                snap.forEach(function(doc) {
                    var d = doc.data();
                    d.id = doc.id;
                    _state.items.push(d);
                });
                
                _renderGrid();
                
                if (_DOM.loadMoreWrap) {
                    if (_state.hasMore) _DOM.loadMoreWrap.removeAttribute('hidden');
                    else _DOM.loadMoreWrap.setAttribute('hidden', '');
                }
            }
            _state.isLoading = false;
        }).catch(function(err) {
            console.error('Fetch error:', err);
            _state.isLoading = false;
        });
    }

    function loadMore() {
        if (!_state.isLoading && _state.hasMore) {
            _fetchItems(false);
        }
    }

    /* ======================================================================
       RENDERING
       ====================================================================== */
    function _renderCategories() {
        if (!_DOM.catTrack) return;
        _DOM.catTrack.innerHTML = _state.categories.map(function(cat) {
            var activeClass = cat === _state.activeCat ? 'active' : '';
            return '<button class="fr-cat-pill ' + activeClass + '" onclick="NexraFreebies.setCategory(\'' + _esc(cat) + '\')">' + _esc(cat) + '</button>';
        }).join('');
    }

    function setCategory(cat) {
        if (_state.activeCat === cat) return;
        _state.activeCat = cat;
        _renderCategories();
        
        // Reset Search
        if (_DOM.searchInp) _DOM.searchInp.value = '';
        _state.searchQuery = '';
        
        _fetchItems(true);
    }

    function resetFilters() {
        setCategory('All');
    }

    function _getSkeletons() {
        // Matches the 10-item grid rhythm defined in CSS
        return '<div class="fr-card-skeleton" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton full-width" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton third-width" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton third-width" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton third-width" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton" aria-hidden="true"></div>' +
               '<div class="fr-card-skeleton" aria-hidden="true"></div>';
    }

    function _renderGrid() {
        if (!_DOM.grid) return;
        
        // Watermark config (Base64 or external)
        var watermark = window.NexraBrand ? window.NexraBrand.getAsset('watermark') : '/assets/watermark-sm.png';

        _DOM.grid.innerHTML = _state.items.map(function(item) {
            var isUnlocked = _state.unlockedItems.indexOf(item.id) !== -1;
            var lockClass = isUnlocked ? 'unlocked' : 'locked';
            var lockIcon = isUnlocked ? '<i class="fa-solid fa-unlock"></i> Unlocked' : '<i class="fa-solid fa-lock"></i> Share to Unlock';
            var actionTxt = isUnlocked ? '<i class="fa-solid fa-download"></i> Download' : '<i class="fa-solid fa-share-nodes"></i> Share';

            return '<article class="fr-card ' + lockClass + '">' +
                   '<div class="fr-lock-badge">' + lockIcon + '</div>' +
                   '<div class="fr-card-media">' +
                   '<img src="' + _esc(item.imgBase64 || item.imgUrl) + '" alt="' + _esc(item.title) + '" class="fr-card-img" loading="lazy">' +
                   '<img src="' + watermark + '" class="fr-watermark" alt="Nexra" aria-hidden="true">' +
                   '</div>' +
                   '<div class="fr-card-body">' +
                   '<div class="fr-card-cat">' + _esc(item.category) + '</div>' +
                   '<h2 class="fr-card-title">' + _esc(item.title) + '</h2>' +
                   '<p class="fr-card-desc">' + _esc(item.desc) + '</p>' +
                   '<div class="fr-card-footer">' +
                   '<div class="fr-stats">' +
                   '<span><i class="fa-solid fa-heart"></i> ' + (item.likes || 0) + '</span>' +
                   '<span><i class="fa-solid fa-download"></i> ' + (item.downloads || 0) + '</span>' +
                   '</div>' +
                   '<button class="fr-action-btn" onclick="NexraFreebies.handleAction(\'' + item.id + '\')">' + actionTxt + '</button>' +
                   '</div>' +
                   '</div>' +
                   '</article>';
        }).join('');
    }

    /* ======================================================================
       ACTION HANDLER (Share to Unlock / Download)
       ====================================================================== */
    function handleAction(itemId) {
        var isUnlocked = _state.unlockedItems.indexOf(itemId) !== -1;
        var item = _state.items.find(function(i) { return i.id === itemId; });
        if (!item) return;

        if (isUnlocked) {
            // Trigger Download
            _incrementDownload(itemId);
            window.NexraApp.showToast('Starting download...', 'fa-solid fa-download', 'success');
            // Mock download trigger. In pure Firebase without Storage, this is a Base64 link or external secure URL
            var link = document.createElement('a');
            link.href = item.downloadUrl || '#';
            link.download = item.title + '.zip';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            // Trigger Share Modal
            _openShareModal(itemId, item.title);
        }
    }

    function _incrementDownload(itemId) {
        if (!window.db) return;
        window.db.collection('freebies').doc(itemId).update({
            downloads: firebase.firestore.FieldValue.increment(1)
        }).catch(function(){});
    }

    function _openShareModal(itemId, title) {
        var shareUrl = window.location.origin + '/freebies/freebies.html?item=' + itemId;
        var text = encodeURIComponent('Check out this free asset: ' + title + ' on Nexra Tech PK!');
        var url = encodeURIComponent(shareUrl);

        var modalHTML = '<div class="fr-share-modal" id="fr-share-modal">' +
                        '<div class="fr-share-box">' +
                        '<h3 class="tech-font" style="font-size:20px; font-weight:800; margin-bottom:8px; color:var(--text-100);">Share to Unlock</h3>' +
                        '<p style="font-size:14px; color:var(--text-200);">Share this resource on any platform to instantly unlock the download link.</p>' +
                        '<div class="fr-share-socials">' +
                        '<button class="fr-share-btn fr-share-fb" onclick="NexraFreebies.executeShare(\'fb\', \'' + url + '\', \'' + itemId + '\')"><i class="fa-brands fa-facebook-f"></i></button>' +
                        '<button class="fr-share-btn fr-share-tw" onclick="NexraFreebies.executeShare(\'tw\', \'' + url + '\', \'' + itemId + '\', \'' + text + '\')"><i class="fa-brands fa-twitter"></i></button>' +
                        '<button class="fr-share-btn fr-share-wa" onclick="NexraFreebies.executeShare(\'wa\', \'' + url + '\', \'' + itemId + '\', \'' + text + '\')"><i class="fa-brands fa-whatsapp"></i></button>' +
                        '<button class="fr-share-btn fr-share-ln" onclick="NexraFreebies.executeShare(\'ln\', \'' + url + '\', \'' + itemId + '\')"><i class="fa-solid fa-link"></i></button>' +
                        '</div>' +
                        '<button class="btn btn-outline" onclick="NexraFreebies.closeShareModal()">Cancel</button>' +
                        '</div></div>';

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    function executeShare(platform, url, itemId, text) {
        var shareLink = '';
        if (platform === 'fb') shareLink = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
        if (platform === 'tw') shareLink = 'https://twitter.com/intent/tweet?url=' + url + '&text=' + (text || '');
        if (platform === 'wa') shareLink = 'https://api.whatsapp.com/send?text=' + (text || '') + ' ' + url;
        
        if (platform === 'ln') {
            // Copy link
            navigator.clipboard.writeText(decodeURIComponent(url)).then(function() {
                window.NexraApp.showToast('Link copied! Unlocking...', 'fa-solid fa-check', 'success');
                _finalizeUnlock(itemId);
            });
            return;
        }

        window.open(shareLink, '_blank', 'width=600,height=400');
        
        // Optimistic unlock after 2 seconds
        setTimeout(function() {
            window.NexraApp.showToast('Unlocked successfully!', 'fa-solid fa-unlock', 'success');
            _finalizeUnlock(itemId);
        }, 2000);
    }

    function _finalizeUnlock(itemId) {
        closeShareModal();
        _saveUnlock(itemId);
    }

    function closeShareModal() {
        var m = document.getElementById('fr-share-modal');
        if (m) m.remove();
    }

    /* ======================================================================
       SEARCH & AUTO-SUGGEST
       ====================================================================== */
    function _handleSearchInput() {
        var q = _DOM.searchInp.value.trim().toLowerCase();
        if (q.length < 2) {
            if (_DOM.suggestDrop) _DOM.suggestDrop.setAttribute('hidden', '');
            if (q.length === 0 && _state.searchQuery !== '') {
                _state.searchQuery = '';
                _fetchItems(true); // reset
            }
            return;
        }

        _state.searchQuery = q;
        
        // Local filtering of current items for fast suggest
        var hits = _state.items.filter(function(i) {
            return i.title.toLowerCase().indexOf(q) !== -1 || i.category.toLowerCase().indexOf(q) !== -1;
        }).slice(0, 5);

        if (_DOM.suggestDrop) {
            if (hits.length > 0) {
                _DOM.suggestDrop.innerHTML = hits.map(function(h) {
                    return '<div class="fr-suggest-item" onclick="NexraFreebies.selectSuggest(\'' + h.id + '\')">' +
                           '<i class="fa-solid fa-box-open"></i> <span>' + _esc(h.title) + '</span>' +
                           '</div>';
                }).join('');
                _DOM.suggestDrop.removeAttribute('hidden');
            } else {
                _DOM.suggestDrop.innerHTML = '<div class="fr-suggest-item" style="color:var(--text-300); justify-content:center;">No direct matches... Press enter to search</div>';
                _DOM.suggestDrop.removeAttribute('hidden');
            }
        }
    }

    function selectSuggest(itemId) {
        if (_DOM.suggestDrop) _DOM.suggestDrop.setAttribute('hidden', '');
        // Filter grid to show only this item (simulated search)
        var hit = _state.items.find(function(i) { return i.id === itemId; });
        if (hit) {
            _state.items = [hit];
            _state.hasMore = false;
            if (_DOM.loadMoreWrap) _DOM.loadMoreWrap.setAttribute('hidden', '');
            _renderGrid();
        }
    }

    /* ======================================================================
       VOICE SEARCH ENGINE
       ====================================================================== */
    function _initSpeech() {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            _state.speechRec = new SpeechRecognition();
            _state.speechRec.continuous = false;
            _state.speechRec.interimResults = false;
            _state.speechRec.lang = 'en-US';

            _state.speechRec.onstart = function() {
                if (_DOM.voiceBtn) _DOM.voiceBtn.classList.add('recording');
                window.NexraApp.showToast('Listening...', 'fa-solid fa-microphone', 'default');
            };

            _state.speechRec.onresult = function(e) {
                var transcript = e.results[0][0].transcript;
                if (_DOM.searchInp) {
                    _DOM.searchInp.value = transcript;
                    _handleSearchInput();
                }
            };

            _state.speechRec.onend = function() {
                if (_DOM.voiceBtn) _DOM.voiceBtn.classList.remove('recording');
            };
        } else {
            if (_DOM.voiceBtn) _DOM.voiceBtn.style.display = 'none'; // Not supported
        }
    }

    function startVoiceSearch() {
        if (_state.speechRec) {
            try {
                _state.speechRec.start();
            } catch(e) {
                _state.speechRec.stop();
            }
        } else {
            window.NexraApp.showToast('Voice search not supported in this browser.', 'fa-solid fa-triangle-exclamation', 'default');
        }
    }

    /* ======================================================================
       UTILITY
       ====================================================================== */
    function scrollCats(dir) {
        if (_DOM.catTrack) {
            _DOM.catTrack.scrollBy({ left: dir * 200, behavior: 'smooth' });
        }
    }

    function _debounce(func, wait) {
        var timeout;
        return function() {
            var context = this, args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(function() { func.apply(context, args); }, wait);
        };
    }

    function _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        setCategory: setCategory,
        resetFilters: resetFilters,
        loadMore: loadMore,
        scrollCats: scrollCats,
        startVoiceSearch: startVoiceSearch,
        selectSuggest: selectSuggest,
        handleAction: handleAction,
        executeShare: executeShare,
        closeShareModal: closeShareModal
    };

})();
