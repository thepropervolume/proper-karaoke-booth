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

  local widget="$app_bundle/PlugIns/RoomLiveActivity.appex"
  if [[ "$widget_expected" == yes ]]; then
    local widget_plist="$widget/Info.plist"
    [[ -f "$widget_plist" && -f "$widget/RoomLiveActivity" &&
       "$(plutil -extract CFBundleIdentifier raw -o - "$widget_plist")" == com.thepropervolume.karaoke.liveactivity &&
       "$(plutil -extract CFBundleShortVersionString raw -o - "$widget_plist")" == "$version" &&
       "$(plutil -extract CFBundleVersion raw -o - "$widget_plist")" == "$TPV_TESTFLIGHT_BUILD_NUMBER" &&
       "$(plutil -extract NSExtension.NSExtensionPointIdentifier raw -o - "$widget_plist")" == com.apple.widgetkit-extension ]] ||
      fail 'The signed archive is missing the expected WidgetKit extension or its matching version.'
    xcrun lipo -verify_arch arm64 "$widget/RoomLiveActivity" >"$scratch/widget-architecture.log" 2>&1 &&
      xcrun vtool -show-build "$widget/RoomLiveActivity" >>"$scratch/widget-architecture.log" 2>&1 &&
      grep -Eq '^[[:space:]]*platform[[:space:]]+(IOS|2)[[:space:]]*$' "$scratch/widget-architecture.log" &&
      codesign --display --verbose=4 "$widget" >"$scratch/widget-signature.log" 2>&1 &&
      grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" "$scratch/widget-signature.log" ||
      fail 'The WidgetKit extension must be an arm64 iPhoneOS product signed by the configured Apple team.'
  elif [[ -e "$widget" || -L "$widget" ]]; then
    fail 'The signed archive unexpectedly includes the Live Activity extension.'
  fi
}

cleanup_upload() {
  if [[ -n "$tpv_installed_profile" ]]; then
    rm -f -- "$tpv_installed_profile" || true
  fi
  if [[ -n "$tpv_installed_widget_profile" ]]; then
    rm -f -- "$tpv_installed_widget_profile" || true
  fi
  if [[ -n "$tpv_signing_keychain" ]]; then
    if [[ "${#tpv_prior_keychains[@]}" -gt 0 ]]; then
      security list-keychains -d user -s "${tpv_prior_keychains[@]}" >/dev/null 2>&1 || true
    fi
    security delete-keychain "$tpv_signing_keychain" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$tpv_testflight_scratch"
}

install_distribution_identity() {
  local certificate="$1" keychain_password pkcs12_password listed
  local keychain="$scratch/distribution.keychain-db"

  # Keep the original order, including keychain paths with spaces.
  security list-keychains -d user >"$scratch/keychains.txt" 2>"$scratch/keychain.log" ||
    fail 'The runner keychain search list could not be read.'
  while IFS= read -r listed; do
    [[ "$listed" =~ ^[[:space:]]*\"(/[^\"[:cntrl:]]+)\"[[:space:]]*$ ]] ||
      fail 'The runner keychain search list was not recognized.'
    tpv_prior_keychains+=("${BASH_REMATCH[1]}")
  done <"$scratch/keychains.txt"
  [[ "${#tpv_prior_keychains[@]}" -gt 0 ]] ||
    fail 'The runner did not have a restorable keychain search list.'

  keychain_password="$(openssl rand -hex 32 2>"$scratch/keychain.log")" &&
    [[ -n "$keychain_password" ]] || fail 'The temporary signing keychain password could not be prepared.'
  if [[ -n "$reusable_certificate_id" ]]; then
    pkcs12_password="$supplied_p12_password"
  else
    pkcs12_password="$(openssl rand -hex 32 2>>"$scratch/keychain.log")" &&
      openssl x509 -inform DER -in "$certificate" -out "$scratch/distribution.pem" \
        >>"$scratch/keychain.log" 2>&1 &&
      openssl pkcs12 -export -inkey "$scratch/signing.key" -in "$scratch/distribution.pem" \
        -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
        -out "$scratch/signing.p12" -passout "pass:$pkcs12_password" >>"$scratch/keychain.log" 2>&1 ||
      fail 'The temporary distribution signing package could not be prepared.'
  fi

  tpv_signing_keychain="$keychain"
  {
    security create-keychain -p "$keychain_password" "$keychain" &&
      security set-keychain-settings -lut 43200 "$keychain" &&
      security unlock-keychain -p "$keychain_password" "$keychain" &&
      security import "$scratch/signing.p12" -P "$pkcs12_password" -f pkcs12 -k "$keychain" \
        -T /usr/bin/codesign &&
      security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" &&
      security list-keychains -d user -s "$keychain" "${tpv_prior_keychains[@]}"
  } >>"$scratch/keychain.log" 2>&1 ||
    fail 'The temporary keychain could not be prepared for code signing.'
  unset keychain_password pkcs12_password

  # Compare the leaf certificate fingerprint with the valid identity in the temporary keychain.
  manual_identity="$(openssl x509 -inform DER -in "$certificate" -noout -fingerprint -sha1 \
    2>>"$scratch/keychain.log")" ||
    fail 'The distribution certificate fingerprint could not be read.'
  manual_identity="${manual_identity#*=}"
  manual_identity="${manual_identity//:/}"
  if [[ ! "$manual_identity" =~ ^[A-F0-9]{40}$ ]] ||
    ! security find-identity -v -p codesigning "$keychain" >"$scratch/identities.txt" 2>>"$scratch/keychain.log" ||
    ! grep -Fq -- "$manual_identity" "$scratch/identities.txt"; then
    fail 'The runner does not trust the temporary distribution certificate or its signing key is missing.'
  fi
}

install_distribution_profiles() {
  local profile_directory="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  mkdir -p -- "$profile_directory" >>"$scratch/keychain.log" 2>&1 ||
    fail 'The Xcode provisioning profile directory could not be prepared.'
  local app_path="$profile_directory/$manual_profile_uuid.mobileprovision"
  install_distribution_profile "$scratch/booth.mobileprovision" "$app_path"
  tpv_installed_profile="$app_path"
  if [[ "$widget_expected" == yes ]]; then
    local widget_path="$profile_directory/$manual_widget_profile_uuid.mobileprovision"
    install_distribution_profile "$scratch/widget.mobileprovision" "$widget_path"
    tpv_installed_widget_profile="$widget_path"
  fi
}

install_distribution_profile() {
  local profile="$1" profile_path="$2"
  [[ ! -e "$profile_path" && ! -L "$profile_path" ]] ||
    fail 'A profile with the new UUID is already installed.'
  # noclobber prevents accidental replacement of an existing profile.
  (
    set -o noclobber
    exec 3>"$profile_path" || exit 1
    if ! cat "$profile" >&3; then
      rm -f -- "$profile_path"
      exit 1
    fi
  ) 2>>"$scratch/keychain.log" || fail 'The temporary distribution profile could not be installed.'
}

prepare_reusable_signing_package() {
  # Do not send the protected PKCS#12 or password to the Apple API.
  printf '%s' "$supplied_p12" | node --input-type=commonjs -e '
const { readFileSync, writeFileSync } = require("node:fs");
const input = readFileSync(0, "utf8");
const bytes = Buffer.from(input, "base64");
if (bytes.length < 512 || bytes.length > 24 * 1024 || bytes.toString("base64") !== input) process.exit(1);
writeFileSync(process.argv[1], bytes, { mode: 0o600, flag: "wx" });
' "$scratch/signing.p12" >"$scratch/reusable.log" 2>&1 ||
    fail 'The reusable PKCS#12 must be canonical Base64 in the protected environment.'
  unset supplied_p12
  printf '%s\n' "$supplied_p12_password" | openssl pkcs12 -in "$scratch/signing.p12" -clcerts -nokeys -passin stdin \
    -out "$scratch/provided-distribution.pem" >>"$scratch/reusable.log" 2>&1 &&
    [[ "$(grep -c '^-----BEGIN CERTIFICATE-----$' "$scratch/provided-distribution.pem")" == 1 ]] &&
    openssl x509 -in "$scratch/provided-distribution.pem" -outform DER \
      -out "$scratch/provided-distribution.cer" >>"$scratch/reusable.log" 2>&1 ||
    fail 'The reusable PKCS#12 must contain exactly one readable signing certificate.'
}

prepare_distribution_signing() {
  [[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]{0,19}$ &&
     "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]{0,5}$ ]] ||
    fail 'The temporary distribution signing assets need a valid GitHub run identity.'
  manual_profile_name="Booth TestFlight CI $GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  local provisioning_args=(create "$scratch" "$auth_key" "$key_id" "$issuer_id" "$APPLE_TEAM_ID" "$manual_profile_name")
  if [[ "$widget_expected" == yes ]]; then
    manual_widget_profile_name="$manual_profile_name Live Activity"
    provisioning_args+=("$manual_widget_profile_name")
  fi

  if [[ -n "$reusable_certificate_id" ]]; then
    prepare_reusable_signing_package
    install_distribution_identity "$scratch/provided-distribution.cer"
    provisioning_args+=(--certificate-id "$reusable_certificate_id")
  else
    # A bootstrap private key exists only in this runner’s private scratch.
    openssl req -new -newkey rsa:2048 -nodes -sha256 -subj '/CN=Booth TestFlight CI' \
      -keyout "$scratch/signing.key" -out "$scratch/signing.csr" >"$scratch/request.log" 2>&1 ||
      fail 'A temporary distribution certificate request could not be created.'
  fi
  node scripts/provision-testflight.mjs "${provisioning_args[@]}" ||
    fail 'Apple could not verify distribution signing and provision all required profiles for this run.'
  manual_profile_uuid="$(node -p 'require(process.argv[1]).profileUuid' "$scratch/provisioning.json" \
    2>>"$scratch/request.log")" ||
    fail 'The temporary provisioning profile identity could not be read.'
  [[ "$manual_profile_uuid" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] ||
    fail 'The temporary provisioning profile UUID is invalid.'
  if [[ "$widget_expected" == yes ]]; then
    manual_widget_profile_uuid="$(node -p 'require(process.argv[1]).widgetProfileUuid' "$scratch/provisioning.json" \
      2>>"$scratch/request.log")" || fail 'The WidgetKit provisioning profile identity could not be read.'
    [[ "$manual_widget_profile_uuid" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ &&
       "$manual_widget_profile_uuid" != "$manual_profile_uuid" ]] ||
      fail 'The WidgetKit extension needs a distinct provisioning profile UUID.'
  fi
  if [[ -z "$reusable_certificate_id" ]]; then
    install_distribution_identity "$scratch/distribution.cer"
  fi
  install_distribution_profiles
  unset supplied_p12_password
}

verify_distribution_bundle() {
  local bundle="$1" bundle_id="$2" expected_uuid="$3" verified_path="$4"
  # Inspect the actual Xcode archive using private, separate paths for the two signing leaves.
  mkdir -- "$verified_path" || fail 'Private distribution verification storage is unavailable.'
  {
    security cms -D -i "$bundle/embedded.mobileprovision" -o "$verified_path/profile.plist" &&
      [[ "$(plutil -extract UUID raw -o - "$verified_path/profile.plist")" == "$expected_uuid" &&
         "$(plutil -extract Entitlements.application-identifier raw -o - "$verified_path/profile.plist")" == "$APPLE_TEAM_ID.$bundle_id" ]] &&
      (cd "$verified_path" && codesign --display --extract-certificates "$bundle") &&
      cmp -s "$verified_path/codesign0" "$scratch/distribution.cer"
  } >"$verified_path/signing-assets.log" 2>&1 ||
    fail 'The archive did not use the validated distribution profile and signing certificate.'
}

verify_distribution_archive() {
  local app_bundle="$archive/Products/Applications/App.app"
  verify_distribution_bundle "$app_bundle" com.thepropervolume.karaoke "$manual_profile_uuid" "$scratch/verify-app"
  if [[ "$widget_expected" == yes ]]; then
    verify_distribution_bundle "$app_bundle/PlugIns/RoomLiveActivity.appex" com.thepropervolume.karaoke.liveactivity \
      "$manual_widget_profile_uuid" "$scratch/verify-widget"
  fi
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
  local supplied_p12="${TPV_DISTRIBUTION_P12_BASE64:-}" supplied_p12_password="${TPV_DISTRIBUTION_P12_PASSWORD:-}"
  local reusable_certificate_id="${TPV_DISTRIBUTION_CERTIFICATE_ID:-}"
  unset TPV_DISTRIBUTION_P12_BASE64 TPV_DISTRIBUTION_P12_PASSWORD TPV_DISTRIBUTION_CERTIFICATE_ID
  if [[ -n "$supplied_p12" || -n "$supplied_p12_password" || -n "$reusable_certificate_id" ]]; then
    [[ -n "$supplied_p12" && "${#supplied_p12}" -le 32768 &&
       "$supplied_p12_password" =~ ^[A-Za-z0-9_-]{16,128}$ &&
       "$reusable_certificate_id" =~ ^[A-Za-z0-9-]{1,72}$ ]] ||
      fail 'Configure all three reusable distribution credentials in the protected TestFlight environment.'
  fi

  local version runner_temp scratch widget_expected
  version="$(node -p "require('./package.json').version")"
  widget_expected="$(node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { iosLiveActivityId, iosReleaseTargets } from './scripts/ios-release-targets.mjs';
const project = readFileSync('mobile/ios/App/App.xcodeproj/project.pbxproj', 'utf8');
console.log(iosReleaseTargets(project).includes(iosLiveActivityId) ? 'yes' : 'no');
NODE
)"
  [[ -n "${RUNNER_TEMP:-}" && "${RUNNER_TEMP:-}" == /* ]] || fail 'A private runner temp directory is required.'
  runner_temp="$(cd -P "$RUNNER_TEMP" && pwd)"
  umask 077
  scratch="$(mktemp -d "$runner_temp/tpv-testflight.XXXXXXXX")"
  # Store transient runner paths for the exit trap, which runs outside upload's local scope.
  tpv_testflight_scratch="$scratch"
  tpv_signing_keychain=''
  tpv_installed_profile=''
  tpv_installed_widget_profile=''
  tpv_prior_keychains=()
  trap cleanup_upload EXIT
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
  local archive_args=(-project mobile/ios/App/App.xcodeproj -scheme App -configuration Release
    -destination 'generic/platform=iOS'
    -clonedSourcePackagesDirPath "$RUNNER_TEMP/tpv-testflight-swift" -disableAutomaticPackageResolution
    -onlyUsePackageVersionsFromResolvedFile -skipPackageUpdates
    "DEVELOPMENT_TEAM=$APPLE_TEAM_ID" "CURRENT_PROJECT_VERSION=$TPV_TESTFLIGHT_BUILD_NUMBER")
  local signing_style=automatic manual_profile_name='' manual_profile_uuid='' manual_identity=''
  local manual_widget_profile_name='' manual_widget_profile_uuid=''
  if [[ -n "$reusable_certificate_id" ]]; then
    printf '%s\n' 'Using the protected reusable App Store distribution identity for this internal TestFlight archive.'
    signing_style=manual
  elif ! xcodebuild "${archive_args[@]}" -archivePath "$archive" -derivedDataPath "$scratch/build" \
    "${apple_auth[@]}" archive >"$scratch/archive.log" 2>&1; then
    report_xcode_failure archive "$scratch/archive.log"
    # Complete signing without a development device only when Xcode reports that specific hurdle.
    grep -Eiq -- 'no devices (are registered|registered|available)|has no devices|there are no devices' \
      "$scratch/archive.log" &&
      grep -Eiq -- 'no profiles for|iphoneos.*provisioning profile.*not found|requires a provisioning profile' \
        "$scratch/archive.log" || fail 'Xcode could not sign the archive.'
    printf '%s\n' 'Trying manual App Store distribution signing for this internal TestFlight archive.'
    signing_style=manual
  fi
  if [[ "$signing_style" == manual ]]; then
    prepare_distribution_signing
    archive="$scratch/BoothDistribution.xcarchive"
    local manual_args=(TPV_TESTFLIGHT_SIGN_STYLE=Manual "TPV_TESTFLIGHT_SIGN_IDENTITY=$manual_identity"
      "TPV_TESTFLIGHT_PROFILE_NAME=$manual_profile_name")
    if [[ "$widget_expected" == yes ]]; then
      manual_args+=("TPV_TESTFLIGHT_WIDGET_PROFILE_NAME=$manual_widget_profile_name")
    fi
    xcodebuild "${archive_args[@]}" "${manual_args[@]}" -archivePath "$archive" \
      -derivedDataPath "$scratch/build-distribution" archive >"$scratch/archive-distribution.log" 2>&1 || {
      report_xcode_failure archive "$scratch/archive-distribution.log"
      fail 'Xcode could not sign the archive with the temporary distribution profile.'
    }
    verify_distribution_archive
  fi
  verify_archive "$archive"

  plutil -create xml1 "$export_options"
  plutil -insert method -string app-store-connect "$export_options"
  plutil -insert destination -string upload "$export_options"
  plutil -insert signingStyle -string "$signing_style" "$export_options"
  plutil -insert teamID -string "$APPLE_TEAM_ID" "$export_options"
  plutil -insert manageAppVersionAndBuildNumber -bool NO "$export_options"
  plutil -insert uploadSymbols -bool YES "$export_options"
  plutil -insert testFlightInternalTestingOnly -bool YES "$export_options"
  if [[ "$signing_style" == manual ]]; then
    {
      plutil -insert signingCertificate -string "$manual_identity" "$export_options" &&
        /usr/libexec/PlistBuddy -c 'Add :provisioningProfiles dict' "$export_options" &&
        /usr/libexec/PlistBuddy -c "Add :provisioningProfiles:com.thepropervolume.karaoke string $manual_profile_uuid" "$export_options"
    } >"$scratch/export-options.log" 2>&1 ||
      fail 'The manual TestFlight export could not be configured.'
    if [[ "$widget_expected" == yes ]]; then
      /usr/libexec/PlistBuddy -c "Add :provisioningProfiles:com.thepropervolume.karaoke.liveactivity string $manual_widget_profile_uuid" \
        "$export_options" >>"$scratch/export-options.log" 2>&1 ||
        fail 'The manual TestFlight export is missing the WidgetKit provisioning profile.'
    fi
  fi

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
    (unset ASC_PRIVATE_KEY ASC_KEY_ID ASC_ISSUER_ID
     unset TPV_DISTRIBUTION_P12_BASE64 TPV_DISTRIBUTION_P12_PASSWORD TPV_DISTRIBUTION_CERTIFICATE_ID
     verify_source)
    upload
    ;;
  *) fail 'Use verify or upload.' ;;
esac
