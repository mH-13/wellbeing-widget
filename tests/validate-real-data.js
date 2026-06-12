/* tests/validate-real-data.js
 *
 * Manual validation harness (not shipped, not a unit test): runs the pure
 * calculation against THIS machine's real session history and journal boot
 * list, printing old (uncapped) vs corrected values for the last 7 days.
 *
 *     gjs -m tests/validate-real-data.js
 */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';
import {calculateDayScreenTime, normalizeCutoffs} from '../lib/screenTime.js';

const historyPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/session-active-history.json`;
const [, historyBytes] = GLib.file_get_contents(historyPath);
const history = JSON.parse(new TextDecoder().decode(historyBytes));

// Same query the extension runs once per boot
const proc = Gio.Subprocess.new(
    ['journalctl', '--list-boots', '-o', 'json', '--quiet'],
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
);
const [, stdout] = proc.communicate_utf8(null, null);
const boots = JSON.parse(stdout);
const cutoffs = normalizeCutoffs(
    boots.filter(b => b.index !== 0 && Number.isFinite(b.last_entry))
        .map(b => Math.floor(b.last_entry / 1e6)));

const fmt = s => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const nowSecs = Math.floor(Date.now() / 1000);

print(`cutoffs from journal: ${cutoffs.map(t => new Date(t * 1000).toLocaleString()).join(', ')}\n`);
print(`${'day'.padEnd(16)}${'old (buggy)'.padStart(14)}${'corrected'.padStart(14)}`);

let total = 0;
for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const currentTime = daysAgo === 0 ? nowSecs : null;
    const oldVal = calculateDayScreenTime(history, d, {currentTime});
    const newVal = calculateDayScreenTime(history, d, {currentTime, cutoffs});
    total += newVal;
    const label = d.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
    print(`${label.padEnd(16)}${fmt(oldVal).padStart(14)}${fmt(newVal).padStart(14)}`);
}
print(`\ncorrected weekly avg: ${fmt(Math.floor(total / 7))}/day`);
system.exit(0);
