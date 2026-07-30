import { shellQuote } from './daytona-shell'

export const textArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY---\n'
export const binaryArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY_BASE64---\n'
export const protectedVerifierUid = 65_534
export const protectedVerifierGid = 65_534
export const clearedCapabilitySet = '0000000000000000'

const maxEvidenceArtifactBytes = 5_000_000
const protectedRuntimeDirectory = '/patchplane-runtime'
const protectedLauncherPath = `${protectedRuntimeDirectory}/launch`
const protectedObservationPath = `${protectedRuntimeDirectory}/observation`
const protectedSeccompFilterPath = `${protectedRuntimeDirectory}/seccomp.bpf`
const protectedSeccompFilterBase64 =
  'IAAAAAQAAAAVAAEAPgAAwAYAAAAAAACAIAAAAAAAAABFAAABAAAAQAYAAAAmAAUAFQADABABAAAVAAUAOAAAABUAAAezAQAABgAAACYABQAgAAAAEAAAAEUAAAQAAAAQBgAAAAEABQAgAAAAEAAAAEUAAAEAAAAQBgAAAAEABQAGAAAAAAD/fw=='

const protectedLauncherScript = `#!/bin/bash
set -euo pipefail
observation=${protectedObservationPath}
rm -f -- "$observation"
umask 077
exec 3>"$observation"
parent_network_namespace="$(readlink /proc/self/ns/net)"
exec /usr/bin/unshare --pid --fork --mount-proc --net \\
  /usr/bin/setpriv \\
    --reuid=${protectedVerifierUid} \\
    --regid=${protectedVerifierGid} \\
    --clear-groups \\
    --seccomp-filter=${protectedSeccompFilterPath} \\
    --no-new-privs \\
    --bounding-set=-all \\
    --inh-caps=-all \\
    --ambient-caps=-all \\
  /usr/bin/env -i \\
    HOME=${protectedRuntimeDirectory}/home \\
    TMPDIR=${protectedRuntimeDirectory}/tmp \\
    PATH=/usr/local/bin:/usr/bin:/bin \\
  /bin/bash -c '
    set -euo pipefail
    printf "effectiveUid=%s\\neffectiveGid=%s\\n" "$(id -u)" "$(id -g)" >&3
    while read -r key value _; do
      case "$key" in
        CapInh:|CapPrm:|CapEff:|CapBnd:|CapAmb:|NoNewPrivs:|Seccomp:|Seccomp_filters:)
          printf "%s=%s\\n" "$key" "$value" >&3
          ;;
      esac
    done < /proc/self/status
    printf "namespacePid=%s\\n" "$$" >&3
    current_network_namespace="$(readlink /proc/self/ns/net)"
    if [ "$current_network_namespace" != "$2" ]; then
      printf "networkNamespace=1\\n" >&3
    else
      printf "networkNamespace=0\\n" >&3
    fi
    if /usr/bin/python3 -I - >/dev/null 2>&1 <<PY
import ctypes
import os
import signal

libc = ctypes.CDLL(None, use_errno=True)
clone_newuser = 0x10000000
blocked = True
if libc.syscall(272, clone_newuser) == 0:
    blocked = False

class CloneArgs(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint64), ("pidfd", ctypes.c_uint64), ("child_tid", ctypes.c_uint64), ("parent_tid", ctypes.c_uint64), ("exit_signal", ctypes.c_uint64), ("stack", ctypes.c_uint64), ("stack_size", ctypes.c_uint64), ("tls", ctypes.c_uint64), ("set_tid", ctypes.c_uint64), ("set_tid_size", ctypes.c_uint64), ("cgroup", ctypes.c_uint64)]

args = CloneArgs(flags=clone_newuser, exit_signal=signal.SIGCHLD)
result = libc.syscall(435, ctypes.byref(args), ctypes.sizeof(args))
if result >= 0:
    if result == 0:
        os._exit(0)
    os.kill(result, signal.SIGKILL)
    os.waitpid(result, 0)
    blocked = False

result = libc.syscall(56, clone_newuser | signal.SIGCHLD, 0, 0, 0, 0)
if result >= 0:
    if result == 0:
        os._exit(0)
    os.kill(result, signal.SIGKILL)
    os.waitpid(result, 0)
    blocked = False

raise SystemExit(1 if blocked else 0)
PY
    then
      printf "nestedNamespaceCreationBlocked=0\\n" >&3
      exit 69
    else
      printf "nestedNamespaceCreationBlocked=1\\n" >&3
    fi
    exec 3>&-
    exec /bin/bash -c "$1"
  ' patchplane-verifier "$1" "$parent_network_namespace"
`

const staleVerificationArtifactsCommand =
  'rm -f .patchplane/test-report.json .patchplane/test-report.xml .patchplane/browser-screenshot.png patchplane-test-report.json patchplane-test-report.xml test-results/junit.xml junit.xml coverage/coverage-final.json patchplane-browser-screenshot.png test-results/browser-screenshot.png playwright-report/browser-screenshot.png'

export function protectedVerificationCommand(command: string) {
  return `/usr/bin/sudo -n ${protectedLauncherPath} ${shellQuote(command)}`
}

export const protectedSandboxSetupScript = `set -euo pipefail
printf 'PATCHPLANE_PROTECTED_SETUP_V1\\n'
[ "$(id -u)" -ne 0 ]
if [ "$(uname -m)" != x86_64 ]; then
  printf 'protected verification requires x86_64\\n' >&2
  exit 68
fi
sudo -n true
command -v /usr/bin/unshare >/dev/null
command -v /usr/bin/setpriv >/dev/null
command -v /bin/bash >/dev/null
command -v base64 >/dev/null
if find . -xdev -type l -print -quit | grep -q .; then
  printf 'candidate symlinks are unsupported\\n' >&2
  exit 65
fi
if find . -xdev -type f -links +1 -print -quit | grep -q .; then
  printf 'candidate hardlinks are unsupported\\n' >&2
  exit 66
fi
tracked_writable_path=''
while IFS= read -r -d '' path; do
  case "$path" in
    .patchplane/*|node_modules/*|*/node_modules/*|patchplane-test-report.json|patchplane-test-report.xml|test-results/junit.xml|junit.xml|coverage/coverage-final.json|patchplane-browser-screenshot.png|test-results/browser-screenshot.png|playwright-report/browser-screenshot.png)
      tracked_writable_path="$path"
      break
      ;;
  esac
done < <(git ls-files -z)
if [ -n "$tracked_writable_path" ]; then
  printf 'tracked writable/evidence path is unsupported\\n' >&2
  exit 67
fi
${staleVerificationArtifactsCommand}
bun_path="$(command -v bun)"
sudo -n install -o root -g root -m 0755 "$bun_path" /usr/local/bin/bun
sudo -n rm -rf ${protectedRuntimeDirectory}
sudo -n mkdir -p ${protectedRuntimeDirectory}/home ${protectedRuntimeDirectory}/tmp
printf '%s' ${shellQuote(protectedLauncherScript)} | sudo -n tee ${protectedLauncherPath} >/dev/null
printf '%s' ${shellQuote(protectedSeccompFilterBase64)} | base64 -d | sudo -n tee ${protectedSeccompFilterPath} >/dev/null
sudo -n chown -R root:root ${protectedRuntimeDirectory}
sudo -n chmod 0555 ${protectedRuntimeDirectory} ${protectedLauncherPath}
sudo -n chmod 0444 ${protectedSeccompFilterPath}
sudo -n chmod 0700 ${protectedRuntimeDirectory}/home ${protectedRuntimeDirectory}/tmp
sudo -n chown ${protectedVerifierUid}:${protectedVerifierGid} ${protectedRuntimeDirectory}/home ${protectedRuntimeDirectory}/tmp
git config --global --add safe.directory "$(pwd -P)"
sudo -n chown -R root:root .
sudo -n find . -xdev -type d -exec chmod 0555 {} +
sudo -n find . -xdev -type f -exec chmod a-w {} +
sudo -n mkdir -p .patchplane
sudo -n chown root:root .patchplane
sudo -n chmod 0777 .patchplane
while IFS= read -r -d '' manifest; do
  package_dir="$(dirname -- "$manifest")"
  sudo -n mkdir -p -- "$package_dir/node_modules"
  sudo -n chown root:root -- "$package_dir/node_modules"
  sudo -n chmod 0777 -- "$package_dir/node_modules"
done < <(find . -path './.git' -prune -o -type f -name package.json -print0)
`

export const protectedExecutionReadbackScript = `set -euo pipefail
source_read_only=1
git_read_only=1
while IFS= read -r -d '' path; do
  owner="$(stat -c %u -- "$path")"
  group="$(stat -c %g -- "$path")"
  mode="$(stat -c %a -- "$path")"
  if [ "$owner" -ne 0 ] || [ "$group" -ne 0 ] || (( (8#$mode & 0222) != 0 )); then
    source_read_only=0
    break
  fi
done < <(find . -xdev \\( -path './.patchplane' -o -name node_modules \\) -prune -o \\( -type f -o -type d \\) -print0)
while IFS= read -r -d '' path; do
  owner="$(stat -c %u -- "$path")"
  group="$(stat -c %g -- "$path")"
  mode="$(stat -c %a -- "$path")"
  if [ "$owner" -ne 0 ] || [ "$group" -ne 0 ] || (( (8#$mode & 0222) != 0 )); then
    git_read_only=0
    break
  fi
done < <(find .git -xdev \\( -type f -o -type d \\) -print0)
remaining="$(ps -eo uid=,stat= | awk '$1 == ${protectedVerifierUid} && $2 !~ /^Z/ { count++ } END { print count + 0 }')"
sudo -n cat ${protectedObservationPath}
printf 'sourceReadOnly=%s\\ngitMetadataReadOnly=%s\\ndescendantsTerminated=%s\\n' "$source_read_only" "$git_read_only" "$([ "$remaining" -eq 0 ] && printf 1 || printf 0)"
`

export function testReportProbeCommand(protectedReadback: boolean) {
  const paths = [
    '.patchplane/test-report.json',
    '.patchplane/test-report.xml',
    'patchplane-test-report.json',
    'patchplane-test-report.xml',
    'test-results/junit.xml',
    'junit.xml',
  ]
  const script = [
    'const fs=require("fs");',
    `const paths=${JSON.stringify(paths)};`,
    `const limit=${maxEvidenceArtifactBytes};`,
    'const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW;',
    'for(const path of paths){let fd;try{fd=fs.openSync(path,flags);const stat=fs.fstatSync(fd);const size=stat.size;if(!stat.isFile()||size<=0||size>limit)continue;',
    'const body=Buffer.alloc(size);const read=fs.readSync(fd,body,0,size,0);if(read!==size)continue;',
    `process.stdout.write(path+${JSON.stringify(textArtifactMarker)}+body);break;`,
    '}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}}',
  ].join('')
  const runtime = protectedReadback
    ? '/usr/bin/sudo -n /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/bun'
    : 'bun'
  return `${runtime} --config=/dev/null --no-env-file -e '${script}'`
}

export function screenshotProbeCommand(protectedReadback: boolean) {
  const paths = [
    '.patchplane/browser-screenshot.png',
    'patchplane-browser-screenshot.png',
    'test-results/browser-screenshot.png',
    'playwright-report/browser-screenshot.png',
  ]
  const script = [
    'const fs=require("fs");',
    `const paths=${JSON.stringify(paths)};`,
    `const limit=${maxEvidenceArtifactBytes};`,
    'const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW;',
    'for(const path of paths){let fd;try{fd=fs.openSync(path,flags);const stat=fs.fstatSync(fd);const size=stat.size;if(!stat.isFile()||size<=0||size>limit)continue;',
    'const body=Buffer.alloc(size);const read=fs.readSync(fd,body,0,size,0);if(read!==size)continue;',
    `process.stdout.write(path+${JSON.stringify(binaryArtifactMarker)}+body.toString("base64"));break;`,
    '}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}}',
  ].join('')
  const runtime = protectedReadback
    ? '/usr/bin/sudo -n /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/bun'
    : 'bun'
  return `${runtime} --config=/dev/null --no-env-file -e '${script}'`
}
