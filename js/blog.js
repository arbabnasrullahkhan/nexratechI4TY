/**
 * ==========================================================================
 * NEXRA TECH PK — ACADEMY/BLOG ENGINE (js/blog.js)
 * ==========================================================================
 * Namespace: window.NexraBlog
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on academy/blog.html
 * ==========================================================================
 */

window.NexraBlog = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        currentUser: null,
        wishlist: [],
        
        // Feed State
        items: [],
        categories: [],
        activeCat: 'All',
        searchQuery: '',
        lastDoc: null,
        isLoading: false,
        hasMore: true,
        
        // Ads & Layout
        adFrequency: 4,
        layout: 'grid', // 'grid' | 'list'
        
        // Voice Search
        speechRec: null,

        // Carousel
        carouselItems: [],
        activeSlide: 0,
        slideInterval: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;
        console.log('[NexraBlog] Initializing...');

        _cacheDOM();
        _loadLayoutPref();
        _captureUTM();
        _subscribeAuth();
        _initSpeech();

        // Search Listeners
        if (_DOM.searchInp) {
            _DOM.searchInp.addEventListener('input', _debounce(_handleSearchInput, 300));
            _DOM.searchInp.addEventListener('focus', function() {
                if (_DOM.searchInp.value.length > 1) _DOM.suggestDrop.removeAttribute('hidden');
            });
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#bl-search-wrap') && _DOM.suggestDrop) {
                    _DOM.suggestDrop.setAttribute('hidden', '');
                }
            });
        }

        // Intersection Observer for Infinite Scroll
        _initObserver();

        // Fetch Data
        _fetchCategories();
        _fetchFeatured();
        _fetchFeed(true);
    }

    function _cacheDOM() {
        _DOM.feed = document.getElementById('bl-feed-wrap');
        _DOM.catTrack = document.getElementById('bl-cats-track');
        _DOM.emptyState = document.getElementById('bl-empty-state');
        _DOM.sentinel = document.getElementById('bl-scroll-sentinel');
        _DOM.endMsg = document.getElementById('bl-end-message');
        
        _DOM.searchInp = document.getElementById('bl-search-input');
        _DOM.suggestDrop = document.getElementById('bl-search-dropdown');
        _DOM.voiceBtn = document.getElementById('bl-voice-btn');
        
        _DOM.carouselWrap = document.getElementById('bl-carousel-wrap');
        _DOM.carouselNav = document.getElementById('bl-carousel-nav');
    }

    /* ======================================================================
       ANALYTICS & PREFS
       ====================================================================== */
    function _captureUTM() {
        var params = new URLSearchParams(window.location.search);
        var src = params.get('utm_source');
        if (src) sessionStorage.setItem('utm_source', src);
    }

    function _loadLayoutPref() {
        var pref = localStorage.getItem('nexra_blog_layout');
        if (pref) setLayout(pref, true);
    }

    function setLayout(type, skipSave) {
        _state.layout = type;
        if (!skipSave) localStorage.setItem('nexra_blog_layout', type);

        var btnG = document.getElementById('bl-btn-grid');
        var btnL = document.getElementById('bl-btn-list');
        
        if (type === 'grid') {
            if (btnG) btnG.classList.add('active');
            if (btnL) btnL.classList.remove('active');
            if (_DOM.feed) _DOM.feed.className = 'bl-view-grid';
        } else {
            if (btnG) btnG.classList.remove('active');
            if (btnL) btnL.classList.add('active');
            if (_DOM.feed) _DOM.feed.className = 'bl-view-list';
        }
    }

    /* ======================================================================
       AUTH & WISHLIST
       ====================================================================== */
    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user && window.db) {
                // Sync wishlist
                window.db.collection('users').doc(user.uid).collection('wishlist').onSnapshot(function(snap) {
                    _state.wishlist = snap.docs.map(function(d) { return d.id; });
                    _syncBookmarkIcons();
                });
            } else {
                _state.wishlist = [];
                _syncBookmarkIcons();
            }
        });
    }

    function _syncBookmarkIcons() {
        var btns = document.querySelectorAll('.bl-bookmark-btn');
        btns.forEach(function(btn) {
            var id = btn.getAttribute('data-id');
            if (_state.wishlist.indexOf(id) !== -1) {
                btn.classList.add('saved');
                btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
            } else {
                btn.classList.remove('saved');
                btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
            }
        });
    }

    function toggleBookmark(id) {
        if (!_state.currentUser) {
            window.NexraApp.showToast('Please log in to save articles.', 'fa-solid fa-shield-halved', 'default');
            setTimeout(function() { window.location.href = '/user/auth-gate.html'; }, 1500);
            return;
        }

        var isSaved = _state.wishlist.indexOf(id) !== -1;
        var ref = window.db.collection('users').doc(_state.currentUser.uid).collection('wishlist').doc(id);
        
        if (isSaved) {
            ref.delete();
            window.NexraApp.showToast('Removed from vault.', 'fa-solid fa-trash', 'default');
        } else {
            ref.set({
                savedAt: firebase.firestore.FieldValue.serverTimestamp(),
                type: 'article'
            });
            window.NexraApp.showToast('Saved to digital vault!', 'fa-solid fa-heart', 'success');
            // Haptic
            if (navigator.vibrate) navigator.vibrate(50);
        }
    }

    /* ======================================================================
       FIRESTORE QUERIES
       ====================================================================== */
    function _fetchCategories() {
        // Config fetch
        if (!window.db) return;
        window.db.collection('settings').doc('blog').get().then(function(doc) {
            var cats = ['All'];
            if (doc.exists && doc.data().categories) {
                cats = cats.concat(doc.data().categories);
            } else {
                cats = ['All', 'SaaS', 'UI/UX Design', 'Marketing', 'AI', 'Tutorials'];
            }
            _state.categories = cats;
            _renderCategories();
        }).catch(function() {
            _state.categories = ['All', 'SaaS', 'UI/UX Design', 'Marketing'];
            _renderCategories();
        });
    }

    function _fetchFeatured() {
        if (!window.db || !_DOM.carouselWrap) return;
        
        window.db.collection('blogs')
            .where('status', '==', 'published')
            .where('isFeatured', '==', true)
            .orderBy('createdAt', 'desc')
            .limit(3)
            .get().then(function(snap) {
                if (snap.empty) {
                    _DOM.carouselWrap.parentElement.style.display = 'none';
                    return;
                }
                
                snap.forEach(function(doc) {
                    var d = doc.data();
                    d.id = doc.id;
                    _state.carouselItems.push(d);
                });
                
                _renderCarousel();
            });
    }

    function _fetchFeed(isFirstLoad) {
        if (!window.db || _state.isLoading || !_state.hasMore) return;
        _state.isLoading = true;
        
        if (isFirstLoad) {
            _state.lastDoc = null;
            _state.items = [];
            if (_DOM.sentinel) _DOM.sentinel.removeAttribute('hidden');
            if (_DOM.endMsg) _DOM.endMsg.setAttribute('hidden', '');
        }

        var ref = window.db.collection('blogs').where('status', '==', 'published');
        
        if (_state.activeCat !== 'All') {
            ref = ref.where('category', '==', _state.activeCat);
        }
        
        ref = ref.orderBy('createdAt', 'desc');

        if (_state.lastDoc) {
            ref = ref.startAfter(_state.lastDoc);
        }

        ref.limit(8).get().then(function(snap) {
            if (snap.empty) {
                _state.hasMore = false;
                if (isFirstLoad) {
                    _DOM.feed.innerHTML = '';
                    if (_DOM.emptyState) _DOM.emptyState.removeAttribute('hidden');
                    if (_DOM.sentinel) _DOM.sentinel.setAttribute('hidden', '');
                } else {
                    if (_DOM.sentinel) _DOM.sentinel.setAttribute('hidden', '');
                    if (_DOM.endMsg) _DOM.endMsg.removeAttribute('hidden');
                }
            } else {
                if (_DOM.emptyState) _DOM.emptyState.setAttribute('hidden', '');
                
                _state.lastDoc = snap.docs[snap.docs.length - 1];
                _state.hasMore = snap.docs.length === 8;
                
                var newItems = [];
                snap.forEach(function(doc) {
                    var d = doc.data();
                    d.id = doc.id;
                    newItems.push(d);
                });
                
                _state.items = _state.items.concat(newItems);
                
                if (isFirstLoad) {
                    _DOM.feed.innerHTML = ''; // clear skeletons
                }
                
                _appendCards(newItems);
                
                if (!_state.hasMore) {
                    if (_DOM.sentinel) _DOM.sentinel.setAttribute('hidden', '');
                    if (_DOM.endMsg) _DOM.endMsg.removeAttribute('hidden');
                }
            }
            _state.isLoading = false;
        }).catch(function(err) {
            console.error('Fetch error:', err);
            _state.isLoading = false;
            if (_DOM.sentinel) _DOM.sentinel.setAttribute('hidden', '');
        });
    }

    /* ======================================================================
       INTERSECTION OBSERVER (INFINITE SCROLL)
       ====================================================================== */
    function _initObserver() {
        if (!_DOM.sentinel || !window.IntersectionObserver) return;
        
        var observer = new IntersectionObserver(function(entries) {
            if (entries[0].isIntersecting && !_state.isLoading && _state.hasMore) {
                _fetchFeed(false);
            }
        }, { rootMargin: '200px' });
        
        observer.observe(_DOM.sentinel);
    }

    /* ======================================================================
       RENDERING LOGIC
       ====================================================================== */
    function _renderCategories() {
        if (!_DOM.catTrack) return;
        _DOM.catTrack.innerHTML = _state.categories.map(function(cat) {
            var activeClass = cat === _state.activeCat ? 'active' : '';
            return '<button class="bl-cat-pill ' + activeClass + '" onclick="NexraBlog.setCategory(\'' + _esc(cat) + '\')">' + _esc(cat) + '</button>';
        }).join('');
    }

    function setCategory(cat) {
        if (_state.activeCat === cat) return;
        _state.activeCat = cat;
        _renderCategories();
        
        if (_DOM.searchInp) _DOM.searchInp.value = '';
        _state.searchQuery = '';
        _state.hasMore = true;
        
        // Inject Skeletons manually for visual feedback
        if (_DOM.feed) {
            _DOM.feed.innerHTML = '<div class="bl-card-skeleton"><div class="bl-skel-img"></div><div class="bl-skel-body"><div class="bl-skel-line w80 h2"></div></div></div>' +
                                  '<div class="bl-card-skeleton"><div class="bl-skel-img"></div><div class="bl-skel-body"><div class="bl-skel-line w80 h2"></div></div></div>';
        }
        
        _fetchFeed(true);
        
        // Analytics tracking for cat clicks
        console.log('[Analytics] Category Clicked: ' + cat);
    }

    function resetFilters() { setCategory('All'); }

    function _appendCards(items) {
        if (!_DOM.feed) return;
        
        var html = items.map(function(item, index) {
            var globalIndex = _state.items.length - items.length + index;
            var out = _buildCardHTML(item);
            
            // Adsterra Injection (every 4th item, but not the very first)
            if (globalIndex > 0 && (globalIndex + 1) % _state.adFrequency === 0) {
                out += '<div class="bl-ad-card">' +
                       '<div class="bl-ad-label">Sponsored</div>' +
                       '<div>Native Ad Slot (Adsterra Script)</div>' +
                       '</div>';
            }
            return out;
        }).join('');
        
        _DOM.feed.insertAdjacentHTML('beforeend', html);
        
        // Trigger Canvas Renders
        items.forEach(function(item) { _renderCanvasThumb(item); });
        _syncBookmarkIcons();
    }

    function _buildCardHTML(item) {
        var wordCount = item.wordCount || 800;
        var readTime = Math.ceil(wordCount / 200); // 200 wpm
        var views = item.views || 0;
        var comments = item.comments || 0;
        var isSaved = _state.wishlist.indexOf(item.id) !== -1;
        var heartIcon = isSaved ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
        var savedClass = isSaved ? 'saved' : '';

        return '<article class="bl-card">' +
               '<a href="/academy/post.html?id=' + item.id + '" class="bl-card-media">' +
               '<div class="bl-read-tag"><i class="fa-regular fa-clock"></i> ' + readTime + ' min</div>' +
               '<canvas id="bl-cvs-' + item.id + '" class="bl-card-canvas"></canvas>' +
               '</a>' +
               '<div class="bl-card-body">' +
               '<div class="bl-card-cat">' + _esc(item.category) + '</div>' +
               '<a href="/academy/post.html?id=' + item.id + '" style="text-decoration:none;"><h2 class="bl-card-title">' + _esc(item.title) + '</h2></a>' +
               '<p class="bl-card-desc">' + _esc(item.excerpt) + '</p>' +
               '<div class="bl-card-footer">' +
               '<div class="bl-stats">' +
               '<span><i class="fa-regular fa-eye"></i> ' + views + '</span>' +
               '<span><i class="fa-regular fa-comment"></i> ' + comments + '</span>' +
               '</div>' +
               '<button class="bl-bookmark-btn ' + savedClass + '" data-id="' + item.id + '" onclick="NexraBlog.toggleBookmark(\'' + item.id + '\')"><i class="' + heartIcon + '"></i></button>' +
               '</div>' +
               '</div>' +
               '</article>';
    }

    function _renderCanvasThumb(item) {
        var cvs = document.getElementById('bl-cvs-' + item.id);
        if (!cvs) return;
        var ctx = cvs.getContext('2d');
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            cvs.width = img.width;
            cvs.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Watermark Logo
            var wtm = window.NexraBrand ? window.NexraBrand.getAsset('watermark') : '/assets/watermark-sm.png';
            var wmImg = new Image();
            wmImg.onload = function() {
                var w = cvs.width * 0.15;
                var h = (wmImg.height / wmImg.width) * w;
                ctx.globalAlpha = 0.8;
                ctx.drawImage(wmImg, cvs.width - w - 20, cvs.height - h - 20, w, h);
                ctx.globalAlpha = 1.0;
            };
            wmImg.src = wtm;
        };
        img.src = item.imgUrl || item.imgBase64 || '/assets/placeholder.jpg';
    }

    /* ======================================================================
       CAROUSEL LOGIC
       ====================================================================== */
    function _renderCarousel() {
        if (!_DOM.carouselWrap) return;
        
        var slidesHTML = _state.carouselItems.map(function(item, idx) {
            var activeClass = idx === 0 ? 'active' : '';
            return '<div class="bl-slide ' + activeClass + '" id="bl-slide-' + idx + '">' +
                   '<canvas id="bl-cvs-hero-' + idx + '" class="bl-slide-canvas"></canvas>' +
                   '<div class="bl-slide-overlay"></div>' +
                   '<div class="bl-slide-content">' +
                   '<div class="bl-slide-cat">' + _esc(item.category) + '</div>' +
                   '<a href="/academy/post.html?id=' + item.id + '" class="bl-slide-title">' + _esc(item.title) + '</a>' +
                   '<p class="bl-slide-desc">' + _esc(item.excerpt) + '</p>' +
                   '<div class="bl-slide-meta">' +
                   '<span><i class="fa-regular fa-clock"></i> ' + Math.ceil((item.wordCount||800)/200) + ' min read</span>' +
                   '<span><i class="fa-regular fa-eye"></i> ' + (item.views||0) + '</span>' +
                   '</div>' +
                   '</div>' +
                   '</div>';
        }).join('');
        
        _DOM.carouselWrap.innerHTML = slidesHTML;
        
        // Render Canvas for Heroes
        _state.carouselItems.forEach(function(item, idx) {
            var cvs = document.getElementById('bl-cvs-hero-' + idx);
            if (!cvs) return;
            var ctx = cvs.getContext('2d');
            var img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = function() {
                cvs.width = img.width; cvs.height = img.height;
                ctx.drawImage(img, 0, 0);
            };
            img.src = item.imgUrl || item.imgBase64;
        });

        // Render Nav
        if (_DOM.carouselNav && _state.carouselItems.length > 1) {
            _DOM.carouselNav.innerHTML = _state.carouselItems.map(function(it, i) {
                return '<div class="bl-dot ' + (i===0?'active':'') + '" onclick="NexraBlog.goToSlide(' + i + ')"></div>';
            }).join('');
            _DOM.carouselNav.removeAttribute('hidden');
            
            _state.slideInterval = setInterval(_nextSlide, 5000);
        }
    }

    function goToSlide(idx) {
        if (idx === _state.activeSlide) return;
        
        var oldS = document.getElementById('bl-slide-' + _state.activeSlide);
        var newS = document.getElementById('bl-slide-' + idx);
        if (oldS) oldS.classList.remove('active');
        if (newS) newS.classList.add('active');
        
        if (_DOM.carouselNav) {
            var dots = _DOM.carouselNav.querySelectorAll('.bl-dot');
            if (dots[_state.activeSlide]) dots[_state.activeSlide].classList.remove('active');
            if (dots[idx]) dots[idx].classList.add('active');
        }
        
        _state.activeSlide = idx;
        
        // Reset interval manually
        if (_state.slideInterval) {
            clearInterval(_state.slideInterval);
            _state.slideInterval = setInterval(_nextSlide, 5000);
        }
    }

    function _nextSlide() {
        var next = (_state.activeSlide + 1) % _state.carouselItems.length;
        goToSlide(next);
    }

    /* ======================================================================
       SEARCH & VOICE
       ====================================================================== */
    function _handleSearchInput() {
        var q = _DOM.searchInp.value.trim().toLowerCase();
        if (q.length < 2) {
            if (_DOM.suggestDrop) _DOM.suggestDrop.setAttribute('hidden', '');
            if (q.length === 0 && _state.searchQuery !== '') {
                _state.searchQuery = '';
                _state.hasMore = true;
                _fetchFeed(true);
            }
            return;
        }

        _state.searchQuery = q;
        
        // Query logic (mocked with local for suggest, but full requires Algolia or Firebase extension. 
        // For pure firebase without extensions, we use a simple front-end filter if data is small, or a title prefix array).
        // For demonstration, we fetch 5 matching title prefixes.
        if (window.db) {
            window.db.collection('blogs')
                .where('status', '==', 'published')
                .where('titleLowercase', '>=', q)
                .where('titleLowercase', '<=', q + '\uf8ff')
                .limit(5).get().then(function(snap) {
                    if (_DOM.suggestDrop) {
                        if (snap.empty) {
                            _DOM.suggestDrop.innerHTML = '<div class="bl-suggest-item" style="color:var(--text-300); justify-content:center;">No direct matches found.</div>';
                        } else {
                            var html = '';
                            snap.forEach(function(doc) {
                                var d = doc.data();
                                html += '<div class="bl-suggest-item" onclick="window.location.href=\'/academy/post.html?id=' + doc.id + '\'">' +
                                        '<i class="fa-solid fa-file-lines"></i> <span>' + _esc(d.title) + '</span>' +
                                        '</div>';
                            });
                            _DOM.suggestDrop.innerHTML = html;
                        }
                        _DOM.suggestDrop.removeAttribute('hidden');
                    }
                });
        }
    }

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
            if (_DOM.voiceBtn) _DOM.voiceBtn.style.display = 'none';
        }
    }

    function startVoiceSearch() {
        if (_state.speechRec) {
            try { _state.speechRec.start(); } catch(e) { _state.speechRec.stop(); }
        } else {
            window.NexraApp.showToast('Voice search not supported.', 'fa-solid fa-triangle-exclamation', 'default');
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
        scrollCats: scrollCats,
        setLayout: setLayout,
        startVoiceSearch: startVoiceSearch,
        toggleBookmark: toggleBookmark,
        goToSlide: goToSlide
    };

})();
