/* extension.js — Wellbeing Widget (Apple Screen Time Edition)
 * Removed: Zen Music, Focus/Pomodoro session
 * Added: Per-app usage breakdown
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Shell from 'gi://Shell';

const WellbeingIndicator = GObject.registerClass(
class WellbeingIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Wellbeing Widget', false);
        this._extension = extension;
        this._settings = extension.getSettings();

        // Screen time state
        this._cachedLiveSeconds = 0;
        this._isLoadingScreenTime = true;
        this._screenTimeError = null;
        this._lastRecordedDate = new Date().toISOString().split('T')[0];
        this._finalizedDays = new Set();
        this._saveTimeout = null;
        this._lastStatsSave = 0;
        this._statsSaveInterval = 60000;
        this._lastStatsUpdate = 0;

        // Quote
        this._lastQuoteChange = Date.now();
        this._currentQuote = null;

        // Per-app usage tracking
        this._appUsage = {};  // { appName: totalSeconds }
        this._appTrackTimer = null;
        this._lastTrackedApp = null;
        this._lastTrackTime = null;

        this._loadStats();
        this._buildUI();
        this._startUpdating();
        this._startAppTracking();

        this._settingsChangedIds = [
            this._settings.connect('changed::show-panel-icon', () => {
                this.visible = this._settings.get_boolean('show-panel-icon');
            })
        ];
        this.visible = this._settings.get_boolean('show-panel-icon');
    }

    // ── Stats persistence ─────────────────────────────────────────────────────
    _loadStats() {
        const statsJson = this._settings.get_string('statistics-data');
        try {
            this._stats = statsJson ? JSON.parse(statsJson) : { daily: {}, pomodoros: {}, finalized: [] };
            if (!this._stats.daily)     this._stats.daily = {};
            if (!this._stats.pomodoros) this._stats.pomodoros = {};
            if (!this._stats.finalized) this._stats.finalized = [];
            this._finalizedDays = new Set(this._stats.finalized);
        } catch (e) {
            this._stats = { daily: {}, pomodoros: {}, finalized: [] };
            this._finalizedDays = new Set();
        }
    }

    _saveStats() {
        if (this._saveTimeout) { GLib.Source.remove(this._saveTimeout); this._saveTimeout = null; }
        this._saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            try {
                this._stats.finalized = Array.from(this._finalizedDays);
                this._settings.set_string('statistics-data', JSON.stringify(this._stats));
            } catch (e) { /* silent */ }
            this._saveTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _recordDailyStats(date, screenTimeSeconds) {
        const dateStr = date.toISOString().split('T')[0];
        this._stats.daily[dateStr] = screenTimeSeconds;
        this._saveStats();
    }

    // ── App tracking ──────────────────────────────────────────────────────────
    _startAppTracking() {
        this._appTrackTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            try {
                const tracker = Shell.WindowTracker.get_default();
                const focusedWindow = global.display.get_focus_window();
                if (focusedWindow) {
                    const app = tracker.get_window_app(focusedWindow);
                    if (app) {
                        const appName = app.get_name() || 'Unknown';
                        const now = Date.now() / 1000;
                        if (this._lastTrackedApp === appName && this._lastTrackTime) {
                            const elapsed = now - this._lastTrackTime;
                            this._appUsage[appName] = (this._appUsage[appName] || 0) + elapsed;
                        }
                        this._lastTrackedApp = appName;
                        this._lastTrackTime = now;
                    }
                }
            } catch (e) { /* silent */ }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getTopApps(n = 4) {
        return Object.entries(this._appUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([name, secs]) => ({ name, secs }));
    }

    _formatDuration(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // ── UI Builder ────────────────────────────────────────────────────────────
    _buildUI() {
        // Panel button
        this._panelBox = new St.BoxLayout({ style_class: 'wellbeing-panel-box' });
        this._label = new St.Label({
            text: 'Loading…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'wellbeing-panel-label'
        });
        this._panelBox.add_child(this._label);
        this.add_child(this._panelBox);
        this.menu.box.style_class = 'wellbeing-menu';

        // ── Header ────────────────────────────────────────────────────────────
        const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'wellbeing-header-quote-section' });
        const headerBox  = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-header-quote-box' });

        const titleRow = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-header-title-box' });
        titleRow.add_child(new St.Icon({ icon_name: 'preferences-system-time-symbolic', icon_size: 18, style_class: 'wellbeing-header-icon' }));
        titleRow.add_child(new St.Label({ text: 'Screen Time', style_class: 'wellbeing-title' }));

        // Hero time label — big like Apple
        this._heroLabel = new St.Label({ text: '0h 0m', style_class: 'wellbeing-hero-time' });
        this._heroSub   = new St.Label({ text: 'Today', style_class: 'wellbeing-hero-sub' });

        this._quoteLabel = new St.Label({ text: this._getMotivationalQuote(), style_class: 'wellbeing-quote-label-compact' });
        this._quoteLabel.clutter_text.line_wrap = true;

        headerBox.add_child(titleRow);
        headerBox.add_child(this._heroLabel);
        headerBox.add_child(this._heroSub);
        headerBox.add_child(this._quoteLabel);
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        // ── Weekly Chart ──────────────────────────────────────────────────────
        const chartHeaderItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        chartHeaderItem.add_child(new St.Label({ text: 'Weekly Overview', style_class: 'wellbeing-section-header' }));
        this.menu.addMenuItem(chartHeaderItem);

        this._statsGraphItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'wellbeing-stats-graph-item' });
        this._statsGraphBox  = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-stats-graph-box' });
        this._statsGraphItem.add_child(this._statsGraphBox);
        this.menu.addMenuItem(this._statsGraphItem);

        this._statsSummaryItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'wellbeing-stats-summary-item' });
        this._statsSummaryBox  = new St.BoxLayout({ vertical: true });
        this._statsSummaryBox.add_child(new St.Label({ text: 'Loading…', style_class: 'wellbeing-stats-summary-label' }));
        this._statsSummaryItem.add_child(this._statsSummaryBox);
        this.menu.addMenuItem(this._statsSummaryItem);

        // ── Most Used Apps ────────────────────────────────────────────────────
        const appsHeaderItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        appsHeaderItem.add_child(new St.Label({ text: 'Most Used', style_class: 'wellbeing-section-header' }));
        this.menu.addMenuItem(appsHeaderItem);

        this._appsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'wellbeing-apps-card' });
        this._appsBox  = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-apps-box' });
        this._appsItem.add_child(this._appsBox);
        this.menu.addMenuItem(this._appsItem);

        // ── Settings ──────────────────────────────────────────────────────────
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, style_class: 'wellbeing-settings-item' });
        const settingsBox  = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-settings-box', x_expand: true });
        settingsBox.add_child(new St.Icon({ icon_name: 'preferences-system-symbolic', icon_size: 16, style_class: 'wellbeing-settings-icon' }));
        settingsBox.add_child(new St.Label({ text: 'Extension Settings', style_class: 'wellbeing-settings-label', x_expand: true }));
        settingsItem.add_child(settingsBox);
        settingsItem.connect('activate', () => { this._extension.openPreferences(); this.menu.close(); });
        this.menu.addMenuItem(settingsItem);

        // ── Menu open handler ─────────────────────────────────────────────────
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                GLib.idle_add(GLib.PRIORITY_LOW, () => {
                    const now = Date.now();
                    if (now - this._lastStatsUpdate > 10000) {
                        this._updateStatsView();
                        this._updateAppsView();
                        this._lastStatsUpdate = now;
                    }
                    const secs = this._getDailyScreenTimeSeconds();
                    if (secs > 0) this._recordDailyStats(new Date(), secs);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    // ── App usage panel ───────────────────────────────────────────────────────
    _updateAppsView() {
        this._appsBox.destroy_all_children();
        const topApps = this._getTopApps(4);

        if (topApps.length === 0) {
            const empty = new St.Label({ text: 'No data yet — keep using your computer!', style_class: 'wellbeing-apps-empty' });
            this._appsBox.add_child(empty);
            return;
        }

        const maxSecs = topApps[0].secs || 1;

        topApps.forEach(({ name, secs }) => {
            const row = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-app-row', x_expand: true });

            // App name
            const nameLabel = new St.Label({ text: name, style_class: 'wellbeing-app-name', x_expand: true });
            nameLabel.clutter_text.ellipsize = 3; // PANGO_ELLIPSIZE_END

            // Duration
            const durLabel = new St.Label({ text: this._formatDuration(secs), style_class: 'wellbeing-app-duration' });

            row.add_child(nameLabel);
            row.add_child(durLabel);
            this._appsBox.add_child(row);

            // Progress bar
            const barTrack = new St.Widget({ style_class: 'wellbeing-app-bar-track', x_expand: true });
            const barFill  = new St.Widget({
                style_class: 'wellbeing-app-bar-fill',
                width: Math.max((secs / maxSecs) * 290, 6)
            });
            barTrack.add_child(barFill);
            this._appsBox.add_child(barTrack);
        });
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    _updateStatsView() {
        const data = this._getStatsData();
        this._drawMiniGraph(data);
        this._updateStatsSummary(data);
    }

    _getStatsData() {
        const now = new Date();
        const result = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            const s = d.toISOString().split('T')[0];
            result.push({ date: d, dateStr: s, screenTime: this._stats.daily[s] || 0, pomodoros: this._stats.pomodoros[s] || 0 });
        }
        return result;
    }

    _drawMiniGraph(data) {
        this._statsGraphBox.destroy_all_children();
        const maxST = Math.max(...data.map(d => d.screenTime), 1);

        const wrapper = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });

        // Shared tooltip
        const tooltip = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-stats-tooltip', visible: false, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START });
        const ttDate  = new St.Label({ text: '', style_class: 'wellbeing-stats-tooltip-date' });
        const ttTime  = new St.Label({ text: '', style_class: 'wellbeing-stats-tooltip-time' });
        tooltip.add_child(ttDate); tooltip.add_child(ttTime);

        const chartBox = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-stats-chart-box', x_expand: true });

        data.forEach(day => {
            const h = Math.floor(day.screenTime / 3600);
            const m = Math.floor((day.screenTime % 3600) / 60);
            const barH = Math.max((day.screenTime / maxST) * 80, 2);
            const hrs  = day.screenTime / 3600;

            let barClass = 'wellbeing-stats-bar-screen';
            if (hrs > 8)      barClass = 'wellbeing-stats-bar-screen-high';
            else if (hrs > 6) barClass = 'wellbeing-stats-bar-screen-medium-high';
            else if (hrs > 4) barClass = 'wellbeing-stats-bar-screen-medium';

            const col = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-stats-bar-container', x_expand: true, x_align: Clutter.ActorAlign.CENTER, reactive: true, track_hover: true });
            const area = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-stats-bar-area', y_expand: true, y_align: Clutter.ActorAlign.END });
            area.add_child(new St.Widget({ style_class: barClass, style: `height:${barH}px;width:100%;` }));
            col.add_child(area);
            col.add_child(new St.Label({ text: ['S','M','T','W','T','F','S'][day.date.getDay()], style_class: 'wellbeing-stats-day-label' }));

            col.connect('enter-event', () => {
                col.add_style_class_name('wellbeing-stats-bar-hover');
                ttDate.text = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                ttTime.text = `${h}h ${m}m`;
                tooltip.visible = true; tooltip.opacity = 0;
                tooltip.ease({ opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            });
            col.connect('leave-event', () => {
                col.remove_style_class_name('wellbeing-stats-bar-hover');
                tooltip.ease({ opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_IN_QUAD, onComplete: () => { tooltip.visible = false; } });
            });
            chartBox.add_child(col);
        });

        wrapper.add_child(chartBox);
        wrapper.add_child(tooltip);
        this._statsGraphBox.add_child(wrapper);
    }

    _updateStatsSummary(data) {
        this._statsSummaryBox.destroy_all_children();
        const total = data.reduce((s, d) => s + d.screenTime, 0);
        const avg   = data.length ? total / data.length : 0;
        const ah = Math.floor(avg / 3600), am = Math.floor((avg % 3600) / 60);
        this._statsSummaryBox.add_child(new St.Label({ text: `Avg ${ah}h ${am}m/day this week`, style_class: 'wellbeing-stats-summary-label' }));
        const today = data[data.length - 1];
        if (today?.screenTime > 0) {
            const th = Math.floor(today.screenTime / 3600), tm = Math.floor((today.screenTime % 3600) / 60);
            this._statsSummaryBox.add_child(new St.Label({ text: `Today: ${th}h ${tm}m`, style_class: 'wellbeing-stats-summary-label' }));
        }
    }

    // ── Screen time readers ───────────────────────────────────────────────────
    _getDailyScreenTimeSeconds() {
        if (this._cachedLiveSeconds > 0) return this._cachedLiveSeconds;
        const s = new Date().toISOString().split('T')[0];
        return this._stats.daily[s] || 0;
    }

    _calculateDayScreenTime(historyData, targetDate, currentTime = null) {
        const ms = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const me = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1, 0, 0, 0);
        const dayStart = Math.floor(ms.getTime() / 1000);
        const dayEnd   = Math.floor(me.getTime() / 1000);
        let total = 0, lastStart = null, lastBefore = null;

        for (const e of historyData) { if (e.wallTimeSecs < dayStart) lastBefore = e.newState; else break; }
        if (lastBefore === 1) lastStart = dayStart;

        for (const e of historyData) {
            if (e.wallTimeSecs < dayStart) continue;
            if (e.wallTimeSecs >= dayEnd)  break;
            if (e.newState === 1) { if (!lastStart) lastStart = e.wallTimeSecs; }
            else if (e.newState === 0 && lastStart) { total += e.wallTimeSecs - lastStart; lastStart = null; }
        }
        if (lastStart) total += (currentTime ?? dayEnd) - lastStart;
        return total;
    }

    _updateLiveScreenTime() {
        const now     = new Date();
        const todayStr = now.toISOString().split('T')[0];
        if (todayStr !== this._lastRecordedDate) {
            if (!this._finalizedDays.has(this._lastRecordedDate)) { this._finalizedDays.add(this._lastRecordedDate); this._saveStats(); }
            this._lastRecordedDate = todayStr;
            this._cachedLiveSeconds = 0;
        }
        const file = Gio.File.new_for_path(`${GLib.get_home_dir()}/.local/share/gnome-shell/session-active-history.json`);
        file.load_contents_async(null, (_f, res) => {
            try {
                const [ok, contents] = file.load_contents_finish(res);
                if (ok) {
                    const hist = JSON.parse(new TextDecoder().decode(contents));
                    const ct   = Math.floor(Date.now() / 1000);
                    const cb   = new Date();
                    if (cb.toISOString().split('T')[0] === todayStr) {
                        const secs = this._calculateDayScreenTime(hist, cb, ct);
                        this._stats.daily[todayStr] = secs;
                        this._cachedLiveSeconds = secs;
                    }
                    for (let i = 1; i <= 7; i++) {
                        const pd = new Date(cb); pd.setDate(pd.getDate() - i);
                        const ps = pd.toISOString().split('T')[0];
                        if (!this._finalizedDays.has(ps) && !this._stats.daily[ps])
                            this._stats.daily[ps] = this._calculateDayScreenTime(hist, pd, null);
                    }
                    this._saveStats();
                }
                this._isLoadingScreenTime = false;
            } catch (e) { this._isLoadingScreenTime = false; this._cachedLiveSeconds = 0; }
        });
    }

    _getDailyScreenTime() {
        if (this._isLoadingScreenTime && !this._cachedLiveSeconds) return 'Loading…';
        const secs = this._getDailyScreenTimeSeconds();
        if (secs <= 0) return '0h 0m';
        return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
    }

    // ── Quote ─────────────────────────────────────────────────────────────────
    _getMotivationalQuote() {
        const q = [
            '"Focus is the gateway to excellence"',
            '"Deep work produces deep results"',
            '"Progress over perfection, always"',
            '"Energy follows attention"',
            '"Mindfulness begins with awareness"',
            '"Your attention is your most valuable currency"',
            '"Balance is not found, it is created"',
            '"Rest is not a reward — it\'s a requirement"',
        ];
        return q[Math.floor(Math.random() * q.length)];
    }

    // ── Update loop ───────────────────────────────────────────────────────────
    _startUpdating() {
        this._updateUI();
        this._updateTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { this._updateUI(); return GLib.SOURCE_CONTINUE; });
    }

    _updateUI() {
        try {
            this._updateLiveScreenTime();
            const t = this._getDailyScreenTime();
            this._label.text = t;

            // Colour panel by usage
            const hrs = this._getDailyScreenTimeSeconds() / 3600;
            ['wellbeing-panel-box-medium','wellbeing-panel-box-medium-high','wellbeing-panel-box-high'].forEach(c => this._panelBox.remove_style_class_name(c));
            if (hrs > 8)      this._panelBox.add_style_class_name('wellbeing-panel-box-high');
            else if (hrs > 6) this._panelBox.add_style_class_name('wellbeing-panel-box-medium-high');
            else if (hrs > 4) this._panelBox.add_style_class_name('wellbeing-panel-box-medium');

            // Hero label
            if (this._heroLabel) this._heroLabel.text = t;

            // Quote (hourly rotation)
            const now = Date.now();
            if (!this._currentQuote || now - this._lastQuoteChange > 3600000) {
                this._currentQuote  = this._getMotivationalQuote();
                this._lastQuoteChange = now;
            }
            if (this._quoteLabel) this._quoteLabel.text = this._currentQuote;

            // Periodic save
            if (now - this._lastStatsSave > this._statsSaveInterval) {
                const s = this._getDailyScreenTimeSeconds();
                if (s > 0) { this._recordDailyStats(new Date(), s); this._lastStatsSave = now; }
            }

            if (this.menu.isOpen) { this._updateStatsView(); this._updateAppsView(); }
        } catch (e) {
            if (this._label) this._label.text = '—';
        }
    }

    // ── Destroy ───────────────────────────────────────────────────────────────
    destroy() {
        if (this._updateTimer)    { GLib.Source.remove(this._updateTimer);    this._updateTimer    = null; }
        if (this._appTrackTimer)  { GLib.Source.remove(this._appTrackTimer);  this._appTrackTimer  = null; }
        if (this._saveTimeout)    { GLib.Source.remove(this._saveTimeout);    this._saveTimeout    = null; }
        this._settingsChangedIds?.forEach(id => this._settings?.disconnect(id));
        super.destroy();
    }
});

export default class WellbeingExtension extends Extension {
    enable()  { this._indicator = new WellbeingIndicator(this); Main.panel.addToStatusArea(this.uuid, this._indicator); }
    disable() { this._indicator?.destroy(); this._indicator = null; }
}
