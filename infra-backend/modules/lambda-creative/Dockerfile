# Build from walkcroach/ repo root:
#   docker build -f infra-backend/modules/lambda-creative/Dockerfile \
#     -t walkcroach-creative:latest .
#
# Bakes skills/web (scripts + themes + fonts) at /opt/skills/web
# LibreOffice + poppler for thumbnail_pptx.py (Phase B4)

FROM public.ecr.aws/lambda/python:3.12

RUN microdnf install -y \
      libreoffice-impress \
      poppler-utils \
      fontconfig \
      dejavu-sans-fonts \
      ffmpeg \
    && microdnf clean all \
    || (yum install -y libreoffice-impress poppler-utils fontconfig ffmpeg && yum clean all)

COPY infra-backend/modules/lambda-creative/codes/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY skills/web /opt/skills/web

ENV WALKCROACH_WEB_SKILLS_DIR=/opt/skills/web
ENV HOME=/tmp

COPY infra-backend/modules/lambda-creative/codes/src/ ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
