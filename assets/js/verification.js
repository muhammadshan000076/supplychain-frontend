// verification.js - Product verification and QR scanning

const Verification = (() => {
    // Scan QR code result
    async function verifyProduct(productId, supabaseClient) {
        try {
            // Sanitize input: trim, remove surrounding quotes and invisible chars
            const sanitize = (s) => {
                if (!s || typeof s !== 'string') return '';
                // remove zero-width and BOM chars
                s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
                s = s.trim();
                // strip surrounding quotes or <> or parentheses
                s = s.replace(/^['"\(\[<]+|['"\)\]>]+$/g, '');
                return s;
            };
            productId = sanitize(productId);

            // Helper to detect UUID format
            const isUUID = (id) => {
                return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            };

            // Fetch product. Accept either a UUID or a user-friendly string (name, batch number, or id prefix).
            let product = null;

            if (isUUID(productId)) {
                const { data, error: prodErr } = await supabaseClient.from('products').select('*').eq('id', productId).single();
                if (prodErr && prodErr.code !== 'PGRST116') throw prodErr;
                product = data || null;
            } else {
                // Try exact batch number
                try {
                    const { data: byBatch } = await supabaseClient.from('products').select('*').eq('batch_number', productId).limit(1);
                    if (byBatch && byBatch.length > 0) product = byBatch[0];
                } catch (e) { /* ignore */ }

                // Try name fuzzy match
                if (!product) {
                    try {
                        const { data: byName } = await supabaseClient.from('products').select('*').ilike('name', `%${productId}%`).limit(1);
                        if (byName && byName.length > 0) product = byName[0];
                    } catch (e) { /* ignore */ }
                }

                // Try id prefix match
                if (!product) {
                    try {
                        const { data: byId } = await supabaseClient.from('products').select('*').like('id', `${productId}%`).limit(1);
                        if (byId && byId.length > 0) product = byId[0];
                    } catch (e) { /* ignore */ }
                }

                // If still not found, product remains null
            }

            if (!product) {
                // Fallback: maybe product row missing but blockchain blocks exist for this ID (or prefix)
                try {
                    // try exact match in blocks
                    const { data: blkExact } = await supabaseClient.from('blockchain_blocks').select('product_id').eq('product_id', productId).limit(1);
                    let resolvedId = null;
                    if (blkExact && blkExact.length > 0) {
                        resolvedId = blkExact[0].product_id;
                    } else {
                        // try prefix match on product_id in blocks
                        const { data: blkLike } = await supabaseClient.from('blockchain_blocks').select('product_id').like('product_id', `${productId}%`).limit(1);
                        if (blkLike && blkLike.length > 0) resolvedId = blkLike[0].product_id;
                    }

                    if (resolvedId) {
                        const { data: prodFromBlocks, error: pErr2 } = await supabaseClient.from('products').select('*').eq('id', resolvedId).maybeSingle();
                        if (!pErr2 && prodFromBlocks) {
                            product = prodFromBlocks;
                        }
                    }
                } catch (e) {
                    // ignore lookup errors and proceed to return not found
                }
            }

            if (!product) {
                return {
                    valid: false,
                    reason: 'Product not found in registry',
                    product: null,
                    blocks: [],
                    isChainValid: false,
                    authenticity: 0
                };
            }

            // Fetch blockchain blocks (use resolved product ID)
            let blocks = [];
            if (Blockchain) {
                blocks = await Blockchain.getProductHistory(product.id || productId, supabaseClient);
            }

            // Verify chain integrity
            let isChainValid = false;
            if (Blockchain && blocks.length > 0) {
                isChainValid = await Blockchain.verifyChain(blocks);
            }

            // Calculate authenticity
            const authenticity = Blockchain ? Blockchain.calculateAuthenticityScore(blocks) : 0;

            // Build reason text for clarity
            let reason = '';
            if (!blocks || blocks.length === 0) {
                reason = 'Product registered but no blockchain records found';
            } else {
                reason = isChainValid ? 'Blockchain verified' : 'Blockchain verification failed';
            }

            return {
                valid: isChainValid && blocks.length > 0,
                reason,
                product,
                blocks,
                isChainValid,
                authenticity
            };
        } catch (err) {
            console.error('Verification error:', err);
            return {
                valid: false,
                reason: err.message || 'Verification failed',
                product: null,
                blocks: [],
                isChainValid: false,
                authenticity: 0,
                error: err
            };
        }
    }

    // Generate verification URL
    function generateVerificationQR(productId, baseUrl = '') {
        const url = `${baseUrl || window.location.origin}/?verify=${productId}`;
        return {
            url,
            qrContent: url
        };
    }

    // Display verification result
    function renderVerificationResult(container, result, userRole = 'customer') {
        if (!container) return;

        // Determine high-level status banner
        const productExists = !!result.product;
        const chainPresent = Array.isArray(result.blocks) && result.blocks.length > 0;
        const chainValid = !!result.isChainValid && chainPresent;

        const statusColor = chainValid ? '#16a34a' : (productExists ? '#d97706' : '#dc2626');
        const bgColor = chainValid ? '#dcfce7' : (productExists ? '#fff7ed' : '#fee2e2');
        const borderColor = chainValid ? '#16a34a' : (productExists ? '#d97706' : '#dc2626');
        const statusText = chainValid ? 'VERIFIED' : (productExists ? 'REGISTERED (Not on chain)' : 'NOT VERIFIED');
        const statusSymbol = chainValid ? '<i class="fas fa-check-circle"></i>' : (productExists ? '<i class="fas fa-exclamation-triangle"></i>' : '<i class="fas fa-times-circle"></i>');

        let html = `
            <div style="padding:2rem 0;">
                <div style="margin:2rem 0;padding:1.5rem;border-radius:12px;background:${bgColor};border:2px solid ${borderColor};text-align:center;">
                    <div style="font-size:3rem;margin-bottom:1rem;font-weight:bold;">${statusSymbol}</div>
                    <div style="font-size:1.75rem;font-weight:700;color:${statusColor};margin-bottom:0.5rem;">${statusText}</div>
                    <div style="font-size:1rem;color:${statusColor};opacity:0.9;">${result.reason}</div>
                </div>
        `;

        // Always show product information when available, even if chain verification failed
        if (result.product) {
            const currentStatus = Blockchain ? Blockchain.getCurrentStatus(result.blocks) : 'Unknown';
            const currentLocation = Blockchain ? Blockchain.getCurrentLocation(result.blocks) : 'Unknown';
            
            html += `
                <div class="card" style="margin:2rem 0;">
                    <h4>Product Information</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div>
                            <p style="color:var(--text-light);font-size:0.9rem;margin-bottom:0.3rem;">Product Name</p>
                            <p style="font-weight:600;margin:0;">${result.product.name}</p>
                        </div>
                        <div>
                            <p style="color:var(--text-light);font-size:0.9rem;margin-bottom:0.3rem;">Batch Number</p>
                            <p style="font-weight:600;margin:0;">${result.product.batch_number}</p>
                        </div>
                        <div>
                            <p style="color:var(--text-light);font-size:0.9rem;margin-bottom:0.3rem;">Manufacturing Date</p>
                            <p style="font-weight:600;margin:0;">${result.product.manufacturing_date || 'N/A'}</p>
                        </div>
                        <div>
                            <p style="color:var(--text-light);font-size:0.9rem;margin-bottom:0.3rem;">Current Status</p>
                            <p style="font-weight:600;margin:0;">${currentStatus || 'Registered'}</p>
                        </div>
                    </div>
                    ${result.product.description ? `<p style="margin-top:1rem;color:var(--text-dark);"><strong>Description:</strong> ${result.product.description}</p>` : ''}
                </div>

                <div class="card">
                    <h4>Blockchain Chain Verification</h4>
                    <div style="margin:1rem 0;padding:1rem;background:var(--light-bg);border-radius:8px;">
                        <p style="margin:0;">
                            <strong>Chain Status:</strong> 
                            <span style="color:${result.isChainValid ? '#16a34a' : '#dc2626'};font-weight:600;">
                                ${result.isChainValid ? '[VALID]' : '[INVALID]'}
                            </span>
                        </p>
                        <p style="margin:0.5rem 0 0 0;">
                            <strong>Blocks in Chain:</strong> ${result.blocks.length}
                        </p>
                        <p style="margin:0.5rem 0 0 0;">
                            <strong>Authenticity Score:</strong> 
                            <span style="color:${result.authenticity >= 80 ? '#16a34a' : result.authenticity >= 50 ? '#d97706' : '#dc2626'};font-weight:600;">
                                ${result.authenticity}%
                            </span>
                        </p>
                        ${userRole === 'admin' ? `<p style="margin:0.5rem 0 0 0;padding-top:0.5rem;border-top:1px solid var(--border);"><strong>Admin View:</strong> <span style="color:var(--primary);font-size:0.9rem;">Hash strings visible</span></p>` : ''}
                    </div>
                    ${result.blocks.length > 0 ? generateBlockchainTimeline(result.blocks, userRole) : '<p style="color:var(--text-light);">No blockchain records for this product</p>'}
                </div>
            `;
        } 

        // If product not found, show failure explanation
        if (!productExists) {
            html += `
                <div class="card" style="margin:2rem 0;">
                    <h4>Verification Failed</h4>
                    <p style="color:var(--text-light);">${result.reason}</p>
                    <p style="color:var(--text-light);font-size:0.9rem;margin-top:1rem;">This product could not be verified. Please check the Product ID and try again.</p>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    // Generate blockchain timeline
    function generateBlockchainTimeline(blocks, userRole = 'customer') {
        if (!blocks || blocks.length === 0) return '';

        let timeline = '<ul class="timeline" style="margin-top:1rem;">';
        blocks.forEach((block, idx) => {
            const data = block.data;
            const timestamp = new Date(data.timestamp || block.created_at);
            
            // Only show hash to admin users
                const hashDisplay = userRole === 'admin' 
                    ? `<br><code style="font-size:0.75rem;color:#666;word-break:break-all;background:#f5f5f5;padding:0.25rem 0.5rem;border-radius:3px;display:inline-block;margin-top:0.25rem;"><i class="fas fa-lock"></i> Hash: ${block.hash}</code>` 
                : `<code style="font-size:0.75rem;color:#999;word-break:break-all;">Block ${block.block_index}</code>`;
            
            timeline += `
                <li>
                    <div class="timeline-content">
                        <div class="timeline-time">${timestamp.toLocaleString()}</div>
                        <div class="timeline-text">
                            <strong>${Blockchain ? Blockchain.formatStatus(data.status) : data.status}</strong><br>
                            <span style="color:var(--text-light);font-size:0.9rem;"><i class="fas fa-map-marker-alt"></i> ${data.location} | <i class="fas fa-user"></i> ${data.actor}</span><br>
                            ${hashDisplay}
                        </div>
                    </div>
                </li>
            `;
        });
        timeline += '</ul>';
        return timeline;
    }

    // Initialize verification page
    function initVerificationPage(supabaseClient, userRole = 'customer') {
        const params = new URLSearchParams(window.location.search);
        const productId = params.get('verify');

        if (!productId) {
            document.body.innerHTML = `
                <div class="container" style="padding:2rem;">
                    <h2>Verify Product</h2>
                    <p>Use a product QR code to verify authenticity</p>
                </div>
            `;
            return;
        }

        // Show verification result
        const resultContainer = document.getElementById('verification-result') || 
                               document.querySelector('main') || 
                               document.body;

        resultContainer.innerHTML = '<p style="padding:2rem;text-align:center;">Verifying product...</p>';

        verifyProduct(productId, supabaseClient).then(result => {
            renderVerificationResult(resultContainer, result, userRole);
        }).catch(err => {
            resultContainer.innerHTML = `<div class="card" style="margin:2rem;"><h4>Verification Error</h4><p>${err.message}</p></div>`;
        });
    }

    return {
        verifyProduct,
        generateVerificationQR,
        renderVerificationResult,
        generateBlockchainTimeline,
        initVerificationPage
    };
})();

// Export for use
window.Verification = Verification;
