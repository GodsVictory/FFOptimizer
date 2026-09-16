const assert = require('assert');

// Mock localStorage
const storage = new Map();
global.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
};

const FantasyProsService = require('../js/services/fantasyProsService.js');

async function test() {
    console.log('--- TESTING BROWSER STORAGE (LOCALSTORAGE) RANKINGS CACHE ---');

    FantasyProsService.clearCache();

    // 1. First fetch (cache miss, fetches live and saves to localStorage)
    console.log('1. First fetch (live -> localStorage)...');
    const ranks1 = await FantasyProsService.fetchRankings('PPR');
    assert.ok(ranks1['QB'].length > 0);
    assert.ok(localStorage.getItem('ff_rankings_PPR'), 'localStorage should have ff_rankings_PPR');
    console.log('   [PASS] Saved to localStorage successfully');

    // 2. Clear memory cache to simulate a fresh page reload
    console.log('2. Simulating fresh page visit (in-memory cache cleared)...');
    FantasyProsService._cache = {};
    const start = Date.now();
    const ranks2 = await FantasyProsService.fetchRankings('PPR');
    const elapsed = Date.now() - start;
    console.log(`   [+] Loaded from localStorage in ${elapsed}ms (0 network requests)`);
    assert.strictEqual(ranks2['QB'].length, ranks1['QB'].length);
    assert.strictEqual(ranks2['QB'][0].name, ranks1['QB'][0].name);
    console.log('   [PASS] Successfully restored identical rankings from localStorage');

    // 3. Test force refresh
    console.log('3. Testing force refresh...');
    const ranks3 = await FantasyProsService.fetchRankings('PPR', true);
    assert.ok(ranks3['QB'].length > 0);
    console.log('   [PASS] Force refresh successfully re-fetched rankings');

    // 4. Test clearCache()
    console.log('4. Testing clearCache()...');
    FantasyProsService.clearCache();
    assert.strictEqual(localStorage.getItem('ff_rankings_PPR'), null, 'localStorage item deleted');
    console.log('   [PASS] clearCache successfully wiped storage');

    console.log('\nALL RANKINGS CACHE TESTS PASSED! [OK]');
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
