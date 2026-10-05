const assert = require('assert');

// Test suite for Decision Matrix Chart Selection & Mobile Touch Logic
console.log('--- TESTING MATRIX CHART SELECTION & MOBILE TOUCH LOGIC ---');

// Mock Vue App state and methods
const app = {
    matrixPos: 'ALL',
    matrixXMode: 'rank',
    matrixZoom: 'cluster',
    matrixHoverPlayer: null,
    matrixSelectedPlayer: null,
    matrixTooltipPos: { left: '0px', top: '0px' },
    matrixFilters: {
        pickup: true,
        drop: true,
        roster: true,
        wire: true
    },
    matrixViewBox: { x: 0, y: 0, w: 800, h: 500 },
    matrixIsDragging: false,
    matrixHasDragged: false,
    matrixDragStart: { clientX: 0, clientY: 0, vbX: 0, vbY: 0 },
    matrixTouchDistance: null,

    get matrixViewBoxString() {
        const vb = this.matrixViewBox || { x: 0, y: 0, w: 800, h: 500 };
        return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
    },
    get matrixZoomPercent() {
        return Math.round((800 / (this.matrixViewBox?.w || 800)) * 100);
    },
    get isMatrixZoomedOrPanned() {
        const vb = this.matrixViewBox;
        if (!vb) return false;
        return vb.w !== 800 || vb.x !== 0 || vb.y !== 0;
    },

    zoomMatrixAt(px, py, factor) {
        const minW = 800 / 4.5;
        const maxW = 800 * 1.1;
        const newW = Math.max(minW, Math.min(maxW, this.matrixViewBox.w / factor));
        const k = this.matrixViewBox.w / newW;
        const newH = 500 * (newW / 800);

        let newX = px - (px - this.matrixViewBox.x) / k;
        let newY = py - (py - this.matrixViewBox.y) / k;

        newX = Math.max(-120, Math.min(920 - newW, newX));
        newY = Math.max(-80, Math.min(580 - newH, newY));

        this.matrixViewBox = {
            x: Math.round(newX),
            y: Math.round(newY),
            w: Math.round(newW),
            h: Math.round(newH)
        };
    },

    zoomMatrixBy(factor) {
        const cx = this.matrixViewBox.x + this.matrixViewBox.w / 2;
        const cy = this.matrixViewBox.y + this.matrixViewBox.h / 2;
        this.zoomMatrixAt(cx, cy, factor);
    },

    resetMatrixZoom() {
        this.matrixViewBox = { x: 0, y: 0, w: 800, h: 500 };
        this.matrixIsDragging = false;
        this.matrixHasDragged = false;
    },

    onMatrixMouseDown(event) {
        if (event.button !== 0) return;
        this.matrixIsDragging = true;
        this.matrixHasDragged = false;
        this.matrixDragStart = {
            clientX: event.clientX,
            clientY: event.clientY,
            vbX: this.matrixViewBox.x,
            vbY: this.matrixViewBox.y
        };
    },

    onMatrixMouseMove(event, svgRect = { width: 800, height: 500 }) {
        if (!this.matrixIsDragging) return;
        const dx = event.clientX - this.matrixDragStart.clientX;
        const dy = event.clientY - this.matrixDragStart.clientY;
        if (Math.hypot(dx, dy) > 5) {
            this.matrixHasDragged = true;
        }

        const scaleX = this.matrixViewBox.w / (svgRect.width || 800);
        const scaleY = this.matrixViewBox.h / (svgRect.height || 500);

        let newX = this.matrixDragStart.vbX - dx * scaleX;
        let newY = this.matrixDragStart.vbY - dy * scaleY;
        newX = Math.max(-120, Math.min(920 - this.matrixViewBox.w, newX));
        newY = Math.max(-80, Math.min(580 - this.matrixViewBox.h, newY));

        this.matrixViewBox.x = Math.round(newX);
        this.matrixViewBox.y = Math.round(newY);
    },

    onMatrixMouseUp(event) {
        this.matrixIsDragging = false;
    },

    onMatrixPlayerClick(player) {
        if (this.matrixHasDragged) {
            return;
        }
        this.selectMatrixPlayer(player);
    },
    allRankedPlayers: [
        { name: 'Josh Allen', position: 'QB', rank: 1, rosRank: 1 },
        { name: 'Bijan Robinson', position: 'RB', rank: 2, rosRank: 2 },
        { name: 'Drake London', position: 'WR', rank: 7, rosRank: 12 },
        { name: 'Spencer Shrader', position: 'K', rank: 8, rosRank: 20 }
    ],
    matrixChartData: {
        players: [
            { name: 'Josh Allen', pos: 'QB', status: 'roster', cx: 700, cy: 50, radius: 7 },
            { name: 'Bijan Robinson', pos: 'RB', status: 'roster', cx: 650, cy: 60, radius: 7 },
            { name: 'Harrison Butker', pos: 'K', status: 'pickup', targetDrop: 'Spencer Shrader', cx: 600, cy: 120, radius: 8 },
            { name: 'Spencer Shrader', pos: 'K', status: 'drop', targetPickup: 'Harrison Butker', cx: 500, cy: 300, radius: 8 },
            { name: 'Taysom Hill', pos: 'TE', status: 'wire', cx: 300, cy: 350, radius: 5.5 }
        ]
    },

    get currentSelectedPlayerIndex() {
        if (!this.matrixSelectedPlayer || !this.matrixChartData || !this.matrixChartData.players) return -1;
        const norm = this.matrixSelectedPlayer.name.toLowerCase().trim();
        return this.matrixChartData.players.findIndex(p => p.name.toLowerCase().trim() === norm);
    },

    toggleMatrixFilter(status) {
        if (this.matrixFilters && this.matrixFilters.hasOwnProperty(status)) {
            this.matrixFilters[status] = !this.matrixFilters[status];
            if (this.matrixSelectedPlayer && !this.matrixFilters[this.matrixSelectedPlayer.status]) {
                this.matrixSelectedPlayer = null;
                this.matrixHoverPlayer = null;
            }
        }
    },

    selectMatrixPlayer(player) {
        if (!player) return;
        if (this.matrixSelectedPlayer && this.matrixSelectedPlayer.name === player.name) {
            this.matrixSelectedPlayer = null;
            this.matrixHoverPlayer = null;
        } else {
            this.matrixSelectedPlayer = player;
            this.matrixHoverPlayer = player;
        }
    },

    navigateMatrixPlayer(direction) {
        if (!this.matrixChartData || !this.matrixChartData.players || this.matrixChartData.players.length === 0) return;
        const list = this.matrixChartData.players;
        let idx = this.currentSelectedPlayerIndex;
        if (idx === -1) {
            idx = direction > 0 ? 0 : list.length - 1;
        } else {
            idx = (idx + direction + list.length) % list.length;
        }
        const next = list[idx];
        if (next) {
            this.selectMatrixPlayer(next);
        }
    },

    findClosestPlayer(svgX, svgY, threshold = 36) {
        let closest = null;
        let minDist = threshold;
        for (const p of this.matrixChartData.players) {
            const dx = p.cx - svgX;
            const dy = p.cy - svgY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                closest = p;
            }
        }
        return closest;
    },

    selectPlayerByName(name) {
        if (!name) return;
        const norm = name.toLowerCase().trim();
        const found = this.matrixChartData?.players?.find(p => p.name.toLowerCase().trim() === norm);
        if (found) {
            this.selectMatrixPlayer(found);
            return true;
        }
        return false;
    }
};

// 1. Test selecting a player
console.log('1. Testing selectMatrixPlayer()...');
const joshAllen = app.matrixChartData.players[0];
app.selectMatrixPlayer(joshAllen);
assert.strictEqual(app.matrixSelectedPlayer.name, 'Josh Allen', 'Josh Allen should be selected');
assert.strictEqual(app.matrixHoverPlayer.name, 'Josh Allen', 'Hover player should match selection');
assert.strictEqual(app.currentSelectedPlayerIndex, 0, 'Current index should be 0');
console.log('   [PASS] selectMatrixPlayer successfully selected Josh Allen');

// 2. Test toggling off selection on second tap
console.log('2. Testing selection toggle (tap again to deselect)...');
app.selectMatrixPlayer(joshAllen);
assert.strictEqual(app.matrixSelectedPlayer, null, 'Tapping same player deselects');
assert.strictEqual(app.matrixHoverPlayer, null, 'Hover player cleared on deselect');
assert.strictEqual(app.currentSelectedPlayerIndex, -1, 'Index reset to -1');
console.log('   [PASS] Tapping same player cleanly toggled off selection');

// 3. Test navigation controls (Next & Prev)
console.log('3. Testing navigateMatrixPlayer(1) and (-1)...');
app.selectMatrixPlayer(joshAllen); // index 0
app.navigateMatrixPlayer(1);
assert.strictEqual(app.matrixSelectedPlayer.name, 'Bijan Robinson', 'Next player should be Bijan Robinson');
assert.strictEqual(app.currentSelectedPlayerIndex, 1, 'Index should be 1');

app.navigateMatrixPlayer(-1);
assert.strictEqual(app.matrixSelectedPlayer.name, 'Josh Allen', 'Prev player should be Josh Allen');

// Test wrapping backwards from 0
app.navigateMatrixPlayer(-1);
assert.strictEqual(app.matrixSelectedPlayer.name, 'Taysom Hill', 'Wrapped backwards to last player (Taysom Hill)');
console.log('   [PASS] Next/Prev navigation works with circular wrapping');

// 4. Test proximity tap detection
console.log('4. Testing proximity touch detection (tapping near dot on mobile)...');
// Harrison Butker is at (600, 120). User taps at (610, 125), distance ~= 11.18px (< 36px threshold)
const nearButker = app.findClosestPlayer(610, 125, 36);
assert.ok(nearButker, 'Should find player near tap coordinate');
assert.strictEqual(nearButker.name, 'Harrison Butker', 'Should detect Harrison Butker');

// User taps in empty space at (100, 100) -> distance > 36px
const emptyTap = app.findClosestPlayer(100, 100, 36);
assert.strictEqual(emptyTap, null, 'Should return null for tap in empty area');
console.log('   [PASS] Proximity detection successfully mapped finger tap to closest player');

// 5. Test legend filter toggle
console.log('5. Testing toggleMatrixFilter()...');
app.matrixSelectedPlayer = null; // reset selection
app.selectMatrixPlayer(app.matrixChartData.players[4]); // Select Taysom Hill (wire)
assert.strictEqual(app.matrixSelectedPlayer.name, 'Taysom Hill');
app.toggleMatrixFilter('wire'); // Hide free agents
assert.strictEqual(app.matrixFilters.wire, false, 'Wire filter should be toggled to false');
assert.strictEqual(app.matrixSelectedPlayer, null, 'Selected player should clear when their category is filtered out');
console.log('   [PASS] toggleMatrixFilter toggled state and cleared filtered selection');

// 6. Test selectPlayerByName
console.log('6. Testing selectPlayerByName()...');
const matched = app.selectPlayerByName('Harrison Butker');
assert.ok(matched, 'Player should be found and selected by name');
assert.strictEqual(app.matrixSelectedPlayer.name, 'Harrison Butker');
console.log('   [PASS] selectPlayerByName found and selected Harrison Butker');

// 7. Test quadrant stability across zoom modes (Fit All vs Cluster Focus)
console.log('7. Testing quadrant stability across zoom modes...');
const THRESHOLDS = {
    RB: { rank: 24, ros: 24, maxRankFit: 60, maxRankCluster: 42, maxRosFit: 60, maxRosCluster: 42 }
};
const th = THRESHOLDS.RB;
const testRbs = [
    { name: 'Bijan Robinson', weekRank: 2, rosRank: 2, expected: 'STUD' },
    { name: 'Travis Etienne', weekRank: 35, rosRank: 22, expected: 'STASH' },
    { name: 'Chuba Hubbard', weekRank: 18, rosRank: 32, expected: 'STREAMER' },
    { name: 'Zamir White', weekRank: 38, rosRank: 44, expected: 'DROP' }
];

for (const zoom of ['fit', 'cluster']) {
    const isCluster = (zoom === 'cluster');
    const maxX = isCluster ? th.maxRankCluster : th.maxRankFit;
    const maxY = isCluster ? th.maxRosCluster : th.maxRosFit;
    const minX = 1, minY = 1;

    const xScale = val => ((maxX - Math.max(minX, Math.min(maxX, val))) / (maxX - minX));
    const yScale = ros => ((Math.max(minY, Math.min(maxY, ros)) - minY) / (maxY - minY));

    const midX = xScale(th.rank);
    const midY = yScale(th.ros);

    for (const p of testRbs) {
        const cx = xScale(p.weekRank);
        const cy = yScale(p.rosRank);
        const isRight = cx >= midX;
        const isTop = cy <= midY;
        let quadrant = '';
        if (isRight && isTop) quadrant = 'STUD';
        else if (!isRight && isTop) quadrant = 'STASH';
        else if (isRight && !isTop) quadrant = 'STREAMER';
        else quadrant = 'DROP';

        assert.strictEqual(quadrant, p.expected, `${p.name} quadrant in ${zoom} zoom must match expected ${p.expected}`);
    }
}
console.log('   [PASS] All players maintain 100% consistent quadrants across zoom levels');

// 8. Test Zoom in, Zoom out, and Reset
console.log('8. Testing zoomMatrixBy() and resetMatrixZoom()...');
app.resetMatrixZoom();
assert.strictEqual(app.matrixZoomPercent, 100, 'Initial zoom should be 100%');
assert.strictEqual(app.isMatrixZoomedOrPanned, false, 'Initial state should not be zoomed or panned');

// Zoom in by 1.25x
app.zoomMatrixBy(1.25);
assert.strictEqual(app.matrixZoomPercent, 125, 'Zoom in should increase zoom percent to 125%');
assert.strictEqual(app.isMatrixZoomedOrPanned, true, 'isMatrixZoomedOrPanned should be true when zoomed');
assert.ok(app.matrixViewBox.w < 800, 'ViewBox width should be narrower when zoomed in');

// Zoom in further
app.zoomMatrixBy(1.25);
assert.ok(app.matrixZoomPercent >= 150, 'Zoom should continue increasing');

// Reset zoom
app.resetMatrixZoom();
assert.strictEqual(app.matrixZoomPercent, 100, 'Zoom percent reset to 100%');
assert.strictEqual(app.isMatrixZoomedOrPanned, false, 'isMatrixZoomedOrPanned reset to false');
assert.deepStrictEqual(app.matrixViewBox, { x: 0, y: 0, w: 800, h: 500 }, 'ViewBox reset to default 800x500');
console.log('   [PASS] zoomMatrixBy and resetMatrixZoom operate accurately');

// 9. Test Drag vs Tap discrimination
console.log('9. Testing Drag vs Tap discrimination...');
app.matrixSelectedPlayer = null; // Clear selection

// Simulate a pure click (mousedown followed by mouseup with 0 movement)
app.onMatrixMouseDown({ button: 0, clientX: 200, clientY: 200 });
app.onMatrixMouseMove({ clientX: 201, clientY: 200 }); // 1px move (< 5px threshold)
assert.strictEqual(app.matrixHasDragged, false, '1px move must not count as drag');
app.onMatrixPlayerClick(joshAllen);
assert.strictEqual(app.matrixSelectedPlayer?.name, 'Josh Allen', 'Tap selects player');

// Simulate a drag (mousedown followed by 50px drag)
app.matrixSelectedPlayer = null; // Clear selection
app.onMatrixMouseDown({ button: 0, clientX: 200, clientY: 200 });
app.onMatrixMouseMove({ clientX: 250, clientY: 220 }); // > 5px move
assert.strictEqual(app.matrixHasDragged, true, '50px move must set matrixHasDragged to true');
app.onMatrixMouseUp();
// Player click triggered at end of drag must be suppressed
app.onMatrixPlayerClick(joshAllen);
assert.strictEqual(app.matrixSelectedPlayer, null, 'Drag release must NOT trigger player selection');
console.log('   [PASS] Taps select players while drag gestures do not accidentally trigger selection');

// 10. Test Panning bounds and ViewBox calculation
console.log('10. Testing Pan calculation and boundary clamping...');
app.resetMatrixZoom();
// Start drag at (300, 200) and drag 100px left
app.onMatrixMouseDown({ button: 0, clientX: 300, clientY: 200 });
app.onMatrixMouseMove({ clientX: 200, clientY: 200 }); // dx = -100px, chart moves right (+100 vbX)
app.onMatrixMouseUp();
assert.strictEqual(app.matrixViewBox.x, 100, 'Panning right shifts ViewBox X by +100');
assert.strictEqual(app.isMatrixZoomedOrPanned, true, 'isMatrixZoomedOrPanned is true after pan');

// Reset back
app.resetMatrixZoom();
assert.strictEqual(app.matrixViewBox.x, 0, 'ViewBox X reset to 0');
console.log('   [PASS] Pan calculation correctly shifts ViewBox with clamping');

// 11. Test Unclamped Domain Scaling & Boundary Margins
console.log('11. Testing unclamped plot scaling and breathing room...');
const samplePlayers = [
    { name: 'Elite 1', weekRank: 1, rosRank: 1 },
    { name: 'Starter 12', weekRank: 12, rosRank: 12 },
    { name: 'Deep Bench 68', weekRank: 68, rosRank: 55 },
    { name: 'Extreme Stash 82', weekRank: 40, rosRank: 82 }
];

const posThreshTest = { rank: 24, ros: 24, maxRankFit: 60, maxRosFit: 60 };
const maxRank = Math.max(...samplePlayers.map(p => p.weekRank));
const maxRos = Math.max(...samplePlayers.map(p => p.rosRank));

const testMaxX = Math.max(posThreshTest.maxRankFit, Math.ceil(maxRank + 5));
const testMaxY = Math.max(posThreshTest.maxRosFit, Math.ceil(maxRos + 5));
assert.ok(testMaxX >= 73, 'maxX must expand to cover max rank 68 with padding');
assert.ok(testMaxY >= 87, 'maxY must expand to cover max ROS 82 with padding');

const width = 800, height = 500;
const margin = { top: 40, right: 45, bottom: 50, left: 65 };
const plotWidth = width - margin.left - margin.right;
const plotHeight = height - margin.top - margin.bottom;
const innerPad = 16;
const usableW = plotWidth - innerPad * 2;
const usableH = plotHeight - innerPad * 2;

const scaleX = val => margin.left + innerPad + ((testMaxX - val) / (testMaxX - 1)) * usableW;
const scaleY = ros => margin.top + innerPad + ((ros - 1) / (testMaxY - 1)) * usableH;

for (const p of samplePlayers) {
    const cx = scaleX(p.weekRank);
    const cy = scaleY(p.rosRank);

    // Verify player is strictly inside plot boundaries with at least 8px margin
    assert.ok(cx > margin.left + 8, `${p.name} cx (${cx}) must be strictly inside left plot border (${margin.left})`);
    assert.ok(cx < margin.left + plotWidth - 8, `${p.name} cx (${cx}) must be strictly inside right plot border (${margin.left + plotWidth})`);
    assert.ok(cy > margin.top + 8, `${p.name} cy (${cy}) must be strictly inside top plot border (${margin.top})`);
    assert.ok(cy < margin.top + plotHeight - 8, `${p.name} cy (${cy}) must be strictly inside bottom plot border (${margin.top + plotHeight})`);
}
console.log('   [PASS] Every player dot has generous breathing room and is 100% unclamped');

console.log('\nALL MATRIX CHART SELECTION & UNCLAMPED PAN/ZOOM TESTS PASSED! [OK]');

