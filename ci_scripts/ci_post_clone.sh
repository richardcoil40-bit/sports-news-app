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

# Xcode Cloud never invokes this file directly. It only reads ci_scripts
# beside the workspace, so ios/ci_scripts/ci_post_clone.sh is what it runs,
# and that stub execs this. See the comment there for why the split exists
# and why this half has to stay outside ios/.
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Checked before anything is installed. The gate itself is explained further
# down, next to the .env.local write it guards — what matters here is only
# that it runs first: brew and `npm ci` cost about five minutes of the
# monthly compute allowance, and spending them to discover a missing secret
# is five minutes bought for nothing.
if [ -z "${EXPO_PUBLIC_VERDICT_TOKEN:-}" ]; then
  echo "error: EXPO_PUBLIC_VERDICT_TOKEN is unset." >&2
  echo "  Add it as a secret environment variable on the workflow." >&2
  echo "  Without it this build ships degraded to local verdict rules, and" >&2
  echo "  nothing on screen would say so — so it fails here instead." >&2
  exit 1
fi

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

# This is what the gate at the top of the file protects.
#
# `.env` is tracked and carries EXPO_PUBLIC_VERDICT_URL / _CATALOG_URL, so
# those arrive with the clone. `.env.local` is gitignored (`.env*.local`) and
# is where EXPO_PUBLIC_VERDICT_TOKEN lives, so it does not — and Expo inlines
# EXPO_PUBLIC_* at bundle time, which happens here, not at launch. Xcode
# Cloud supplies it as a secret environment variable of the same name.
#
# Missing, the build still succeeds and still runs. It just gets a 401 from
# every POST /v1/classify (the Worker has CLIENT_TOKEN set) and silently
# degrades to local classification rules — a worse feed with nothing on
# screen to say so.
#
# Which is why the gate exits rather than warning, as this script did when
# it first shipped. A warning is the wrong instrument for a defect that
# reaches testers looking healthy: no crash, no error, nothing anyone would
# think to report. It is the same call the data layer already makes twice —
# `teams.ts` throws on a non-OK response and `fetchLeagueCatalog` rejects
# rather than degrade to an empty catalog, both because an app that looks
# like it loaded correctly is worse than one that visibly didn't.
echo "EXPO_PUBLIC_VERDICT_TOKEN=$EXPO_PUBLIC_VERDICT_TOKEN" >> .env.local

npx expo prebuild --platform ios

# The "Bundle React Native code and images" phase runs in its own shell and
# resolves node through ios/.xcode.env(.local) rather than through PATH, so
# the brew install above is invisible to it. Without this line the archive
# fails later with a bare "node: command not found", well after the point
# that looks like the problem. Written after prebuild, which creates ios/.
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local
