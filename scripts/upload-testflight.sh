#!/bin/bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

verify_source() {
  [[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main &&
     "${GITHUB_REPOSITORY:-}" == thepropervolume/proper-karaoke-booth ]] ||
    fail 'Only a manual dispatch on the Booth main branch can upload to TestFlight.'
  [[ "${RUNNER_OS:-}" == macOS && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] ||
    fail 'Use the ephemeral GitHub-hosted macOS runner for signing.'
  [[ "${TPV_REVIEWED_COMMIT:-}" =~ ^[0-9a-f]{40}$ &&
     "$TPV_REVIEWED_COMMIT" == "${GITHUB_SHA:-}" && "$TPV_REVIEWED_COMMIT" == "$(git rev-parse HEAD)" ]] ||
    fail 'Enter the full SHA of the checked-out main commit after reviewing it.'
  [[ "${TPV_TESTFLIGHT_BUILD_NUMBER:-}" =~ ^[1-9][0-9]{0,3}$ ]] ||
    fail 'Enter an unused build number from 1 to 9999.'
  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] ||
    fail 'The reviewed checkout changed. No app was signed.'

  node scripts/mobile-release.mjs check-store-pair
  local source_build
  source_build="$(node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const project = readFileSync('mobile/ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const builds = [...project.matchAll(/\bCURRENT_PROJECT_VERSION\s*=\s*([1-9]\d{0,3})\s*;/g)].map(match => match[1]);
assert.ok(builds.length === 2 && builds[0] === builds[1], 'Expected one native build number across the checked-in configurations.');
console.log(builds[0]);
NODE
)"
  (( TPV_TESTFLIGHT_BUILD_NUMBER >= source_build )) ||
    fail 'Choose a build number at least as high as the one in the reviewed source.'
}


# Xcode can include signing identifiers in errors. Match fixed categories
# privately so the public job log contains only these checked-in messages.
report_xcode_failure() {
  local stage="$1" log="$2" reported=0
  local pattern message
  while IFS=':' read -r pattern message; do
    if grep -Eiq -- "$pattern" "$log"; then
      printf 'Xcode %s diagnostic - %s\n' "$stage" "$message" >&2
      reported=1
    fi
  done <<'DIAGNOSTICS'
(no devices (are registered|registered|available)|has no devices|there are no devices):Apple reports no eligible devices for development provisioning.
(failed to register bundle identifier|bundle identifier.*is not available):Apple could not access the registered App ID.
(no profiles for|iphoneos.*provisioning profile.*not found|requires a provisioning profile):Xcode could not find a matching provisioning profile.
(failed to create provisioning profile|couldn.t create.*profile):Xcode could not create a provisioning profile.
(no signing certificate|no certificate matching|with a private key was found):Xcode could not find the signing certificate and its private key.
requires a development team:Xcode did not recognize the configured development team.
(insufficient permissions|is not permitted|does not have access|not authorized):Apple denied a signing or upload operation.
(unable to authenticate|authentication failed|invalid api key|invalid issuer):Apple or Xcode rejected the API authentication.
(agreement|contract).*(accept|expired|updated|required):Apple indicated an agreement or contract issue.
(unrecognized option|invalid option|cannot be used together|mutually exclusive):Xcode rejected one or more command options.
(Command CodeSign failed|errSecInternalComponent):Xcode reported a keychain or code-signing error.
ITMS-90[0-9]{3}:Apple rejected binary validation or an upload requirement.
(build number|bundle version).*(higher|previously|duplicate|already):Apple may require an unused build number.
DIAGNOSTICS
  if [[ "$reported" == 0 ]]; then
    printf 'Xcode %s diagnostic - No recognized failure match.\n' "$stage" >&2
  fi
}

verify_archive() {
  local app_bundle="$1/Products/Applications/App.app"
  local plist="$app_bundle/Info.plist"
  [[ -f "$plist" && -f "$app_bundle/App" ]] || fail 'A single iPhoneOS app archive was not built.'

  [[ "$(plutil -extract CFBundleIdentifier raw -o - "$plist")" == com.thepropervolume.karaoke &&
     "$(plutil -extract CFBundlePackageType raw -o - "$plist")" == APPL &&
     "$(plutil -extract CFBundleShortVersionString raw -o - "$plist")" == "$version" &&
     "$(plutil -extract CFBundleVersion raw -o - "$plist")" == "$TPV_TESTFLIGHT_BUILD_NUMBER" &&
     "$(plutil -extract CFBundleSupportedPlatforms.0 raw -o - "$plist")" == iPhoneOS ]] ||
    fail 'The signed archive has unexpected bundle metadata.'

  xcrun lipo -verify_arch arm64 "$app_bundle/App" >"$scratch/architecture.log" 2>&1 &&
    xcrun vtool -show-build "$app_bundle/App" >>"$scratch/architecture.log" 2>&1 &&
    grep -Eq '^[[:space:]]*platform[[:space:]]+(IOS|2)[[:space:]]*$' "$scratch/architecture.log" ||
    fail 'The archive must contain an arm64 iPhoneOS executable.'

  codesign --verify --deep --strict "$app_bundle" >"$scratch/signature.log" 2>&1 &&
    codesign --display --verbose=4 "$app_bundle" >>"$scratch/signature.log" 2>&1 &&
    grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" "$scratch/signature.log" ||
    fail 'The archive does not have a valid signature for the configured Apple team.'
}

upload() {
  [[ "${APPLE_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ && "${ASC_KEY_ID:-}" =~ ^[A-Z0-9]{10}$ &&
     "${ASC_ISSUER_ID:-}" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ &&
     -n "${ASC_PRIVATE_KEY:-}" && "${#ASC_PRIVATE_KEY}" -le 4096 ]] ||
    fail 'Configure the TestFlight environment with the authorized Apple team and all three team API key secrets.'

  # Copy into non-exported shell variables, then remove credentials from the
  # environment before invoking Node, Xcode or any other helper process.
  local supplied_p8="$ASC_PRIVATE_KEY" key_id="$ASC_KEY_ID" issuer_id="$ASC_ISSUER_ID"
  unset ASC_PRIVATE_KEY ASC_KEY_ID ASC_ISSUER_ID

  local version runner_temp scratch
  version="$(node -p "require('./package.json').version")"
  [[ -n "${RUNNER_TEMP:-}" && "${RUNNER_TEMP:-}" == /* ]] || fail 'A private runner temp directory is required.'
  runner_temp="$(cd -P "$RUNNER_TEMP" && pwd)"
  umask 077
  scratch="$(mktemp -d "$runner_temp/tpv-testflight.XXXXXXXX")"
  # Retain only the path to this private scratch directory for the exit trap.
  tpv_testflight_scratch="$scratch"
  trap 'rm -rf -- "$tpv_testflight_scratch"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local auth_key="$scratch/AuthKey_$key_id.p8"
  local archive="$scratch/Booth.xcarchive"
  local export_options="$scratch/ExportOptions.plist"
  printf '%s\n' "${supplied_p8//$'\r'/}" >"$auth_key"
  unset supplied_p8
  chmod 0600 "$auth_key"
  openssl pkey -in "$auth_key" -noout >/dev/null 2>&1 ||
    fail 'The team API private key must be the unmodified Apple .p8 file.'

  xcodebuild -help >"$scratch/xcodebuild-help.txt" 2>&1 || true
  for option in -authenticationKeyPath -authenticationKeyID -authenticationKeyIssuerID -allowProvisioningUpdates app-store-connect testFlightInternalTestingOnly; do
    grep -Fq -- "$option" "$scratch/xcodebuild-help.txt" ||
      fail 'This Xcode does not support the required headless signing or TestFlight export options.'
  done
  local apple_auth=(-allowProvisioningUpdates -authenticationKeyPath "$auth_key"
    -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id")
  xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$archive" -derivedDataPath "$scratch/build" \
    -clonedSourcePackagesDirPath "$RUNNER_TEMP/tpv-testflight-swift" -disableAutomaticPackageResolution \
    -onlyUsePackageVersionsFromResolvedFile -skipPackageUpdates "${apple_auth[@]}" \
    "DEVELOPMENT_TEAM=$APPLE_TEAM_ID" "CURRENT_PROJECT_VERSION=$TPV_TESTFLIGHT_BUILD_NUMBER" \
    CODE_SIGN_STYLE=Automatic archive >"$scratch/archive.log" 2>&1 || {
    report_xcode_failure archive "$scratch/archive.log"
    fail 'Xcode could not sign the archive.'
  }
  verify_archive "$archive"

  plutil -create xml1 "$export_options"
  plutil -insert method -string app-store-connect "$export_options"
  plutil -insert destination -string upload "$export_options"
  plutil -insert signingStyle -string automatic "$export_options"
  plutil -insert teamID -string "$APPLE_TEAM_ID" "$export_options"
  plutil -insert manageAppVersionAndBuildNumber -bool NO "$export_options"
  plutil -insert uploadSymbols -bool YES "$export_options"
  plutil -insert testFlightInternalTestingOnly -bool YES "$export_options"

  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$export_options" \
    -exportPath "$scratch/export" "${apple_auth[@]}" >"$scratch/upload.log" 2>&1 || {
    report_xcode_failure upload "$scratch/upload.log"
    fail 'Xcode did not confirm the upload. Check App Store Connect delivery status before retrying with an unused build number.'
  }

  printf 'Uploaded internal TestFlight build %s (%s) from %s. Wait for Apple to finish processing it.\n' \
    "$version" "$TPV_TESTFLIGHT_BUILD_NUMBER" "$TPV_REVIEWED_COMMIT" | tee -a "$GITHUB_STEP_SUMMARY"
}

cd "$(dirname "${BASH_SOURCE[0]}")/.."
case "${1:-}" in
  verify) verify_source ;;
  upload)
    (unset ASC_PRIVATE_KEY ASC_KEY_ID ASC_ISSUER_ID; verify_source)
    upload
    ;;
  *) fail 'Use verify or upload.' ;;
esac
