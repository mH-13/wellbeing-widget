import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WellbeingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Main preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });

        // Pomodoro Settings Group
        const pomoGroup = new Adw.PreferencesGroup({
            title: 'Pomodoro Timer',
            description: 'Configure your focus sessions'
        });

        // Pomodoro duration
        const pomoDurationRow = new Adw.SpinRow({
            title: 'Focus Session Duration',
            subtitle: 'Length of each Pomodoro in minutes',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 60,
                step_increment: 5,
                value: settings.get_int('pomodoro-duration')
            })
        });
        pomoDurationRow.connect('output', (row) => {
            settings.set_int('pomodoro-duration', row.get_value());
            return true;
        });
        pomoGroup.add(pomoDurationRow);

        // Short break duration
        const shortBreakRow = new Adw.SpinRow({
            title: 'Short Break Duration',
            subtitle: 'Length of breaks between Pomodoros',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 15,
                step_increment: 1,
                value: settings.get_int('short-break-duration')
            })
        });
        shortBreakRow.connect('output', (row) => {
            settings.set_int('short-break-duration', row.get_value());
            return true;
        });
        pomoGroup.add(shortBreakRow);

        // Long break duration
        const longBreakRow = new Adw.SpinRow({
            title: 'Long Break Duration',
            subtitle: 'Length of breaks after 4 Pomodoros',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 30,
                step_increment: 5,
                value: settings.get_int('long-break-duration')
            })
        });
        longBreakRow.connect('output', (row) => {
            settings.set_int('long-break-duration', row.get_value());
            return true;
        });
        pomoGroup.add(longBreakRow);

        page.add(pomoGroup);

        // Alerts Group
        const alertsGroup = new Adw.PreferencesGroup({
            title: 'Notifications & Alerts',
            description: 'Configure how you receive notifications'
        });

        // Sound alerts toggle
        const soundAlertsRow = new Adw.SwitchRow({
            title: 'Sound Alerts',
            subtitle: 'Play sound when Pomodoro completes',
            active: settings.get_boolean('sound-alerts')
        });
        soundAlertsRow.connect('notify::active', (row) => {
            settings.set_boolean('sound-alerts', row.get_active());
        });
        alertsGroup.add(soundAlertsRow);

        // Visual alerts toggle
        const visualAlertsRow = new Adw.SwitchRow({
            title: 'Visual Alerts',
            subtitle: 'Show notifications when Pomodoro completes',
            active: settings.get_boolean('visual-alerts')
        });
        visualAlertsRow.connect('notify::active', (row) => {
            settings.set_boolean('visual-alerts', row.get_active());
        });
        alertsGroup.add(visualAlertsRow);

        // Break reminders toggle
        const breakRemindersRow = new Adw.SwitchRow({
            title: 'Break Reminders',
            subtitle: 'Remind you to take breaks periodically',
            active: settings.get_boolean('break-reminders')
        });
        breakRemindersRow.connect('notify::active', (row) => {
            settings.set_boolean('break-reminders', row.get_active());
        });
        alertsGroup.add(breakRemindersRow);

        // Break interval
        const breakIntervalRow = new Adw.SpinRow({
            title: 'Break Reminder Interval',
            subtitle: 'How often to remind you (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 15,
                upper: 120,
                step_increment: 15,
                value: settings.get_int('break-interval')
            })
        });
        breakIntervalRow.connect('output', (row) => {
            settings.set_int('break-interval', row.get_value());
            return true;
        });
        alertsGroup.add(breakIntervalRow);

        page.add(alertsGroup);

        // Display Group
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Customize the appearance'
        });

        // Show panel icon toggle
        const panelIconRow = new Adw.SwitchRow({
            title: 'Show Panel Icon',
            subtitle: 'Display the widget in the top panel',
            active: settings.get_boolean('show-panel-icon')
        });
        panelIconRow.connect('notify::active', (row) => {
            settings.set_boolean('show-panel-icon', row.get_active());
        });
        displayGroup.add(panelIconRow);

        // Animated Zen bars toggle
        const zenAnimatedRow = new Adw.SwitchRow({
            title: 'Animated Zen Bars',
            subtitle: 'Show animated equalizer when playing Zen Music',
            active: settings.get_boolean('zen-animated-bars')
        });
        zenAnimatedRow.connect('notify::active', (row) => {
            settings.set_boolean('zen-animated-bars', row.get_active());
        });
        displayGroup.add(zenAnimatedRow);

        page.add(displayGroup);

        // Data Management Group
        const dataGroup = new Adw.PreferencesGroup({
            title: 'Data Management',
            description: 'Manage your statistics data'
        });

        // Clear statistics button
        const clearStatsRow = new Adw.ActionRow({
            title: 'Clear Statistics',
            subtitle: 'Delete all recorded screen time and Pomodoro data'
        });

        const clearButton = new Gtk.Button({
            label: 'Clear Data',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        clearButton.connect('clicked', () => {
            const dialog = new Gtk.MessageDialog({
                transient_for: window,
                modal: true,
                buttons: Gtk.ButtonsType.YES_NO,
                message_type: Gtk.MessageType.WARNING,
                text: 'Clear All Statistics?',
                secondary_text: 'This will permanently delete all recorded screen time and Pomodoro data. This action cannot be undone.'
            });

            dialog.connect('response', (dialog, response) => {
                if (response === Gtk.ResponseType.YES) {
                    settings.set_string('statistics-data', '');
                    // Show confirmation
                    const banner = new Adw.Toast({
                        title: 'Statistics cleared successfully',
                        timeout: 3
                    });
                    window.add_toast(banner);
                }
                dialog.destroy();
            });

            dialog.show();
        });

        clearStatsRow.add_suffix(clearButton);
        dataGroup.add(clearStatsRow);

        page.add(dataGroup);

        // About Group
        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
            description: 'Wellbeing Widget information'
        });

        const aboutRow = new Adw.ActionRow({
            title: 'Wellbeing Widget',
            subtitle: 'A mindful screen time and focus tracker for GNOME'
        });

        const versionLabel = new Gtk.Label({
            label: 'v1.0',
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER
        });

        aboutRow.add_suffix(versionLabel);
        aboutGroup.add(aboutRow);

        const githubRow = new Adw.ActionRow({
            title: 'GitHub Repository',
            subtitle: 'Report issues and contribute'
        });

        const githubButton = new Gtk.LinkButton({
            label: 'View on GitHub',
            uri: 'https://github.com/mH-13/wellbeing-widget',
            valign: Gtk.Align.CENTER
        });

        githubRow.add_suffix(githubButton);
        aboutGroup.add(githubRow);

        page.add(aboutGroup);

        window.add(page);
    }
}
