# Build from walkcroach/ repo root:
#   docker build -f infra-backend/modules/lambda-creative/Dockerfile \
#     -t walkcroach-creative:latest .
#
# Bakes skills/web (scripts + themes + fonts) at /opt/skills/web.
#
# WHY NOT public.ecr.aws/lambda/python:3.12
#
# That base is Amazon Linux 2023, whose repositories carry neither
# `libreoffice-impress` nor `ffmpeg`. Both are real requirements here:
# thumbnail_pptx.py shells out to `soffice`, and compose_video.py to `ffmpeg`.
# Each degrades gracefully when its binary is absent — a skipped thumbnail, a
# placeholder MP4 — which is precisely why their absence would have gone
# unnoticed in production rather than failing loudly.
#
# Debian has both, so the base is Debian and the Lambda contract is supplied by
# the AWS Lambda Runtime Interface Client (awslambdaric) instead of by the base
# image. That is the officially supported path for a custom container base:
# ENTRYPOINT runs the RIC, CMD names the handler.

# ---------------------------------------------------------------- build stage
# Compilers live here and nowhere else. awslambdaric publishes manylinux wheels,
# but it falls back to a source build that needs gcc/cmake/libcurl headers; that
# toolchain has no business in the shipped image.
FROM python:3.12-slim-bookworm AS deps

ENV LAMBDA_TASK_ROOT=/var/task

RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc \
      g++ \
      make \
      cmake \
      libcurl4-openssl-dev \
      libssl-dev \
      autoconf \
      libtool \
    && rm -rf /var/lib/apt/lists/*

COPY infra-backend/modules/lambda-creative/codes/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --target "${LAMBDA_TASK_ROOT}" \
      awslambdaric \
      -r /tmp/requirements.txt

# -------------------------------------------------------------- runtime stage
FROM python:3.12-slim-bookworm

ENV LAMBDA_TASK_ROOT=/var/task

# libreoffice-impress pulls libreoffice-core; poppler-utils is the fallback
# rasteriser in thumbnail_pptx.py. Debian names differ from Amazon Linux:
# `fonts-dejavu`, not `dejavu-sans-fonts`.
#
# The explicit libs are the ones --no-install-recommends drops but headless
# soffice still dlopens at conversion time. Omitting them yields a clean build
# and a runtime failure, which thumbnail_pptx.py then swallows as a skipped
# thumbnail — so it would look like the feature simply does nothing.
#
# fonts-liberation is not optional either: decks reference Arial/Times, and
# without metric-compatible substitutes LibreOffice reflows the text and the
# rendered slide stops matching the deck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      poppler-utils \
      ffmpeg \
      fontconfig \
      fonts-dejavu \
      fonts-liberation \
      libxinerama1 \
      libcups2 \
      libdbus-1-3 \
      libcairo2 \
      libsm6 \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps ${LAMBDA_TASK_ROOT} ${LAMBDA_TASK_ROOT}

COPY skills/web /opt/skills/web

ENV WALKCROACH_WEB_SKILLS_DIR=/opt/skills/web
# LibreOffice insists on a writable profile directory, and every Lambda
# filesystem except /tmp is read-only.
ENV HOME=/tmp
ENV PYTHONPATH=${LAMBDA_TASK_ROOT}

COPY infra-backend/modules/lambda-creative/codes/src/ ${LAMBDA_TASK_ROOT}/

WORKDIR ${LAMBDA_TASK_ROOT}

# The two lines the AWS base image would otherwise have provided. Without an
# ENTRYPOINT the container has no Lambda runtime loop at all and every
# invocation times out.
ENTRYPOINT ["/usr/local/bin/python", "-m", "awslambdaric"]
CMD ["handler.handler"]
