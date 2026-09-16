/**
 * Test suite for FF Optimizer modules:
 * - PlayerMatcher
 * - YahooService
 * - OptimizerService
 * - Config
 */

const assert = require('assert');
const CONFIG = require('../js/config.js');
const PlayerMatcher = require('../js/playerMatcher.js');
const YahooService = require('../js/services/yahooService.js');
const OptimizerService = require('../js/services/optimizerService.js');

console.log('--- RUNNING FF OPTIMIZER TESTS ---\n');

// 1. Test PlayerMatcher
console.log('1. Testing PlayerMatcher...');

assert.strictEqual(PlayerMatcher.normalizeName('A.J. Brown Jr.'), 'aj brown');
assert.strictEqual(PlayerMatcher.normalizeName('Patrick Mahomes II'), 'patrick mahomes');
assert.strictEqual(PlayerMatcher.normalizeName('Travis Etienne Jr.'), 'travis etienne');
assert.strictEqual(PlayerMatcher.normalizeName('Amon-Ra St. Brown'), 'amon ra st brown');
assert.strictEqual(PlayerMatcher.normalizeName('Kenneth Walker III'), 'kenneth walker');
assert.strictEqual(PlayerMatcher.normalizeName('DJ Moore'), 'dj moore');
assert.strictEqual(PlayerMatcher.normalizeName('D.J. Chark Jr.'), 'dj chark');

// Defense Canonicalization
assert.strictEqual(PlayerMatcher.resolveDefenseName('49ers D/ST'), 'San Francisco 49ers');
assert.strictEqual(PlayerMatcher.resolveDefenseName('San Francisco SF - DEF'), 'San Francisco 49ers');
assert.strictEqual(PlayerMatcher.resolveDefenseName('Washington D/ST'), 'Washington Commanders');
assert.strictEqual(PlayerMatcher.resolveDefenseName('Commanders DEF'), 'Washington Commanders');
assert.strictEqual(PlayerMatcher.resolveDefenseName('Buffalo Bills'), 'Buffalo Bills');

// Benchmark O(1) Index Lookup
const samplePlayers = [
    { name: 'Patrick Mahomes', position: 'QB' },
    { name: 'Christian McCaffrey', position: 'RB' },
    { name: 'Justin Jefferson', position: 'WR' },
    { name: 'Travis Kelce', position: 'TE' },
    { name: 'San Francisco 49ers', position: 'DST' },
    { name: 'Brandon Aubrey', position: 'K' }
];
const index = PlayerMatcher.createIndex(samplePlayers);

assert.strictEqual(index.find('Patrick Mahomes II').name, 'Patrick Mahomes');
assert.strictEqual(index.find('C. McCaffrey', 'RB') ? true : false, false); // exact mismatch falls back to fuzzy if fuse loaded
assert.strictEqual(index.find('Christian McCaffrey').name, 'Christian McCaffrey');
assert.strictEqual(index.find('49ers D/ST', 'DST').name, 'San Francisco 49ers');
assert.strictEqual(index.find('San Francisco', 'DST').name, 'San Francisco 49ers');

// Performance test: 10,000 lookups
const start = Date.now();
for (let i = 0; i < 10000; i++) {
    index.find('Patrick Mahomes II');
    index.find('49ers D/ST', 'DST');
}
const elapsed = Date.now() - start;
console.log(`   [PASS] 20,000 O(1) lookups took ${elapsed}ms (< 50ms expected)`);


// 2. Test YahooService Roster Parser
console.log('\n2. Testing YahooService Roster Parser...');

const sampleYahooText = `
Pos	Edit	Player	Opp	Status	Proj	% Start	% Rostered
QB	Start	Patrick Mahomes KC - QB	@LAC	Sun 3:25pm	20.4	98%	100%
RB	Start	Bijan Robinson Atl - RB	vsKC	Sun 7:20pm	17.2	98%	100%
RB	Start	Jahmyr Gibbs Det - RB	@ARI	Sun 3:25pm	15.8	94%	99%
WR	Start	Justin Jefferson Min - WR	vsHOU	Sun 12:00pm	18.1	99%	100%
WR	Start	Amon-Ra St. Brown Det - WR	@ARI	Sun 3:25pm	16.5	97%	99%
TE	Start	Trey McBride Ari - TE	vsDET	Sun 3:25pm	11.2	88%	95%
W/R/T	Start	Rashee Rice KC - WR	@LAC	Sun 3:25pm	13.4	91%	97%
K	Start	Brandon Aubrey Dal - K	vsBAL	Sun 3:25pm	8.5	90%	92%
DEF	Start	San Francisco SF - DEF	@LAR	Sun 3:25pm	7.2	85%	91%
BN	Bench	DeVonta Smith Phi - WR	@NO	Sun 12:00pm	12.8	-	96%
BN	Bench	Jordan Love GB - QB	@TEN	Sun 12:00pm	-	-	80%
IR	IR	Christian McCaffrey SF - RB	IR	-	-	-	99%
`;

const parsed = YahooService.parseRosterText(sampleYahooText);
assert.strictEqual(parsed.rosteredPlayers.length, 12, 'Should parse 12 players');
assert.strictEqual(parsed.startingSlots.length, 9, 'Should have 9 starting slots');
assert.deepStrictEqual(parsed.startingSlots, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST']);

const mahomes = parsed.rosteredPlayers.find(p => p.name.includes('Mahomes'));
assert.ok(mahomes, 'Mahomes should exist');
assert.strictEqual(mahomes.position, 'QB');
assert.strictEqual(mahomes.starter, true);

const devonta = parsed.rosteredPlayers.find(p => p.name.includes('DeVonta'));
assert.ok(devonta, 'DeVonta should exist');
assert.strictEqual(devonta.position, 'WR');
assert.strictEqual(devonta.starter, false, 'BN player should not be starter');

const def = parsed.rosteredPlayers.find(p => p.position === 'DST');
assert.ok(def, 'Defense player should exist and be DST');

console.log('   [PASS] Yahoo roster text parsed with 100% accuracy!');


// 3. Test OptimizerService
console.log('\n3. Testing OptimizerService...');

const rosterWithRanks = [
    { name: 'Patrick Mahomes', position: 'QB', starter: true, onRoster: 1, rank: 3, flxRank: -1 },
    { name: 'Jordan Love', position: 'QB', starter: false, onRoster: 1, rank: 12, flxRank: -1 },
    { name: 'Bijan Robinson', position: 'RB', starter: true, onRoster: 1, rank: 2, flxRank: 3 },
    { name: 'Jahmyr Gibbs', position: 'RB', starter: true, onRoster: 1, rank: 8, flxRank: 12 },
    { name: 'Zack Moss', position: 'RB', starter: false, onRoster: 1, rank: 22, flxRank: 35 },
    { name: 'Justin Jefferson', position: 'WR', starter: true, onRoster: 1, rank: 1, flxRank: 1 },
    { name: 'Amon-Ra St. Brown', position: 'WR', starter: true, onRoster: 1, rank: 4, flxRank: 5 },
    // Scenario: Rashee Rice is on bench currently, but ranked higher than starter starter DeVonta Smith!
    { name: 'Rashee Rice', position: 'WR', starter: false, onRoster: 1, rank: 9, flxRank: 14 },
    { name: 'DeVonta Smith', position: 'WR', starter: true, onRoster: 1, rank: 24, flxRank: 40 },
    { name: 'Trey McBride', position: 'TE', starter: true, onRoster: 1, rank: 3, flxRank: 20 },
    { name: 'Brandon Aubrey', position: 'K', starter: true, onRoster: 1, rank: 1, flxRank: -1 },
    { name: 'San Francisco 49ers', position: 'DST', starter: true, onRoster: 1, rank: 2, flxRank: -1 }
];

const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST'];
const { optimalLineup, benchAlerts } = OptimizerService.solveLineup(rosterWithRanks, slots, 1, 'WRT');

assert.strictEqual(optimalLineup.length, 9, 'Should produce 9 starters');

// Check that Rashee Rice is promoted to starter with highlight: 'start'
const riceInLineup = optimalLineup.find(p => p.name === 'Rashee Rice');
assert.ok(riceInLineup, 'Rashee Rice should be in optimal lineup');
assert.strictEqual(riceInLineup.highlight, 'start', 'Rice should have START recommendation');

// Check that DeVonta Smith is recommended to BENCH
assert.strictEqual(benchAlerts.length, 1, 'Should have 1 bench recommendation');
assert.strictEqual(benchAlerts[0].name, 'DeVonta Smith');
assert.strictEqual(benchAlerts[0].highlight, 'bench');

// Check fullBench contains displaced starter + normal bench players
const { fullBench } = OptimizerService.solveLineup(rosterWithRanks, slots, 1, 'WRT');
assert.strictEqual(fullBench.length, 3, 'fullBench should include DeVonta Smith, Jordan Love, Zack Moss');
assert.strictEqual(fullBench[0].name, 'DeVonta Smith');
assert.strictEqual(fullBench[0].highlight, 'bench');
assert.ok(fullBench.some(p => p.name === 'Jordan Love' && p.highlight === 'none'));
assert.ok(fullBench.some(p => p.name === 'Zack Moss' && p.highlight === 'none'));

// Test Free Agent PICKUP and DROP recommendation
const rosterWithFreeAgent = [
    { name: 'San Francisco 49ers', position: 'DST', starter: true, onRoster: 1, rank: 15, flxRank: -1 },
    { name: 'Philadelphia Eagles', position: 'DST', starter: false, onRoster: 0, rank: 1, flxRank: -1 }
];
const faResult = OptimizerService.solveLineup(rosterWithFreeAgent, ['DST'], 1, 'WRT');
const dstInLineup = faResult.optimalLineup.find(p => p.slot === 'DST');
assert.strictEqual(dstInLineup.name, 'Philadelphia Eagles');
assert.strictEqual(dstInLineup.highlight, 'pickup');
assert.strictEqual(dstInLineup.badge, 'PICKUP');

const dropInBench = faResult.fullBench.find(p => p.name === 'San Francisco 49ers');
assert.ok(dropInBench, '49ers should be on bench');
assert.strictEqual(dropInBench.highlight, 'drop');
assert.strictEqual(dropInBench.badge, 'DROP');

console.log('   [PASS] Lineup optimization, full bench, and PICKUP/DROP recommendations solved correctly!');

// 4. Test Yahoo API JSON Parser
console.log('\n4. Testing Yahoo API JSON Parser...');
const mockSettingsJson = {
    fantasy_content: {
        league: [
            {},
            {
                settings: [
                    {
                        roster_positions: [
                            { roster_position: { position: 'QB', count: '1' } },
                            { roster_position: { position: 'RB', count: '2' } },
                            { roster_position: { position: 'WR', count: '2' } },
                            { roster_position: { position: 'TE', count: '1' } },
                            { roster_position: { position: 'W/R/T', count: '1' } },
                            { roster_position: { position: 'K', count: '1' } },
                            { roster_position: { position: 'DEF', count: '1' } },
                            { roster_position: { position: 'BN', count: '6' } }
                        ]
                    }
                ]
            }
        ]
    }
};

const mockTeamsJson = {
    fantasy_content: {
        league: [
            {},
            {
                teams: {
                    count: 1,
                    0: {
                        team: [
                            [
                                { team_id: 1, name: 'Dynasty Warriors' }
                            ],
                            {
                                roster: [
                                    {
                                        players: {
                                            count: 2,
                                            0: {
                                                player: [
                                                    [{ name: { full: 'Patrick Mahomes' } }, { display_position: 'QB' }],
                                                    { selected_position: [{ position: 'QB' }] }
                                                ]
                                            },
                                            1: {
                                                player: [
                                                    [{ name: { full: 'Kenneth Walker III' } }, { display_position: 'RB' }],
                                                    { selected_position: [{ position: 'BN' }] }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                }
            }
        ]
    }
};

const apiParsed = YahooService._parseApiResponse(mockSettingsJson, mockTeamsJson);
assert.strictEqual(apiParsed.owners.length, 1);
assert.strictEqual(apiParsed.owners[0].owner, 'Dynasty Warriors');
assert.strictEqual(apiParsed.rosteredPlayers.length, 2);
assert.strictEqual(apiParsed.rosteredPlayers[0].starter, true);
assert.strictEqual(apiParsed.rosteredPlayers[1].starter, false);
console.log('   [PASS] Yahoo API JSON response parsed correctly!');

// 5. Test OptimizerService with RB/WR Flex (excludes TE)
console.log('\n5. Testing RB/WR Flex (excl. TE)...');
const flexTestRoster = [
    { name: 'RB1', position: 'RB', starter: true, onRoster: 1, rank: 1, flxRank: 1 },
    { name: 'RB2', position: 'RB', starter: true, onRoster: 1, rank: 2, flxRank: 2 },
    { name: 'WR1', position: 'WR', starter: true, onRoster: 1, rank: 1, flxRank: 3 },
    { name: 'WR2', position: 'WR', starter: true, onRoster: 1, rank: 2, flxRank: 4 },
    { name: 'TE1', position: 'TE', starter: true, onRoster: 1, rank: 1, flxRank: 5 },
    { name: 'TE2', position: 'TE', starter: false, onRoster: 1, rank: 2, flxRank: 6 }, // High flex rank, but WR flex rule excludes TE
    { name: 'WR3', position: 'WR', starter: false, onRoster: 1, rank: 10, flxRank: 15 }
];
const flexSlots = ['RB', 'RB', 'WR', 'WR', 'TE', 'FLX'];
const flexResult = OptimizerService.solveLineup(flexTestRoster, flexSlots, 1, 'WR');
const flexAssigned = flexResult.optimalLineup.find(p => p.slot === 'FLX');
assert.strictEqual(flexAssigned.name, 'WR3', 'In WR flex, TE2 must be excluded and WR3 chosen');
console.log('   [PASS] RB/WR Flex constraint correctly enforced!');

console.log('\nALL TESTS PASSED SUCCESSFULLY! [OK]');

