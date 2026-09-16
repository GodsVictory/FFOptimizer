const assert = require('assert');

// Mock localStorage
const storage = new Map();
global.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
};

// Mock window and history
global.window = {
    location: {
        search: '?platform=Sleeper&leagueId=1389343427119828992&owner=8',
        pathname: '/'
    }
};
global.history = {
    replaceState: () => {}
};

const fs = require('fs');
const appContent = fs.readFileSync('js/app.js', 'utf8');

// Evaluate app to extract methods
const appCode = `
const FantasyProsService = { fetchMetadata: async () => ({ week: '1', minutesAgo: '5m' }) };
const SleeperService = {};
const ESPNService = {};
const YahooService = {};
const OptimizerService = {};
let createdApp = null;
function Vue(opts) {
    createdApp = opts;
    return opts;
}
${appContent}
module.exports = createdApp;
`;

const createdApp = eval(appCode);

async function run() {
    console.log('--- RUNNING LEAGUE HISTORY TESTS ---');

    const app = {
        platform: 'Sleeper',
        scoring: 'PPR',
        flex: 'WRT',
        sleeperLeagueId: '1389343427119828992',
        espnLeagueId: '',
        yahooLeagueId: '',
        ownerId: '8',
        leagueName: 'Fantasyland',
        owners: [{ id: '8', owner: 'Reidolph' }, { id: '1', owner: 'Champion' }],
        leagueHistory: [],
        ...createdApp.methods
    };

    // 1. Test saveToHistory
    console.log('1. Testing saveToHistory()...');
    app.saveToHistory();

    assert.strictEqual(app.leagueHistory.length, 1, 'Should have 1 history entry');
    assert.strictEqual(app.leagueHistory[0].platform, 'Sleeper');
    assert.strictEqual(app.leagueHistory[0].leagueId, '1389343427119828992');
    assert.strictEqual(app.leagueHistory[0].leagueName, 'Fantasyland');
    assert.strictEqual(app.leagueHistory[0].owner, '8');
    assert.strictEqual(app.leagueHistory[0].ownerName, 'Reidolph');
    assert.strictEqual(app.leagueHistory[0].scoring, 'PPR');
    assert.strictEqual(app.leagueHistory[0].flex, 'WRT');
    console.log('   [PASS] Saved Sleeper Reidolph entry with leagueName correctly');

    // 2. Test saving another owner from the same league
    console.log('2. Testing owner change in same league...');
    app.ownerId = '1';
    app.saveToHistory();

    assert.strictEqual(app.leagueHistory.length, 2, 'Should have 2 history entries');
    assert.strictEqual(app.leagueHistory[0].owner, '1', 'Most recent owner should be at index 0');
    assert.strictEqual(app.leagueHistory[0].ownerName, 'Champion');
    assert.strictEqual(app.leagueHistory[0].leagueName, 'Fantasyland', 'Preserved leagueName on owner change');
    assert.strictEqual(app.leagueHistory[1].owner, '8');
    console.log('   [PASS] Owner Champion prepended at index 0');

    // 3. Test deduplication when saving an existing entry
    console.log('3. Testing deduplication (switching back to Reidolph)...');
    app.ownerId = '8';
    app.saveToHistory();

    assert.strictEqual(app.leagueHistory.length, 2, 'Should still have 2 entries (no duplicates)');
    assert.strictEqual(app.leagueHistory[0].owner, '8', 'Reidolph moved back to index 0');
    console.log('   [PASS] Reidolph moved to front without duplicate creation');

    // 4. Test isCurrentHistoryItem
    console.log('4. Testing isCurrentHistoryItem()...');
    assert.strictEqual(app.isCurrentHistoryItem(app.leagueHistory[0]), true, 'Index 0 is current item');
    assert.strictEqual(app.isCurrentHistoryItem(app.leagueHistory[1]), false, 'Index 1 is not current item');
    console.log('   [PASS] isCurrentHistoryItem correctly identifies active league');

    // 5. Test localStorage persistence
    console.log('5. Testing localStorage persistence...');
    const rawStored = localStorage.getItem('ff_league_history');
    assert.ok(rawStored, 'localStorage should contain ff_league_history');
    const parsedStored = JSON.parse(rawStored);
    assert.strictEqual(parsedStored.length, 2);

    // Fresh app loading from localStorage
    const freshApp = {
        leagueHistory: [],
        ...createdApp.methods
    };
    freshApp.loadHistory();
    assert.strictEqual(freshApp.leagueHistory.length, 2, 'freshApp loaded 2 entries from storage');
    console.log('   [PASS] localStorage successfully persisted and reloaded');

    // 6. Test removeHistoryItem
    console.log('6. Testing removeHistoryItem()...');
    app.removeHistoryItem(1);
    assert.strictEqual(app.leagueHistory.length, 1, 'Should have 1 entry after removal');
    assert.strictEqual(app.leagueHistory[0].owner, '8');
    console.log('   [PASS] Successfully removed item from history');

    // 7. Test clearHistory
    console.log('7. Testing clearHistory()...');
    app.clearHistory();
    assert.strictEqual(app.leagueHistory.length, 0, 'Should have 0 entries after clear');
    assert.strictEqual(localStorage.getItem('ff_league_history'), null, 'localStorage item deleted');
    console.log('   [PASS] clearHistory completely wiped list and storage');

    console.log('\nALL LEAGUE HISTORY TESTS PASSED SUCCESSFULLY! [OK]');
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
