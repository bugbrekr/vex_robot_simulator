# Sandboxing user code (Docker / rootless Docker / Podman)

The simulator runs the Python that people type, so on a shared server that code must not run as
a normal process.

**With `VEXSIM_SANDBOX=docker`, each browser session gets its own throw-away container.** It holds the simulation engine and the user's program. The web server stays on the host and only relays messages.

```
browser ⇄ nginx ⇄ vexsim serve (host) ⇄ stdin/stdout ⇄ docker run --rm -i vexsim-worker   (one per session)
```

The worker talks only JSON lines over stdin/stdout, so the container needs nothing else. It is started with these restrictions:

| Restriction | Flag |
|---|---|
| No network (no LAN, no internet) | `--network none` |
| No files shared with the host (no volumes or mounts) | – |
| Read-only root filesystem, plus a 16 MB `noexec` `/tmp` | `--read-only --tmpfs /tmp` |
| Runs as `nobody`, all capabilities dropped, no privilege escalation | `--user 65534:65534 --cap-drop ALL --security-opt no-new-privileges` |
| Resource limits (configurable) | `--memory 512m --memory-swap 512m --cpus 1 --pids-limit 128` |
| Proper signal handling | `--init` |
| Removed when the session ends | `--rm`, plus `docker rm -f` on disconnect or reset |
| Orphans from a crashed server are removed at startup | label `vexsim.worker=1` |

The image (`deploy/worker.Dockerfile`) contains only `python:3.12-slim`, numpy, pyyaml and the
simulation package. The web server is deliberately left out.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VEXSIM_SANDBOX` | `none` | `docker` turns the sandbox on (or `vexsim serve --sandbox docker`) |
| `VEXSIM_DOCKER` | `docker` | Container CLI, e.g. `podman` |
| `DOCKER_HOST` | – | Daemon socket. For rootless Docker: `unix:///run/user/<uid>/docker.sock` |
| `VEXSIM_SANDBOX_IMAGE` | `vexsim-worker:latest` | Worker image |
| `VEXSIM_SANDBOX_MEMORY` / `_CPUS` / `_PIDS` | `512m` / `1` / `128` | Limits. An empty value means no limit |
| `VEXSIM_SANDBOX_ARGS` | – | Extra `docker run` arguments, e.g. `--runtime=runsc` for gVisor |
| `VEXSIM_FRAME_HZ` | `30` | State updates per second sent to the browser. The browser interpolates between them, so 30 is already smooth; raise it (e.g. `60`) only for lower latency while dragging |

```bash
uv run vexsim sandbox build     # docker build -f deploy/worker.Dockerfile -t vexsim-worker:latest .
uv run vexsim sandbox check     # runs a probe in a real sandbox container; expected report:
#   [ok] unprivileged user  uid=65534
#   [ok] no network  OSError
#   [ok] read-only filesystem
#   [ok] scratch /tmp
#   [ok] memory limit  536870912
#   [ok] process limit  128
#   [ok] simulation runs  170.0
uv run vexsim serve --sandbox docker
```

Rebuild the image (`vexsim sandbox build`) whenever you update the simulator code.

## Rootless Docker (recommended)

With normal (rootful) Docker, any account that can talk to the daemon is effectively root. That includes a `docker` group member such as the server's account. With **rootless** Docker, the daemon and every container run as one unprivileged user. Even a container breakout only reaches that user.

The steps below are for Debian/Ubuntu. Other distros differ only in the packages. `docker-ce` and
`docker-ce-rootless-extras` are **not** in the Debian/Ubuntu archives; they come from Docker's own
apt repository, which step 0 adds. If you'd rather not add a third-party repository, use
[Podman](#podman-no-extra-repository) instead.

```bash
# 0. add Docker's apt repository (once)
#    remove distro packages that conflict with docker-ce (ignore "not installed" messages)
sudo apt-get remove -y docker.io docker-doc docker-compose podman-docker containerd runc
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release        # ID=ubuntu|debian; derivatives (Mint, Pop!_OS...): use ubuntu / debian below
sudo curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/$ID ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update

# 1. packages (as root)
sudo apt-get install -y uidmap dbus-user-session docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras
#    optional: turn off the rootful daemon if nothing else needs it
sudo systemctl disable --now docker.service docker.socket

# 2. a dedicated account (useradd also allocates its /etc/subuid + /etc/subgid ranges)
sudo useradd --create-home --shell /bin/bash vexsim
grep vexsim /etc/subuid /etc/subgid          # must print a range for both
sudo loginctl enable-linger vexsim           # user services run without anyone logged in

# 3. let user services set CPU / memory / pids limits (cgroup v2 delegation)
sudo mkdir -p /etc/systemd/system/user@.service.d
printf '[Service]\nDelegate=cpu cpuset io memory pids\n' | \
  sudo tee /etc/systemd/system/user@.service.d/delegate.conf
sudo systemctl daemon-reload

# 4. start rootless dockerd as vexsim - use a real login session (machinectl or ssh),
#    plain `sudo su` lacks the systemd user session the setup tool needs
sudo machinectl shell vexsim@
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
docker info | grep -iE 'rootless|cgroup'     # expect "rootless" and "Cgroup Version: 2"
cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers
#                                            # expect: cpuset cpu io memory pids

# 5. install the simulator as vexsim and verify the sandbox
git clone <your repo> ~/VEX_Simulator && cd ~/VEX_Simulator
uv sync && (cd frontend && npm ci && npm run build)
uv run vexsim sandbox build
uv run vexsim sandbox check

# 6. run it as a user service beside rootless dockerd
mkdir -p ~/.config/systemd/user
cp deploy/vexsim-user.service ~/.config/systemd/user/vexsim.service
systemctl --user daemon-reload && systemctl --user enable --now vexsim
```

nginx (`deploy/nginx-vexsim.conf`) still proxies to `127.0.0.1:8000`.

**Troubleshooting**
- **`--memory`, `--cpus` or `--pids-limit` errors in rootless mode** (e.g. "cgroup … not supported"): controller delegation is missing (step 3), or the host is on cgroup v1. Fix the delegation, or run without limits by setting `VEXSIM_SANDBOX_MEMORY=`, `VEXSIM_SANDBOX_CPUS=` and `VEXSIM_SANDBOX_PIDS=` (empty values). The limits are the protection against runaway programs, so delegation is worth fixing.
- **`newuidmap: write to uid_map failed: Operation not permitted`** (or `cannot set up namespace using "/usr/bin/newuidmap"`): rootless Podman can't create the container's user namespace.
  - **Usual cause:** `NoNewPrivileges=yes` in the systemd unit. It blocks the setuid `newuidmap`/`newgidmap` helpers. Remove the line, then run `systemctl --user daemon-reload && systemctl --user restart vexsim`. `systemctl --user show vexsim -p NoNewPrivileges` should then print `no`. The containers themselves keep `no-new-privileges`.
  - **Why it can work at first:** Podman reuses a namespace created by an earlier interactive `podman` command until a reboot or `podman system migrate`.
  - **Rarer causes:**
    - `newuidmap` has lost its setuid bit. `ls -l /usr/bin/newuidmap` should show `-rwsr-xr-x root`, or `getcap` should show `cap_setuid`.
    - `vexsim` is missing from `/etc/subuid` or `/etc/subgid`.
    - `/usr` is mounted `nosuid`.
  - **Where it shows up:** the server checks the sandbox at startup and logs `vexsim: sandbox OK` or `SANDBOX CHECK FAILED - …` (see `journalctl --user -u vexsim`). Students only see a short "couldn't start its sandbox" message.
- **`Cannot connect to the Docker daemon`:** `DOCKER_HOST` isn't set to the rootless socket. The user unit sets it for you.
- **Every session's first start takes about a second:** that's the cost of a fresh container. The scene then persists across runs inside that container.

## Podman (no extra repository)

Podman is in the normal Debian/Ubuntu archives, runs rootless by default, and accepts the same
flags. Use the same `vexsim` account, linger and cgroup delegation (steps 2–3 above), then:

```bash
sudo apt-get install -y podman uidmap slirp4netns catatonit   # catatonit provides --init
sudo machinectl shell vexsim@
podman info | grep -iE 'rootless|cgroupVersion'                # expect rootless: true, v2
cd ~/VEX_Simulator
export VEXSIM_DOCKER=podman
uv run vexsim sandbox build && uv run vexsim sandbox check
```

In `deploy/vexsim-user.service`, replace the `DOCKER_HOST` line with
`Environment=VEXSIM_DOCKER=podman` and drop the `After=/Wants=docker.service` lines (Podman needs no daemon).

**Don't skip `VEXSIM_DOCKER=podman` in the unit.** Without it the server runs `docker`. If that
command exists (real Docker, or `podman-docker` pointed at another socket), it uses a different
image store, and sessions keep running an old worker image even after `vexsim sandbox build`.
At startup the server logs the engine and image it uses (`journalctl --user -u vexsim`):
`vexsim: sandbox via 'podman', image vexsim-worker:latest: <id> <created>`. The created time
should match your last build.

**Stronger isolation:** if the host has gVisor installed, add `VEXSIM_SANDBOX_ARGS=--runtime=runsc` so syscalls go through a user-space kernel.
