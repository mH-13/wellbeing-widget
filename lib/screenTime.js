/* lib/screenTime.js
 *
 * Pure screen-time calculation - no GNOME Shell imports, so it can be
 * unit-tested with plain `gjs -m` outside a shell session.
 *
 * Background: ~/.local/share/gnome-shell/session-active-history.json only
 * records state *transitions* ({ wallTimeSecs, newState }, 1 = active,
 * 0 = idle). When the machine dies uncleanly (power loss, crash) no
 * closing transition is written, and gnome-shell closes the open "active"
 * state at the *next boot* - silently turning a whole powered-off period
 * into "screen time" (gnome-shell#8289). Wall-clock corrections (NTP) can
 * also step timestamps backwards, producing negative spans.
 *
 * Defense: callers pass `cutoffs` - sorted "evidence of death" timestamps
 * (journal boot ends, extension heartbeat). Rule: an active span cannot
 * outlive the first cutoff after it starts.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export const DAY_SECONDS = 86400;

// Local-date key (YYYY-MM-DD). toISOString() would give the UTC date,
// which is the wrong day key for any non-UTC timezone.
export function localDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// [dayStart, dayEnd) in epoch seconds, using real local midnights so DST
// days keep their actual length.
export function dayBoundsSecs(targetDate) {
    const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const end = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
    return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)];
}

// Sort, dedupe, and prune cutoff timestamps. Keeps only plausible values:
// finite, not in the future, not older than maxAgeDays.
export function normalizeCutoffs(cutoffs, {nowSecs = Date.now() / 1000, maxAgeDays = 30, maxCount = 200} = {}) {
    const minSecs = nowSecs - maxAgeDays * DAY_SECONDS;
    const valid = (cutoffs ?? [])
        .map(t => Math.floor(t))
        .filter(t => Number.isFinite(t) && t > minSecs && t <= nowSecs);
    return [...new Set(valid)].sort((a, b) => a - b).slice(-maxCount);
}

// Clamp a stored daily value to the physically possible range.
export function sanitizeDailySeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return 0;
    return Math.min(Math.floor(value), DAY_SECONDS);
}

/**
 * Active seconds within targetDate's local day.
 *
 * @param {Array} historyData - session-active-history entries, file order
 * @param {Date} targetDate - the day to compute
 * @param {object} [options]
 * @param {number|null} [options.currentTime] - epoch secs "now" when
 *        computing today (an open span ends here); null for past days
 * @param {number[]} [options.cutoffs] - sorted evidence-of-death epoch
 *        seconds; a span is clipped at the first cutoff after its start
 * @returns {number} seconds in [0, DAY_SECONDS]
 */
export function calculateDayScreenTime(historyData, targetDate, {currentTime = null, cutoffs = []} = {}) {
    if (!Array.isArray(historyData) || historyData.length === 0)
        return 0;

    const [dayStart, dayEnd] = dayBoundsSecs(targetDate);

    // First cutoff at/after the span start; a span claiming to live past
    // it is phantom (machine was provably dead/rebooted in between).
    const clipEnd = (start, end) => {
        for (const t of cutoffs) {
            if (t >= start)
                return Math.min(end, t);
        }
        return end;
    };

    let total = 0;
    let activeStart = null;

    const addSpan = (start, end) => {
        end = clipEnd(start, end);
        const s = Math.max(start, dayStart);
        const e = Math.min(end, dayEnd);
        if (e > s)
            total += e - s;
    };

    for (const entry of historyData) {
        if (typeof entry?.wallTimeSecs !== 'number' || !Number.isFinite(entry.wallTimeSecs))
            continue;
        if (entry.wallTimeSecs >= dayEnd)
            break;

        if (entry.newState === 1) {
            if (activeStart === null)
                activeStart = entry.wallTimeSecs;
        } else if (activeStart !== null) {
            addSpan(activeStart, entry.wallTimeSecs);
            activeStart = null;
        }
    }

    // Span still open at the end of the data: close at "now" for today,
    // at day end for past days (cutoffs still apply inside addSpan).
    if (activeStart !== null)
        addSpan(activeStart, currentTime !== null ? Math.min(currentTime, dayEnd) : dayEnd);

    return Math.max(0, Math.min(total, DAY_SECONDS));
}
