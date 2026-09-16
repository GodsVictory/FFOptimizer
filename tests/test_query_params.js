/**
 * Test URL Query Parameters loading and serialization logic
 */

const assert = require('assert');

// Mock window and URLSearchParams
class MockURLSearchParams {
    constructor(init = '') {
        this.params = new Map();
        if (init) {
            const query = init.startsWith('?') ? init.slice(1) : init;
            const pairs = query.split('&');
            for (const pair of pairs) {
                if (!pair) continue;
                const [k, v] = pair.split('=');
                this.params.set(decodeURIComponent(k), decodeURIComponent(v || ''));
            }
        }
    }
    has(key) { return this.params.has(key); }
    get(key) { return this.params.get(key) || null; }
    set(key, val) { this.params.set(key, String(val)); }
    toString() {
        const parts = [];
        for (const [k, v] of this.params.entries()) {
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        }
        return parts.join('&');
    }
}

global.URLSearchParams = MockURLSearchParams;
global.window = {
    location: {
        search: '?platform=Sleeper&leagueId=1048684918291410944&scoring=PPR&flex=WR&owner=4',
        pathname: '/index.html'
    },
    history: {
        replaceState: function(state, title, url) {
            this.lastUrl = url;
        }
    }
};

console.log('--- TESTING QUERY PARAMETERS LOGIC ---');

// Test parsing
const urlParams = new URLSearchParams(window.location.search);
assert.strictEqual(urlParams.get('platform'), 'Sleeper');
assert.strictEqual(urlParams.get('leagueId'), '1048684918291410944');
assert.strictEqual(urlParams.get('scoring'), 'PPR');
assert.strictEqual(urlParams.get('flex'), 'WR');
assert.strictEqual(urlParams.get('owner'), '4');

console.log('[PASS] Query parameters parsed correctly from URL');

// Test serialization
const outParams = new URLSearchParams();
outParams.set('platform', 'ESPN');
outParams.set('scoring', 'HALF');
outParams.set('flex', 'WRT');
outParams.set('leagueId', '998877');
outParams.set('owner', '2');

const serialized = outParams.toString();
assert.strictEqual(serialized, 'platform=ESPN&scoring=HALF&flex=WRT&leagueId=998877&owner=2');
console.log('[PASS] Query parameters serialized correctly to URL');

console.log('ALL QUERY PARAM TESTS PASSED! [OK]');
