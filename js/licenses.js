/* js/licenses.js */
window.NexraLicenses = {
    db: null,
    auth: null,
    currentUser: null,
    unsubscribe: null,

    init() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        
        this.auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.unlockPortal();
            } else {
                window.location.href = '/user/auth-gate.html?redirect=/user/licenses-manage.html';
            }
        });
    },

    unlockPortal() {
        const guard = document.getElementById('lic-guard');
        guard.style.opacity = '0';
        setTimeout(() => guard.style.display = 'none', 500);
        
        document.getElementById('lic-main').style.display = 'flex';
        this.listenLicenses();
    },

    listenLicenses() {
        const grid = document.getElementById('lic-grid');
        
        this.unsubscribe = this.db.collection('users')
            .doc(this.currentUser.uid)
            .collection('active_licenses')
            .orderBy('activatedAt', 'desc')
            .onSnapshot(snapshot => {
                if(snapshot.empty) {
                    grid.innerHTML = `
                        <div class="lic-empty">
                            <i class="fa-solid fa-key"></i>
                            <h3 style="color:#fff;">No Active Licenses</h3>
                            <p style="color:#94a3b8; font-size:14px;">You don't currently have any active software keys tied to this account.</p>
                            <button onclick="window.location.href='/shop/shop.html'" style="margin-top:20px; background:#3b82f6; color:#fff; border:none; padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:700;">Browse Software</button>
                        </div>
                    `;
                    return;
                }

                let html = '';
                snapshot.forEach(doc => {
                    const l = doc.data();
                    
                    // Format dates safely
                    const actDate = l.activatedAt ? new Date(l.activatedAt.seconds * 1000).toLocaleDateString() : 'Unknown';
                    const expDate = l.expiresAt ? new Date(l.expiresAt.seconds * 1000).toLocaleDateString() : 'Lifetime';
                    
                    // Status logic
                    const isExpired = l.expiresAt && (l.expiresAt.seconds * 1000) < Date.now();
                    const statusClass = isExpired ? 'status-expired' : 'status-active';
                    const statusText = isExpired ? 'Expired' : 'Active';

                    // Devices list
                    let devicesHtml = '';
                    const devices = l.authorizedDevices || [];
                    
                    if(devices.length === 0) {
                        devicesHtml = '<div style="color:#64748b; font-size:13px; padding:10px 0;">No devices currently authorized.</div>';
                    } else {
                        devices.forEach(dev => {
                            let icon = 'fa-desktop';
                            if(dev.os === 'Mac') icon = 'fa-apple';
                            if(dev.os === 'Windows') icon = 'fa-windows';
                            
                            devicesHtml += `
                                <div class="dev-item">
                                    <div class="dev-info">
                                        <i class="fa-brands ${icon} dev-icon"></i>
                                        <div class="dev-meta">
                                            <span class="dev-name">${dev.name || 'Unknown Device'}</span>
                                            <span class="dev-ip">IP: ${dev.ip || 'Hidden'} | Last Sync: ${dev.lastSync || 'Never'}</span>
                                        </div>
                                    </div>
                                    <button class="btn-revoke" onclick="NexraLicenses.revokeDevice('${doc.id}', '${dev.deviceId}')">
                                        <i class="fa-solid fa-link-slash"></i> Revoke
                                    </button>
                                </div>
                            `;
                        });
                    }

                    html += `
                        <div class="lic-card">
                            <div class="lc-top">
                                <div class="lc-title-wrap">
                                    <div class="lc-title">${l.softwareName || 'Unknown Software'}</div>
                                    <div class="lc-key fira-font"><i class="fa-solid fa-key" style="margin-right:6px;"></i> ${l.licenseKey || 'XXXX-XXXX-XXXX'}</div>
                                </div>
                                <div class="lc-status ${statusClass}">${statusText}</div>
                            </div>
                            
                            <div class="lc-dates">
                                <div class="lc-date-box">
                                    <span class="lc-date-lbl">Activated On</span>
                                    <span class="lc-date-val">${actDate}</span>
                                </div>
                                <div class="lc-date-box">
                                    <span class="lc-date-lbl">Expires On</span>
                                    <span class="lc-date-val">${expDate}</span>
                                </div>
                                <div class="lc-date-box">
                                    <span class="lc-date-lbl">Device Limit</span>
                                    <span class="lc-date-val">${devices.length} / ${l.maxDevices || 1}</span>
                                </div>
                            </div>

                            <div class="lc-devices">
                                <div class="lc-dev-header">
                                    <i class="fa-solid fa-network-wired"></i> Authorized Devices
                                </div>
                                <div class="dev-list">
                                    ${devicesHtml}
                                </div>
                            </div>
                        </div>
                    `;
                });
                grid.innerHTML = html;
            }, error => {
                console.error("License fetch error", error);
                grid.innerHTML = '<div style="color:#ef4444; padding:20px;">Failed to load licenses. Security block active.</div>';
            });
    },

    async revokeDevice(licenseId, deviceId) {
        if(!confirm('Are you sure you want to revoke this device? The software will deactivate immediately on that machine.')) return;

        try {
            const docRef = this.db.collection('users').doc(this.currentUser.uid).collection('active_licenses').doc(licenseId);
            
            // In a real scenario, you'd likely fetch the array, filter out the specific device ID, and update.
            // Using arrayRemove requires the exact object match.
            // For this UI mockup, we will fetch, filter, and write back.
            
            await this.db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);
                if (!doc.exists) throw "Document does not exist!";
                
                const data = doc.data();
                const updatedDevices = (data.authorizedDevices || []).filter(d => d.deviceId !== deviceId);
                
                transaction.update(docRef, { authorizedDevices: updatedDevices });
            });

            NexraApp.showToast('Device connection revoked successfully.', 'success');
        } catch(e) {
            console.error(e);
            NexraApp.showToast('Failed to revoke device.', 'error');
        }
    }
};
