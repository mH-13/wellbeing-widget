/* extension.js — Wellbeing Widget (Apple Screen Time Edition)
 * Features: Screen time, per-app tracking, weekly chart, panel position
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
        super._init(0.0, 'Wellbeing Widget', false);
        this._extension = extension;
        this._settings  = extension.getSettings();

        // Screen time
        this._cachedLiveSeconds  = 0;
        this._isLoadingScreenTime = true;
        this._lastRecordedDate   = new Date().toISOString().split('T')[0];
        this._finalizedDays      = new Set();
        this._saveTimeout        = null;
        this._lastStatsSave      = 0;
        this._statsSaveInterval  = 60000;
        this._lastStatsUpdate    = 0;

        // Quote
        this._lastQuoteChange = Date.now();
        this._currentQuote    = null;

        // Per-app tracking — { appName: totalSeconds (float) }
        this._appUsage       = {};
        this._appTrackTimer  = null;
        this._lastAppName    = null;
        this._lastTrackTime  = null;

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

    /* ── Stats persistence ──────────────────────────────────────────── */
    _loadStats() {
        try {
            const raw = this._settings.get_string('statistics-data');
            this._stats = raw ? JSON.parse(raw) : {};
            if (!this._stats.daily)     this._stats.daily     = {};
            if (!this._stats.pomodoros) this._stats.pomodoros = {};
            if (!this._stats.finalized) this._stats.finalized = [];
            this._finalizedDays = new Set(this._stats.finalized);
        } catch (_) {
            this._stats = { daily: {}, pomodoros: {}, finalized: [] };
            this._finalizedDays = new Set();
        }
    }

    _saveStats() {
        if (this._saveTimeout) { GLib.Source.remove(this._saveTimeout); this._saveTimeout = null; }
        this._saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            try {
                this._stats.finalized = [...this._finalizedDays];
                this._settings.set_string('statistics-data', JSON.stringify(this._stats));
            } catch (_) {}
            this._saveTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _recordDailyStats(date, secs) {
        this._stats.daily[date.toISOString().split('T')[0]] = secs;
        this._saveStats();
    }

    /* ── Per-app tracking ───────────────────────────────────────────── */
    _startAppTracking() {
        // Poll every 2 seconds — accumulate time in active app
        this._appTrackTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            try {
                const win = global.display.get_focus_window();
                if (win) {
                    const tracker = Shell.WindowTracker.get_default();
                    const app     = tracker.get_window_app(win);
                    const name    = app ? (app.get_name() || 'Unknown') : win.get_title() || 'Unknown';
                    const now     = Date.now() / 1000;

                    if (this._lastAppName !== null && this._lastTrackTime !== null) {
                        const elapsed = now - this._lastTrackTime;  // seconds since last poll
                        // Only count if same app (no app switch mid-poll)
                        if (this._lastAppName === name && elapsed < 10) {
                            this._appUsage[name] = (this._appUsage[name] || 0) + elapsed;
                        }
                    }
                    this._lastAppName   = name;
                    this._lastTrackTime = now;
                }
            } catch (_) {}
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getTopApps(n = 5) {
        return Object.entries(this._appUsage)
            .sort(([, a], [, b]) => b - a)
            .slice(0, n)
            .map(([name, secs]) => ({ name, secs }));
    }

    _fmt(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    /* ── UI ─────────────────────────────────────────────────────────── */
    _buildUI() {
        /* Panel button */
        this._panelBox = new St.BoxLayout({ style_class: 'wellbeing-panel-box' });
        this._label    = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'wellbeing-panel-label'
        });
        this._panelBox.add_child(this._label);
        this.add_child(this._panelBox);
        this.menu.box.style_class = 'wellbeing-menu';

        /* ── Header ── */
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'wellbeing-header-section'
        });
        const headerBox = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-header-box' });

        /* Title row */
        const titleRow = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-title-row' });
        const clockIcon = new St.Icon({
            icon_name: 'preferences-system-time-symbolic',
            icon_size: 14,
            style_class: 'wellbeing-title-icon'
        });
        const titleLabel = new St.Label({ text: 'Screen Time', style_class: 'wellbeing-title' });
        titleRow.add_child(clockIcon);
        titleRow.add_child(titleLabel);

        /* Big hero number */
        this._heroLabel = new St.Label({ text: '0h 0m', style_class: 'wellbeing-hero-time' });
        this._heroSub   = new St.Label({ text: 'TODAY', style_class: 'wellbeing-hero-sub' });

        /* Quote */
        this._quoteLabel = new St.Label({
            text: this._getQuote(),
            style_class: 'wellbeing-quote'
        });
        this._quoteLabel.clutter_text.line_wrap = true;

        headerBox.add_child(titleRow);
        headerBox.add_child(this._heroLabel);
        headerBox.add_child(this._heroSub);
        headerBox.add_child(this._quoteLabel);
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        /* ── Weekly chart ── */
        this._addSectionLabel('Weekly Overview');
        this._statsGraphItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'wellbeing-card'
        });
        this._statsGraphBox = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-chart-box' });
        this._statsGraphItem.add_child(this._statsGraphBox);
        this.menu.addMenuItem(this._statsGraphItem);

        this._statsSummaryItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'wellbeing-summary-item'
        });
        this._statsSummaryBox = new St.BoxLayout({ vertical: true });
        this._statsSummaryBox.add_child(new St.Label({ text: '…', style_class: 'wellbeing-summary-label' }));
        this._statsSummaryItem.add_child(this._statsSummaryBox);
        this.menu.addMenuItem(this._statsSummaryItem);

        /* ── Most Used Apps ── */
        this._addSectionLabel('Most Used');
        this._appsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'wellbeing-card'
        });
        this._appsBox = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-apps-box' });
        this._appsItem.add_child(this._appsBox);
        this.menu.addMenuItem(this._appsItem);

        /* ── Panel position toggle ── */
        this._addSectionLabel('Panel Position');
        const posItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'wellbeing-pos-item' });
        const posBox  = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-pos-box' });

        const positions = ['left', 'center', 'right'];
        const labels    = ['Left', 'Center', 'Right'];
        this._posBtns   = [];
        const current   = this._settings.get_string('panel-position');

        positions.forEach((pos, i) => {
            const btn = new St.Button({
                label: labels[i],
                style_class: 'wellbeing-pos-btn' + (pos === current ? ' wellbeing-pos-active' : ''),
                x_expand: true
            });
            btn.connect('clicked', () => {
                this._settings.set_string('panel-position', pos);
                this._posBtns.forEach((b, j) => {
                    if (j === i) b.add_style_class_name('wellbeing-pos-active');
                    else         b.remove_style_class_name('wellbeing-pos-active');
                });
                this._extension._repositionIndicator(pos);
            });
            this._posBtns.push(btn);
            posBox.add_child(btn);
        });
        posItem.add_child(posBox);
        this.menu.addMenuItem(posItem);

        /* ── Settings button ── */
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, style_class: 'wellbeing-settings-item' });
        const settingsBox  = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-settings-box', x_expand: true });
        settingsBox.add_child(new St.Icon({ icon_name: 'preferences-system-symbolic', icon_size: 14, style_class: 'wellbeing-settings-icon' }));
        settingsBox.add_child(new St.Label({ text: 'Extension Settings', style_class: 'wellbeing-settings-label', x_expand: true }));
        settingsItem.add_child(settingsBox);
        settingsItem.connect('activate', () => { this._extension.openPreferences(); this.menu.close(); });
        this.menu.addMenuItem(settingsItem);

        /* Menu open → refresh */
        this.menu.connect('open-state-changed', (_m, open) => {
            if (!open) return;
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                const n = Date.now();
                if (n - this._lastStatsUpdate > 8000) {
                    this._updateStatsView();
                    this._updateAppsView();
                    this._lastStatsUpdate = n;
                }
                const s = this._getDailyScreenTimeSeconds();
                if (s > 0) this._recordDailyStats(new Date(), s);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _addSectionLabel(text) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_child(new St.Label({ text, style_class: 'wellbeing-section-header' }));
        this.menu.addMenuItem(item);
    }

    /* ── Apps view ──────────────────────────────────────────────────── */
    _updateAppsView() {
        this._appsBox.destroy_all_children();
        const top = this._getTopApps(5);

        if (top.length === 0) {
            this._appsBox.add_child(new St.Label({
                text: 'Start using apps — data appears here.',
                style_class: 'wellbeing-empty-label'
            }));
            return;
        }

        const max = top[0].secs || 1;
        top.forEach(({ name, secs }, idx) => {
            const row = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-app-row', x_expand: true });

            /* Rank number */
            const rank = new St.Label({ text: `${idx + 1}`, style_class: 'wellbeing-app-rank' });

            /* App name */
            const nameLabel = new St.Label({ text: name, style_class: 'wellbeing-app-name', x_expand: true });
            nameLabel.clutter_text.ellipsize = 3;

            /* Duration */
            const dur = new St.Label({ text: this._fmt(secs), style_class: 'wellbeing-app-dur' });

            row.add_child(rank);
            row.add_child(nameLabel);
            row.add_child(dur);
            this._appsBox.add_child(row);

            /* Progress bar */
            const track = new St.Widget({ style_class: 'wellbeing-bar-track', x_expand: true });
            const fill  = new St.Widget({
                style_class: 'wellbeing-bar-fill',
                width: Math.max(Math.round((secs / max) * 280), 4)
            });
            track.add_child(fill);
            this._appsBox.add_child(track);
        });
    }

    /* ── Stats view ─────────────────────────────────────────────────── */
    _updateStatsView() {
        const data = this._getWeekData();
        this._drawChart(data);
        this._drawSummary(data);
    }

    _getWeekData() {
        const now = new Date();
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(now);
            d.setDate(d.getDate() - (6 - i));
            const s = d.toISOString().split('T')[0];
            return { date: d, screenTime: this._stats.daily[s] || 0 };
        });
    }

    _drawChart(data) {
        this._statsGraphBox.destroy_all_children();
        const max = Math.max(...data.map(d => d.screenTime), 1);

        const wrapper = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });

        /* Shared tooltip */
        const tip  = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-tooltip', visible: false, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START });
        const tipD = new St.Label({ text: '', style_class: 'wellbeing-tip-date' });
        const tipT = new St.Label({ text: '', style_class: 'wellbeing-tip-time' });
        tip.add_child(tipD);
        tip.add_child(tipT);

        const chartRow = new St.BoxLayout({ vertical: false, style_class: 'wellbeing-chart-row', x_expand: true });

        data.forEach(day => {
            const hrs  = day.screenTime / 3600;
            const barH = Math.max(Math.round((day.screenTime / max) * 76), 3);
            let cls = 'wellbeing-bar-green';
            if      (hrs > 8) cls = 'wellbeing-bar-red';
            else if (hrs > 6) cls = 'wellbeing-bar-orange';
            else if (hrs > 4) cls = 'wellbeing-bar-yellow';

            const col = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-bar-col', x_expand: true, x_align: Clutter.ActorAlign.CENTER, reactive: true, track_hover: true });
            const area = new St.BoxLayout({ vertical: true, style_class: 'wellbeing-bar-area', y_expand: true, y_align: Clutter.ActorAlign.END });
            area.add_child(new St.Widget({ style_class: cls, style: `height:${barH}px;width:100%;` }));
            col.add_child(area);
            col.add_child(new St.Label({ text: 'SMTWTFS'[day.date.getDay()], style_class: 'wellbeing-day-label' }));

            const h = Math.floor(day.screenTime / 3600);
            const m = Math.floor((day.screenTime % 3600) / 60);
            col.connect('enter-event', () => {
                col.add_style_class_name('wellbeing-bar-col-hover');
                tipD.text = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                tipT.text = `${h}h ${m}m`;
                tip.visible = true; tip.opacity = 0;
                tip.ease({ opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            });
            col.connect('leave-event', () => {
                col.remove_style_class_name('wellbeing-bar-col-hover');
                tip.ease({ opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_IN_QUAD, onComplete: () => { tip.visible = false; } });
            });
            chartRow.add_child(col);
        });

        wrapper.add_child(chartRow);
        wrapper.add_child(tip);
        this._statsGraphBox.add_child(wrapper);
    }

    _drawSummary(data) {
        this._statsSummaryBox.destroy_all_children();
        const total = data.reduce((s, d) => s + d.screenTime, 0);
        const avg   = data.length ? total / data.length : 0;
        const ah = Math.floor(avg / 3600);
        const am = Math.floor((avg % 3600) / 60);
        this._statsSummaryBox.add_child(new St.Label({
            text: `Daily average  ${ah}h ${am}m`,
            style_class: 'wellbeing-summary-label'
        }));
        const today = data.at(-1);
        if (today?.screenTime > 0) {
            const th = Math.floor(today.screenTime / 3600);
            const tm = Math.floor((today.screenTime % 3600) / 60);
            this._statsSummaryBox.add_child(new St.Label({
                text: `Today  ${th}h ${tm}m`,
                style_class: 'wellbeing-summary-label-today'
            }));
        }
    }

    /* ── Screen time readers ────────────────────────────────────────── */
    _getDailyScreenTimeSeconds() {
        if (this._cachedLiveSeconds > 0) return this._cachedLiveSeconds;
        return this._stats.daily[new Date().toISOString().split('T')[0]] || 0;
    }

    _calcDayTime(hist, targetDate, currentTime) {
        const ms = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime() / 1000;
        const me = ms + 86400;
        let total = 0, start = null;

        let prevState = null;
        for (const e of hist) { if (e.wallTimeSecs < ms) prevState = e.newState; else break; }
        if (prevState === 1) start = ms;

        for (const e of hist) {
            if (e.wallTimeSecs < ms)  continue;
            if (e.wallTimeSecs >= me) break;
            if      (e.newState === 1 && !start) start = e.wallTimeSecs;
            else if (e.newState === 0 && start)  { total += e.wallTimeSecs - start; start = null; }
        }
        if (start) total += (currentTime ?? me) - start;
        return Math.round(total);
    }

    _updateLiveScreenTime() {
        const today = new Date();
        const ts    = today.toISOString().split('T')[0];

        if (ts !== this._lastRecordedDate) {
            if (!this._finalizedDays.has(this._lastRecordedDate)) {
                this._finalizedDays.add(this._lastRecordedDate);
                this._saveStats();
            }
            this._lastRecordedDate = ts;
            this._cachedLiveSeconds = 0;
        }

        const path = `${GLib.get_home_dir()}/.local/share/gnome-shell/session-active-history.json`;
        Gio.File.new_for_path(path).load_contents_async(null, (_f, res) => {
            try {
                const [ok, raw] = _f.load_contents_finish(res);
                if (!ok) { this._isLoadingScreenTime = false; return; }
                const hist = JSON.parse(new TextDecoder().decode(raw));
                const now  = Math.floor(Date.now() / 1000);
                const cb   = new Date();
                const cbs  = cb.toISOString().split('T')[0];
                if (cbs === ts) {
                    const secs = this._calcDayTime(hist, cb, now);
                    this._stats.daily[ts]   = secs;
                    this._cachedLiveSeconds = secs;
                }
                /* Back-fill missing historical days */
                for (let i = 1; i <= 7; i++) {
                    const pd  = new Date(cb); pd.setDate(pd.getDate() - i);
                    const pds = pd.toISOString().split('T')[0];
                    if (!this._finalizedDays.has(pds) && !this._stats.daily[pds])
                        this._stats.daily[pds] = this._calcDayTime(hist, pd, null);
                }
                this._saveStats();
                this._isLoadingScreenTime = false;
            } catch (_) { this._isLoadingScreenTime = false; }
        });
    }

    _getDailyScreenTime() {
        if (this._isLoadingScreenTime && !this._cachedLiveSeconds) return '…';
        const s = this._getDailyScreenTimeSeconds();
        return s > 0 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m` : '0h 0m';
    }

    /* ── Quote ──────────────────────────────────────────────────────── */
    _getQuote() {
        const q = [
            '"Focus is the gateway to excellence"',
            '"Deep work produces deep results"',
            '"Progress over perfection, always"',
            '"Energy follows attention"',
            '"Your attention is your most valuable currency"',
            '"Balance is not found — it is created"',
            '"Rest is not a reward. It is a requirement."',
            '"What gets measured gets managed"',
        ];
        return q[Math.floor(Math.random() * q.length)];
    }

    /* ── Update loop ────────────────────────────────────────────────── */
    _startUpdating() {
        this._updateUI();
        this._updateTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._updateUI();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateUI() {
        try {
            this._updateLiveScreenTime();
            const t = this._getDailyScreenTime();

            /* Panel button label */
            this._label.text = t;

            /* Panel colour by usage hours */
            const hrs = this._getDailyScreenTimeSeconds() / 3600;
            ['wellbeing-panel-box-medium','wellbeing-panel-box-medium-high','wellbeing-panel-box-high']
                .forEach(c => this._panelBox.remove_style_class_name(c));
            if      (hrs > 8) this._panelBox.add_style_class_name('wellbeing-panel-box-high');
            else if (hrs > 6) this._panelBox.add_style_class_name('wellbeing-panel-box-medium-high');
            else if (hrs > 4) this._panelBox.add_style_class_name('wellbeing-panel-box-medium');

            /* Hero label */
            if (this._heroLabel) this._heroLabel.text = t;

            /* Hourly quote rotation */
            const now = Date.now();
            if (!this._currentQuote || now - this._lastQuoteChange > 3600000) {
                this._currentQuote   = this._getQuote();
                this._lastQuoteChange = now;
            }
            if (this._quoteLabel) this._quoteLabel.text = this._currentQuote;

            /* Periodic stats save */
            if (now - this._lastStatsSave > this._statsSaveInterval) {
                const s = this._getDailyScreenTimeSeconds();
                if (s > 0) { this._recordDailyStats(new Date(), s); this._lastStatsSave = now; }
            }

            if (this.menu.isOpen) { this._updateStatsView(); this._updateAppsView(); }
        } catch (_) {
            if (this._label) this._label.text = '—';
        }
    }

    /* ── Destroy ────────────────────────────────────────────────────── */
    destroy() {
        if (this._updateTimer)   { GLib.Source.remove(this._updateTimer);   this._updateTimer   = null; }
        if (this._appTrackTimer) { GLib.Source.remove(this._appTrackTimer); this._appTrackTimer = null; }
        if (this._saveTimeout)   { GLib.Source.remove(this._saveTimeout);   this._saveTimeout   = null; }
        this._settingsChangedIds?.forEach(id => this._settings?.disconnect(id));
        super.destroy();
    }
});

export default class WellbeingExtension extends Extension {
    enable() {
        this._indicator = new WellbeingIndicator(this);
        const pos = this._getSettings().get_string('panel-position');
        this._repositionIndicator(pos);
    }

    _getSettings() {
        return this._indicator._settings;
    }

    _repositionIndicator(pos) {
        /* Remove from wherever it currently is */
        ['left','center','right'].forEach(box => {
            try { Main.panel.statusArea[this.uuid] && Main.panel['_' + box + 'Box'].remove_actor(this._indicator); } catch (_) {}
        });
        /* Re-add to chosen box */
        const box = pos === 'left' ? Main.panel._leftBox
                  : pos === 'center' ? Main.panel._centerBox
                  : Main.panel._rightBox;
        box.insert_child_at_index(this._indicator, pos === 'right' ? -1 : 0);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
