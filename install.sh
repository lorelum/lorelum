#!/bin/sh

set -eu

repository='https://github.com/lorelum/lorelum'
release_base="${LORELUM_INSTALL_RELEASE_BASE_URL:-$repository/releases/download}"
install_root="${LORELUM_INSTALL_ROOT:-$HOME/.local/share/lorelum}"
bin_directory="${LORELUM_INSTALL_BIN_DIR:-$HOME/.local/bin}"
temporary=''

fail() {
  printf '%s\n' "lore install: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$temporary" ] && [ -d "$temporary" ]; then
    rm -rf "$temporary"
  fi
}

usage() {
  cat <<'EOF'
Usage: install.sh --version <version>

Install one published Lorelum CLI version for macOS arm64.
The script downloads a release archive and SHA256SUMS, verifies both before
extracting, then atomically creates ~/.local/bin/lore.
EOF
}

version=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || fail '--version requires a value'
      version="$2"
      shift 2
      ;;
    --version=*)
      version="${1#--version=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "$version" ] || fail 'a release version is required; use --version <version>'
version="${version#v}"
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)*$' ||
  fail "invalid version: $version"

[ "$(uname -s)" = 'Darwin' ] || fail 'only macOS arm64 is currently supported'
[ "$(uname -m)" = 'arm64' ] || fail 'only macOS arm64 is currently supported'
command -v tar >/dev/null 2>&1 || fail 'tar is required to extract the release archive'
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  fail "curl or wget is required; download the release archive manually from $repository/releases"
fi
if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
  fail 'shasum or sha256sum is required to verify the release archive'
fi

target='darwin-arm64'
archive_name="lore-$version-$target.tar.gz"
package_name="lore-$version-$target"
archive_url="$release_base/v$version/$archive_name"
checksums_url="$release_base/v$version/SHA256SUMS"
destination="$install_root/versions/$version"
command_path="$bin_directory/lore"

mkdir -p "$install_root" "$bin_directory"
temporary="$(mktemp -d "$install_root/.lore-install.XXXXXX")"
trap cleanup EXIT HUP INT TERM

download() {
  url="$1"
  output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error --output "$output" "$url"
  else
    wget --quiet --output-document "$output" "$url"
  fi
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

download "$archive_url" "$temporary/$archive_name" || fail "cannot download $archive_url"
download "$checksums_url" "$temporary/SHA256SUMS" || fail "cannot download $checksums_url"

expected_hashes="$(awk -v file="$archive_name" '$2 == file { print $1 }' "$temporary/SHA256SUMS")"
set -- $expected_hashes
[ "$#" -eq 1 ] || fail "SHA256SUMS must contain exactly one digest for $archive_name"
printf '%s' "$1" | grep -Eq '^[0-9a-f]{64}$' ||
  fail "SHA256SUMS contains an invalid digest for $archive_name"
[ "$(sha256 "$temporary/$archive_name")" = "$1" ] || fail 'archive checksum does not match SHA256SUMS'

tar -tzf "$temporary/$archive_name" >"$temporary/archive-list" || fail 'archive cannot be listed'
while IFS= read -r entry; do
  case "$entry" in
    "$package_name"/*) ;;
    *) fail 'archive contains an unexpected root path' ;;
  esac
  case "$entry" in
    /*|*'/../'*|../*) fail 'archive contains an unsafe path' ;;
  esac
done <"$temporary/archive-list"

mkdir "$temporary/extracted"
tar -xzf "$temporary/$archive_name" -C "$temporary/extracted" || fail 'archive extraction failed'
package_directory="$temporary/extracted/$package_name"
[ -d "$package_directory" ] || fail 'archive package root is missing'
[ -x "$package_directory/lore" ] || fail 'archive CLI executable is missing'
[ -f "$package_directory/LICENSE" ] || fail 'archive LICENSE is missing'
[ -f "$package_directory/THIRD_PARTY_NOTICES.txt" ] || fail 'archive third-party notices are missing'
[ -x "$package_directory/native/$target/llama-server" ] || fail 'archive native executable is missing'
[ -f "$package_directory/native/$target/manifest.json" ] || fail 'archive native manifest is missing'
first_link="$(find "$package_directory" -type l -print -quit)"
[ -z "$first_link" ] || fail 'archive must not contain symbolic links'

if [ -e "$command_path" ] || [ -L "$command_path" ]; then
  [ -L "$command_path" ] || fail "existing command is not managed by Lorelum: $command_path"
  current_target="$(readlink "$command_path" || true)"
  case "$current_target" in
    "$install_root"/versions/*/lore) ;;
    *) fail "existing command is not managed by Lorelum: $command_path" ;;
  esac
fi

if [ -e "$destination" ] || [ -L "$destination" ]; then
  [ -d "$destination" ] || fail "existing version path is not a directory: $destination"
  cmp -s "$package_directory/lore" "$destination/lore" ||
    fail "existing version differs from the verified archive: $version"
else
  mkdir -p "$install_root/versions"
  mv "$package_directory" "$destination"
fi

temporary_link="$bin_directory/.lore-install-$$"
ln -s "$destination/lore" "$temporary_link"
mv -f "$temporary_link" "$command_path"

printf 'Installed lore %s to %s\n' "$version" "$destination"
case ":${PATH:-}:" in
  *":$bin_directory:"*) ;;
  *) printf 'Add %s to PATH to run lore from a new shell.\n' "$bin_directory" ;;
esac
