/**
 * ==========================================================================
 * NEXRA TECH PK — SUPPORT HUB ENGINE (js/support.js)
 * ==========================================================================
 */

window.NexraSupport = (function () {
    'use strict';

    var _state = {
        initialized: false,
        user: null,
        faqs: [],
        activeCat: 'all',
        b64Image: null,
        searchTimeout: null
    };

    var _DOM = {};

    /* ======================================================================
       INIT & AUTH SUBSCRIPTION
       ====================================================================== */
    function init() {
        if (_state.initialized) return;
        _state.initialized = true;

        _cacheDOM();
        _bindSearch();
        _loadFaqs(); // Public KB
        _subscribeAuth(); // Live Ticketing
    }

    function _cacheDOM() {
        _DOM.authBlock = document.getElementById('sp-auth-block');
        _DOM.trackingCard = document.getElementById('sp-tracking-card');
        _DOM.ticketGrid = document.getElementById('sp-ticket-grid');
        _DOM.faqList = document.getElementById('sp-faq-list');
        _DOM.searchInput = document.getElementById('sp-search-input');
        _DOM.searchDrop = document.getElementById('sp-search-dropdown');
        _DOM.catTrack = document.getElementById('sp-cats-track');
    }

    function _subscribeAuth() {
        if (!window.auth) return;
        window.auth.onAuthStateChanged(function(user) {
            _state.user = user;
            if (user) {
                // Unlock ticket form
                if (_DOM.authBlock) {
                    _DOM.authBlock.style.opacity = '0';
                    setTimeout(function() { _DOM.authBlock.style.display = 'none'; }, 400);
                }
                if (_DOM.trackingCard) _DOM.trackingCard.style.display = 'block';
                _initTicketTracking(user.uid);
            } else {
                if (_DOM.authBlock) {
                    _DOM.authBlock.style.display = 'flex';
                    setTimeout(function() { _DOM.authBlock.style.opacity = '1'; }, 10);
                }
                if (_DOM.trackingCard) _DOM.trackingCard.style.display = 'none';
            }
        });
    }

    /* ======================================================================
       INTELLIGENT KNOWLEDGE BASE (FAQs)
       ====================================================================== */
    function _loadFaqs() {
        if (!window.db) return;
        window.db.collection('faqs').orderBy('order', 'asc').get()
            .then(function(snap) {
                var arr = [];
                snap.forEach(function(doc) { arr.push(doc.data()); });
                _state.faqs = arr;
                _renderFaqs(_state.faqs);
                _injectFAQSchema(arr);
            }).catch(function(err) {
                if (_DOM.faqList) _DOM.faqList.innerHTML = '<p style="color:var(--text-300);">Failed to load Knowledge Base. Please refresh.</p>';
            });
    }

    function _renderFaqs(dataArr) {
        if (!_DOM.faqList) return;
        if (dataArr.length === 0) {
            _DOM.faqList.innerHTML = '<p style="color:var(--text-300); text-align:center; padding:20px;">No articles found for this topic.</p>';
            return;
        }

        var html = '';
        dataArr.forEach(function(f, i) {
            html += `
            <div class="sp-faq-item" id="faq-${i}">
                <button class="sp-faq-header" onclick="NexraSupport.toggleFaq(${i})">
                    <span>${f.question}</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <div class="sp-faq-body">
                    <div class="sp-faq-content">${f.answer}</div>
                </div>
            </div>`;
        });
        _DOM.faqList.innerHTML = html;
    }

    function toggleFaq(index) {
        var el = document.getElementById('faq-' + index);
        if (!el) return;
        
        // Optional: Close others
        // document.querySelectorAll('.sp-faq-item').forEach(i => { if(i.id !== 'faq-'+index) i.classList.remove('active'); });
        
        el.classList.toggle('active');
    }

    function filterFaqs(cat, btnEl) {
        _state.activeCat = cat;
        
        var btns = document.querySelectorAll('.sp-cat-pill');
        btns.forEach(function(b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        if (cat === 'all') {
            _renderFaqs(_state.faqs);
            return;
        }

        var filtered = _state.faqs.filter(function(f) { return f.category === cat; });
        _renderFaqs(filtered);
    }

    function scrollCats(dir) {
        if (_DOM.catTrack) {
            _DOM.catTrack.scrollBy({ left: dir * 200, behavior: 'smooth' });
        }
    }

    /* ======================================================================
       SEARCH & PREDICTIVE DROPDOWN
       ====================================================================== */
    function _bindSearch() {
        if (!_DOM.searchInput) return;
        _DOM.searchInput.addEventListener('input', function(e) {
            clearTimeout(_state.searchTimeout);
            var query = e.target.value.toLowerCase().trim();
            
            if (query.length < 2) {
                _DOM.searchDrop.hidden = true;
                _renderFaqs(_state.activeCat === 'all' ? _state.faqs : _state.faqs.filter(f => f.category === _state.activeCat));
                return;
            }

            // Debounce for 300ms
            _state.searchTimeout = setTimeout(function() {
                var matches = _state.faqs.filter(function(f) {
                    return f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query);
                });
                
                // Show drop
                if (matches.length > 0) {
                    var dropHtml = matches.slice(0, 4).map(function(m, idx) {
                        return '<div class="sp-search-item" onclick="NexraSupport.selectSearch(\'' + escape(m.question) + '\')">' + m.question + '</div>';
                    }).join('');
                    _DOM.searchDrop.innerHTML = dropHtml;
                    _DOM.searchDrop.hidden = false;
                } else {
                    _DOM.searchDrop.innerHTML = '<div class="sp-search-item" style="pointer-events:none;">No articles found.</div>';
                    _DOM.searchDrop.hidden = false;
                }
                
                // Render list
                _renderFaqs(matches);
            }, 300);
        });

        // Close drop on click outside
        document.addEventListener('click', function(e) {
            if (_DOM.searchDrop && !_DOM.searchDrop.contains(e.target) && e.target !== _DOM.searchInput) {
                _DOM.searchDrop.hidden = true;
            }
        });
    }

    function selectSearch(escapedQ) {
        var q = unescape(escapedQ);
        if (_DOM.searchInput) _DOM.searchInput.value = q;
        if (_DOM.searchDrop) _DOM.searchDrop.hidden = true;
        
        var matches = _state.faqs.filter(function(f) { return f.question === q; });
        _renderFaqs(matches);
        setTimeout(function() { toggleFaq(0); }, 100);
    }

    function startVoiceSearch() {
        var btn = document.getElementById('sp-voice-btn');
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            if (window.NexraApp) NexraApp.showToast('Voice search not supported in this browser.', 'fa-solid fa-microphone-slash', 'warning');
            return;
        }
        
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        var rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;

        rec.onstart = function() {
            btn.classList.add('listening');
        };
        rec.onsuccess = function(e) {
            var res = e.results[0][0].transcript;
            if (_DOM.searchInput) {
                _DOM.searchInput.value = res;
                _DOM.searchInput.dispatchEvent(new Event('input')); // Trigger debounce search
            }
        };
        rec.onend = function() {
            btn.classList.remove('listening');
        };
        rec.onerror = function() {
            btn.classList.remove('listening');
            if (window.NexraApp) NexraApp.showToast('Could not hear audio clearly.', 'fa-solid fa-microphone-lines-slash', 'danger');
        };
        
        rec.start();
    }

    /* ======================================================================
       TICKET SUBMISSION & ATTACHMENT ENGINE
       ====================================================================== */
    function handleTicketImage(input) {
        var fnameEl = document.getElementById('sp-file-name');
        if (!input.files || !input.files[0]) {
            fnameEl.innerText = 'No file chosen';
            _state.b64Image = null;
            return;
        }
        var file = input.files[0];
        if (file.size > 2 * 1024 * 1024) {
            if (window.NexraApp) NexraApp.showToast('Image exceeds 2MB limit.', 'fa-solid fa-triangle-exclamation', 'warning');
            input.value = '';
            fnameEl.innerText = 'No file chosen';
            return;
        }

        fnameEl.innerText = file.name;

        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                var MAX = 1000; var w = img.width; var h = img.height;
                if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
                else { if (h > MAX) { w *= MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                _state.b64Image = canvas.toDataURL('image/jpeg', 0.6);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function submitTicket(e) {
        e.preventDefault();
        if (!_state.user || !window.db) return;

        var cat = document.getElementById('sp-t-category').value;
        var prio = document.getElementById('sp-t-priority').value;
        var subj = document.getElementById('sp-t-subject').value.trim();
        var desc = document.getElementById('sp-t-desc').value.trim();
        var btn = document.getElementById('sp-btn-submit');

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';

        var payload = {
            uid: _state.user.uid,
            email: _state.user.email,
            category: cat,
            priority: prio,
            subject: subj,
            description: desc,
            attachmentBase64: _state.b64Image || null,
            status: 'open',
            unreadAdminReply: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        window.db.collection('tickets').add(payload)
            .then(function() {
                if (window.NexraApp) NexraApp.showToast('Ticket submitted securely.', 'fa-solid fa-check', 'success');
                document.getElementById('sp-ticket-form').reset();
                document.getElementById('sp-file-name').innerText = 'No file chosen';
                _state.b64Image = null;
            }).catch(function(err) {
                if (window.NexraApp) NexraApp.showToast('Submission failed.', 'fa-solid fa-xmark', 'danger');
            }).finally(function() {
                btn.disabled = false;
                btn.innerHTML = 'Submit Ticket';
            });
    }

    /* ======================================================================
       LIVE TICKET TRACKING
       ====================================================================== */
    function _initTicketTracking(uid) {
        if (!window.db || !_DOM.ticketGrid) return;

        window.db.collection('tickets')
            .where('uid', '==', uid)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .onSnapshot(function(snap) {
                if (snap.empty) {
                    _DOM.ticketGrid.innerHTML = '<p style="color:var(--text-300); font-size:13px; text-align:center; padding:10px;">No active tickets.</p>';
                    return;
                }
                var html = '';
                snap.forEach(function(doc) {
                    var d = doc.data();
                    var dateStr = d.createdAt ? d.createdAt.toDate().toLocaleDateString() : 'Just now';
                    
                    var badgeCls = 'open';
                    var badgeTxt = 'Open';
                    if (d.status === 'pending') { badgeCls = 'pending'; badgeTxt = 'In Progress'; }
                    if (d.status === 'resolved') { badgeCls = 'resolved'; badgeTxt = 'Resolved'; }

                    var unreadMark = d.unreadAdminReply ? '<i class="fa-solid fa-circle" style="color:var(--danger); font-size:8px; margin-left:6px;" title="New Reply"></i>' : '';

                    html += `
                    <div class="sp-t-card">
                        <div class="sp-t-header">
                            <div>
                                <div class="sp-t-subj">${d.subject} ${unreadMark}</div>
                                <div class="sp-t-date">Ticket #${doc.id.substring(0,6).toUpperCase()} • ${dateStr}</div>
                            </div>
                            <span class="sp-badge ${badgeCls}">${badgeTxt}</span>
                        </div>
                    </div>`;
                });
                _DOM.ticketGrid.innerHTML = html;
            });
    }

    /* ======================================================================
       UTILITIES & SEO
       ====================================================================== */
    function openLiveChat() {
        // Fallback to WhatsApp routing if dedicated widget not active
        var msg = "Hello! I need live support from the Nexra Team.";
        if (_state.user) msg += " (UID: " + _state.user.uid + ")";
        var url = "https://wa.me/?text=" + encodeURIComponent(msg);
        window.open(url, '_blank');
    }

    function _injectFAQSchema(faqsArr) {
        var schema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": []
        };

        faqsArr.slice(0, 10).forEach(function(f) {
            schema.mainEntity.push({
                "@type": "Question",
                "name": f.question,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f.answer.replace(/<[^>]*>?/gm, '') // Strip HTML
                }
            });
        });

        var scriptEl = document.getElementById('sp-json-ld');
        if (scriptEl) scriptEl.innerText = JSON.stringify(schema);
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */
    return {
        init: init,
        toggleFaq: toggleFaq,
        filterFaqs: filterFaqs,
        scrollCats: scrollCats,
        selectSearch: selectSearch,
        startVoiceSearch: startVoiceSearch,
        handleTicketImage: handleTicketImage,
        submitTicket: submitTicket,
        openLiveChat: openLiveChat
    };

})();
