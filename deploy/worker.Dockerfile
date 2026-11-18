# Sandbox image for VEX Simulator workers: the simulation engine + the users' Python code.
# Build from the repository root:
#     docker build -f deploy/worker.Dockerfile -t vexsim-worker:latest .
#   (or: uv run vexsim sandbox build)
#
# Only the simulation package and its two runtime dependencies are inside - no web server,
# no compilers, no network tools. At run time the server adds --network none, --read-only,
# --cap-drop ALL, --user nobody and resource limits (backend/vexsim/server/sandbox.py).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/opt/vexsim

# versions pinned to uv.lock
RUN pip install numpy==2.5.5 pyyaml==6.0.3

COPY backend/vexsim /opt/vexsim/vexsim
# the web server is not needed (and not wanted) inside the sandbox
RUN rm -rf /opt/vexsim/vexsim/server /opt/vexsim/vexsim/cli.py \
 && python -c "import vexsim.runner.worker" \
 && chmod -R a-w /opt/vexsim

USER 65534:65534
WORKDIR /tmp
CMD ["python", "-u", "-m", "vexsim.runner.worker"]
