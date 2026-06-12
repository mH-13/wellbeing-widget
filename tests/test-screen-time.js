/* tests/test-screen-time.js
 *
 * Unit tests for lib/screenTime.js. Run locally (not shipped to EGO):
 *
 *     gjs -m tests/test-screen-time.js
 *
 * Fixtures mirror real failure cases observed in production data
 * (June 2026): unclean shutdowns leaving 21-24h phantom "active" spans,
 * and NTP stepping the wall clock backwards mid-session.
 */
import system from 'system';
import {
    calculateDayScreenTime,
    normalizeCutoffs,
    sanitizeDailySeconds,
    localDateStr,
    DAY_SECONDS,
} from '../lib/screenTime.js';

let failures = 0;
let checks = 0;

function assertEq(actual, expected, label) {
    checks++;
    if (actual !== expected) {
        failures++;
        print(`FAIL: ${label}\n      expected ${expected}, got ${actual}`);
    } else {
        print(`  ok: ${label}`);
    }
}

// Epoch seconds for a local date/time
const T = (y, mo, d, h, mi, s = 0) => Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);
const D = (y, mo, d) => new Date(y, mo - 1, d);
const active = t => ({wallTimeSecs: t, oldState: 0, newState: 1});
const idle = t => ({wallTimeSecs: t, oldState: 1, newState: 0});

// --- simple day: two clean spans ---------------------------------------
{
    const hist = [
        active(T(2026, 6, 12, 10, 0)), idle(T(2026, 6, 12, 12, 0)),
        active(T(2026, 6, 12, 14, 0)), idle(T(2026, 6, 12, 14, 30)),
    ];
    assertEq(calculateDayScreenTime(hist, D(2026, 6, 12)), 2.5 * 3600,
        'two clean spans sum to 2h30m');
}

// --- genuine span across midnight splits between both days -------------
{
    const hist = [
        active(T(2026, 6, 11, 23, 0)),
        idle(T(2026, 6, 12, 1, 0)),
    ];
    assertEq(calculateDayScreenTime(hist, D(2026, 6, 11)), 3600,
        'midnight-crossing span: 1h on the first day');
    assertEq(calculateDayScreenTime(hist, D(2026, 6, 12)), 3600,
        'midnight-crossing span: 1h on the second day');
}

// --- the real Friday bug: unclean shutdown, span closed at next boot ---
// active Fri 03:43, machine dies ~03:45 (journal boot end = cutoff),
// next boot writes the closing idle entry Sat 01:06, real new usage
// Sat 01:24 onward.
{
    const cutoffs = [T(2026, 6, 12, 3, 45, 32)];
    const hist = [
        active(T(2026, 6, 12, 0, 6)), idle(T(2026, 6, 12, 1, 25)),
        active(T(2026, 6, 12, 3, 43, 28)),
        idle(T(2026, 6, 13, 1, 6, 29)),      // posthumous close at next boot
        active(T(2026, 6, 13, 1, 24, 6)),
    ];
    const friUnclipped = calculateDayScreenTime(hist, D(2026, 6, 12));
    const friClipped = calculateDayScreenTime(hist, D(2026, 6, 12), {cutoffs});
    assertEq(friUnclipped, 79 * 60 + (T(2026, 6, 13, 0, 0) - T(2026, 6, 12, 3, 43, 28)),
        'without cutoffs Friday is inflated to ~21.6h (reproduces the bug)');
    assertEq(friClipped, 79 * 60 + 124,
        'with boot cutoff Friday keeps 1h19m + 2m04s real usage');

    const satNow = T(2026, 6, 13, 2, 4);
    const sat = calculateDayScreenTime(hist, D(2026, 6, 13), {currentTime: satNow, cutoffs});
    assertEq(sat, satNow - T(2026, 6, 13, 1, 24, 6),
        'Saturday gets only the genuine 01:24→now span, none of the phantom tail');
}

// --- cutoff after a cleanly closed span must not clip it ----------------
{
    const cutoffs = [T(2026, 6, 12, 18, 0)]; // boot ended in the evening
    const hist = [active(T(2026, 6, 12, 10, 0)), idle(T(2026, 6, 12, 12, 0))];
    assertEq(calculateDayScreenTime(hist, D(2026, 6, 12), {cutoffs}), 2 * 3600,
        'cutoff later in the day leaves a cleanly closed span untouched');
}

// --- clock stepped backwards (NTP) cannot produce negative time ---------
{
    const hist = [
        active(T(2026, 2, 27, 10, 0)),
        idle(T(2026, 2, 27, 4, 0)),   // close "before" the open — clock jumped back
        active(T(2026, 2, 27, 4, 30)), idle(T(2026, 2, 27, 5, 0)),
    ];
    const result = calculateDayScreenTime(hist, D(2026, 2, 27));
    assertEq(result >= 0, true, 'backwards clock step never yields negative seconds');
    assertEq(result, 1800, 'only the consistent span is counted after a clock step');
}

// --- open span today ends at currentTime --------------------------------
{
    const hist = [active(T(2026, 6, 13, 1, 0))];
    assertEq(calculateDayScreenTime(hist, D(2026, 6, 13), {currentTime: T(2026, 6, 13, 1, 40)}),
        40 * 60, 'open span today is counted up to currentTime');
}

// --- garbage in, zero out ------------------------------------------------
{
    assertEq(calculateDayScreenTime(null, D(2026, 6, 12)), 0, 'null history → 0');
    assertEq(calculateDayScreenTime([], D(2026, 6, 12)), 0, 'empty history → 0');
    assertEq(calculateDayScreenTime([{bogus: true}, active(T(2026, 6, 12, 10, 0)), idle(T(2026, 6, 12, 11, 0))],
        D(2026, 6, 12)), 3600, 'malformed entries are skipped');
}

// --- daily total is clamped to one day -----------------------------------
{
    const hist = [active(T(2026, 6, 11, 0, 0))]; // open forever
    const result = calculateDayScreenTime(hist, D(2026, 6, 12));
    assertEq(result <= DAY_SECONDS, true, 'daily total never exceeds 24h');
}

// --- normalizeCutoffs ----------------------------------------------------
{
    const now = T(2026, 6, 13, 2, 0);
    const out = normalizeCutoffs(
        [now - 100, now - 100, now + 999, now - 40 * DAY_SECONDS, NaN, now - 50],
        {nowSecs: now});
    assertEq(JSON.stringify(out), JSON.stringify([now - 100, now - 50]),
        'normalizeCutoffs dedupes, sorts, drops future/ancient/NaN');
}

// --- sanitizeDailySeconds ------------------------------------------------
{
    assertEq(sanitizeDailySeconds(-64325), 0, 'negative stored day → 0');
    assertEq(sanitizeDailySeconds(90000), DAY_SECONDS, 'over-24h stored day → 24h');
    assertEq(sanitizeDailySeconds('junk'), 0, 'non-numeric stored day → 0');
    assertEq(sanitizeDailySeconds(3600), 3600, 'sane value passes through');
}

// --- localDateStr uses local time, not UTC -------------------------------
{
    assertEq(localDateStr(new Date(2026, 5, 13, 0, 30)), '2026-06-13',
        'date key just after local midnight stays on the local day');
}

print(`\n${checks - failures}/${checks} checks passed`);
system.exit(failures > 0 ? 1 : 0);
