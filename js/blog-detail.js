/**
 * ==========================================================================
 * NEXRA TECH PK — BLOG DETAIL ENGINE (js/blog-detail.js)
 * ==========================================================================
 * Namespace: window.NexraBlogDetail
 * Pattern:   IIFE → exposes public API on window
 * Loaded:    Only on academy/blog-detail.html
 * ==========================================================================
 */

window.NexraBlogDetail = (function () {
    'use strict';

    /* ======================================================================
       PRIVATE STATE
       ====================================================================== */
    var _state = {
        initialized: false,
        articleId: null,
        articleData: null,
        currentUser: null,
        
        // TOC & Scroll
        tocElements: [],
        
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
        console.log('[NexraBlogDetail] Initializing...');

        var params = new URLSearchParams(window.location.search);
        _state.articleId = params.get('id');

        if (!_state.articleId) {
            window.location.href = '/academy/blog.html';
            return;
        }

        _cacheDOM();
        _subscribeAuth();
        _setupScrollListener();
        _fetchArticle();
    }

    function _cacheDOM() {
        _DOM.skeleton = document.getElementById('bd-skeleton-wrap');
        _DOM.content = document.getElementById('bd-content-wrap');
        _DOM.progressBar = document.getElementById('bd-progress-bar');
        _DOM.richContent = document.getElementById('bd-rich-content');
        _DOM.tocList = document.getElementById('bd-toc-list');
        
        _DOM.aiPanel = document.getElementById('bd-ai-panel');
        _DOM.aiChat = document.getElementById('bd-ai-chat');
        _DOM.aiInput = document.getElementById('bd-ai-input');
        
        _DOM.commentGate = document.getElementById('bd-comment-auth-gate');
        _DOM.commentInputWrap = document.getElementById('bd-comment-input-wrap');
        _DOM.commentFeed = document.getElementById('bd-comments-feed');
        _DOM.commentCount = document.getElementById('bd-val-comment-count');
    }

    function _fetchArticle() {
        if (!window.db) return;
        
        window.db.collection('blogs').doc(_state.articleId).get().then(function(doc) {
            if (!doc.exists) {
                window.location.href = '/academy/blog.html';
                return;
            }
            _state.articleData = doc.data();
            _state.articleData.id = doc.id;
            
            // Increment Views Optimistically
            window.db.collection('blogs').doc(_state.articleId).update({
                views: firebase.firestore.FieldValue.increment(1)
            }).catch(function(){});

            _injectSEO();
            _renderUI();
            _injectAds();
            _generateToC();
            _fetchRelated();
            _fetchComments();
            
            // AI Context
            _state.aiContext = "You are Nexra AI. Summarize or answer questions about this article: '" + _state.articleData.title + "'. Content: " + _state.articleData.content.substring(0, 1500) + "...";

            if (_DOM.skeleton) _DOM.skeleton.style.display = 'none';
            if (_DOM.content) _DOM.content.removeAttribute('hidden');

            setTimeout(_renderCanvasWatermark, 100);

        }).catch(function(err) {
            console.error('Fetch error:', err);
        });
    }

    /* ======================================================================
       AUTH & COMMENTS
       ====================================================================== */
    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function (user) {
            _state.currentUser = user;
            if (user) {
                if (_DOM.commentGate) _DOM.commentGate.setAttribute('hidden', '');
                if (_DOM.commentInputWrap) _DOM.commentInputWrap.style.opacity = '1';
                _checkLocalLike();
            } else {
                if (_DOM.commentGate) _DOM.commentGate.removeAttribute('hidden');
                if (_DOM.commentInputWrap) _DOM.commentInputWrap.style.opacity = '0.5';
            }
        });
    }

    function _fetchComments() {
        if (!window.db) return;
        window.db.collection('blogs').doc(_state.articleId).collection('comments')
            .orderBy('createdAt', 'desc').limit(20)
            .onSnapshot(function(snap) {
                if (snap.empty) {
                    _DOM.commentFeed.innerHTML = '<div style="color:var(--text-300);font-size:14px;text-align:center;">Be the first to share your thoughts!</div>';
                    if (_DOM.commentCount) _DOM.commentCount.textContent = '0';
                    return;
                }
                
                var html = '';
                snap.forEach(function(doc) {
                    var d = doc.data();
                    var dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString() : 'Just now';
                    var adminBadge = d.isAdmin ? '<span class="bd-admin-badge">Admin</span>' : '';
                    var upvotes = d.upvotes || 0;
                    
                    html += '<div class="bd-comment-item">' +
                            '<img src="' + (d.authorPhoto || '/assets/avatar-placeholder.png') + '" class="bd-comment-avatar">' +
                            '<div class="bd-comment-content">' +
                            '<div class="bd-comment-head">' +
                            '<div class="bd-comment-author">' + _esc(d.authorName) + ' ' + adminBadge + '</div>' +
                            '<div class="bd-comment-date">' + dateStr + '</div>' +
                            '</div>' +
                            '<div class="bd-comment-text">' + _esc(d.text) + '</div>' +
                            '<div class="bd-comment-actions-bar">' +
                            '<button class="bd-comment-action-btn" onclick="NexraBlogDetail.upvoteComment(\'' + doc.id + '\')"><i class="fa-solid fa-caret-up"></i> ' + upvotes + '</button>' +
                            '</div>' +
                            '</div>' +
                            '</div>';
                });
                
                _DOM.commentFeed.innerHTML = html;
                if (_DOM.commentCount) _DOM.commentCount.textContent = snap.size;
            });
    }

    function postComment() {
        if (!_state.currentUser) return;
        var ta = document.getElementById('bd-comment-textarea');
        var text = ta.value.trim();
        if (!text) return;
        
        ta.value = '';
        
        window.db.collection('blogs').doc(_state.articleId).collection('comments').add({
            authorId: _state.currentUser.uid,
            authorName: _state.currentUser.displayName || 'Anonymous User',
            authorPhoto: _state.currentUser.photoURL || '',
            text: text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            upvotes: 0,
            isAdmin: false
        }).then(function() {
            window.db.collection('blogs').doc(_state.articleId).update({
                comments: firebase.firestore.FieldValue.increment(1)
            }).catch(function(){});
            window.NexraApp.showToast('Comment posted successfully!', 'fa-solid fa-comment-dots', 'success');
        });
    }

    function upvoteComment(cid) {
        if (!_state.currentUser) {
            window.NexraApp.showToast('Log in to upvote!', 'fa-solid fa-lock', 'default');
            return;
        }
        var key = 'nexra_upvoted_' + cid;
        if (localStorage.getItem(key)) {
            window.NexraApp.showToast('Already upvoted', 'fa-solid fa-circle-check', 'default');
            return;
        }
        localStorage.setItem(key, '1');
        window.db.collection('blogs').doc(_state.articleId).collection('comments').doc(cid).update({
            upvotes: firebase.firestore.FieldValue.increment(1)
        });
        if (navigator.vibrate) navigator.vibrate(50);
    }

    /* ======================================================================
       RENDERING & TOC
       ====================================================================== */
    function _renderUI() {
        var d = _state.articleData;
        var wc = d.wordCount || 800;
        var rt = Math.ceil(wc / 200);

        document.getElementById('bd-val-cat').textContent = d.category;
        document.getElementById('bd-val-cat-link').href = '/academy/blog.html?cat=' + encodeURIComponent(d.category);
        document.getElementById('bd-val-bc-title').textContent = d.title;
        document.getElementById('bd-val-badge-cat').textContent = d.category;
        document.getElementById('bd-val-readtime').textContent = rt + ' min read';
        document.getElementById('bd-val-views').textContent = (d.views || 0) + 1; // +1 optimistic
        document.getElementById('bd-val-title').textContent = d.title;
        document.getElementById('bd-val-excerpt').textContent = d.excerpt;
        
        var dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'Recently';
        document.getElementById('bd-val-date').textContent = dateStr;
        document.getElementById('bd-val-likes-island').textContent = d.likes || 0;
        
        // Author block
        var aName = d.authorName || 'Nexra Editorial';
        document.getElementById('bd-val-author-name').textContent = aName;
        document.getElementById('bd-val-author-box-name').textContent = aName;
        
        // Inject HTML securely (trusting backend admin panel HTML)
        if (_DOM.richContent) {
            _DOM.richContent.innerHTML = d.content || '<p>No content available.</p>';
        }
    }

    function _generateToC() {
        if (!_DOM.richContent || !_DOM.tocList) return;
        var headings = _DOM.richContent.querySelectorAll('h2, h3');
        if (headings.length === 0) {
            document.getElementById('bd-toc-container').style.display = 'none';
            return;
        }
        
        var html = '';
        _state.tocElements = [];
        
        headings.forEach(function(h, idx) {
            var id = h.id || 'sec-' + idx;
            h.id = id;
            var depthClass = h.tagName.toLowerCase() === 'h3' ? 'depth-h3' : '';
            html += '<a href="#' + id + '" class="' + depthClass + '" data-toc="' + id + '">' + _esc(h.textContent) + '</a>';
            _state.tocElements.push({ id: id, el: h });
        });
        
        _DOM.tocList.innerHTML = html;
    }

    function _injectAds() {
        if (!_DOM.richContent) return;
        var ps = _DOM.richContent.querySelectorAll('p');
        // Inject an Adsterra block after every 5th paragraph
        ps.forEach(function(p, idx) {
            if (idx > 0 && idx % 5 === 0) {
                var ad = document.createElement('div');
                ad.className = 'bd-ad-inline';
                ad.innerHTML = '<div class="bd-ad-placeholder">Sponsored Insight</div><div>[Adsterra Native Block]</div>';
                p.parentNode.insertBefore(ad, p.nextSibling);
            }
        });
    }

    function _renderCanvasWatermark() {
        var cvs = document.getElementById('bd-canvas-hero');
        if (!cvs || !_state.articleData) return;
        var ctx = cvs.getContext('2d');
        
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            cvs.width = img.width;
            cvs.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Draw Watermark Text
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.font = "bold " + (cvs.width * 0.05) + "px sans-serif";
            ctx.textAlign = "right";
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 10;
            ctx.fillText("NEXRA ACADEMY", cvs.width - 30, cvs.height - 30);
        };
        img.src = _state.articleData.imgUrl || _state.articleData.imgBase64 || '/assets/placeholder.jpg';
    }

    /* ======================================================================
       SCROLL PROGRESS & TOC HIGHLIGHT
       ====================================================================== */
    function _setupScrollListener() {
        window.addEventListener('scroll', function() {
            // 1. Progress Bar
            if (_DOM.progressBar) {
                var winScroll = document.body.scrollTop || document.documentElement.scrollTop;
                var height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
                var scrolled = (winScroll / height) * 100;
                _DOM.progressBar.style.width = scrolled + '%';
            }
            
            // 2. ToC Highlighting
            if (_state.tocElements.length > 0 && _DOM.tocList) {
                var scrollPos = window.scrollY + 150; // Offset for sticky header
                var currentId = null;
                
                for (var i = 0; i < _state.tocElements.length; i++) {
                    var el = _state.tocElements[i].el;
                    if (el.offsetTop <= scrollPos) {
                        currentId = _state.tocElements[i].id;
                    } else {
                        break;
                    }
                }
                
                var links = _DOM.tocList.querySelectorAll('a');
                links.forEach(function(l) { l.classList.remove('active'); });
                if (currentId) {
                    var activeLink = _DOM.tocList.querySelector('a[data-toc="' + currentId + '"]');
                    if (activeLink) activeLink.classList.add('active');
                }
            }
        });
    }

    /* ======================================================================
       RELATED INSIGHTS
       ====================================================================== */
    function _fetchRelated() {
        if (!window.db || !_state.articleData) return;
        var grid = document.getElementById('bd-related-grid');
        if (!grid) return;
        
        window.db.collection('blogs')
            .where('status', '==', 'published')
            .where('category', '==', _state.articleData.category)
            .limit(4)
            .get().then(function(snap) {
                var html = '';
                var count = 0;
                snap.forEach(function(doc) {
                    if (doc.id === _state.articleId || count >= 3) return; // skip self, max 3
                    var d = doc.data();
                    html += '<a href="/academy/blog-detail.html?id=' + doc.id + '" class="bd-rel-card">' +
                            '<div class="bd-rel-media"><img src="' + (d.imgUrl || d.imgBase64 || '/assets/placeholder.jpg') + '" alt="Thumb"></div>' +
                            '<div class="bd-rel-body">' +
                            '<div class="bd-rel-title">' + _esc(d.title) + '</div>' +
                            '</div>' +
                            '</a>';
                    count++;
                });
                
                if (html === '') {
                    document.querySelector('.bd-related-section').style.display = 'none';
                } else {
                    grid.innerHTML = html;
                }
            });
    }

    /* ======================================================================
       SOCIAL SHARE & LIKES
       ====================================================================== */
    function executeShare(platform) {
        var d = _state.articleData;
        var url = window.location.href;
        var text = encodeURIComponent('Read "' + d.title + '" on Nexra Academy.');
        var urlEnc = encodeURIComponent(url);
        var link = '';

        if (platform === 'native' && navigator.share) {
            navigator.share({ title: d.title, text: 'Check out this insight on Nexra Tech PK', url: url })
                .catch(function(){});
            return;
        }

        if (platform === 'native') {
            navigator.clipboard.writeText(url).then(function() {
                window.NexraApp.showToast('Link copied to clipboard!', 'fa-solid fa-link', 'success');
            });
            return;
        }

        if (platform === 'wa') link = 'https://api.whatsapp.com/send?text=' + text + ' ' + urlEnc;
        if (platform === 'fb') link = 'https://www.facebook.com/sharer/sharer.php?u=' + urlEnc;
        if (platform === 'tg') link = 'https://t.me/share/url?url=' + urlEnc + '&text=' + text;

        window.open(link, '_blank', 'width=600,height=400');
    }

    function _checkLocalLike() {
        if (localStorage.getItem('nexra_liked_blog_' + _state.articleId)) {
            var icon = document.getElementById('bd-like-icon');
            var btn = document.querySelector('.bd-social-btn[title="Like"]');
            if (icon) icon.className = 'fa-solid fa-heart';
            if (btn) btn.classList.add('liked');
        }
    }

    function toggleLike() {
        var key = 'nexra_liked_blog_' + _state.articleId;
        var isLiked = localStorage.getItem(key);
        var btn = document.querySelector('.bd-social-btn[title="Like"]');
        var icon = document.getElementById('bd-like-icon');
        var countEl = document.getElementById('bd-val-likes-island');
        var current = parseInt(countEl.textContent || '0', 10);

        if (isLiked) {
            localStorage.removeItem(key);
            btn.classList.remove('liked');
            icon.className = 'fa-regular fa-heart';
            countEl.textContent = current - 1;
            if (window.db) window.db.collection('blogs').doc(_state.articleId).update({ likes: firebase.firestore.FieldValue.increment(-1) });
        } else {
            localStorage.setItem(key, '1');
            btn.classList.add('liked');
            icon.className = 'fa-solid fa-heart';
            countEl.textContent = current + 1;
            if (window.db) window.db.collection('blogs').doc(_state.articleId).update({ likes: firebase.firestore.FieldValue.increment(1) });
            if (navigator.vibrate) navigator.vibrate(50);
        }
    }

    /* ======================================================================
       TRIPLE-AI ASSISTANT
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
        _appendAI('user', val);
        _DOM.aiInput.value = '';
        var typingId = _appendAI('bot', '<i class="fa-solid fa-ellipsis fa-fade"></i>');
        
        setTimeout(function() {
            var msg = document.getElementById(typingId);
            if (msg) {
                msg.innerHTML = "Based on '" + _state.articleData.title + "', the key takeaway is exploring modern patterns. I can explain further in English or Urdu. (OpenRouter Demo)";
            }
        }, 1200);
    }

    function _appendAI(role, html) {
        var id = 'msg_' + Math.random().toString(36).substr(2, 9);
        var div = document.createElement('div');
        div.className = 'bd-ai-msg ' + role;
        div.id = id;
        div.innerHTML = html;
        _DOM.aiChat.appendChild(div);
        _DOM.aiChat.scrollTop = _DOM.aiChat.scrollHeight;
        return id;
    }

    /* ======================================================================
       SEO & META
       ====================================================================== */
    function _injectSEO() {
        var d = _state.articleData;
        var title = d.title + ' | Nexra Tech PK';
        var desc = d.excerpt;

        document.getElementById('bd-page-title').textContent = title;
        document.getElementById('bd-meta-desc').content = desc;
        document.getElementById('bd-og-title').content = title;
        document.getElementById('bd-og-desc').content = desc;
        document.getElementById('bd-tw-title').content = title;
        document.getElementById('bd-tw-desc').content = desc;
        
        var imgUrl = d.imgUrl || '';
        document.getElementById('bd-og-image').content = imgUrl;
        document.getElementById('bd-tw-image').content = imgUrl;

        var url = window.location.href;
        document.getElementById('bd-og-url').content = url;
        document.getElementById('bd-canonical').href = url;

        // Article Schema
        var schemaEl = document.getElementById('bd-ld-schema-article');
        if (schemaEl) {
            schemaEl.textContent = JSON.stringify({
                "@context": "https://schema.org",
                "@type": "TechArticle",
                "headline": d.title,
                "description": desc,
                "image": imgUrl,
                "author": { "@type": "Person", "name": d.authorName || "Nexra Editorial" },
                "publisher": { "@type": "Organization", "name": "Nexra Tech PK", "logo": { "@type": "ImageObject", "url": (window.NexraBrand ? window.NexraBrand.getAsset('logo') : 'https://nexratech.pk/assets/logo.png') } },
                "datePublished": d.createdAt ? new Date(d.createdAt.toDate()).toISOString() : new Date().toISOString()
            });
        }
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
        toggleLike: toggleLike,
        toggleAI: toggleAI,
        sendAIMessage: sendAIMessage,
        postComment: postComment,
        upvoteComment: upvoteComment
    };

})();
