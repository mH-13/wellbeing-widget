# Wellbeing Widget

A mindful productivity companion for GNOME Shell. Screen time tracking, Pomodoro focus timer, weekly stats, and ambient zen music — all from a single panel widget.

[![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-4A86CF.svg)](https://extensions.gnome.org/extension/8842/wellbeing-widget/)
[![License](https://img.shields.io/badge/License-GPL--2.0-8F9C8A.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624.svg)]()

![Wellbeing Widget Screenshot](image.png)


## Features

### Screen Time Tracking
Reads GNOME's native session history for accurate, privacy-respecting usage data. Nothing leaves your machine.

- Real-time tracking with 5-second update intervals
- Color-coded weekly bar graph (green → red by usage)
- Hover tooltips on each bar showing date, time, and pomodoro count
- Historical data finalized at midnight — no recalculation drift
- Crash-aware accuracy: powered-off time is never counted as screen time,
  even after unclean shutdowns — a [known GNOME bug](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/8289)
  that affects GNOME's own Wellbeing panel

### Focus Sessions (Pomodoro Timer)
Inline duration controls (15/25/45/60 min), progress bar in the panel, and sound/visual alerts on completion.

- One-second precision countdown
- Configurable short and long break durations
- Session count tracked daily and weekly
- Live settings — change duration mid-session without restarting

### Zen Music Player
Lofi music streaming via `mpv` with an animated equalizer in the panel. Automatically falls back across 3 streams if one fails.

- 3-bar Unicode equalizer animation
- Auto-retry on stream failure
- Requires `mpv` (optional dependency — see below)

### Weekly Statistics
Interactive bar graph of the last 7 days with hover tooltips and pomodoro session dots.

- Smooth fade animations
- Color-coded bars by usage level
- Accurate historical data that never gets recalculated once finalized


## Installation

### From GNOME Extensions

Visit [extensions.gnome.org/extension/8842](https://extensions.gnome.org/extension/8842/wellbeing-widget/), toggle it on, and you're done.

### Manual

```bash
git clone https://github.com/mH-13/wellbeing-widget.git
cp -r wellbeing-widget ~/.local/share/gnome-shell/extensions/screentime@mehedi.io
glib-compile-schemas ~/.local/share/gnome-shell/extensions/screentime@mehedi.io/schemas/
```

Then enable via Extensions app or:
```bash
gnome-extensions enable screentime@mehedi.io
```


## Zen Music (Optional)

Requires `mpv`:

```bash
# Fedora / RHEL
sudo dnf install mpv

# Ubuntu / Debian
sudo apt install mpv

# Arch
sudo pacman -S mpv

# openSUSE
sudo zypper install mpv
```


## Usage

### Panel Label

| State | Display |
|-------|---------|
| Idle | `4h 23m` |
| Timer running | `4h 23m  🍅 24:35` |
| Timer paused | `4h 23m  ⏸ 24:35` |
| Music playing | `4h 23m  ▇▅▃ Zen` |

### Dropdown Menu

1. **Header** — hourly rotating motivational quote
2. **Weekly Overview** — interactive graph, hover for details
3. **Statistics** — daily averages and totals
4. **Focus Session** — duration picker and start/stop controls
5. **Zen Music** — play/stop streaming
6. **Break Reminders** — toggle periodic break notifications
7. **Settings** — quick access to preferences


## Configuration

Open via Extensions app or:

```bash
gnome-extensions prefs screentime@mehedi.io
```

- Pomodoro duration (5–60 min)
- Short and long break durations
- Sound and visual alerts
- Break reminder interval
- Show/hide panel icon
- Clear all statistics


## Troubleshooting

**Extension not showing in panel**
```bash
gnome-extensions enable screentime@mehedi.io
# If still missing, log out and back in
```

**Music doesn't start**
```bash
which mpv  # Should return /usr/bin/mpv
```

**Statistics show "No data"**
Screen time data accumulates from active sessions. Leave it running — data appears within the first session.

**Extension shows ERROR**
```bash
gnome-extensions disable screentime@mehedi.io
gnome-extensions enable screentime@mehedi.io
# Check logs: journalctl -f -o cat /usr/bin/gnome-shell
```


## Requirements

| | |
|---|---|
| GNOME Shell | 45, 46, 47, 48, 49, 50 |
| Platform | Linux |
| Optional | `mpv` for zen music |


## Contributing

Issues and pull requests are welcome. Check the [issue tracker](https://github.com/mH-13/wellbeing-widget/issues) for open bugs or feature requests.

Changes to the screen-time math must keep the unit tests green:

```bash
gjs -m tests/test-screen-time.js
```


## License

GNU General Public License v2.0 or later. See [LICENSE](LICENSE).


---

<div align="center">

**[Install](https://extensions.gnome.org/extension/8842/wellbeing-widget/)** • **[Report Bug](https://github.com/mH-13/wellbeing-widget/issues)** • **[GitHub](https://github.com/mH-13/wellbeing-widget)**

</div>
