# 🔨 Build Instructions

Developer guide for building and contributing to Wellbeing Widget.

---

## Prerequisites

### System Requirements

- **GNOME Shell**: 45 or higher
- **GJS**: GNOME JavaScript bindings
- **glib-compile-schemas**: For schema compilation
- **git**: For version control
- **mpv**: (Optional) For zen music feature

### Install Development Tools

```bash
# Fedora / RHEL
sudo dnf install gnome-shell-extension-tool glib2-devel git mpv

# Ubuntu / Debian
sudo apt install gnome-shell-extensions glib-2.0-dev git mpv

# Arch Linux
sudo pacman -S gnome-shell git mpv
```

---

## Building from Source

### 1. Clone the Repository

```bash
git clone https://github.com/mH-13/wellbeing-widget.git
cd wellbeing-widget
```

### 2. Install to Extensions Directory

```bash
# Create extension directory if it doesn't exist
mkdir -p ~/.local/share/gnome-shell/extensions/screentime@mehedi.io

# Copy all files
cp -r * ~/.local/share/gnome-shell/extensions/screentime@mehedi.io/

# Navigate to extension directory
cd ~/.local/share/gnome-shell/extensions/screentime@mehedi.io
```

### 3. Compile Schemas

```bash
glib-compile-schemas schemas/
```

This generates `schemas/gschemas.compiled` which is required for GSettings.

### 4. Enable Extension

```bash
# Enable the extension
gnome-extensions enable screentime@mehedi.io
```

### 5. Restart GNOME Shell

**X11 Session:**
```bash
# Press Alt+F2, type 'r', press Enter
```

**Wayland Session:**
```bash
# Logout and login again
```

---

## Development Setup

### Quick Reload During Development

Instead of logging out, use this command to quickly reload:

```bash
gnome-extensions disable screentime@mehedi.io && sleep 1 && gnome-extensions enable screentime@mehedi.io
```

### Symlink for Live Development

For easier development, symlink instead of copying:

```bash
# From your git repository
ln -sf $(pwd) ~/.local/share/gnome-shell/extensions/screentime@mehedi.io
```

Now any changes you make are immediately reflected (after reload).

### Watch Logs in Real-Time

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "wellbeing\|screentime"
```

This shows extension logs and errors in real-time.

---

## Project Structure

```
screentime@mehedi.io/
├── extension.js          # Main extension logic
├── prefs.js              # Preferences UI (GTK4)
├── stylesheet.css        # All styling
├── metadata.json         # Extension metadata
├── schemas/              # GSettings schemas
│   └── org.gnome.shell.extensions.wellbeing.gschema.xml
├── README.md             # User documentation
├── BUILD.md              # This file
├── LICENSE               # GPL-2.0
└── image.png             # Screenshot
```

---

## Testing

### Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Panel indicator shows and updates screen time
- [ ] Dropdown menu opens and displays all sections
- [ ] Focus timer counts down correctly
- [ ] Music player starts/stops (if mpv installed)
- [ ] Statistics graph displays with hover tooltips
- [ ] Preferences panel opens and saves settings
- [ ] Extension survives GNOME Shell restart
- [ ] No errors in `journalctl` logs

### Check Extension Status

```bash
gnome-extensions info screentime@mehedi.io
```

Should show:
```
State: ACTIVE
```

### View GSettings Values

```bash
# List all keys
gsettings list-keys org.gnome.shell.extensions.wellbeing

# Get a specific value
gsettings get org.gnome.shell.extensions.wellbeing pomodoro-duration

# Set a value
gsettings set org.gnome.shell.extensions.wellbeing pomodoro-duration 30
```

---

## Making Changes

### Code Style

- **Indentation**: 4 spaces (no tabs)
- **Naming**: camelCase for methods, `_privateMethod` for internal functions
- **Comments**: Clear, concise explanations for complex logic
- **ES6**: Use modern JavaScript features (arrow functions, const/let, template literals)

### Modifying UI

1. Edit `extension.js` for structure and logic
2. Edit `stylesheet.css` for styling
3. Compile schemas if you add new settings: `glib-compile-schemas schemas/`
4. Reload extension to see changes

### Adding New Settings

1. Add key to `schemas/org.gnome.shell.extensions.wellbeing.gschema.xml`
2. Compile: `glib-compile-schemas schemas/`
3. Add UI control in `prefs.js`
4. Access in `extension.js`: `this._settings.get_*(key-name)`

---

## Packaging for Release

### Create Release Archive

```bash
# From extension directory
cd ~/.local/share/gnome-shell/extensions/screentime@mehedi.io

# Create zip for GNOME Extensions website
zip -r wellbeing-widget.zip \
  extension.js \
  prefs.js \
  lib/ \
  stylesheet.css \
  metadata.json \
  schemas/ \
  LICENSE \
  README.md \
  -x "*.git*" -x "*.cache*" -x "*~" -x "schemas/gschemas.compiled"
```

### Validate Extension

```bash
# Check for common issues
gnome-extensions pack --force \
  --extra-source=prefs.js \
  --extra-source=stylesheet.css \
  --extra-source=README.md \
  --extra-source=LICENSE
```

---

## Submitting to GNOME Extensions

### Prerequisites

1. Account on [extensions.gnome.org](https://extensions.gnome.org)
2. Extension tested on multiple GNOME versions
3. Screenshots prepared (1280x720 recommended)
4. Unique UUID in `metadata.json`

### Submission Steps

1. **Login** to extensions.gnome.org
2. **Upload** your `.zip` file
3. **Add metadata**:
   - Name: Wellbeing Widget
   - Description: Mindful screen time tracking and Pomodoro timer with zen aesthetic
   - URL: https://github.com/mH-13/wellbeing-widget
   - Icon/Screenshot: Upload image.png
4. **Version info**:
   - shell-version: ["45", "46", "47", "48", "49"]
   - version: 1 (increment for updates)
5. **Submit for review**

### Update Checklist Before Submission

- [ ] metadata.json has correct GNOME Shell versions
- [ ] All dependencies documented in README
- [ ] Screenshots are up-to-date
- [ ] No hardcoded paths (use GLib.get_home_dir())
- [ ] Clean `git status` (no uncommitted changes)
- [ ] Version number incremented
- [ ] CHANGELOG.md updated (if exists)

---

## Debugging

### Common Issues

**Extension doesn't load:**
```bash
# Check for syntax errors
gjs extension.js
# View detailed logs
journalctl -f /usr/bin/gnome-shell
```

**Settings don't save:**
```bash
# Recompile schemas
cd ~/.local/share/gnome-shell/extensions/screentime@mehedi.io
glib-compile-schemas schemas/
```

**UI doesn't update:**
```bash
# Clear cache
rm -rf ~/.cache/gnome-shell/*
# Restart GNOME Shell
```

---

## Contributing

### Fork & Pull Request Workflow

1. **Fork** the repository on GitHub
2. **Clone** your fork
3. **Create** a feature branch: `git checkout -b feature/my-feature`
4. **Make** your changes
5. **Test** thoroughly (see Testing checklist)
6. **Commit** with clear messages: `git commit -m "feat: add my feature"`
7. **Push**: `git push origin feature/my-feature`
8. **Open** a Pull Request on GitHub

### Commit Message Convention

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting)
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

---

## Resources

- [GNOME Shell Extensions Guide](https://gjs.guide/extensions/)
- [GJS Documentation](https://gjs-docs.gnome.org/)
- [St (Shell Toolkit) API](https://gjs-docs.gnome.org/st13/)
- [GNOME HIG](https://developer.gnome.org/hig/)
- [Extension Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)

---

## Questions?

- **Issues**: https://github.com/mH-13/wellbeing-widget/issues
- **Discussions**: https://github.com/mH-13/wellbeing-widget/discussions
- **Email**: (your email if you want to provide)

---

**Happy coding! 🌿**
