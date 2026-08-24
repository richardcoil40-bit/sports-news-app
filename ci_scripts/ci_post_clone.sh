#!/bin/bash
#
# Xcode Cloud runs this after cloning, before it opens the project.
#
# It exists because `/ios` is gitignored (see .gitignore, "generated native
# folders"). Xcode Cloud clones the repo and looks for the workspace named in
# the workflow, finds nothing, and fails with:
#
#   Workspace NoFrills.xcworkspace does not exist at ios/NoFrills.xcworkspace
#
# That is not a signing or a project problem — there is simply no native
# project in the clone yet. This script generates one, the same way a fresh
# machine would.
#
# Note the asymmetry with working locally: AGENTS.md warns that prebuild is
# destructive to `ios/` because it wipes DEVELOPMENT_TEAM out of
# project.pbxproj. That warning does not apply here. This clone has no
# `ios/` to destroy, and Xcode Cloud signs with its own managed certificate
# rather than the four keys listed in that section.

set -euo pipefail

# Xcode Cloud invokes this with ci_scripts/ as the working directory.
cd "$CI_PRIMARY_REPOSITORY_PATH"

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

# Node is not on the Xcode Cloud image. CocoaPods sometimes is — installing a
# second copy costs minutes of the monthly compute allowance, so only reach
# for brew if the image didn't bring one.
brew install node
command -v pod >/dev/null 2>&1 || brew install cocoapods

# AGENTS.md, "CocoaPods needs a UTF-8 locale": without this, `pod install`
# dies with `Unicode Normalization not appropriate for ASCII-8BIT` and the
# traceback points into Pod::Config#installation_root, which reads like a
# corrupt Podfile rather than a locale.
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

npm ci

# `.env` is tracked and carries EXPO_PUBLIC_VERDICT_URL / _CATALOG_URL, so
# those arrive with the clone. `.env.local` is gitignored (`.env*.local`) and
# is where EXPO_PUBLIC_VERDICT_TOKEN lives, so it does not — and Expo inlines
# EXPO_PUBLIC_* at bundle time, which happens here, not at launch.
#
# Without it the build still succeeds and still runs. It just gets a 401 from
# every POST /v1/classify (the Worker has CLIENT_TOKEN set) and silently
# degrades to local classification rules — a worse feed with nothing on
# screen to say so. Set it as a secret environment variable on the Xcode
# Cloud workflow to avoid that.
if [ -n "${EXPO_PUBLIC_VERDICT_TOKEN:-}" ]; then
  echo "EXPO_PUBLIC_VERDICT_TOKEN=$EXPO_PUBLIC_VERDICT_TOKEN" >> .env.local
else
  echo "warning: EXPO_PUBLIC_VERDICT_TOKEN is unset — this build will fall back to local verdicts"
fi

npx expo prebuild --platform ios

# The "Bundle React Native code and images" phase runs in its own shell and
# resolves node through ios/.xcode.env(.local) rather than through PATH, so
# the brew install above is invisible to it. Without this line the archive
# fails later with a bare "node: command not found", well after the point
# that looks like the problem. Written after prebuild, which creates ios/.
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local
