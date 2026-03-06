(async function(){
    if (!window.supabaseClient) {
        console.error('supabaseClient not found on window. Open this on a page where supabaseClient is initialized.');
        return;
    }
    if (!window.Blockchain || typeof window.Blockchain.calculateHash !== 'function') {
        console.error('Blockchain.calculateHash not available. Ensure assets/js/blockchain.js is loaded.');
        return;
    }

    async function calcHashForBlockRow(b) {
        const timestamp = (b.data && b.data.timestamp) ? b.data.timestamp : b.created_at;
        const blockObj = {
            index: b.block_index,
            data: b.data,
            previousHash: b.previous_hash,
            timestamp: timestamp
        };
        const blockString = JSON.stringify(blockObj);
        const calculated = await window.Blockchain.calculateHash(blockString);
        return calculated;
    }

    async function fetchAllBlocks() {
        // fetch all blocks ordered by product_id, block_index
        const { data, error } = await supabaseClient
            .from('blockchain_blocks')
            .select('*')
            .order('product_id', { ascending: true })
            .order('block_index', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function repairBlocksPreview() {
        console.log('Fetching blocks...');
        const blocks = await fetchAllBlocks();
        console.log(`Fetched ${blocks.length} blocks`);

        const mismatches = [];
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            try {
                const calc = await calcHashForBlockRow(b);
                if (calc !== b.hash) {
                    mismatches.push({ id: b.id, product_id: b.product_id, block_index: b.block_index, stored_hash: b.hash, calculated_hash: calc });
                }
            } catch (e) {
                console.error('Error calculating hash for block', b.id, e);
            }
        }

        if (mismatches.length === 0) {
            console.log('No mismatches found. All block hashes match calculated values.');
        } else {
            console.warn(`Found ${mismatches.length} mismatched blocks.`);
            console.table(mismatches);
            // also print SQL update statements for review
            const updates = mismatches.map(m => `UPDATE blockchain_blocks SET hash = '${m.calculated_hash}' WHERE id = ${m.id};`);
            console.log('\n-- Suggested UPDATE statements (preview) --\n' + updates.join('\n'));
        }
        return { blocksCount: blocks.length, mismatches };
    }

    async function repairBlocksApply() {
        const preview = await repairBlocksPreview();
        if (!preview.mismatches || preview.mismatches.length === 0) {
            console.log('No mismatches to apply.');
            return preview;
        }

        const confirmMsg = `About to update ${preview.mismatches.length} block hashes in the database. This will overwrite the stored 'hash' value for those block rows. Type YES to proceed.`;
        const promptResult = prompt(confirmMsg, 'NO');
        if (promptResult !== 'YES') {
            console.log('Aborted by user. No changes applied.');
            return { applied: 0 };
        }

        let applied = 0;
        for (const m of preview.mismatches) {
            try {
                const { error } = await supabaseClient.from('blockchain_blocks').update({ hash: m.calculated_hash }).eq('id', m.id);
                if (error) {
                    console.error('Failed to update block', m.id, error);
                } else {
                    applied++;
                    console.log('Updated block', m.id);
                }
            } catch (e) {
                console.error('Exception updating block', m.id, e);
            }
        }
        console.log(`Applied updates to ${applied} blocks.`);
        return { applied };
    }

    // expose functions
    window.repairBlocksPreview = repairBlocksPreview;
    window.repairBlocksApply = repairBlocksApply;

    console.log('Repair script loaded. Run `await repairBlocksPreview()` to find mismatches, then `await repairBlocksApply()` to apply updates (you will be prompted).');
})();
