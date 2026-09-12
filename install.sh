#!/bin/sh
# Local: sh /path/to/zoom-voice/install.sh
# Hosted: curl -fsSL https://YOUR-HOST/install.sh | sh
# For hosted use, publish the bundle and pin its URL and SHA256 below.
set -eu
BUNDLE_URL=''
BUNDLE_SHA256=''
DRIVER_URL='https://existential.audio/downloads/BlackHole2ch-0.7.1.pkg'
DRIVER_SHA256='57b540f27a3e29c37e310e01bee0fdfab76733087e47f997ef9dccf851400dcf'

fail() { printf '\nSetup failed: %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail 'This prototype supports macOS only.'
[ "$(id -u)" -ne 0 ] || fail 'Run as your normal user; setup requests sudo only for the audio driver.'
task_tmp=$(mktemp -d /tmp/zoom-voice-install.XXXXXX)
trap 'rm -f "$task_tmp/BlackHole.pkg" "$task_tmp/bundle.zip"; rmdir "$task_tmp" 2>/dev/null || true' EXIT
verify() {
  actual=$(shasum -a 256 "$1" | awk '{print $1}')
  [ "$actual" = "$2" ] || fail "Checksum mismatch for $1. Nothing from this download was installed."
}

source_dir=''
if [ -f "$0" ]; then
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  if [ -f "$script_dir/extension/manifest.json" ]; then source_dir="$script_dir"; fi
fi
if [ -z "$source_dir" ]; then
  [ -n "$BUNDLE_URL" ] && [ -n "$BUNDLE_SHA256" ] || fail 'Hosted bundle not configured yet. Run the downloaded install.sh from its zoom-voice folder.'
  printf 'Downloading extension and on-device models (about 800 MB)…\n'
  curl --fail --location --show-error --proto '=https' --proto-redir '=https' "$BUNDLE_URL" -o "$task_tmp/bundle.zip"
  verify "$task_tmp/bundle.zip" "$BUNDLE_SHA256"
  task_install_root="$HOME/Library/Application Support/Zoom Voice"
  mkdir -p "$task_install_root"
  # A fresh version directory preserves any existing installation.
  source_dir=$(mktemp -d "$task_install_root/release.XXXXXX")
  ditto -x -k "$task_tmp/bundle.zip" "$source_dir"
  [ -f "$source_dir/extension/manifest.json" ] || fail 'Bundle must contain extension/manifest.json at its root.'
fi

if [ -d /Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver ]; then
  printf 'BlackHole 2ch is already installed.\n'
else
  printf 'Downloading BlackHole 2ch 0.7.1…\n'
  curl --fail --location --show-error --proto '=https' --proto-redir '=https' "$DRIVER_URL" -o "$task_tmp/BlackHole.pkg"
  verify "$task_tmp/BlackHole.pkg" "$DRIVER_SHA256"
  pkgutil --check-signature "$task_tmp/BlackHole.pkg" || fail 'Driver signature verification failed.'
  [ -r /dev/tty ] || fail 'Run this command in an interactive Terminal for the macOS password prompt.'
  printf '\nInstalling the audio driver. Enter your Mac login password when asked.\n'
  sudo /usr/sbin/installer -pkg "$task_tmp/BlackHole.pkg" -target / </dev/tty
fi

# Also repairs an earlier installation whose driver has not loaded yet.
audio_has_blackhole() {
  /usr/sbin/system_profiler SPAudioDataType 2>/dev/null | /usr/bin/grep -q 'BlackHole 2ch'
}
if ! audio_has_blackhole; then
  printf '\nActivating BlackHole: restarting the macOS audio service.\nAll microphone/speaker audio will briefly stop, including meeting audio.\n'
  if [ -r /dev/tty ] && sudo /usr/bin/killall coreaudiod </dev/tty; then
    task_attempt=0
    while [ "$task_attempt" -lt 5 ]; do
      if audio_has_blackhole; then break; fi
      task_attempt=$((task_attempt + 1))
      sleep 1
    done
  else
    printf 'Could not restart the audio service automatically.\n'
  fi
fi
if audio_has_blackhole; then
  printf 'BlackHole is available. No full Mac restart needed.\n'
else
  printf 'BlackHole is installed but still unavailable. Restart your Mac to activate it.\n'
fi

printf '\nSetup files ready.\n1. Reopen Chrome if BlackHole is missing from its device list.\n2. Open chrome://extensions → Developer mode → Load unpacked.\n   Select: %s/extension\n3. In Zoom select BlackHole 2ch as microphone; keep speakers on headphones.\n4. Click the extension on the Zoom tab → Connect BlackHole → Play bundled test phrase.\n' "$source_dir"
open "$source_dir/extension"
printf '\nThe extension folder must stay in place after loading it.\n'
