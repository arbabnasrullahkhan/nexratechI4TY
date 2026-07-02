/* js/chat.js */
window.NexraChat = {
    db: null,
    auth: null,
    uid: null,
    ticketId: null,
    isHumanMode: false,
    imageBase64: null,

    async init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        const params = new URLSearchParams(window.location.search);
        this.ticketId = params.get('ticketId');

        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.uid = user.uid;
                if (!this.ticketId) {
                    // Create a dummy ticket session for demo purposes if none provided
                    this.ticketId = `SESSION_${this.uid.substring(0,6)}_${Date.now()}`;
                    this.setupTicket();
                } else {
                    this.loadChat();
                }
            } else {
                window.location.href = `/user/auth-gate.html?redirect=/support/chat-live.html${this.ticketId ? '?ticketId='+this.ticketId : ''}`;
            }
        });
    },

    async setupTicket() {
        // Initializes a new ticket document
        const tRef = this.db.collection('tickets').doc(this.ticketId);
        const doc = await tRef.get();
        if(!doc.exists) {
            await tRef.set({
                uid: this.uid,
                status: 'open_ai',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        this.loadChat();
    },

    async loadChat() {
        const guard = document.getElementById('chat-guard');
        if(guard) {
            guard.style.opacity = '0';
            setTimeout(() => guard.style.display = 'none', 400);
        }
        document.getElementById('chat-main').removeAttribute('hidden');

        // Fetch Order Context if any
        try {
            const tDoc = await this.db.collection('tickets').doc(this.ticketId).get();
            if(tDoc.exists) {
                const d = tDoc.data();
                if(d.orderId) {
                    document.getElementById('order-context').style.display = 'flex';
                    document.getElementById('oc-title').innerText = `Order #${d.orderId}`;
                    if(d.orderPrice) document.getElementById('oc-price').innerText = `Rs. ${d.orderPrice}`;
                }
                
                if(d.status === 'human_assigned') {
                    this.isHumanMode = true;
                    document.getElementById('ticket-status').innerHTML = `<span class="status-dot"></span> Agent Assigned`;
                    document.getElementById('btn-human-req').style.display = 'none';
                } else if (d.status === 'human_requested') {
                    document.getElementById('ticket-status').innerHTML = `<span class="status-dot" style="background:#f59e0b; box-shadow:0 0 8px #f59e0b;"></span> Waiting for Agent...`;
                    document.getElementById('btn-human-req').disabled = true;
                    document.getElementById('btn-human-req').innerText = 'Request Sent';
                } else {
                    document.getElementById('ticket-status').innerHTML = `<span class="status-dot"></span> AI Assistant Active`;
                }
            }
        } catch(e) {
            console.error(e);
        }

        // Listen for messages
        this.db.collection(`tickets/${this.ticketId}/messages`)
            .orderBy('timestamp', 'asc')
            .onSnapshot(snap => {
                const msgsContainer = document.getElementById('chat-messages');
                // Preserve the initial AI greeting
                const greetingHTML = `
                    <div class="chat-bubble left ai-greeting">
                        <div class="cb-avatar"><i class="fa-solid fa-robot"></i></div>
                        <div class="cb-content">
                            <div class="cb-sender">Nexra AI Assistant <i class="fa-solid fa-circle-check" style="color:#10b981; font-size:10px;"></i></div>
                            <div class="cb-text">Hello! I am your AI assistant. How can I help you today?</div>
                            <div class="cb-time">Just now</div>
                        </div>
                    </div>
                `;
                
                let html = greetingHTML;

                snap.forEach(doc => {
                    const d = doc.data();
                    const isMe = d.senderId === this.uid;
                    const align = isMe ? 'right' : 'left';
                    const icon = d.isHumanAgent ? 'fa-headset' : 'fa-robot';
                    const senderName = d.isHumanAgent ? 'Support Agent' : (isMe ? 'You' : 'Nexra AI');
                    const badge = d.isHumanAgent ? `<i class="fa-solid fa-circle-check" style="color:#10b981; font-size:10px;"></i>` : '';
                    
                    const timeStr = d.timestamp ? new Date(d.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Sending...';

                    let msgContent = d.text;
                    if(d.image) {
                        msgContent += `<br><img src="${d.image}" alt="Attachment">`;
                    }

                    if(d.isSystem) {
                        html += `<div class="chat-system-msg">${d.text}</div>`;
                    } else {
                        html += `
                            <div class="chat-bubble ${align}">
                                <div class="cb-avatar"><i class="fa-solid ${icon}"></i></div>
                                <div class="cb-content">
                                    <div class="cb-sender">${senderName} ${badge}</div>
                                    <div class="cb-text">${msgContent}</div>
                                    <div class="cb-time">${timeStr}</div>
                                </div>
                            </div>
                        `;
                    }
                });

                msgsContainer.innerHTML = html;
                this.scrollToBottom();
            });
    },

    scrollToBottom() {
        const msgs = document.getElementById('chat-messages');
        msgs.scrollTop = msgs.scrollHeight;
    },

    autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
    },

    handleEnter(e) {
        if(e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    },

    processImage(e) {
        const file = e.target.files[0];
        if(!file) return;
        if(file.size > 5 * 1024 * 1024) return NexraApp.showToast('Image must be under 5MB', 'error');

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const cvs = document.getElementById('chat-canvas');
                const ctx = cvs.getContext('2d');
                
                // Compress image to max 800px width
                let w = img.width;
                let h = img.height;
                if(w > 800) {
                    h = Math.floor((800/w) * h);
                    w = 800;
                }
                cvs.width = w;
                cvs.height = h;
                
                ctx.drawImage(img, 0, 0, w, h);
                this.imageBase64 = cvs.toDataURL('image/jpeg', 0.6); // 60% quality JPEG
                
                document.getElementById('ap-img').src = this.imageBase64;
                document.getElementById('attach-preview').style.display = 'block';
                this.scrollToBottom();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    },

    removeAttachment() {
        this.imageBase64 = null;
        document.getElementById('chat-file-input').value = '';
        document.getElementById('attach-preview').style.display = 'none';
    },

    async sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        const img = this.imageBase64;

        if(!text && !img) return;

        // Reset Input UI
        input.value = '';
        input.style.height = 'auto';
        this.removeAttachment();

        const msgPayload = {
            senderId: this.uid,
            text: text,
            image: img || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await this.db.collection(`tickets/${this.ticketId}/messages`).add(msgPayload);
            
            // If in AI Mode, trigger mock AI response
            if(!this.isHumanMode) {
                this.triggerMockAIResponse(text);
            }
        } catch(e) {
            NexraApp.showToast('Failed to send', 'error');
        }
    },

    async triggerMockAIResponse(userText) {
        // Show typing indicator
        document.getElementById('typing-indicator').style.display = 'flex';
        document.getElementById('typer-icon').className = 'fa-solid fa-robot';
        this.scrollToBottom();

        // Simulate network delay
        setTimeout(async () => {
            document.getElementById('typing-indicator').style.display = 'none';
            
            // In a real production app, a Firebase Cloud Function would capture the user's message, 
            // securely ping OpenRouter (Gemini/Cohere), and write the AI's response back to this collection.
            
            let responseText = "I understand. Since this requires specific account details, would you like me to transfer you to a human agent?";
            
            if(userText.toLowerCase().includes('status')) responseText = "Your order is currently processing and will be delivered shortly.";
            if(userText.toLowerCase().includes('refund')) responseText = "Our refund policy requires review by an agent. Shall I transfer you?";

            await this.db.collection(`tickets/${this.ticketId}/messages`).add({
                senderId: 'SYSTEM_AI',
                isHumanAgent: false,
                text: responseText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }, 1500);
    },

    async requestHuman() {
        try {
            const tRef = this.db.collection('tickets').doc(this.ticketId);
            await tRef.update({ status: 'human_requested' });
            
            await this.db.collection(`tickets/${this.ticketId}/messages`).add({
                senderId: 'SYSTEM',
                isSystem: true,
                text: 'Transferring to a human agent...',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            document.getElementById('btn-human-req').disabled = true;
            document.getElementById('btn-human-req').innerText = 'Request Sent';
            document.getElementById('ticket-status').innerHTML = `<span class="status-dot" style="background:#f59e0b; box-shadow:0 0 8px #f59e0b;"></span> Waiting for Agent...`;
        } catch(e) {
            NexraApp.showToast('Failed to request agent', 'error');
        }
    }
};
