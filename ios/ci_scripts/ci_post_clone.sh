#!/bin/bash
#
# Xcode Cloud looks for ci_scripts in the same directory as the project or
# workspace — not at the repository root. Apple states it plainly in
# "Writing custom build scripts":
#
#   Custom build scripts reside in a directory named ci_scripts that's
#   located in the same directory as your Xcode project or workspace
#
# This workflow's container is ios/NoFrills.xcworkspace, so the only path it
# ever reads is ios/ci_scripts/ — this file. A ci_scripts/ at the repo root
# is never consulted, which is why every run from #15 to #22 failed in about
# twenty seconds at `xcodebuild -resolvePackageDependencies` with
# `Workspace NoFrills.xcworkspace does not exist`. That looks like a project
# fault and is really a script that was never invoked: those runs' log
# bundles contain resolve_package_dependencies.log and nothing else.
#
# The advice to put ci_scripts at the repo root, which is everywhere online,
# is correct only when the .xcodeproj is itself at the repo root. Here it
# isn't.
#
# That leaves a chicken-and-egg, since ios/ is a generated folder and
# gitignored: the script that generates ios/ has to be committed inside it.
# .gitignore carves out exactly this one path (`/ios/*` plus
# `!/ios/ci_scripts/`) and nothing else under ios/ is tracked.
#
# The real script stays at the repo root and this one only hands off to it.
# Two reasons, and the first is not stylistic: `expo prebuild` clears ios/
# partway through the run, this file included. `exec` has already replaced
# this process by then, and the root copy lives outside ios/ so prebuild
# never touches it. Second, it keeps one reviewable copy of the logic
# instead of two that drift.

set -euo pipefail
exec "$CI_PRIMARY_REPOSITORY_PATH/ci_scripts/ci_post_clone.sh"
